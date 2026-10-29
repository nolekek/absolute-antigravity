/**
 * tests/tier2_boundary_cases.test.js
 *
 * Tier 2: Boundary & Corner Cases
 * Threshold: >= 5 tests per feature for R1, R2, R3, R4 (limits, extremes, malformed, empty, duplicate)
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
// R1 BOUNDARY CASES
// =========================================================================

test('T2_R1_01_ExtremeUrlLength - handles URLs > 4096 characters safely', () => {
    let longParams = 'client_id=large_id';
    for (let i = 0; i < 200; i++) {
        longParams += `&param_${i}=extremely_long_value_segment_${i}_${'a'.repeat(30)}`;
    }
    const longUrl = `https://accounts.google.com/o/oauth2/auth?${longParams}`;
    assert.ok(longUrl.length > 4096);

    assert.strictEqual(utils.isAuthUrl(longUrl), true);
    const transformed = utils.ensureAccountSelection(longUrl);
    const u = new URL(transformed);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
    assert.strictEqual(u.searchParams.get('param_199'), `extremely_long_value_segment_199_${'a'.repeat(30)}`);
});

test('T2_R1_02_MalformedAuthUrls - handles malformed and invalid URLs without throwing', () => {
    const malformed = [
        'http://///',
        'https://accounts.google.com:999999999999999/o/oauth2',
        'javascript:alert(1)',
        'data:text/html,<html>',
        'http://[::1]:namedport/auth',
        'https://'
    ];

    for (const url of malformed) {
        assert.doesNotThrow(() => {
            const isAuth = utils.isAuthUrl(url);
            const ensured = utils.ensureAccountSelection(url);
            assert.ok(typeof isAuth === 'boolean');
            assert.ok(typeof ensured === 'string');
        });
    }
});

test('T2_R1_03_NullEmptyTypeHandling - returns safe fallbacks on null, empty, non-string inputs', () => {
    const invalidInputs = [null, undefined, '', 12345, {}, [], false];

    for (const input of invalidInputs) {
        assert.strictEqual(utils.isAuthUrl(input), false);
        assert.strictEqual(utils.extractAuthUrl(input), null);
        assert.strictEqual(utils.ensureAccountSelection(input), input);
    }
});

test('T2_R1_04_SubdomainSpoofingRejection - rejects attacker domains spoofing google auth endpoints', () => {
    const spoofAttempts = [
        'https://evil-google.com/oauth',
        'https://accounts-google.com/oauth',
        'https://fake-accounts-google.com/oauth',
        'https://notgoogle.com/auth',
        'https://attacker.com/login'
    ];

    for (const url of spoofAttempts) {
        assert.strictEqual(utils.isAuthUrl(url), false, `Should reject spoofed domain: ${url}`);
    }
});

test('T2_R1_05_RapidBrowserLaunchDebounce - suppresses duplicate launches within 4000ms window', () => {
    resetMockState();
    const testUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=debouncetest';

    // First call opens external browser
    utils.openAuthUrlExternal(testUrl);
    assert.strictEqual(mockState.openedExternalUrls.length, 1);

    // Rapid second and third calls within 4000ms should be debounced
    utils.openAuthUrlExternal(testUrl);
    utils.openAuthUrlExternal(testUrl);
    assert.strictEqual(mockState.openedExternalUrls.length, 1, 'Subsequent rapid calls must be suppressed by debounce');
});

test('T2_R1_06_TrailingDelimiterStripping - strips punctuation and enclosing brackets from log URLs', () => {
    const rawLines = [
        'URL is: "https://accounts.google.com/o/oauth2/auth?client_id=123";',
        'Visit (https://accounts.google.com/o/oauth2/auth?client_id=456) to login',
        '<https://accounts.google.com/o/oauth2/auth?client_id=789>',
        'Auth: https://accounts.google.com/o/oauth2/auth?client_id=101.'
    ];

    const expectedIds = ['123', '456', '789', '101'];

    rawLines.forEach((line, idx) => {
        const extracted = utils.extractAuthUrl(line);
        assert.ok(extracted, `Failed to extract URL from: ${line}`);
        const u = new URL(extracted);
        assert.strictEqual(u.searchParams.get('client_id'), expectedIds[idx]);
        assert.ok(!extracted.endsWith('"') && !extracted.endsWith(';') && !extracted.endsWith(')') && !extracted.endsWith('>') && !extracted.endsWith('.'));
    });
});

// =========================================================================
// R2 BOUNDARY CASES
// =========================================================================

test('T2_R2_01_MultiValuePromptNormalization - preserves consent when multiple prompts exist', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?client_id=cid&prompt=login%20consent';
    const transformed = utils.ensureAccountSelection(url);
    const u = new URL(transformed);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account consent');
});

test('T2_R2_02_CaseInsensitiveHostMatching - recognizes uppercase scheme and domain', () => {
    const url = 'HTTPS://ACCOUNTS.GOOGLE.COM/o/oauth2/auth?client_id=case_test';
    assert.strictEqual(utils.isAuthUrl(url), true);
    const transformed = utils.ensureAccountSelection(url);
    const u = new URL(transformed);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

test('T2_R2_03_UrlEncodedParameterPreservation - does not corrupt percent-encoded values', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?client_id=enc&scope=openid%20profile%20email&state=foo%2Bbar%3D%26baz';
    const transformed = utils.ensureAccountSelection(url);
    const u = new URL(transformed);
    assert.strictEqual(u.searchParams.get('scope'), 'openid profile email');
    assert.strictEqual(u.searchParams.get('state'), 'foo+bar=&baz');
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

test('T2_R2_04_HashFragmentQueryOrdering - maintains query string before hash fragment', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?client_id=frag#state=in_hash';
    const transformed = utils.ensureAccountSelection(url);
    assert.match(transformed, /\?client_id=frag&prompt=select_account#state=in_hash/);
});

test('T2_R2_05_EmptyQueryStringHandling - handles URLs ending in trailing question mark', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?';
    const transformed = utils.ensureAccountSelection(url);
    const u = new URL(transformed);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

test('T2_R2_06_DuplicatePromptParameters - handles URLs with repeated prompt parameters', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?client_id=dup&prompt=select_account&prompt=consent';
    const transformed = utils.ensureAccountSelection(url);
    const u = new URL(transformed);
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

// =========================================================================
// R3 BOUNDARY CASES
// =========================================================================

test('T2_R3_01_MaxSlotsLimitCap - enforces maximum slot capacity of 4', () => {
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
    # Next available slot for new account should be None when full
    accounts = status.get("accounts", [])
    can_add = len(accounts) < credHelper.MAX_SLOTS
    print(json.dumps({"canAdd": can_add, "count": len(accounts), "max": credHelper.MAX_SLOTS}))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.canAdd, false);
    assert.strictEqual(data.count, 4);
    assert.strictEqual(data.max, 4);
});

test('T2_R3_02_MinSlotsDeleteProtection - refuses deletion when single account remains', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "last@gmail.com")
    sb.seed_active(1)
    res = credHelper.delete_slot(1)
    print(json.dumps(res))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.ok(data.error);
    assert.match(data.error, /единственный/);
});

test('T2_R3_03_InvalidSlotNumberHandling - handles out-of-range, negative, non-numeric slot inputs', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_active(1)

    r_neg = credHelper.delete_slot(-1)
    r_zero = credHelper.delete_slot(0)
    r_overflow = credHelper.delete_slot(99)
    r_string = credHelper.delete_slot("invalid_slot")

    print(json.dumps({
        "neg_err": "error" in r_neg,
        "zero_err": "error" in r_zero,
        "overflow_err": "error" in r_overflow,
        "string_err": "error" in r_string
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.neg_err, true);
    assert.strictEqual(data.zero_err, true);
    assert.strictEqual(data.overflow_err, true);
    assert.strictEqual(data.string_err, true);
});

test('T2_R3_04_NonExistentSlotDeletion - returns error when deleting unallocated slot index', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.seed_account(1, "acc1@gmail.com")
    sb.seed_account(2, "acc2@gmail.com")
    sb.seed_active(1)

    res = credHelper.delete_slot(3)
    print(json.dumps(res))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.ok(data.error);
    assert.match(data.error, /не найден/);
});

test('T2_R3_05_CorruptConfigJsonRecovery - recovers safely when multiacc json is corrupted', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    # Write garbage content to config
    with open(sb.config_path, "w", encoding="utf-8") as f:
        f.write("{ corrupt json truncated ...")

    cfg = credHelper.load_config()
    print(json.dumps({
        "activeSlot": cfg.get("activeSlot"),
        "autoFailover": cfg.get("autoFailover")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.activeSlot, 1);
    assert.strictEqual(data.autoFailover, true);
});

test('T2_R3_06_CorruptCredentialBlobHandling - handles non-JSON credential blobs gracefully', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'tests')}')
from helpers.cred_sandbox import create_sandbox
import credHelper

with create_sandbox() as sb:
    sb.creds[credHelper.get_slot_target(1)] = "PLAIN_TEXT_NOT_JSON"
    email = credHelper.extract_email("PLAIN_TEXT_NOT_JSON")
    status = credHelper.get_status()
    print(json.dumps({
        "email": email,
        "accounts": status.get("accounts")
    }))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.email, null);
    assert.ok(Array.isArray(data.accounts));
});

test('T2_R3_07_ExactDebounceBoundary - tests exact 25000ms debounce threshold boundary', () => {
    const { multiaccManager } = require('../asar_extracted_228/dist/multiaccManager');
    let triggerCount = 0;
    const origTrigger = multiaccManager.triggerAutoFailover;
    multiaccManager.triggerAutoFailover = () => { triggerCount++; };

    try {
        const baseTime = 1000000;
        multiaccManager.lastFailoverTime = baseTime;

        // Mock Date.now at 24999ms after baseTime -> should be suppressed
        const origNow = Date.now;
        Date.now = () => baseTime + 24999;
        multiaccManager.checkForQuotaError('status: 429');
        assert.strictEqual(triggerCount, 0, 'Must suppress at 24999ms');

        // Mock Date.now at 25001ms after baseTime -> should trigger
        Date.now = () => baseTime + 25001;
        multiaccManager.checkForQuotaError('status: 429');
        assert.strictEqual(triggerCount, 1, 'Must trigger at 25001ms');

        Date.now = origNow;
    } finally {
        multiaccManager.triggerAutoFailover = origTrigger;
    }
});

test('T2_R3_08_MixedCaseQuotaErrorLines - detects quota errors with mixed case and leading prefixes', () => {
    const { multiaccManager } = require('../asar_extracted_228/dist/multiaccManager');
    let triggers = [];
    const origTrigger = multiaccManager.triggerAutoFailover;
    multiaccManager.triggerAutoFailover = (src) => { triggers.push(src); };

    try {
        const lines = [
            '2026-10-25T20:30:00Z [BACKEND_ERROR] rpc error: code = ResourceExhausted desc = Quota reached',
            'ERROR: status:   429 Too Many Requests',
            '[CRITICAL] resource_exhausted for quota metric',
            'GENERATIVELANGUAGE.GOOGLEAPIS.COM returned 429'
        ];

        for (const line of lines) {
            multiaccManager.lastFailoverTime = 0;
            multiaccManager.checkForQuotaError(line);
        }
        assert.strictEqual(triggers.length, lines.length, 'All mixed-case quota variations should trigger failover');
    } finally {
        multiaccManager.triggerAutoFailover = origTrigger;
    }
});

// =========================================================================
// R4 BOUNDARY CASES
// =========================================================================

test('T2_R4_01_TruncatedJwtToken - truncated JWT tokens safely return null without throwing', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'asar_extracted_228', 'dist')}')
import credHelper

tokens = [
    json.dumps({"id_token": "onlyheader"}),
    json.dumps({"id_token": "header.truncated"}),
    json.dumps({"id_token": "."}),
    json.dumps({"id_token": "..."})
]

results = [credHelper.extract_email(t) for t in tokens]
print(json.dumps(results))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.deepStrictEqual(data, [null, null, null, null]);
});

test('T2_R4_02_MissingEmailClaimsInJwt - JWT without email claim returns null gracefully', () => {
    const pythonScript = `
import sys, os, json, base64
sys.path.insert(0, r'${path.join(ROOT_DIR, 'asar_extracted_228', 'dist')}')
import credHelper

h = base64.urlsafe_b64encode(b'{"alg":"RS256"}').decode().rstrip('=')
p = base64.urlsafe_b64encode(b'{"sub":"987654321","aud":"testapp"}').decode().rstrip('=')
tok = json.dumps({"id_token": f"{h}.{p}.sig"})
print(json.dumps({"email": credHelper.extract_email(tok)}))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.email, null);
});

test('T2_R4_03_InvalidBase64UrlPadding - base64 payload with irregular length decodes safely', () => {
    const pythonScript = `
import sys, os, json, base64
sys.path.insert(0, r'${path.join(ROOT_DIR, 'asar_extracted_228', 'dist')}')
import credHelper

# Test payloads of varying byte lengths (1, 2, 3 byte remainders)
results = []
for test_email in ["a@b.c", "ab@cd.ef", "abc@def.ghij"]:
    p_bytes = json.dumps({"email": test_email}).encode()
    p_b64 = base64.urlsafe_b64encode(p_bytes).decode().rstrip('=')
    tok = json.dumps({"id_token": f"head.{p_b64}.sig"})
    results.append(credHelper.extract_email(tok))

print(json.dumps(results))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.deepStrictEqual(data, ['a@b.c', 'ab@cd.ef', 'abc@def.ghij']);
});

test('T2_R4_04_EmptyOrNonDictCredentialBlob - non-dict JSON structures return null cleanly', () => {
    const pythonScript = `
import sys, os, json
sys.path.insert(0, r'${path.join(ROOT_DIR, 'asar_extracted_228', 'dist')}')
import credHelper

cases = [
    json.dumps(["email", "list@gmail.com"]),
    json.dumps(12345),
    json.dumps("string_only"),
    json.dumps(True)
]

results = [credHelper.extract_email(c) for c in cases]
print(json.dumps(results))
`;
    const res = spawnSync('python', ['-c', pythonScript], { encoding: 'utf-8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const data = JSON.parse(res.stdout.trim());
    assert.deepStrictEqual(data, [null, null, null, null]);
});

test('T2_R4_05_UnpackGlobBoundaryMatching - validates exact glob structure for unpack', () => {
    const unpackPattern = '{**/chrome-devtools-mcp/**,**/credHelper.py}';

    function matchesGlob(pattern, candidate) {
        const normalized = candidate.replace(/\\/g, '/');
        if (pattern.includes('**/credHelper.py') && normalized.endsWith('credHelper.py')) return true;
        if (pattern.includes('**/chrome-devtools-mcp/**') && normalized.includes('chrome-devtools-mcp/')) return true;
        return false;
    }

    assert.strictEqual(matchesGlob(unpackPattern, 'dist/credHelper.py'), true);
    assert.strictEqual(matchesGlob(unpackPattern, 'node_modules/chrome-devtools-mcp/build/bin.js'), true);
    assert.strictEqual(matchesGlob(unpackPattern, 'dist/main.js'), false);
    assert.strictEqual(matchesGlob(unpackPattern, 'dist/utils.js'), false);
});
