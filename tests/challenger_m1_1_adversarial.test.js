/**
 * tests/challenger_m1_1_adversarial.test.js
 *
 * Empirical Challenge Harness by Challenger 1 for Milestone 1 (OAuth & Browser Flow Hardening).
 * Tests adversarial edge cases: URL manipulation, regex matching, exotic domains,
 * query parameter attacks, false positive traps, and debounce dropped-URL flaws.
 */

const { installElectronMock, resetMockState, mockState } = require('./helpers/electron_mock');
installElectronMock();

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const utils = require('../asar_extracted_228/dist/utils');
const { multiaccManager } = require('../asar_extracted_228/dist/multiaccManager');

// =========================================================================
// Category A: Malformed URLs & Protocol Edge Cases
// =========================================================================

test('ADV_A01_NonStringAndEmptyInputs - safely handles invalid types without throwing', () => {
    const invalidInputs = [null, undefined, 0, 12345, false, true, {}, [], NaN, () => {}];
    for (const val of invalidInputs) {
        assert.doesNotThrow(() => {
            assert.strictEqual(utils.isAuthUrl(val), false, `isAuthUrl should return false for: ${val}`);
            assert.strictEqual(utils.extractAuthUrl(val), null, `extractAuthUrl should return null for: ${val}`);
            assert.strictEqual(utils.ensureAccountSelection(val), val, `ensureAccountSelection should return original for: ${val}`);
        });
    }

    const emptyStrings = ['', '   ', '\t\n\r'];
    for (const s of emptyStrings) {
        assert.strictEqual(utils.isAuthUrl(s), false);
        assert.strictEqual(utils.ensureAccountSelection(s), s);
    }
});

test('ADV_A02_MalformedProtocolsAndSchemes - does not throw on exotic/malformed schemes', () => {
    const malformed = [
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'blob:https://accounts.google.com/1234-5678',
        'file:///C:/Windows/System32/calc.exe',
        'http://///',
        'https://',
        'custom-scheme://accounts.google.com/oauth'
    ];

    for (const u of malformed) {
        assert.doesNotThrow(() => {
            utils.isAuthUrl(u);
            utils.ensureAccountSelection(u);
        });
    }
});

test('ADV_A03_ExtremeLengthUrls - survives > 100,000 character URLs without ReDoS', () => {
    const hugePadding = 'x'.repeat(100000);
    const hugeUrl = `https://accounts.google.com/o/oauth2/auth?client_id=test&padding=${hugePadding}`;

    const t0 = Date.now();
    const isAuth = utils.isAuthUrl(hugeUrl);
    const ensured = utils.ensureAccountSelection(hugeUrl);
    const duration = Date.now() - t0;

    assert.strictEqual(isAuth, true);
    assert.ok(ensured.includes('prompt=select_account'));
    assert.ok(duration < 500, `Execution took too long: ${duration}ms (potential ReDoS)`);
});

// =========================================================================
// Category B: Query String Manipulation & Parameter Integrity
// =========================================================================

test('ADV_B01_PromptParameterMatrix - correctly injects or preserves prompt=select_account', () => {
    const testCases = [
        {
            input: 'https://accounts.google.com/o/oauth2/auth?client_id=123',
            expectedPrompt: 'select_account'
        },
        {
            input: 'https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=consent',
            expectedPrompt: 'select_account consent'
        },
        {
            input: 'https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=select_account',
            expectedPrompt: 'select_account'
        },
        {
            input: 'https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=consent%20select_account',
            expectedPrompt: 'consent select_account'
        },
        {
            input: 'https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=login',
            expectedPrompt: 'select_account login'
        },
        {
            input: 'https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=',
            expectedPrompt: 'select_account'
        }
    ];

    for (const tc of testCases) {
        const transformed = utils.ensureAccountSelection(tc.input);
        const parsed = new URL(transformed);
        assert.strictEqual(parsed.searchParams.get('prompt'), tc.expectedPrompt, `Failed for input: ${tc.input}`);
    }
});

test('ADV_B02_DuplicatePromptParameters - cleans up duplicate prompt parameters', () => {
    const input = 'https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=consent&prompt=none';
    const transformed = utils.ensureAccountSelection(input);
    const parsed = new URL(transformed);
    const allPrompts = parsed.searchParams.getAll('prompt');
    assert.strictEqual(allPrompts.length, 1, 'Should normalize duplicate prompt parameters into a single parameter');
    assert.ok(allPrompts[0].includes('select_account'), 'Resulting prompt must contain select_account');
});

test('ADV_B03_OAuthParameterPreservation - ensures other parameters remain uncorrupted', () => {
    const original = 'https://accounts.google.com/o/oauth2/auth?client_id=my_client&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080&response_type=code&scope=openid%20profile%20email&state=xyz_state_123&code_challenge=abc456&code_challenge_method=S256';
    const transformed = utils.ensureAccountSelection(original);
    const u = new URL(transformed);

    assert.strictEqual(u.searchParams.get('client_id'), 'my_client');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8080');
    assert.strictEqual(u.searchParams.get('response_type'), 'code');
    assert.strictEqual(u.searchParams.get('scope'), 'openid profile email');
    assert.strictEqual(u.searchParams.get('state'), 'xyz_state_123');
    assert.strictEqual(u.searchParams.get('code_challenge'), 'abc456');
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
});

// =========================================================================
// Category C: Domain & Host Spoofing / False Positives (Attack Surface)
// =========================================================================

test('ADV_C01_AttackerSubdomainSpoofing - rejects attacker domains embedding accounts.google.com', () => {
    const spoofUrls = [
        'https://accounts.google.com.attacker.com/o/oauth2/auth',
        'https://accounts.google.com-phishing.org/',
        'https://evil-accounts.google.com/signin'
    ];

    for (const url of spoofUrls) {
        const isAuth = utils.isAuthUrl(url);
        assert.strictEqual(isAuth, false, `VULNERABILITY: Attacker spoofed domain ${url} was accepted as auth URL!`);
    }
});

test('ADV_C02_AttackerPathAndQueryEmbedding - rejects non-Google domains with accounts.google.com in path/query', () => {
    const falsePositiveTraps = [
        'https://example.com/search?ref=accounts.google.com',
        'https://developer.mozilla.org/en-US/search?q=accounts.google.com',
        'https://evil.com/path/to/accounts.google.com/login',
        'https://notgoogle.com/#accounts.google.com'
    ];

    for (const url of falsePositiveTraps) {
        const isAuth = utils.isAuthUrl(url);
        assert.strictEqual(isAuth, false, `VULNERABILITY: URL with embedded substring ${url} was falsely identified as auth URL!`);
    }
});

// =========================================================================
// Category D: Exotic Endpoints & Google ccTLDs / False Negatives (Bypass Surface)
// =========================================================================

test('ADV_D01_RegionalGoogleDomains_ccTLD - challenges regional Google auth endpoints', () => {
    const regionalUrls = [
        'https://accounts.google.co.uk/o/oauth2/auth?client_id=123',
        'https://accounts.google.ca/o/oauth2/auth?client_id=123',
        'https://accounts.google.de/o/oauth2/auth?client_id=123',
        'https://accounts.google.co.jp/o/oauth2/auth?client_id=123',
        'https://accounts.google.fr/o/oauth2/auth?client_id=123',
        'https://accounts.google.es/o/oauth2/auth?client_id=123'
    ];

    for (const url of regionalUrls) {
        const isAuth = utils.isAuthUrl(url);
        const ensured = utils.ensureAccountSelection(url);
        const hasPrompt = ensured.includes('prompt=select_account');

        assert.strictEqual(isAuth, true, `Regional Google endpoint should be recognized as auth URL: ${url}`);
        assert.strictEqual(hasPrompt, true, `Regional Google endpoint must have prompt=select_account added: ${url}`);
    }
});

test('ADV_D02_CaseSensitivityPathsAndParams - handles uppercase paths and query params', () => {
    const url = 'https://google.com/OAUTH2/v2/auth?CLIENT_ID=test_id';
    const isAuth = utils.isAuthUrl(url);
    const ensured = utils.ensureAccountSelection(url);
    const hasPrompt = ensured.toLowerCase().includes('prompt=select_account');

    assert.strictEqual(isAuth, true, `Uppercase OAuth path should be recognized: ${url}`);
    assert.strictEqual(hasPrompt, true, `Uppercase OAuth path must receive prompt=select_account: ${url}`);
});

// =========================================================================
// Category E: Auth Redirection Debounce & Dropped Auth URLs
// =========================================================================

test('ADV_E01_RapidDistinctAuthUrls - does NOT drop legitimate distinct auth URLs on retry', () => {
    resetMockState();

    const url1 = 'https://accounts.google.com/o/oauth2/auth?client_id=123&state=nonce_alpha_01';
    const url2 = 'https://accounts.google.com/o/oauth2/auth?client_id=123&state=nonce_beta__02';

    // Both URLs have the exact same length (79 chars)
    assert.strictEqual(url1.length, url2.length);

    // First attempt
    utils.openAuthUrlExternal(url1);
    assert.strictEqual(mockState.openedExternalUrls.length, 1, 'First URL should be opened');

    // User cancels and retries within 500ms
    utils.openAuthUrlExternal(url2);

    assert.strictEqual(
        mockState.openedExternalUrls.length,
        2,
        `VULNERABILITY: Second distinct auth URL was silently dropped by aggressive debounce! Expected 2 opened URLs, got ${mockState.openedExternalUrls.length}`
    );
});

// =========================================================================
// Category F: Rapid Cancellation & Race Conditions
// =========================================================================

test('ADV_F01_RapidConsecutiveCancellation - consecutive cancel calls do not crash or corrupt state', async () => {
    // Call cancelAddAccount consecutively 10 times in parallel
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(multiaccManager.cancelAddAccount());
    }

    const results = await Promise.allSettled(promises);
    for (const r of results) {
        assert.strictEqual(r.status, 'fulfilled', 'All cancel calls should resolve cleanly');
    }
    assert.strictEqual(multiaccManager.isAddingAccount, false, 'isAddingAccount must remain false');
});
