"""
tests/cred_helper_suite.py

Comprehensive test suite for Antigravity Credential Storage & Slot Compaction (credHelper.py).
Derived from R3 & R4 specifications in ORIGINAL_REQUEST.md.
"""

import sys
import os
import json
import base64
import unittest

# Ensure path to helpers
sys.path.insert(0, os.path.dirname(__file__))
from helpers.cred_sandbox import create_sandbox
import credHelper

class TestCredHelper(unittest.TestCase):
    def setUp(self):
        self.sandbox = create_sandbox()
        self.sandbox.activate()

    def tearDown(self):
        self.sandbox.cleanup()

    # --- Email Extraction ---
    def test_extract_email_direct_json(self):
        blob = json.dumps({"token": "ya29.xyz", "email": "test@gmail.com"})
        email = credHelper.extract_email(blob)
        self.assertEqual(email, "test@gmail.com")

    def test_extract_email_jwt_payload(self):
        header = base64.urlsafe_b64encode(b'{"alg":"RS256"}').decode().rstrip('=')
        payload_data = {"email": "jwt_user@gmail.com", "sub": "123456"}
        payload = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).decode().rstrip('=')
        id_token = f"{header}.{payload}.signature_bytes"
        blob = json.dumps({"token": "ya29.xyz", "id_token": id_token})
        email = credHelper.extract_email(blob)
        self.assertEqual(email, "jwt_user@gmail.com")

    def test_extract_email_malformed_blob(self):
        self.assertIsNone(credHelper.extract_email(None))
        self.assertIsNone(credHelper.extract_email(""))
        self.assertIsNone(credHelper.extract_email("not json"))
        self.assertIsNone(credHelper.extract_email(json.dumps({"token": "only_token"})))
        self.assertIsNone(credHelper.extract_email(json.dumps({"id_token": "malformed.jwt"})))

    # --- Migration Mechanics ---
    def test_ensure_migrated_legacy_primary(self):
        # Seed legacy primary
        self.sandbox.creds[credHelper.TARGET_PRIMARY] = json.dumps({"token": "tok1", "email": "prim@gmail.com"})
        credHelper.ensure_migrated()
        # Slot 1 must exist
        slot1 = credHelper.read_cred(credHelper.get_slot_target(1))
        self.assertIsNotNone(slot1)
        self.assertIn("prim@gmail.com", slot1)
        # Legacy primary must be deleted
        self.assertNotIn(credHelper.TARGET_PRIMARY, self.sandbox.creds)

    def test_ensure_migrated_legacy_reserve(self):
        self.sandbox.creds[credHelper.TARGET_RESERVE] = json.dumps({"token": "tok2", "email": "resv@gmail.com"})
        credHelper.ensure_migrated()
        slot2 = credHelper.read_cred(credHelper.get_slot_target(2))
        self.assertIsNotNone(slot2)
        self.assertIn("resv@gmail.com", slot2)
        self.assertNotIn(credHelper.TARGET_RESERVE, self.sandbox.creds)

    # --- Switching & Token Sync ---
    def test_switch_rotates_accounts(self):
        self.sandbox.seed_account(1, "acc1@gmail.com")
        self.sandbox.seed_account(2, "acc2@gmail.com")
        self.sandbox.seed_active(1)

        # Switch to slot 2
        res = credHelper.switch("2")
        self.assertEqual(res.get("activeSlot"), 2)
        active_cred = credHelper.read_cred(credHelper.TARGET_ACTIVE)
        self.assertIn("acc2@gmail.com", active_cred)

        # Switch next (should wrap to 1)
        res2 = credHelper.switch("next")
        self.assertEqual(res2.get("activeSlot"), 1)
        active_cred2 = credHelper.read_cred(credHelper.TARGET_ACTIVE)
        self.assertIn("acc1@gmail.com", active_cred2)

    def test_switch_synchronizes_refreshed_token(self):
        self.sandbox.seed_account(1, "acc1@gmail.com", token="initial_token")
        self.sandbox.seed_account(2, "acc2@gmail.com")
        self.sandbox.seed_active(1)

        # Simulate Language Server background token refresh on TARGET_ACTIVE
        refreshed_payload = json.dumps({"token": "refreshed_token_live", "email": "acc1@gmail.com"})
        self.sandbox.creds[credHelper.TARGET_ACTIVE] = refreshed_payload

        # Switch to slot 2
        credHelper.switch("2")

        # Slot 1 in storage MUST have been updated with refreshed_token_live!
        slot1_saved = credHelper.read_cred(credHelper.get_slot_target(1))
        self.assertIn("refreshed_token_live", slot1_saved)

    # --- Zero-Gap Compaction & Deletion ---
    def test_delete_middle_slot_compaction(self):
        # 3 accounts: 1, 2, 3
        self.sandbox.seed_account(1, "acc1@gmail.com")
        self.sandbox.seed_account(2, "acc2@gmail.com")
        self.sandbox.seed_account(3, "acc3@gmail.com")
        self.sandbox.seed_active(1)

        # Delete middle slot 2
        res = credHelper.delete_slot(2)
        self.assertNotIn("error", res)
        accounts = res.get("accounts", [])
        self.assertEqual(len(accounts), 2)
        self.assertEqual(accounts[0]["slot"], 1)
        self.assertEqual(accounts[0]["email"], "acc1@gmail.com")
        self.assertEqual(accounts[1]["slot"], 2) # Old slot 3 compacted to slot 2!
        self.assertEqual(accounts[1]["email"], "acc3@gmail.com")

        # Verify physical slot 3 no longer exists
        self.assertIsNone(credHelper.read_cred(credHelper.get_slot_target(3)))
        # Slot 2 must have acc3
        slot2_cred = credHelper.read_cred(credHelper.get_slot_target(2))
        self.assertIn("acc3@gmail.com", slot2_cred)

    def test_delete_active_slot_falls_back_to_slot1(self):
        self.sandbox.seed_account(1, "acc1@gmail.com")
        self.sandbox.seed_account(2, "acc2@gmail.com")
        self.sandbox.seed_account(3, "acc3@gmail.com")
        # Slot 2 is currently active
        self.sandbox.seed_active(2)

        res = credHelper.delete_slot(2)
        self.assertEqual(res.get("activeSlot"), 1)
        active_cred = credHelper.read_cred(credHelper.TARGET_ACTIVE)
        self.assertIn("acc1@gmail.com", active_cred)

    def test_delete_sole_account_rejected(self):
        self.sandbox.seed_account(1, "solo@gmail.com")
        self.sandbox.seed_active(1)

        res = credHelper.delete_slot(1)
        self.assertIn("error", res)
        self.assertIn("единственный", res["error"])

    # --- Add Account Flow & Cancellation ---
    def test_prepare_and_finalize_add_login(self):
        self.sandbox.seed_account(1, "acc1@gmail.com")
        self.sandbox.seed_account(2, "acc2@gmail.com")
        self.sandbox.seed_active(1)

        # Prepare login for slot 3
        prep = credHelper.prepare_add_login("3")
        self.assertEqual(prep.get("pendingSlot"), 3)
        self.assertIsNone(credHelper.read_cred(credHelper.TARGET_ACTIVE))

        # Simulate new account login writing to TARGET_ACTIVE
        new_payload = json.dumps({"token": "new_tok3", "email": "acc3@gmail.com"})
        self.sandbox.creds[credHelper.TARGET_ACTIVE] = new_payload

        # Finalize login
        fin = credHelper.finalize_add_login("3")
        self.assertEqual(fin.get("newEmail"), "acc3@gmail.com")
        self.assertIsNone(fin.get("pendingSlot"))
        # Slot 3 must now contain new account
        slot3 = credHelper.read_cred(credHelper.get_slot_target(3))
        self.assertIn("acc3@gmail.com", slot3)
        # Active credential should be restored to slot 1
        active = credHelper.read_cred(credHelper.TARGET_ACTIVE)
        self.assertIn("acc1@gmail.com", active)

    def test_cancel_add_login_restores_active(self):
        self.sandbox.seed_account(1, "acc1@gmail.com")
        self.sandbox.seed_active(1)

        credHelper.prepare_add_login("2")
        self.assertIsNone(credHelper.read_cred(credHelper.TARGET_ACTIVE))

        # User clicks cancel
        canc = credHelper.cancel_add_login()
        self.assertIsNone(canc.get("pendingSlot"))
        active = credHelper.read_cred(credHelper.TARGET_ACTIVE)
        self.assertIn("acc1@gmail.com", active)

    # --- Toggle Auto Failover ---
    def test_toggle_autofailover(self):
        self.sandbox.seed_account(1, "acc1@gmail.com")
        self.sandbox.seed_active(1)

        res = credHelper.toggle_autofailover(False)
        self.assertFalse(res.get("autoFailover"))
        res2 = credHelper.toggle_autofailover(True)
        self.assertTrue(res2.get("autoFailover"))

if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestCredHelper)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
