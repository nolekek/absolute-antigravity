/**
 * tests/tier4_real_world.test.js
 *
 * Tier 4: Real-World Application Scenarios
 * Threshold: >= 5 complete end-to-end multi-account lifecycle scenarios.
 */

const { installElectronMock, resetMockState, mockState } = require('./helpers/electron_mock');
installElectronMock();

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const utils = require('../asar_extracted_228/dist/utils');

const ROOT_DIR = path.resolve(__dirname, '..');

// =========================================================================
// SCENARIO 1: Full 4-Account Setup & Round-Robin Lifecycle
// =========================================================================

test('T4_SCEN_01_Full4AccountLifecycle - end-to-end setup of 4 accounts and complete rotation cycle', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # 1. First account initial login
    sb.seed_account(1, "alice@gmail.com")
    sb.seed_active(1)
    st1 = credHelper.get_status()
    assert len(st1.get("accounts", [])) == 1

    # 2. Add second account (Bob)
    credHelper.prepare_add_login("2")
    sb.creds[credHelper.TARGET_ACTIVE] = json.dumps({"token": "bob_tok", "email": "bob@gmail.com"})
    credHelper.finalize_add_login("2")
    st2 = credHelper.get_status()
    assert len(st2.get("accounts", [])) == 2

    # 3. Add third account (Charlie)
    credHelper.prepare_add_login("3")
    sb.creds[credHelper.TARGET_ACTIVE] = json.dumps({"token": "charlie_tok", "email": "charlie@gmail.com"})
    credHelper.finalize_add_login("3")
    st3 = credHelper.get_status()
    assert len(st3.get("accounts", [])) == 3

    # 4. Add fourth account (Dana)
    credHelper.prepare_add_login("4")
    sb.creds[credHelper.TARGET_ACTIVE] = json.dumps({"token": "dana_tok", "email": "dana@gmail.com"})
    credHelper.finalize_add_login("4")
    st4 = credHelper.get_status()
    assert len(st4.get("accounts", [])) == 4

    # 5. Execute 1-click rotation: 1 -> 2 -> 3 -> 4 -> 1
    r1 = credHelper.switch("next")["activeSlot"] # 2
    r2 = credHelper.switch("next")["activeSlot"] # 3
    r3 = credHelper.switch("next")["activeSlot"] # 4
    r4 = credHelper.switch("next")["activeSlot"] # 1

    print(json.dumps({
        "accountEmails": [a["email"] for a in st4.get("accounts", [])],
        "rotationPath": [r1, r2, r3, r4],
        "finalActiveEmail": credHelper.get_status().get("currentEmail")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.deepStrictEqual(data.accountEmails, ['alice@gmail.com', 'bob@gmail.com', 'charlie@gmail.com', 'dana@gmail.com']);
    assert.deepStrictEqual(data.rotationPath, [2, 3, 4, 1]);
    assert.strictEqual(data.finalActiveEmail, 'alice@gmail.com');
});

// =========================================================================
// SCENARIO 2: Middle-Slot Deletion & Zero-Gap Compaction
// =========================================================================

test('T4_SCEN_02_MiddleSlotDeletionCompaction - 4 accounts delete middle slot 2 compacting to slots 1, 2, 3', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    emails = ["u1@gmail.com", "u2@gmail.com", "u3@gmail.com", "u4@gmail.com"]
    for i, email in enumerate(emails, 1):
        sb.seed_account(i, email)
    sb.seed_active(1)

    # Delete slot 2 (u2@gmail.com)
    del_res = credHelper.delete_slot(2)
    accounts = del_res.get("accounts", [])

    # Check physical credential targets in storage
    s1 = credHelper.read_cred(credHelper.get_slot_target(1))
    s2 = credHelper.read_cred(credHelper.get_slot_target(2))
    s3 = credHelper.read_cred(credHelper.get_slot_target(3))
    s4 = credHelper.read_cred(credHelper.get_slot_target(4))

    print(json.dumps({
        "count": len(accounts),
        "accounts": accounts,
        "slot1_email": credHelper.extract_email(s1),
        "slot2_email": credHelper.extract_email(s2),
        "slot3_email": credHelper.extract_email(s3),
        "slot4_exists": s4 is not None
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.count, 3);
    assert.strictEqual(data.slot1_email, 'u1@gmail.com');
    assert.strictEqual(data.slot2_email, 'u3@gmail.com'); // Old slot 3 moved to slot 2
    assert.strictEqual(data.slot3_email, 'u4@gmail.com'); // Old slot 4 moved to slot 3
    assert.strictEqual(data.slot4_exists, false); // Slot 4 deleted
});

// =========================================================================
// SCENARIO 3: Active Slot Deletion & Auto-Activation of Slot 1
// =========================================================================

test('T4_SCEN_03_ActiveSlotDeletionCompaction - deleting active slot activates slot 1 and re-syncs active target', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "main@gmail.com")
    sb.seed_account(2, "to_delete@gmail.com")
    sb.seed_account(3, "reserve@gmail.com")
    # Slot 2 is currently active
    sb.seed_active(2)

    del_res = credHelper.delete_slot(2)
    active_slot = del_res.get("activeSlot")
    active_cred = credHelper.read_cred(credHelper.TARGET_ACTIVE)

    print(json.dumps({
        "newActiveSlot": active_slot,
        "newActiveEmail": credHelper.extract_email(active_cred),
        "remainingAccounts": [a["email"] for a in del_res.get("accounts", [])]
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.newActiveSlot, 1);
    assert.strictEqual(data.newActiveEmail, 'main@gmail.com');
    assert.deepStrictEqual(data.remainingAccounts, ['main@gmail.com', 'reserve@gmail.com']);
});

// =========================================================================
// SCENARIO 4: Burst Backend Quota Exhaustion & Debounced Auto-Failover
// =========================================================================

test('T4_SCEN_04_BurstQuotaExhaustionDebounce - burst of 10 errors triggers exactly 1 failover, 2nd after 26s', () => {
    const { multiaccManager } = require('../asar_extracted_228/dist/multiaccManager');
    const triggeredFailovers = [];

    const origTrigger = multiaccManager.triggerAutoFailover;
    multiaccManager.triggerAutoFailover = (src) => {
        multiaccManager.lastFailoverTime = Date.now();
        triggeredFailovers.push({ src, time: Date.now() });
    };

    try {
        let currentTime = 1700000000000;
        const origNow = Date.now;
        Date.now = () => currentTime;

        multiaccManager.lastFailoverTime = 0;

        // Burst of 10 error lines within 500ms
        const burstErrors = [
            '2026-10-25 20:30:00 [ERROR] rpc error: code = ResourceExhausted desc = Quota exceeded',
            '2026-10-25 20:30:00 [ERROR] status: 429 Too Many Requests',
            '2026-10-25 20:30:00 [ERROR] RESOURCE_EXHAUSTED: daily limit',
            '2026-10-25 20:30:00 [ERROR] Quota exceeded for quota metric generate_requests',
            '2026-10-25 20:30:00 [ERROR] status: 429',
            '2026-10-25 20:30:00 [ERROR] rpc error: code = ResourceExhausted',
            '2026-10-25 20:30:00 [ERROR] RESOURCE_EXHAUSTED',
            '2026-10-25 20:30:00 [ERROR] status: 429',
            '2026-10-25 20:30:00 [ERROR] generativelanguage 429',
            '2026-10-25 20:30:00 [ERROR] status: 429'
        ];

        for (const errLine of burstErrors) {
            currentTime += 50; // +50ms per line
            multiaccManager.checkForQuotaError(errLine);
        }

        assert.strictEqual(triggeredFailovers.length, 1, 'Burst of 10 errors must trigger only ONE failover');

        // Advance time by 26 seconds (past 25s debounce cooldown)
        currentTime += 26000;
        multiaccManager.checkForQuotaError('2026-10-25 20:30:26 [ERROR] status: 429');

        assert.strictEqual(triggeredFailovers.length, 2, 'New error after cooldown must trigger second failover');

        Date.now = origNow;
    } finally {
        multiaccManager.triggerAutoFailover = origTrigger;
    }
});

// =========================================================================
// SCENARIO 5: Aborted Account Addition with Full State Recovery
// =========================================================================

test('T4_SCEN_05_AbortedAddLoginRecovery - cancels in-progress add and restores active credentials without lockup', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # 2 accounts, slot 2 active
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_active(2)

    # 1. User clicks "+ Добавить" (prepare-add-login for slot 3)
    prep = credHelper.prepare_add_login("3")
    assert prep.get("pendingSlot") == 3
    assert credHelper.read_cred(credHelper.TARGET_ACTIVE) is None

    # 2. User clicks "⏳ Отмена" (cancel-add-login)
    canc = credHelper.cancel_add_login()

    # 3. Check restored state
    active_now = credHelper.read_cred(credHelper.TARGET_ACTIVE)

    print(json.dumps({
        "pendingSlot": canc.get("pendingSlot"),
        "activeSlot": canc.get("activeSlot"),
        "activeEmail": credHelper.extract_email(active_now),
        "accountsCount": len(canc.get("accounts", []))
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.pendingSlot, null);
    assert.strictEqual(data.activeSlot, 2);
    assert.strictEqual(data.activeEmail, 'acc2@gmail.com');
    assert.strictEqual(data.accountsCount, 2);
});

// =========================================================================
// SCENARIO 6: End-to-End Packaging & Unpack Parity Verification
// =========================================================================

test('T4_SCEN_06_PackagingAndUnpackParity - packs asar with unpack rules and verifies unpack extraction', () => {
    const tempAsarPath = path.join(ROOT_DIR, 'temp_test_pack.asar');
    const tempUnpackedDir = path.join(ROOT_DIR, 'temp_test_pack.asar.unpacked');

    try {
        // Run asar pack with exact unpack pattern via shell
        spawnSync('npx asar pack asar_extracted_228 temp_test_pack.asar --unpack "{**/chrome-devtools-mcp/**,**/credHelper.py}"', {
            shell: true,
            cwd: ROOT_DIR,
            encoding: 'utf-8',
            timeout: 60000
        });

        // Verify ASAR archive created
        assert.ok(fs.existsSync(tempAsarPath), 'ASAR file should be generated');
        const asarStat = fs.statSync(tempAsarPath);
        assert.ok(asarStat.size > 1000000, 'Packaged ASAR should be > 1MB');

        // Verify unpacked credHelper.py exists in unpacked directory
        const unpackedCredHelper = path.join(tempUnpackedDir, 'dist', 'credHelper.py');
        assert.ok(fs.existsSync(unpackedCredHelper), 'credHelper.py must exist outside ASAR in unpacked dir');

        // Verify bit-for-bit SHA256 parity with source
        const srcHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT_DIR, 'asar_extracted_228', 'dist', 'credHelper.py'))).digest('hex');
        const unpHash = crypto.createHash('sha256').update(fs.readFileSync(unpackedCredHelper)).digest('hex');
        assert.strictEqual(unpHash, srcHash, 'Unpacked credHelper.py must match source exactly');

    } finally {
        // Cleanup temporary test files
        if (fs.existsSync(tempAsarPath)) fs.unlinkSync(tempAsarPath);
        if (fs.existsSync(tempUnpackedDir)) fs.rmSync(tempUnpackedDir, { recursive: true, force: true });
    }
});
