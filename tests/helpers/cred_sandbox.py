"""
tests/helpers/cred_sandbox.py

In-memory isolation sandbox for Windows Credential Manager and Antigravity multi-account configuration.
Enables completely safe, non-destructive testing of credHelper.py logic.
"""

import os
import sys
import json
import tempfile
import shutil

# Add asar_extracted_228/dist to sys.path
DIST_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'asar_extracted_228', 'dist'))
if DIST_PATH not in sys.path:
    sys.path.insert(0, DIST_PATH)

import credHelper

class CredentialSandbox:
    def __init__(self):
        self.temp_dir = tempfile.mkdtemp(prefix="agy_test_cred_")
        self.config_path = os.path.join(self.temp_dir, "antigravity_multiacc.json")
        self.creds = {} # target_name -> credential_str
        self._orig_read = credHelper.read_cred
        self._orig_write = credHelper.write_cred
        self._orig_delete = credHelper.delete_cred
        self._orig_config_path = credHelper.CONFIG_PATH

    def __enter__(self):
        self.activate()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()

    def activate(self):
        credHelper.read_cred = self._mock_read_cred
        credHelper.write_cred = self._mock_write_cred
        credHelper.delete_cred = self._mock_delete_cred
        credHelper.CONFIG_PATH = self.config_path

    def cleanup(self):
        credHelper.read_cred = self._orig_read
        credHelper.write_cred = self._orig_write
        credHelper.delete_cred = self._orig_delete
        credHelper.CONFIG_PATH = self._orig_config_path
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _mock_read_cred(self, target):
        return self.creds.get(target, None)

    def _mock_write_cred(self, target, data_str, user_name='antigravity'):
        self.creds[target] = str(data_str)
        return True

    def _mock_delete_cred(self, target):
        if target in self.creds:
            del self.creds[target]
            return True
        return False

    def seed_account(self, slot_num, email, token="mock_token"):
        payload = json.dumps({
            "token": f"{token}_{slot_num}",
            "email": email,
            "auth_method": "oauth"
        })
        target = credHelper.get_slot_target(slot_num)
        self.creds[target] = payload
        return payload

    def seed_active(self, slot_num=1):
        target = credHelper.get_slot_target(slot_num)
        if target in self.creds:
            self.creds[credHelper.TARGET_ACTIVE] = self.creds[target]
        cfg = self.read_config()
        cfg['activeSlot'] = slot_num
        self.write_config(cfg)

    def read_config(self):
        if os.path.exists(self.config_path):
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def write_config(self, cfg):
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)

def create_sandbox():
    return CredentialSandbox()
