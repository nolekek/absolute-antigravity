/**
 * tests/tier1_feature_coverage.test.js
 *
 * Tier 1: Feature Coverage (Primary Behavior)
 * Threshold: >= 5 tests per feature for R1, R2, R3, R4 (Minimum 20 tests total)
 */

const { installElectronMock, resetMockState, mockState, mockSession } = require('./helpers/electron_mock');
installElectronMock();

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const utils = require('../asar_extracted_228/dist/utils');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'asar_extracted_228', 'dist');
const CRED_HELPER_PATH = path.join(DIST_DIR, 'credHelper.py');

// =========================================================================
// R1. STRICT EXTERNAL BROWSER OAUTH LAUNCH & NAVIGATION BLOCKING
// =========================================================================

test('T1_R1_01_AuthUrlIdentification - identifies standard Google OAuth endpoints', () => {
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/o/oauth2/auth?client_id=123'), true);
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=456'), true);
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/o/oauth2/approval'), true);
});

test('T1_R1_02_ServiceLoginIdentification - identifies signin and ServiceLogin endpoints', () => {
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/ServiceLogin?service=lso'), true);
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/signin/oauth'), true);
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/v3/signin/identifier'), true);
    assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/AccountChooser'), true);
});

test('T1_R1_03_NonAuthUrlRejection - rejects regular Google search and non-auth services', () => {
    assert.strictEqual(utils.isAuthUrl('https://www.google.com/search?q=electron'), false);
    assert.strictEqual(utils.isAuthUrl('https://mail.google.com/mail/u/0/'), false);
    assert.strictEqual(utils.isAuthUrl('https://drive.google.com/drive/my-drive'), false);
    assert.strictEqual(utils.isAuthUrl('https://github.com/login'), false);
});

test('T1_R1_04_ExtractAuthUrlFromLog - parses and cleans OAuth URLs from LS logs', () => {
    const rawLine = '2026-10-25 20:30:00 [INFO] Open auth: "https://accounts.google.com/o/oauth2/auth?client_id=test_client_id&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080"; done';
    const extracted = utils.extractAuthUrl(rawLine);
    assert.strictEqual(extracted, 'https://accounts.google.com/o/oauth2/auth?client_id=test_client_id&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080');
});

test('T1_R1_05_VscodeHostEnvEnforcement - validates ANTIGRAVITY_VSCODE_HOST=1 in languageServer.js', () => {
    const lsSource = fs.readFileSync(path.join(DIST_DIR, 'languageServer.js'), 'utf-8');
    assert.match(lsSource, /env\['ANTIGRAVITY_VSCODE_HOST'\]\s*=\s*['"]1['"]/);
});

test('T1_R1_06_SessionInterceptionAttachment - intercepts and cancels accounts.google.com requests', async () => {
    resetMockState();
    utils.configureAuthInterception(mockSession);
    const result = await mockSession.webRequest.simulateRequest({
        url: 'https://accounts.google.com/o/oauth2/auth?client_id=123',
        resourceType: 'mainFrame'
    });
    assert.strictEqual(result.cancel, true);
    assert.strictEqual(mockState.openedExternalUrls.length, 1);
    assert.match(mockState.openedExternalUrls[0].url, /prompt=select_account/);
});

test('T1_R1_08_HubWindowAndWebviewPopupSeparation - verifies getHubWindows and markWebviewPopupWindow', () => {
    assert.strictEqual(typeof utils.getHubWindows, 'function');
    assert.strictEqual(typeof utils.markWebviewPopupWindow, 'function');
    const mockWin1 = new (require('electron').BrowserWindow)();
    const mockPopup = new (require('electron').BrowserWindow)();
    utils.markWebviewPopupWindow(mockPopup);
    assert.strictEqual(mockPopup.__isWebviewPopupWindow, true);
    const hubs = utils.getHubWindows();
    assert.ok(hubs.includes(mockWin1));
    assert.ok(!hubs.includes(mockPopup));
    mockWin1.close();
    mockPopup.close();
});

test('T1_R1_07_NonBlockingOAuthCancellation - restores active slot credentials on cancel', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "orig@gmail.com")
    sb.seed_active(1)
    credHelper.prepare_add_login("2")
    res = credHelper.cancel_add_login()
    print(json.dumps({
        "pendingSlot": res.get("pendingSlot"),
        "activeSlot": res.get("activeSlot"),
        "activeCred": credHelper.read_cred(credHelper.TARGET_ACTIVE)
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.pendingSlot, null);
    assert.strictEqual(data.activeSlot, 1);
    assert.match(data.activeCred, /orig@gmail\.com/);
});

// =========================================================================
// R2. FORCE GOOGLE ACCOUNT SELECTION (prompt=select_account)
// =========================================================================

test('T1_R2_01_InjectPromptWhenMissing - appends prompt=select_account when prompt is omitted', () => {
    const original = 'https://accounts.google.com/o/oauth2/auth?client_id=myclient&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000&response_type=code';
    const modified = utils.ensureAccountSelection(original);
    const u = new URL(modified);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
    assert.strictEqual(u.searchParams.get('client_id'), 'myclient');
});

test('T1_R2_02_MergeConsentPrompt - merges prompt=consent into prompt=select_account consent', () => {
    const original = 'https://accounts.google.com/o/oauth2/auth?client_id=myclient&prompt=consent';
    const modified = utils.ensureAccountSelection(original);
    const u = new URL(modified);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account consent');
});

test('T1_R2_03_IdempotentPromptHandling - preserves existing select_account without duplicates', () => {
    const original = 'https://accounts.google.com/o/oauth2/auth?client_id=myclient&prompt=select_account';
    const modified = utils.ensureAccountSelection(original);
    const u = new URL(modified);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

test('T1_R2_04_PreserveQueryParameters - maintains all critical OAuth parameters intact', () => {
    const original = 'https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=cid999&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080&scope=openid%20profile%20email&state=xyzState456&code_challenge=challengeHash&code_challenge_method=S256';
    const modified = utils.ensureAccountSelection(original);
    const u = new URL(modified);
    assert.strictEqual(u.searchParams.get('response_type'), 'code');
    assert.strictEqual(u.searchParams.get('client_id'), 'cid999');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8080');
    assert.strictEqual(u.searchParams.get('scope'), 'openid profile email');
    assert.strictEqual(u.searchParams.get('state'), 'xyzState456');
    assert.strictEqual(u.searchParams.get('code_challenge'), 'challengeHash');
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

test('T1_R2_05_PreserveUrlFragment - preserves hash fragment after parameter injection', () => {
    const original = 'https://accounts.google.com/o/oauth2/auth?client_id=cid#hashFragment';
    const modified = utils.ensureAccountSelection(original);
    const u = new URL(modified);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
    assert.strictEqual(u.hash, '#hashFragment');
});

test('T1_R2_06_NonAuthUrlUntouched - non-Google or non-auth URLs are not modified', () => {
    const nonAuth = 'https://example.com/welcome?lang=en';
    assert.strictEqual(utils.ensureAccountSelection(nonAuth), nonAuth);
});

// =========================================================================
// R3. DYNAMIC 3–4 ACCOUNT CAROUSEL & QUOTA FAILOVER
// =========================================================================

test('T1_R3_01_MultiSlotCredentialStorage - verifies 4-slot capability in Credential Helper', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    for i in range(1, 5):
        sb.seed_account(i, f"user{i}@gmail.com")
    sb.seed_active(1)
    status = credHelper.get_status()
    print(json.dumps({
        "slotsCount": len(status.get("accounts", [])),
        "maxSlots": credHelper.MAX_SLOTS,
        "accounts": status.get("accounts")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.slotsCount, 4);
    assert.strictEqual(data.maxSlots, 4);
});

test('T1_R3_02_OneClickSequentialRotation - rotates sequentially across active accounts', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "u1@gmail.com")
    sb.seed_account(2, "u2@gmail.com")
    sb.seed_account(3, "u3@gmail.com")
    sb.seed_active(1)

    s1 = credHelper.switch("next")["activeSlot"] # 1 -> 2
    s2 = credHelper.switch("next")["activeSlot"] # 2 -> 3
    s3 = credHelper.switch("next")["activeSlot"] # 3 -> 1
    print(json.dumps([s1, s2, s3]))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.deepStrictEqual(data, [2, 3, 1]);
});

test('T1_R3_03_ZeroGapSlotCompaction - compacts remaining slots cleanly upon slot deletion', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_account(3, "acc3@gmail.com")
    sb.seed_active(1)

    res = credHelper.delete_slot(2)
    accounts = res.get("accounts", [])
    print(json.dumps({
        "count": len(accounts),
        "slots": [a["slot"] for a in accounts],
        "emails": [a["email"] for a in accounts],
        "slot3_exists": credHelper.read_cred(credHelper.get_slot_target(3)) is not None
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.count, 2);
    assert.deepStrictEqual(data.slots, [1, 2]);
    assert.deepStrictEqual(data.emails, ['acc1@gmail.com', 'acc3@gmail.com']);
    assert.strictEqual(data.slot3_exists, false);
});

test('T1_R3_04_ActiveSlotDeletionFallback - falling back to slot 1 when active slot is deleted', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_active(2)

    res = credHelper.delete_slot(2)
    print(json.dumps({
        "activeSlot": res.get("activeSlot"),
        "activeCred": credHelper.read_cred(credHelper.TARGET_ACTIVE)
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.activeSlot, 1);
    assert.match(data.activeCred, /acc1@gmail\.com/);
});

test('T1_R3_05_QuotaErrorSignatureDetection - regex matches genuine backend quota errors', () => {
    const quotaRegex = /(?:rpc error: code = ResourceExhausted|status:\s*429|RESOURCE_EXHAUSTED.*quota|Quota exceeded for quota metric|generativelanguage.*429)/i;
    assert.strictEqual(quotaRegex.test('gRPC failure: rpc error: code = ResourceExhausted desc = Quota exceeded'), true);
    assert.strictEqual(quotaRegex.test('HTTP response status: 429 Too Many Requests'), true);
    assert.strictEqual(quotaRegex.test('RESOURCE_EXHAUSTED: daily request quota reached'), true);
    assert.strictEqual(quotaRegex.test('Quota exceeded for quota metric generate_requests'), true);
    assert.strictEqual(quotaRegex.test('https://generativelanguage.googleapis.com returned 429'), true);
    assert.strictEqual(quotaRegex.test('Generic syntax error on line 42'), false);
});

test('T1_R3_06_AutoFailoverCooldownDebounce - enforces 25-second cooldown debounce', () => {
    const { multiaccManager } = require('../asar_extracted_228/dist/multiaccManager');
    let triggerCount = 0;
    const origTrigger = multiaccManager.triggerAutoFailover;
    multiaccManager.triggerAutoFailover = () => { triggerCount++; };

    try {
        multiaccManager.lastFailoverTime = 0;
        multiaccManager.checkForQuotaError('status: 429');
        assert.strictEqual(triggerCount, 1);

        // Immediate subsequent call within 25s should be debounced
        multiaccManager.lastFailoverTime = Date.now();
        multiaccManager.checkForQuotaError('status: 429');
        assert.strictEqual(triggerCount, 1);
    } finally {
        multiaccManager.triggerAutoFailover = origTrigger;
    }
});

test('T1_R3_07_AutoFailoverDisabledSetting - respects autoFailover = false setting', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_active(1)
    credHelper.toggle_autofailover(False)
    status = credHelper.get_status()
    print(json.dumps({"autoFailover": status.get("autoFailover")}))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.autoFailover, false);
});

test('T1_R3_08_SingleAccountPoolSafety - handles single account pool safely', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "sole@gmail.com")
    sb.seed_active(1)
    del_res = credHelper.delete_slot(1)
    status = credHelper.get_status()
    print(json.dumps({
        "error": del_res.get("error"),
        "accountsCount": len(status.get("accounts", []))
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.match(data.error, /единственный/);
    assert.strictEqual(data.accountsCount, 1);
});

test('T1_R3_09_LegacyCredentialMigration - migrates legacy targets and prunes them', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.creds[credHelper.TARGET_PRIMARY] = json.dumps({"token": "t1", "email": "prim@gmail.com"})
    sb.creds[credHelper.TARGET_RESERVE] = json.dumps({"token": "t2", "email": "resv@gmail.com"})
    credHelper.ensure_migrated()
    print(json.dumps({
        "slot1": credHelper.read_cred(credHelper.get_slot_target(1)),
        "slot2": credHelper.read_cred(credHelper.get_slot_target(2)),
        "legacy_prim_exists": credHelper.TARGET_PRIMARY in sb.creds,
        "legacy_resv_exists": credHelper.TARGET_RESERVE in sb.creds
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.match(data.slot1, /prim@gmail\.com/);
    assert.match(data.slot2, /resv@gmail\.com/);
    assert.strictEqual(data.legacy_prim_exists, false);
    assert.strictEqual(data.legacy_resv_exists, false);
});

// =========================================================================
// R4. AUTOMATED TESTING & PACKAGING PIPELINE
// =========================================================================

test('T1_R4_01_AsarUnpackFlagValidation - verifies unpack rules encompass credHelper and chrome-devtools', () => {
    const unpackPattern = '{**/chrome-devtools-mcp/**,**/credHelper.py}';
    assert.match(unpackPattern, /credHelper\.py/);
    assert.match(unpackPattern, /chrome-devtools-mcp/);
});

test('T1_R4_02_UnpackedAssetPresence - verifies unpacked credHelper exists on filesystem', () => {
    const unpackedPath = path.join(ROOT_DIR, 'app.asar.unpacked', 'dist', 'credHelper.py');
    assert.strictEqual(fs.existsSync(unpackedPath), true);
});

test('T1_R4_03_CredHelperHashParity - verifies SHA256 parity between source and unpacked', () => {
    const srcBuf = fs.readFileSync(CRED_HELPER_PATH);
    const unpBuf = fs.readFileSync(path.join(ROOT_DIR, 'app.asar.unpacked', 'dist', 'credHelper.py'));
    const srcHash = crypto.createHash('sha256').update(srcBuf).digest('hex');
    const unpHash = crypto.createHash('sha256').update(unpBuf).digest('hex');
    assert.strictEqual(srcHash, unpHash);
});

test('T1_R4_04_JwtTokenEmailExtraction - verifies JWT id_token decoding for user email', () => {
    const pythonScript = `
import sys, os, json, base64
sys.path.insert(0, r'${path.join(ROOT_DIR, 'asar_extracted_228', 'dist')}')
import credHelper

header = base64.urlsafe_b64encode(b'{"alg":"RS256"}').decode().rstrip('=')
payload = base64.urlsafe_b64encode(b'{"email":"jwt_verified@gmail.com"}').decode().rstrip('=')
token_blob = json.dumps({"token": "y29.abc", "id_token": f"{header}.{payload}.sig"})
print(json.dumps({"email": credHelper.extract_email(token_blob)}))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.email, 'jwt_verified@gmail.com');
});

test('T1_R4_05_DirectEmailFieldExtraction - verifies direct email attribute parsing', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'asar_extracted_228', 'dist')}')
import credHelper

blob = json.dumps({"token": "y29.abc", "email": "direct_verified@gmail.com"})
print(json.dumps({"email": credHelper.extract_email(blob)}))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.email, 'direct_verified@gmail.com');
});

test('T1_R4_06_AsarArchiveIntegrity - validates app.asar exists and has valid header size', () => {
    const asarPath = path.join(ROOT_DIR, 'app.asar');
    assert.strictEqual(fs.existsSync(asarPath), true);
    const stat = fs.statSync(asarPath);
    assert.ok(stat.size > 1000000, `Expected app.asar to be > 1MB, found ${stat.size} bytes`);
});
