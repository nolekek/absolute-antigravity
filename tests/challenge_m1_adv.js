/**
 * tests/challenge_m1_adv.js
 *
 * Empirical Adversarial Challenge Suite for Milestone 1:
 * - Frame Navigation & Webview Interception (nested iframes, resource types, URL spoofing)
 * - PAC Proxy Session Lifecycle (resets, concurrent calls, failure recovery)
 * - Cancellation Stress Testing (immediate, mid-poll, timeout, rapid toggle, error resilience)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// Install Electron Mock
const {
    installElectronMock,
    resetMockState,
    mockState,
    mockSession,
    mockShell,
    mockWebRequest
} = require('./helpers/electron_mock');
installElectronMock();

// Load modules under test
const utils = require('../asar_extracted_228/dist/utils');
const beyondcorpPac = require('../asar_extracted_228/dist/beyondcorpPac');
const { multiaccManager } = require('../asar_extracted_228/dist/multiaccManager');
const MultiaccManagerClass = multiaccManager.constructor;

console.log('================================================================');
console.log('  CHALLENGER 2: ADVERSARIAL STRESS TEST SUITE — MILESTONE 1');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails = [];

async function runTest(name, fn) {
    totalTests++;
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            await result;
        }
        passedTests++;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        failedTests++;
        console.error(`  [FAIL] ${name}`);
        console.error(`         Reason: ${err.message || err}`);
        failureDetails.push({ name, error: err.message || String(err) });
    }
}

async function runAllChallenges() {

    // =========================================================================
    // SUITE 1: Frame Navigation & Webview Interception Challenge
    // =========================================================================
    console.log('--- SUITE 1: Frame Navigation & Webview Interception Challenge ---');

    // Test 1.1: Nested iframe navigation (will-frame-navigate)
    await runTest('1.1: will-frame-navigate prevents navigation and opens external browser with prompt=select_account', () => {
        resetMockState();

        class MockFrameWebContents extends EventEmitter {
            constructor() {
                super();
                this.session = {
                    webRequest: {
                        onBeforeRequest: () => {}
                    }
                };
            }
            getType() { return 'webview'; }
            setWindowOpenHandler(h) { this._windowOpenHandler = h; }
        }

        const contents = new MockFrameWebContents();
        let defaultPrevented = false;
        const mockEvent = {
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=google_client_id&response_type=code',
            preventDefault() { defaultPrevented = true; }
        };

        // Attach handlers as registered in main.js
        contents.on('will-frame-navigate', (event) => {
            if (utils.isAuthUrl(event.url)) {
                event.preventDefault();
                utils.openAuthUrlExternal(event.url);
            }
        });

        // Trigger child iframe navigation
        contents.emit('will-frame-navigate', mockEvent);

        assert.strictEqual(defaultPrevented, true, 'will-frame-navigate must prevent default on auth URL');
        assert.strictEqual(mockState.openedExternalUrls.length, 1, 'shell.openExternal must be invoked');
        const opened = mockState.openedExternalUrls[0].url;
        assert(opened.includes('accounts.google.com'), 'Opened URL must be Google auth URL');
        assert(opened.includes('prompt=select_account'), 'Opened URL must force prompt=select_account');
    });

    // Test 1.2: will-frame-navigate on non-auth nested frame must NOT prevent default
    await runTest('1.2: will-frame-navigate does NOT prevent navigation on regular URLs', () => {
        resetMockState();
        const contents = new EventEmitter();
        let defaultPrevented = false;
        const mockEvent = {
            url: 'https://example.com/subframe-widget',
            preventDefault() { defaultPrevented = true; }
        };

        contents.on('will-frame-navigate', (event) => {
            if (utils.isAuthUrl(event.url)) {
                event.preventDefault();
                utils.openAuthUrlExternal(event.url);
            }
        });

        contents.emit('will-frame-navigate', mockEvent);
        assert.strictEqual(defaultPrevented, false, 'Non-auth frame navigation must NOT be prevented');
        assert.strictEqual(mockState.openedExternalUrls.length, 0, 'Non-auth frame must not open external browser');
    });

    // Test 1.3: setWindowOpenHandler popup interception
    await runTest('1.3: setWindowOpenHandler denies internal popups and routes auth to external browser with prompt', () => {
        resetMockState();
        let registeredHandler = null;
        const contents = {
            setWindowOpenHandler(handler) { registeredHandler = handler; }
        };

        // Logic from main.js lines 187-194
        contents.setWindowOpenHandler((details) => {
            if (utils.isAuthUrl(details.url)) {
                utils.openAuthUrlExternal(details.url);
                return { action: 'deny' };
            }
            mockShell.openExternal(details.url);
            return { action: 'deny' };
        });

        // Case A: Auth popup
        const authRes = registeredHandler({ url: 'https://accounts.google.com/signin/oauth/identifier?flowName=GeneralOAuthFlow' });
        assert.deepStrictEqual(authRes, { action: 'deny' }, 'Auth popup must be denied internally');
        assert.strictEqual(mockState.openedExternalUrls.length, 1);
        assert(mockState.openedExternalUrls[0].url.includes('prompt=select_account'));

        // Case B: General external popup
        const genRes = registeredHandler({ url: 'https://github.com/developer/repo' });
        assert.deepStrictEqual(genRes, { action: 'deny' }, 'General external popup must be denied internally');
        assert.strictEqual(mockState.openedExternalUrls.length, 2);
        assert.strictEqual(mockState.openedExternalUrls[1].url, 'https://github.com/developer/repo', 'General URL must not be modified');
    });

    // Test 1.4: Granular resourceType handling in webRequest.onBeforeRequest
    await runTest('1.4: webRequest onBeforeRequest cancels all auth requests, but only opens browser for frame/subFrame', () => {
        resetMockState();
        let attachedFilter = null;
        let attachedListener = null;

        const session = {
            webRequest: {
                onBeforeRequest(filter, listener) {
                    attachedFilter = filter;
                    attachedListener = listener;
                }
            }
        };

        utils.configureAuthInterception(session, true);
        assert.deepStrictEqual(attachedFilter, { urls: ['*://accounts.google.com/*'] });

        // Sub-test A: mainFrame
        let resMain = null;
        attachedListener({
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=main_client_xyz',
            resourceType: 'mainFrame'
        }, (res) => { resMain = res; });
        assert.deepStrictEqual(resMain, { cancel: true });
        assert.strictEqual(mockState.openedExternalUrls.length, 1);

        // Sub-test B: subFrame
        let resSub = null;
        attachedListener({
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=subframe_client_unique_123456789',
            resourceType: 'subFrame'
        }, (res) => { resSub = res; });
        assert.deepStrictEqual(resSub, { cancel: true });
        assert.strictEqual(mockState.openedExternalUrls.length, 2);

        // Sub-test C: subresources (xhr, script, image) - MUST BE CANCELLED but NOT trigger external browser!
        const preCount = mockState.openedExternalUrls.length;
        let resXhr = null;
        attachedListener({
            url: 'https://accounts.google.com/api/telemetry_subresource_call',
            resourceType: 'xhr'
        }, (res) => { resXhr = res; });
        assert.deepStrictEqual(resXhr, { cancel: true }, 'Internal XHR to accounts.google.com must be cancelled');
        assert.strictEqual(mockState.openedExternalUrls.length, preCount, 'Subresource XHR must not launch browser window');

        let resScript = null;
        attachedListener({
            url: 'https://accounts.google.com/static/js/client.js',
            resourceType: 'script'
        }, (res) => { resScript = res; });
        assert.deepStrictEqual(resScript, { cancel: true }, 'Internal script request must be cancelled');
        assert.strictEqual(mockState.openedExternalUrls.length, preCount, 'Subresource script must not launch browser window');
    });

    // Test 1.5: Adversarial URL edge cases and phishing defense
    await runTest('1.5: isAuthUrl & ensureAccountSelection adversarial URL matrix', () => {
        // True auth targets:
        assert.strictEqual(utils.isAuthUrl('HTTPS://ACCOUNTS.GOOGLE.COM/o/oauth2/v2/auth'), true, 'Case-insensitive host');
        assert.strictEqual(utils.isAuthUrl('https://accounts.google.com:443/ServiceLogin'), true, 'Explicit port 443');
        assert.strictEqual(utils.isAuthUrl('https://subdomain.accounts.google.com/auth'), true, 'Subdomain of accounts.google.com');
        assert.strictEqual(utils.isAuthUrl('https://google.com/oauth2/v2/auth'), true, 'google.com oauth2 endpoint');
        assert.strictEqual(utils.isAuthUrl('https://accounts.google.com/AccountChooser?service=lso'), true, 'AccountChooser');

        // Phishing / False auth attempts (MUST RETURN FALSE):
        assert.strictEqual(utils.isAuthUrl('https://accounts.google.com.attacker.com/o/oauth2'), false, 'Attacker subdomain spoofing must return false');
        assert.strictEqual(utils.isAuthUrl('https://evil-accounts-google.com/signin'), false, 'Lookalike domain must return false');
        assert.strictEqual(utils.isAuthUrl('https://www.google.com/search?q=accounts.google.com'), false, 'Google search query must return false');
        assert.strictEqual(utils.isAuthUrl('javascript:alert(1)'), false, 'Javascript URI must return false');
        assert.strictEqual(utils.isAuthUrl('blob:https://accounts.google.com/uuid'), false, 'Blob URL must return false');
        assert.strictEqual(utils.isAuthUrl(''), false, 'Empty string must return false');
        assert.strictEqual(utils.isAuthUrl(undefined), false, 'Undefined must return false');

        // ensureAccountSelection prompt transformations
        // Case 1: Existing consent prompt
        const consentUrl = utils.ensureAccountSelection('https://accounts.google.com/o/oauth2/v2/auth?client_id=1&prompt=consent');
        const u1 = new URL(consentUrl);
        assert.strictEqual(u1.searchParams.get('prompt'), 'select_account consent');

        // Case 2: Existing login prompt
        const loginUrl = utils.ensureAccountSelection('https://accounts.google.com/o/oauth2/v2/auth?client_id=1&prompt=login');
        const u2 = new URL(loginUrl);
        assert.strictEqual(u2.searchParams.get('prompt'), 'select_account login');

        // Case 3: Already has select_account (must NOT duplicate)
        const alreadyUrl = utils.ensureAccountSelection('https://accounts.google.com/o/oauth2/v2/auth?client_id=1&prompt=select_account');
        const u3 = new URL(alreadyUrl);
        assert.strictEqual(u3.searchParams.get('prompt'), 'select_account');

        // Case 4: Non-auth URL must remain pristine
        const safeUrl = 'https://developer.mozilla.org/en-US/docs/Web?query=test';
        assert.strictEqual(utils.ensureAccountSelection(safeUrl), safeUrl);
    });

    // Test 1.6: Debounce behavior in openAuthUrlExternal
    await runTest('1.6: openAuthUrlExternal debounces rapid duplicate calls within 4000ms', () => {
        resetMockState();
        const testAuthUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=debounce_test_client_id_1';

        // Fire 10 rapid calls
        for (let i = 0; i < 10; i++) {
            utils.openAuthUrlExternal(testAuthUrl);
        }

        assert.strictEqual(mockState.openedExternalUrls.length, 1, 'Debounce must limit 10 rapid duplicate calls to exactly 1 external launch');
    });

    // =========================================================================
    // SUITE 2: PAC Proxy Session Lifecycle Stress
    // =========================================================================
    console.log('\n--- SUITE 2: PAC Proxy Session Lifecycle Stress ---');

    function createMockSession() {
        return {
            _filter: null,
            _listener: null,
            _proxyConfig: null,
            _setProxyCallCount: 0,
            webRequest: {
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
            async setProxy(config) {
                this._setProxyCallCount++;
                this._proxyConfig = config;
                await new Promise(r => setTimeout(r, 10));
            }
        };
    }

    // Test 2.1: Single PAC proxy configuration retention
    await runTest('2.1: PAC proxy configuration preserves and reattaches auth onBeforeRequest', async () => {
        const session = createMockSession();
        utils.configureAuthInterception(session, true);
        assert.deepStrictEqual(session.webRequest._filter, { urls: ['*://accounts.google.com/*'] });

        const configurator = beyondcorpPac.createWebviewProxyConfigurator(
            () => 'data:text/javascript;base64,ZHVtbXk='
        );

        await configurator(session);

        assert.strictEqual(session._setProxyCallCount, 1);
        assert.notStrictEqual(session.webRequest._listener, null, 'Listener must be attached');
        assert.deepStrictEqual(session.webRequest._filter, { urls: ['*://accounts.google.com/*'] });

        // Verify request cancellation works
        let res = null;
        session.webRequest._listener({
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=pac_test_client_1',
            resourceType: 'mainFrame'
        }, r => { res = r; });
        assert.deepStrictEqual(res, { cancel: true });
    });

    // Test 2.2: 25 sequential PAC proxy reconfigurations stress
    await runTest('2.2: 25 consecutive PAC proxy resets maintain auth interception integrity', async () => {
        const session = createMockSession();
        utils.configureAuthInterception(session, true);

        for (let i = 1; i <= 25; i++) {
            const configurator = beyondcorpPac.createWebviewProxyConfigurator(
                () => `data:text/javascript;base64,iter_${i}`
            );
            await configurator(session);

            assert.notStrictEqual(
                session.webRequest._listener,
                null,
                `onBeforeRequest must not be null at iteration ${i}`
            );
            assert.deepStrictEqual(
                session.webRequest._filter,
                { urls: ['*://accounts.google.com/*'] },
                `Filter must be retained at iteration ${i}`
            );
        }

        assert.strictEqual(session._setProxyCallCount, 25);
    });

    // Test 2.3: 10 concurrent PAC proxy configuration calls race-condition test
    await runTest('2.3: Concurrent PAC proxy configurations do not race or clear onBeforeRequest', async () => {
        const session = createMockSession();
        utils.configureAuthInterception(session, true);

        const configurator = beyondcorpPac.createWebviewProxyConfigurator(
            () => 'data:text/javascript;base64,concurrent'
        );

        // Fire 10 parallel proxy configurations
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(configurator(session));
        }

        await Promise.all(promises);

        assert.notStrictEqual(session.webRequest._listener, null, 'Listener must remain intact after concurrent runs');
        assert.deepStrictEqual(session.webRequest._filter, { urls: ['*://accounts.google.com/*'] });
    });

    // Test 2.4: PAC proxy failure / rejection resilience
    await runTest('2.4: PAC proxy rejection executes finally and safely reattaches auth interception', async () => {
        const session = createMockSession();
        utils.configureAuthInterception(session, true);

        // Intentionally reject setProxy
        session.setProxy = async () => {
            await new Promise(r => setTimeout(r, 5));
            throw new Error('SIMULATED_PAC_FAILURE: Invalid PAC script or network unreachable');
        };

        const configurator = beyondcorpPac.createWebviewProxyConfigurator(
            () => 'data:text/javascript;base64,failing'
        );

        await configurator(session);

        assert.notStrictEqual(session.webRequest._listener, null, 'Listener must be re-attached in finally block even on error');
        assert.deepStrictEqual(session.webRequest._filter, { urls: ['*://accounts.google.com/*'] });

        // Verify it still intercepts and cancels
        let res = null;
        session.webRequest._listener({
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=error_recovery_client',
            resourceType: 'mainFrame'
        }, r => { res = r; });
        assert.deepStrictEqual(res, { cancel: true });
    });

    // Test 2.5: Multi-session partition isolation
    await runTest('2.5: Multiple sessions maintain independent auth interception during asymmetric resets', async () => {
        const sessionA = createMockSession();
        const sessionB = createMockSession();

        utils.configureAuthInterception(sessionA, true);
        utils.configureAuthInterception(sessionB, true);

        const configurator = beyondcorpPac.createWebviewProxyConfigurator(
            () => 'data:text/javascript;base64,sessionA'
        );

        // Reset session A multiple times
        await configurator(sessionA);
        await configurator(sessionA);

        assert.notStrictEqual(sessionA.webRequest._listener, null, 'Session A must have listener');
        assert.notStrictEqual(sessionB.webRequest._listener, null, 'Session B must have listener');
        assert.deepStrictEqual(sessionA.webRequest._filter, { urls: ['*://accounts.google.com/*'] });
        assert.deepStrictEqual(sessionB.webRequest._filter, { urls: ['*://accounts.google.com/*'] });
    });

    // =========================================================================
    // SUITE 3: Cancellation Robustness & Stress Test
    // =========================================================================
    console.log('\n--- SUITE 3: Cancellation Robustness & Stress Test ---');

    function createTestManager(opts = {}) {
        const mgr = new MultiaccManagerClass();
        const calls = [];
        let helperDelay = opts.helperDelay || 0;
        let restartLsCount = 0;

        mgr.runHelper = async (args) => {
            calls.push({ cmd: args[0], args, time: Date.now() });
            if (helperDelay > 0) {
                await new Promise(r => setTimeout(r, helperDelay));
            }

            const cmd = args[0];
            if (cmd === 'status') {
                return {
                    activeSlot: 1,
                    accounts: [{ slot: 1, email: 'user1@gmail.com' }],
                    slotsCount: 1,
                    maxSlots: 4,
                    autoFailover: true
                };
            }
            if (cmd === 'prepare-add-login') {
                return { status: 'prepared', activeSlot: 1 };
            }
            if (cmd === 'cancel-add-login') {
                return { status: 'cancelled', activeSlot: 1, accounts: [{ slot: 1, email: 'user1@gmail.com' }] };
            }
            if (cmd === 'finalize-add-login') {
                if (opts.finalizeSuccess) {
                    return {
                        addedSlot: 2,
                        newEmail: 'user2@gmail.com',
                        accounts: [{ slot: 1, email: 'user1@gmail.com' }, { slot: 2, email: 'user2@gmail.com' }]
                    };
                }
                return { error: 'No credential found yet' };
            }
            return {};
        };

        mgr.setRestartCallback(async () => {
            restartLsCount++;
            if (opts.throwOnRestart) {
                throw new Error('SIMULATED_RESTART_LS_ERROR');
            }
        });

        return { mgr, calls, getRestartCount: () => restartLsCount };
    }

    // Test 3.1: Immediate cancellation (T = 0ms)
    await runTest('3.1: Immediate cancellation aborts login synchronously before first poll tick', async () => {
        const { mgr, calls } = createTestManager();

        const addPromise = mgr.startAddAccount();
        assert.strictEqual(mgr.isAddingAccount, true, 'isAddingAccount must be true immediately after start');

        const cancelPromise = mgr.cancelAddAccount();
        assert.strictEqual(mgr.isAddingAccount, false, 'isAddingAccount must be reset to false immediately');

        const [addRes, cancelRes] = await Promise.all([addPromise, cancelPromise]);

        assert.strictEqual(addRes.error, 'Авторизация отменена пользователем', 'startAddAccount must resolve with cancellation message');
        assert.strictEqual(cancelRes.status, 'cancelled');
        assert(calls.some(c => c.cmd === 'cancel-add-login'), 'cancel-add-login command must be executed');
        assert.strictEqual(mgr.isAddingAccount, false, 'Manager must be in idle state');
    });

    // Test 3.2: Mid-poll cancellation (T = 150ms)
    await runTest('3.2: Mid-process cancellation cleanly interrupts polling loop without waiting for timeout', async () => {
        const { mgr, calls } = createTestManager();

        const startTime = Date.now();
        const addPromise = mgr.startAddAccount();

        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(mgr.isAddingAccount, true, 'Should be polling');

        const cancelRes = await mgr.cancelAddAccount();
        const addRes = await addPromise;
        const duration = Date.now() - startTime;

        assert.strictEqual(addRes.error, 'Авторизация отменена пользователем');
        assert.strictEqual(cancelRes.status, 'cancelled');
        assert(duration < 2500, `Mid-poll abort should resolve promptly, took ${duration}ms (not 180s timeout)`);
        assert.strictEqual(mgr.isAddingAccount, false);
    });

    // Test 3.3: Rapid cancellation stress (15 concurrent cancel calls)
    await runTest('3.3: 15 concurrent cancelAddAccount calls do not cause race conditions or duplicate commands', async () => {
        const { mgr, calls } = createTestManager();

        mgr.isAddingAccount = true;

        const cancelPromises = [];
        for (let i = 0; i < 15; i++) {
            cancelPromises.push(mgr.cancelAddAccount());
        }

        const results = await Promise.all(cancelPromises);

        const cancelCmds = calls.filter(c => c.cmd === 'cancel-add-login');
        assert.strictEqual(cancelCmds.length, 1, 'cancel-add-login must only be executed once across concurrent calls');
        assert.strictEqual(mgr.isAddingAccount, false);
        results.forEach(res => {
            assert.notStrictEqual(res, null);
        });
    });

    // Test 3.4: Rapid Add -> Cancel -> Add -> Cancel stress (10 consecutive cycles)
    await runTest('3.4: 10 consecutive rapid Add-Cancel cycles preserve state consistency', async () => {
        const { mgr } = createTestManager();

        for (let cycle = 1; cycle <= 10; cycle++) {
            const addPromise = mgr.startAddAccount();
            assert.strictEqual(mgr.isAddingAccount, true, `Cycle ${cycle}: must start adding`);

            await new Promise(r => setTimeout(r, 5 + (cycle % 5) * 5));

            await mgr.cancelAddAccount();
            const res = await addPromise;

            assert.strictEqual(res.error, 'Авторизация отменена пользователем', `Cycle ${cycle} must abort cleanly`);
            assert.strictEqual(mgr.isAddingAccount, false, `Cycle ${cycle}: must be idle`);
        }
    });

    // Test 3.5: Error resilience during cancellation (LS restart failure)
    await runTest('3.5: Error during LS restart or helper does not crash cancel flow or leak state', async () => {
        const { mgr } = createTestManager({ throwOnRestart: true });

        mgr.isAddingAccount = true;
        const cancelRes = await mgr.cancelAddAccount();

        assert.strictEqual(mgr.isAddingAccount, false, 'isAddingAccount must still reset to false despite restart error');
        assert.strictEqual(cancelRes.status, 'cancelled');
    });

    // Test 3.6: Preload handleAddAccount simulated UI state transition
    await runTest('3.6: Preload handleAddAccount state machine correctly handles aborting without prompt', async () => {
        let isAddingAccountActive = false;
        const addBtn = {
            disabled: false,
            textContent: '➕ Добавить',
            title: ''
        };
        const toastMessages = [];
        const showToast = (msg) => toastMessages.push(msg);

        let cancelApiCalled = false;
        let addApiResolve = null;
        const multiaccAPI = {
            async addAccount() {
                return new Promise(r => { addApiResolve = r; });
            },
            async cancelAddAccount() {
                cancelApiCalled = true;
                return { status: 'cancelled' };
            },
            async getStatus() {
                return { activeSlot: 1, slotsCount: 1 };
            }
        };

        async function handleAddAccount() {
            if (isAddingAccountActive) {
                addBtn.disabled = true;
                addBtn.textContent = '⏳ Отмена...';
                try {
                    await multiaccAPI.cancelAddAccount();
                    showToast('Авторизация отменена. Текущий аккаунт сохранен.');
                } catch (e) {
                    showToast('❌ Ошибка: ' + e.message);
                } finally {
                    isAddingAccountActive = false;
                    addBtn.disabled = false;
                    addBtn.textContent = '➕ Добавить';
                    addBtn.title = 'Добавить аккаунт в карусель';
                    await multiaccAPI.getStatus();
                }
                return;
            }

            isAddingAccountActive = true;
            addBtn.disabled = false;
            addBtn.textContent = '⏳ Отмена';
            addBtn.title = 'Нажмите для отмены ожидания авторизации';
            showToast('Открывается страница авторизации Google в браузере. Войдите в нужный аккаунт...');

            try {
                const res = await multiaccAPI.addAccount();
                if (res && res.error) {
                    showToast('❌ ' + res.error);
                }
            } catch (e) {
                showToast('❌ Ошибка: ' + e.message);
            } finally {
                isAddingAccountActive = false;
                addBtn.disabled = false;
                addBtn.textContent = '➕ Добавить';
                addBtn.title = 'Добавить аккаунт в карусель';
                await multiaccAPI.getStatus();
            }
        }

        // 1. User clicks Add Account
        const startPromise = handleAddAccount();
        assert.strictEqual(isAddingAccountActive, true);
        assert.strictEqual(addBtn.textContent, '⏳ Отмена');

        // 2. User clicks Cancel
        const cancelPromise = handleAddAccount();
        await cancelPromise;

        assert.strictEqual(cancelApiCalled, true);
        assert.strictEqual(isAddingAccountActive, false);
        assert.strictEqual(addBtn.disabled, false);
        assert.strictEqual(addBtn.textContent, '➕ Добавить');
        assert(toastMessages.some(m => m.includes('Авторизация отменена')), 'Cancellation toast must be shown');

        addApiResolve({ error: 'Авторизация отменена пользователем' });
        await startPromise;

        assert.strictEqual(isAddingAccountActive, false);
        assert.strictEqual(addBtn.textContent, '➕ Добавить');
    });

    console.log('\n================================================================');
    console.log(`  CHALLENGER 2 SUMMARY: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
    console.log('================================================================');

    if (failureDetails.length > 0) {
        console.log('\nFAILURES RECORDED:');
        failureDetails.forEach(f => {
            console.log(`- ${f.name}: ${f.error}`);
        });
    }

    if (failedTests > 0) {
        process.exit(1);
    }
}

runAllChallenges().catch(err => {
    console.error('\n[FATAL CHALLENGE FAILURE]:', err);
    process.exit(1);
});
