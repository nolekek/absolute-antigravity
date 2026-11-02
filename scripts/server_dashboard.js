#!/usr/bin/env node
/**
 * ==============================================================================
 * Absolute Antigravity: Standalone Modern AI Web Studio & Dashboard Server (v4.0)
 * ==============================================================================
 *
 * High-performance, zero-external-dependency remote management dashboard & IDE backend
 * for Google Antigravity & agy core. Designed for local, LAN, and remote server access.
 *
 * Core Capabilities:
 *   1. Pure Node.js RFC 6455 WebSocket Interactive Terminal (PTY / interactive shell)
 *   2. Native Antigravity Cascade Agent Streaming API (Connects to Language Server directly)
 *   3. Workspace File Explorer & Safe Sandboxed Editor (Tree, Read, Write, Git Diff)
 *   4. Presets & Skills Management (16 presets, overlays, dynamic switching)
 *   5. Multi-Account Carousel & Slots (status, rotation, auto-failover)
 *   6. Session Logs & Brain Artifacts Explorer
 *   7. Web Studio UI (serves web/dist/index.html or built-in stylish Dark Studio SPA)
 *
 * Security:
 *   - 6-digit cryptographic PIN stored in .agy/web_pin and ~/.gemini/antigravity/web_pin
 *   - Session cookie / token generation upon successful PIN verification
 *   - Brute-force defense: 5 failed PIN attempts -> 15-minute IP lock
 *   - Localhost bypass allowed with PIN query parameter
 *   - ZERO external npm dependencies (100% built-in Node.js modules)
 *
 * Usage:
 *   node scripts/server_dashboard.js [--host 0.0.0.0] [--port 51125] [--pin 123456] [--workspace /path]
 */

"use strict";

const http = require("http");
const url = require("url");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { spawn, exec, execFileSync } = require("child_process");

// -----------------------------------------------------------------------------
// Constants & Paths
// -----------------------------------------------------------------------------
const VERSION = "4.0.0";
const USER_HOME = os.homedir() || process.env.USERPROFILE || process.env.HOME || "";
const GEMINI_DIR = path.join(USER_HOME, ".gemini");
const ANTIGRAVITY_DIR = path.join(GEMINI_DIR, "antigravity");
const BRAIN_DIR = path.join(ANTIGRAVITY_DIR, "brain");
const CONFIG_VAULT_PATH = path.join(GEMINI_DIR, "credentials_vault.json");
const MULTIACC_CONFIG_PATH = path.join(GEMINI_DIR, "antigravity_multiacc.json");
const SERVER_CONFIG_PATH = path.join(GEMINI_DIR, "antigravity_server_config.json");
const WEB_CONFIG_PATH = path.join(GEMINI_DIR, "antigravity_web_config.json");

// Excluded directories for File Explorer
const EXCLUDE_DIRS = new Set([
    "node_modules", ".git", "target", "dist", ".gemini", ".cargo",
    "__pycache__", ".vscode", ".idea", "build", "obj", ".next", ".turbo"
]);

// -----------------------------------------------------------------------------
// Activity Log Buffer (In-Memory Ring Buffer for Dashboard Activity)
// -----------------------------------------------------------------------------
const ACTIVITY_LOGS = [];
const MAX_ACTIVITY_LOGS = 500;

function logActivity(level, category, message, meta = null) {
    const entry = {
        time: new Date().toISOString(),
        level: level.toUpperCase(),
        category,
        message,
        meta
    };
    ACTIVITY_LOGS.push(entry);
    if (ACTIVITY_LOGS.length > MAX_ACTIVITY_LOGS) {
        ACTIVITY_LOGS.shift();
    }
    const color = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    console.log(`${color}[${entry.time}] [${entry.level}] [${category}]${reset} ${message}`);
}

// -----------------------------------------------------------------------------
// Brute-Force Rate Limiting (5 failed attempts -> 15 min lock)
// -----------------------------------------------------------------------------
const authRateLimitMap = new Map();
const MAX_AUTH_FAILURES = 5;
const AUTH_BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (xff && typeof xff === "string") {
        return xff.split(",")[0].trim();
    }
    const rip = req.headers["x-real-ip"];
    if (rip && typeof rip === "string") {
        return rip.trim();
    }
    return req.socket?.remoteAddress || "127.0.0.1";
}

function checkRateLimit(ip) {
    const now = Date.now();
    const record = authRateLimitMap.get(ip);
    if (record && record.blockedUntil && record.blockedUntil > now) {
        const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
        return { blocked: true, retryAfter };
    }
    return { blocked: false };
}

function recordAuthFailure(ip) {
    const now = Date.now();
    let record = authRateLimitMap.get(ip);
    if (!record || (record.blockedUntil && record.blockedUntil <= now)) {
        record = { count: 0, blockedUntil: 0 };
    }
    record.count += 1;
    if (record.count >= MAX_AUTH_FAILURES) {
        record.blockedUntil = now + AUTH_BLOCK_DURATION_MS;
        authRateLimitMap.set(ip, record);
        logActivity("warn", "Security", `IP ${ip} locked out for 15 min after ${MAX_AUTH_FAILURES} failed attempts`);
        return { blocked: true, retryAfter: Math.ceil(AUTH_BLOCK_DURATION_MS / 1000) };
    }
    authRateLimitMap.set(ip, record);
    return { blocked: false, remaining: MAX_AUTH_FAILURES - record.count };
}

function recordAuthSuccess(ip) {
    authRateLimitMap.delete(ip);
}

// -----------------------------------------------------------------------------
// Cryptographic PIN Helpers
// -----------------------------------------------------------------------------
function generateSecurePin() {
    return String(crypto.randomInt(100000, 1000000));
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
        const idx = pair.indexOf("=");
        if (idx !== -1) {
            const key = pair.slice(0, idx).trim();
            const val = pair.slice(idx + 1).trim();
            cookies[key] = decodeURIComponent(val);
        }
    }
    return cookies;
}

function getLanIps() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                ips.push({ name, address: net.address });
            }
        }
    }
    return ips;
}

function getPrimaryLanIp() {
    const candidates = getLanIps();
    const wifiOr192 = candidates.find(c => c.address.startsWith("192.168."));
    if (wifiOr192) return wifiOr192.address;
    const ten = candidates.find(c => c.address.startsWith("10."));
    if (ten) return ten.address;
    const oneSeven = candidates.find(c => c.address.startsWith("172."));
    if (oneSeven) return oneSeven.address;
    return candidates[0]?.address || "127.0.0.1";
}

// -----------------------------------------------------------------------------
// Pure Node.js RFC 6455 WebSocket Implementation (Zero external npm dependencies)
// -----------------------------------------------------------------------------
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class RawWebSocket extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.isClosed = false;
        this.buffer = Buffer.alloc(0);

        socket.on("data", (chunk) => this._onData(chunk));
        socket.on("close", () => this._onClose(1006, "Abnormal socket closure"));
        socket.on("error", (err) => this.emit("error", err));
    }

    send(data) {
        if (this.isClosed || !this.socket.writable) return;
        const isBinary = Buffer.isBuffer(data) || data instanceof Uint8Array;
        const payload = isBinary ? Buffer.from(data) : Buffer.from(String(data), "utf-8");
        const opcode = isBinary ? 0x02 : 0x01;
        const frame = RawWebSocket.createFrame(opcode, payload);
        this.socket.write(frame);
    }

    ping() {
        if (this.isClosed || !this.socket.writable) return;
        const frame = RawWebSocket.createFrame(0x09, Buffer.alloc(0));
        this.socket.write(frame);
    }

    close(code = 1000, reason = "") {
        if (this.isClosed) return;
        this.isClosed = true;
        try {
            const reasonBuf = Buffer.from(reason, "utf-8");
            const payload = Buffer.alloc(2 + reasonBuf.length);
            payload.writeUInt16BE(code, 0);
            reasonBuf.copy(payload, 2);
            const frame = RawWebSocket.createFrame(0x08, payload);
            this.socket.write(frame, () => {
                this.socket.end();
            });
        } catch (_) {
            this.socket.destroy();
        }
    }

    static createFrame(opcode, payload) {
        const len = payload.length;
        let header;
        // Server-to-client frames MUST NOT be masked per RFC 6455 Section 5.1
        if (len <= 125) {
            header = Buffer.alloc(2);
            header[0] = 0x80 | (opcode & 0x0f);
            header[1] = len;
        } else if (len <= 65535) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | (opcode & 0x0f);
            header[1] = 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | (opcode & 0x0f);
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        return Buffer.concat([header, payload]);
    }

    _onClose(code, reason) {
        if (this.isClosed) return;
        this.isClosed = true;
        this.emit("close", code, reason);
    }

    _onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        while (this.buffer.length >= 2) {
            const b0 = this.buffer[0];
            const b1 = this.buffer[1];
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let payloadLen = b1 & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
                if (this.buffer.length < 4) return;
                payloadLen = this.buffer.readUInt16BE(2);
                offset = 4;
            } else if (payloadLen === 127) {
                if (this.buffer.length < 10) return;
                payloadLen = Number(this.buffer.readBigUInt64BE(2));
                offset = 10;
            }

            let maskKey = null;
            if (masked) {
                if (this.buffer.length < offset + 4) return;
                maskKey = this.buffer.slice(offset, offset + 4);
                offset += 4;
            }

            if (this.buffer.length < offset + payloadLen) return;

            let payload = this.buffer.slice(offset, offset + payloadLen);
            this.buffer = this.buffer.slice(offset + payloadLen);

            if (masked && maskKey) {
                const unmasked = Buffer.alloc(payloadLen);
                for (let i = 0; i < payloadLen; i++) {
                    unmasked[i] = payload[i] ^ maskKey[i % 4];
                }
                payload = unmasked;
            }

            if (opcode === 0x08) { // Close
                let code = 1000;
                let reason = "";
                if (payload.length >= 2) {
                    code = payload.readUInt16BE(0);
                    reason = payload.slice(2).toString("utf-8");
                }
                this.close(code, reason);
                this._onClose(code, reason);
                return;
            } else if (opcode === 0x09) { // Ping
                const pong = RawWebSocket.createFrame(0x0a, payload);
                this.socket.write(pong);
            } else if (opcode === 0x0a) { // Pong
                // keepalive heartbeat
            } else if (opcode === 0x01) { // Text
                this.emit("message", payload.toString("utf-8"), false);
            } else if (opcode === 0x02) { // Binary
                this.emit("message", payload, true);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Native Antigravity Cascade Agent & Language Server Integration
// -----------------------------------------------------------------------------
function mapToAntigravityModel(model) {
    if (!model) return "MODEL_PLACEHOLDER_M318";
    const lower = String(model).toLowerCase().trim().replace(/^models\//, "");

    switch (lower) {
        case "gemini-3.8-flash-high":
        case "flash":
        case "fast":
        case "3.8":
        case "flash-high":
            return "MODEL_PLACEHOLDER_M318";
        case "gemini-2.5-pro":
        case "pro":
        case "deep":
        case "2.5-pro":
            return "MODEL_GOOGLE_GEMINI_2_5_PRO";
        case "claude-sonnet-4-6":
        case "sonnet":
        case "claude-sonnet":
            return "MODEL_PLACEHOLDER_M35";
        case "claude-opus-4-6-thinking":
        case "opus":
        case "claude-opus":
            return "MODEL_PLACEHOLDER_M26";
        case "gemini-2.5-flash":
        case "flash-lite":
        case "lite":
            return "MODEL_GOOGLE_GEMINI_2_5_FLASH";
        case "gemini-3.8-flash-medium":
            return "MODEL_PLACEHOLDER_M319";
        case "gemini-3.8-flash-low":
            return "MODEL_PLACEHOLDER_M320";
        default:
            if (lower.startsWith("model_")) {
                return lower.toUpperCase();
            }
            return "MODEL_PLACEHOLDER_M318";
    }
}

function getLanguageServerSession() {
    // 1. Env vars
    const envPort = parseInt(process.env.AGY_LS_PORT || process.env.JETSKI_LS_PORT, 10);
    const envCsrf = process.env.AGY_LS_CSRF;
    if (envPort > 0 && envCsrf) {
        return { port: envPort, csrf: envCsrf, pid: null, source: "env" };
    }

    // 2. active_session.json in ~/.gemini/antigravity or AppData
    const candidates = [
        path.join(USER_HOME, ".gemini", "antigravity", "active_session.json"),
        path.join(USER_HOME, "AppData", "Roaming", "Antigravity", "active_session.json"),
        path.join(USER_HOME, ".gemini", "active_session.json")
    ];
    for (const sessionFile of candidates) {
        if (fs.existsSync(sessionFile)) {
            try {
                const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
                if (session && session.port > 0 && session.csrf) {
                    return {
                        port: session.port,
                        csrf: session.csrf,
                        pid: session.pid || null,
                        source: "active_session.json"
                    };
                }
            } catch (_) {}
        }
    }

    // 3. Process detection & Log inspection (Windows)
    if (process.platform === "win32") {
        try {
            const cmd = 'Get-CimInstance Win32_Process -Filter "Name like \'language_server%\'" | Select-Object -ExpandProperty CommandLine';
            const out = execFileSync("powershell", ["-NoProfile", "-Command", cmd], {
                encoding: "utf-8",
                timeout: 3000,
                windowsHide: true
            });
            const csrfMatch = out.match(/--csrf_token\s+([a-f0-9\-]+)/i);
            if (csrfMatch) {
                const csrf = csrfMatch[1];
                const logCandidates = [
                    path.join(USER_HOME, "AppData", "Roaming", "Antigravity", "logs", "language_server.log"),
                    path.join(USER_HOME, ".gemini", "antigravity", "language_server.log"),
                    path.join(USER_HOME, ".gemini", "language_server.log")
                ];
                for (const logPath of logCandidates) {
                    if (fs.existsSync(logPath)) {
                        const content = fs.readFileSync(logPath, "utf-8");
                        const portMatches = content.match(/listening on (?:\w+ )?port at (\d+) for HTTP\b/gi);
                        if (portMatches && portMatches.length > 0) {
                            const lastMatch = portMatches[portMatches.length - 1];
                            const num = lastMatch.match(/(\d+)/);
                            if (num) {
                                return {
                                    port: parseInt(num[1], 10),
                                    csrf,
                                    pid: null,
                                    source: "process_log"
                                };
                            }
                        }
                    }
                }
            }
        } catch (_) {}
    }

    return null;
}

function lsRpcRequest(port, csrf, serviceMethod, payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: `/exa.language_server_pb.LanguageServerService/${serviceMethod}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "x-codeium-csrf-token": csrf
            },
            timeout: 10000
        }, (res) => {
            let data = "";
            res.on("data", c => { data += c; });
            res.on("end", () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`Language Server RPC ${serviceMethod} returned HTTP ${res.statusCode}: ${data}`));
                }
                try {
                    const parsed = JSON.parse(data || "{}");
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Failed to parse RPC response: ${e.message} (raw: ${data})`));
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`Language Server RPC ${serviceMethod} timed out`));
        });
        req.write(body);
        req.end();
    });
}

// -----------------------------------------------------------------------------
// Workspace File Explorer & Sandboxing API
// -----------------------------------------------------------------------------
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".cjs": "application/javascript",
        ".ts": "text/typescript",
        ".tsx": "text/typescript",
        ".jsx": "text/javascript",
        ".json": "application/json",
        ".html": "text/html",
        ".htm": "text/html",
        ".css": "text/css",
        ".md": "text/markdown",
        ".py": "text/x-python",
        ".rs": "text/x-rust",
        ".yaml": "text/yaml",
        ".yml": "text/yaml",
        ".sh": "application/x-sh",
        ".bash": "application/x-sh",
        ".ps1": "text/plain",
        ".txt": "text/plain",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".ico": "image/x-icon"
    };
    return map[ext] || "text/plain";
}

function scanFsTree(baseDir, currentRel = "", depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return [];
    const fullDir = path.resolve(baseDir, currentRel);
    if (!fs.existsSync(fullDir)) return [];

    let entries;
    try {
        entries = fs.readdirSync(fullDir, { withFileTypes: true });
    } catch (_) {
        return [];
    }

    const result = [];
    for (const ent of entries) {
        if (EXCLUDE_DIRS.has(ent.name)) continue;
        const relPath = currentRel ? path.join(currentRel, ent.name) : ent.name;
        const normalizedRel = relPath.replace(/\\/g, "/");

        if (ent.isDirectory()) {
            const children = scanFsTree(baseDir, relPath, depth + 1, maxDepth);
            result.push({
                name: ent.name,
                path: normalizedRel,
                isDir: true,
                size: 0,
                ext: "",
                children
            });
        } else if (ent.isFile()) {
            let size = 0;
            try {
                const st = fs.statSync(path.join(fullDir, ent.name));
                size = st.size;
            } catch (_) {}
            result.push({
                name: ent.name,
                path: normalizedRel,
                isDir: false,
                size,
                ext: path.extname(ent.name).toLowerCase()
            });
        }
    }

    // Sort: directories first, then alphabetical
    result.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return result;
}

// -----------------------------------------------------------------------------
// Presets Manager & Skill Definitions (16 Presets Invariant)
// -----------------------------------------------------------------------------
const FALLBACK_PRESETS = {
    "web": {
        id: "web",
        name: "Web Modern",
        icon: "🌐",
        description: "Next.js 15, React, Tailwind v4, Vue 3, TanStack Query, Web Vitals, SEO & CRO",
        skills: [
            "ui-ux-pro-max", "frontend-design", "react-best-practices", "nextjs-fullstack-guru",
            "tailwind-v4-master", "react-performance-opt", "vue-nuxt-expert", "web-state-query-master",
            "web-performance-auditor", "seo-audit", "form-cro", "figcraft-design", "vectorcraft-artwork", "ai-product-partner"
        ]
    },
    "backend": {
        id: "backend",
        name: "Backend & DB",
        icon: "⚙️",
        description: "PostgreSQL DBA, Database design, API design, Node.js, FastAPI, Go, Rust, Redis, Kafka",
        skills: [
            "postgres-dba-optimizer", "database-design", "api-design-principles", "fastapi-async-architect",
            "nodejs-best-practices", "go-concurrency-patterns", "go-highload-services", "rust-systems-safe",
            "redis-distributed-caching", "kafka-event-streaming", "memory-safety-patterns", "ai-product-partner"
        ]
    },
    "devops": {
        id: "devops",
        name: "DevOps & Cloud",
        icon: "🐳",
        description: "Docker multi-stage, Kubernetes, GitHub Actions, Terraform IaC, AWS Serverless, SRE, Observability",
        skills: [
            "docker-container-master", "k8s-manifest-generator", "github-actions-ci-cd", "terraform-iac-architect",
            "aws-serverless", "incident-responder", "deployment-procedures", "observability-telemetry-guru", "ai-product-partner"
        ]
    },
    "appsec": {
        id: "appsec",
        name: "AppSec & Reversing",
        icon: "🛡️",
        description: "OWASP Top-10, API security, Ethical hacking, Electron ASAR, Win32/PS & Desktop UI, Network intercept",
        skills: [
            "top-web-vulnerabilities", "api-security-best-practices", "ethical-hacking-methodology",
            "appsec-code-auditor", "api-pentest-fuzzer", "network-traffic-intercept", "craft-anything",
            "reverse-engineer-electron", "win32-powershell-automation", "windows-desktop-control", "premortem-redteam"
        ]
    },
    "qa": {
        id: "qa",
        name: "QA & Testing",
        icon: "🧪",
        description: "Playwright E2E & Desktop UI (Windows-MCP), TDD, Test fixing, Code review audit, k6 load testing, API contracts",
        skills: [
            "test-driven-development", "test-fixing", "code-review-checklist", "playwright-e2e-guru",
            "windows-desktop-control", "unit-test-synthesizer", "k6-load-testing-pro", "api-contract-tester", "ai-product-partner"
        ]
    },
    "ai-agents": {
        id: "ai-agents",
        name: "AI & MCP Engineering",
        icon: "🤖",
        description: "MCP серверы, RAG, Prompt Engineering, архитектура агентов и управление контекстом",
        skills: [
            "mcp-builder", "prompt-engineering", "rag-implementation", "context-window-management",
            "ai-agents-architect", "agent-evaluation", "langgraph", "browser", "fl-freelance-agent", "ai-product-partner"
        ]
    },
    "web-research": {
        id: "web-research",
        name: "Web Research & OSINT",
        icon: "🔍",
        description: "Глубокий поиск, извлечение контента, веб-скрапинг, OSINT и аналитика",
        skills: ["search-specialist", "deep-research-synthesizer", "web-scraper-harvester", "osint-recon-investigator", "ai-product-partner"]
    },
    "reverse-engineering": {
        id: "reverse-engineering",
        name: "Reverse Engineering & Replica",
        icon: "🧬",
        description: "Полный Clean-Room цикл (11 скиллов Replica) + Electron ASAR реверс-инжиниринг",
        skills: [
            "craft-anything", "replica-recon", "replica-architect", "replica-backend", "replica-brand",
            "replica-build", "replica-deploy", "replica-design", "replica-diff",
            "replica-entrepreneur", "replica-launch", "replica-test", "reverse-engineer-electron", "ai-product-partner"
        ]
    },
    "product": {
        id: "product",
        name: "Product & Monetization",
        icon: "💎",
        description: "Стратегия монетизации, юнит-экономика, офферы, карточки товаров, анализ рынка, ценообразование и CRO",
        skills: [
            "product-monetization-strategy", "market-competitor-intelligence", "ai-product-partner", "browser",
            "search-specialist", "deep-research-synthesizer", "replica-entrepreneur", "replica-brand", "replica-launch",
            "form-cro", "ui-ux-pro-max", "seo-audit"
        ]
    },
    "orchestrator": {
        id: "orchestrator",
        name: "Orchestrator & Multi-Agent",
        icon: "🎭",
        description: "Мультиагентная оркестрация, декомпозиция крупных проектов, параллельные субагенты с фиксированными пресетами, арбитраж и верификация",
        skills: [
            "subagent-orchestrator", "hierarchical-task-decomposer", "multi-agent-debate-consensus",
            "context-synthesis-reducer", "ai-agents-architect", "prompt-engineering", "context-window-management",
            "agent-evaluation", "langgraph", "artcraft-orchestrator", "craft-anything", "figcraft-design",
            "code-review-checklist", "premortem-redteam", "ai-product-partner"
        ]
    },
    "systems": {
        id: "systems",
        name: "Systems & High-Perf",
        icon: "⚡",
        description: "Modern C++20/C++23, C, Zig, Rust, RAII, ручное управление памятью, lock-free, SIMD, санитайзеры ASan/TSan, CMake и профилирование",
        skills: [
            "cpp-systems-architect", "systems-lowlevel-perf", "lockfree-concurrency-patterns", "rust-systems-safe",
            "memory-safety-patterns", "test-driven-development", "test-fixing", "code-review-checklist"
        ]
    },
    "vst3": {
        id: "vst3",
        name: "VST3 & Audio DSP Studio",
        icon: "🎛️",
        description: "Разработка VST3/VST3i плагинов, синтезаторов и DSP эффектов: JUCE C++, real-time audio thread safety, SIMD, аудио UI/UX дизайн и мультиагентная оркестрация",
        skills: [
            "vst3-dsp-architect", "audio-plugin-ui-ux", "figcraft-design", "vectorcraft-artwork", "cpp-systems-architect",
            "systems-lowlevel-perf", "lockfree-concurrency-patterns", "subagent-orchestrator", "hierarchical-task-decomposer",
            "test-driven-development", "test-fixing", "code-review-checklist"
        ]
    },
    "hardware": {
        id: "hardware",
        name: "Hardware & CAD/CAM Studio",
        icon: "📐",
        description: "Параметрическое 3D твердотельное моделирование (SolidCraft), 2D/3D черчение DWG/DXF (CADCraft), 3D PBR текстурирование (TextureCraft), экспорт STEP/STL",
        skills: [
            "solidcraft-modeling", "cadcraft-drafting", "texturecraft-surfacing", "artcraft-orchestrator",
            "ai-product-partner", "hierarchical-task-decomposer"
        ]
    },
    "media": {
        id: "media",
        name: "Media & Visual Arts Studio",
        icon: "🎨",
        description: "Нелинейный видеомонтаж (FilmCraft), моушн-дизайн и визуальные эффекты (EffectCraft), проявка RAW и HDR (LightCraft), растр PSD (PhotoCraft), вектор SVG (VectorCraft), дизайн-системы (FigCraft)",
        skills: [
            "filmcraft-editing", "effectcraft-motion", "lightcraft-color", "photocraft-imaging", "vectorcraft-artwork",
            "figcraft-design", "artcraft-orchestrator", "ui-ux-pro-max", "ai-product-partner"
        ]
    },
    "meta-dev": {
        id: "meta-dev",
        name: "Antigravity Meta-Dev",
        icon: "🛠️",
        description: "Разработка ядра Antigravity: Electron ASAR сборка/распаковка, синхронизация скиллов, тесты Multi-Account, инсталлятор и Win32 автоматизация",
        skills: [
            "reverse-engineer-electron", "appsec-code-auditor", "win32-powershell-automation", "test-driven-development",
            "test-fixing", "code-review-checklist", "github-actions-ci-cd", "docker-container-master", "mcp-builder",
            "windows-desktop-control", "ai-product-partner"
        ]
    },
    "minimal": {
        id: "minimal",
        name: "Minimal Zero-Prompt",
        icon: "⚡",
        description: "Минимум токенов в системном промпте",
        skills: []
    }
};

function getAllPresets() {
    try {
        const smPath = path.join(__dirname, "..", "skillManager.js");
        if (fs.existsSync(smPath)) {
            const { PRESETS } = require(smPath);
            if (PRESETS && Object.keys(PRESETS).length > 0) {
                return PRESETS;
            }
        }
    } catch (_) {}
    return FALLBACK_PRESETS;
}

function getActivePreset(targetWorkspace = null) {
    if (targetWorkspace) {
        const agyCfg = path.join(targetWorkspace, ".agy", "config.json");
        if (fs.existsSync(agyCfg)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(agyCfg, "utf-8"));
                if (parsed.preset) return parsed.preset;
            } catch (_) {}
        }
    }
    const ccPath = path.join(ANTIGRAVITY_DIR, "control-center-config.json");
    if (fs.existsSync(ccPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(ccPath, "utf-8"));
            if (parsed.activePreset) return parsed.activePreset;
        } catch (_) {}
    }
    return "orchestrator";
}

function getAgyCliPath() {
    const candidates = [
        path.join(ANTIGRAVITY_DIR, "bin", process.platform === "win32" ? "agy.exe" : "agy"),
        path.join(__dirname, "..", "agy", "target", "release", process.platform === "win32" ? "agy.exe" : "agy"),
        path.join(__dirname, "..", "binaries", process.platform === "win32" ? "windows-x64/agy.exe" : "linux-x64/agy"),
        "/usr/local/bin/agy",
        "/opt/gemini/bin/agy"
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    try {
        const whichCmd = process.platform === "win32" ? "where.exe" : "which";
        const res = execFileSync(whichCmd, ["agy"], { encoding: "utf-8", timeout: 1000, windowsHide: true });
        const firstLine = res.split(/\r?\n/)[0].trim();
        if (firstLine && fs.existsSync(firstLine)) return firstLine;
    } catch (_) {}
    return null;
}

function applyPreset(presetName, overlays = [], targetWorkspace = null) {
    const ws = targetWorkspace ? path.resolve(targetWorkspace) : process.cwd();

    // 1. Try agy CLI
    const agyBin = getAgyCliPath();
    if (agyBin) {
        try {
            const args = ["preset", "switch", presetName];
            if (Array.isArray(overlays)) {
                args.push(...overlays.filter(Boolean));
            } else if (typeof overlays === "string" && overlays.trim()) {
                args.push(...overlays.trim().split(/\s+/));
            }
            if (targetWorkspace) {
                args.push("-w", ws);
            }
            const out = execFileSync(agyBin, args, {
                encoding: "utf-8",
                timeout: 5000,
                windowsHide: true,
                cwd: ws
            });
            return { ok: true, method: "agy-cli", output: out.trim() };
        } catch (err) {
            logActivity("warn", "Preset", `agy CLI switch failed: ${err.message}, fallback to internal`);
        }
    }

    // 2. Try skillManager.js
    try {
        const smPath = path.join(__dirname, "..", "skillManager.js");
        if (fs.existsSync(smPath)) {
            const { skillManager } = require(smPath);
            const res = skillManager.applyPresetByName(presetName, ws);
            return { ok: res.success, method: "skillManager", result: res };
        }
    } catch (_) {}

    // 3. Direct config update
    try {
        const agyDir = path.join(ws, ".agy");
        fs.mkdirSync(agyDir, { recursive: true });
        const cfgFile = path.join(agyDir, "config.json");
        let cfg = {};
        if (fs.existsSync(cfgFile)) {
            try { cfg = JSON.parse(fs.readFileSync(cfgFile, "utf-8")); } catch (_) {}
        }
        cfg.preset = presetName;
        cfg.overlays = Array.isArray(overlays) ? overlays : [];
        cfg.updated_at = new Date().toISOString();
        fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), "utf-8");
        return { ok: true, method: "direct-config", preset: presetName };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// -----------------------------------------------------------------------------
// Account Slots & Credentials Resolver
// -----------------------------------------------------------------------------
function getPythonPath() {
    const cmds = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
    for (const cmd of cmds) {
        try {
            execFileSync(cmd, ["--version"], { stdio: "ignore", windowsHide: true });
            return cmd;
        } catch (_) {}
    }
    return "python";
}

function getCredHelperPath() {
    const candidates = [
        path.join(__dirname, "credHelper.py"),
        path.join(__dirname, "..", "credHelper.py"),
        path.join(ANTIGRAVITY_DIR, "credHelper.py")
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return null;
}

function getAccountSlotsStatus() {
    const pythonCmd = getPythonPath();
    const helperPath = getCredHelperPath();
    if (helperPath) {
        try {
            const out = execFileSync(pythonCmd, [helperPath, "status"], {
                encoding: "utf-8",
                timeout: 4000,
                windowsHide: true
            });
            const data = JSON.parse(out);
            return {
                ok: true,
                activeSlot: data.activeSlot || 1,
                currentEmail: data.currentEmail || data.primaryEmail || "Default Account",
                accounts: data.accounts || [],
                slotsCount: data.slotsCount || 1,
                maxSlots: data.maxSlots || 4,
                autoFailover: data.autoFailover !== false
            };
        } catch (e) {
            logActivity("warn", "Accounts", `credHelper status failed: ${e.message}`);
        }
    }

    if (fs.existsSync(CONFIG_VAULT_PATH)) {
        try {
            const vault = JSON.parse(fs.readFileSync(CONFIG_VAULT_PATH, "utf-8"));
            const accounts = [];
            for (let i = 1; i <= 4; i++) {
                const targetKey = `gemini:antigravity_slot_${i}`;
                if (vault[targetKey]) {
                    accounts.push({ slot: i, email: `Account ${i}` });
                }
            }
            if (accounts.length > 0) {
                return {
                    ok: true,
                    activeSlot: 1,
                    currentEmail: accounts[0].email,
                    accounts,
                    slotsCount: accounts.length,
                    maxSlots: 4,
                    autoFailover: true
                };
            }
        } catch (_) {}
    }

    return {
        ok: true,
        activeSlot: 1,
        currentEmail: "Default Developer",
        accounts: [{ slot: 1, email: "developer@server.local" }],
        slotsCount: 1,
        maxSlots: 4,
        autoFailover: true
    };
}

function rotateAccountSlot(targetSlot = null) {
    const agyBin = getAgyCliPath();
    if (agyBin) {
        try {
            const args = ["account", "rotate"];
            if (targetSlot) args.push(String(targetSlot));
            const out = execFileSync(agyBin, args, { encoding: "utf-8", timeout: 4000, windowsHide: true });
            return { ok: true, method: "agy-cli", output: out.trim() };
        } catch (err) {
            logActivity("warn", "Accounts", `agy CLI rotate failed: ${err.message}`);
        }
    }

    const pythonCmd = getPythonPath();
    const helperPath = getCredHelperPath();
    if (helperPath) {
        try {
            const args = [helperPath, "switch"];
            if (targetSlot) args.push(String(targetSlot));
            const out = execFileSync(pythonCmd, args, { encoding: "utf-8", timeout: 4000, windowsHide: true });
            return { ok: true, method: "credHelper", data: JSON.parse(out) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    return { ok: false, error: "No account manager available" };
}

function toggleAutoFailover(val = null) {
    const pythonCmd = getPythonPath();
    const helperPath = getCredHelperPath();
    if (helperPath) {
        try {
            const args = [helperPath, "toggle-autofailover"];
            if (val !== null) args.push(val ? "true" : "false");
            const out = execFileSync(pythonCmd, args, { encoding: "utf-8", timeout: 4000, windowsHide: true });
            return { ok: true, data: JSON.parse(out) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: false, error: "credHelper not available" };
}

// -----------------------------------------------------------------------------
// Workspaces & Project Init
// -----------------------------------------------------------------------------
function getRecentWorkspaces(currentWs) {
    const wsMap = new Map();
    if (currentWs && fs.existsSync(currentWs)) {
        wsMap.set(path.resolve(currentWs), {
            path: path.resolve(currentWs),
            name: path.basename(currentWs) || currentWs,
            isCurrent: true
        });
    }

    const prjPath = path.join(GEMINI_DIR, "projects.json");
    if (fs.existsSync(prjPath)) {
        try {
            const prj = JSON.parse(fs.readFileSync(prjPath, "utf-8"));
            for (const p of Object.keys(prj.projects || {})) {
                if (fs.existsSync(p)) {
                    const norm = path.resolve(p);
                    if (!wsMap.has(norm)) {
                        wsMap.set(norm, {
                            path: norm,
                            name: path.basename(norm),
                            count: 1,
                            isCurrent: norm === path.resolve(currentWs)
                        });
                    }
                }
            }
        } catch (_) {}
    }

    return Array.from(wsMap.values());
}

function inspectWorkspace(wsPath) {
    if (!wsPath || !fs.existsSync(wsPath)) {
        return { exists: false, path: wsPath };
    }
    const agyCfgPath = path.join(wsPath, ".agy", "config.json");
    let hasConfig = false;
    let configData = null;
    if (fs.existsSync(agyCfgPath)) {
        hasConfig = true;
        try {
            configData = JSON.parse(fs.readFileSync(agyCfgPath, "utf-8"));
        } catch (_) {}
    }
    const skillsDir = path.join(wsPath, ".gemini", "skills");
    let skillsCount = 0;
    if (fs.existsSync(skillsDir)) {
        try {
            skillsCount = fs.readdirSync(skillsDir).length;
        } catch (_) {}
    }

    return {
        exists: true,
        path: path.resolve(wsPath),
        name: path.basename(wsPath),
        hasConfig,
        config: configData,
        skillsCount
    };
}

function initWorkspaceProject(wsPath, slot = null, preset = null) {
    if (!wsPath) return { ok: false, error: "Workspace path required" };
    fs.mkdirSync(wsPath, { recursive: true });

    const agyBin = getAgyCliPath();
    if (agyBin) {
        try {
            const args = ["project", "init", "-w", wsPath];
            if (slot) args.push("-s", String(slot));
            if (preset) args.push("-p", String(preset));
            const out = execFileSync(agyBin, args, { encoding: "utf-8", timeout: 5000, windowsHide: true });
            return { ok: true, method: "agy-cli", output: out.trim() };
        } catch (_) {}
    }

    try {
        const agyDir = path.join(wsPath, ".agy");
        fs.mkdirSync(agyDir, { recursive: true });
        const cfgFile = path.join(agyDir, "config.json");
        const cfg = {
            slot: slot ? Number(slot) : 1,
            preset: preset || "orchestrator",
            created_at: new Date().toISOString()
        };
        fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), "utf-8");
        if (preset) {
            applyPreset(preset, [], wsPath);
        }
        return { ok: true, method: "direct", config: cfg };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// -----------------------------------------------------------------------------
// Logs & Brain Artifacts
// -----------------------------------------------------------------------------
function getLogs(type = "server_dashboard", linesCount = 100, currentWs = null) {
    const lines = parseInt(linesCount, 10) || 100;
    if (type === "server_dashboard") {
        const sliced = ACTIVITY_LOGS.slice(-lines);
        return {
            ok: true,
            type: "server_dashboard",
            count: sliced.length,
            content: sliced.map(e => `[${e.time}] [${e.level}] [${e.category}] ${e.message}`).join("\n")
        };
    }

    const candidates = [];
    if (type === "daemon") {
        candidates.push(
            path.join(ANTIGRAVITY_DIR, "logs", "agy-daemon.log"),
            path.join(ANTIGRAVITY_DIR, "agy-daemon.log"),
            "/tmp/agy-daemon.log",
            path.join(os.tmpdir(), "agy-daemon.log")
        );
    } else if (type === "language_server") {
        if (currentWs) {
            candidates.push(path.join(currentWs, ".gemini", "language_server.log"));
        }
        candidates.push(
            path.join(USER_HOME, "AppData", "Roaming", "Antigravity", "logs", "language_server.log"),
            path.join(GEMINI_DIR, "language_server.log"),
            path.join(ANTIGRAVITY_DIR, "language_server.log")
        );
    }

    for (const c of candidates) {
        if (fs.existsSync(c)) {
            try {
                const stat = fs.statSync(c);
                const readSize = Math.min(stat.size, lines * 250);
                const buf = Buffer.alloc(readSize);
                const fd = fs.openSync(c, "r");
                fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
                fs.closeSync(fd);
                const raw = buf.toString("utf-8");
                const splitLines = raw.split(/\r?\n/).filter(Boolean).slice(-lines);
                return {
                    ok: true,
                    type,
                    filePath: c,
                    count: splitLines.length,
                    content: splitLines.join("\n")
                };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }
    }

    return {
        ok: true,
        type,
        count: 0,
        content: `[INFO] Лог-файл для '${type}' пока пуст или не создан.\nАктивность дашборда доступна во вкладке 'server_dashboard'.`
    };
}

function getArtifactsList(cid = null) {
    if (!fs.existsSync(BRAIN_DIR)) return [];
    try {
        const entries = [];
        const dirs = cid ? [cid] : fs.readdirSync(BRAIN_DIR);
        for (const dir of dirs) {
            const dirPath = path.join(BRAIN_DIR, dir);
            try {
                if (!fs.statSync(dirPath).isDirectory()) continue;
                const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".md"));
                for (const file of files) {
                    const full = path.join(dirPath, file);
                    const st = fs.statSync(full);
                    let title = file.replace(/\.md$/, "");
                    try {
                        const fd = fs.openSync(full, "r");
                        const buf = Buffer.alloc(Math.min(st.size, 512));
                        fs.readSync(fd, buf, 0, buf.length, 0);
                        fs.closeSync(fd);
                        const match = buf.toString("utf-8").match(/^#\s+(.+)$/m);
                        if (match) title = match[1].trim();
                    } catch (_) {}

                    entries.push({
                        cid: dir,
                        name: file,
                        title,
                        size: st.size,
                        mtime: st.mtimeMs,
                        mtimeFormatted: new Date(st.mtimeMs).toLocaleString()
                    });
                }
            } catch (_) {}
        }
        entries.sort((a, b) => b.mtime - a.mtime);
        return entries;
    } catch (_) {
        return [];
    }
}

function getArtifactContent(cid, name) {
    if (!cid || !name) return null;
    const safeCid = path.basename(cid);
    const safeName = path.basename(name);
    const full = path.join(BRAIN_DIR, safeCid, safeName);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, "utf-8");
}

function getDaemonStatus() {
    const agyBin = getAgyCliPath();
    if (agyBin) {
        try {
            const out = execFileSync(agyBin, ["daemon", "status"], {
                encoding: "utf-8",
                timeout: 1500,
                windowsHide: true
            });
            const isOnline = out.includes("ONLINE") || out.includes("running");
            return {
                running: isOnline,
                statusText: out.trim()
            };
        } catch (_) {}
    }

    const sock = process.platform === "win32"
        ? "\\\\.\\pipe\\antigravity-ipc"
        : "/tmp/agy-sockets/agy.sock";

    const exists = process.platform !== "win32" && fs.existsSync(sock);
    return {
        running: exists,
        statusText: exists ? "ONLINE (Socket active)" : "OFFLINE"
    };
}

// -----------------------------------------------------------------------------
// ServerDashboard Core Class
// -----------------------------------------------------------------------------
class ServerDashboard {
    constructor(options = {}) {
        this.host = options.host || "0.0.0.0";
        this.port = options.port || 51125;
        this.pin = options.pin || null;
        this.workspace = path.resolve(options.workspace || process.cwd());
        this.server = null;
        this.startTime = Date.now();
        this.activeSessions = new Map(); // token -> { createdAt, expiresAt, ip }
        this.initPin();
    }

    initPin() {
        if (this.pin && /^\d{6}$/.test(String(this.pin).trim())) {
            this.pin = String(this.pin).trim();
            this.persistPin();
            return;
        }

        // 1. Check workspace .agy/web_pin
        const wsPinFile = path.join(this.workspace, ".agy", "web_pin");
        if (fs.existsSync(wsPinFile)) {
            try {
                const val = fs.readFileSync(wsPinFile, "utf-8").trim();
                if (/^\d{6}$/.test(val)) {
                    this.pin = val;
                    this.persistPin();
                    return;
                }
            } catch (_) {}
        }

        // 2. Check ~/.gemini/antigravity/web_pin
        const globalPinFile = path.join(ANTIGRAVITY_DIR, "web_pin");
        if (fs.existsSync(globalPinFile)) {
            try {
                const val = fs.readFileSync(globalPinFile, "utf-8").trim();
                if (/^\d{6}$/.test(val)) {
                    this.pin = val;
                    this.persistPin();
                    return;
                }
            } catch (_) {}
        }

        // 3. Check ~/.gemini/antigravity_server_config.json
        if (fs.existsSync(SERVER_CONFIG_PATH)) {
            try {
                const cfg = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf-8"));
                if (cfg.pin && /^\d{6}$/.test(String(cfg.pin).trim())) {
                    this.pin = String(cfg.pin).trim();
                    this.persistPin();
                    return;
                }
            } catch (_) {}
        }

        // 4. Generate new secure 6-digit PIN
        this.pin = generateSecurePin();
        this.persistPin();
    }

    persistPin() {
        // Workspace .agy/web_pin
        try {
            const wsAgy = path.join(this.workspace, ".agy");
            fs.mkdirSync(wsAgy, { recursive: true });
            fs.writeFileSync(path.join(wsAgy, "web_pin"), this.pin, "utf-8");
        } catch (_) {}

        // Global ~/.gemini/antigravity/web_pin
        try {
            fs.mkdirSync(ANTIGRAVITY_DIR, { recursive: true });
            fs.writeFileSync(path.join(ANTIGRAVITY_DIR, "web_pin"), this.pin, "utf-8");
        } catch (_) {}

        // Config JSONs
        try {
            fs.mkdirSync(path.dirname(SERVER_CONFIG_PATH), { recursive: true });
            fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify({ pin: this.pin, port: this.port }, null, 2), "utf-8");
        } catch (_) {}
        try {
            fs.mkdirSync(path.dirname(WEB_CONFIG_PATH), { recursive: true });
            fs.writeFileSync(WEB_CONFIG_PATH, JSON.stringify({ pin: this.pin, port: this.port, allowLan: true }, null, 2), "utf-8");
        } catch (_) {}
    }

    isValidSessionToken(token) {
        if (!token || typeof token !== "string") return false;
        const cleanToken = token.trim();
        const session = this.activeSessions.get(cleanToken);
        if (!session) return false;
        if (session.expiresAt && session.expiresAt < Date.now()) {
            this.activeSessions.delete(cleanToken);
            return false;
        }
        return true;
    }

    checkAuth(req) {
        const clientIp = getClientIp(req);
        const isLocalhost = (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1");

        // 1. Check direct PIN headers
        const candidatePin = req.headers["x-agy-pin"] || req.headers["x-dashboard-pin"];
        if (candidatePin && String(candidatePin).trim() === String(this.pin).trim()) {
            return true;
        }

        // 2. Check Authorization header (Bearer <token_or_pin>)
        const authHeader = req.headers["authorization"];
        if (authHeader) {
            const val = authHeader.replace(/^Bearer\s+/i, "").trim();
            if (val === String(this.pin).trim()) return true;
            if (this.isValidSessionToken(val)) return true;
        }

        // 3. Check x-agy-token header
        const tokenHeader = req.headers["x-agy-token"];
        if (tokenHeader && this.isValidSessionToken(tokenHeader)) {
            return true;
        }

        // 4. Check Cookie header
        const cookieHeader = req.headers["cookie"];
        if (cookieHeader) {
            const cookies = parseCookies(cookieHeader);
            if (cookies.agy_pin && String(cookies.agy_pin).trim() === String(this.pin).trim()) return true;
            if (cookies.agy_token && this.isValidSessionToken(cookies.agy_token)) return true;
        }

        // 5. Check URL query params (pin=... or token=...)
        try {
            const parsed = new URL(req.url, "http://127.0.0.1");
            const qPin = parsed.searchParams.get("pin");
            const qToken = parsed.searchParams.get("token");
            if (qPin && String(qPin).trim() === String(this.pin).trim()) {
                return true;
            }
            if (qToken && this.isValidSessionToken(qToken)) {
                return true;
            }
            if (isLocalhost && qPin === this.pin) {
                return true;
            }
        } catch (_) {}

        return false;
    }

    printBanner() {
        const lanIp = getPrimaryLanIp();
        const line = "=".repeat(74);
        console.log("\n" + line);
        console.log("  🚀 ABSOLUTE ANTIGRAVITY - MODERN AI WEB STUDIO & SERVER (v" + VERSION + ")");
        console.log("  Headless Remote Development Gateway for Mobile, Desktop & Web UI");
        console.log(line);
        console.log("  ╔══════════════════════════════════════════════════════════════════════════╗");
        console.log(`  ║  🔑 ACCESS PIN CODE:  \x1b[1m\x1b[32m${this.pin}\x1b[0m                                            ║`);
        console.log("  ╚══════════════════════════════════════════════════════════════════════════╝");
        console.log("  Enter this 6-digit PIN in your browser to unlock dashboard & studio controls.\n");
        console.log("  🌐 Access URLs:");
        console.log(`     * Localhost:    \x1b[36mhttp://127.0.0.1:${this.port}\x1b[0m`);
        if (lanIp !== "127.0.0.1") {
            console.log(`     * Network LAN:  \x1b[32m\x1b[1mhttp://${lanIp}:${this.port}\x1b[0m (Phone / Remote Laptop)`);
        }
        console.log(`     * Binding:      ${this.host}:${this.port}`);
        console.log(`     * Workspace:    ${this.workspace}`);
        console.log("  🛡️  Security Policy: 5 failed PIN attempts triggers 15-min IP lock.");
        console.log(line + "\n");
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));

            // Upgrade handler for pure Node.js RFC 6455 WebSockets
            this.server.on("upgrade", (req, socket, head) => {
                this.handleUpgrade(req, socket, head);
            });

            this.server.on("error", (err) => {
                logActivity("error", "Server", `Failed to bind ${this.host}:${this.port}: ${err.message}`);
                reject(err);
            });

            this.server.listen(this.port, this.host, () => {
                this.printBanner();
                logActivity("info", "Server", `Listening on http://${this.host}:${this.port}`);
                try {
                    fs.mkdirSync(ANTIGRAVITY_DIR, { recursive: true });
                    fs.writeFileSync(path.join(ANTIGRAVITY_DIR, "web.pid"), String(process.pid), "utf-8");
                } catch (_) {}
                resolve(this);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    logActivity("info", "Server", "Dashboard server stopped");
                    try {
                        const pidFile = path.join(ANTIGRAVITY_DIR, "web.pid");
                        if (fs.existsSync(pidFile)) {
                            const cur = fs.readFileSync(pidFile, "utf-8").trim();
                            if (cur === String(process.pid)) {
                                fs.unlinkSync(pidFile);
                            }
                        }
                    } catch (_) {}
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // -------------------------------------------------------------------------
    // WebSocket Upgrade & Terminal Handler
    // -------------------------------------------------------------------------
    handleUpgrade(req, socket, head) {
        const parsedUrl = new URL(req.url, "http://127.0.0.1");
        const pathname = parsedUrl.pathname;

        if (pathname === "/ws/terminal") {
            if (!this.checkAuth(req)) {
                socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nUnauthorized\r\n");
                socket.destroy();
                return;
            }

            const secKey = req.headers["sec-websocket-key"];
            if (!secKey) {
                socket.destroy();
                return;
            }

            const acceptKey = crypto.createHash("sha1").update(secKey + WS_GUID).digest("base64");
            const responseHeaders = [
                "HTTP/1.1 101 Switching Protocols",
                "Upgrade: websocket",
                "Connection: Upgrade",
                `Sec-WebSocket-Accept: ${acceptKey}`,
                "\r\n"
            ];
            socket.write(responseHeaders.join("\r\n"));

            const ws = new RawWebSocket(socket);
            if (head && head.length > 0) {
                ws._onData(head);
            }

            this.handleTerminalWebSocket(ws);
            return;
        }

        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
    }

    handleTerminalWebSocket(ws) {
        logActivity("info", "Terminal", `WebSocket terminal connected from client`);
        const isWin = process.platform === "win32";
        const shellCmd = isWin ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
        const shellArgs = isWin ? ["-NoLogo"] : ["-i"];

        let shell;
        try {
            shell = spawn(shellCmd, shellArgs, {
                cwd: this.workspace,
                env: {
                    ...process.env,
                    TERM: "xterm-256color",
                    COLORTERM: "truecolor",
                    PS1: "\u001b[36magy-studio\u001b[0m:\u001b[32m\\w\u001b[0m$ "
                },
                windowsHide: true
            });
        } catch (err) {
            ws.send(`\r\n[Failed to spawn shell ${shellCmd}: ${err.message}]\r\n`);
            ws.close(1011, err.message);
            return;
        }

        shell.stdout.on("data", chunk => ws.send(chunk.toString("utf-8")));
        shell.stderr.on("data", chunk => ws.send(chunk.toString("utf-8")));

        ws.on("message", (msg) => {
            if (typeof msg === "string") {
                try {
                    if (msg.trim().startsWith("{") && msg.trim().endsWith("}")) {
                        const parsed = JSON.parse(msg);
                        if (parsed.type === "resize") {
                            logActivity("info", "Terminal", `Terminal resize: cols=${parsed.cols}, rows=${parsed.rows}`);
                            return;
                        }
                        if (parsed.type === "stdin") {
                            shell.stdin.write(parsed.data || "");
                            return;
                        }
                    }
                } catch (_) {}
                shell.stdin.write(msg);
            } else if (Buffer.isBuffer(msg)) {
                shell.stdin.write(msg);
            }
        });

        ws.on("close", () => {
            logActivity("info", "Terminal", "Terminal WebSocket closed by client");
            try { shell.kill(); } catch (_) {}
        });

        shell.on("close", (code) => {
            logActivity("info", "Terminal", `Terminal shell process exited with code ${code}`);
            ws.close(1000, `Shell exited with code ${code}`);
        });

        shell.on("error", (err) => {
            logActivity("error", "Terminal", `Terminal shell error: ${err.message}`);
            ws.send(`\r\n[Shell Error: ${err.message}]\r\n`);
            ws.close(1011, err.message);
        });
    }

    // -------------------------------------------------------------------------
    // HTTP Request Dispatcher
    // -------------------------------------------------------------------------
    handleRequest(req, res) {
        const clientIp = getClientIp(req);
        const parsedUrl = new URL(req.url, "http://127.0.0.1");
        const pathname = parsedUrl.pathname;

        // CORS & Security Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-agy-pin, x-dashboard-pin, x-agy-token, Authorization, Cookie");
        res.setHeader("X-Content-Type-Options", "nosniff");

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

        // ---------------------------------------------------------------------
        // Public UI SPA & Static Asset Serving (web/dist or built-in Studio)
        // ---------------------------------------------------------------------
        const candidateDistDirs = [
            path.join(__dirname, "..", "web", "dist"),
            path.join(__dirname, "dist"),
            path.join(__dirname),
            path.join(process.cwd(), "web", "dist"),
            path.join(process.cwd(), "dist")
        ];
        let distDir = null;
        for (const cand of candidateDistDirs) {
            try {
                if (fs.existsSync(path.join(cand, "index.html"))) {
                    distDir = cand;
                    break;
                }
            } catch (_) {}
        }
        const distIndexExists = distDir !== null;

        if (!pathname.startsWith("/api/") && !pathname.startsWith("/ws/")) {
            if (distIndexExists) {
                let relPath = pathname.slice(1);
                if (!relPath || relPath === "index.html") {
                    relPath = "index.html";
                }
                const targetPath = path.resolve(distDir, relPath);
                if (targetPath.startsWith(distDir) && fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
                    res.writeHead(200, { "Content-Type": `${getMimeType(targetPath)}; charset=utf-8` });
                    fs.createReadStream(targetPath).pipe(res);
                    return;
                }
                // Client-side route fallback to web/dist/index.html
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                fs.createReadStream(path.join(distDir, "index.html")).pipe(res);
                return;
            } else {
                // Built-in Studio Fallback
                if (pathname === "/" || pathname === "/index.html") {
                    sendHtml(this.renderHtml());
                    return;
                }
                if (pathname === "/favicon.ico") {
                    res.writeHead(204);
                    res.end();
                    return;
                }
            }
        }

        // ---------------------------------------------------------------------
        // Authentication Endpoint: POST /api/auth
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/auth") {
            const limitCheck = checkRateLimit(clientIp);
            if (limitCheck.blocked) {
                res.writeHead(429, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Retry-After": String(limitCheck.retryAfter)
                });
                res.end(JSON.stringify({
                    ok: false,
                    error: `Слишком много неудачных попыток. IP заблокирован на 15 минут. Повторите через ${limitCheck.retryAfter} сек.`
                }));
                return;
            }

            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const suppliedPin = data.pin || req.headers["x-agy-pin"] || "";
                    if (String(suppliedPin).trim() === String(this.pin).trim()) {
                        recordAuthSuccess(clientIp);
                        const token = crypto.randomBytes(32).toString("hex");
                        const expiresIn = 86400; // 24 hours
                        this.activeSessions.set(token, {
                            createdAt: Date.now(),
                            expiresAt: Date.now() + expiresIn * 1000,
                            ip: clientIp
                        });
                        logActivity("info", "Auth", `Successful authentication from IP ${clientIp}`);
                        res.setHeader("Set-Cookie", `agy_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expiresIn}`);
                        sendJson(200, {
                            ok: true,
                            user: "admin",
                            token,
                            pin: this.pin,
                            expiresIn
                        });
                    } else {
                        const failRes = recordAuthFailure(clientIp);
                        if (failRes.blocked) {
                            res.writeHead(429, {
                                "Content-Type": "application/json; charset=utf-8",
                                "Retry-After": String(failRes.retryAfter)
                            });
                            res.end(JSON.stringify({
                                ok: false,
                                error: `Превышен лимит попыток. IP заблокирован на 15 минут. Повторите через ${failRes.retryAfter} сек.`
                            }));
                        } else {
                            sendJson(401, {
                                ok: false,
                                error: `Неверный PIN-код (осталось попыток: ${failRes.remaining})`
                            });
                        }
                    }
                } catch (e) {
                    sendJson(400, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // Guard all /api/* endpoints with Rate-Limit & PIN / Token
        // ---------------------------------------------------------------------
        if (pathname.startsWith("/api/")) {
            const limitCheck = checkRateLimit(clientIp);
            if (limitCheck.blocked) {
                res.writeHead(429, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Retry-After": String(limitCheck.retryAfter)
                });
                res.end(JSON.stringify({
                    ok: false,
                    error: `IP заблокирован из-за неудачных попыток авторизации. Ждите ${limitCheck.retryAfter} сек.`
                }));
                return;
            }

            if (!this.checkAuth(req)) {
                const failRes = recordAuthFailure(clientIp);
                if (failRes.blocked) {
                    res.writeHead(429, {
                        "Content-Type": "application/json; charset=utf-8",
                        "Retry-After": String(failRes.retryAfter)
                    });
                    res.end(JSON.stringify({
                        ok: false,
                        error: `IP заблокирован на 15 минут. Повторите через ${failRes.retryAfter} сек.`
                    }));
                } else {
                    sendJson(401, { ok: false, error: "Требуется авторизация (PIN-код или session token)" });
                }
                return;
            } else {
                recordAuthSuccess(clientIp);
            }
        }

        // ---------------------------------------------------------------------
        // GET /api/state - System & Gateway Status
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/state") {
            const slotsData = getAccountSlotsStatus();
            const activePreset = getActivePreset(this.workspace);
            const presets = getAllPresets();
            const wsInfo = inspectWorkspace(this.workspace);
            const daemon = getDaemonStatus();
            const lsSession = getLanguageServerSession();

            sendJson(200, {
                ok: true,
                server: {
                    version: VERSION,
                    uptime: Math.floor((Date.now() - this.startTime) / 1000),
                    platform: process.platform,
                    arch: process.arch,
                    host: this.host,
                    port: this.port,
                    lanIp: getPrimaryLanIp(),
                    nodeVersion: process.version,
                    memory: process.memoryUsage()
                },
                activePreset,
                activePresetDetails: presets[activePreset] || { id: activePreset, name: activePreset, icon: "⚡" },
                workspace: wsInfo,
                slots: slotsData.accounts,
                activeSlot: slotsData.activeSlot,
                currentEmail: slotsData.currentEmail,
                autoFailover: slotsData.autoFailover,
                daemon,
                languageServer: {
                    active: !!lsSession,
                    port: lsSession ? lsSession.port : 0,
                    source: lsSession ? lsSession.source : "none"
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/cascade/status - Language Server Cascade Agent Health
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/cascade/status") {
            const ls = getLanguageServerSession();
            if (ls) {
                sendJson(200, {
                    ok: true,
                    active: true,
                    port: ls.port,
                    csrf: ls.csrf ? "present" : "missing",
                    pid: ls.pid || null,
                    source: ls.source,
                    health: "ONLINE"
                });
            } else {
                sendJson(200, {
                    ok: false,
                    active: false,
                    port: 0,
                    health: "OFFLINE",
                    message: "No active Antigravity Language Server session detected in active_session.json or env"
                });
            }
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/chat/stream - Native Antigravity Cascade Agent Streaming
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/chat/stream") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const prompt = data.prompt;
                    if (!prompt || !prompt.trim()) {
                        sendJson(400, { ok: false, error: "Field 'prompt' is required" });
                        return;
                    }

                    const model = data.model || "gemini-3.8-flash-high";
                    const mappedModel = mapToAntigravityModel(model);
                    const systemPrompt = data.systemPrompt || null;
                    const history = Array.isArray(data.history) ? data.history : [];

                    res.writeHead(200, {
                        "Content-Type": "text/event-stream; charset=utf-8",
                        "Cache-Control": "no-cache, no-transform",
                        "Connection": "keep-alive",
                        "Access-Control-Allow-Origin": "*",
                        "X-Accel-Buffering": "no"
                    });

                    const ls = getLanguageServerSession();
                    if (!ls) {
                        // Language server offline notice
                        res.write(`data: ${JSON.stringify({
                            type: "error",
                            error: "Antigravity Language Server is offline. Please launch Antigravity or ensure active_session.json exists."
                        })}\n\n`);
                        res.end();
                        return;
                    }

                    logActivity("info", "Cascade", `Initiating Cascade on port ${ls.port} with model ${mappedModel}`);

                    let cascadeId;
                    try {
                        const startRes = await lsRpcRequest(ls.port, ls.csrf, "StartCascade", {
                            source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
                            metadata: {
                                ideName: "antigravity",
                                ideVersion: "2.28.2"
                            }
                        });
                        cascadeId = startRes.cascadeId;
                    } catch (startErr) {
                        res.write(`data: ${JSON.stringify({ type: "error", error: `StartCascade failed: ${startErr.message}` })}\n\n`);
                        res.end();
                        return;
                    }

                    // Compose full prompt with system prompt and history
                    let fullText = "";
                    if (systemPrompt && systemPrompt.trim()) {
                        fullText += `[System Directives]\n${systemPrompt.trim()}\n\n`;
                    }
                    for (const msg of history) {
                        const role = (msg.role === "model" || msg.role === "assistant") ? "Antigravity" : "User";
                        fullText += `[${role}]\n${(msg.content || "").trim()}\n\n`;
                    }
                    fullText += prompt;

                    try {
                        await lsRpcRequest(ls.port, ls.csrf, "SendUserCascadeMessage", {
                            cascadeId,
                            items: [{ text: fullText }],
                            cascadeConfig: {
                                plannerConfig: {
                                    planModel: mappedModel,
                                    useAiCredits: true
                                }
                            }
                        });
                    } catch (sendErr) {
                        res.write(`data: ${JSON.stringify({ type: "error", error: `SendUserCascadeMessage failed: ${sendErr.message}` })}\n\n`);
                        res.end();
                        return;
                    }

                    // Poll trajectory steps
                    let seenThinkingLen = 0;
                    let seenTextLen = 0;
                    let fullResponse = "";
                    let isCompleted = false;
                    let isCancelled = false;

                    req.on("close", () => {
                        isCancelled = true;
                    });

                    const pollStartTime = Date.now();
                    const timeoutMs = 180000;

                    const pollSteps = async () => {
                        if (isCompleted || isCancelled) return;
                        if (Date.now() - pollStartTime > timeoutMs) {
                            res.write(`data: ${JSON.stringify({ type: "error", error: "Cascade agent request timed out after 180s" })}\n\n`);
                            res.end();
                            return;
                        }

                        try {
                            const stepsRes = await lsRpcRequest(ls.port, ls.csrf, "GetCascadeTrajectorySteps", { cascadeId });
                            const steps = Array.isArray(stepsRes.steps) ? stepsRes.steps : [];

                            for (const step of steps) {
                                if (step.type === "CORTEX_STEP_TYPE_ERROR_MESSAGE") {
                                    const errMsg = step.errorMessage?.error?.shortError ||
                                        step.errorMessage?.error?.userErrorMessage ||
                                        "Antigravity Agent encountered an internal error";
                                    res.write(`data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`);
                                    res.end();
                                    isCompleted = true;
                                    return;
                                }

                                if (step.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
                                    const pr = step.plannerResponse || {};

                                    // Thinking delta
                                    const thinking = pr.thinking || pr.thinkingProcess || "";
                                    if (thinking.length > seenThinkingLen) {
                                        const delta = thinking.slice(seenThinkingLen);
                                        seenThinkingLen = thinking.length;
                                        res.write(`data: ${JSON.stringify({ type: "thinking", content: delta })}\n\n`);
                                    }

                                    // Response text delta
                                    const resp = pr.response || pr.modifiedResponse || "";
                                    if (resp.length > seenTextLen) {
                                        const delta = resp.slice(seenTextLen);
                                        seenTextLen = resp.length;
                                        fullResponse = resp;
                                        res.write(`data: ${JSON.stringify({ type: "text", content: delta })}\n\n`);
                                    }

                                    // Status completion
                                    if (step.status === "CORTEX_STEP_STATUS_DONE" || step.status === "DONE") {
                                        isCompleted = true;
                                        res.write(`data: ${JSON.stringify({ type: "done", fullText: fullResponse, model: mappedModel })}\n\n`);
                                        res.end();
                                        return;
                                    }
                                }
                            }
                        } catch (_) {}

                        if (!isCompleted && !isCancelled) {
                            setTimeout(pollSteps, 200);
                        }
                    };

                    setTimeout(pollSteps, 150);

                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/fs/tree - Workspace Directory Tree
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/fs/tree") {
            const relParam = parsedUrl.searchParams.get("path") || ".";
            const targetDir = path.resolve(this.workspace, relParam);
            const rootWs = path.resolve(this.workspace);

            if (!targetDir.startsWith(rootWs)) {
                sendJson(403, { ok: false, error: "Access denied: Path traversal outside workspace forbidden" });
                return;
            }

            const tree = scanFsTree(this.workspace, relParam === "." ? "" : relParam);
            sendJson(200, {
                ok: true,
                root: path.basename(this.workspace),
                workspace: this.workspace,
                tree
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/fs/read - Read File Content
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/fs/read") {
            const relParam = parsedUrl.searchParams.get("path");
            if (!relParam) {
                sendJson(400, { ok: false, error: "Missing 'path' parameter" });
                return;
            }

            const targetFile = path.resolve(this.workspace, relParam);
            const rootWs = path.resolve(this.workspace);

            if (!targetFile.startsWith(rootWs)) {
                sendJson(403, { ok: false, error: "Access denied: Path traversal outside workspace forbidden" });
                return;
            }

            if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
                sendJson(404, { ok: false, error: "File not found" });
                return;
            }

            try {
                const stat = fs.statSync(targetFile);
                if (stat.size > 5 * 1024 * 1024) {
                    sendJson(413, { ok: false, error: "File exceeds 5MB size limit" });
                    return;
                }
                const content = fs.readFileSync(targetFile, "utf-8");
                sendJson(200, {
                    ok: true,
                    path: relParam.replace(/\\/g, "/"),
                    mime: getMimeType(targetFile),
                    size: stat.size,
                    mtime: stat.mtime.toISOString(),
                    content
                });
            } catch (err) {
                sendJson(500, { ok: false, error: err.message });
            }
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/fs/write - Write File Content Safely
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/fs/write") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    if (!data.path) {
                        sendJson(400, { ok: false, error: "Field 'path' is required" });
                        return;
                    }

                    const targetFile = path.resolve(this.workspace, data.path);
                    const rootWs = path.resolve(this.workspace);

                    if (!targetFile.startsWith(rootWs)) {
                        sendJson(403, { ok: false, error: "Access denied: Path traversal outside workspace forbidden" });
                        return;
                    }

                    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
                    const content = typeof data.content === "string" ? data.content : "";
                    fs.writeFileSync(targetFile, content, "utf-8");
                    const bytesWritten = Buffer.byteLength(content, "utf-8");
                    logActivity("info", "FS", `File written: ${data.path} (${bytesWritten} bytes)`);

                    sendJson(200, {
                        ok: true,
                        path: data.path.replace(/\\/g, "/"),
                        bytesWritten
                    });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/git/diff - Git Status & Working Tree Diff
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/git/diff") {
            try {
                const status = execFileSync("git", ["status", "-s"], {
                    cwd: this.workspace,
                    encoding: "utf-8",
                    timeout: 5000,
                    windowsHide: true
                });
                const diff = execFileSync("git", ["diff"], {
                    cwd: this.workspace,
                    encoding: "utf-8",
                    timeout: 5000,
                    windowsHide: true
                });
                sendJson(200, {
                    ok: true,
                    status: status.trim(),
                    diff: diff || ""
                });
            } catch (err) {
                sendJson(200, {
                    ok: true,
                    status: "",
                    diff: "",
                    note: "Not a git repository or git binary unavailable"
                });
            }
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/presets - All 16 Presets & Catalog
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/presets") {
            const presets = getAllPresets();
            const activePreset = getActivePreset(this.workspace);
            const presetList = Object.keys(presets).map(k => {
                const p = presets[k];
                return {
                    id: p.id || k,
                    name: p.name || k,
                    icon: p.icon || "⚡",
                    description: p.description || "",
                    skills: p.skills || [],
                    skillsCount: (p.skills || []).length,
                    isActive: (p.id || k) === activePreset
                };
            });

            sendJson(200, {
                ok: true,
                activePreset,
                count: presetList.length,
                presets: presetList,
                commonOverlays: ["+qa", "+devops", "+docker", "+react", "+postgres", "+test"]
            });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/presets/switch & POST /api/switch-preset
        // ---------------------------------------------------------------------
        if (req.method === "POST" && (pathname === "/api/presets/switch" || pathname === "/api/switch-preset")) {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const targetPreset = data.preset;
                    if (!targetPreset) {
                        sendJson(400, { ok: false, error: "Параметр 'preset' обязателен" });
                        return;
                    }
                    const overlays = data.overlays || [];
                    const ws = data.workspace ? path.resolve(data.workspace) : this.workspace;
                    const resSwitch = applyPreset(targetPreset, overlays, ws);
                    logActivity("info", "Preset", `Switched preset to '${targetPreset}' in workspace: ${ws}`);
                    sendJson(200, { ok: true, activePreset: targetPreset, result: resSwitch });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/accounts & GET /api/slots - Multi-Account Carousel
        // ---------------------------------------------------------------------
        if (req.method === "GET" && (pathname === "/api/accounts" || pathname === "/api/slots")) {
            const data = getAccountSlotsStatus();
            sendJson(200, data);
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/accounts/rotate
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/accounts/rotate") {
            try {
                const resRotate = rotateAccountSlot(null);
                const updated = getAccountSlotsStatus();
                logActivity("info", "Accounts", `Account rotated to next slot`);
                sendJson(200, { ok: true, result: resRotate, status: updated });
            } catch (e) {
                sendJson(500, { ok: false, error: e.message });
            }
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/accounts/switch-slot & POST /api/switch-slot
        // ---------------------------------------------------------------------
        if (req.method === "POST" && (pathname === "/api/accounts/switch-slot" || pathname === "/api/switch-slot")) {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const targetSlot = data.slot ? Number(data.slot) : null;
                    const resRotate = rotateAccountSlot(targetSlot);
                    const updated = getAccountSlotsStatus();
                    logActivity("info", "Accounts", `Account switched to slot ${targetSlot || "next"}`);
                    sendJson(200, { ok: true, result: resRotate, status: updated });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/toggle-autofailover
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/toggle-autofailover") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const resToggle = toggleAutoFailover(typeof data.enabled === "boolean" ? data.enabled : null);
                    sendJson(200, resToggle);
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/workspaces
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/workspaces") {
            const list = getRecentWorkspaces(this.workspace);
            const currentInfo = inspectWorkspace(this.workspace);
            sendJson(200, { ok: true, current: currentInfo, workspaces: list });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/workspaces/select
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/workspaces/select") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    if (!data.workspace) {
                        sendJson(400, { ok: false, error: "Workspace path required" });
                        return;
                    }
                    const resolved = path.resolve(data.workspace);
                    if (!fs.existsSync(resolved)) {
                        sendJson(404, { ok: false, error: `Директория не существует: ${resolved}` });
                        return;
                    }
                    this.workspace = resolved;
                    logActivity("info", "Workspace", `Active workspace set to: ${resolved}`);
                    sendJson(200, { ok: true, workspace: inspectWorkspace(this.workspace) });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/workspaces/init
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/workspaces/init") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const targetWs = data.workspace ? path.resolve(data.workspace) : this.workspace;
                    const resInit = initWorkspaceProject(targetWs, data.slot, data.preset);
                    if (resInit.ok) {
                        this.workspace = targetWs;
                    }
                    logActivity("info", "Workspace", `Project init in ${targetWs}`);
                    sendJson(200, { ok: true, result: resInit, workspace: inspectWorkspace(targetWs) });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/terminal/exec - Console Command Runner
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/terminal/exec") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const command = data.command;
                    if (!command || !command.trim()) {
                        sendJson(400, { ok: false, error: "Команда не указана" });
                        return;
                    }
                    const ws = data.workspace ? path.resolve(data.workspace) : this.workspace;
                    const startTs = Date.now();

                    logActivity("info", "Terminal", `Exec: ${command.trim()} in ${ws}`);

                    exec(command, {
                        cwd: ws,
                        timeout: 30000,
                        maxBuffer: 5 * 1024 * 1024,
                        windowsHide: true,
                        shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash"
                    }, (error, stdout, stderr) => {
                        const durationMs = Date.now() - startTs;
                        sendJson(200, {
                            ok: !error,
                            stdout: stdout || "",
                            stderr: stderr || (error ? error.message : ""),
                            exitCode: error ? (error.code || 1) : 0,
                            durationMs
                        });
                    });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/logs
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/logs") {
            const type = parsedUrl.searchParams.get("type") || "server_dashboard";
            const lines = parsedUrl.searchParams.get("lines") || "100";
            const resLogs = getLogs(type, lines, this.workspace);
            sendJson(200, resLogs);
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/artifacts & GET /api/artifact-content
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/artifacts") {
            const cid = parsedUrl.searchParams.get("cid") || null;
            const artifacts = getArtifactsList(cid);
            sendJson(200, { ok: true, count: artifacts.length, artifacts });
            return;
        }

        if (req.method === "GET" && pathname === "/api/artifact-content") {
            const cid = parsedUrl.searchParams.get("cid");
            const name = parsedUrl.searchParams.get("name");
            const content = getArtifactContent(cid, name);
            if (content === null) {
                sendJson(404, { ok: false, error: "Артефакт не найден" });
            } else {
                sendJson(200, { ok: true, cid, name, content });
            }
            return;
        }

        sendJson(404, { ok: false, error: `Маршрут не найден: ${pathname}` });
    }

    // -------------------------------------------------------------------------
    // Built-in Studio Fallback (Modern AI Web Studio Responsive Dark SPA)
    // -------------------------------------------------------------------------
    renderHtml() {
        return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Absolute Antigravity | Modern AI Web Studio</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#090b10">
  <style>
    :root {
      --bg-page: #090b10;
      --bg-surface: rgba(15, 20, 32, 0.75);
      --bg-surface-elevated: rgba(22, 29, 46, 0.85);
      --bg-card: rgba(17, 23, 36, 0.65);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.35);
      --green: #10b981;
      --purple: #8b5cf6;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      --font-mono: ui-monospace, "JetBrains Mono", Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; scrollbar-width: thin; }
    body {
      font-family: var(--font-sans);
      background-color: var(--bg-page);
      background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(59, 130, 246, 0.15), transparent 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(11, 15, 24, 0.85);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
    .brand-logo {
      width: 32px; height: 32px; background: linear-gradient(135deg, var(--accent), var(--purple));
      border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .tabs { display: flex; gap: 6px; background: rgba(255, 255, 255, 0.03); padding: 4px; border-radius: 10px; border: 1px solid var(--border); }
    .tab-btn {
      background: transparent; border: none; color: var(--text-muted); padding: 6px 14px;
      border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;
    }
    .tab-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active { color: #fff; background: var(--accent); box-shadow: 0 0 12px var(--accent-glow); }
    main { flex: 1; padding: 24px; max-width: 1400px; width: 100%; margin: 0 auto; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; animation: fadeIn 0.25s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .btn {
      background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 8px 16px;
      font-size: 13.5px; font-weight: 600; cursor: pointer; transition: all 0.2s;
    }
    .btn:hover { background: #2563eb; }
    .btn-secondary { background: rgba(255, 255, 255, 0.08); color: var(--text); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.14); }
    .input {
      background: #0b0f17; border: 1px solid var(--border); border-radius: 8px;
      padding: 9px 12px; color: #fff; font-family: inherit; font-size: 13.5px; outline: none;
    }
    .input:focus { border-color: var(--accent); }
    pre, code { font-family: var(--font-mono); }
    .terminal-screen {
      background: #050608; border: 1px solid var(--border); border-radius: 10px; padding: 14px;
      height: 480px; overflow-y: auto; color: #38bdf8; font-size: 13px; line-height: 1.5; white-space: pre-wrap;
    }
    .lock-screen {
      position: fixed; inset: 0; background: rgba(9, 11, 16, 0.94); backdrop-filter: blur(16px);
      display: flex; align-items: center; justify-content: center; z-index: 999;
    }
    .lock-card {
      background: var(--bg-surface-elevated); border: 1px solid var(--border); border-radius: 16px;
      padding: 36px 32px; width: 100%; max-width: 400px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    }
  </style>
</head>
<body>
  <div id="lockScreen" class="lock-screen" style="display: none;">
    <div class="lock-card">
      <div style="font-size: 36px; margin-bottom: 12px;">🔐</div>
      <h2 style="margin-bottom: 8px; font-size: 20px;">Antigravity Web Studio</h2>
      <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 24px;">Введите 6-значный PIN-код доступа к серверу</p>
      <input type="password" id="pinInput" class="input" maxlength="6" placeholder="• • • • • •" style="text-align: center; letter-spacing: 6px; font-size: 20px; width: 100%; margin-bottom: 16px;">
      <button id="pinSubmitBtn" class="btn" style="width: 100%; padding: 10px;">Разблокировать Studio</button>
      <div id="pinError" style="color: #f43f5e; font-size: 12.5px; margin-top: 12px; display: none;"></div>
    </div>
  </div>

  <header>
    <div class="brand">
      <div class="brand-logo">⚡</div>
      <span>Absolute Antigravity</span>
      <span style="font-size: 10px; background: rgba(59,130,246,0.15); color: #93c5fd; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(59,130,246,0.3);">v4.0 STUDIO</span>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('chat')">Cascade Chat</button>
      <button class="tab-btn" onclick="switchTab('presets')">Presets</button>
      <button class="tab-btn" onclick="switchTab('accounts')">Accounts</button>
      <button class="tab-btn" onclick="switchTab('files')">Files & Editor</button>
      <button class="tab-btn" onclick="switchTab('terminal')">Terminal</button>
      <button class="tab-btn" onclick="switchTab('logs')">Logs & Brain</button>
    </div>
  </header>

  <main>
    <!-- 1. Cascade Chat -->
    <div id="tab-chat" class="tab-pane active">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3>🚀 Native Antigravity Cascade Agent</h3>
          <div style="display: flex; gap: 10px;">
            <select id="chatModelSelect" class="input" style="padding: 4px 10px;">
              <option value="gemini-3.8-flash-high">Gemini 3.8 Flash High (Fast)</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep)</option>
              <option value="claude-sonnet-4-6">Claude 3.7 Sonnet</option>
              <option value="claude-opus-4-6-thinking">Claude 3.7 Opus</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            </select>
            <span id="lsBadge" style="font-size: 12px; padding: 4px 8px; border-radius: 6px; background: rgba(16,185,129,0.15); color: #34d399;">LS Checking...</span>
          </div>
        </div>
        <div id="thinkingBox" style="display: none; background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 8px; padding: 12px; margin-bottom: 14px; font-size: 12.5px; color: #c4b5fd; white-space: pre-wrap;"></div>
        <div id="chatOutput" style="background: #06080c; border: 1px solid var(--border); border-radius: 8px; padding: 16px; min-height: 280px; max-height: 520px; overflow-y: auto; margin-bottom: 16px; line-height: 1.6; white-space: pre-wrap;">[Antigravity Studio] Ready. Ask anything to cascade agent...</div>
        <div style="display: flex; gap: 10px;">
          <input type="text" id="chatInput" class="input" placeholder="Введите задачу для Cascade Agent..." style="flex: 1;" onkeydown="if(event.key==='Enter') sendChat()">
          <button class="btn" onclick="sendChat()">Отправить</button>
        </div>
      </div>
    </div>

    <!-- 2. Presets Tab -->
    <div id="tab-presets" class="tab-pane">
      <div class="card">
        <h3>🎯 16 Presets & Specialized Meta-Skills</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin: 6px 0 16px 0;">Переключайте контекст и промпты на лету для любой роли</p>
        <div id="presetsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px;"></div>
      </div>
    </div>

    <!-- 3. Accounts Tab -->
    <div id="tab-accounts" class="tab-pane">
      <div class="card">
        <h3>👥 4-Slot Multi-Account Carousel</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin: 6px 0 16px 0;">Управление Google-аккаунтами и квотами с автоматическим фейловером</p>
        <div id="accountsSlots" style="display: flex; gap: 14px; margin-bottom: 20px;"></div>
        <button class="btn" onclick="rotateAccount()">Повернуть карусель (Rotate)</button>
      </div>
    </div>

    <!-- 4. Files & Editor Tab -->
    <div id="tab-files" class="tab-pane">
      <div class="card" style="display: grid; grid-template-columns: 280px 1fr; gap: 18px; min-height: 550px;">
        <div style="border-right: 1px solid var(--border); padding-right: 14px; overflow-y: auto;">
          <div style="font-weight: 600; font-size: 13.5px; margin-bottom: 10px;">Workspace Tree</div>
          <div id="fileTree" style="font-size: 12.5px; font-family: var(--font-mono);">Loading tree...</div>
        </div>
        <div style="display: flex; flex-direction: column;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span id="activeFilePath" style="font-family: var(--font-mono); font-size: 13px; color: var(--text-muted);">No file selected</span>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" onclick="loadGitDiff()">Git Diff</button>
              <button class="btn" onclick="saveActiveFile()">Save File</button>
            </div>
          </div>
          <textarea id="fileEditor" class="input" style="flex: 1; font-family: var(--font-mono); font-size: 13px; line-height: 1.5; resize: none;"></textarea>
        </div>
      </div>
    </div>

    <!-- 5. Terminal Tab -->
    <div id="tab-terminal" class="tab-pane">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3>💻 Interactive WebSocket Terminal</h3>
          <span id="termStatus" style="font-size: 12px; color: var(--green);">WS Connected</span>
        </div>
        <div id="terminalScreen" class="terminal-screen"></div>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <input type="text" id="termInput" class="input" style="flex: 1; font-family: var(--font-mono);" placeholder="Type shell command..." onkeydown="if(event.key==='Enter') sendTermCommand()">
          <button class="btn" onclick="sendTermCommand()">Send</button>
        </div>
      </div>
    </div>

    <!-- 6. Logs & Artifacts -->
    <div id="tab-logs" class="tab-pane">
      <div class="card">
        <h3>📜 Server Activity Logs & Brain Artifacts</h3>
        <div style="display: flex; gap: 10px; margin: 12px 0;">
          <button class="btn btn-secondary" onclick="loadLogs('server_dashboard')">Server Dashboard</button>
          <button class="btn btn-secondary" onclick="loadLogs('daemon')">Daemon</button>
          <button class="btn btn-secondary" onclick="loadLogs('language_server')">Language Server</button>
        </div>
        <div id="logsOutput" class="terminal-screen" style="height: 380px;"></div>
      </div>
    </div>
  </main>

  <script>
    let activeToken = localStorage.getItem("agy_token") || "";
    let activePin = localStorage.getItem("agy_pin") || "";
    let wsTerm = null;
    let currentOpenPath = "";

    function getAuthHeaders() {
      const headers = { "Content-Type": "application/json" };
      if (activeToken) headers["Authorization"] = "Bearer " + activeToken;
      if (activePin) headers["x-agy-pin"] = activePin;
      return headers;
    }

    function switchTab(name) {
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      const target = document.getElementById("tab-" + name);
      if (target) target.classList.add("active");
      const btn = Array.from(document.querySelectorAll(".tab-btn")).find(b => b.textContent.toLowerCase().includes(name));
      if (btn) btn.classList.add("active");
      if (name === "terminal") initTerminal();
      if (name === "files") loadTree();
    }

    async function checkAuth() {
      try {
        const res = await fetch("/api/state", { headers: getAuthHeaders() });
        if (res.status === 401 || res.status === 429) {
          document.getElementById("lockScreen").style.display = "flex";
        } else {
          document.getElementById("lockScreen").style.display = "none";
          initDashboard();
        }
      } catch (_) {
        document.getElementById("lockScreen").style.display = "flex";
      }
    }

    document.getElementById("pinSubmitBtn").onclick = async () => {
      const pin = document.getElementById("pinInput").value.trim();
      const errBox = document.getElementById("pinError");
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.ok) {
          activeToken = data.token;
          activePin = pin;
          localStorage.setItem("agy_token", activeToken);
          localStorage.setItem("agy_pin", activePin);
          document.getElementById("lockScreen").style.display = "none";
          initDashboard();
        } else {
          errBox.textContent = data.error || "Неверный PIN-код";
          errBox.style.display = "block";
        }
      } catch (e) {
        errBox.textContent = e.message;
        errBox.style.display = "block";
      }
    };

    async function initDashboard() {
      fetch("/api/cascade/status", { headers: getAuthHeaders() }).then(r => r.json()).then(d => {
        const b = document.getElementById("lsBadge");
        if (d.active) {
          b.textContent = "LS Online (:" + d.port + ")";
          b.style.color = "#34d399";
        } else {
          b.textContent = "LS Offline";
          b.style.color = "#f43f5e";
        }
      });
      loadPresets();
      loadAccounts();
    }

    async function sendChat() {
      const input = document.getElementById("chatInput");
      const prompt = input.value.trim();
      if (!prompt) return;
      input.value = "";
      const model = document.getElementById("chatModelSelect").value;
      const out = document.getElementById("chatOutput");
      const think = document.getElementById("thinkingBox");
      think.style.display = "none";
      think.textContent = "";
      out.textContent = "Cascading prompt: " + prompt + "\\n\\n";

      try {
        const resp = await fetch("/api/chat/stream", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ prompt, model })
        });
        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\\n\\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "thinking") {
                  think.style.display = "block";
                  think.textContent += ev.content;
                } else if (ev.type === "text") {
                  out.textContent += ev.content;
                } else if (ev.type === "error") {
                  out.textContent += "\\n[Error: " + ev.error + "]";
                }
              } catch (_) {}
            }
          }
        }
      } catch (e) {
        out.textContent += "\\n[Stream failed: " + e.message + "]";
      }
    }

    async function loadPresets() {
      const res = await fetch("/api/presets", { headers: getAuthHeaders() });
      const data = await res.json();
      const grid = document.getElementById("presetsGrid");
      grid.innerHTML = "";
      (data.presets || []).forEach(p => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.cursor = "pointer";
        card.style.border = p.isActive ? "1px solid var(--accent)" : "1px solid var(--border)";
        card.innerHTML = '<div style="font-size: 20px;">' + p.icon + ' <strong>' + p.name + '</strong></div>' +
          '<div style="font-size: 12px; color: var(--text-muted); margin: 6px 0;">' + p.description + '</div>' +
          '<button class="btn" style="width: 100%; margin-top: 8px;">' + (p.isActive ? "Active" : "Switch") + '</button>';
        card.onclick = () => switchPreset(p.id);
        grid.appendChild(card);
      });
    }

    async function switchPreset(id) {
      await fetch("/api/presets/switch", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ preset: id })
      });
      loadPresets();
    }

    async function loadAccounts() {
      const res = await fetch("/api/accounts", { headers: getAuthHeaders() });
      const data = await res.json();
      const container = document.getElementById("accountsSlots");
      container.innerHTML = "";
      (data.accounts || []).forEach(a => {
        const d = document.createElement("div");
        d.className = "card";
        d.style.flex = "1";
        d.style.textAlign = "center";
        d.style.border = (a.slot === data.activeSlot) ? "1px solid var(--green)" : "1px solid var(--border)";
        d.innerHTML = '<div style="font-size: 24px;">👤</div><strong>Slot ' + a.slot + '</strong><br><span style="font-size: 12px; color: var(--text-muted);">' + (a.email || "Active") + '</span>';
        container.appendChild(d);
      });
    }

    async function rotateAccount() {
      await fetch("/api/accounts/rotate", { method: "POST", headers: getAuthHeaders() });
      loadAccounts();
    }

    async function loadTree() {
      const res = await fetch("/api/fs/tree", { headers: getAuthHeaders() });
      const data = await res.json();
      const treeBox = document.getElementById("fileTree");
      treeBox.innerHTML = "";
      function renderNodes(nodes, el) {
        nodes.forEach(n => {
          const item = document.createElement("div");
          item.style.padding = "2px 0";
          item.style.cursor = "pointer";
          item.textContent = (n.isDir ? "📁 " : "📄 ") + n.name;
          if (n.isDir && n.children) {
            const sub = document.createElement("div");
            sub.style.paddingLeft = "14px";
            renderNodes(n.children, sub);
            item.appendChild(sub);
          } else if (!n.isDir) {
            item.onclick = (e) => { e.stopPropagation(); openFile(n.path); };
          }
          el.appendChild(item);
        });
      }
      renderNodes(data.tree || [], treeBox);
    }

    async function openFile(relPath) {
      currentOpenPath = relPath;
      document.getElementById("activeFilePath").textContent = relPath;
      const res = await fetch("/api/fs/read?path=" + encodeURIComponent(relPath), { headers: getAuthHeaders() });
      const data = await res.json();
      document.getElementById("fileEditor").value = data.content || "";
    }

    async function saveActiveFile() {
      if (!currentOpenPath) return;
      const content = document.getElementById("fileEditor").value;
      await fetch("/api/fs/write", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ path: currentOpenPath, content })
      });
      alert("File saved: " + currentOpenPath);
    }

    async function loadGitDiff() {
      const res = await fetch("/api/git/diff", { headers: getAuthHeaders() });
      const data = await res.json();
      document.getElementById("activeFilePath").textContent = "Git Diff (Working Tree)";
      document.getElementById("fileEditor").value = (data.status ? "--- STATUS ---\\n" + data.status + "\\n\\n" : "") + data.diff;
    }

    function initTerminal() {
      if (wsTerm) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = protocol + "//" + location.host + "/ws/terminal?pin=" + activePin;
      wsTerm = new WebSocket(url);
      const screen = document.getElementById("terminalScreen");
      wsTerm.onopen = () => {
        document.getElementById("termStatus").textContent = "Connected";
        wsTerm.send(JSON.stringify({ type: "resize", cols: 120, rows: 30 }));
      };
      wsTerm.onmessage = (e) => {
        screen.textContent += e.data;
        screen.scrollTop = screen.scrollHeight;
      };
      wsTerm.onclose = () => {
        document.getElementById("termStatus").textContent = "Disconnected";
        wsTerm = null;
      };
    }

    function sendTermCommand() {
      const inp = document.getElementById("termInput");
      const cmd = inp.value;
      if (!wsTerm || wsTerm.readyState !== WebSocket.OPEN) return;
      wsTerm.send(cmd + "\\r\\n");
      inp.value = "";
    }

    async function loadLogs(type) {
      const res = await fetch("/api/logs?type=" + type, { headers: getAuthHeaders() });
      const data = await res.json();
      document.getElementById("logsOutput").textContent = data.content || "";
    }

    checkAuth();
  </script>
</body>
</html>`;
    }
}

// -----------------------------------------------------------------------------
// CLI Argument Parsing & Direct Execution
// -----------------------------------------------------------------------------
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--host" && i + 1 < args.length) {
            options.host = args[++i];
        } else if ((arg === "--port" || arg === "-p") && i + 1 < args.length) {
            options.port = parseInt(args[++i], 10);
        } else if (arg === "--pin" && i + 1 < args.length) {
            options.pin = args[++i];
        } else if ((arg === "--workspace" || arg === "-w") && i + 1 < args.length) {
            options.workspace = args[++i];
        }
    }
    return options;
}

if (require.main === module) {
    const opts = parseArgs();
    const dashboard = new ServerDashboard(opts);
    dashboard.start().catch((err) => {
        console.error("Fatal: failed to start dashboard server:", err);
        process.exit(1);
    });

    const shutdown = async () => {
        console.log("\nInitiating graceful shutdown...");
        await dashboard.stop();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

module.exports = {
    ServerDashboard,
    RawWebSocket,
    mapToAntigravityModel,
    getLanguageServerSession,
    lsRpcRequest,
    scanFsTree,
    getMimeType,
    getAllPresets,
    getActivePreset,
    applyPreset,
    getAccountSlotsStatus,
    rotateAccountSlot,
    toggleAutoFailover,
    VERSION
};
