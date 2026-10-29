"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SleepBlocker = exports.showOrCreateWindow = exports.showQuitConfirmation = void 0;
exports.setShowQuitConfirmation = setShowQuitConfirmation;
exports.isMacOS = isMacOS;
exports.markWebviewPopupWindow = markWebviewPopupWindow;
exports.getHubWindows = getHubWindows;
exports.createWindow = createWindow;
exports.getNodeWrapperPaths = getNodeWrapperPaths;
exports.setupNodeWrapper = setupNodeWrapper;
exports.isAuthUrl = isAuthUrl;
exports.ensureAccountSelection = ensureAccountSelection;
exports.extractAuthUrl = extractAuthUrl;
exports.openAuthUrlExternal = openAuthUrlExternal;
exports.configureAuthInterception = configureAuthInterception;
const electron_1 = require("electron");
const constants_1 = require("./constants");
const keybindings_1 = require("./keybindings");
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const paths_1 = require("./paths");
const loadingOverlay_1 = require("./loadingOverlay");
const wsl_1 = require("./wsl");
const debugConsole_1 = require("./debugConsole");
exports.showQuitConfirmation = false;
function setShowQuitConfirmation(value) {
    exports.showQuitConfirmation = value;
}
function isMacOS() {
    return process.platform === 'darwin';
}
/**
 * Reads the user's theme preference from the settings file.
 */
function getThemeMode() {
    try {
        const filePath = (0, paths_1.getSettingsPbPath)();
        if (!fs.existsSync(filePath)) {
            return 'DARK';
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content);
        const themeMode = config?.userSettings?.themeMode;
        if (themeMode && themeMode.includes('INHERIT')) {
            return electron_1.nativeTheme.shouldUseDarkColors ? 'DARK' : 'LIGHT';
        }
        if (themeMode && themeMode.includes('LIGHT')) {
            return 'LIGHT';
        }
        return 'DARK';
    }
    catch (e) {
        console.error('Error reading theme mode:', e);
        return 'DARK';
    }
}
/**
 * Ensures the app is visible in the dock for MacOS with the icon set.
 * When refocusing the app after being hidden in the dock, the icon is sometimes lost.
 * This ensures the icon is always visible.
 */
function ensureAppIsInDock() {
    void electron_1.app.dock?.show();
    if (isMacOS() && electron_1.app.dock) {
        const iconPath = path_1.default.join(__dirname, '..', 'icon.png');
        electron_1.app.dock.setIcon(electron_1.nativeImage.createFromPath(iconPath));
    }
}
// ---------------------------------------------------------------------------
// Window Management
// ---------------------------------------------------------------------------
const hubWindows = new WeakSet();
/**
 * Marks a child `BrowserWindow` created by a `<webview>` `window.open()` call
 * so Hub window queries (`getHubWindows()`) never mistake it for a main Hub
 * window.
 */
function markWebviewPopupWindow(win) {
    if (win && typeof win === 'object') {
        win.__isWebviewPopupWindow = true;
    }
}
/**
 * Returns all open top-level Hub `BrowserWindow` instances, excluding child
 * popup windows spawned by `<webview>` guests.
 */
function getHubWindows() {
    return electron_1.BrowserWindow.getAllWindows().filter((win) => hubWindows.has(win) ||
        !win
            .__isWebviewPopupWindow);
}
/**
 * Creates and returns a new BrowserWindow pointed at `url`.
 * Uses a hidden title bar with native traffic lights on macOS.
 * Node integration is disabled and context isolation is enabled for security.
 */
function createWindow(url, storageManager) {
    ensureAppIsInDock();
    const theme = getThemeMode().toUpperCase();
    const isLight = theme.includes('LIGHT');
    const backgroundColor = isLight ? '#FAFAFA' : '#131313';
    const foregroundColor = isLight ? '#383A42' : '#FAFAFA';
    const wslBadge = (0, wsl_1.getActiveWslDistro)()
        ? ` (WSL: ${(0, wsl_1.getActiveWslDistro)()})`
        : '';
    const win = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 500,
        minHeight: 400,
        title: electron_1.app.getName() + wslBadge,
        icon: path_1.default.join(__dirname, '..', 'icon.png'),
        titleBarStyle: 'hidden',
        titleBarOverlay: isMacOS()
            ? false
            : {
                color: backgroundColor,
                symbolColor: foregroundColor,
                height: 30,
            },
        backgroundColor,
        trafficLightPosition: { x: 12, y: 12 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, 'preload.js'),
            devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),
            // Required for the built-in browser aux pane, which renders web pages
            // in an Electron <webview> guest inside the embedded Agent UI Toolkit.
            webviewTag: true,
        },
    });
    // Prevent the menu dropdown from being very wide due to long page titles
    win.on('page-title-updated', (event, title) => {
        const maxLength = 25;
        const truncated = title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
        if (truncated !== title || wslBadge) {
            event.preventDefault();
            win.setTitle(truncated + wslBadge);
        }
    });
    win.webContents.setWindowOpenHandler((details) => {
        if (isAuthUrl(details.url)) {
            openAuthUrlExternal(details.url);
            return { action: 'deny' };
        }
        void electron_1.shell.openExternal(details.url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, targetUrl) => {
        if (isAuthUrl(targetUrl)) {
            event.preventDefault();
            openAuthUrlExternal(targetUrl);
        }
    });
    win.webContents.on('will-frame-navigate', (event) => {
        if (isAuthUrl(event.url)) {
            event.preventDefault();
            openAuthUrlExternal(event.url);
        }
    });
    win.webContents.on('will-redirect', (event, targetUrl) => {
        if (isAuthUrl(targetUrl)) {
            event.preventDefault();
            openAuthUrlExternal(targetUrl);
        }
    });
    (0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);
    (0, keybindings_1.registerKeybindings)(win, {
        createNewWindow: () => {
            void createWindow(url, storageManager);
        },
        onQuitRequested: () => {
            exports.showQuitConfirmation = true;
            electron_1.app.quit();
        },
    });
    // Zoom persistence — restore saved level and capture future changes.
    if (storageManager) {
        const ZOOM_LEVEL_KEY = 'zoomLevel';
        let isRestoringZoom = false;
        const applyStoredZoomLevel = async () => {
            const items = await storageManager.getItems();
            const stored = items[ZOOM_LEVEL_KEY];
            if (stored !== undefined) {
                const level = parseFloat(stored);
                if (!isNaN(level)) {
                    isRestoringZoom = true;
                    win.webContents.setZoomLevel(level);
                    isRestoringZoom = false;
                }
            }
        };
        win.webContents.on('did-finish-load', () => {
            void applyStoredZoomLevel();
        });
        // Capture zoom changes from native menu accelerators, trackpad
        // pinch-to-zoom, or Ctrl+scroll so they are also persisted.
        win.webContents.on('zoom-changed', (_event, _direction) => {
            if (isRestoringZoom) {
                return;
            }
            const currentLevel = win.webContents.getZoomLevel();
            void storageManager.updateItems({
                [ZOOM_LEVEL_KEY]: String(currentLevel),
            });
        });
    }
    void win.loadURL(url);
    hubWindows.add(win);
    return win;
}
/**
 * Focuses a window if it exists, or creates a new one.
 */
const showOrCreateWindow = (port) => {
    const wins = getHubWindows();
    if (wins.length > 0) {
        if (wins[0].isMinimized()) {
            wins[0].restore();
        }
        wins[0].show();
        wins[0].focus();
    }
    else {
        createWindow(`${constants_1.WINDOW_ORIGIN}:${port}/`);
    }
};
exports.showOrCreateWindow = showOrCreateWindow;
/**
 * Manages the power save blocker to keep the computer awake.
 */
class SleepBlocker {
    constructor() {
        this.currentBlockerId = null;
    }
    static getInstance() {
        if (!SleepBlocker.instance) {
            SleepBlocker.instance = new SleepBlocker();
        }
        return SleepBlocker.instance;
    }
    shouldKeepComputerAwake(keep) {
        if (keep) {
            if (this.currentBlockerId === null) {
                this.currentBlockerId = electron_1.powerSaveBlocker.start('prevent-display-sleep');
                console.log('Power save blocker started:', this.currentBlockerId);
            }
        }
        else {
            if (this.currentBlockerId !== null) {
                electron_1.powerSaveBlocker.stop(this.currentBlockerId);
                console.log('Power save blocker stopped:', this.currentBlockerId);
                this.currentBlockerId = null;
            }
        }
    }
}
exports.SleepBlocker = SleepBlocker;
function getNodeWrapperPaths(envPath, os, isPackaged, userDataPath, baseDir) {
    const delimiter = os === 'win32' ? ';' : ':';
    if (!isPackaged) {
        const devBinPath = path_1.default.join(baseDir, '..', 'node_modules', '.bin');
        return {
            newEnvPath: `${devBinPath}${delimiter}${envPath || ''}`,
            nodeWrapperPath: undefined,
            binPath: undefined,
        };
    }
    const binPath = path_1.default.join(userDataPath, 'bin');
    const nodeWrapperPath = path_1.default.join(binPath, os === 'win32' ? 'agy-node.cmd' : 'agy-node');
    return {
        newEnvPath: `${binPath}${delimiter}${envPath || ''}`,
        nodeWrapperPath,
        binPath,
    };
}
/**
 * Sets up a wrapper script for Node.js that runs Electron as Node.
 * This allows running standard Node scripts using the Electron binary.
 */
function setupNodeWrapper(env) {
    const userDataPath = electron_1.app.isPackaged ? electron_1.app.getPath('userData') : '';
    // Windows environment variables are case-insensitive, but when copying process.env
    // into a plain object, we might get 'Path' instead of 'PATH'. We need to find
    // the actual key used to avoid creating case-duplicate keys (e.g. 'Path' and 'PATH')
    // which can confuse child_process.spawn on Windows.
    const isWindows = process.platform === 'win32';
    const pathKey = isWindows
        ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
        : 'PATH';
    const { newEnvPath, nodeWrapperPath, binPath } = getNodeWrapperPaths(env[pathKey], process.platform, electron_1.app.isPackaged, userDataPath, __dirname);
    env[pathKey] = newEnvPath;
    // In non-packaged dev mode, we don't create a wrapper and it'll just use machine node
    if (!nodeWrapperPath || !binPath) {
        return;
    }
    if (!fs.existsSync(binPath)) {
        fs.mkdirSync(binPath, { recursive: true });
    }
    let nodeWrapperContent = '';
    switch (process.platform) {
        case 'win32':
            nodeWrapperContent = `@echo off\nset ELECTRON_RUN_AS_NODE=1\n"${process.execPath}" %*\n`;
            break;
        case 'darwin': {
            // Use the Helper app instead of the main executable to prevent macOS
            // from bouncing a new Dock icon when this script is executed. The Helper
            // has LSUIElement=true in its Info.plist, running it invisibly.
            const appName = path_1.default.basename(process.execPath);
            let electronBinary = process.execPath;
            const helperPath = path_1.default.join(path_1.default.dirname(process.execPath), '..', 'Frameworks', `${appName} Helper.app`, 'Contents', 'MacOS', `${appName} Helper`);
            if (fs.existsSync(helperPath)) {
                electronBinary = helperPath;
            }
            nodeWrapperContent = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${electronBinary}" "$@"\n`;
            break;
        }
        default: // linux, etc.
            nodeWrapperContent = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`;
            break;
    }
    try {
        const existingContent = fs.existsSync(nodeWrapperPath)
            ? fs.readFileSync(nodeWrapperPath, 'utf-8')
            : '';
        if (existingContent !== nodeWrapperContent) {
            fs.writeFileSync(nodeWrapperPath, nodeWrapperContent);
            if (process.platform !== 'win32') {
                fs.chmodSync(nodeWrapperPath, 0o755);
            }
        }
    }
    catch (err) {
        console.error(`Failed to create node wrapper: ${err}`);
    }
}
const GOOGLE_AUTH_HOST_RE = /^(?:[a-z0-9-]+\.)*accounts\.google\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/i;
const GOOGLE_ROOT_HOST_RE = /^(?:www\.)?google\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/i;
const GOOGLE_AUTH_PATH_RE = /(?:\/oauth2|\/oauth|\/signin|\/servicelogin|\/accountchooser|\/auth)/i;

function isAuthUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
            return false;
        }
        const host = u.hostname.toLowerCase();
        if (GOOGLE_AUTH_HOST_RE.test(host)) {
            return true;
        }
        if (GOOGLE_ROOT_HOST_RE.test(host) && GOOGLE_AUTH_PATH_RE.test(u.pathname)) {
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}
function ensureAccountSelection(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
            return rawUrl;
        }
        const host = u.hostname.toLowerCase();
        const isAccountsGoogle = GOOGLE_AUTH_HOST_RE.test(host);
        const isGoogleRoot = GOOGLE_ROOT_HOST_RE.test(host);
        if (isAccountsGoogle || isGoogleRoot) {
            const isAuthOrSignin = isAccountsGoogle ||
                GOOGLE_AUTH_PATH_RE.test(u.pathname) ||
                u.searchParams.has('client_id') ||
                u.searchParams.has('response_type');
            if (isAuthOrSignin) {
                const existingPrompt = u.searchParams.get('prompt') || '';
                const promptParts = existingPrompt.split(/\s+/).filter(Boolean);
                if (!promptParts.includes('select_account')) {
                    if (promptParts.includes('consent')) {
                        u.searchParams.set('prompt', 'select_account consent');
                    } else if (promptParts.length > 0) {
                        u.searchParams.set('prompt', `select_account ${existingPrompt}`);
                    } else {
                        u.searchParams.set('prompt', 'select_account');
                    }
                }
                return u.toString();
            }
        }
    } catch (e) {}
    return rawUrl;
}
function extractAuthUrl(line) {
    if (!line || typeof line !== 'string') return null;
    const m = /https:\/\/accounts\.google\.[a-z.]+\/\S+/i.exec(line) || /https:\/\/accounts\.google\.com\/\S+/.exec(line);
    if (!m) return null;
    let u = m[0];
    u = u.replace(/^["'\(]+/, '').replace(/["'\)\>\;\,\.]+$/, '');
    return u;
}
let lastOpenedAuthUrl = '';
let lastOpenedAuthTime = 0;
function openAuthUrlExternal(rawUrl) {
    if (!rawUrl) return;
    const targetUrl = ensureAccountSelection(rawUrl);
    const now = Date.now();
    if (now - lastOpenedAuthTime < 4000 && targetUrl === lastOpenedAuthUrl) {
        return;
    }
    lastOpenedAuthUrl = targetUrl;
    lastOpenedAuthTime = now;
    console.log(`[AuthRedirect] Opening OAuth URL in external browser: ${targetUrl}`);
    void electron_1.shell.openExternal(targetUrl);
}
const configuredSessions = new WeakSet();
function configureAuthInterception(session, force = false) {
    if (!session || (configuredSessions.has(session) && !force)) return;
    configuredSessions.add(session);
    try {
        session.webRequest.onBeforeRequest(
            { urls: ['*://accounts.google.com/*'] },
            (details, callback) => {
                const resourceType = details.resourceType;
                if (!resourceType || resourceType === 'mainFrame' || resourceType === 'subFrame') {
                    openAuthUrlExternal(details.url);
                }
                callback({ cancel: true });
            }
        );
    } catch (err) {
        console.warn('[AuthRedirect] Failed to attach webRequest onBeforeRequest:', err);
    }
}

