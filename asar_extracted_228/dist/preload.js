"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Preload script — runs in every BrowserWindow before the page loads.
 * Exposes a minimal, secure API via contextBridge so the renderer can
 * communicate with the main-process auto-updater without nodeIntegration.
 */
const electron_1 = require("electron");
const updaterAPI = {
    onStateChanged: (callback) => {
        const handler = (_event, state) => {
            callback(state);
        };
        electron_1.ipcRenderer.on('updater:state-changed', handler);
        // Return unsubscribe function
        return () => {
            electron_1.ipcRenderer.removeListener('updater:state-changed', handler);
        };
    },
    applyUpdate: () => electron_1.ipcRenderer.invoke('updater:apply'),
    quitAndInstall: () => electron_1.ipcRenderer.invoke('updater:quit-and-install'),
    checkForUpdates: () => electron_1.ipcRenderer.invoke('updater:check-for-updates'),
    getState: () => electron_1.ipcRenderer.invoke('updater:get-state'),
};
const dialogAPI = {
    showOpenDialog: () => electron_1.ipcRenderer.invoke('dialog:open-workspace'),
    showOpenMultipleFolderDialog: () => electron_1.ipcRenderer.invoke('dialog:open-workspaces'),
};
const notificationAPI = {
    send: (options) => electron_1.ipcRenderer.invoke('notification:send', options),
    openSystemPreferences: () => electron_1.ipcRenderer.invoke('notification:open-system-preferences'),
    onClicked: (callback) => {
        const handler = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('notification:clicked', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('notification:clicked', handler);
        };
    },
};
const storageAPI = {
    getItems: () => electron_1.ipcRenderer.invoke('storage:get-items'),
    updateItems: (changes) => electron_1.ipcRenderer.invoke('storage:update-items', changes),
    onChanged: (callback) => {
        const handler = (_event, changes) => {
            callback(changes);
        };
        electron_1.ipcRenderer.on('storage:changed', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('storage:changed', handler);
        };
    },
};
const logsAPI = {
    getElectronLogs: () => electron_1.ipcRenderer.invoke('logs:electron'),
};
const extensionsAPI = {
    sendAuthorities: (authoritiesMap) => electron_1.ipcRenderer.invoke('extensions:send-authorities', authoritiesMap),
};
const deepLinkAPI = {
    onDeepLink: (callback) => {
        const handler = (_event, url) => {
            callback(url);
        };
        electron_1.ipcRenderer.on('deep-link', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('deep-link', handler);
        };
    },
    getStoredDeepLink: () => electron_1.ipcRenderer.invoke('deep-link:get-stored'),
};
const agentAPI = {
    updateActiveAgentCount: (count) => electron_1.ipcRenderer.invoke('agent:update-active-count', count),
};
const electronNativeAPI = {
    getZoomLevel: () => electron_1.webFrame.getZoomFactor(),
    getPathForFile: (file) => electron_1.webUtils.getPathForFile(file),
    setTitleBarOverlay: (options) => electron_1.ipcRenderer.invoke('window:set-title-bar-overlay', options),
    minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
    maximize: () => electron_1.ipcRenderer.invoke('window:maximize'),
    unmaximize: () => electron_1.ipcRenderer.invoke('window:unmaximize'),
    isMaximized: () => electron_1.ipcRenderer.invoke('window:is-maximized'),
    close: () => electron_1.ipcRenderer.invoke('window:close'),
    toggleDevTools: () => electron_1.ipcRenderer.invoke('window:toggle-devtools'),
    zoomIn: () => {
        void electron_1.ipcRenderer.invoke('window:zoom-in');
    },
    zoomOut: () => {
        void electron_1.ipcRenderer.invoke('window:zoom-out');
    },
    resetZoom: () => {
        void electron_1.ipcRenderer.invoke('window:reset-zoom');
    },
    openExternal: (url) => electron_1.ipcRenderer.invoke('shell:open-external', url),
    revealInFilePicker: (path) => electron_1.ipcRenderer.invoke('shell:reveal-in-file-picker', path),
    showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', items),
    closeContextMenu: () => electron_1.ipcRenderer.invoke('window:close-context-menu'),
    executeJavaScriptInIsolatedWorld: (wcId, worldId, code) => electron_1.ipcRenderer.invoke('webview:execute-js-isolated-world', wcId, worldId, code),
    runScriptInJail: (req) => electron_1.ipcRenderer.invoke('script-jail:run', req),
    abortScriptJail: (jailId) => electron_1.ipcRenderer.invoke('script-jail:abort', jailId),
    subscribeWebviewSecurityState: (webContentsId, callback) => {
        // The push channel and the initial fetch can race; `seq` orders them.
        let latestSeq = 0;
        let subscribed = true;
        const deliver = (state) => {
            if (!subscribed ||
                !state ||
                state.webContentsId !== webContentsId ||
                state.seq <= latestSeq) {
                return;
            }
            latestSeq = state.seq;
            callback(state);
        };
        const handler = (_event, state) => {
            deliver(state);
        };
        electron_1.ipcRenderer.on('webview:security-state-changed', handler);
        void electron_1.ipcRenderer
            .invoke('webview:get-security-state', webContentsId)
            .then(deliver, () => undefined);
        return () => {
            subscribed = false;
            electron_1.ipcRenderer.removeListener('webview:security-state-changed', handler);
        };
    },
    onWebviewOpenNewTab: (callback) => {
        const handler = (_event, url, webContentsId) => {
            callback(url, webContentsId);
        };
        electron_1.ipcRenderer.on('webview:open-new-tab', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('webview:open-new-tab', handler);
        };
    },
    onWebviewFaviconUpdated: (callback) => {
        const handler = (_event, payload) => {
            callback(payload);
        };
        electron_1.ipcRenderer.on('webview:favicon-updated', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('webview:favicon-updated', handler);
        };
    },
};
electron_1.ipcRenderer.on('agy-script-jail:port', (event, payload) => {
    window.postMessage({
        type: 'agy-script-jail-port',
        jailId: payload?.jailId,
    }, '*', event.ports);
});
const ideAPI = {
    isInstalled: () => electron_1.ipcRenderer.invoke('ide:is-installed'),
};
const wslAPI = {
    getState: () => electron_1.ipcRenderer.invoke('wsl:get-state'),
    connect: (distro) => electron_1.ipcRenderer.invoke('wsl:connect', distro),
};
electron_1.contextBridge.exposeInMainWorld('electronUpdater', updaterAPI);
electron_1.contextBridge.exposeInMainWorld('dialog', dialogAPI);
electron_1.contextBridge.exposeInMainWorld('nativeNotifications', notificationAPI);
electron_1.contextBridge.exposeInMainWorld('nativeStorage', storageAPI);
electron_1.contextBridge.exposeInMainWorld('logs', logsAPI);
electron_1.contextBridge.exposeInMainWorld('extensions', extensionsAPI);
electron_1.contextBridge.exposeInMainWorld('deepLink', deepLinkAPI);
electron_1.contextBridge.exposeInMainWorld('agent', agentAPI);
electron_1.contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);
electron_1.contextBridge.exposeInMainWorld('ide', ideAPI);
electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);

// --- Antigravity MultiAcc UI & API ---
const multiaccAPI = {
    getStatus: () => electron_1.ipcRenderer.invoke('multiacc:get-status'),
    switchProfile: (target) => electron_1.ipcRenderer.invoke('multiacc:switch', target),
    toggleAutoFailover: (val) => electron_1.ipcRenderer.invoke('multiacc:toggle-autofailover', val),
    loginReserve: () => electron_1.ipcRenderer.invoke('multiacc:login-reserve'),
    addAccount: (slot) => electron_1.ipcRenderer.invoke('multiacc:add-account', slot),
    cancelAddAccount: () => electron_1.ipcRenderer.invoke('multiacc:cancel-add'),
    deleteAccount: (slot) => electron_1.ipcRenderer.invoke('multiacc:delete-account', slot),
    reportQuotaError: () => electron_1.ipcRenderer.invoke('multiacc:report-quota-error'),
    onStatusChanged: (callback) => {
        const handler = (_event, state) => callback(state);
        electron_1.ipcRenderer.on('multiacc:status-changed', handler);
        return () => electron_1.ipcRenderer.removeListener('multiacc:status-changed', handler);
    },
    onFailoverOccurred: (callback) => {
        const handler = (_event, info) => callback(info);
        electron_1.ipcRenderer.on('multiacc:failover-occurred', handler);
        return () => electron_1.ipcRenderer.removeListener('multiacc:failover-occurred', handler);
    },
    getBotStatus: () => electron_1.ipcRenderer.invoke('multiacc:get-bot-status'),
    toggleBot: () => electron_1.ipcRenderer.invoke('multiacc:toggle-bot'),
    saveBotConfig: (cfg) => electron_1.ipcRenderer.invoke('multiacc:save-bot-config', cfg),
    onBotStatusChanged: (callback) => {
        const handler = (_event, state) => callback(state);
        electron_1.ipcRenderer.on('multiacc:bot-status-changed', handler);
        return () => electron_1.ipcRenderer.removeListener('multiacc:bot-status-changed', handler);
    }
};
electron_1.contextBridge.exposeInMainWorld('multiacc', multiaccAPI);

// --- Antigravity Skill & MCP Control Center API ---
const controlCenterAPI = {
    getState: () => electron_1.ipcRenderer.invoke('controlCenter:get-state'),
    toggleSkill: (skillPath, enabled) => electron_1.ipcRenderer.invoke('controlCenter:toggle-skill', { skillPath, enabled }),
    applyPreset: (presetSkills) => electron_1.ipcRenderer.invoke('controlCenter:apply-preset', presetSkills),
    toggleMcp: (serverName, enabled) => electron_1.ipcRenderer.invoke('controlCenter:toggle-mcp', { serverName, enabled }),
    createSkill: (payload) => electron_1.ipcRenderer.invoke('controlCenter:create-skill', payload),
    importSkill: (payload) => electron_1.ipcRenderer.invoke('controlCenter:import-skill', payload),
    applyPresetByName: (name) => electron_1.ipcRenderer.invoke('controlCenter:apply-preset-by-name', name),
    onPresetApplied: (callback) => {
        const handler = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('controlCenter:preset-applied', handler);
        return () => electron_1.ipcRenderer.removeListener('controlCenter:preset-applied', handler);
    }
};
electron_1.contextBridge.exposeInMainWorld('controlCenter', controlCenterAPI);

// UI Injection in Window
(function initMultiaccWidget() {
    function injectUI() {
        if (!document.body || document.getElementById('antigravity-multiacc-root')) return;

        const style = document.createElement('style');
        style.id = 'antigravity-multiacc-styles';
        style.textContent = `
            #antigravity-multiacc-root {
                position: fixed;
                top: 4px;
                right: 145px;
                z-index: 99999999;
                display: flex;
                align-items: center;
                gap: 6px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 11px;
                -webkit-app-region: no-drag;
                user-select: none;
            }
            .multiacc-pill-container {
                position: relative;
                display: flex;
                align-items: center;
                gap: 6px;
                background: rgba(24, 25, 29, 0.94);
                border: 1px solid rgba(255, 255, 255, 0.14);
                backdrop-filter: blur(10px);
                border-radius: 6px;
                padding: 3px 8px;
                color: #e2e8f0;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
            }
            .multiacc-indicator {
                display: flex;
                align-items: center;
                gap: 5px;
                font-weight: 500;
                cursor: pointer;
                padding: 1px 4px;
                border-radius: 4px;
                transition: background 0.15s ease;
            }
            .multiacc-indicator:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            .multiacc-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #10b981;
                box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
                flex-shrink: 0;
            }
            .multiacc-dot.inactive {
                background: #64748b;
                box-shadow: none;
            }
            .multiacc-arrow {
                font-size: 8px;
                opacity: 0.7;
                margin-left: 2px;
            }
            .multiacc-btn {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.16);
                color: #f1f5f9;
                border-radius: 4px;
                padding: 2px 7px;
                font-size: 11px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
                white-space: nowrap;
            }
            .multiacc-btn:hover {
                background: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.3);
            }
            .multiacc-btn.action-primary {
                background: #2563eb;
                border-color: #3b82f6;
                color: #ffffff;
                font-weight: 500;
            }
            .multiacc-btn.action-primary:hover {
                background: #1d4ed8;
            }
            .multiacc-btn:disabled {
                opacity: 0.6;
                cursor: wait;
            }
            .multiacc-toggle {
                background: rgba(16, 185, 129, 0.15);
                border: 1px solid rgba(16, 185, 129, 0.4);
                color: #34d399;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
            }
            .multiacc-toggle.off {
                background: rgba(239, 68, 68, 0.12);
                border-color: rgba(239, 68, 68, 0.35);
                color: #f87171;
            }
            .multiacc-dropdown {
                position: absolute;
                top: calc(100% + 5px);
                left: 0;
                z-index: 999999999;
                background: #18191d;
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.65);
                padding: 6px;
                min-width: 250px;
                max-width: 320px;
                display: flex;
                flex-direction: column;
                gap: 2px;
                -webkit-app-region: no-drag;
                animation: multiacc-fadein 0.15s ease;
            }
            .multiacc-dropdown-header {
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #94a3b8;
                padding: 4px 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                margin-bottom: 4px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .multiacc-dropdown-item {
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 6px 8px;
                border-radius: 5px;
                cursor: pointer;
                color: #cbd5e1;
                font-size: 11px;
                transition: background 0.12s ease;
            }
            .multiacc-dropdown-item:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #ffffff;
            }
            .multiacc-dropdown-item.active {
                background: rgba(37, 99, 235, 0.2);
                border: 1px solid rgba(59, 130, 246, 0.3);
                color: #ffffff;
            }
            .multiacc-item-slot {
                font-weight: 600;
                font-size: 10px;
                color: #94a3b8;
            }
            .multiacc-item-email {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .multiacc-badge-active {
                font-size: 9px;
                background: #10b981;
                color: #022c22;
                font-weight: 600;
                padding: 1px 4px;
                border-radius: 3px;
            }
            .multiacc-item-del {
                background: transparent;
                border: none;
                color: #ef4444;
                cursor: pointer;
                padding: 2px 4px;
                font-size: 11px;
                opacity: 0.6;
                border-radius: 3px;
                line-height: 1;
            }
            .multiacc-item-del:hover {
                opacity: 1;
                background: rgba(239, 68, 68, 0.2);
            }
            .multiacc-dropdown-add {
                margin-top: 4px;
                padding: 6px 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                color: #60a5fa;
                cursor: pointer;
                border-radius: 4px;
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                font-weight: 500;
            }
            .multiacc-dropdown-add:hover {
                background: rgba(59, 130, 246, 0.15);
            }
            .multiacc-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 9999999999;
                background: #18191d;
                border: 1px solid #3b82f6;
                border-left: 4px solid #3b82f6;
                color: #f8fafc;
                padding: 12px 18px;
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
                font-size: 13px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                animation: multiacc-fadein 0.3s ease;
            }
            
            .multiacc-btn-bot-on {
                color: #34d399 !important;
                border-color: rgba(16, 185, 129, 0.5) !important;
                background: rgba(16, 185, 129, 0.15) !important;
            }
            .multiacc-modal-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.65);
                z-index: 9999999999;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(4px);
                -webkit-app-region: no-drag;
            }
            .multiacc-modal-card {
                background: #18191d;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                width: 380px;
                padding: 16px;
                box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7);
                color: #e2e8f0;
                display: flex;
                flex-direction: column;
                gap: 12px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .multiacc-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 13px;
                font-weight: 600;
            }
            .multiacc-form-group {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .multiacc-form-group label {
                font-size: 11px;
                color: #94a3b8;
            }
            .multiacc-form-group input {
                background: #0f172a;
                border: 1px solid #334155;
                border-radius: 4px;
                color: #f8fafc;
                padding: 6px 8px;
                font-size: 11px;
                outline: none;
            }
            .multiacc-form-group input:focus {
                border-color: #3b82f6;
            }
            .multiacc-modal-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 4px;
            }

            @keyframes multiacc-fadein {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'antigravity-multiacc-root';
        root.innerHTML = `
            <div class="multiacc-pill-container">
                <div class="multiacc-indicator" id="multiacc-indicator" title="Нажмите для списка аккаунтов">
                    <span class="multiacc-dot" id="multiacc-dot"></span>
                    <span id="multiacc-label">Загрузка...</span>
                    <span class="multiacc-arrow">▾</span>
                </div>
                <button class="multiacc-btn" id="multiacc-cycle-btn" title="След. аккаунт в карусели">↻ След. аккаунт</button>
                <button class="multiacc-btn action-primary" id="multiacc-add-btn" title="Добавить аккаунт в карусель">➕ Добавить</button>
                <button class="multiacc-toggle" id="multiacc-toggle" title="Автоматически переходить на след. аккаунт при исчерпании лимитов">⚡ Авто: ВКЛ</button>
                <button class="multiacc-btn" id="multiacc-bot-btn" title="ЛКМ: Вкл/Выкл бота | ПКМ: Настройки Telegram">🤖 Бот: ⚪ ВЫКЛ</button>
                <div class="multiacc-dropdown" id="multiacc-dropdown" style="display: none;"></div>
            </div>
            <div class="multiacc-modal-overlay" id="multiacc-bot-modal" style="display: none;">
                <div class="multiacc-modal-card">
                    <div class="multiacc-modal-header">
                        <span>⚙️ Настройка Telegram Мобильного Бота</span>
                        <span style="cursor:pointer; padding:2px 6px;" id="multiacc-bot-modal-close">✕</span>
                    </div>
                    <div style="font-size:11px; color:#94a3b8; line-height: 1.4;">
                        Управляйте Антигравити с телефона: переключайте аккаунты, отправляйте задачи, голос и получайте уведомления.
                    </div>
                    <div class="multiacc-form-group">
                        <label>Bot Token (@BotFather):</label>
                        <input type="password" id="multiacc-bot-token-input" placeholder="123456789:ABCdef..." spellcheck="false" autocomplete="off" />
                    </div>
                    <div class="multiacc-form-group">
                        <label>Telegram User ID (@userinfobot):</label>
                        <input type="text" id="multiacc-bot-chatid-input" placeholder="123456789 (оставьте пустым для автопривязки)" spellcheck="false" autocomplete="off" />
                    </div>
                    <div class="multiacc-modal-actions">
                        <button class="multiacc-btn" id="multiacc-bot-modal-cancel">Отмена</button>
                        <button class="multiacc-btn action-primary" id="multiacc-bot-modal-save">💾 Сохранить и запустить</button>
                    </div>
                </div>
            </div>

        `;
        document.body.appendChild(root);

        const dot = document.getElementById('multiacc-dot');
        const label = document.getElementById('multiacc-label');
        const indicator = document.getElementById('multiacc-indicator');
        const cycleBtn = document.getElementById('multiacc-cycle-btn');
        const addBtn = document.getElementById('multiacc-add-btn');
        const toggle = document.getElementById('multiacc-toggle');
        const dropdown = document.getElementById('multiacc-dropdown');

        let currentState = null;
        let isAddingAccountActive = false;

        function updateView(state) {
            if (!state || state.error) return;
            currentState = state;

            const accounts = state.accounts || [];
            const activeSlot = state.activeSlot || 1;
            const currentAcc = accounts.find(a => a.slot === activeSlot) || accounts[0];
            const email = (currentAcc ? currentAcc.email : state.currentEmail) || 'Аккаунт';
            const shortEmail = email.length > 18 ? email.substring(0, 16) + '...' : email;

            dot.className = 'multiacc-dot';
            label.textContent = `[${activeSlot}/${accounts.length || 1}] ${shortEmail}`;
            indicator.title = `Текущий аккаунт: ${email} (Слот ${activeSlot} из ${accounts.length}). Нажмите для выбора.`;

            // Cycle button
            if (accounts.length > 1) {
                cycleBtn.style.display = 'inline-block';
                const curIdx = accounts.findIndex(a => a.slot === activeSlot);
                const nextAcc = accounts[(curIdx + 1) % accounts.length];
                cycleBtn.title = `Переключиться на следующий: ${nextAcc ? nextAcc.email : ''}`;
            } else {
                cycleBtn.style.display = 'none';
            }

            // Add button
            const maxSlots = state.maxSlots || 4;
            if (accounts.length < maxSlots) {
                addBtn.style.display = 'inline-block';
                if (!isAddingAccountActive) {
                    addBtn.textContent = '➕ Добавить';
                    addBtn.title = `Добавить аккаунт (слот ${accounts.length + 1} из ${maxSlots})`;
                }
            } else {
                addBtn.style.display = 'none';
            }

            // Toggle button
            if (state.autoFailover) {
                toggle.className = 'multiacc-toggle';
                toggle.textContent = '⚡ Авто: ВКЛ';
            } else {
                toggle.className = 'multiacc-toggle off';
                toggle.textContent = '⚡ Авто: ВЫКЛ';
            }

            // Refresh dropdown if open
            if (dropdown.style.display !== 'none') {
                renderDropdown(state);
            }
        }

        function renderDropdown(state) {
            const accounts = state.accounts || [];
            const maxSlots = state.maxSlots || 4;
            let html = `<div class="multiacc-dropdown-header">
                <span>Карусель аккаунтов (${accounts.length}/${maxSlots})</span>
                <span style="cursor:pointer;" id="multiacc-dd-close">✕</span>
            </div>`;

            accounts.forEach(acc => {
                const isActive = acc.slot === state.activeSlot;
                html += `
                    <div class="multiacc-dropdown-item ${isActive ? 'active' : ''}" data-slot="${acc.slot}">
                        <span class="multiacc-dot ${isActive ? '' : 'inactive'}"></span>
                        <span class="multiacc-item-slot">[${acc.slot}/${accounts.length}]</span>
                        <span class="multiacc-item-email" title="${acc.email}">${acc.email}</span>
                        ${isActive ? '<span class="multiacc-badge-active">Активен</span>' : ''}
                        ${accounts.length > 1 ? `<button class="multiacc-item-del" data-del-slot="${acc.slot}" title="Удалить аккаунт ${acc.email} из карусели">✕</button>` : ''}
                    </div>
                `;
            });

            if (accounts.length < maxSlots) {
                html += `<div class="multiacc-dropdown-add" id="multiacc-dd-add">➕ Добавить слот (${accounts.length + 1})</div>`;
            }

            dropdown.innerHTML = html;

            const closeBtn = document.getElementById('multiacc-dd-close');
            if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); dropdown.style.display = 'none'; };

            // Item click to switch
            dropdown.querySelectorAll('.multiacc-dropdown-item').forEach(el => {
                el.onclick = async (e) => {
                    if (e.target.classList.contains('multiacc-item-del')) return;
                    const slot = el.getAttribute('data-slot');
                    dropdown.style.display = 'none';
                    if (slot && Number(slot) !== state.activeSlot) {
                        try {
                            const res = await multiaccAPI.switchProfile(slot);
                            if (res && res.error) {
                                showToast('❌ ' + res.error);
                            } else {
                                updateView(res);
                            }
                        } catch (err) {
                            showToast('❌ Ошибка переключения: ' + err.message);
                        }
                    }
                };
            });

            // Delete buttons
            dropdown.querySelectorAll('.multiacc-item-del').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const slot = btn.getAttribute('data-del-slot');
                    const acc = accounts.find(a => String(a.slot) === String(slot));
                    const email = acc ? acc.email : `Слот ${slot}`;
                    if (confirm(`Удалить аккаунт ${email} из карусели?`)) {
                        dropdown.style.display = 'none';
                        try {
                            const res = await multiaccAPI.deleteAccount(slot);
                            if (res && res.error) {
                                showToast('❌ ' + res.error);
                            } else {
                                updateView(res);
                                showToast(`Аккаунт ${email} удален из карусели.`);
                            }
                        } catch (err) {
                            showToast('❌ Ошибка удаления: ' + err.message);
                        }
                    }
                };
            });

            // Add button in dropdown
            const ddAdd = document.getElementById('multiacc-dd-add');
            if (ddAdd) {
                ddAdd.onclick = (e) => {
                    e.stopPropagation();
                    dropdown.style.display = 'none';
                    handleAddAccount();
                };
            }
        }

        // Dropdown toggle
        indicator.onclick = (e) => {
            e.stopPropagation();
            if (dropdown.style.display === 'none') {
                if (currentState) renderDropdown(currentState);
                dropdown.style.display = 'flex';
            } else {
                dropdown.style.display = 'none';
            }
        };

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!root.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        // Cycle button click
        cycleBtn.onclick = async () => {
            cycleBtn.disabled = true;
            cycleBtn.textContent = '⏳...';
            try {
                const res = await multiaccAPI.switchProfile();
                if (res && res.error) {
                    showToast('❌ ' + res.error);
                } else {
                    updateView(res);
                }
            } catch (e) {
                showToast('❌ Ошибка переключения: ' + e.message);
            } finally {
                cycleBtn.disabled = false;
                cycleBtn.textContent = '↻ След. аккаунт';
            }
        };

        // Add Account Flow
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
                    const updated = await multiaccAPI.getStatus();
                    updateView(updated);
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
                } else if (res && res.accounts) {
                    const msg = res.isExisting
                        ? (res.message || `Аккаунт ${res.newEmail} уже подключен (Слот ${res.addedSlot})`)
                        : `✅ Аккаунт ${res.newEmail || 'Google'} успешно добавлен в слот ${res.addedSlot}!`;
                    showToast(msg);
                }
            } catch (e) {
                showToast('❌ Ошибка: ' + e.message);
            } finally {
                isAddingAccountActive = false;
                addBtn.disabled = false;
                addBtn.textContent = '➕ Добавить';
                addBtn.title = 'Добавить аккаунт в карусель';
                const updated = await multiaccAPI.getStatus();
                updateView(updated);
            }
        }

        addBtn.onclick = handleAddAccount;

        // Toggle click
        toggle.onclick = async () => {
            try {
                const res = await multiaccAPI.toggleAutoFailover();
                updateView(res);
            } catch (e) {
                console.error(e);
            }
        };

        // Listen for status changes
        multiaccAPI.onStatusChanged((state) => {
            updateView(state);
        });

        // Listen for failover notifications
        multiaccAPI.onFailoverOccurred((info) => {
            showToast(`⚠️ Лимит исчерпан! Автопереход на слот ${info.toSlot || ''} (${info.to || 'Аккаунт'}).`);
            multiaccAPI.getStatus().then(updateView);
        });

        function showToast(msg) {
            const toast = document.createElement('div');
            toast.className = 'multiacc-toast';
            toast.innerHTML = `<strong>⚡ Antigravity MultiAcc</strong><span>${msg}</span>`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.5s ease';
                setTimeout(() => toast.remove(), 500);
            }, 6000);
        }

        // Initial fetch
        multiaccAPI.getStatus().then(updateView);

        // --- Telegram Bot Logic ---
        const botBtn = document.getElementById('multiacc-bot-btn');
        const botModal = document.getElementById('multiacc-bot-modal');
        const botModalClose = document.getElementById('multiacc-bot-modal-close');
        const botModalCancel = document.getElementById('multiacc-bot-modal-cancel');
        const botModalSave = document.getElementById('multiacc-bot-modal-save');
        const botTokenInput = document.getElementById('multiacc-bot-token-input');
        const botChatIdInput = document.getElementById('multiacc-bot-chatid-input');

        function updateBotUI(status) {
            if (status && status.running) {
                botBtn.textContent = '🤖 Бот: 🟢 ВКЛ';
                botBtn.classList.add('multiacc-btn-bot-on');
                botBtn.title = 'Telegram бот работает. Клик: остановить. ПКМ: настройки.';
            } else {
                botBtn.textContent = '🤖 Бот: ⚪ ВЫКЛ';
                botBtn.classList.remove('multiacc-btn-bot-on');
                botBtn.title = 'Telegram бот выключен. Клик: запустить. ПКМ: настройки.';
            }
        }

        async function checkDirectBotStatus() {
            try {
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 400);
                const r = await fetch('http://127.0.0.1:51123', { signal: ctrl.signal });
                clearTimeout(tid);
                if (r.ok) {
                    const data = await r.json();
                    return { running: !!data.running };
                }
            } catch (e) {}
            return null;
        }

        async function refreshBotView() {
            try {
                const direct = await checkDirectBotStatus();
                if (direct !== null) {
                    updateBotUI(direct);
                    return;
                }
                const status = await multiaccAPI.getBotStatus();
                updateBotUI(status);
            } catch (e) {}
        }

        async function openBotModal() {
            try {
                const status = await multiaccAPI.getBotStatus();
                botTokenInput.value = status.botToken || '';
                botChatIdInput.value = status.allowedChatId ? String(status.allowedChatId) : '';
            } catch (e) {}
            botModal.style.display = 'flex';
        }

        function closeBotModal() {
            botModal.style.display = 'none';
        }

        botBtn.onclick = async () => {
            botBtn.disabled = true;
            try {
                const direct = await checkDirectBotStatus();
                const isRunning = direct ? direct.running : (await multiaccAPI.getBotStatus()).running;
                if (isRunning) {
                    try {
                        await fetch('http://127.0.0.1:51123/stop', { method: 'POST' });
                    } catch (e) {}
                    const res = await multiaccAPI.toggleBot();
                    updateBotUI({ running: false });
                    showToast('⚪ Telegram бот остановлен.');
                    return;
                }

                const cur = await multiaccAPI.getBotStatus();
                if (!cur.configured) {
                    await openBotModal();
                    return;
                }
                const res = await multiaccAPI.toggleBot();
                if (res && res.error === 'need_config') {
                    await openBotModal();
                } else if (res && res.error) {
                    showToast('❌ Ошибка запуска бота: ' + res.error);
                } else if (res) {
                    showToast(res.running ? '🟢 Telegram бот запущен!' : '⚪ Telegram бот остановлен.');
                    updateBotUI(res);
                }
            } catch (err) {
                showToast('❌ Ошибка: ' + err.message);
            } finally {
                botBtn.disabled = false;
            }
        };

        botBtn.oncontextmenu = (e) => {
            e.preventDefault();
            openBotModal();
        };

        botModalClose.onclick = closeBotModal;
        botModalCancel.onclick = closeBotModal;
        botModalSave.onclick = async () => {
            const token = botTokenInput.value.trim();
            const chatId = botChatIdInput.value.trim();
            if (!token) {
                showToast('❌ Введите Bot Token!');
                return;
            }
            botModalSave.disabled = true;
            try {
                await multiaccAPI.saveBotConfig({ botToken: token, allowedChatId: chatId || null, enabled: true });
                closeBotModal();
                const res = await multiaccAPI.toggleBot();
                if (res && res.running) {
                    showToast('🟢 Telegram бот настроен и запущен!');
                } else {
                    showToast('💾 Настройки сохранены.');
                }
                updateBotUI(res);
            } catch (e) {
                showToast('❌ Ошибка: ' + e.message);
            } finally {
                botModalSave.disabled = false;
            }
        };

        multiaccAPI.onBotStatusChanged((info) => {
            updateBotUI(info);
        });

        refreshBotView();
        setInterval(refreshBotView, 2500);



    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }
    // Backup interval in case SPA clears or replaces body
    let retries = 0;
    const interval = setInterval(() => {
        injectUI();
        if (++retries > 10) clearInterval(interval);
    }, 1000);
})();



// --- Antigravity Skill & MCP Control Center UI Injected ---
(function initControlCenterWidget() {
"use strict";

/**
 * controlCenterUi.js: Injected UI for Antigravity Skill & MCP Control Center
 * Renders the topbar button, drawer side sheet, and smart preset banner.
 */

function injectControlCenterUI() {
    const bridge = controlCenterAPI;
    if (document.getElementById("antigravity-control-center-root")) return;

    // Inject CSS styles
    const styleEl = document.createElement("style");
    styleEl.id = "antigravity-control-center-styles";
    styleEl.textContent = `
        /* Topbar Control Center Button */
        #ag-cc-topbar-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #2b2d30;
            color: #e6edf3;
            border: 1px solid #3c3f41;
            border-radius: 6px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            margin-right: 8px;
            user-select: none;
            transition: all 0.15s ease;
            height: 24px;
        }
        #ag-cc-topbar-btn:hover {
            background: #35373b;
            border-color: #4e5157;
            color: #58a6ff;
        }
        #ag-cc-topbar-btn .token-badge {
            background: rgba(88, 166, 255, 0.15);
            color: #58a6ff;
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 10px;
            font-family: monospace;
        }

        /* Smart Preset Banner */
        #ag-cc-preset-banner {
            position: fixed;
            top: 42px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999990;
            background: rgba(30, 31, 34, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid #388bfd;
            border-radius: 8px;
            padding: 8px 14px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            color: #e6edf3;
            animation: agSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes agSlideDown {
            from { opacity: 0; transform: translate(-50%, -12px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        #ag-cc-preset-banner .btn {
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: 0.15s;
        }
        #ag-cc-preset-banner .btn-confirm {
            background: #238636;
            color: #ffffff;
        }
        #ag-cc-preset-banner .btn-confirm:hover { background: #2ea043; }
        #ag-cc-preset-banner .btn-manual {
            background: #30363d;
            color: #c9d1d9;
        }
        #ag-cc-preset-banner .btn-manual:hover { background: #3c444d; color: #fff; }
        #ag-cc-preset-banner .btn-close {
            background: transparent;
            color: #8b949e;
            padding: 2px 5px;
        }
        #ag-cc-preset-banner .btn-close:hover { color: #f85149; }

        /* Drawer Overlay */
        #ag-cc-drawer-overlay {
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(3px);
            z-index: 999998;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }
        #ag-cc-drawer-overlay.open {
            opacity: 1;
            pointer-events: auto;
        }

        /* Drawer Side Sheet */
        #ag-cc-drawer {
            position: fixed;
            top: 0; right: 0; width: 440px; height: 100vh;
            background: #1e1f22;
            border-left: 1px solid #3c3f41;
            box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);
            z-index: 999999;
            transform: translateX(100%);
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e6edf3;
            user-select: none;
        }
        #ag-cc-drawer.open {
            transform: translateX(0);
        }

        /* Drawer Header */
        .ag-cc-header {
            padding: 14px 18px;
            border-bottom: 1px solid #2b2d30;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #18191c;
        }
        .ag-cc-title {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ag-cc-close {
            background: transparent;
            border: none;
            color: #8b949e;
            font-size: 18px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .ag-cc-close:hover { color: #fff; background: #2b2d30; }

        /* Token Summary HUD */
        .ag-cc-token-hud {
            padding: 10px 18px;
            background: #161b22;
            border-bottom: 1px solid #21262d;
            font-size: 11px;
        }
        .ag-cc-hud-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
        }
        .ag-cc-progress-bar {
            width: 100%;
            height: 5px;
            background: #21262d;
            border-radius: 3px;
            overflow: hidden;
        }
        .ag-cc-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #238636, #388bfd);
            width: 35%;
            transition: width 0.3s ease;
        }

        /* Tabs */
        .ag-cc-tabs {
            display: flex;
            border-bottom: 1px solid #2b2d30;
            background: #18191c;
        }
        .ag-cc-tab-btn {
            flex: 1;
            padding: 10px 0;
            background: transparent;
            border: none;
            color: #8b949e;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            text-align: center;
            border-bottom: 2px solid transparent;
            transition: 0.15s;
        }
        .ag-cc-tab-btn:hover { color: #e6edf3; }
        .ag-cc-tab-btn.active {
            color: #58a6ff;
            border-bottom-color: #58a6ff;
            background: rgba(88, 166, 255, 0.05);
        }

        /* Tab Content */
        .ag-cc-content {
            flex: 1;
            overflow-y: auto;
            padding: 14px 18px;
        }
        .ag-cc-content::-webkit-scrollbar { width: 6px; }
        .ag-cc-content::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }

        /* Presets Grid */
        .ag-cc-presets-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
            margin-bottom: 12px;
        }
        .ag-preset-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 6px 8px;
            cursor: pointer;
            transition: all 0.15s ease;
            display: flex;
            flex-direction: column;
            gap: 2px;
            position: relative;
        }
        .ag-preset-card:hover {
            border-color: #58a6ff;
            background: #21262d;
            transform: translateY(-1px);
        }
        .ag-preset-card.active {
            border-color: #388bfd;
            background: rgba(56, 139, 253, 0.12);
            box-shadow: 0 0 8px rgba(56, 139, 253, 0.25);
        }
        .ag-preset-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            font-weight: 600;
            color: #e6edf3;
        }
        .ag-preset-card.active .ag-preset-card-header {
            color: #58a6ff;
        }
        .ag-preset-card-desc {
            font-size: 9px;
            color: #8b949e;
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ag-preset-card-count {
            font-size: 9px;
            color: #8b949e;
            background: #21262d;
            padding: 1px 4px;
            border-radius: 3px;
        }
        .ag-preset-card.active .ag-preset-card-count {
            background: rgba(56, 139, 253, 0.2);
            color: #58a6ff;
        }

        /* Search input */
        .ag-cc-search {
            width: 100%;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #e6edf3;
            outline: none;
            margin-bottom: 12px;
            box-sizing: border-box;
        }
        .ag-cc-search:focus { border-color: #58a6ff; }

        /* Skill Item */
        .ag-cc-skill-item {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: 0.15s;
        }
        .ag-cc-skill-item:hover { border-color: #30363d; }
        .ag-cc-skill-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .ag-cc-skill-name {
            font-size: 12px;
            font-weight: 600;
            color: #e6edf3;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ag-cc-skill-desc {
            font-size: 11px;
            color: #8b949e;
            line-height: 1.35;
        }
        .ag-cc-skill-source {
            font-size: 9px;
            background: #21262d;
            color: #8b949e;
            border-radius: 3px;
            padding: 1px 4px;
        }
        .ag-cc-skill-tokens {
            font-size: 10px;
            font-family: monospace;
            background: rgba(56, 139, 253, 0.12);
            color: #58a6ff;
            padding: 1px 5px;
            border-radius: 4px;
        }

        /* Switch Toggle */
        .ag-switch {
            position: relative;
            display: inline-block;
            width: 34px;
            height: 18px;
        }
        .ag-switch input { opacity: 0; width: 0; height: 0; }
        .ag-slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #30363d;
            transition: .2s;
            border-radius: 18px;
        }
        .ag-slider:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 2px;
            bottom: 2px;
            background-color: white;
            transition: .2s;
            border-radius: 50%;
        }
        input:checked + .ag-slider { background-color: #238636; }
        input:checked + .ag-slider:before { transform: translateX(16px); }

        /* Workshop Form */
        .ag-cc-form-group {
            margin-bottom: 12px;
        }
        .ag-cc-form-label {
            display: block;
            font-size: 11px;
            font-weight: 500;
            color: #8b949e;
            margin-bottom: 4px;
        }
        .ag-cc-input, .ag-cc-textarea {
            width: 100%;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #e6edf3;
            box-sizing: border-box;
            outline: none;
        }
        .ag-cc-textarea { height: 70px; resize: vertical; }
        .ag-cc-btn-primary {
            width: 100%;
            background: #238636;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: 0.15s;
            margin-top: 6px;
        }
        .ag-cc-btn-primary:hover { background: #2ea043; }
        .ag-cc-btn-secondary {
            width: 100%;
            background: #21262d;
            color: #c9d1d9;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: 0.15s;
            margin-top: 6px;
        }
        .ag-cc-btn-secondary:hover { background: #30363d; color: #fff; }

        /* MCP Status Badges */
        .ag-mcp-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
        .ag-mcp-badge.running { background: rgba(35, 134, 54, 0.2); color: #3fb950; }
        .ag-mcp-badge.disabled { background: rgba(139, 148, 158, 0.2); color: #8b949e; }
    `;
    document.head.appendChild(styleEl);

    // Root Container
    const root = document.createElement("div");
    root.id = "antigravity-control-center-root";

    // Overlay & Drawer HTML
    root.innerHTML = `
        <div id="ag-cc-drawer-overlay"></div>
        <div id="ag-cc-drawer">
            <div class="ag-cc-header">
                <div class="ag-cc-title">
                    <span>⚡ Control Center</span>
                    <span style="font-size:10px; color:#8b949e; font-weight:normal;">[Ctrl+Shift+S]</span>
                </div>
                <button class="ag-cc-close" id="ag-cc-close-btn">&times;</button>
            </div>

            <div class="ag-cc-token-hud">
                <div class="ag-cc-hud-row">
                    <span style="color:#8b949e;">Системный контекст скиллов:</span>
                    <span id="ag-cc-hud-tokens" style="font-weight:600; color:#58a6ff;">~0 токенов</span>
                </div>
                <div class="ag-cc-progress-bar">
                    <div class="ag-cc-progress-fill" id="ag-cc-hud-progress"></div>
                </div>
                <div style="margin-top:4px; color:#8b949e; display:flex; justify-content:space-between;">
                    <span id="ag-cc-hud-count">0 активных скиллов</span>
                    <span id="ag-cc-hud-percent">0%</span>
                </div>
            </div>

            <div class="ag-cc-tabs">
                <button class="ag-cc-tab-btn active" data-tab="skills">Скиллы & Токены</button>
                <button class="ag-cc-tab-btn" data-tab="workshop">Skill Workshop</button>
                <button class="ag-cc-tab-btn" data-tab="mcp">MCP Серверы</button>
            </div>

            <!-- Tab 1: Skills -->
            <div class="ag-cc-content" id="ag-tab-skills">
                <div style="font-size:11px; font-weight:600; color:#8b949e; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                    <span>ПРОФИЛИ & ПРЕСЕТЫ</span>
                    <span style="font-size:10px; color:#58a6ff;">⚡ авто-оркестратор готов</span>
                </div>
                <div class="ag-cc-presets-grid" id="ag-cc-presets-container"></div>
                <input type="text" class="ag-cc-search" id="ag-cc-skill-search" placeholder="Поиск по скиллам...">
                <div id="ag-cc-skills-list"></div>
            </div>

            <!-- Tab 2: Workshop -->
            <div class="ag-cc-content" id="ag-tab-workshop" style="display:none;">
                <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Создать новый скилл</div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Название (Name):</label>
                    <input type="text" class="ag-cc-input" id="ag-ws-name" placeholder="например: Docker Helper">
                </div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Описание / Триггеры:</label>
                    <textarea class="ag-cc-textarea" id="ag-ws-desc" placeholder="Когда и для чего агенту использовать этот скилл..."></textarea>
                </div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Тип скилла:</label>
                    <select class="ag-cc-input" id="ag-ws-type">
                        <option value="prompt">Только инструкции (Prompt-only)</option>
                        <option value="script">Со вспомогательными скриптами (Scripts/Python)</option>
                    </select>
                </div>
                <button class="ag-cc-btn-primary" id="ag-ws-create-btn">✨ Создать заготовку SKILL.md</button>
                <button class="ag-cc-btn-secondary" id="ag-ws-ai-btn">🤖 Сгенерировать через ИИ в чате</button>

                <hr style="border:0; border-top:1px solid #30363d; margin:16px 0;">

                <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Импорт скилла (GitHub / папка)</div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Ссылка на репозиторий или локальный путь:</label>
                    <input type="text" class="ag-cc-input" id="ag-ws-import-url" placeholder="https://github.com/... или C:\\...">
                </div>
                <button class="ag-cc-btn-secondary" id="ag-ws-import-btn">📥 Импортировать скилл</button>
            </div>

            <!-- Tab 3: MCP -->
            <div class="ag-cc-content" id="ag-tab-mcp" style="display:none;">
                <div style="font-size:11px; color:#8b949e; margin-bottom:10px;">
                    Включение и выключение установленных MCP серверов:
                </div>
                <div id="ag-cc-mcp-list"></div>
            </div>
        </div>
    `;

    document.body.appendChild(root);

    const drawer = document.getElementById("ag-cc-drawer");
    const overlay = document.getElementById("ag-cc-drawer-overlay");
    const closeBtn = document.getElementById("ag-cc-close-btn");

    function toggleDrawer(open) {
        const shouldOpen = open !== undefined ? open : !drawer.classList.contains("open");
        if (shouldOpen) {
            drawer.classList.add("open");
            overlay.classList.add("open");
            refreshData();
        } else {
            drawer.classList.remove("open");
            overlay.classList.remove("open");
        }
    }

    closeBtn.addEventListener("click", () => toggleDrawer(false));
    overlay.addEventListener("click", () => toggleDrawer(false));

    // Global Hotkey Ctrl+Shift+S
    window.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s" || e.key === "Ы" || e.key === "ы")) {
            e.preventDefault();
            toggleDrawer();
        }
        if (e.key === "Escape" && drawer.classList.contains("open")) {
            toggleDrawer(false);
        }
    });

    // Tab Switching
    const tabButtons = root.querySelectorAll(".ag-cc-tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const target = btn.dataset.tab;
            root.querySelectorAll(".ag-cc-content").forEach(c => c.style.display = "none");
            const activeContent = document.getElementById(`ag-tab-${target}`);
            if (activeContent) activeContent.style.display = "block";
        });
    });

    // Topbar Button Injection
    function attachTopbarBtn() {
        if (document.getElementById("ag-cc-topbar-btn")) return;
        const targetContainer = document.getElementById("antigravity-multiacc-root") || document.body;
        const btn = document.createElement("button");
        btn.id = "ag-cc-topbar-btn";
        btn.title = "Skill & MCP Control Center (Ctrl+Shift+S)";
        btn.innerHTML = `<span>⚡ Control</span> <span class="token-badge" id="ag-topbar-badge">0k</span>`;
        btn.addEventListener("click", () => toggleDrawer());
        
        if (targetContainer.id === "antigravity-multiacc-root") {
            targetContainer.insertBefore(btn, targetContainer.firstChild);
        } else {
            // Absolute fallback
            btn.style.position = "fixed";
            btn.style.top = "6px";
            btn.style.right = "240px";
            btn.style.zIndex = "999995";
            document.body.appendChild(btn);
        }
    }
    attachTopbarBtn();
    setInterval(attachTopbarBtn, 2000);

    // State & Rendering
    let currentSkills = [];
    let currentMcp = [];

    async function refreshData() {
        if (!bridge) return;
        try {
            const data = await bridge.getState();
            currentSkills = data.skills || [];
            currentMcp = data.mcpServers || [];

            renderHud(data.totalActiveTokens, data.activeCount, data.totalCount);
            renderPresets(data.presets, data.activePreset);
            renderSkills(currentSkills);
            renderMcp(currentMcp);

            // Handle Smart Preset Suggestion Banner
            if (data.recommendedPreset && !sessionStorage.getItem("ag_preset_banner_dismissed")) {
                showPresetBanner(data.recommendedPreset);
            }
        } catch (e) {
            console.error("[ControlCenterUI] Refresh failed:", e);
        }
    }

    function renderHud(tokens, active, total) {
        const hudTokens = document.getElementById("ag-cc-hud-tokens");
        const hudProgress = document.getElementById("ag-cc-hud-progress");
        const hudCount = document.getElementById("ag-cc-hud-count");
        const hudPercent = document.getElementById("ag-cc-hud-percent");
        const topbarBadge = document.getElementById("ag-topbar-badge");

        const tokenText = `~${(tokens / 1000).toFixed(1)}k токенов`;
        if (hudTokens) hudTokens.textContent = tokenText;
        if (topbarBadge) topbarBadge.textContent = `${(tokens / 1000).toFixed(1)}k`;

        if (hudCount) hudCount.textContent = `${active} из ${total} скиллов`;
        const pct = total > 0 ? Math.round((active / total) * 100) : 0;
        if (hudPercent) hudPercent.textContent = `${pct}%`;
        if (hudProgress) hudProgress.style.width = `${Math.min(100, pct)}%`;
    }

    function renderSkills(skills) {
        const listEl = document.getElementById("ag-cc-skills-list");
        if (!listEl) return;
        listEl.innerHTML = "";

        const query = (document.getElementById("ag-cc-skill-search")?.value || "").toLowerCase();
        const filtered = skills.filter(s => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));

        if (filtered.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#8b949e; font-size:12px;">Скиллы не найдены</div>`;
            return;
        }

        for (const skill of filtered) {
            const item = document.createElement("div");
            item.className = "ag-cc-skill-item";
            item.innerHTML = `
                <div class="ag-cc-skill-row">
                    <span class="ag-cc-skill-name">
                        ${skill.name}
                        <span class="ag-cc-skill-source">${skill.source}</span>
                    </span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="ag-cc-skill-tokens">~${skill.promptTokens} tkn</span>
                        <label class="ag-switch">
                            <input type="checkbox" ${skill.enabled ? "checked" : ""}>
                            <span class="ag-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="ag-cc-skill-desc">${skill.description}</div>
            `;

            const checkbox = item.querySelector("input");
            checkbox.addEventListener("change", async () => {
                await bridge.toggleSkill(skill.dirPath, checkbox.checked);
                refreshData();
            });

            listEl.appendChild(item);
        }
    }

    function renderMcp(servers) {
        const listEl = document.getElementById("ag-cc-mcp-list");
        if (!listEl) return;
        listEl.innerHTML = "";

        if (servers.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#8b949e; font-size:12px;">MCP серверы не найдены</div>`;
            return;
        }

        for (const server of servers) {
            const item = document.createElement("div");
            item.className = "ag-cc-skill-item";
            item.innerHTML = `
                <div class="ag-cc-skill-row">
                    <span class="ag-cc-skill-name">
                        🔌 ${server.name}
                        <span class="ag-mcp-badge ${server.status}">${server.status.toUpperCase()}</span>
                    </span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:10px; color:#8b949e;">${server.toolCount} tools</span>
                        <label class="ag-switch">
                            <input type="checkbox" ${server.enabled ? "checked" : ""}>
                            <span class="ag-slider"></span>
                        </label>
                    </div>
                </div>
            `;

            const checkbox = item.querySelector("input");
            checkbox.addEventListener("change", async () => {
                await bridge.toggleMcp(server.name, checkbox.checked);
                refreshData();
            });

            listEl.appendChild(item);
        }
    }

    // Search filter listener
    document.getElementById("ag-cc-skill-search")?.addEventListener("input", () => {
        renderSkills(currentSkills);
    });

    function renderPresets(presets, activePresetId) {
        const container = document.getElementById("ag-cc-presets-container");
        if (!container) return;
        container.innerHTML = "";

        const allPresets = presets || [
            { id: "web", name: "Web Modern", icon: "🌐", description: "Next.js 15, React, Tailwind, Vue" },
            { id: "backend", name: "Backend & DB", icon: "⚙️", description: "Postgres, FastAPI, Go, Rust" },
            { id: "devops", name: "DevOps & Cloud", icon: "🐳", description: "Docker, K8s, GitHub Actions" },
            { id: "appsec", name: "AppSec & Reversing", icon: "🛡️", description: "OWASP, ASAR reverse, Win32" },
            { id: "qa", name: "QA & Testing", icon: "🧪", description: "Playwright E2E, Unit TDD" },
            { id: "ai-agents", name: "AI & MCP Engineering", icon: "🤖", description: "MCP серверы, RAG, Prompt Eng, Agents" },
            { id: "web-research", name: "Web Research & OSINT", icon: "🔍", description: "Глубокий поиск, скрапинг, OSINT" },
            { id: "reverse-engineering", name: "Reverse Engineering & Replica", icon: "🧬", description: "11 скиллов Replica + ASAR реверс" },
            { id: "minimal", name: "Minimal Context", icon: "⚡", description: "Минимум системных токенов" }
        ];

        for (const p of allPresets) {
            const card = document.createElement("div");
            const isActive = (p.id === activePresetId);
            card.className = "ag-preset-card" + (isActive ? " active" : "");
            const countLabel = p.skills ? `${p.skills.length} ск.` : "";
            card.innerHTML = `
                <div class="ag-preset-card-header">
                    <span>${p.icon} ${p.name}</span>
                    ${countLabel ? `<span class="ag-preset-card-count">${countLabel}</span>` : ""}
                </div>
                <div class="ag-preset-card-desc">${p.description}</div>
            `;
            card.addEventListener("click", async () => {
                await bridge.applyPresetByName(p.id);
                refreshData();
            });
            container.appendChild(card);
        }
    }

    // Auto-sync when Agent switches preset via switch.py or HTTP bridge
    if (bridge && bridge.onPresetApplied) {
        bridge.onPresetApplied((data) => {
            refreshData();
        });
    }

    // Workshop: Create
    document.getElementById("ag-ws-create-btn")?.addEventListener("click", async () => {
        const name = document.getElementById("ag-ws-name").value;
        const desc = document.getElementById("ag-ws-desc").value;
        const type = document.getElementById("ag-ws-type").value;
        const res = await bridge.createSkill({ name, description: desc, type, isGlobal: true });
        if (res.success) {
            alert(`Скилл "${name}" успешно создан в ${res.path}!`);
            document.getElementById("ag-ws-name").value = "";
            document.getElementById("ag-ws-desc").value = "";
            refreshData();
        } else {
            alert(`Ошибка: ${res.error}`);
        }
    });

    // Workshop: Generate with AI
    document.getElementById("ag-ws-ai-btn")?.addEventListener("click", () => {
        const name = document.getElementById("ag-ws-name").value || "новый скилл";
        const desc = document.getElementById("ag-ws-desc").value || "";
        const promptText = `Создай для меня новый агентский скилл (SKILL.md) с названием "${name}". Описание и задачи: ${desc}`;
        toggleDrawer(false);
        const chatInput = document.querySelector("textarea, input[placeholder*='message'], [contenteditable='true']");
        if (chatInput) {
            chatInput.value = promptText;
            chatInput.focus();
        } else {
            navigator.clipboard.writeText(promptText);
            alert("Промпт скопирован в буфер обмена!");
        }
    });

    // Workshop: Import
    document.getElementById("ag-ws-import-btn")?.addEventListener("click", async () => {
        const source = document.getElementById("ag-ws-import-url").value;
        const res = await bridge.importSkill({ source, isGlobal: true });
        if (res.success) {
            alert(`Скилл успешно импортирован в ${res.path}!`);
            document.getElementById("ag-ws-import-url").value = "";
            refreshData();
        } else {
            alert(`Ошибка импорта: ${res.error}`);
        }
    });

    // Smart Preset Banner
    function showPresetBanner(preset) {
        if (document.getElementById("ag-cc-preset-banner")) return;
        const banner = document.createElement("div");
        banner.id = "ag-cc-preset-banner";
        banner.innerHTML = `
            <span>${preset.icon || "💡"} Обнаружен стек: <b>${preset.name}</b>. Утвердить пресет?</span>
            <button class="btn btn-confirm" id="ag-banner-confirm">Подтвердить</button>
            <button class="btn btn-manual" id="ag-banner-manual">Ручное управление</button>
            <button class="btn btn-close" id="ag-banner-close">&times;</button>
        `;

        document.body.appendChild(banner);

        document.getElementById("ag-banner-confirm")?.addEventListener("click", async () => {
            await bridge.applyPreset(preset.skills || []);
            banner.remove();
            sessionStorage.setItem("ag_preset_banner_dismissed", "1");
            refreshData();
        });

        document.getElementById("ag-banner-manual")?.addEventListener("click", () => {
            banner.remove();
            sessionStorage.setItem("ag_preset_banner_dismissed", "1");
            toggleDrawer(true);
        });

        document.getElementById("ag-banner-close")?.addEventListener("click", () => {
            banner.remove();
            sessionStorage.setItem("ag_preset_banner_dismissed", "1");
        });
    }

    // Initial load
    refreshData();
}




    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectControlCenterUI);
    } else {
        injectControlCenterUI();
    }
    let retries = 0;
    const ccInterval = setInterval(() => {
        injectControlCenterUI();
        if (++retries > 15) clearInterval(ccInterval);
    }, 1000);
})();
