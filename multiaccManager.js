"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.multiaccManager = void 0;

const path = require("path");
const { execFile } = require("child_process");
const { BrowserWindow, Notification } = require("electron");

const fs = require("fs");
const os = require("os");
const USER_HOME = (os.homedir && os.homedir()) || process.env.HOME || process.env.USERPROFILE || "";
const PYTHON_BIN = process.platform === "win32" ? "python" : "python3";
let SCRIPT_PATH = path.join(__dirname, "credHelper.py");
if (SCRIPT_PATH.includes("app.asar")) {
    const unpacked = SCRIPT_PATH.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpacked)) {
        SCRIPT_PATH = unpacked;
    } else {
        const fallback = path.join(USER_HOME, ".gemini", "antigravity", "bin", "credHelper.py");
        if (fs.existsSync(fallback)) {
            SCRIPT_PATH = fallback;
        }
    }
}

class MultiaccManager {
    constructor() {
        this.lastFailoverTime = 0;
        this.isAddingAccount = false;
        this.restartLsCallback = null;
        this.botProcess = null;
        this.httpBridgeServer = null;
        this.webDashboard = null;
        this.startCommandWatcher();
        this.startHttpServer();
        this.startBotWatcher();
        this.autoStartBotIfEnabled();
        this.startWebDashboard();
    }

    startHttpServer() {
        const http = require("http");
        const PORT = 51122;

        const server = http.createServer(async (req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");

            if (req.method === "OPTIONS") {
                res.writeHead(204);
                res.end();
                return;
            }

            const sendJson = (statusCode, data) => {
                res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(data));
            };

            const urlObj = new URL(req.url, "http://127.0.0.1:51122");
            const pathname = urlObj.pathname;

            try {
                if (req.method === "GET" && pathname === "/api/status") {
                    const status = await this.getStatus();
                    let activeCid = null;
                    let currentUrl = null;
                    const wins = BrowserWindow.getAllWindows();
                    let csrfToken = null;
                    if (wins.length > 0 && !wins[0].isDestroyed()) {
                        try {
                            const info = await wins[0].webContents.executeJavaScript(`({
                                url: window.location.href,
                                pathname: window.location.pathname,
                                csrfToken: window.__APP_CONFIG__?.csrfToken
                            })`);
                            currentUrl = info.url;
                            csrfToken = info.csrfToken;
                            const match = (info.pathname || "").match(/\/c\/([a-zA-Z0-9_-]+)/);
                            if (match) activeCid = match[1];
                        } catch (e) {}
                    }
                    sendJson(200, {
                        ok: true,
                        activeSlot: status.activeSlot,
                        currentEmail: status.currentEmail,
                        accounts: status.accounts,
                        autoFailover: status.autoFailover,
                        activeConversationId: activeCid,
                        currentUrl: currentUrl,
                        csrfToken: csrfToken,
                        windowOpen: wins.length > 0
                    });
                    return;
                }

                if (req.method === "GET" && pathname === "/api/presets") {
                    try {
                        try { delete require.cache[require.resolve("./skillManager")]; } catch (_) {}
                    const { skillManager } = require("./skillManager");
                        const presets = skillManager.getPresets();
                        const activePreset = skillManager.getActivePreset();
                        sendJson(200, { ok: true, presets, activePreset });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                    return;
                }

                if (req.method === "POST" && pathname === "/api/switch-preset") {
                    let body = "";
                    req.on("data", chunk => { body += chunk; });
                    req.on("end", async () => {
                        try {
                            const parsed = JSON.parse(body || "{}");
                            const targetPreset = parsed.preset;
                            try { delete require.cache[require.resolve("./skillManager")]; } catch (_) {}
                    const { skillManager } = require("./skillManager");
                            let workspacePath = process.cwd();
                            try {
                                const os = require("os");
                                const path = require("path");
                                const fs = require("fs");
                                const prjPath = path.join(os.homedir(), ".gemini", "projects.json");
                                if (fs.existsSync(prjPath)) {
                                    const prj = JSON.parse(fs.readFileSync(prjPath, "utf8"));
                                    const paths = Object.keys(prj.projects || {});
                                    if (paths.length > 0) workspacePath = paths[paths.length - 1];
                                }
                            } catch (_) {}

                            const result = skillManager.applyPresetByName(targetPreset, workspacePath);
                            
                            // Notify all BrowserWindow renderer instances to refresh UI
                            const wins = BrowserWindow.getAllWindows();
                            for (const w of wins) {
                                if (!w.isDestroyed()) {
                                    w.webContents.send("controlCenter:preset-applied", result);
                                }
                            }

                            sendJson(200, { ok: true, ...result });
                        } catch (err) {
                            sendJson(500, { ok: false, error: err.message });
                        }
                    });
                    return;
                }

                if (req.method === "GET" && pathname === "/api/quotas") {
                    const https = require("https");
                    const wins = BrowserWindow.getAllWindows();
                    if (wins.length === 0 || wins[0].isDestroyed()) {
                        sendJson(500, { ok: false, error: "No window open" });
                        return;
                    }
                    try {
                        const winInfo = await wins[0].webContents.executeJavaScript(`({
                            origin: window.location.origin,
                            csrf: window.__APP_CONFIG__?.csrfToken
                        })`);
                        if (!winInfo || !winInfo.origin || !winInfo.csrf) {
                            sendJson(500, { ok: false, error: "CSRF or window URL unavailable" });
                            return;
                        }
                        const postData = JSON.stringify({ forceRefresh: true });
                        const rpcUrl = new URL("/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary", winInfo.origin);
                        const rpcReq = https.request({
                            hostname: rpcUrl.hostname,
                            port: rpcUrl.port,
                            path: rpcUrl.pathname,
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Connect-Protocol-Version": "1",
                                "x-codeium-csrf-token": winInfo.csrf,
                                "Content-Length": Buffer.byteLength(postData)
                            },
                            rejectUnauthorized: false,
                            timeout: 5000
                        }, (rpcRes) => {
                            let respBody = "";
                            rpcRes.on("data", c => { respBody += c; });
                            rpcRes.on("end", () => {
                                try {
                                    const parsed = JSON.parse(respBody || "{}");
                                    sendJson(200, { ok: true, data: parsed });
                                } catch (e) {
                                    sendJson(500, { ok: false, error: "Invalid JSON from Language Server: " + e.message });
                                }
                            });
                        });
                        rpcReq.on("error", (e) => {
                            sendJson(500, { ok: false, error: "Language Server error: " + e.message });
                        });
                        rpcReq.on("timeout", () => {
                            rpcReq.destroy();
                            sendJson(504, { ok: false, error: "Language Server timeout" });
                        });
                        rpcReq.write(postData);
                        rpcReq.end();
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                    return;
                }

                if (req.method === "POST" && pathname === "/api/focus-window") {
                    const wins = BrowserWindow.getAllWindows();
                    if (wins.length > 0) {
                        const win = wins[0];
                        if (win.isMinimized()) win.restore();
                        win.show();
                        win.focus();
                    }
                    sendJson(200, { ok: true });
                    return;
                }

                if (req.method === "POST" && pathname === "/api/switch-conversation") {
                    let body = "";
                    req.on("data", chunk => { body += chunk; });
                    req.on("end", async () => {
                        try {
                            const data = JSON.parse(body || "{}");
                            const cid = data.conversationId;
                            if (!cid) {
                                sendJson(400, { ok: false, error: "conversationId is required" });
                                return;
                            }
                            const wins = BrowserWindow.getAllWindows();
                            if (wins.length > 0) {
                                const win = wins[0];
                                if (win.isMinimized()) win.restore();
                                win.show();
                                win.focus();
                                win.webContents.send("notification:clicked", { cascadeId: cid });
                            }
                            sendJson(200, { ok: true, conversationId: cid });
                        } catch (err) {
                            sendJson(500, { ok: false, error: err.message });
                        }
                    });
                    return;
                }

                if (req.method === "POST" && pathname === "/api/new-conversation") {
                    const wins = BrowserWindow.getAllWindows();
                    if (wins.length > 0) {
                        const win = wins[0];
                        if (win.isMinimized()) win.restore();
                        win.show();
                        win.focus();
                        try {
                            await win.webContents.executeJavaScript(`(function() {
                                const btn = document.querySelector('[data-testid="new-conversation-button"]') ||
                                            document.querySelector('[data-testid="app-icon-new-conversation-button"]');
                                if (btn) { btn.click(); return { clicked: true }; }
                                window.history.pushState(null, '', '/');
                                window.dispatchEvent(new PopStateEvent('popstate'));
                                return { fallback: true };
                            })()`);
                        } catch (e) {}
                    }
                    sendJson(200, { ok: true });
                    return;
                }

                if (req.method === "POST" && pathname === "/api/eval") {
                    let body = "";
                    req.on("data", chunk => { body += chunk; });
                    req.on("end", async () => {
                        try {
                            const data = JSON.parse(body || "{}");
                            const wins = BrowserWindow.getAllWindows();
                            if (wins.length === 0) {
                                sendJson(500, { ok: false, error: "No window open" });
                                return;
                            }
                            const resEval = await wins[0].webContents.executeJavaScript(data.code);
                            sendJson(200, { ok: true, result: resEval });
                        } catch (err) {
                            sendJson(500, { ok: false, error: err.message });
                        }
                    });
                    return;
                }

                if (req.method === "POST" && pathname === "/api/inject-prompt") {
                    let body = "";
                    req.on("data", chunk => { body += chunk; });
                    req.on("end", async () => {
                        try {
                            const data = JSON.parse(body || "{}");
                            const promptText = data.prompt;
                            const targetCid = data.conversationId;
                            if (!promptText || !promptText.trim()) {
                                sendJson(400, { ok: false, error: "prompt is required" });
                                return;
                            }

                            const wins = BrowserWindow.getAllWindows();
                            if (wins.length === 0) {
                                sendJson(500, { ok: false, error: "No Antigravity window open" });
                                return;
                            }

                            const win = wins[0];
                            if (win.isMinimized()) win.restore();
                            win.show();
                            win.focus();

                            if (targetCid) {
                                win.webContents.send("notification:clicked", { cascadeId: targetCid });
                                await new Promise(r => setTimeout(r, 400));
                            }

                            const code = `
                            (async function(text) {
                                function findInput() {
                                    return document.querySelector('#antigravity\\.agentSidePanelInputBox [contenteditable="true"]') ||
                                           document.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]') ||
                                           document.querySelector('[contenteditable="true"]') ||
                                           document.querySelector('textarea[data-testid="voice-dock-input"]') ||
                                           document.querySelector('textarea[aria-label="Message this chat"]') ||
                                           document.querySelector('textarea');
                                }
                                const el = findInput();
                                if (!el) {
                                    return { ok: false, error: "No input editor (contenteditable or textarea) found in DOM" };
                                }
                                el.focus();

                                if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                                    const sel = window.getSelection();
                                    const range = document.createRange();
                                    range.selectNodeContents(el);
                                    sel.removeAllRanges();
                                    sel.addRange(range);

                                    let ok = document.execCommand('insertText', false, text);
                                    if (!ok) {
                                        el.dispatchEvent(new InputEvent('beforeinput', {
                                            inputType: 'insertText',
                                            data: text,
                                            bubbles: true,
                                            cancelable: true
                                        }));
                                    }
                                } else {
                                    const proto = window.HTMLTextAreaElement.prototype;
                                    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                    if (setter) {
                                        setter.call(el, text);
                                    } else {
                                        el.value = text;
                                    }
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                }

                                for (let i = 0; i < 15; i++) {
                                    await new Promise(r => setTimeout(r, 100));
                                    const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                                                    document.querySelector('button[aria-label="Send message"]') ||
                                                    document.querySelector('button.agy-send-button') ||
                                                    document.querySelector('button[data-testid="voice-dock-send"]') ||
                                                    document.querySelector('button[aria-label="Send"]');
                                    if (sendBtn && !sendBtn.disabled) {
                                        sendBtn.click();
                                        return { ok: true, method: "button_click", buttonId: sendBtn.getAttribute('data-testid') };
                                    }
                                }

                                el.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'Enter',
                                    code: 'Enter',
                                    keyCode: 13,
                                    which: 13,
                                    bubbles: true,
                                    cancelable: true
                                }));
                                return { ok: true, method: "enter_fallback" };
                            })(${JSON.stringify(promptText)});
                            `;

                            const injectRes = await win.webContents.executeJavaScript(code);
                            sendJson(200, { ok: true, result: injectRes });
                        } catch (err) {
                            sendJson(500, { ok: false, error: err.message });
                        }
                    });
                    return;
                }

                if (req.method === "POST" && pathname === "/api/switch-slot") {
                    let body = "";
                    req.on("data", chunk => { body += chunk; });
                    req.on("end", async () => {
                        try {
                            const data = JSON.parse(body || "{}");
                            const slot = data.slot;
                            const resSwitch = await this.switchProfile(String(slot));
                            sendJson(200, { ok: true, result: resSwitch });
                        } catch (err) {
                            sendJson(500, { ok: false, error: err.message });
                        }
                    });
                    return;
                }

                sendJson(404, { ok: false, error: "Not found: " + pathname });
            } catch (globalErr) {
                console.error("[MultiAcc Bridge Error]:", globalErr);
                sendJson(500, { ok: false, error: globalErr.message });
            }
        });

        server.on("error", (err) => {
            console.error("[MultiAcc Bridge Server Error]:", err);
        });

        server.on("error", (err) => {
            if (err.code !== "EADDRINUSE") {
                console.error("[MultiAcc Bridge Server Error]:", err);
            }
        });

        server.listen(PORT, "127.0.0.1", () => {
            console.log(`[MultiAcc Bridge Server] Listening on http://127.0.0.1:${PORT}`);
        });

        try {
            server.unref();
        } catch(_) {}

        this.httpBridgeServer = server;
    }

    startCommandWatcher() {
        const cmdFile = path.join(USER_HOME, '.gemini', 'antigravity_command.json');
        const cmdTimer = setInterval(() => {
            try {
                if (fs.existsSync(cmdFile)) {
                    const content = fs.readFileSync(cmdFile, 'utf-8');
                    fs.unlinkSync(cmdFile);
                    const cmd = JSON.parse(content);
                    this.handleBotCommand(cmd);
                }
            } catch (e) {}
        }, 1000);
        try { cmdTimer.unref(); } catch(_) {}
    }

    handleBotCommand(cmd) {
        if (!cmd || !cmd.action) return;
        console.log('[MultiAcc Bot Command]', cmd);
        if (cmd.action === 'switch_slot' && cmd.slot) {
            this.switchProfile(String(cmd.slot));
        } else if (cmd.action === 'open_conversation' || cmd.action === 'focus_window') {
            const wins = BrowserWindow.getAllWindows();
            if (wins.length > 0) {
                const win = wins[0];
                if (win.isMinimized()) win.restore();
                win.show();
                win.focus();
                if (cmd.conversationId) {
                    win.webContents.send('notification:clicked', { cascadeId: cmd.conversationId });
                }
                if (cmd.title) {
                    this.showNotification('📱 Мобильный клиент', 'Переключено на: ' + (cmd.title || ''));
                }
            }
        }
    }

    get isLoggingInReserve() {
        return this.isAddingAccount;
    }

    set isLoggingInReserve(val) {
        this.isAddingAccount = val;
    }

    setRestartCallback(cb) {
        this.restartLsCallback = cb;
    }

    async runHelper(args) {
        return new Promise((resolve, reject) => {
            execFile(PYTHON_BIN, [SCRIPT_PATH, ...args], { encoding: "utf-8" }, (err, stdout, stderr) => {
                if (err) {
                    console.error("[MultiAcc Helper Error]:", stderr || err.message);
                    return reject(err);
                }
                try {
                    const data = JSON.parse(stdout.trim());
                    resolve(data);
                } catch (e) {
                    console.error("[MultiAcc Helper JSON parse error]:", stdout);
                    reject(e);
                }
            });
        });
    }

    async getStatus() {
        try {
            return await this.runHelper(["status"]);
        } catch (e) {
            return {
                activeSlot: 1,
                currentEmail: null,
                accounts: [],
                slotsCount: 0,
                maxSlots: 4,
                autoFailover: true,
                hasReserve: false,
                active: "primary",
                primaryEmail: null,
                reserveEmail: null,
                error: e.message
            };
        }
    }

    async switchProfile(target) {
        console.log(`[MultiAcc] Switching account profile/slot to: ${target || 'next in carousel'}...`);
        const args = ["switch"];
        if (target !== undefined && target !== null && String(target).trim() !== "") {
            args.push(String(target));
        }
        const res = await this.runHelper(args);
        if (res && res.error) {
            console.error("[MultiAcc] Switch profile failed:", res.error);
            return res;
        }
        if (this.restartLsCallback) {
            try {
                await this.restartLsCallback();
            } catch (err) {
                console.error("[MultiAcc] LS restart error:", err);
            }
        }
        this.broadcastStatus(res);
        return res;
    }

    async toggleAutoFailover(val) {
        const args = ["toggle-autofailover"];
        if (typeof val === "boolean") {
            args.push(val ? "true" : "false");
        }
        const res = await this.runHelper(args);
        this.broadcastStatus(res);
        return res;
    }

    async startAddAccount(targetSlot) {
        if (this.isAddingAccount) {
            return { error: "Авторизация аккаунта уже выполняется" };
        }
        this.isAddingAccount = true;
        console.log(`[MultiAcc] Starting Account login flow (slot: ${targetSlot || 'auto'})...`);

        try {
            // 1. Prepare credentials (backup current, remove active)
            const prepArgs = ["prepare-add-login"];
            if (targetSlot) {
                prepArgs.push(String(targetSlot));
            }
            const prepRes = await this.runHelper(prepArgs);
            if (prepRes && prepRes.error) {
                this.isAddingAccount = false;
                return prepRes;
            }

            // 2. Restart LS so it detects missing credential and opens browser OAuth
            if (this.restartLsCallback) {
                await this.restartLsCallback();
            }

            // 3. Poll for new token to appear in gemini:antigravity
            const startTime = Date.now();
            const timeoutMs = 180000; // 3 minutes

            const poll = async () => {
                while (Date.now() - startTime < timeoutMs) {
                    if (!this.isAddingAccount) {
                        return { error: "Авторизация отменена пользователем" };
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    if (!this.isAddingAccount) {
                        return { error: "Авторизация отменена пользователем" };
                    }
                    try {
                        const finArgs = ["finalize-add-login"];
                        if (targetSlot) finArgs.push(String(targetSlot));
                        const finRes = await this.runHelper(finArgs);
                        if (finRes && !finRes.error && finRes.accounts && finRes.accounts.length > 0) {
                            console.log("[MultiAcc] Login successfully captured! Email:", finRes.newEmail, "Slot:", finRes.addedSlot);
                            this.isAddingAccount = false;

                            // Restart LS back to active credential
                            if (this.restartLsCallback) {
                                await this.restartLsCallback();
                            }

                            this.broadcastStatus(finRes);
                            const notifMsg = finRes.isExisting
                                ? (finRes.message || `Токен аккаунта ${finRes.newEmail} обновлен (Слот ${finRes.addedSlot})`)
                                : `Успешно привязан аккаунт: ${finRes.newEmail || 'Google'} (Слот ${finRes.addedSlot})`;
                            this.showNotification("Аккаунт подключен", notifMsg);
                            return finRes;
                        }
                    } catch (e) {
                        // ignore poll errors
                    }
                }

                // If timed out: cancel and restore
                console.warn("[MultiAcc] Login timed out. Restoring previous active account...");
                this.isAddingAccount = false;
                await this.runHelper(["cancel-add-login"]);
                if (this.restartLsCallback) {
                    await this.restartLsCallback();
                }
                const status = await this.getStatus();
                this.broadcastStatus(status);
                return { error: "Время ожидания авторизации истекло" };
            };

            return await poll();
        } catch (err) {
            this.isAddingAccount = false;
            await this.runHelper(["cancel-add-login"]);
            if (this.restartLsCallback) {
                try {
                    await this.restartLsCallback();
                } catch (e) {}
            }
            return { error: err.message };
        }
    }

    async cancelAddAccount() {
        if (!this.isAddingAccount) {
            return await this.getStatus();
        }
        console.log("[MultiAcc] Canceling account login flow...");
        this.isAddingAccount = false;
        const res = await this.runHelper(["cancel-add-login"]);
        if (this.restartLsCallback) {
            try {
                await this.restartLsCallback();
            } catch (err) {
                console.error("[MultiAcc] LS restart error:", err);
            }
        }
        this.broadcastStatus(res);
        return res;
    }

    async startReserveLogin() {
        return await this.startAddAccount();
    }

    async deleteAccount(slot) {
        console.log(`[MultiAcc] Deleting account slot: ${slot}...`);
        const res = await this.runHelper(["delete-slot", String(slot)]);
        if (res && res.error) {
            console.error("[MultiAcc] Delete account failed:", res.error);
            return res;
        }
        if (this.restartLsCallback) {
            try {
                await this.restartLsCallback();
            } catch (err) {
                console.error("[MultiAcc] LS restart error:", err);
            }
        }
        this.broadcastStatus(res);
        return res;
    }

    checkForQuotaError(line) {
        if (!line || typeof line !== "string") return;

        // Check for genuine gRPC / API errors from Google backend
        const isQuotaErr = /(?:rpc error: code = ResourceExhausted|status:\s*429|RESOURCE_EXHAUSTED.*quota|Quota exceeded for quota metric|generativelanguage.*429)/i.test(line);
        if (!isQuotaErr) return;

        const now = Date.now();
        // Debounce 25 seconds
        if (now - this.lastFailoverTime < 25000) return;

        this.triggerAutoFailover("language_server_log");
    }

    async triggerAutoFailover(source = "unknown") {
        const now = Date.now();
        if (now - this.lastFailoverTime < 20000) return;
        this.lastFailoverTime = now;

        const status = await this.getStatus();
        if (!status.autoFailover) {
            console.log("[MultiAcc] Auto-failover triggered but disabled by user setting.");
            return;
        }

        const accounts = status.accounts || [];
        if (accounts.length <= 1) {
            console.log("[MultiAcc] Quota error detected, but only 1 account in carousel.");
            this.showNotification("Лимит исчерпан", "Аккаунт исчерпал лимиты. Подключите дополнительные аккаунты в карусель!");
            return;
        }

        // Find current slot index and next slot in carousel
        const currentIndex = accounts.findIndex(a => a.slot === status.activeSlot);
        const nextIndex = (currentIndex + 1) % accounts.length;
        const nextAccount = accounts[nextIndex];
        const nextSlot = nextAccount.slot;

        console.log(`[MultiAcc] Quota exhausted! Executing carousel auto-failover from slot ${status.activeSlot} (${status.currentEmail}) to slot ${nextSlot} (${nextAccount.email}). Source: ${source}`);

        try {
            const newStatus = await this.switchProfile(String(nextSlot));
            if (newStatus && !newStatus.error) {
                this.showNotification("⚡ Лимит исчерпан. Автопереход!", `Переход на аккаунт [${nextSlot}/${accounts.length}] ${nextAccount.email}`);

                
            // Send push alert to Telegram Bot if available
            try {
                const botScript = path.join(USER_HOME, '.gemini', 'antigravity', 'bin', 'antigravity_bot.py');
                if (fs.existsSync(botScript)) {
                    const alertMsg = "⚡ <b>Лимит исчерпан!</b>\nВыполнен автопереход на слот [" + nextSlot + "/" + accounts.length + "]: <code>" + nextAccount.email + "</code>";
                    execFile(PYTHON_BIN, [botScript, 'notify', alertMsg], () => {});
                }
            } catch (e) {}

                // Notify UI
                for (const win of BrowserWindow.getAllWindows()) {
                    win.webContents.send("multiacc:failover-occurred", {
                        from: status.currentEmail,
                        to: nextAccount.email,
                        fromSlot: status.activeSlot,
                        toSlot: nextSlot,
                        source
                    });
                }
            }
        } catch (e) {
            console.error("[MultiAcc] Failover switch failed:", e);
        }
    }

    broadcastStatus(status) {
        if (!status || status.error) return;
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("multiacc:status-changed", status);
        }
    }

    showNotification(title, body) {
        try {
            const notif = new Notification({ title, body });
            notif.show();
        } catch (e) {
            // ignore notification failure
        }
    }

    isBotPortListening() {
        return new Promise((resolve) => {
            const net = require('net');
            const s = new net.Socket();
            s.setTimeout(500);
            s.on('connect', () => {
                s.destroy();
                resolve(true);
            });
            s.on('error', () => {
                resolve(false);
            });
            s.on('timeout', () => {
                s.destroy();
                resolve(false);
            });
            s.connect(51123, '127.0.0.1');
        });
    }

    async isBotRunning() {
        if (this.botProcess && !this.botProcess.killed && this.botProcess.exitCode === null) {
            return true;
        }
        return await this.isBotPortListening();
    }

    startBotWatcher() {
        this.lastBotRunningState = null;
        const botTimer = setInterval(async () => {
            try {
                const isRunning = await this.isBotRunning();
                if (isRunning !== this.lastBotRunningState) {
                    this.lastBotRunningState = isRunning;
                    this.broadcastBotStatus(isRunning);
                }
            } catch (e) {}
        }, 2500);
        try { botTimer.unref(); } catch(_) {}
    }

    async getBotStatus() {
        const botConfigPath = path.join(USER_HOME, '.gemini', 'antigravity_telegram.json');
        let cfg = { botToken: '', allowedChatId: null, enabled: false };
        if (fs.existsSync(botConfigPath)) {
            try {
                cfg = JSON.parse(fs.readFileSync(botConfigPath, 'utf-8'));
            } catch (e) {}
        }
        const isRunning = await this.isBotRunning();
        return {
            running: isRunning,
            configured: !!(cfg.botToken && cfg.botToken.trim()),
            botToken: cfg.botToken || '',
            allowedChatId: cfg.allowedChatId || null,
            enabled: !!cfg.enabled
        };
    }

    async saveBotConfig(cfg) {
        const botConfigPath = path.join(USER_HOME, '.gemini', 'antigravity_telegram.json');
        let current = { botToken: '', allowedChatId: null, enabled: false };
        if (fs.existsSync(botConfigPath)) {
            try {
                current = JSON.parse(fs.readFileSync(botConfigPath, 'utf-8'));
            } catch (e) {}
        }
        if (cfg.botToken !== undefined) current.botToken = (cfg.botToken || '').trim();
        if (cfg.allowedChatId !== undefined && cfg.allowedChatId !== null && cfg.allowedChatId !== '') {
            current.allowedChatId = Number(cfg.allowedChatId) || null;
        }
        if (cfg.enabled !== undefined) current.enabled = !!cfg.enabled;
        fs.mkdirSync(path.dirname(botConfigPath), { recursive: true });
        fs.writeFileSync(botConfigPath, JSON.stringify(current, null, 2), 'utf-8');
        return await this.getBotStatus();
    }

    async toggleBot() {
        const botScriptPath = path.join(USER_HOME, '.gemini', 'antigravity', 'bin', 'antigravity_bot.py');
        const status = await this.getBotStatus();
        if (status.running) {
            console.log('[MultiAcc Bot] Stopping Telegram Bot...');
            if (this.botProcess) {
                try {
                    this.botProcess.kill();
                } catch (e) {}
                this.botProcess = null;
            }
            try {
                const { execSync } = require('child_process');
                const out = execSync('netstat -ano -p tcp', { encoding: 'utf-8' });
                const lines = out.split('\n').filter(l => l.includes(':51123') && l.includes('LISTENING'));
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && pid !== '0' && pid !== String(process.pid)) {
                        try {
                            process.kill(Number(pid), 'SIGTERM');
                        } catch (e) {
                            try {
                                execSync(`taskkill /F /PID ${pid}`);
                            } catch (e2) {}
                        }
                    }
                }
            } catch (e) {}

            await this.saveBotConfig({ ...status, enabled: false });
            this.broadcastBotStatus(false);
            return { running: false };
        } else {
            if (!status.configured) {
                return { error: 'need_config' };
            }
            console.log('[MultiAcc Bot] Spawning Telegram Bot daemon...');
            try {
                const { spawn } = require('child_process');
                const pyCmd = process.platform === 'win32' ? 'pythonw' : 'python3';
                const proc = spawn(pyCmd, [botScriptPath], {
                    detached: true,
                    stdio: 'ignore'
                });
                proc.unref();
                this.botProcess = proc;
                proc.on('exit', (code) => {
                    console.log('[MultiAcc Bot] Bot process exited with code:', code);
                    this.botProcess = null;
                    this.isBotRunning().then(r => this.broadcastBotStatus(r));
                });
                await this.saveBotConfig({ ...status, enabled: true });
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 200));
                    if (await this.isBotRunning()) break;
                }
                const runningNow = await this.isBotRunning();
                this.broadcastBotStatus(runningNow);
                return { running: runningNow };
            } catch (err) {
                console.error('[MultiAcc Bot] Failed to spawn bot:', err);
                return { error: err.message };
            }
        }
    }

    broadcastBotStatus(running) {
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('multiacc:bot-status-changed', { running });
        }
    }


    startWebDashboard() {
        const isTest = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test'));
        if (isTest) return;
        try {
            const { startWebDashboard } = require('./webDashboard');
            this.webDashboard = startWebDashboard(this);
        } catch (e) {
            console.error('[MultiAcc] Failed to start Web Dashboard:', e);
        }
    }

    autoStartBotIfEnabled() {
        const isTest = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test'));
        if (isTest) return;
        const t = setTimeout(async () => {
            try {
                const status = await this.getBotStatus();
                if (status.configured && !status.running) {
                    const botConfigPath = path.join(USER_HOME, '.gemini', 'antigravity_telegram.json');
                    if (fs.existsSync(botConfigPath)) {
                        const cfg = JSON.parse(fs.readFileSync(botConfigPath, 'utf-8'));
                        if (cfg.enabled) {
                            console.log('[MultiAcc Bot] Auto-starting enabled Telegram bot daemon...');
                            await this.toggleBot();
                        }
                    }
                }
            } catch (e) {}
        }, 2500);
        try { t.unref(); } catch (_) {}
    }

    focusWindow() {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
            const win = wins[0];
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            return { ok: true };
        }
        return { ok: false, error: "No window open" };
    }

    async newConversation() {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
            const win = wins[0];
            if (win.isMinimized()) win.restore();
            await win.webContents.executeJavaScript(`(function() {
                const btn = document.querySelector('[data-testid="new-conversation-button"]') ||
                            document.querySelector('[data-testid="app-icon-new-conversation-button"]');
                if (btn) { btn.click(); return { clicked: true }; }
                window.history.pushState(null, '', '/');
                window.dispatchEvent(new PopStateEvent('popstate'));
                return { fallback: true };
            })()`);
            return { ok: true };
        }
        return { ok: false, error: "No window open" };
    }

    async injectPrompt(promptText, targetCid = null) {
        if (!promptText || !promptText.trim()) {
            throw new Error("prompt is required");
        }
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) {
            throw new Error("No Antigravity window open");
        }
        const win = wins[0];
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();

        if (targetCid) {
            win.webContents.send("notification:clicked", { cascadeId: targetCid });
            await new Promise(r => setTimeout(r, 400));
        }

        const code = `
        (async function(text) {
            function findInput() {
                return document.querySelector('#antigravity\\.agentSidePanelInputBox [contenteditable="true"]') ||
                       document.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]') ||
                       document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('textarea[data-testid="voice-dock-input"]') ||
                       document.querySelector('textarea[aria-label="Message this chat"]') ||
                       document.querySelector('textarea');
            }
            const el = findInput();
            if (!el) {
                return { ok: false, error: "No input editor (contenteditable or textarea) found in DOM" };
            }
            el.focus();

            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(el);
                sel.removeAllRanges();
                sel.addRange(range);

                let ok = document.execCommand('insertText', false, text);
                if (!ok) {
                    el.dispatchEvent(new InputEvent('beforeinput', {
                        inputType: 'insertText',
                        data: text,
                        bubbles: true,
                        cancelable: true
                    }));
                }
            } else {
                const proto = window.HTMLTextAreaElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) {
                    setter.call(el, text);
                } else {
                    el.value = text;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 100));
                const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send message"]') ||
                                document.querySelector('button.agy-send-button') ||
                                document.querySelector('button[data-testid="voice-dock-send"]') ||
                                document.querySelector('button[aria-label="Send"]');
                if (sendBtn && !sendBtn.disabled) {
                    sendBtn.click();
                    return { ok: true, method: "button_click", buttonId: sendBtn.getAttribute('data-testid') };
                }
            }

            el.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            }));
            return { ok: true, method: "enter_fallback" };
        })(${JSON.stringify(promptText)});
        `;
        return await win.webContents.executeJavaScript(code);
    }

    async getQuotas() {
        const https = require("https");
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0 || wins[0].isDestroyed()) {
            return { ok: false, error: "No window open" };
        }
        const winInfo = await wins[0].webContents.executeJavaScript(`({
            origin: window.location.origin,
            csrf: window.__APP_CONFIG__?.csrfToken
        })`);
        if (!winInfo || !winInfo.origin || !winInfo.csrf) {
            return { ok: false, error: "CSRF or window URL unavailable" };
        }
        return new Promise((resolve) => {
            const postData = JSON.stringify({ forceRefresh: true });
            const rpcUrl = new URL("/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary", winInfo.origin);
            const rpcReq = https.request({
                hostname: rpcUrl.hostname,
                port: rpcUrl.port,
                path: rpcUrl.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Connect-Protocol-Version": "1",
                    "x-codeium-csrf-token": winInfo.csrf,
                    "Content-Length": Buffer.byteLength(postData)
                },
                rejectUnauthorized: false,
                timeout: 5000
            }, (rpcRes) => {
                let respBody = "";
                rpcRes.on("data", c => { respBody += c; });
                rpcRes.on("end", () => {
                    try {
                        const parsed = JSON.parse(respBody || "{}");
                        resolve({ ok: true, data: parsed });
                    } catch (e) {
                        resolve({ ok: false, error: "Invalid JSON from Language Server: " + e.message });
                    }
                });
            });
            rpcReq.on("error", (e) => {
                resolve({ ok: false, error: "Language Server error: " + e.message });
            });
            rpcReq.on("timeout", () => {
                rpcReq.destroy();
                resolve({ ok: false, error: "Language Server quota timeout" });
            });
            rpcReq.write(postData);
            rpcReq.end();
        });
    }
}

exports.multiaccManager = new MultiaccManager();
