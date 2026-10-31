// webDashboard.js
// High-performance Mobile LAN Web Dashboard for Antigravity
// Bound to 0.0.0.0:51125 with 4-digit PIN authentication.

const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");
const os = require("os");

const USER_HOME = process.env.USERPROFILE || process.env.HOME || "";
const WEB_CONFIG_PATH = path.join(USER_HOME, ".gemini", "antigravity_web_config.json");
const BRAIN_DIR = path.join(USER_HOME, ".gemini", "antigravity", "brain");

function loadWebConfig() {
    let cfg = { port: 51125, pin: "7788", enabled: true };
    if (fs.existsSync(WEB_CONFIG_PATH)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(WEB_CONFIG_PATH, "utf-8"));
            cfg = { ...cfg, ...parsed };
        } catch (e) {}
    } else {
        saveWebConfig(cfg);
    }
    return cfg;
}

function saveWebConfig(cfg) {
    try {
        fs.mkdirSync(path.dirname(WEB_CONFIG_PATH), { recursive: true });
        fs.writeFileSync(WEB_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
    } catch (e) {}
}

function getLanIp() {
    const nets = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                candidates.push({ name, address: net.address });
            }
        }
    }
    const wifiOr192 = candidates.find(c => c.address.startsWith("192.168."));
    if (wifiOr192) return wifiOr192.address;
    const ten = candidates.find(c => c.address.startsWith("10."));
    if (ten) return ten.address;
    const oneSeven = candidates.find(c => c.address.startsWith("172."));
    if (oneSeven) return oneSeven.address;
    return candidates[0]?.address || "127.0.0.1";
}

function getConversationHistory(targetCid = null, limit = 25) {
    let cid = targetCid;
    if (!cid && fs.existsSync(BRAIN_DIR)) {
        try {
            const dirs = fs.readdirSync(BRAIN_DIR).filter(d => {
                try { return fs.statSync(path.join(BRAIN_DIR, d)).isDirectory(); } catch (_) { return false; }
            });
            if (dirs.length > 0) {
                dirs.sort((a, b) => {
                    return fs.statSync(path.join(BRAIN_DIR, b)).mtimeMs - fs.statSync(path.join(BRAIN_DIR, a)).mtimeMs;
                });
                cid = dirs[0];
            }
        } catch (e) {}
    }

    if (!cid) return { cid: null, title: "Нет активного диалога", messages: [] };

    const trPath = path.join(BRAIN_DIR, cid, ".system_generated", "logs", "transcript.jsonl");
    if (!fs.existsSync(trPath)) return { cid, title: "Новый чат", messages: [] };

    try {
        const raw = fs.readFileSync(trPath, "utf-8");
        const lines = raw.split("\n").filter(l => l.trim());
        const messages = [];
        let title = "Диалог Antigravity";
        for (const line of lines) {
            try {
                const step = JSON.parse(line);
                if (step.type === "USER_INPUT" && step.content) {
                    let txt = step.content.replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, "").trim();
                    if (txt.includes("<ADDITIONAL_METADATA>")) {
                        txt = txt.substring(0, txt.indexOf("<ADDITIONAL_METADATA>")).trim();
                    }
                    if (txt) {
                        messages.push({ role: "user", text: txt, time: step.created_at || "" });
                        if (title === "Диалог Antigravity") {
                            title = txt.slice(0, 36) + (txt.length > 36 ? "..." : "");
                        }
                    }
                } else if (step.type === "PLANNER_RESPONSE" && step.content) {
                    const txt = step.content.trim();
                    if (txt) {
                        messages.push({ role: "assistant", text: txt, time: step.created_at || "" });
                    }
                }
            } catch (e) {}
        }
        return {
            cid,
            title,
            messages: messages.slice(-limit)
        };
    } catch (e) {
        return { cid, title: "Ошибка чтения", messages: [] };
    }
}

class WebDashboardServer {
    constructor(multiaccManager) {
        this.multiacc = multiaccManager;
        this.config = loadWebConfig();
        this.server = null;
    }

    start() {
        const PORT = this.config.port || 51125;

        this.server = http.createServer((req, res) => {
            const parsedUrl = new URL(req.url, "http://127.0.0.1");
            const pathname = parsedUrl.pathname;

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dashboard-pin, Authorization");

            if (req.method === "OPTIONS") {
                res.writeHead(204);
                res.end();
                return;
            }

            const sendJson = (status, data) => {
                res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(data));
            };

            const sendHtml = (htmlContent) => {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(htmlContent);
            };

            // Check Auth for API calls
            const checkAuth = () => {
                const reqPin = req.headers["x-dashboard-pin"] ||
                               parsedUrl.searchParams.get("pin") ||
                               (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null);
                return reqPin && String(reqPin).trim() === String(this.config.pin).trim();
            };

            // Public / Root SPA
            if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
                sendHtml(this.renderMobileHtml());
                return;
            }

            // Auth verification endpoint
            if (req.method === "POST" && pathname === "/api/auth") {
                let body = "";
                req.on("data", c => { body += c; });
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        if (String(data.pin).trim() === String(this.config.pin).trim()) {
                            sendJson(200, { ok: true, pin: this.config.pin });
                        } else {
                            sendJson(401, { ok: false, error: "Неверный PIN-код" });
                        }
                    } catch (e) {
                        sendJson(400, { ok: false, error: e.message });
                    }
                });
                return;
            }

            // All remaining /api/* require valid PIN
            if (pathname.startsWith("/api/")) {
                if (!checkAuth()) {
                    sendJson(401, { ok: false, error: "Требуется авторизация (PIN-код)" });
                    return;
                }
            }

            // GET /api/config
            if (req.method === "GET" && pathname === "/api/config") {
                sendJson(200, {
                    ok: true,
                    lanIp: getLanIp(),
                    port: this.config.port,
                    pin: this.config.pin
                });
                return;
            }

            // POST /api/config
            if (req.method === "POST" && pathname === "/api/config") {
                let body = "";
                req.on("data", c => { body += c; });
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        if (data.pin && String(data.pin).trim().length === 4) {
                            this.config.pin = String(data.pin).trim();
                            saveWebConfig(this.config);
                            sendJson(200, { ok: true, pin: this.config.pin });
                        } else {
                            sendJson(400, { ok: false, error: "PIN должен состоять из 4 цифр" });
                        }
                    } catch (e) {
                        sendJson(400, { ok: false, error: e.message });
                    }
                });
                return;
            }

            // GET /api/state - Complete combined dashboard state
            if (req.method === "GET" && pathname === "/api/state") {
                (async () => {
                    try {
                        const status = await this.multiacc.getStatus();
                        const botStatus = await this.multiacc.getBotStatus();
                        
                        let quotas = null;
                        try {
                            const qRes = await this.multiacc.getQuotas();
                            if (qRes && qRes.ok) quotas = qRes.data;
                        } catch (_) {}

                        const activeCid = status.activeConversationId;
                        const convo = getConversationHistory(activeCid, 20);

                        sendJson(200, {
                            ok: true,
                            lanIp: getLanIp(),
                            port: this.config.port,
                            status,
                            bot: botStatus,
                            quotas,
                            convo
                        });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // POST /api/send-prompt
            if (req.method === "POST" && pathname === "/api/send-prompt") {
                let body = "";
                req.on("data", c => { body += c; });
                req.on("end", async () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        const promptText = data.prompt;
                        const targetCid = data.conversationId;
                        if (!promptText || !promptText.trim()) {
                            sendJson(400, { ok: false, error: "Введите текст задачи" });
                            return;
                        }
                        const resInject = await this.multiacc.injectPrompt(promptText, targetCid);
                        sendJson(200, { ok: true, result: resInject });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                });
                return;
            }

            // POST /api/switch-slot
            if (req.method === "POST" && pathname === "/api/switch-slot") {
                let body = "";
                req.on("data", c => { body += c; });
                req.on("end", async () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        const slot = data.slot;
                        if (!slot) {
                            sendJson(400, { ok: false, error: "slot required" });
                            return;
                        }
                        const newStatus = await this.multiacc.switchProfile(String(slot));
                        sendJson(200, { ok: true, status: newStatus });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                });
                return;
            }

            // POST /api/cycle-slot
            if (req.method === "POST" && pathname === "/api/cycle-slot") {
                (async () => {
                    try {
                        const newStatus = await this.multiacc.cycleProfile();
                        sendJson(200, { ok: true, status: newStatus });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // POST /api/toggle-autofailover
            if (req.method === "POST" && pathname === "/api/toggle-autofailover") {
                (async () => {
                    try {
                        const newStatus = await this.multiacc.toggleAutoFailover();
                        sendJson(200, { ok: true, status: newStatus });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // POST /api/toggle-bot
            if (req.method === "POST" && pathname === "/api/toggle-bot") {
                (async () => {
                    try {
                        const resToggle = await this.multiacc.toggleBot();
                        sendJson(200, { ok: true, bot: resToggle });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // POST /api/new-chat
            if (req.method === "POST" && pathname === "/api/new-chat") {
                (async () => {
                    try {
                        const resNew = await this.multiacc.newConversation();
                        sendJson(200, { ok: true, result: resNew });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // POST /api/focus-pc
            if (req.method === "POST" && pathname === "/api/focus-pc") {
                try {
                    const resFocus = this.multiacc.focusWindow();
                    sendJson(200, { ok: true, result: resFocus });
                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
                return;
            }

            sendJson(404, { ok: false, error: "Not found" });
        });

        this.server.on("error", (err) => {
            if (err.code === "EADDRINUSE") {
                console.warn(`[WebDashboard] Port ${PORT} in use, skipping...`);
            } else {
                console.error("[WebDashboard Server Error]:", err);
            }
        });

        try {
            this.server.listen(PORT, "0.0.0.0", () => {
                const lan = getLanIp();
                console.log(`[WebDashboard] 📱 Mobile LAN Dashboard active at http://${lan}:${PORT}`);
            });
            try { this.server.unref(); } catch (_) {}
        } catch (e) {
            console.error("[WebDashboard] Failed to bind 0.0.0.0:", e);
        }
    }

    renderMobileHtml() {
        return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Antigravity Mobile</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#0d1117">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      padding-bottom: 90px;
    }
    header {
      background: rgba(22, 27, 34, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 16px;
      color: #f0f6fc;
      letter-spacing: -0.3px;
    }
    .brand span.badge {
      background: #1f6feb22;
      color: #58a6ff;
      border: 1px solid #1f6feb55;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 12px;
      font-weight: 600;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-icon {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn-icon:active { background: #30363d; }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #238636;
      box-shadow: 0 0 6px #238636;
    }
    .status-dot.offline { background: #da3633; box-shadow: 0 0 6px #da3633; }

    main {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 600px;
      margin: 0 auto;
      width: 100%;
    }

    .card {
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    .card-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #8b949e;
      font-weight: 600;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Quotas */
    .quota-item {
      margin-bottom: 10px;
    }
    .quota-item:last-child { margin-bottom: 0; }
    .quota-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .quota-label { color: #f0f6fc; font-weight: 500; }
    .quota-val { font-weight: 600; }
    .progress-bar-bg {
      height: 7px;
      background: #21262d;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .quota-time {
      font-size: 10px;
      color: #8b949e;
      margin-top: 2px;
      text-align: right;
    }

    /* Accounts Carousel */
    .account-active-badge {
      font-size: 13px;
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .slots-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }
    .slot-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 8px 4px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .slot-btn.active {
      background: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
      box-shadow: 0 0 10px rgba(31, 111, 235, 0.4);
    }
    .slot-btn:active { transform: scale(0.96); }

    .acc-actions {
      display: flex;
      gap: 8px;
    }
    .btn-acc {
      flex: 1;
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid #30363d;
      background: #21262d;
      color: #c9d1d9;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 4px;
    }
    .btn-acc:active { background: #30363d; }
    .btn-acc.on { color: #3fb950; border-color: rgba(63, 185, 80, 0.4); background: rgba(63, 185, 80, 0.12); }

    /* Chat Messages */
    .chat-box {
      max-height: 280px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 4px;
      margin-bottom: 10px;
    }
    .chat-msg {
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: #1f6feb;
      color: #ffffff;
      border-bottom-right-radius: 2px;
      max-width: 85%;
    }
    .chat-msg.assistant {
      align-self: flex-start;
      background: #21262d;
      color: #c9d1d9;
      border-bottom-left-radius: 2px;
      max-width: 95%;
      border: 1px solid rgba(255, 255, 255, 0.05);
      white-space: pre-wrap;
    }

    /* Fixed Bottom Action Bar */
    .bottom-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(22, 27, 34, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding: 8px 12px max(8px, env(safe-area-inset-bottom));
      z-index: 100;
    }
    .prompt-form {
      display: flex;
      gap: 8px;
      max-width: 600px;
      margin: 0 auto;
    }
    .prompt-input {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 10px;
      color: #f0f6fc;
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      resize: none;
      height: 42px;
      max-height: 90px;
    }
    .prompt-input:focus { border-color: #58a6ff; }
    .btn-send {
      background: #238636;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #ffffff;
      font-weight: 600;
      padding: 0 16px;
      border-radius: 10px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s ease;
    }
    .btn-send:active { background: #2ea043; }
    .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }

    /* PIN Modal */
    .pin-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #0d1117;
      z-index: 999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .pin-card {
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 320px;
      text-align: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .pin-dots {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin: 20px 0;
    }
    .pin-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid #58a6ff;
      background: transparent;
      transition: all 0.2s;
    }
    .pin-dot.filled { background: #58a6ff; }
    .pin-pad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .pin-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #f0f6fc;
      border-radius: 12px;
      font-size: 18px;
      font-weight: 600;
      padding: 14px 0;
      cursor: pointer;
    }
    .pin-btn:active { background: #388bfd33; border-color: #58a6ff; }
    .pin-btn.action { font-size: 14px; background: transparent; border-color: transparent; color: #8b949e; }

    /* Toast */
    .toast {
      position: fixed;
      top: 64px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f6feb;
      color: #fff;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      z-index: 200;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>

  <!-- PIN Entry Overlay -->
  <div class="pin-overlay" id="pinOverlay">
    <div class="pin-card">
      <div style="font-size:32px; margin-bottom:8px;">📱</div>
      <h2 style="font-size:17px; font-weight:700; color:#f0f6fc; margin-bottom:4px;">Antigravity Mobile</h2>
      <p style="font-size:12px; color:#8b949e;">Введите 4-значный PIN-код</p>
      
      <div class="pin-dots">
        <div class="pin-dot" id="dot0"></div>
        <div class="pin-dot" id="dot1"></div>
        <div class="pin-dot" id="dot2"></div>
        <div class="pin-dot" id="dot3"></div>
      </div>

      <div class="pin-pad">
        <button class="pin-btn" onclick="pressPin('1')">1</button>
        <button class="pin-btn" onclick="pressPin('2')">2</button>
        <button class="pin-btn" onclick="pressPin('3')">3</button>
        <button class="pin-btn" onclick="pressPin('4')">4</button>
        <button class="pin-btn" onclick="pressPin('5')">5</button>
        <button class="pin-btn" onclick="pressPin('6')">6</button>
        <button class="pin-btn" onclick="pressPin('7')">7</button>
        <button class="pin-btn" onclick="pressPin('8')">8</button>
        <button class="pin-btn" onclick="pressPin('9')">9</button>
        <button class="pin-btn action" onclick="clearPin()">C</button>
        <button class="pin-btn" onclick="pressPin('0')">0</button>
        <button class="pin-btn action" onclick="backspacePin()">⌫</button>
      </div>
      <div style="margin-top:14px; font-size:11px; color:#58a6ff;">По умолчанию: <b>7788</b></div>
    </div>
  </div>

  <!-- Header -->
  <header>
    <div class="brand">
      <div class="status-dot" id="connDot"></div>
      <span>Antigravity</span>
      <span class="badge">LAN</span>
    </div>
    <div class="header-actions">
      <button class="btn-icon" onclick="focusPc()" title="Развернуть окно Antigravity на ноутбуке">💻 Окно</button>
      <button class="btn-icon" onclick="newChat()" title="Создать новый чат">➕ Новый</button>
      <button class="btn-icon" onclick="logout()" title="Выйти">🔒</button>
    </div>
  </header>

  <main>

    <!-- Quotas Section -->
    <div class="card">
      <div class="card-title">
        <span>⏳ Квоты Моделей</span>
        <button class="btn-icon" style="padding:2px 8px; font-size:10px;" onclick="fetchState(true)">🔄 Обновить</button>
      </div>
      <div id="quotasContainer">
        <div style="font-size:12px; color:#8b949e; text-align:center; padding:10px;">Загрузка квот...</div>
      </div>
    </div>

    <!-- Accounts Section -->
    <div class="card">
      <div class="card-title">
        <span>👤 Аккаунты Google</span>
        <span id="failoverBadge" style="font-size:10px; color:#58a6ff;">Авто: ВКЛ</span>
      </div>
      <div class="account-active-badge">
        <span id="activeSlotPill" style="background:#238636; color:#fff; padding:2px 6px; border-radius:6px; font-size:11px;">Слот 1</span>
        <span id="activeEmailText" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Загрузка...</span>
      </div>
      <div class="slots-grid" id="slotsGrid">
        <button class="slot-btn" onclick="switchSlot(1)">Слот 1</button>
        <button class="slot-btn" onclick="switchSlot(2)">Слот 2</button>
        <button class="slot-btn" onclick="switchSlot(3)">Слот 3</button>
        <button class="slot-btn" onclick="switchSlot(4)">Слот 4</button>
      </div>
      <div class="acc-actions">
        <button class="btn-acc" onclick="cycleSlot()">↻ След. аккаунт</button>
        <button class="btn-acc" id="autoFailoverBtn" onclick="toggleFailover()">⚡ Автопереход</button>
      </div>
    </div>

    <!-- Active Chat & Telegram Bot Status -->
    <div class="card">
      <div class="card-title">
        <span id="chatTitle">💬 Активный Диалог</span>
        <span id="botStatusBadge" style="font-size:10px; cursor:pointer;" onclick="toggleBot()">🤖 Бот: ...</span>
      </div>
      <div class="chat-box" id="chatBox">
        <div style="font-size:12px; color:#8b949e; text-align:center; padding:20px;">Загрузка сообщений...</div>
      </div>
    </div>

  </main>

  <!-- Sticky Bottom Prompt Bar -->
  <div class="bottom-bar">
    <div class="prompt-form">
      <textarea class="prompt-input" id="promptInput" rows="1" placeholder="Задача для Antigravity..." onkeydown="handleInputKey(event)"></textarea>
      <button class="btn-send" id="sendBtn" onclick="sendPrompt()">🚀 Отправить</button>
    </div>
  </div>

  <div class="toast" id="toast">Готово</div>

  <script>
    let currentPin = localStorage.getItem("ag_dashboard_pin") || "";
    let enteredPin = "";
    let isSending = false;

    // Check URL query param pin
    const urlParams = new URLSearchParams(window.location.search);
    const qPin = urlParams.get("pin");
    if (qPin && qPin.length === 4) {
      currentPin = qPin;
      localStorage.setItem("ag_dashboard_pin", currentPin);
    }

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.textContent = msg;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2500);
    }

    function updatePinDots() {
      for (let i = 0; i < 4; i++) {
        const d = document.getElementById("dot" + i);
        if (i < enteredPin.length) d.classList.add("filled");
        else d.classList.remove("filled");
      }
    }

    function pressPin(digit) {
      if (enteredPin.length < 4) {
        enteredPin += digit;
        updatePinDots();
        if (enteredPin.length === 4) {
          verifyPin(enteredPin);
        }
      }
    }

    function clearPin() {
      enteredPin = "";
      updatePinDots();
    }

    function backspacePin() {
      enteredPin = enteredPin.slice(0, -1);
      updatePinDots();
    }

    async function verifyPin(pinToTest) {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: pinToTest })
        });
        const data = await res.json();
        if (data.ok) {
          currentPin = pinToTest;
          localStorage.setItem("ag_dashboard_pin", currentPin);
          document.getElementById("pinOverlay").style.display = "none";
          showToast("🔓 Авторизация успешна!");
          fetchState();
        } else {
          clearPin();
          showToast("❌ " + (data.error || "Неверный PIN"));
        }
      } catch (e) {
        clearPin();
        showToast("❌ Ошибка соединения: " + e.message);
      }
    }

    function logout() {
      localStorage.removeItem("ag_dashboard_pin");
      currentPin = "";
      enteredPin = "";
      updatePinDots();
      document.getElementById("pinOverlay").style.display = "flex";
    }

    if (currentPin && currentPin.length === 4) {
      document.getElementById("pinOverlay").style.display = "none";
    }

    function apiCall(endpoint, method = "GET", body = null) {
      return fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-dashboard-pin": currentPin
        },
        body: body ? JSON.stringify(body) : null
      }).then(async r => {
        if (r.status === 401) {
          logout();
          throw new Error("Не авторизован");
        }
        return r.json();
      });
    }

    function formatTimeRemaining(isoStr) {
      if (!isoStr) return "";
      try {
        const diffSec = Math.max(0, Math.floor((new Date(isoStr) - new Date()) / 1000));
        const days = Math.floor(diffSec / 86400);
        const rem = diffSec % 86400;
        const hours = Math.floor(rem / 3600);
        const mins = Math.floor((rem % 3600) / 60);
        if (days > 0) return days + " дн. " + hours + " ч.";
        if (hours > 0) return hours + " ч. " + mins + " мин.";
        return mins + " мин.";
      } catch (e) { return ""; }
    }

    function renderQuotas(quotaData) {
      const container = document.getElementById("quotasContainer");
      if (!quotaData || !quotaData.response || !quotaData.response.groups) {
        container.innerHTML = '<div style="font-size:12px; color:#8b949e; text-align:center; padding:6px;">Квоты не загружены</div>';
        return;
      }
      const groups = quotaData.response.groups;
      let html = '';
      for (const g of groups) {
        for (const b of (g.buckets || [])) {
          const frac = Math.max(0, Math.min(1, b.remainingFraction || 0));
          const pct = (frac * 100).toFixed(0);
          const isWeekly = (b.window === "weekly" || (b.displayName || "").toLowerCase().includes("week"));
          const label = isWeekly ? "Недельный лимит (" + g.displayName.split(" ")[0] + ")" : "5-часовой лимит (" + g.displayName.split(" ")[0] + ")";
          const resetStr = formatTimeRemaining(b.resetTime);

          let color = "#238636";
          if (pct < 20) color = "#da3633";
          else if (pct < 50) color = "#d29922";

          html += \`
            <div class="quota-item">
              <div class="quota-header">
                <span class="quota-label">\${label}</span>
                <span class="quota-val" style="color:\${color};">\${pct}%</span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width:\${pct}%; background:\${color};"></div>
              </div>
              \${resetStr ? '<div class="quota-time">Сброс через ' + resetStr + '</div>' : ''}
            </div>
          \`;
        }
      }
      container.innerHTML = html || '<div style="font-size:12px; color:#8b949e;">Квоты не найдены</div>';
    }

    function renderAccounts(status) {
      if (!status) return;
      const activeSlot = status.activeSlot || 1;
      const accounts = status.accounts || [];
      const currentEmail = status.currentEmail || (accounts.find(a => a.slot === activeSlot)?.email) || "Аккаунт " + activeSlot;

      document.getElementById("activeSlotPill").textContent = "Слот " + activeSlot;
      document.getElementById("activeEmailText").textContent = currentEmail;

      const failoverBtn = document.getElementById("autoFailoverBtn");
      const failoverBadge = document.getElementById("failoverBadge");
      if (status.autoFailover) {
        failoverBtn.classList.add("on");
        failoverBadge.textContent = "Авто: ВКЛ";
        failoverBadge.style.color = "#3fb950";
      } else {
        failoverBtn.classList.remove("on");
        failoverBadge.textContent = "Авто: ВЫКЛ";
        failoverBadge.style.color = "#8b949e";
      }

      const grid = document.getElementById("slotsGrid");
      grid.innerHTML = "";
      const maxSlots = Math.max(4, accounts.length);
      for (let s = 1; s <= maxSlots; s++) {
        const acc = accounts.find(a => a.slot === s);
        const btn = document.createElement("button");
        btn.className = "slot-btn" + (s === activeSlot ? " active" : "");
        btn.textContent = "Слот " + s + (acc ? " ✓" : "");
        btn.onclick = () => switchSlot(s);
        grid.appendChild(btn);
      }
    }

    function renderBot(bot) {
      const b = document.getElementById("botStatusBadge");
      if (bot && bot.running) {
        b.innerHTML = '🤖 Бот: <b style="color:#3fb950;">ВКЛ</b>';
      } else {
        b.innerHTML = '🤖 Бот: <b style="color:#8b949e;">ВЫКЛ</b>';
      }
    }

    function renderChat(convo) {
      if (!convo) return;
      document.getElementById("chatTitle").textContent = "💬 " + (convo.title || "Диалог");
      const box = document.getElementById("chatBox");
      const msgs = convo.messages || [];
      if (msgs.length === 0) {
        box.innerHTML = '<div style="font-size:12px; color:#8b949e; text-align:center; padding:20px;">Нет сообщений в этом чате</div>';
        return;
      }
      let html = "";
      for (const m of msgs) {
        const cls = m.role === "user" ? "user" : "assistant";
        html += '<div class="chat-msg ' + cls + '">' + escapeHtml(m.text) + '</div>';
      }
      box.innerHTML = html;
      box.scrollTop = box.scrollHeight;
    }

    function escapeHtml(str) {
      return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    async function fetchState(manual = false) {
      if (!currentPin) return;
      try {
        const data = await apiCall("/api/state");
        if (data.ok) {
          document.getElementById("connDot").classList.remove("offline");
          renderQuotas(data.quotas);
          renderAccounts(data.status);
          renderBot(data.bot);
          renderChat(data.convo);
          if (manual) showToast("Данные обновлены!");
        }
      } catch (e) {
        document.getElementById("connDot").classList.add("offline");
      }
    }

    async function switchSlot(slotNum) {
      showToast("Переключение на слот " + slotNum + "...");
      try {
        await apiCall("/api/switch-slot", "POST", { slot: slotNum });
        await fetchState();
        showToast("Слот " + slotNum + " активен!");
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    async function cycleSlot() {
      showToast("Ротация аккаунта...");
      try {
        await apiCall("/api/cycle-slot", "POST");
        await fetchState();
        showToast("Аккаунт переключен!");
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    async function toggleFailover() {
      try {
        await apiCall("/api/toggle-autofailover", "POST");
        await fetchState();
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    async function toggleBot() {
      showToast("Переключение бота...");
      try {
        await apiCall("/api/toggle-bot", "POST");
        await fetchState();
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    async function newChat() {
      if (!confirm("Создать новый чат в Antigravity?")) return;
      try {
        await apiCall("/api/new-chat", "POST");
        showToast("Создан новый чат!");
        await fetchState();
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    async function focusPc() {
      try {
        await apiCall("/api/focus-pc", "POST");
        showToast("Окно развернуто на ПК!");
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    function handleInputKey(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    }

    async function sendPrompt() {
      const input = document.getElementById("promptInput");
      const text = input.value.trim();
      if (!text || isSending) return;

      isSending = true;
      const sendBtn = document.getElementById("sendBtn");
      sendBtn.disabled = true;
      sendBtn.textContent = "⏳...";

      // Optimistic append
      const box = document.getElementById("chatBox");
      box.innerHTML += '<div class="chat-msg user">' + escapeHtml(text) + '</div>';
      box.scrollTop = box.scrollHeight;
      input.value = "";

      try {
        await apiCall("/api/send-prompt", "POST", { prompt: text });
        showToast("Задача передана агенту!");
        setTimeout(fetchState, 1500);
      } catch (e) {
        showToast("Ошибка отправки: " + e.message);
      } finally {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "🚀 Отправить";
      }
    }

    if (currentPin) {
      fetchState();
      setInterval(() => fetchState(false), 2500);
    }
  </script>
</body>
</html>`;
    }
}

function startWebDashboard(multiaccManager) {
    const dashboard = new WebDashboardServer(multiaccManager);
    dashboard.start();
    return dashboard;
}

module.exports = {
    WebDashboardServer,
    startWebDashboard,
    loadWebConfig,
    saveWebConfig,
    getLanIp,
    getConversationHistory
};
