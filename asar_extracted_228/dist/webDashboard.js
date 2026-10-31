// webDashboard.js
// High-performance Mobile LAN Web Dashboard & Full Antigravity Client
// Bound to 0.0.0.0:51125 with 4-digit PIN authentication.

const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const USER_HOME = process.env.USERPROFILE || process.env.HOME || "";
const WEB_CONFIG_PATH = path.join(USER_HOME, ".gemini", "antigravity_web_config.json");
const BRAIN_DIR = path.join(USER_HOME, ".gemini", "antigravity", "brain");

// ---------------------------------------------------------------------------
// Helpers & Paths
// ---------------------------------------------------------------------------

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

function getCredHelperPath() {
    const candidates = [
        path.join(__dirname, "credHelper.py"),
        path.join(__dirname, "..", "credHelper.py"),
        path.join(process.resourcesPath || "", "app.asar.unpacked", "dist", "credHelper.py"),
        path.join(USER_HOME, ".gemini", "antigravity", "credHelper.py")
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return null;
}

// ---------------------------------------------------------------------------
// In-Memory Caching (Lag Elimination)
// ---------------------------------------------------------------------------

let cachedQuotas = null;
let lastQuotasFetch = 0;
const QUOTA_CACHE_TTL = 60000; // 60s cache to avoid spamming Language Server

async function getCachedQuotas(multiacc, force = false) {
    const now = Date.now();
    if (!force && cachedQuotas && (now - lastQuotasFetch < QUOTA_CACHE_TTL)) {
        return cachedQuotas;
    }
    try {
        const qRes = await multiacc.getQuotas();
        if (qRes && qRes.ok) {
            cachedQuotas = qRes.data;
            lastQuotasFetch = now;
            return cachedQuotas;
        }
    } catch (_) {}
    return cachedQuotas;
}

let conversationsCache = null;
let conversationsCacheTime = 0;

function getConversationsList(force = false) {
    const now = Date.now();
    if (!force && conversationsCache && (now - conversationsCacheTime < 6000)) {
        return conversationsCache;
    }
    const helperPath = getCredHelperPath();
    if (!helperPath) {
        return { workspaces: [], conversations: [] };
    }
    try {
        const out = execFileSync("python", [helperPath, "conversations"], {
            encoding: "utf-8",
            timeout: 5000,
            windowsHide: true
        });
        const data = JSON.parse(out);
        conversationsCache = data;
        conversationsCacheTime = now;
        return data;
    } catch (e) {
        console.warn("[WebDashboard] Failed to fetch conversations via credHelper:", e.message);
        return conversationsCache || { workspaces: [], conversations: [] };
    }
}

// Cache of parsed conversation transcripts: cid -> { mtimeMs, size, data }
const historyCache = new Map();

function getConversationHistory(targetCid = null, limit = 40) {
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

    if (!cid) return { cid: null, title: "Нет активного диалога", workspace: "", messages: [] };

    const trPath = path.join(BRAIN_DIR, cid, ".system_generated", "logs", "transcript.jsonl");
    if (!fs.existsSync(trPath)) return { cid, title: "Новый чат", workspace: "", messages: [] };

    try {
        const stat = fs.statSync(trPath);
        const cached = historyCache.get(cid);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.data;
        }

        // Fast tail reading: if file > 250KB, only read the last 250KB
        const maxBytes = 250 * 1024;
        let raw = "";
        if (stat.size <= maxBytes) {
            raw = fs.readFileSync(trPath, "utf-8");
        } else {
            const buffer = Buffer.alloc(maxBytes);
            const fd = fs.openSync(trPath, "r");
            fs.readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
            fs.closeSync(fd);
            raw = buffer.toString("utf8");
            const firstNl = raw.indexOf("\n");
            if (firstNl !== -1) {
                raw = raw.substring(firstNl + 1);
            }
        }

        const lines = raw.split("\n").filter(l => l.trim());
        const messages = [];
        let title = "";
        let workspace = "";

        // Check if we can find title and workspace from conversations db cache
        if (conversationsCache && conversationsCache.conversations) {
            const found = conversationsCache.conversations.find(c => c.id === cid);
            if (found) {
                title = found.title;
                workspace = found.workspace_name || found.workspace || "";
            }
        }

        for (const line of lines) {
            try {
                const step = JSON.parse(line);
                if (step.type === "USER_INPUT" && step.content) {
                    let txt = step.content.replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, "").trim();
                    if (txt.includes("<ADDITIONAL_METADATA>")) {
                        txt = txt.substring(0, txt.indexOf("<ADDITIONAL_METADATA>")).trim();
                    }
                    if (txt) {
                        messages.push({
                            role: "user",
                            text: txt,
                            time: step.created_at || ""
                        });
                        if (!title) {
                            title = txt.slice(0, 40) + (txt.length > 40 ? "..." : "");
                        }
                    }
                } else if (step.type === "PLANNER_RESPONSE") {
                    if (step.content && step.content.trim()) {
                        messages.push({
                            role: "assistant",
                            text: step.content.trim(),
                            thinking: step.thinking ? step.thinking.trim() : null,
                            time: step.created_at || ""
                        });
                    }
                    if (step.tool_calls && Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
                        for (const tc of step.tool_calls) {
                            messages.push({
                                role: "tool",
                                name: tc.name || "tool",
                                summary: tc.args?.toolSummary || tc.args?.CommandLine || tc.name || "",
                                time: step.created_at || ""
                            });
                        }
                    }
                }
            } catch (e) {}
        }

        if (!title) title = "Диалог Antigravity";

        const res = {
            cid,
            title,
            workspace,
            messages: messages.slice(-limit)
        };

        historyCache.set(cid, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            data: res
        });

        return res;
    } catch (e) {
        return { cid, title: "Ошибка чтения", workspace: "", messages: [] };
    }
}

function getArtifactsList(cid) {
    if (!cid) return [];
    const dir = path.join(BRAIN_DIR, cid);
    if (!fs.existsSync(dir)) return [];
    try {
        const files = fs.readdirSync(dir);
        const mdFiles = files.filter(f => f.endsWith(".md"));
        const results = [];
        for (const f of mdFiles) {
            try {
                const fullPath = path.join(dir, f);
                const stat = fs.statSync(fullPath);
                let title = f.replace(/\.md$/, "");
                const fd = fs.openSync(fullPath, "r");
                const buf = Buffer.alloc(Math.min(stat.size, 512));
                fs.readSync(fd, buf, 0, buf.length, 0);
                fs.closeSync(fd);
                const text = buf.toString("utf8");
                const m = text.match(/^#\s+(.+)$/m);
                if (m) title = m[1].trim();
                results.push({
                    name: f,
                    title,
                    size: stat.size,
                    mtime: stat.mtimeMs
                });
            } catch (_) {}
        }
        results.sort((a, b) => b.mtime - a.mtime);
        return results;
    } catch (_) {
        return [];
    }
}

function getArtifactContent(cid, filename) {
    if (!cid || !filename) return null;
    const safeName = path.basename(filename);
    const fullPath = path.join(BRAIN_DIR, cid, safeName);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
}

function getPresetsInfo() {
    try {
        try { delete require.cache[require.resolve("./skillManager")]; } catch (_) {}
        const { skillManager } = require("./skillManager");
        return {
            activePreset: skillManager.getActivePreset(),
            presets: skillManager.getPresets()
        };
    } catch (e) {
        return { activePreset: "minimal", presets: [] };
    }
}

function applyPresetSafe(presetName) {
    try {
        try { delete require.cache[require.resolve("./skillManager")]; } catch (_) {}
        const { skillManager } = require("./skillManager");
        let workspacePath = process.cwd();
        try {
            const prjPath = path.join(USER_HOME, ".gemini", "projects.json");
            if (fs.existsSync(prjPath)) {
                const prj = JSON.parse(fs.readFileSync(prjPath, "utf8"));
                const paths = Object.keys(prj.projects || {});
                if (paths.length > 0) workspacePath = paths[paths.length - 1];
            }
        } catch (_) {}
        return skillManager.applyPresetByName(presetName, workspacePath);
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ---------------------------------------------------------------------------
// Server Class
// ---------------------------------------------------------------------------

class WebDashboardServer {
    constructor(multiaccManager) {
        this.multiacc = multiaccManager;
        this.config = loadWebConfig();
        this.server = null;
        this.activeConversationIdOverride = null;
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

            const checkAuth = () => {
                const reqPin = req.headers["x-dashboard-pin"] ||
                               parsedUrl.searchParams.get("pin") ||
                               (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null);
                return reqPin && String(reqPin).trim() === String(this.config.pin).trim();
            };

            // Public Root SPA
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

            // All remaining /api/* endpoints require valid PIN
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

            // GET /api/state - High-speed cached status & chat state
            if (req.method === "GET" && pathname === "/api/state") {
                (async () => {
                    try {
                        const status = await this.multiacc.getStatus();
                        const botStatus = await this.multiacc.getBotStatus();
                        const quotas = await getCachedQuotas(this.multiacc, parsedUrl.searchParams.get("force") === "1");
                        const presetsInfo = getPresetsInfo();

                        const activeCid = this.activeConversationIdOverride || status.activeConversationId;
                        const convo = getConversationHistory(activeCid, 35);

                        sendJson(200, {
                            ok: true,
                            lanIp: getLanIp(),
                            port: this.config.port,
                            status,
                            bot: botStatus,
                            quotas,
                            activePreset: presetsInfo.activePreset,
                            convo
                        });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // POST /api/refresh-quotas - Bypass quota cache
            if (req.method === "POST" && pathname === "/api/refresh-quotas") {
                (async () => {
                    try {
                        const quotas = await getCachedQuotas(this.multiacc, true);
                        sendJson(200, { ok: true, quotas });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // GET /api/conversations - List all projects & conversations
            if (req.method === "GET" && pathname === "/api/conversations") {
                try {
                    const data = getConversationsList(parsedUrl.searchParams.get("force") === "1");
                    sendJson(200, { ok: true, ...data });
                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
                return;
            }

            // POST /api/switch-conversation
            if (req.method === "POST" && pathname === "/api/switch-conversation") {
                let body = "";
                req.on("data", c => { body += c; });
                req.on("end", async () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        const cid = data.conversationId;
                        if (!cid) {
                            sendJson(400, { ok: false, error: "conversationId is required" });
                            return;
                        }
                        this.activeConversationIdOverride = cid;
                        if (typeof this.multiacc.switchConversation === "function") {
                            await this.multiacc.switchConversation(cid);
                        }
                        sendJson(200, { ok: true, conversationId: cid });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                });
                return;
            }

            // POST /api/new-conversation or /api/new-chat
            if (req.method === "POST" && (pathname === "/api/new-conversation" || pathname === "/api/new-chat")) {
                (async () => {
                    try {
                        this.activeConversationIdOverride = null;
                        conversationsCache = null; // force reload next time
                        const resNew = await this.multiacc.newConversation();
                        sendJson(200, { ok: true, result: resNew });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                })();
                return;
            }

            // GET /api/artifacts?cid=<cid>
            if (req.method === "GET" && pathname === "/api/artifacts") {
                try {
                    const cid = parsedUrl.searchParams.get("cid") || this.activeConversationIdOverride;
                    const artifacts = getArtifactsList(cid);
                    sendJson(200, { ok: true, cid, artifacts });
                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
                return;
            }

            // GET /api/artifact-content?cid=<cid>&name=<filename>
            if (req.method === "GET" && pathname === "/api/artifact-content") {
                try {
                    const cid = parsedUrl.searchParams.get("cid") || this.activeConversationIdOverride;
                    const name = parsedUrl.searchParams.get("name");
                    const content = getArtifactContent(cid, name);
                    if (content === null) {
                        sendJson(404, { ok: false, error: "Artifact not found" });
                    } else {
                        sendJson(200, { ok: true, name, content });
                    }
                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
                return;
            }

            // GET /api/presets
            if (req.method === "GET" && pathname === "/api/presets") {
                try {
                    const info = getPresetsInfo();
                    sendJson(200, { ok: true, ...info });
                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
                return;
            }

            // POST /api/switch-preset
            if (req.method === "POST" && pathname === "/api/switch-preset") {
                let body = "";
                req.on("data", c => { body += c; });
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        const targetPreset = data.preset;
                        if (!targetPreset) {
                            sendJson(400, { ok: false, error: "preset is required" });
                            return;
                        }
                        const resSwitch = applyPresetSafe(targetPreset);
                        sendJson(200, { ok: true, activePreset: targetPreset, result: resSwitch });
                    } catch (err) {
                        sendJson(500, { ok: false, error: err.message });
                    }
                });
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
                        const targetCid = data.conversationId || this.activeConversationIdOverride;
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
  <title>Antigravity Mobile Client</title>
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
      padding-bottom: 74px;
    }
    header {
      background: rgba(22, 27, 34, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 15px;
      color: #f0f6fc;
      letter-spacing: -0.3px;
    }
    .brand span.badge {
      background: #1f6feb22;
      color: #58a6ff;
      border: 1px solid #1f6feb55;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #238636;
      box-shadow: 0 0 6px #238636;
      animation: pulseDot 2s infinite ease-in-out;
    }
    .status-dot.offline { background: #da3633; box-shadow: 0 0 6px #da3633; animation: none; }
    @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-icon {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 5px 8px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn-icon:active { background: #30363d; }

    /* Bottom Navigation Bar */
    .nav-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(22, 27, 34, 0.96);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-around;
      align-items: center;
      padding: 6px 4px max(6px, env(safe-area-inset-bottom));
      z-index: 100;
    }
    .nav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      background: transparent;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
      padding: 4px 0;
      transition: all 0.15s ease;
    }
    .nav-item .nav-icon { font-size: 18px; line-height: 1; }
    .nav-item.active { color: #58a6ff; }
    .nav-item.active .nav-icon { transform: scale(1.1); }

    /* Tab Containers */
    .tab-content {
      display: none;
      flex-direction: column;
      flex: 1;
      width: 100%;
      max-width: 680px;
      margin: 0 auto;
      padding: 10px 12px;
      animation: fadeIn 0.15s ease-out;
    }
    .tab-content.active { display: flex; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* Card Layouts */
    .card {
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 12px;
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

    /* Tab 1: Chat View */
    .chat-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 8px 12px;
      margin-bottom: 10px;
    }
    .chat-info-title {
      font-size: 13px;
      font-weight: 600;
      color: #f0f6fc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
    }
    .chat-workspace-badge {
      font-size: 10px;
      color: #58a6ff;
      background: rgba(56, 139, 253, 0.1);
      border: 1px solid rgba(56, 139, 253, 0.25);
      padding: 1px 6px;
      border-radius: 8px;
    }
    .chat-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 110px;
    }
    .chat-msg {
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #1f6feb, #1158c7);
      color: #ffffff;
      border-bottom-right-radius: 3px;
      max-width: 88%;
      box-shadow: 0 2px 6px rgba(31, 111, 235, 0.3);
    }
    .chat-msg.assistant {
      align-self: flex-start;
      background: #161b22;
      color: #c9d1d9;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom-left-radius: 3px;
      max-width: 98%;
      width: 100%;
    }
    .chat-time {
      font-size: 9px;
      opacity: 0.6;
      margin-top: 4px;
      text-align: right;
    }

    /* Thinking Collapsible */
    .thinking-box {
      margin-bottom: 8px;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      overflow: hidden;
    }
    .thinking-box summary {
      padding: 6px 10px;
      font-size: 11px;
      color: #8b949e;
      cursor: pointer;
      font-weight: 500;
      user-select: none;
    }
    .thinking-box summary:hover { color: #c9d1d9; }
    .thinking-content {
      padding: 8px 10px;
      font-size: 11px;
      color: #8b949e;
      white-space: pre-wrap;
      line-height: 1.4;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      max-height: 200px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    /* Tool Call Pill */
    .tool-pill {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(22, 27, 34, 0.8);
      border: 1px solid rgba(56, 139, 253, 0.25);
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 11px;
      color: #79c0ff;
      margin: 2px 0;
    }
    .tool-summary {
      color: #8b949e;
      font-style: italic;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 260px;
    }

    /* Markdown & Code Blocks */
    .rendered-md p { margin-bottom: 8px; }
    .rendered-md p:last-child { margin-bottom: 0; }
    .rendered-md h1, .rendered-md h2, .rendered-md h3 { margin: 10px 0 6px; color: #f0f6fc; font-size: 14px; }
    .rendered-md ul, .rendered-md ol { margin-left: 18px; margin-bottom: 8px; }
    .rendered-md li { margin-bottom: 4px; }
    .rendered-md code {
      background: rgba(110, 118, 129, 0.2);
      padding: 2px 5px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      color: #ff7b72;
    }
    .rendered-md pre {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 10px;
      overflow-x: auto;
      position: relative;
      margin: 8px 0;
    }
    .rendered-md pre code {
      background: transparent;
      padding: 0;
      color: #e6edf3;
      display: block;
      font-size: 11px;
      white-space: pre;
    }
    .copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #8b949e;
      font-size: 10px;
      padding: 3px 6px;
      border-radius: 4px;
      cursor: pointer;
    }
    .copy-btn:hover { color: #f0f6fc; }

    /* Sticky Prompt Dock */
    .dock-bar {
      position: fixed;
      bottom: 56px;
      left: 0;
      right: 0;
      background: rgba(22, 27, 34, 0.98);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding: 8px 12px;
      z-index: 90;
    }
    .chips-row {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 6px;
      margin-bottom: 4px;
      scrollbar-width: none;
    }
    .chips-row::-webkit-scrollbar { display: none; }
    .chip {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 12px;
      white-space: nowrap;
      cursor: pointer;
    }
    .chip:active { background: #388bfd33; border-color: #58a6ff; }
    .prompt-form {
      display: flex;
      gap: 8px;
      max-width: 680px;
      margin: 0 auto;
      align-items: flex-end;
    }
    .prompt-input {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 10px;
      color: #f0f6fc;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      resize: none;
      height: 38px;
      max-height: 80px;
    }
    .prompt-input:focus { border-color: #58a6ff; }
    .btn-send {
      background: #238636;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #ffffff;
      font-weight: 600;
      padding: 0 14px;
      height: 38px;
      border-radius: 10px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn-send:active { background: #2ea043; }
    .btn-send:disabled { opacity: 0.5; }

    /* Tab 2: Sessions & Workspaces */
    .filter-chips-container {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 4px 0 10px;
      margin-bottom: 6px;
      scrollbar-width: none;
    }
    .filter-chips-container::-webkit-scrollbar { display: none; }
    .f-chip {
      background: #161b22;
      border: 1px solid #30363d;
      color: #8b949e;
      padding: 5px 10px;
      border-radius: 14px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .f-chip.active {
      background: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
    }
    .search-input {
      width: 100%;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 8px 10px;
      color: #f0f6fc;
      font-size: 12px;
      margin-bottom: 10px;
      outline: none;
    }
    .search-input:focus { border-color: #58a6ff; }
    .convo-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-bottom: 20px;
    }
    .convo-card {
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .convo-card:active { background: #21262d; border-color: #58a6ff; }
    .convo-card.active { border-color: #388bfd; background: rgba(56, 139, 253, 0.08); }
    .convo-card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .convo-card-title {
      font-size: 13px;
      font-weight: 600;
      color: #f0f6fc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 250px;
    }
    .convo-card-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #8b949e;
    }

    /* Tab 3: Artifacts */
    .artifact-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .artifact-card {
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .artifact-card:active { background: #21262d; }
    .artifact-name { font-size: 13px; font-weight: 600; color: #f0f6fc; }
    .artifact-sub { font-size: 10px; color: #8b949e; margin-top: 2px; }
    .artifact-view-modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #0d1117;
      z-index: 150;
      display: none;
      flex-direction: column;
    }
    .artifact-view-header {
      background: #161b22;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .artifact-view-body {
      flex: 1;
      padding: 14px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.5;
    }

    /* Tab 4: Presets Grid */
    .presets-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .preset-card {
      background: #161b22;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      cursor: pointer;
      position: relative;
    }
    .preset-card.active {
      border-color: #388bfd;
      background: rgba(56, 139, 253, 0.1);
      box-shadow: 0 0 12px rgba(56, 139, 253, 0.2);
    }
    .preset-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .preset-title {
      font-size: 14px;
      font-weight: 700;
      color: #f0f6fc;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .preset-desc {
      font-size: 11px;
      color: #8b949e;
      line-height: 1.35;
    }
    .btn-preset-act {
      align-self: flex-end;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid #30363d;
      background: #21262d;
      color: #c9d1d9;
      cursor: pointer;
    }
    .btn-preset-act.active {
      background: #238636;
      border-color: #2ea043;
      color: #ffffff;
    }

    /* Tab 5: Quotas & Slots */
    .quota-item { margin-bottom: 10px; }
    .quota-item:last-child { margin-bottom: 0; }
    .quota-header { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
    .quota-label { color: #f0f6fc; font-weight: 500; }
    .quota-val { font-weight: 600; }
    .progress-bar-bg {
      height: 7px;
      background: #21262d;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
    }
    .progress-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
    .quota-time { font-size: 10px; color: #8b949e; margin-top: 2px; text-align: right; }

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
    }
    .slot-btn.active {
      background: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
      box-shadow: 0 0 10px rgba(31, 111, 235, 0.4);
    }
    .acc-actions { display: flex; gap: 8px; }
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
    .btn-acc.on { color: #3fb950; border-color: rgba(63, 185, 80, 0.4); background: rgba(63, 185, 80, 0.12); }

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
    .pin-dots { display: flex; justify-content: center; gap: 12px; margin: 20px 0; }
    .pin-dot {
      width: 14px; height: 14px;
      border-radius: 50%;
      border: 2px solid #58a6ff;
      background: transparent;
      transition: all 0.2s;
    }
    .pin-dot.filled { background: #58a6ff; }
    .pin-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
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
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f6feb;
      color: #fff;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      z-index: 300;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>

  <!-- PIN Entry Modal -->
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

  <!-- Artifact View Modal -->
  <div class="artifact-view-modal" id="artifactModal">
    <div class="artifact-view-header">
      <div style="font-size:13px; font-weight:600; color:#f0f6fc; overflow:hidden; text-overflow:ellipsis; max-width:260px;" id="artifactModalTitle">Артефакт</div>
      <button class="btn-icon" onclick="closeArtifactModal()">← Назад</button>
    </div>
    <div class="artifact-view-body rendered-md" id="artifactModalBody"></div>
  </div>

  <!-- Header -->
  <header>
    <div class="brand">
      <div class="status-dot" id="connDot"></div>
      <span>Antigravity</span>
      <span class="badge" id="headerPresetBadge">🎯 meta-dev</span>
    </div>
    <div class="header-actions">
      <button class="btn-icon" onclick="focusPc()" title="Развернуть окно Antigravity на ПК">💻 ПК</button>
      <button class="btn-icon" onclick="fetchState(true)" title="Синхронизировать">🔄</button>
      <button class="btn-icon" onclick="logout()" title="Выйти">🔒</button>
    </div>
  </header>

  <!-- TAB 1: ЧАТ (CHAT) -->
  <div class="tab-content active" id="tabChat">
    <div class="chat-header-bar">
      <div>
        <div class="chat-info-title" id="chatHeaderTitle">Загрузка диалога...</div>
        <div style="margin-top:2px;">
          <span class="chat-workspace-badge" id="chatHeaderWorkspace">Рабочая папка</span>
        </div>
      </div>
      <button class="btn-icon" onclick="newChatAction()">➕ Новый</button>
    </div>

    <div class="chat-container" id="chatContainer">
      <div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">Загрузка сообщений...</div>
    </div>

    <!-- Sticky Prompt Dock -->
    <div class="dock-bar">
      <div class="chips-row">
        <div class="chip" onclick="insertChip('/plan ')">📋 /plan</div>
        <div class="chip" onclick="insertChip('/compact')">📦 /compact</div>
        <div class="chip" onclick="insertChip('/goal ')">🎯 /goal</div>
        <div class="chip" onclick="insertChip('/agent-preset-conductor')">🤖 conductor</div>
        <div class="chip" onclick="insertChip('Проверь статус и тесты')">🧪 тесты</div>
      </div>
      <div class="prompt-form">
        <textarea class="prompt-input" id="promptInput" rows="1" placeholder="Задача для Antigravity..." onkeydown="handleInputKey(event)"></textarea>
        <button class="btn-send" id="sendBtn" onclick="sendPrompt()">🚀</button>
      </div>
    </div>
  </div>

  <!-- TAB 2: СЕССИИ & ПРОЕКТЫ -->
  <div class="tab-content" id="tabSessions">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <span style="font-size:14px; font-weight:700; color:#f0f6fc;">📁 Проекты & Чаты</span>
      <button class="btn-icon" style="background:#238636; color:#fff; border-color:#2ea043;" onclick="newChatAction()">➕ Новый чат</button>
    </div>

    <input type="text" class="search-input" id="sessionSearch" placeholder="🔍 Поиск по чатам и проектам..." oninput="filterConversations()">

    <div class="filter-chips-container" id="workspaceChips">
      <div class="f-chip active" onclick="selectWorkspaceFilter('ALL')">Все</div>
    </div>

    <div class="convo-list" id="conversationsList">
      <div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">Загрузка списка сессий...</div>
    </div>
  </div>

  <!-- TAB 3: ПЛАНЫ & АРТЕФАКТЫ -->
  <div class="tab-content" id="tabArtifacts">
    <div class="card-title">
      <span>📑 Планы & Артефакты чата</span>
      <button class="btn-icon" onclick="loadArtifacts()">🔄 Обновить</button>
    </div>
    <div class="artifact-list" id="artifactsContainer">
      <div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">Загрузка артефактов...</div>
    </div>
  </div>

  <!-- TAB 4: ПРЕСЕТЫ -->
  <div class="tab-content" id="tabPresets">
    <div class="card-title">
      <span>🎯 14 Сфокусированных Пресетов</span>
      <span id="currentPresetNameBadge" style="color:#58a6ff; font-size:11px;">Активен: ...</span>
    </div>
    <div class="presets-grid" id="presetsGrid">
      <div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">Загрузка пресетов...</div>
    </div>
  </div>

  <!-- TAB 5: КВОТЫ & СЛОТЫ -->
  <div class="tab-content" id="tabControls">
    <!-- Quotas -->
    <div class="card">
      <div class="card-title">
        <span>⏳ Квоты Моделей</span>
        <button class="btn-icon" onclick="refreshQuotas(true)">🔄 Обновить квоты</button>
      </div>
      <div id="quotasContainer">
        <div style="font-size:12px; color:#8b949e; text-align:center; padding:10px;">Загрузка квот...</div>
      </div>
    </div>

    <!-- Accounts -->
    <div class="card">
      <div class="card-title">
        <span>👤 Аккаунты Google</span>
        <span id="failoverBadge" style="font-size:10px; color:#58a6ff;">Авто: ВКЛ</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <span id="activeSlotPill" style="background:#238636; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">Слот 1</span>
        <span id="activeEmailText" style="font-size:12px; color:#f0f6fc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">...</span>
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

    <!-- Telegram Bot & Desktop -->
    <div class="card">
      <div class="card-title">
        <span>🤖 Интеграции & Удаленный ПК</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; background:#21262d; padding:10px; border-radius:8px;">
          <div>
            <div style="font-size:12px; font-weight:600; color:#f0f6fc;">Telegram-бот</div>
            <div style="font-size:10px; color:#8b949e;" id="botStatusSubtext">Статус бота...</div>
          </div>
          <button class="btn-icon" id="botToggleBtn" onclick="toggleBot()">Переключить</button>
        </div>
        <button class="btn-acc" onclick="focusPc()" style="padding:10px;">💻 Развернуть окно на мониторе ПК</button>
      </div>
    </div>
  </div>

  <!-- Bottom Navigation Bar -->
  <nav class="nav-bar">
    <button class="nav-item active" onclick="switchTab('tabChat')">
      <div class="nav-icon">💬</div>
      <div>Чат</div>
    </button>
    <button class="nav-item" onclick="switchTab('tabSessions')">
      <div class="nav-icon">📁</div>
      <div>Сессии</div>
    </button>
    <button class="nav-item" onclick="switchTab('tabArtifacts')">
      <div class="nav-icon">📑</div>
      <div>Планы</div>
    </button>
    <button class="nav-item" onclick="switchTab('tabPresets')">
      <div class="nav-icon">🎯</div>
      <div>Пресеты</div>
    </button>
    <button class="nav-item" onclick="switchTab('tabControls')">
      <div class="nav-icon">⚡</div>
      <div>Квоты</div>
    </button>
  </nav>

  <div class="toast" id="toast">Готово</div>

  <script>
    let currentPin = localStorage.getItem("ag_dashboard_pin") || "";
    let enteredPin = "";
    let isSending = false;
    let activeTabId = "tabChat";
    let activeConversationId = null;

    // Cache signatures to avoid unnecessary DOM thrashing
    let lastChatSig = "";
    let allWorkspaces = [];
    let allConversations = [];
    let selectedWorkspaceFilter = "ALL";

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

    // PIN Authentication
    function updatePinDots() {
      for (let i = 0; i < 4; i++) {
        const d = document.getElementById("dot" + i);
        if (i < enteredPin.length) d.classList.add("filled");
        else d.classList.remove("filled");
      }
    }

    function pressPin(d) {
      if (enteredPin.length < 4) {
        enteredPin += d;
        updatePinDots();
        if (enteredPin.length === 4) verifyPin(enteredPin);
      }
    }
    function clearPin() { enteredPin = ""; updatePinDots(); }
    function backspacePin() { enteredPin = enteredPin.slice(0, -1); updatePinDots(); }

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
          initDashboard();
        } else {
          clearPin();
          showToast("❌ " + (data.error || "Неверный PIN"));
        }
      } catch (e) {
        clearPin();
        showToast("❌ Ошибка соединения");
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

    // Tab Switching
    function switchTab(tabId) {
      activeTabId = tabId;
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
      
      const target = document.getElementById(tabId);
      if (target) target.classList.add("active");

      const navIdx = ["tabChat", "tabSessions", "tabArtifacts", "tabPresets", "tabControls"].indexOf(tabId);
      if (navIdx !== -1) {
        const navBtns = document.querySelectorAll(".nav-item");
        if (navBtns[navIdx]) navBtns[navIdx].classList.add("active");
      }

      if (tabId === "tabSessions") loadConversations();
      if (tabId === "tabArtifacts") loadArtifacts();
      if (tabId === "tabPresets") loadPresets();
    }

    // Markdown Parser
    function escapeHtml(str) {
      return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function renderMarkdown(md) {
      if (!md) return "";
      let s = escapeHtml(md);

      // Code blocks & Inline code
      const B = String.fromCharCode(96);
      const codeBlockRe = new RegExp(B + B + B + "([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)" + B + B + B, "g");
      s = s.replace(codeBlockRe, function(m, lang, code) {
        return '<pre><button class="copy-btn" onclick="copyCode(this)">Скопировать</button><code>' + code.trim() + '</code></pre>';
      });

      // Inline code
      const inlineCodeRe = new RegExp(B + "([^" + B + "]+)" + B, "g");
      s = s.replace(inlineCodeRe, "<code>$1</code>");

      // Headings
      s = s.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      s = s.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      s = s.replace(/^# (.*$)/gim, '<h1>$1</h1>');

      // Bold & Italic
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');

      // Blockquotes
      s = s.replace(/^\> (.*$)/gim, '<blockquote style="border-left:3px solid #388bfd; padding-left:10px; color:#8b949e; margin:6px 0;">$1</blockquote>');

      // Lists
      s = s.replace(/^\s*[-*]\s+(.*$)/gim, '<li style="margin-left:16px;">$1</li>');

      // Line breaks
      s = s.replace(/\n\n/g, '<p></p>');
      s = s.replace(/\n/g, '<br>');

      return s;
    }

    function copyCode(btn) {
      const code = btn.nextElementSibling ? btn.nextElementSibling.textContent : "";
      if (navigator.clipboard && code) {
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "✔ Скопировано";
          setTimeout(() => { btn.textContent = "Скопировать"; }, 2000);
        });
      }
    }

    // TAB 1: Chat Rendering
    function renderChatView(convo) {
      if (!convo) return;
      activeConversationId = convo.cid;

      const titleEl = document.getElementById("chatHeaderTitle");
      titleEl.textContent = convo.title || "Активный Диалог";

      const wsEl = document.getElementById("chatHeaderWorkspace");
      wsEl.textContent = convo.workspace ? "📁 " + convo.workspace : "📁 Без рабочей папки";

      const msgs = convo.messages || [];
      const newSig = convo.cid + "_" + msgs.length + "_" + (msgs[msgs.length - 1]?.text?.slice(0, 30) || "");
      if (newSig === lastChatSig) return; // No DOM refresh needed
      lastChatSig = newSig;

      const container = document.getElementById("chatContainer");
      if (msgs.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:#8b949e; text-align:center; padding:40px;">В этом диалоге пока нет сообщений</div>';
        return;
      }

      let html = "";
      for (const m of msgs) {
        if (m.role === "user") {
          html += '<div class="chat-msg user">' + escapeHtml(m.text) + '<div class="chat-time">' + formatTime(m.time) + '</div></div>';
        } else if (m.role === "tool") {
          html += '<div class="tool-pill"><span>⚡</span> <b>' + escapeHtml(m.name) + '</b> <span class="tool-summary">' + escapeHtml(m.summary) + '</span></div>';
        } else if (m.role === "assistant") {
          let thinkHtml = "";
          if (m.thinking) {
            thinkHtml = '<details class="thinking-box"><summary>💭 Размышления агента</summary><div class="thinking-content">' + escapeHtml(m.thinking) + '</div></details>';
          }
          html += '<div class="chat-msg assistant">' + thinkHtml + '<div class="rendered-md">' + renderMarkdown(m.text) + '</div><div class="chat-time">' + formatTime(m.time) + '</div></div>';
        }
      }

      container.innerHTML = html;
      window.scrollTo(0, document.body.scrollHeight);
    }

    function formatTime(isoStr) {
      if (!isoStr) return "";
      try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (_) { return ""; }
    }

    function insertChip(text) {
      const inp = document.getElementById("promptInput");
      inp.value = text + (text.endsWith(" ") ? "" : " ");
      inp.focus();
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
      sendBtn.textContent = "⏳";

      // Optimistic append
      const container = document.getElementById("chatContainer");
      container.innerHTML += '<div class="chat-msg user">' + escapeHtml(text) + '</div>';
      window.scrollTo(0, document.body.scrollHeight);
      input.value = "";

      try {
        await apiCall("/api/send-prompt", "POST", { prompt: text, conversationId: activeConversationId });
        showToast("Задача передана агенту!");
        setTimeout(() => fetchState(true), 1200);
      } catch (e) {
        showToast("Ошибка: " + e.message);
      } finally {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "🚀";
      }
    }

    // TAB 2: Sessions & Projects
    async function loadConversations() {
      try {
        const data = await apiCall("/api/conversations");
        if (data.ok) {
          allWorkspaces = data.workspaces || [];
          allConversations = data.conversations || [];
          renderWorkspaceChips();
          filterConversations();
        }
      } catch (e) {
        console.warn("Failed to load conversations:", e);
      }
    }

    function renderWorkspaceChips() {
      const cont = document.getElementById("workspaceChips");
      let html = '<div class="f-chip ' + (selectedWorkspaceFilter === "ALL" ? "active" : "") + '" onclick="selectWorkspaceFilter(\\'ALL\\')">Все (' + allConversations.length + ')</div>';
      for (const ws of allWorkspaces) {
        const active = selectedWorkspaceFilter === ws.name ? "active" : "";
        html += '<div class="f-chip ' + active + '" onclick="selectWorkspaceFilter(\\'' + escapeHtml(ws.name) + '\\')">' + escapeHtml(ws.name) + ' (' + ws.count + ')</div>';
      }
      cont.innerHTML = html;
    }

    function selectWorkspaceFilter(wsName) {
      selectedWorkspaceFilter = wsName;
      renderWorkspaceChips();
      filterConversations();
    }

    function filterConversations() {
      const query = (document.getElementById("sessionSearch")?.value || "").toLowerCase().trim();
      const listEl = document.getElementById("conversationsList");
      
      let filtered = allConversations.filter(c => {
        const matchesWs = selectedWorkspaceFilter === "ALL" || (c.workspace_name === selectedWorkspaceFilter);
        const matchesQuery = !query || (c.title || "").toLowerCase().includes(query) || (c.workspace_name || "").toLowerCase().includes(query);
        return matchesWs && matchesQuery;
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">Диалоги не найдены</div>';
        return;
      }

      let html = "";
      for (const c of filtered) {
        const isActive = c.id === activeConversationId ? "active" : "";
        html += \`
          <div class="convo-card \${isActive}" onclick="switchConversationAction('\${c.id}')">
            <div class="convo-card-top">
              <span class="convo-card-title">\${escapeHtml(c.title || "Безымянный диалог")}</span>
              \${isActive ? '<span style="font-size:10px; color:#3fb950; font-weight:700;">● Активен</span>' : ''}
            </div>
            <div class="convo-card-meta">
              <span>📁 \${escapeHtml(c.workspace_name || "Workspace")}</span>
              <span>\${escapeHtml(c.mtime || "")}</span>
            </div>
          </div>
        \`;
      }
      listEl.innerHTML = html;
    }

    async function switchConversationAction(cid) {
      showToast("Переключение диалога...");
      try {
        await apiCall("/api/switch-conversation", "POST", { conversationId: cid });
        activeConversationId = cid;
        lastChatSig = ""; // force re-render
        await fetchState(true);
        switchTab("tabChat");
        showToast("Диалог переключен!");
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    async function newChatAction() {
      if (!confirm("Создать новый чат в Antigravity?")) return;
      showToast("Создание нового чата...");
      try {
        await apiCall("/api/new-conversation", "POST");
        activeConversationId = null;
        lastChatSig = "";
        await fetchState(true);
        switchTab("tabChat");
        showToast("Новый чат готов!");
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    // TAB 3: Artifacts
    async function loadArtifacts() {
      const container = document.getElementById("artifactsContainer");
      container.innerHTML = '<div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">Загрузка артефактов...</div>';
      try {
        const data = await apiCall("/api/artifacts?cid=" + (activeConversationId || ""));
        if (data.ok) {
          const arts = data.artifacts || [];
          if (arts.length === 0) {
            container.innerHTML = '<div style="font-size:12px; color:#8b949e; text-align:center; padding:30px;">В этом диалоге нет артефактов (.md)</div>';
            return;
          }
          let html = "";
          for (const a of arts) {
            const kb = (a.size / 1024).toFixed(1);
            html += \`
              <div class="artifact-card" onclick="openArtifact('\${escapeHtml(a.name)}')">
                <div>
                  <div class="artifact-name">📄 \${escapeHtml(a.title)}</div>
                  <div class="artifact-sub">\${escapeHtml(a.name)} • \${kb} KB</div>
                </div>
                <div style="font-size:12px; color:#58a6ff;">Открыть →</div>
              </div>
            \`;
          }
          container.innerHTML = html;
        }
      } catch (e) {
        container.innerHTML = '<div style="font-size:12px; color:#da3633; text-align:center; padding:20px;">Ошибка: ' + e.message + '</div>';
      }
    }

    async function openArtifact(name) {
      try {
        const data = await apiCall("/api/artifact-content?cid=" + (activeConversationId || "") + "&name=" + encodeURIComponent(name));
        if (data.ok) {
          document.getElementById("artifactModalTitle").textContent = name;
          document.getElementById("artifactModalBody").innerHTML = renderMarkdown(data.content);
          document.getElementById("artifactModal").style.display = "flex";
        }
      } catch (e) {
        showToast("Ошибка открытия: " + e.message);
      }
    }

    function closeArtifactModal() {
      document.getElementById("artifactModal").style.display = "none";
    }

    // TAB 4: Presets Grid
    async function loadPresets() {
      const grid = document.getElementById("presetsGrid");
      try {
        const data = await apiCall("/api/presets");
        if (data.ok) {
          const activePreset = data.activePreset;
          document.getElementById("currentPresetNameBadge").textContent = "Активен: " + activePreset;
          document.getElementById("headerPresetBadge").textContent = "🎯 " + activePreset;

          let html = "";
          for (const p of data.presets) {
            const isActive = p.id === activePreset;
            html += \`
              <div class="preset-card \${isActive ? 'active' : ''}">
                <div class="preset-header">
                  <div class="preset-title"><span>\${p.icon || '🎯'}</span> <span>\${escapeHtml(p.name)}</span></div>
                  <button class="btn-preset-act \${isActive ? 'active' : ''}" onclick="switchPresetAction('\${p.id}')">
                    \${isActive ? '✓ Активен' : 'Включить'}
                  </button>
                </div>
                <div class="preset-desc">\${escapeHtml(p.description || '')}</div>
              </div>
            \`;
          }
          grid.innerHTML = html;
        }
      } catch (e) {
        grid.innerHTML = '<div style="font-size:12px; color:#da3633; text-align:center;">Ошибка: ' + e.message + '</div>';
      }
    }

    async function switchPresetAction(presetId) {
      showToast("Активация пресета " + presetId + "...");
      try {
        await apiCall("/api/switch-preset", "POST", { preset: presetId });
        showToast("🎯 Пресет " + presetId + " активирован!");
        loadPresets();
        fetchState(true);
      } catch (e) {
        showToast("Ошибка: " + e.message);
      }
    }

    // TAB 5: Controls, Quotas & Slots
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
      const sub = document.getElementById("botStatusSubtext");
      const btn = document.getElementById("botToggleBtn");
      if (bot && bot.running) {
        sub.innerHTML = 'Состояние: <b style="color:#3fb950;">ВКЛЮЧЕН (Работает)</b>';
        btn.textContent = "Выключить";
      } else {
        sub.innerHTML = 'Состояние: <b style="color:#8b949e;">ВЫКЛЮЧЕН</b>';
        btn.textContent = "Включить";
      }
    }

    async function switchSlot(slotNum) {
      showToast("Слот " + slotNum + "...");
      try {
        await apiCall("/api/switch-slot", "POST", { slot: slotNum });
        await fetchState(true);
        showToast("Слот " + slotNum + " активен!");
      } catch (e) { showToast("Ошибка: " + e.message); }
    }

    async function cycleSlot() {
      showToast("Ротация аккаунта...");
      try {
        await apiCall("/api/cycle-slot", "POST");
        await fetchState(true);
        showToast("Аккаунт переключен!");
      } catch (e) { showToast("Ошибка: " + e.message); }
    }

    async function toggleFailover() {
      try {
        await apiCall("/api/toggle-autofailover", "POST");
        await fetchState(true);
      } catch (e) { showToast("Ошибка: " + e.message); }
    }

    async function toggleBot() {
      showToast("Переключение бота...");
      try {
        await apiCall("/api/toggle-bot", "POST");
        await fetchState(true);
      } catch (e) { showToast("Ошибка: " + e.message); }
    }

    async function refreshQuotas(manual = false) {
      if (manual) showToast("Запрос квот из Language Server...");
      try {
        const res = await apiCall("/api/refresh-quotas", "POST");
        if (res.ok) {
          renderQuotas(res.quotas);
          if (manual) showToast("Квоты обновлены!");
        }
      } catch (e) {
        if (manual) showToast("Ошибка обновления квот: " + e.message);
      }
    }

    async function focusPc() {
      try {
        await apiCall("/api/focus-pc", "POST");
        showToast("Окно Antigravity развернуто на ПК!");
      } catch (e) { showToast("Ошибка: " + e.message); }
    }

    // Central Polling & State Sync
    async function fetchState(manual = false) {
      if (!currentPin) return;
      try {
        const data = await apiCall("/api/state" + (manual ? "?force=1" : ""));
        if (data.ok) {
          document.getElementById("connDot").classList.remove("offline");
          if (data.activePreset) {
            document.getElementById("headerPresetBadge").textContent = "🎯 " + data.activePreset;
          }
          renderChatView(data.convo);
          renderAccounts(data.status);
          renderBot(data.bot);
          if (data.quotas) renderQuotas(data.quotas);
          if (manual) showToast("Синхронизировано!");
        }
      } catch (e) {
        document.getElementById("connDot").classList.add("offline");
      }
    }

    function initDashboard() {
      fetchState(true);
      setInterval(() => fetchState(false), 2500);
    }

    if (currentPin) {
      initDashboard();
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
    getConversationHistory,
    getConversationsList,
    getArtifactsList,
    getArtifactContent
};
