/**
 * tests/tier3_cross_feature.test.js
 *
 * Tier 3: Cross-Feature Combinations (Pairwise Interactions)
 * Verifies complex interactions between OAuth, Credential Storage, Carousel Switching,
 * Auto-Failover, PAC Proxy, and Legacy Migration.
 */

const { installElectronMock, resetMockState, mockState } = require('./helpers/electron_mock');
installElectronMock();

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const utils = require('../asar_extracted_228/dist/utils');

const ROOT_DIR = path.resolve(__dirname, '..');

// =========================================================================
// PAIR 1: Switch Profile / Cancel during In-Progress OAuth Login
// =========================================================================

test('T3_PAIR_01_SwitchDuringAddLogin - restores previous active credential and cleans pending state', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # 1. Start with 2 accounts, slot 1 active
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_active(1)

    # 2. User starts adding account 3 (OAuth initiated)
    prep = credHelper.prepare_add_login("3")
    assert credHelper.read_cred(credHelper.TARGET_ACTIVE) is None, "TARGET_ACTIVE must be deleted during add"
    assert prep.get("pendingSlot") == 3

    # 3. User aborts / switches profile before OAuth finishes
    res = credHelper.cancel_add_login()
    active_now = credHelper.read_cred(credHelper.TARGET_ACTIVE)

    # 4. Now perform switch to slot 2
    sw_res = credHelper.switch("2")

    print(json.dumps({
        "pendingSlot": res.get("pendingSlot"),
        "restoredActive": "acc1@gmail.com" in active_now,
        "switchedActiveSlot": sw_res.get("activeSlot"),
        "activeEmail": sw_res.get("currentEmail")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.pendingSlot, null);
    assert.strictEqual(data.restoredActive, true);
    assert.strictEqual(data.switchedActiveSlot, 2);
    assert.strictEqual(data.activeEmail, 'acc2@gmail.com');
});

// =========================================================================
// PAIR 2: Backend 429 Quota Error during Slot Compaction
// =========================================================================

test('T3_PAIR_02_QuotaFailoverDuringCompaction - calculates failover target against freshly compacted list', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # 3 accounts: 1, 2, 3. Slot 2 is active.
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_account(3, "acc3@gmail.com")
    sb.seed_active(2)

    # Delete active slot 2 -> slot 1 becomes active, slot 3 compacted to slot 2
    status_after_del = credHelper.delete_slot(2)
    accounts = status_after_del.get("accounts", [])
    active_slot = status_after_del.get("activeSlot")

    # Simulate quota failover logic from multiaccManager:
    # find current slot index, advance (currentIndex + 1) % accounts.length
    current_idx = next(i for i, a in enumerate(accounts) if a["slot"] == active_slot)
    next_idx = (current_idx + 1) % len(accounts)
    next_account = accounts[next_idx]

    # Perform switch to next_account.slot
    sw_res = credHelper.switch(str(next_account["slot"]))

    print(json.dumps({
        "compactedCount": len(accounts),
        "postDelActiveSlot": active_slot,
        "failoverTargetSlot": next_account["slot"],
        "failoverTargetEmail": next_account["email"],
        "finalActiveSlot": sw_res.get("activeSlot")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.compactedCount, 2);
    assert.strictEqual(data.postDelActiveSlot, 1);
    assert.strictEqual(data.failoverTargetSlot, 2); // Compacted account 3 is now slot 2
    assert.strictEqual(data.failoverTargetEmail, 'acc3@gmail.com');
    assert.strictEqual(data.finalActiveSlot, 2);
});

// =========================================================================
// PAIR 3: Background Token Refresh Synchronization during Carousel Rotation
// =========================================================================

test('T3_PAIR_03_TokenRefreshDuringRotation - saves LS background token refresh to slot before rotation', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # Start with 2 accounts, slot 1 active with initial token
    sb.seed_account(1, "acc1@gmail.com", token="initial_token_1")
    sb.seed_account(2, "acc2@gmail.com", token="initial_token_2")
    sb.seed_active(1)

    # Language Server refreshes token in background, writing to TARGET_ACTIVE directly
    refreshed_blob = json.dumps({
        "token": "refreshed_ya29.NEW_LIVE_TOKEN_XYZ",
        "email": "acc1@gmail.com",
        "auth_method": "oauth"
    })
    sb.creds[credHelper.TARGET_ACTIVE] = refreshed_blob

    # User clicks rotation: switch("next")
    credHelper.switch("next")

    # Verify slot 1 in storage captured the refreshed token before activating slot 2!
    slot1_saved = credHelper.read_cred(credHelper.get_slot_target(1))
    active_now = credHelper.read_cred(credHelper.TARGET_ACTIVE)

    print(json.dumps({
        "slot1CapturedRefresh": "NEW_LIVE_TOKEN_XYZ" in slot1_saved,
        "activeIsNowSlot2": "acc2@gmail.com" in active_now
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.slot1CapturedRefresh, true);
    assert.strictEqual(data.activeIsNowSlot2, true);
});

// =========================================================================
// PAIR 4: Session PAC Proxy Configuration preserving Auth Interception
// =========================================================================

test('T3_PAIR_04_PacProxyInterceptionPreservation - proxy config does not wipe auth interception', async () => {
    resetMockState();
    const beyondcorpPac = require('../asar_extracted_228/dist/beyondcorpPac');

    const testWebviewSession = {
        webRequest: {
            _filter: null,
            _listener: null,
            onBeforeRequest(filter, listener) {
                if (filter === null) {
                    this._filter = null;
                    this._listener = null;
                    return;
                }
                this._filter = filter;
                this._listener = listener;
            }
        },
        setProxy: async () => Promise.resolve()
    };

    // 1. Initial auth interception configured
    utils.configureAuthInterception(testWebviewSession);
    assert.deepStrictEqual(testWebviewSession.webRequest._filter, { urls: ['*://accounts.google.com/*'] });

    // 2. PAC proxy configured on webview session
    const configurator = beyondcorpPac.createWebviewProxyConfigurator(() => 'data:text/javascript;base64,ZHVtbXk=');
    await configurator(testWebviewSession);

    // 3. Verify onBeforeRequest listener and filter remain intact
    assert.notStrictEqual(testWebviewSession.webRequest._listener, null, 'Listener must NOT be null');
    assert.deepStrictEqual(testWebviewSession.webRequest._filter, { urls: ['*://accounts.google.com/*'] });

    // 4. Test request interception continues to work
    let interceptedResult = null;
    testWebviewSession.webRequest._listener({
        url: 'https://accounts.google.com/o/oauth2/auth?client_id=pac_test',
        resourceType: 'mainFrame'
    }, (res) => { interceptedResult = res; });

    assert.deepStrictEqual(interceptedResult, { cancel: true });
    assert.ok(mockState.openedExternalUrls.some(u => u.url.includes('pac_test')));
});

// =========================================================================
// PAIR 5: Legacy Migration with Active Multi-Slot Carousel
// =========================================================================

test('T3_PAIR_05_MigrationWithActiveMultiSlotCarousel - migration does not overwrite populated slots', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # Existing 3 accounts in slots 1, 2, 3
    sb.seed_account(1, "existing1@gmail.com")
    sb.seed_account(2, "existing2@gmail.com")
    sb.seed_account(3, "existing3@gmail.com")
    sb.seed_active(1)

    # Some old legacy keys linger in Credential Manager
    sb.creds[credHelper.TARGET_PRIMARY] = json.dumps({"token": "old", "email": "zombie_primary@gmail.com"})
    sb.creds[credHelper.TARGET_RESERVE] = json.dumps({"token": "old", "email": "zombie_reserve@gmail.com"})

    # Run migration
    credHelper.ensure_migrated()

    # Verify existing slots are PRESERVED and NOT overwritten by zombie legacy keys
    slot1 = credHelper.read_cred(credHelper.get_slot_target(1))
    slot2 = credHelper.read_cred(credHelper.get_slot_target(2))

    # Verify legacy keys were pruned
    prim_pruned = credHelper.TARGET_PRIMARY not in sb.creds
    resv_pruned = credHelper.TARGET_RESERVE not in sb.creds

    print(json.dumps({
        "slot1Preserved": "existing1@gmail.com" in slot1,
        "slot2Preserved": "existing2@gmail.com" in slot2,
        "primaryPruned": prim_pruned,
        "reservePruned": resv_pruned
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.slot1Preserved, true);
    assert.strictEqual(data.slot2Preserved, true);
    assert.strictEqual(data.primaryPruned, true);
    assert.strictEqual(data.reservePruned, true);
});

// =========================================================================
// PAIR 6: Circular Failover from Final Slot (Slot 4) to Slot 1
// =========================================================================

test('T3_PAIR_06_EndSlotCircularFailover - quota error on slot 4 wraps cleanly around to slot 1', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # 4 accounts fully populated
    for i in range(1, 5):
        sb.seed_account(i, f"user{i}@gmail.com")
    # Slot 4 is active
    sb.seed_active(4)

    status = credHelper.get_status()
    accounts = status.get("accounts", [])
    active_slot = status.get("activeSlot")

    # Round-robin formula: (currentIndex + 1) % len(accounts)
    current_idx = next(i for i, a in enumerate(accounts) if a["slot"] == active_slot)
    next_idx = (current_idx + 1) % len(accounts)
    next_slot = accounts[next_idx]["slot"]

    sw_res = credHelper.switch(str(next_slot))

    print(json.dumps({
        "startSlot": active_slot,
        "nextSlot": next_slot,
        "finalActiveSlot": sw_res.get("activeSlot"),
        "finalActiveEmail": sw_res.get("currentEmail")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.startSlot, 4);
    assert.strictEqual(data.nextSlot, 1);
    assert.strictEqual(data.finalActiveSlot, 1);
    assert.strictEqual(data.finalActiveEmail, 'user1@gmail.com');
});
