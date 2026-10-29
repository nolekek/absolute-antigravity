/**
 * tests/test_m1_oauth.js
 *
 * Verification suite for Milestone 1: OAuth & Browser Flow Hardening
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 1. Install electron mock
const { installElectronMock, resetMockState, mockState, mockSession, mockShell } = require('./helpers/electron_mock');
installElectronMock();

// 2. Load utils
const utils = require('../asar_extracted_228/dist/utils');

console.log('--- Starting Test Suite: Milestone 1 (OAuth & Browser Flow) ---');

// Test 1: isAuthUrl
console.log('Test 1: isAuthUrl');
assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/o/oauth2/auth?client_id=test'), true, 'accounts.google.com oauth2 must be auth url');
assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/signin/v2/identifier'), true, 'accounts.google.com signin must be auth url');
assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/ServiceLogin'), true, 'accounts.google.com ServiceLogin must be auth url');
assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/'), true, 'accounts.google.com root must be auth url');
assert.strictEqual(utils.isAuthUrl('https://sub.accounts.google.com/any/path'), true, 'subdomain accounts.google.com must be auth url');
assert.strictEqual(utils.isAuthUrl('https://google.com/oauth2/v2/auth'), true, 'google.com oauth2 must be auth url');
assert.strictEqual(utils.isAuthUrl('https://example.com/oauth'), false, 'example.com must NOT be auth url');
assert.strictEqual(utils.isAuthUrl('https://github.com/login'), false, 'github.com must NOT be auth url');
assert.strictEqual(utils.isAuthUrl(''), false, 'empty string must return false');
assert.strictEqual(utils.isAuthUrl(null), false, 'null must return false');
console.log('  ✔ isAuthUrl passed all checks.');

// Test 2: ensureAccountSelection
console.log('Test 2: ensureAccountSelection');
{
    const url1 = utils.ensureAccountSelection('https://accounts.google.com/o/oauth2/auth?client_id=123&scope=email');
    const u1 = new URL(url1);
    assert.strictEqual(u1.searchParams.get('prompt'), 'select_account', 'Must append prompt=select_account');

    const url2 = utils.ensureAccountSelection('https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=consent');
    const u2 = new URL(url2);
    assert.strictEqual(u2.searchParams.get('prompt'), 'select_account consent', 'Must combine with consent');

    const url3 = utils.ensureAccountSelection('https://accounts.google.com/o/oauth2/auth?client_id=123&prompt=select_account');
    const u3 = new URL(url3);
    assert.strictEqual(u3.searchParams.get('prompt'), 'select_account', 'Must not duplicate select_account');

    const url4 = utils.ensureAccountSelection('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn');
    const u4 = new URL(url4);
    assert.strictEqual(u4.searchParams.get('prompt'), 'select_account', 'Must add select_account to signin URL');

    const nonGoogle = utils.ensureAccountSelection('https://example.com/login?foo=bar');
    assert.strictEqual(nonGoogle, 'https://example.com/login?foo=bar', 'Non-auth URLs must remain unchanged');
}
console.log('  ✔ ensureAccountSelection passed all checks.');

// Test 3: configureAuthInterception & webRequest
console.log('Test 3: configureAuthInterception & webRequest cancellation');
{
    resetMockState();
    const testSession = {
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
        }
    };

    utils.configureAuthInterception(testSession);
    assert.deepStrictEqual(testSession.webRequest._filter, { urls: ['*://accounts.google.com/*'] }, 'Filter must be *://accounts.google.com/*');
    assert.strictEqual(typeof testSession.webRequest._listener, 'function', 'Listener must be attached');

    // Simulate request to accounts.google.com
    let callbackResult = null;
    testSession.webRequest._listener({
        url: 'https://accounts.google.com/o/oauth2/auth?client_id=test_client',
        resourceType: 'mainFrame'
    }, (res) => {
        callbackResult = res;
    });

    assert.deepStrictEqual(callbackResult, { cancel: true }, 'Web request to accounts.google.com must be cancelled');
    assert.strictEqual(mockState.openedExternalUrls.length, 1, 'Must invoke shell.openExternal');
    assert(mockState.openedExternalUrls[0].url.includes('prompt=select_account'), 'Opened URL must include prompt=select_account');
}
console.log('  ✔ configureAuthInterception passed all checks.');

// Test 4: beyondcorpPac preservation of auth interception
console.log('Test 4: beyondcorpPac preservation of auth interception');
{
    resetMockState();
    const beyondcorpPac = require('../asar_extracted_228/dist/beyondcorpPac');
    const webviewSession = {
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
        setProxy: async (cfg) => {
            return Promise.resolve();
        }
    };

    // First attach auth interception
    utils.configureAuthInterception(webviewSession);
    // Now trigger proxy configuration
    const proxyConfigurator = beyondcorpPac.createWebviewProxyConfigurator(
        () => 'data:text/javascript;base64,ZHVtbXk='
    );

    const p = proxyConfigurator(webviewSession);
    assert(p instanceof Promise, 'Should return promise');

    p.then(() => {
        // After proxy config, onBeforeRequest must NOT be null!
        assert.notStrictEqual(webviewSession.webRequest._listener, null, 'onBeforeRequest listener must be preserved/reattached');
        assert.deepStrictEqual(webviewSession.webRequest._filter, { urls: ['*://accounts.google.com/*'] }, 'Filter must be preserved');
        console.log('  ✔ beyondcorpPac preservation of auth interception passed.');
    }).catch(err => {
        console.error('Failed beyondcorpPac test:', err);
        process.exit(1);
    });
}

// Test 5: languageServer.js ANTIGRAVITY_VSCODE_HOST presence
console.log('Test 5: languageServer.js ANTIGRAVITY_VSCODE_HOST inspection');
{
    const lsDistContent = fs.readFileSync(path.join(__dirname, '../asar_extracted_228/dist/languageServer.js'), 'utf-8');
    const lsRootContent = fs.readFileSync(path.join(__dirname, '../languageServer.js'), 'utf-8');
    assert(lsDistContent.includes("env['ANTIGRAVITY_VSCODE_HOST'] = '1'"), 'dist/languageServer.js must inject ANTIGRAVITY_VSCODE_HOST');
    assert(lsRootContent.includes("env['ANTIGRAVITY_VSCODE_HOST'] = '1'"), 'root languageServer.js must inject ANTIGRAVITY_VSCODE_HOST');
    console.log('  ✔ languageServer.js ANTIGRAVITY_VSCODE_HOST verified in both locations.');
}

// Test 6: preload.js non-blocking cancellation inspection
console.log('Test 6: preload.js non-blocking cancellation inspection');
{
    const preloadDistContent = fs.readFileSync(path.join(__dirname, '../asar_extracted_228/dist/preload.js'), 'utf-8');
    const preloadRootContent = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf-8');

    // Confirm that confirm( is not in handleAddAccount
    const handleAddRegex = /async function handleAddAccount\(\)[\s\S]*?addBtn\.onclick/;
    const distMatch = handleAddRegex.exec(preloadDistContent);
    const rootMatch = handleAddRegex.exec(preloadRootContent);

    assert(distMatch && !distMatch[0].includes('confirm('), 'dist/preload.js handleAddAccount must not contain confirm()');
    assert(rootMatch && !rootMatch[0].includes('confirm('), 'root preload.js handleAddAccount must not contain confirm()');
    console.log('  ✔ preload.js non-blocking cancellation verified in both locations.');
}

// Test 7: main.js web-contents-created will-frame-navigate & navigation interception
console.log('Test 7: main.js web-contents-created will-frame-navigate inspection');
{
    const mainContent = fs.readFileSync(path.join(__dirname, '../asar_extracted_228/dist/main.js'), 'utf-8');
    assert(mainContent.includes("contents.on('will-frame-navigate'"), 'main.js must register will-frame-navigate handler');
    assert(mainContent.includes("contents.on('will-navigate'"), 'main.js must register will-navigate handler');
    assert(mainContent.includes("contents.on('will-redirect'"), 'main.js must register will-redirect handler');
    assert(mainContent.includes("contents.setWindowOpenHandler"), 'main.js must register setWindowOpenHandler');
    console.log('  ✔ main.js will-frame-navigate and navigation handlers verified.');
}

console.log('=== All Milestone 1 Verification Tests Passed Successfully! ===');
