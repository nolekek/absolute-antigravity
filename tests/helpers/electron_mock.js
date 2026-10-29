/**
 * tests/helpers/electron_mock.js
 *
 * Lightweight, zero-dependency Electron mock for Node.js test environment.
 * Intercepts `require('electron')` calls via Node's Module._load hook.
 */

const Module = require('module');
const EventEmitter = require('events');

class MockWebContents extends EventEmitter {
    constructor() {
        super();
        this._windowOpenHandler = null;
        this.session = mockSession;
    }

    setWindowOpenHandler(handler) {
        this._windowOpenHandler = handler;
    }

    send(channel, ...args) {
        mockState.sentIpcMessages.push({ channel, args });
        this.emit(channel, ...args);
    }

    loadURL(url) {
        mockState.loadedUrls.push(url);
        return Promise.resolve();
    }
}

class MockBrowserWindow extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.webContents = new MockWebContents();
        mockState.windows.push(this);
    }

    loadURL(url) {
        mockState.loadedUrls.push(url);
        return Promise.resolve();
    }

    close() {
        const idx = mockState.windows.indexOf(this);
        if (idx !== -1) mockState.windows.splice(idx, 1);
        this.emit('closed');
    }

    static getAllWindows() {
        return [...mockState.windows];
    }
}

class MockNotification {
    constructor(options = {}) {
        this.options = options;
        mockState.notifications.push(this);
    }

    show() {
        mockState.shownNotifications.push(this.options);
    }
}

const mockWebRequest = {
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
    },
    // Test helper to simulate incoming web requests
    simulateRequest(details) {
        return new Promise((resolve) => {
            if (!this._listener) {
                return resolve({ cancel: false });
            }
            this._listener(details, (response) => {
                resolve(response);
            });
        });
    }
};

const mockSession = {
    webRequest: mockWebRequest,
    setProxy: (config) => {
        mockState.proxyConfig = config;
        return Promise.resolve();
    }
};

const mockShell = {
    openExternal: async (url, options) => {
        mockState.openedExternalUrls.push({ url, options, timestamp: Date.now() });
        return true;
    }
};

const mockApp = {
    isPackaged: false,
    dock: {
        show: () => {},
        setIcon: () => {}
    },
    on: (event, handler) => {
        mockState.appEventListeners[event] = mockState.appEventListeners[event] || [];
        mockState.appEventListeners[event].push(handler);
    },
    quit: () => {},
    relaunch: () => {}
};

const mockIpcMain = {
    _handlers: new Map(),
    handle: (channel, handler) => {
        mockIpcMain._handlers.set(channel, handler);
    },
    removeHandler: (channel) => {
        mockIpcMain._handlers.delete(channel);
    },
    invoke: async (channel, ...args) => {
        const h = mockIpcMain._handlers.get(channel);
        if (!h) throw new Error(`No IPC handler registered for: ${channel}`);
        return await h({}, ...args);
    }
};

const mockState = {
    openedExternalUrls: [],
    windows: [],
    notifications: [],
    shownNotifications: [],
    sentIpcMessages: [],
    loadedUrls: [],
    appEventListeners: {},
    proxyConfig: null
};

function resetMockState() {
    mockState.openedExternalUrls = [];
    mockState.windows = [];
    mockState.notifications = [];
    mockState.shownNotifications = [];
    mockState.sentIpcMessages = [];
    mockState.loadedUrls = [];
    mockState.appEventListeners = {};
    mockState.proxyConfig = null;
    mockWebRequest._filter = null;
    mockWebRequest._listener = null;
    mockIpcMain._handlers.clear();
}

const mockElectron = {
    shell: mockShell,
    BrowserWindow: MockBrowserWindow,
    Notification: MockNotification,
    session: mockSession,
    app: mockApp,
    ipcMain: mockIpcMain,
    nativeTheme: { shouldUseDarkColors: true },
    nativeImage: { createFromPath: () => ({}) }
};

// Install hook in Module._load
let hookInstalled = false;
function installElectronMock() {
    if (hookInstalled) return;
    hookInstalled = true;
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'electron') {
            return mockElectron;
        }
        return origLoad.apply(this, arguments);
    };
}

module.exports = {
    installElectronMock,
    resetMockState,
    mockState,
    mockElectron,
    mockSession,
    mockShell,
    mockWebRequest,
    MockBrowserWindow,
    mockIpcMain
};
