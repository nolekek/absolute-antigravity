#!/usr/bin/env node
/**
 * ==============================================================================
 * Absolute Antigravity: Standalone Server Web Dashboard & UI Architect (v3.0)
 * ==============================================================================
 *
 * Full-featured remote management dashboard for Google Antigravity & agy core.
 * Allows managing development on a remote Linux/Unix/Windows server from any
 * device (mobile phone or desktop browser) worldwide.
 *
 * Capabilities:
 *   1. Presets & Skills Management (16 presets, overlays, skills search)
 *   2. Multi-Account Carousel & Slots (status, rotation, quotas, failover)
 *   3. Interactive SSE Streaming Chat with Gemini (live markdown, slots, presets)
 *   4. Workspaces & Projects (.agy/config.json inspection, project init)
 *   5. Web Console / Terminal (executes agy CLI and dev commands with stdout/stderr)
 *   6. Session Logs & Brain Artifacts Explorer (live logs and rendered markdown)
 *
 * Security:
 *   - 6-digit PIN code authentication (x-agy-pin or Authorization: Bearer <pin>)
 *   - Brute-Force Rate Limiting (5 failed attempts -> 15 min IP lockout)
 *   - Zero external npm/CDN dependencies (100% offline & self-contained)
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
const { spawn, exec, execFileSync } = require("child_process");

// -----------------------------------------------------------------------------
// Constants & Paths
// -----------------------------------------------------------------------------
const VERSION = "3.0.0";
const USER_HOME = os.homedir() || process.env.USERPROFILE || process.env.HOME || "";
const GEMINI_DIR = path.join(USER_HOME, ".gemini");
const ANTIGRAVITY_DIR = path.join(GEMINI_DIR, "antigravity");
const BRAIN_DIR = path.join(ANTIGRAVITY_DIR, "brain");
const CONFIG_VAULT_PATH = path.join(GEMINI_DIR, "credentials_vault.json");
const MULTIACC_CONFIG_PATH = path.join(GEMINI_DIR, "antigravity_multiacc.json");
const SERVER_CONFIG_PATH = path.join(GEMINI_DIR, "antigravity_server_config.json");

// -----------------------------------------------------------------------------
// Activity Log Buffer (In-Memory Ring Buffer for Dashboard Activity)
// -----------------------------------------------------------------------------
const ACTIVITY_LOGS = [];
const MAX_ACTIVITY_LOGS = 300;

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
// Cryptographic PIN & Configuration
// -----------------------------------------------------------------------------
function generateSecurePin() {
    return String(crypto.randomInt(100000, 1000000));
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
// CLI Binary & Tool Resolvers
// -----------------------------------------------------------------------------
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

function applyPreset(presetName, overlays = [], targetWorkspace = null) {
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
                args.push("-w", targetWorkspace);
            }
            const out = execFileSync(agyBin, args, {
                encoding: "utf-8",
                timeout: 5000,
                windowsHide: true,
                cwd: targetWorkspace || process.cwd()
            });
            return { ok: true, method: "agy-cli", output: out.trim() };
        } catch (err) {
            logActivity("warn", "Preset", `agy CLI switch failed: ${err.message}, trying fallback`);
        }
    }

    try {
        const smPath = path.join(__dirname, "..", "skillManager.js");
        if (fs.existsSync(smPath)) {
            const { skillManager } = require(smPath);
            const res = skillManager.applyPresetByName(presetName, targetWorkspace || process.cwd());
            return { ok: res.success, method: "skillManager", result: res };
        }
    } catch (e) {
        return { ok: false, error: e.message };
    }
    return { ok: true, method: "memory", preset: presetName };
}

// -----------------------------------------------------------------------------
// Account Slots & Credentials Resolver
// -----------------------------------------------------------------------------
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

    // Direct read from ~/.gemini/credentials_vault.json
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

    const pythonCmd = getPythonPath();
    const helperPath = getCredHelperPath();
    if (helperPath) {
        try {
            const out = execFileSync(pythonCmd, [helperPath, "conversations"], {
                encoding: "utf-8",
                timeout: 3000,
                windowsHide: true
            });
            const data = JSON.parse(out);
            if (Array.isArray(data.workspaces)) {
                for (const w of data.workspaces) {
                    if (w.path && fs.existsSync(w.path)) {
                        const norm = path.resolve(w.path);
                        if (!wsMap.has(norm)) {
                            wsMap.set(norm, {
                                path: norm,
                                name: w.name || path.basename(norm),
                                count: w.count || 1,
                                isCurrent: norm === path.resolve(currentWs)
                            });
                        }
                    }
                }
            }
        } catch (_) {}
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
        } catch (err) {
            logActivity("warn", "Workspace", `agy project init failed: ${err.message}, writing directly`);
        }
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

// -----------------------------------------------------------------------------
// Daemon Status Check
// -----------------------------------------------------------------------------
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
        this.activeSessions = new Set();
        this.initPin();
    }

    initPin() {
        if (!this.pin) {
            if (fs.existsSync(SERVER_CONFIG_PATH)) {
                try {
                    const cfg = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, "utf-8"));
                    if (cfg.pin && /^\d{6}$/.test(String(cfg.pin).trim())) {
                        this.pin = String(cfg.pin).trim();
                    }
                } catch (_) {}
            }
        }
        if (!this.pin || !/^\d{6}$/.test(String(this.pin).trim())) {
            this.pin = generateSecurePin();
            try {
                fs.mkdirSync(path.dirname(SERVER_CONFIG_PATH), { recursive: true });
                fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify({ pin: this.pin, port: this.port }, null, 2), "utf-8");
            } catch (_) {}
        }
    }

    printBanner() {
        const lanIp = getPrimaryLanIp();
        const line = "=".repeat(72);
        console.log("\n" + line);
        console.log("  🚀 ABSOLUTE ANTIGRAVITY - SERVER WEB DASHBOARD & UI (v" + VERSION + ")");
        console.log("  Headless Remote Development Gateway for Mobile & Desktop");
        console.log(line);
        console.log("  ╔════════════════════════════════════════════════════════════════════╗");
        console.log(`  ║  🔑 ACCESS PIN CODE:  \x1b[1m\x1b[32m${this.pin}\x1b[0m                                      ║`);
        console.log("  ╚════════════════════════════════════════════════════════════════════╝");
        console.log("  Enter this 6-digit PIN in your browser to unlock dashboard controls.\n");
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

    checkAuth(req) {
        const authHeader = req.headers["authorization"]
            ? req.headers["authorization"].replace(/^Bearer\s+/i, "")
            : null;
        const candidate = req.headers["x-agy-pin"] || req.headers["x-dashboard-pin"] || authHeader;
        if (candidate && String(candidate).trim() === String(this.pin).trim()) {
            return true;
        }

        // Check query parameter (useful for EventSource / SSE if needed)
        try {
            const parsed = new URL(req.url, "http://127.0.0.1");
            const qPin = parsed.searchParams.get("pin") || parsed.searchParams.get("token");
            if (qPin && String(qPin).trim() === String(this.pin).trim()) {
                return true;
            }
        } catch (_) {}

        return false;
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));

            this.server.on("error", (err) => {
                logActivity("error", "Server", `Failed to bind ${this.host}:${this.port}: ${err.message}`);
                reject(err);
            });

            this.server.listen(this.port, this.host, () => {
                this.printBanner();
                logActivity("info", "Server", `Listening on http://${this.host}:${this.port}`);
                try {
                    const pidDir = path.join(USER_HOME, ".gemini", "antigravity");
                    fs.mkdirSync(pidDir, { recursive: true });
                    fs.writeFileSync(path.join(pidDir, "web.pid"), String(process.pid), "utf-8");
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
                        const pidFile = path.join(USER_HOME, ".gemini", "antigravity", "web.pid");
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

    handleRequest(req, res) {
        const clientIp = getClientIp(req);
        const parsedUrl = new URL(req.url, "http://127.0.0.1");
        const pathname = parsedUrl.pathname;

        // CORS & Security Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-agy-pin, Authorization");
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
        // Public UI SPA Endpoints
        // ---------------------------------------------------------------------
        if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
            sendHtml(this.renderHtml());
            return;
        }

        if (req.method === "GET" && pathname === "/favicon.ico") {
            res.writeHead(204);
            res.end();
            return;
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
                        const token = crypto.createHmac("sha256", this.pin).update(`${clientIp}:${Date.now()}`).digest("hex");
                        this.activeSessions.add(token);
                        logActivity("info", "Auth", `Successful authentication from IP ${clientIp}`);
                        sendJson(200, {
                            ok: true,
                            user: "admin",
                            token,
                            pin: this.pin,
                            expiresIn: 86400
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
        // Guard all /api/* endpoints with Rate-Limit & PIN
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
                    sendJson(401, { ok: false, error: "Требуется авторизация (PIN-код)" });
                }
                return;
            } else {
                recordAuthSuccess(clientIp);
            }
        }

        // ---------------------------------------------------------------------
        // GET /api/state - Complete System & Gateway Status
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/state") {
            const slotsData = getAccountSlotsStatus();
            const activePreset = getActivePreset(this.workspace);
            const presets = getAllPresets();
            const wsInfo = inspectWorkspace(this.workspace);
            const daemon = getDaemonStatus();

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
                daemon
            });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/presets - All 16 Presets & Skills Catalog
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
        // POST /api/switch-preset - Switch Preset & Apply Overlays
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/switch-preset") {
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
        // GET /api/slots - Multi-Account Status
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/slots") {
            const data = getAccountSlotsStatus();
            sendJson(200, data);
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/switch-slot - Rotate or Bind Slot
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/switch-slot") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const targetSlot = data.slot ? Number(data.slot) : null;
                    const resRotate = rotateAccountSlot(targetSlot);
                    const updated = getAccountSlotsStatus();
                    logActivity("info", "Accounts", `Account rotated to slot ${targetSlot || "next"}`);
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
        // GET /api/workspaces - Recent & Available Projects
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/workspaces") {
            const list = getRecentWorkspaces(this.workspace);
            const currentInfo = inspectWorkspace(this.workspace);
            sendJson(200, { ok: true, current: currentInfo, workspaces: list });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/workspaces/select - Change Active Workspace
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
        // POST /api/workspaces/init - Initialize Project (.agy/config.json)
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
                    logActivity("info", "Workspace", `Project init in ${targetWs} (Slot: ${data.slot}, Preset: ${data.preset})`);
                    sendJson(200, { ok: true, result: resInit, workspace: inspectWorkspace(targetWs) });
                } catch (e) {
                    sendJson(500, { ok: false, error: e.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/chat/stream - Server-Sent Events (SSE) Streaming Chat
        // ---------------------------------------------------------------------
        if (req.method === "POST" && pathname === "/api/chat/stream") {
            let body = "";
            req.on("data", c => { body += c; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body || "{}");
                    const prompt = data.prompt;
                    if (!prompt || !prompt.trim()) {
                        sendJson(400, { ok: false, error: "Prompt is required" });
                        return;
                    }

                    const slot = data.slot || null;
                    const preset = data.preset || getActivePreset(this.workspace);
                    const model = data.model || "gemini-2.0-flash";
                    const ws = data.workspace ? path.resolve(data.workspace) : this.workspace;

                    res.writeHead(200, {
                        "Content-Type": "text/event-stream; charset=utf-8",
                        "Cache-Control": "no-cache, no-transform",
                        "Connection": "keep-alive",
                        "Access-Control-Allow-Origin": "*",
                        "X-Accel-Buffering": "no"
                    });

                    const agyBin = getAgyCliPath();
                    let child = null;

                    if (agyBin) {
                        const args = ["exec", prompt];
                        if (slot) args.push("-s", String(slot));
                        if (preset) args.push("-p", String(preset));
                        if (model) args.push("-m", String(model));

                        logActivity("info", "ChatStream", `Spawning: agy exec in ${ws}`);
                        child = spawn(agyBin, args, {
                            cwd: ws,
                            windowsHide: true,
                            env: { ...process.env, PYTHONUNBUFFERED: "1" }
                        });

                        let accumulated = "";

                        child.stdout.on("data", (chunk) => {
                            const str = chunk.toString();
                            accumulated += str;
                            res.write(`data: ${JSON.stringify({ type: "chunk", text: str })}\n\n`);
                        });

                        child.stderr.on("data", (chunk) => {
                            const errStr = chunk.toString();
                            res.write(`data: ${JSON.stringify({ type: "stderr", text: errStr })}\n\n`);
                        });

                        child.on("close", (code) => {
                            res.write(`data: ${JSON.stringify({ type: "done", fullText: accumulated, exitCode: code })}\n\n`);
                            res.end();
                        });

                        child.on("error", (err) => {
                            res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
                            res.end();
                        });

                        req.on("close", () => {
                            if (child) {
                                try { child.kill(); } catch (_) {}
                            }
                        });
                    } else {
                        // Simulated streaming fallback when agy CLI binary is compiling or absent
                        const fallbackMsg = `[Antigravity Headless Server]\n` +
                            `Запрос принят к выполнению на сервере.\n` +
                            `Пресет: ${preset} | Модель: ${model} | Слот: ${slot || "Auto"}\n` +
                            `Воркспейс: ${ws}\n\n` +
                            `Для полноценной генерации убедитесь, что бинарник ядра agy скомпилирован (agy 3.0.0).`;

                        let idx = 0;
                        const interval = setInterval(() => {
                            if (idx < fallbackMsg.length) {
                                const slice = fallbackMsg.slice(idx, idx + 8);
                                idx += 8;
                                res.write(`data: ${JSON.stringify({ type: "chunk", text: slice })}\n\n`);
                            } else {
                                clearInterval(interval);
                                res.write(`data: ${JSON.stringify({ type: "done", fullText: fallbackMsg })}\n\n`);
                                res.end();
                            }
                        }, 25);

                        req.on("close", () => clearInterval(interval));
                    }
                } catch (err) {
                    sendJson(500, { ok: false, error: err.message });
                }
            });
            return;
        }

        // ---------------------------------------------------------------------
        // POST /api/terminal/exec - Interactive Console Command Runner
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
        // GET /api/logs - Real-time Logs Viewer
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/logs") {
            const type = parsedUrl.searchParams.get("type") || "server_dashboard";
            const lines = parsedUrl.searchParams.get("lines") || "100";
            const resLogs = getLogs(type, lines, this.workspace);
            sendJson(200, resLogs);
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/artifacts - Brain Artifacts (.md files)
        // ---------------------------------------------------------------------
        if (req.method === "GET" && pathname === "/api/artifacts") {
            const cid = parsedUrl.searchParams.get("cid") || null;
            const artifacts = getArtifactsList(cid);
            sendJson(200, { ok: true, count: artifacts.length, artifacts });
            return;
        }

        // ---------------------------------------------------------------------
        // GET /api/artifact-content - View Specific Artifact Markdown
        // ---------------------------------------------------------------------
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
    // Frontend UI (Single Page Application - Complete Responsive Dark Client)
    // -------------------------------------------------------------------------
    renderHtml() {
        return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Absolute Antigravity | Server Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#090d16">
  <style>
    :root {
      --bg: #090d16;
      --bg-card: #131822;
      --bg-hover: #1a2230;
      --border: rgba(255, 255, 255, 0.09);
      --border-focus: #58a6ff;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #2ea043;
      --orange: #f0883e;
      --purple: #bc8cff;
      --red: #f85149;
      --radius: 12px;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      padding-bottom: 74px;
    }
    /* Top Header */
    header {
      background: rgba(19, 24, 34, 0.88);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 1px solid var(--border);
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: -0.2px;
    }
    .brand-logo {
      width: 26px;
      height: 26px;
      background: linear-gradient(135deg, #1f6feb, #8957e5);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 12px rgba(31, 111, 235, 0.5);
    }
    .header-pills {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pill {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      font-size: 11px;
      padding: 4px 9px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      color: var(--text);
      font-weight: 500;
    }
    .pill:hover { background: var(--bg-hover); }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: pulseDot 2s infinite ease-in-out;
    }
    .status-dot.offline { background: var(--red); box-shadow: 0 0 8px var(--red); animation: none; }
    @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Desktop Tab Bar */
    .desktop-tabs {
      display: none;
      gap: 6px;
    }
    @media (min-width: 820px) {
      .desktop-tabs { display: flex; }
      body { padding-bottom: 20px; }
      .nav-bar { display: none !important; }
    }
    .d-tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .d-tab-btn:hover { color: var(--text); background: var(--bg-hover); }
    .d-tab-btn.active { color: var(--accent); background: rgba(88, 166, 255, 0.12); border: 1px solid rgba(88, 166, 255, 0.25); }

    /* Mobile Bottom Navigation Bar */
    .nav-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(19, 24, 34, 0.94);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-top: 1px solid var(--border);
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
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
      padding: 4px 0;
      transition: all 0.15s ease;
    }
    .nav-item .nav-icon { font-size: 18px; margin-bottom: 2px; }
    .nav-item.active { color: var(--accent); }

    /* Tab Containers */
    .tab-content {
      display: none;
      flex-direction: column;
      flex: 1;
      width: 100%;
      max-width: 960px;
      margin: 0 auto;
      padding: 14px 16px;
      animation: fadeIn 0.15s ease-out;
    }
    .tab-content.active { display: flex; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* Cards */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 14px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    .card-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Common Buttons & Inputs */
    .btn {
      background: var(--bg-hover);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn:hover { background: rgba(255, 255, 255, 0.1); }
    .btn-primary { background: linear-gradient(135deg, #1f6feb, #1158c7); border: none; color: #fff; box-shadow: 0 2px 8px rgba(31, 111, 235, 0.35); }
    .btn-primary:hover { opacity: 0.95; }
    .btn-success { background: linear-gradient(135deg, #238636, #196c2e); border: none; color: #fff; }
    .btn-danger { background: #da3633; border: none; color: #fff; }
    .input {
      background: #090d16;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      width: 100%;
    }
    .input:focus { border-color: var(--border-focus); }

    /* Tab 1: Chat */
    .chat-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
      min-height: 380px;
      max-height: calc(100vh - 240px);
      overflow-y: auto;
      padding: 4px;
      margin-bottom: 12px;
    }
    .chat-msg {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.6;
      word-break: break-word;
      max-width: 90%;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #1f6feb, #135ac5);
      color: #fff;
      border-bottom-right-radius: 2px;
    }
    .chat-msg.assistant {
      align-self: flex-start;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-bottom-left-radius: 2px;
    }
    .chat-msg pre {
      background: #090d16;
      padding: 10px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      position: relative;
      font-family: var(--font-mono);
      font-size: 12px;
      border: 1px solid var(--border);
    }
    .chat-msg code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 4px;
      border-radius: 4px;
    }
    .chat-prompt-chips {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .chip {
      background: var(--bg-hover);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 16px;
      white-space: nowrap;
      cursor: pointer;
    }
    .chip:hover { color: var(--text); border-color: var(--accent); }
    .chat-bar {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .chat-textarea {
      flex: 1;
      min-height: 42px;
      max-height: 140px;
      resize: none;
      padding: 10px 12px;
      border-radius: 10px;
    }

    /* Tab 2: Presets Grid */
    .presets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .preset-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.15s ease;
    }
    .preset-card:hover { border-color: rgba(88, 166, 255, 0.4); transform: translateY(-2px); }
    .preset-card.active { border-color: var(--accent); background: rgba(88, 166, 255, 0.05); }
    .preset-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .preset-name { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .preset-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; margin-bottom: 12px; flex: 1; }

    /* Tab 3: Accounts Grid */
    .slots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .slot-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      position: relative;
    }
    .slot-card.active { border-color: var(--green); box-shadow: 0 0 12px rgba(46, 160, 67, 0.2); }
    .slot-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 700;
    }
    .slot-badge.active { background: rgba(46, 160, 67, 0.2); color: var(--green); border: 1px solid var(--green); }
    .slot-badge.standby { background: rgba(255, 255, 255, 0.08); color: var(--text-muted); }

    /* Tab 5: Terminal */
    .terminal-window {
      background: #040609;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      min-height: 320px;
      max-height: 480px;
      overflow-y: auto;
      color: #7ee787;
      white-space: pre-wrap;
      line-height: 1.5;
      margin-bottom: 10px;
    }

    /* Modal / Lock Screen */
    .lock-screen {
      position: fixed;
      inset: 0;
      background: rgba(9, 13, 22, 0.95);
      backdrop-filter: blur(24px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .lock-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px 24px;
      width: 100%;
      max-width: 340px;
      text-align: center;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    }
    .keypad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 16px;
    }
    .keypad-btn {
      background: var(--bg-hover);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 20px;
      font-weight: 600;
      height: 52px;
      border-radius: 10px;
      cursor: pointer;
    }
    .keypad-btn:active { background: rgba(255, 255, 255, 0.15); }
    .pin-dots {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin: 16px 0;
    }
    .pin-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid var(--border);
    }
    .pin-dot.filled { background: var(--accent); border-color: var(--accent); }
    .shake { animation: shake 0.3s ease-in-out; }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-8px); }
      40%, 80% { transform: translateX(8px); }
    }
  </style>
</head>
<body>

  <!-- Top App Header -->
  <header>
    <div class="brand">
      <div class="brand-logo">🌌</div>
      <div>
        <span>Antigravity</span>
        <span style="font-size:10px; color:var(--text-muted); font-weight:normal; margin-left:4px;">Server v3</span>
      </div>
    </div>

    <!-- Desktop Navigation Tabs -->
    <div class="desktop-tabs">
      <button class="d-tab-btn active" onclick="switchTab('chat')">💬 Чат</button>
      <button class="d-tab-btn" onclick="switchTab('presets')">🎯 Пресеты</button>
      <button class="d-tab-btn" onclick="switchTab('accounts')">👥 Аккаунты</button>
      <button class="d-tab-btn" onclick="switchTab('workspaces')">📁 Воркспейсы</button>
      <button class="d-tab-btn" onclick="switchTab('terminal')">💻 Консоль</button>
      <button class="d-tab-btn" onclick="switchTab('logs')">📜 Логи & Docs</button>
    </div>

    <!-- Right Quick Status Pills -->
    <div class="header-pills">
      <div class="pill" id="slotPill" onclick="switchTab('accounts')" title="Активный слот">
        <span>👤</span> <span id="slotPillText">Слот 1</span>
      </div>
      <div class="pill" id="presetPill" onclick="switchTab('presets')" title="Активный пресет">
        <span id="presetPillIcon">🎭</span> <span id="presetPillText">orchestrator</span>
      </div>
      <div class="pill" onclick="logout()" title="Заблокировать">
        <div class="status-dot" id="connDot"></div>
        <span>🔒</span>
      </div>
    </div>
  </header>

  <!-- TAB 1: 💬 AGENT CHAT -->
  <main class="tab-content active" id="tab-chat">
    <div class="card" style="margin-bottom:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; gap:10px; align-items:center;">
        <select class="input" id="chatModel" style="width:auto; padding:4px 8px; font-size:12px;">
          <option value="gemini-2.0-flash">⚡ gemini-2.0-flash</option>
          <option value="gemini-2.5-pro">🧠 gemini-2.5-pro</option>
          <option value="gemini-2.0-flash-thinking-exp">🔬 flash-thinking</option>
        </select>
        <span style="font-size:12px; color:var(--text-muted);" id="chatWsInfo">📁 ...</span>
      </div>
      <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="clearChat()">🗑️ Очистить</button>
    </div>

    <div class="chat-container" id="chatBox">
      <div class="chat-msg assistant">
        👋 Привет! Я — Google Antigravity Headless Server. Управляй проектом, пресетами и генерацией напрямую с сервера.
      </div>
    </div>

    <div class="chat-prompt-chips">
      <div class="chip" onclick="quickPrompt('Проведи полный аудит безопасности и архитектуры текущего проекта')">🛡️ Аудит безопасности</div>
      <div class="chip" onclick="quickPrompt('Оптимизируй производительность и использование памяти')">⚡ Оптимизация памяти</div>
      <div class="chip" onclick="quickPrompt('Напиши модульные и интеграционные тесты для измененных файлов')">🧪 Написать тесты</div>
      <div class="chip" onclick="quickPrompt('Объясни модель владения и жизненных циклов в Rust')">🦀 Rust Ownership</div>
    </div>

    <div class="chat-bar">
      <textarea class="input chat-textarea" id="chatInput" placeholder="Введите задачу для Gemini (Enter - отправить, Shift+Enter - строка)..." onkeydown="handleChatKey(event)"></textarea>
      <button class="btn btn-primary" id="chatSendBtn" style="height:42px; width:48px; justify-content:center;" onclick="sendChatMessage()">➤</button>
      <button class="btn btn-danger" id="chatStopBtn" style="height:42px; display:none;" onclick="stopChatStream()">⏹</button>
    </div>
  </main>

  <!-- TAB 2: 🎯 PRESETS -->
  <main class="tab-content" id="tab-presets">
    <div class="card">
      <div class="card-title">
        <span>Активный пресет проекта</span>
        <span class="pill" id="activePresetBadge" style="color:var(--accent);">🎭 orchestrator</span>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">
        Выберите пресет для загрузки специализированного набора навыков и системного контекста в текущий воркспейс.
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <input type="text" class="input" id="presetSearch" placeholder="🔍 Поиск пресетов и навыков..." oninput="filterPresets()" style="max-width:320px;">
        <div style="display:flex; gap:6px; flex-wrap:wrap;" id="overlayChips">
          <span class="chip" onclick="toggleOverlay(this, '+qa')">+qa</span>
          <span class="chip" onclick="toggleOverlay(this, '+devops')">+devops</span>
          <span class="chip" onclick="toggleOverlay(this, '+docker')">+docker</span>
        </div>
      </div>
    </div>

    <div class="presets-grid" id="presetsList">
      <!-- Generated via JS -->
    </div>
  </main>

  <!-- TAB 3: 👥 ACCOUNTS -->
  <main class="tab-content" id="tab-accounts">
    <div class="card">
      <div class="card-title">
        <span>Карусель Google аккаунтов (Multi-Account Carousel)</span>
        <button class="btn btn-primary" onclick="rotateSlot()">🔄 Ротация слота</button>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
        Автономный пул учетных записей Antigravity с защитой от 429 ResourceExhausted и ротацией токенов.
      </p>
      <div class="slots-grid" id="slotsContainer">
        <!-- Generated via JS -->
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:12px;">
        <span style="font-size:13px;">Автоматический переход при 429 (Auto-Failover):</span>
        <button class="btn" id="btnToggleFailover" onclick="toggleFailover()">Включен (ON)</button>
      </div>
    </div>
  </main>

  <!-- TAB 4: 📁 WORKSPACES -->
  <main class="tab-content" id="tab-workspaces">
    <div class="card">
      <div class="card-title">Текущий воркспейс на сервере</div>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <input type="text" class="input" id="currentWsInput" style="font-family:var(--font-mono); font-size:12px;">
        <button class="btn btn-primary" onclick="selectWorkspace()">Сменить</button>
      </div>
      <div id="wsInspectionInfo" style="font-size:12px; color:var(--text-muted);">Проверка...</div>
    </div>

    <div class="card">
      <div class="card-title">Инициализация проекта (.agy/config.json)</div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">
        Привяжите слот аккаунта и профиль пресета к директории (команда agy project init).
      </p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div>
          <label style="font-size:11px; color:var(--text-muted);">Привязать слот:</label>
          <select class="input" id="initSlotSelect">
            <option value="1">Слот 1</option>
            <option value="2">Слот 2</option>
            <option value="3">Слот 3</option>
            <option value="4">Слот 4</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px; color:var(--text-muted);">Базовый пресет:</label>
          <select class="input" id="initPresetSelect"></select>
        </div>
      </div>
      <button class="btn btn-success" onclick="initProject()">🚀 Инициализировать проект (agy project init)</button>
    </div>

    <div class="card">
      <div class="card-title">Недавние проекты на сервере</div>
      <div id="recentWorkspacesList" style="display:flex; flex-direction:column; gap:6px;">
        <!-- Recent paths -->
      </div>
    </div>
  </main>

  <!-- TAB 5: 💻 WEB CONSOLE -->
  <main class="tab-content" id="tab-terminal">
    <div class="card" style="padding:10px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="execCommand('agy preset current')">agy preset current</button>
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="execCommand('agy account status')">agy account status</button>
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="execCommand('agy daemon status')">agy daemon status</button>
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="execCommand('git status -s')">git status</button>
      </div>
      <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="clearTerminal()">Очистить</button>
    </div>

    <div class="terminal-window" id="terminalBox">Antigravity Web Console [v3.0.0]
Готов к выполнению CLI команд в контексте сервера.
</div>

    <div style="display:flex; gap:8px;">
      <input type="text" class="input" id="terminalInput" placeholder="Введите команду (например: agy preset switch web)..." onkeydown="handleTerminalKey(event)" style="font-family:var(--font-mono); font-size:12px;">
      <button class="btn btn-primary" onclick="runTerminalInput()">Выполнить</button>
    </div>
  </main>

  <!-- TAB 6: 📜 LOGS & DOCS -->
  <main class="tab-content" id="tab-logs">
    <div style="display:flex; gap:10px; margin-bottom:12px;">
      <button class="btn btn-primary" id="btnSubLogs" onclick="switchLogsSubTab('logs')">📋 Системные логи</button>
      <button class="btn" id="btnSubDocs" onclick="switchLogsSubTab('docs')">📖 Артефакты Brain (.md)</button>
    </div>

    <!-- Logs Subview -->
    <div id="subViewLogs">
      <div class="card" style="padding:10px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; gap:10px; align-items:center;">
          <select class="input" id="logTypeSelect" onchange="fetchLogs()" style="width:auto; padding:4px 8px; font-size:12px;">
            <option value="server_dashboard">server_dashboard</option>
            <option value="daemon">agy-daemon</option>
            <option value="language_server">language_server</option>
          </select>
          <label style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:4px;">
            <input type="checkbox" id="logAutoRefresh" onchange="toggleLogAutoRefresh()"> Авто-обновление (3s)
          </label>
        </div>
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="fetchLogs()">Обновить</button>
      </div>
      <div class="terminal-window" id="logsBox" style="color:#8b949e; min-height:420px;">Загрузка логов...</div>
    </div>

    <!-- Docs Subview -->
    <div id="subViewDocs" style="display:none;">
      <div class="card">
        <div class="card-title">Артефакты сессий Antigravity (.gemini/antigravity/brain)</div>
        <div id="artifactsList" style="display:flex; flex-direction:column; gap:6px; max-height:240px; overflow-y:auto; margin-bottom:14px;">
          Загрузка списка артефактов...
        </div>
        <div class="card-title" id="artifactTitle">Просмотр артефакта</div>
        <div id="artifactViewer" style="background:#090d16; border:1px solid var(--border); border-radius:8px; padding:14px; max-height:360px; overflow-y:auto; font-size:13px; line-height:1.6;">
          Выберите артефакт из списка выше.
        </div>
      </div>
    </div>
  </main>

  <!-- Mobile Bottom Navigation -->
  <nav class="nav-bar">
    <button class="nav-item active" onclick="switchTab('chat')">
      <span class="nav-icon">💬</span><span>Чат</span>
    </button>
    <button class="nav-item" onclick="switchTab('presets')">
      <span class="nav-icon">🎯</span><span>Пресеты</span>
    </button>
    <button class="nav-item" onclick="switchTab('accounts')">
      <span class="nav-icon">👥</span><span>Слоты</span>
    </button>
    <button class="nav-item" onclick="switchTab('workspaces')">
      <span class="nav-icon">📁</span><span>Проекты</span>
    </button>
    <button class="nav-item" onclick="switchTab('terminal')">
      <span class="nav-icon">💻</span><span>Консоль</span>
    </button>
    <button class="nav-item" onclick="switchTab('logs')">
      <span class="nav-icon">📜</span><span>Логи</span>
    </button>
  </nav>

  <!-- PIN Lock Screen Modal -->
  <div class="lock-screen" id="lockScreen" style="display:none;">
    <div class="lock-card" id="lockCard">
      <div style="font-size:32px; margin-bottom:8px;">🌌</div>
      <h2 style="font-size:18px; margin-bottom:4px;">Antigravity Server</h2>
      <p style="font-size:12px; color:var(--text-muted);">Введите 6-значный PIN-код для входа</p>

      <div class="pin-dots">
        <div class="pin-dot" id="dot-0"></div>
        <div class="pin-dot" id="dot-1"></div>
        <div class="pin-dot" id="dot-2"></div>
        <div class="pin-dot" id="dot-3"></div>
        <div class="pin-dot" id="dot-4"></div>
        <div class="pin-dot" id="dot-5"></div>
      </div>

      <div id="authErrorMsg" style="font-size:12px; color:var(--red); min-height:16px; margin-bottom:8px;"></div>

      <div class="keypad">
        <button class="keypad-btn" onclick="pressKey('1')">1</button>
        <button class="keypad-btn" onclick="pressKey('2')">2</button>
        <button class="keypad-btn" onclick="pressKey('3')">3</button>
        <button class="keypad-btn" onclick="pressKey('4')">4</button>
        <button class="keypad-btn" onclick="pressKey('5')">5</button>
        <button class="keypad-btn" onclick="pressKey('6')">6</button>
        <button class="keypad-btn" onclick="pressKey('7')">7</button>
        <button class="keypad-btn" onclick="pressKey('8')">8</button>
        <button class="keypad-btn" onclick="pressKey('9')">9</button>
        <button class="keypad-btn" style="font-size:14px;" onclick="clearPin()">C</button>
        <button class="keypad-btn" onclick="pressKey('0')">0</button>
        <button class="keypad-btn" style="font-size:16px;" onclick="backspacePin()">⌫</button>
      </div>
    </div>
  </div>

  <script>
    // -------------------------------------------------------------------------
    // Client Application Logic
    // -------------------------------------------------------------------------
    let currentPin = sessionStorage.getItem("agy_pin") || localStorage.getItem("agy_pin") || "";
    let enteredPin = "";
    let appState = null;
    let presetsCache = [];
    let selectedOverlays = new Set();
    let chatAbortController = null;
    let logAutoInterval = null;
    let cmdHistory = [];
    let cmdHistoryIdx = -1;

    // API Request Wrapper with Header Injection
    async function apiRequest(endpoint, options = {}) {
      options.headers = options.headers || {};
      if (currentPin) {
        options.headers["x-agy-pin"] = currentPin;
        options.headers["Authorization"] = "Bearer " + currentPin;
      }
      try {
        const res = await fetch(endpoint, options);
        if (res.status === 401) {
          showLockScreen("Требуется авторизация");
          throw new Error("Unauthorized");
        }
        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          showLockScreen(data.error || "IP заблокирован из-за неудачных попыток");
          throw new Error("RateLimited");
        }
        return await res.json();
      } catch (err) {
        document.getElementById("connDot").classList.add("offline");
        throw err;
      }
    }

    // Tab Navigation
    function switchTab(tabId) {
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".d-tab-btn").forEach(el => el.classList.remove("active"));

      const target = document.getElementById("tab-" + tabId);
      if (target) target.classList.add("active");

      const navBtns = document.querySelectorAll(".nav-item");
      const dBtns = document.querySelectorAll(".d-tab-btn");
      const mapping = ["chat", "presets", "accounts", "workspaces", "terminal", "logs"];
      const idx = mapping.indexOf(tabId);
      if (idx !== -1) {
        if (navBtns[idx]) navBtns[idx].classList.add("active");
        if (dBtns[idx]) dBtns[idx].classList.add("active");
      }

      if (tabId === "logs") fetchLogs();
      if (tabId === "workspaces") fetchWorkspaces();
    }

    // PIN Pad Interaction
    function showLockScreen(errMsg = "") {
      document.getElementById("lockScreen").style.display = "flex";
      document.getElementById("authErrorMsg").innerText = errMsg;
      enteredPin = "";
      updatePinDots();
    }

    function hideLockScreen() {
      document.getElementById("lockScreen").style.display = "none";
      document.getElementById("connDot").classList.remove("offline");
    }

    function updatePinDots() {
      for (let i = 0; i < 6; i++) {
        const dot = document.getElementById("dot-" + i);
        if (dot) dot.classList.toggle("filled", i < enteredPin.length);
      }
    }

    function pressKey(num) {
      if (enteredPin.length < 6) {
        enteredPin += num;
        updatePinDots();
        if (enteredPin.length === 6) {
          submitPin(enteredPin);
        }
      }
    }

    function backspacePin() {
      if (enteredPin.length > 0) {
        enteredPin = enteredPin.slice(0, -1);
        updatePinDots();
      }
    }

    function clearPin() {
      enteredPin = "";
      updatePinDots();
    }

    async function submitPin(pin) {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.ok) {
          currentPin = pin;
          sessionStorage.setItem("agy_pin", pin);
          localStorage.setItem("agy_pin", pin);
          hideLockScreen();
          initApp();
        } else {
          document.getElementById("lockCard").classList.add("shake");
          setTimeout(() => document.getElementById("lockCard").classList.remove("shake"), 300);
          document.getElementById("authErrorMsg").innerText = data.error || "Неверный PIN";
          enteredPin = "";
          updatePinDots();
        }
      } catch (e) {
        document.getElementById("authErrorMsg").innerText = "Ошибка соединения с сервером";
      }
    }

    function logout() {
      sessionStorage.removeItem("agy_pin");
      localStorage.removeItem("agy_pin");
      currentPin = "";
      showLockScreen("Сессия завершена");
    }

    // Global State Sync
    async function syncState() {
      try {
        const data = await apiRequest("/api/state");
        if (data.ok) {
          appState = data;
          document.getElementById("connDot").classList.remove("offline");
          document.getElementById("slotPillText").innerText = "Слот " + data.activeSlot;
          document.getElementById("presetPillText").innerText = data.activePreset;
          document.getElementById("presetPillIcon").innerText = data.activePresetDetails?.icon || "⚡";
          document.getElementById("activePresetBadge").innerText = (data.activePresetDetails?.icon || "⚡") + " " + data.activePreset;
          if (data.workspace?.name) {
            document.getElementById("chatWsInfo").innerText = "📁 " + data.workspace.name;
            document.getElementById("currentWsInput").value = data.workspace.path || "";
            document.getElementById("wsInspectionInfo").innerHTML =
              "Статус: " + (data.workspace.hasConfig ? "<span style='color:var(--green);'>Привязан (.agy/config.json)</span>" : "<span style='color:var(--orange);'>Не инициализирован</span>") +
              " | Активных навыков: " + (data.workspace.skillsCount || 0);
          }
          renderSlots(data);
        }
      } catch (_) {}
    }

    // Render Slots Tab
    function renderSlots(state) {
      const cont = document.getElementById("slotsContainer");
      if (!cont) return;
      const accounts = state.slots || [];
      cont.innerHTML = accounts.map(acc => {
        const isActive = acc.slot === state.activeSlot;
        return \`
          <div class="slot-card \${isActive ? 'active' : ''}">
            <span class="slot-badge \${isActive ? 'active' : 'standby'}">\${isActive ? 'ACTIVE' : 'STANDBY'}</span>
            <div style="font-size:18px; margin-bottom:6px;">👤 [Слот \${acc.slot}]</div>
            <div style="font-size:13px; font-weight:600; margin-bottom:8px; word-break:break-all;">\${acc.email || 'Account ' + acc.slot}</div>
            <button class="btn \${isActive ? 'btn-success' : ''}" style="width:100%; font-size:12px;" onclick="rotateSlot(\${acc.slot})">
              \${isActive ? '✔ Выбран' : 'Переключить на слот'}
            </button>
          </div>
        \`;
      }).join("");

      const btnFail = document.getElementById("btnToggleFailover");
      if (btnFail) {
        btnFail.innerText = state.autoFailover ? "Включен (ON)" : "Выключен (OFF)";
        btnFail.className = state.autoFailover ? "btn btn-success" : "btn";
      }
    }

    async function rotateSlot(targetSlot = null) {
      try {
        await apiRequest("/api/switch-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: targetSlot })
        });
        syncState();
      } catch (_) {}
    }

    async function toggleFailover() {
      try {
        await apiRequest("/api/toggle-autofailover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !appState?.autoFailover })
        });
        syncState();
      } catch (_) {}
    }

    // Presets Tab & Filtering
    async function loadPresets() {
      try {
        const data = await apiRequest("/api/presets");
        if (data.ok) {
          presetsCache = data.presets || [];
          renderPresets(presetsCache);
          const sel = document.getElementById("initPresetSelect");
          if (sel) {
            sel.innerHTML = presetsCache.map(p => \`<option value="\${p.id}">\${p.icon} \${p.name}</option>\`).join("");
          }
        }
      } catch (_) {}
    }

    function renderPresets(list) {
      const cont = document.getElementById("presetsList");
      if (!cont) return;
      cont.innerHTML = list.map(p => \`
        <div class="preset-card \${p.isActive ? 'active' : ''}">
          <div class="preset-header">
            <div class="preset-name">\${p.icon} \${p.name}</div>
            \${p.isActive ? '<span class="pill" style="color:var(--green); font-size:10px;">ACTIVE</span>' : ''}
          </div>
          <div class="preset-desc">\${p.description}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:10px;">🛠️ Навыков: \${p.skillsCount}</div>
          <button class="btn \${p.isActive ? 'btn-success' : 'btn-primary'}" style="width:100%; font-size:12px;" onclick="applyPresetClick('\${p.id}')">
            \${p.isActive ? '✔ Текущий пресет' : 'Применить пресет'}
          </button>
        </div>
      \`).join("");
    }

    function filterPresets() {
      const q = (document.getElementById("presetSearch").value || "").toLowerCase();
      const filtered = presetsCache.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.skills || []).some(s => s.toLowerCase().includes(q))
      );
      renderPresets(filtered);
    }

    function toggleOverlay(el, overlay) {
      if (selectedOverlays.has(overlay)) {
        selectedOverlays.delete(overlay);
        el.style.borderColor = "var(--border)";
        el.style.color = "var(--text-muted)";
      } else {
        selectedOverlays.add(overlay);
        el.style.borderColor = "var(--accent)";
        el.style.color = "var(--accent)";
      }
    }

    async function applyPresetClick(presetId) {
      try {
        const overlays = Array.from(selectedOverlays);
        const res = await apiRequest("/api/switch-preset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset: presetId, overlays })
        });
        if (res.ok) {
          syncState();
          loadPresets();
        }
      } catch (_) {}
    }

    // Workspaces Tab
    async function fetchWorkspaces() {
      try {
        const data = await apiRequest("/api/workspaces");
        if (data.ok) {
          const cont = document.getElementById("recentWorkspacesList");
          if (cont) {
            cont.innerHTML = (data.workspaces || []).map(w => \`
              <div style="background:var(--bg-hover); padding:8px 12px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-size:13px; font-weight:600;">\${w.name}</div>
                  <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">\${w.path}</div>
                </div>
                <button class="btn" style="font-size:11px; padding:4px 8px;" onclick="selectWorkspacePath('\${w.path.replace(/\\\\/g, '\\\\\\\\')}')">Открыть</button>
              </div>
            \`).join("");
          }
        }
      } catch (_) {}
    }

    async function selectWorkspace() {
      const pathVal = document.getElementById("currentWsInput").value;
      if (pathVal) selectWorkspacePath(pathVal);
    }

    async function selectWorkspacePath(pathVal) {
      try {
        await apiRequest("/api/workspaces/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: pathVal })
        });
        syncState();
        fetchWorkspaces();
      } catch (_) {}
    }

    async function initProject() {
      const slot = document.getElementById("initSlotSelect").value;
      const preset = document.getElementById("initPresetSelect").value;
      const ws = document.getElementById("currentWsInput").value;
      try {
        await apiRequest("/api/workspaces/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: ws, slot, preset })
        });
        syncState();
      } catch (_) {}
    }

    // Interactive Chat & SSE Streaming
    function appendChatMessage(role, text) {
      const box = document.getElementById("chatBox");
      const div = document.createElement("div");
      div.className = "chat-msg " + role;
      div.innerHTML = formatMarkdown(text);
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
      return div;
    }

    function quickPrompt(txt) {
      document.getElementById("chatInput").value = txt;
      sendChatMessage();
    }

    function handleChatKey(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    }

    function clearChat() {
      document.getElementById("chatBox").innerHTML = "";
    }

    async function sendChatMessage() {
      const inp = document.getElementById("chatInput");
      const txt = inp.value.trim();
      if (!txt) return;

      appendChatMessage("user", txt);
      inp.value = "";

      const sendBtn = document.getElementById("chatSendBtn");
      const stopBtn = document.getElementById("chatStopBtn");
      sendBtn.style.display = "none";
      stopBtn.style.display = "flex";

      const assistantMsg = appendChatMessage("assistant", "⏳ Подключение к Gemini на сервере...");
      let accumulated = "";

      chatAbortController = new AbortController();

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agy-pin": currentPin,
            "Authorization": "Bearer " + currentPin
          },
          body: JSON.stringify({
            prompt: txt,
            model: document.getElementById("chatModel").value,
            preset: appState?.activePreset,
            slot: appState?.activeSlot
          }),
          signal: chatAbortController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\\n\\n");
          buffer = parts.pop();

          for (const part of parts) {
            if (part.startsWith("data: ")) {
              try {
                const payload = JSON.parse(part.substring(6));
                if (payload.type === "chunk") {
                  accumulated += payload.text;
                  assistantMsg.innerHTML = formatMarkdown(accumulated) + '<span style="animation:pulseDot 1s infinite;">▋</span>';
                  document.getElementById("chatBox").scrollTop = document.getElementById("chatBox").scrollHeight;
                } else if (payload.type === "done") {
                  assistantMsg.innerHTML = formatMarkdown(payload.fullText || accumulated);
                } else if (payload.type === "error") {
                  assistantMsg.innerHTML = '<span style="color:var(--red);">' + payload.error + '</span>';
                }
              } catch (_) {}
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          assistantMsg.innerHTML = '<span style="color:var(--red);">Ошибка соединения: ' + err.message + '</span>';
        }
      } finally {
        sendBtn.style.display = "flex";
        stopBtn.style.display = "none";
        chatAbortController = null;
      }
    }

    function stopChatStream() {
      if (chatAbortController) {
        chatAbortController.abort();
      }
    }

    // Markdown Formatter (Pure JS, zero CDN dependency)
    function formatMarkdown(text) {
      if (!text) return "";
      let html = text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\`\`\`([a-z0-9_-]*)\n([\s\S]*?)\`\`\`/g, (m, lang, code) => {
          return '<pre><code>' + code.trim() + '</code></pre>';
        })
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/^### (.*$)/gim, '<h3 style="margin:8px 0 4px; font-size:14px;">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 style="margin:10px 0 6px; font-size:15px;">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 style="margin:12px 0 8px; font-size:16px;">$1</h1>')
        .replace(/^\- (.*$)/gim, '• $1<br>')
        .replace(/\n/g, '<br>');
      return html;
    }

    // Terminal Runner
    async function execCommand(cmd) {
      document.getElementById("terminalInput").value = cmd;
      runTerminalInput();
    }

    function handleTerminalKey(e) {
      if (e.key === "Enter") {
        runTerminalInput();
      } else if (e.key === "ArrowUp") {
        if (cmdHistoryIdx > 0) {
          cmdHistoryIdx--;
          document.getElementById("terminalInput").value = cmdHistory[cmdHistoryIdx] || "";
        }
      } else if (e.key === "ArrowDown") {
        if (cmdHistoryIdx < cmdHistory.length - 1) {
          cmdHistoryIdx++;
          document.getElementById("terminalInput").value = cmdHistory[cmdHistoryIdx] || "";
        } else {
          cmdHistoryIdx = cmdHistory.length;
          document.getElementById("terminalInput").value = "";
        }
      }
    }

    async function runTerminalInput() {
      const inp = document.getElementById("terminalInput");
      const cmd = inp.value.trim();
      if (!cmd) return;

      cmdHistory.push(cmd);
      cmdHistoryIdx = cmdHistory.length;
      inp.value = "";

      const box = document.getElementById("terminalBox");
      box.textContent += "\\n$ " + cmd + "\\n[Выполняется...]";
      box.scrollTop = box.scrollHeight;

      try {
        const res = await apiRequest("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd })
        });
        const out = (res.stdout || "") + (res.stderr ? "\\n" + res.stderr : "");
        box.textContent = box.textContent.replace("[Выполняется...]", out.trim() + \`\\n[Exit: \${res.exitCode} | \${res.durationMs}ms]\`);
        box.scrollTop = box.scrollHeight;
      } catch (err) {
        box.textContent = box.textContent.replace("[Выполняется...]", "Ошибка: " + err.message);
      }
    }

    function clearTerminal() {
      document.getElementById("terminalBox").textContent = "Antigravity Web Console [v3.0.0]\\n";
    }

    // Logs & Artifacts Tab
    function switchLogsSubTab(sub) {
      const isLogs = sub === "logs";
      document.getElementById("subViewLogs").style.display = isLogs ? "block" : "none";
      document.getElementById("subViewDocs").style.display = isLogs ? "none" : "block";
      document.getElementById("btnSubLogs").className = isLogs ? "btn btn-primary" : "btn";
      document.getElementById("btnSubDocs").className = !isLogs ? "btn btn-primary" : "btn";
      if (!isLogs) fetchArtifacts();
    }

    async function fetchLogs() {
      const type = document.getElementById("logTypeSelect").value;
      try {
        const data = await apiRequest("/api/logs?type=" + type + "&lines=120");
        if (data.ok) {
          const box = document.getElementById("logsBox");
          box.textContent = data.content || "Лог пуст";
          box.scrollTop = box.scrollHeight;
        }
      } catch (_) {}
    }

    function toggleLogAutoRefresh() {
      const checked = document.getElementById("logAutoRefresh").checked;
      if (checked) {
        logAutoInterval = setInterval(fetchLogs, 3000);
      } else {
        clearInterval(logAutoInterval);
        logAutoInterval = null;
      }
    }

    async function fetchArtifacts() {
      try {
        const data = await apiRequest("/api/artifacts");
        if (data.ok) {
          const cont = document.getElementById("artifactsList");
          if ((data.artifacts || []).length === 0) {
            cont.innerHTML = "<div style='font-size:12px; color:var(--text-muted);'>Нет сгенерированных артефактов в brain/.</div>";
            return;
          }
          cont.innerHTML = data.artifacts.map(a => \`
            <div style="background:var(--bg-hover); padding:8px 12px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="viewArtifact('\${a.cid}', '\${a.name}')">
              <div>
                <div style="font-size:13px; font-weight:600;">\${a.title}</div>
                <div style="font-size:11px; color:var(--text-muted);">\${a.name} (\${Math.round(a.size/1024)} KB) • \${a.mtimeFormatted}</div>
              </div>
              <button class="btn" style="font-size:11px; padding:3px 8px;">Открыть</button>
            </div>
          \`).join("");
        }
      } catch (_) {}
    }

    async function viewArtifact(cid, name) {
      try {
        const data = await apiRequest("/api/artifact-content?cid=" + cid + "&name=" + encodeURIComponent(name));
        if (data.ok) {
          document.getElementById("artifactTitle").innerText = name;
          document.getElementById("artifactViewer").innerHTML = formatMarkdown(data.content);
        }
      } catch (_) {}
    }

    // App Initialization
    function initApp() {
      syncState();
      loadPresets();
      setInterval(syncState, 4000);
    }

    if (currentPin) {
      initApp();
    } else {
      showLockScreen();
    }
  </script>
</body>
</html>`;
    }
}

// -----------------------------------------------------------------------------
// CLI Arguments Parsing & Entrypoint
// -----------------------------------------------------------------------------
function parseCliArgs() {
    let confHost = null, confPort = null, confPin = null;
    const etcConf = "/etc/antigravity/web.conf";
    if (fs.existsSync(etcConf)) {
        try {
            const raw = fs.readFileSync(etcConf, "utf8");
            for (const line of raw.split("\n")) {
                const tr = line.trim();
                if (!tr || tr.startsWith("#") || tr.startsWith(";")) continue;
                const eq = tr.indexOf("=");
                if (eq !== -1) {
                    const k = tr.slice(0, eq).trim().toUpperCase();
                    const v = tr.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
                    if (k === "HOST") confHost = v;
                    else if (k === "PORT") confPort = parseInt(v, 10);
                    else if (k === "PIN") confPin = v;
                }
            }
        } catch (_) {}
    }

    const args = process.argv.slice(2);
    const options = {
        host: process.env.AGY_HOST || process.env.HOST || confHost || "0.0.0.0",
        port: parseInt(process.env.AGY_PORT || process.env.PORT || "", 10) || confPort || 51125,
        pin: process.env.AGY_PIN || process.env.PIN || confPin || null,
        workspace: process.env.AGY_WORKSPACE || process.cwd()
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--host" && i + 1 < args.length) {
            options.host = args[++i];
        } else if ((arg === "--port" || arg === "-p") && i + 1 < args.length) {
            options.port = parseInt(args[++i], 10) || 51125;
        } else if (arg === "--pin" && i + 1 < args.length) {
            options.pin = String(args[++i]).trim();
        } else if ((arg === "--workspace" || arg === "-w") && i + 1 < args.length) {
            options.workspace = path.resolve(args[++i]);
        } else if (arg === "--help" || arg === "-h") {
            console.log(`
Absolute Antigravity Server Dashboard (v${VERSION})
Usage: node scripts/server_dashboard.js [options]

Options:
  --host <ip>          Bind host address (default: 0.0.0.0)
  --port, -p <port>    Listen port (default: 51125)
  --pin <6-digits>     Static 6-digit PIN code (generates random PIN if omitted)
  --workspace, -w <dir> Active workspace directory (default: current working dir)
  --help, -h           Show this help message
`);
            process.exit(0);
        }
    }
    return options;
}

if (require.main === module) {
    const opts = parseCliArgs();
    const dashboard = new ServerDashboard(opts);
    dashboard.start().catch((err) => {
        console.error("Fatal: failed to start server dashboard:", err);
        process.exit(1);
    });

    const shutdown = async () => {
        console.log("\n[Shutdown] Stopping Server Dashboard...");
        await dashboard.stop();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

module.exports = {
    ServerDashboard,
    generateSecurePin,
    getPrimaryLanIp,
    getAllPresets,
    getActivePreset,
    applyPreset,
    getAccountSlotsStatus,
    rotateAccountSlot,
    inspectWorkspace,
    getLogs,
    getArtifactsList
};
