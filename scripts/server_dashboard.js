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
                    const model = data.model || "gemini-3.8-flash-high";
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
  <meta name="theme-color" content="#08090d">
  <style>
    :root {
      --bg-page: #08090d;
      --bg-surface: rgba(15, 20, 32, 0.72);
      --bg-surface-elevated: rgba(22, 29, 46, 0.82);
      --bg-card: rgba(17, 23, 36, 0.65);
      --bg-hover: rgba(255, 255, 255, 0.06);
      --bg-input: #0b0f17;
      --border: rgba(255, 255, 255, 0.08);
      --border-subtle: rgba(255, 255, 255, 0.05);
      --border-hover: rgba(255, 255, 255, 0.18);
      --border-focus: #3b82f6;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent: #3b82f6;
      --accent-hover: #60a5fa;
      --accent-glow: rgba(59, 130, 246, 0.35);
      --violet: #8b5cf6;
      --violet-hover: #a78bfa;
      --violet-glow: rgba(139, 92, 246, 0.35);
      --green: #10b981;
      --green-glow: rgba(16, 185, 129, 0.35);
      --orange: #f59e0b;
      --red: #f43f5e;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-full: 9999px;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
      --shadow-card: 0 4px 20px -2px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    }

    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.14); border-radius: 999px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }

    body {
      font-family: var(--font-sans);
      background-color: var(--bg-page);
      background-image:
        radial-gradient(ellipse 90% 50% at 50% -10%, rgba(59, 130, 246, 0.12), transparent 70%),
        radial-gradient(ellipse 70% 40% at 90% 100%, rgba(139, 92, 246, 0.08), transparent 60%);
      background-attachment: fixed;
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      padding-bottom: 76px;
      -webkit-font-smoothing: antialiased;
    }

    /* Top Navigation Header */
    header {
      background: rgba(11, 15, 24, 0.82);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 1px solid var(--border);
      padding: 10px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 14.5px;
      letter-spacing: -0.2px;
    }
    .brand-logo {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.45);
      font-size: 15px;
    }
    .brand-badge {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #93c5fd;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 1px 6px;
      border-radius: 6px;
      margin-left: 6px;
    }

    /* Desktop Navigation Tabs */
    .desktop-tabs {
      display: none;
      gap: 4px;
      background: rgba(255, 255, 255, 0.03);
      padding: 3px;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
    }
    @media (min-width: 820px) {
      .desktop-tabs { display: flex; }
      body { padding-bottom: 24px; }
      .nav-bar { display: none !important; }
    }
    .d-tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .d-tab-btn:hover { color: var(--text); background: var(--bg-hover); }
    .d-tab-btn.active {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.09);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    }

    /* Header Right Quick Status Pills */
    .header-pills {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pill {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      color: var(--text);
      font-weight: 500;
      transition: all 0.15s;
    }
    .pill:hover { background: var(--bg-hover); border-color: var(--border-hover); }
    .pill-interactive { cursor: pointer; }

    /* Live Radar Ping Indicator */
    .radar-box {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
    }
    .radar-dot, .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px var(--green);
      position: relative;
      z-index: 2;
      transition: background 0.3s;
    }
    .radar-dot.offline, .status-dot.offline {
      background: var(--red);
      box-shadow: 0 0 8px var(--red);
    }
    .radar-wave {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.5);
      animation: radarPing 2s cubic-bezier(0, 0, 0.2, 1) infinite;
      z-index: 1;
    }
    .radar-dot.offline ~ .radar-wave, .status-dot.offline ~ .radar-wave {
      display: none;
    }
    @keyframes radarPing {
      0% { transform: scale(0.8); opacity: 0.9; }
      70%, 100% { transform: scale(2.6); opacity: 0; }
    }

    /* Mobile Bottom Navigation Bar */
    .nav-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(11, 15, 24, 0.92);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
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
      color: var(--text-dim);
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
      padding: 5px 0;
      transition: all 0.15s ease;
      position: relative;
    }
    .nav-item .nav-icon { font-size: 18px; margin-bottom: 2px; transition: transform 0.15s; }
    .nav-item.active { color: #ffffff; }
    .nav-item.active .nav-icon { transform: translateY(-2px); }
    .nav-item.active::after {
      content: "";
      position: absolute;
      bottom: 1px;
      width: 16px;
      height: 2px;
      background: var(--accent);
      border-radius: 2px;
      box-shadow: 0 0 8px var(--accent);
    }

    /* Tab Containers */
    .tab-content {
      display: none;
      flex-direction: column;
      flex: 1;
      width: 100%;
      max-width: 980px;
      margin: 0 auto;
      padding: 16px 18px;
      animation: fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .tab-content.active { display: flex; }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Common Card Styles */
    .card {
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-top: 1px solid rgba(255, 255, 255, 0.13);
      border-radius: var(--radius-lg);
      padding: 18px;
      margin-bottom: 14px;
      box-shadow: var(--shadow-card);
      position: relative;
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
    .card-subtitle {
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 14px;
    }

    /* Buttons & Form Inputs */
    .btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: var(--border-hover);
    }
    .btn-primary {
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #fff;
      box-shadow: 0 2px 10px rgba(59, 130, 246, 0.35);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #60a5fa, #2563eb);
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.5);
    }
    .btn-success {
      background: linear-gradient(135deg, #10b981, #059669);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #fff;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
    }
    .btn-danger {
      background: linear-gradient(135deg, #f43f5e, #be123c);
      border: 1px solid rgba(244, 63, 94, 0.4);
      color: #fff;
    }
    .btn-gradient {
      background: linear-gradient(135deg, #8b5cf6, #3b82f6);
      border: 1px solid rgba(139, 92, 246, 0.4);
      color: #fff;
      box-shadow: 0 2px 10px rgba(139, 92, 246, 0.35);
    }
    .btn-gradient:hover {
      background: linear-gradient(135deg, #a78bfa, #60a5fa);
      box-shadow: 0 4px 16px rgba(139, 92, 246, 0.5);
    }
    .btn-ghost {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
    }
    .btn-ghost:hover {
      background: var(--bg-hover);
      color: var(--text);
      border-color: var(--border);
    }
    .input {
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      outline: none;
      width: 100%;
      transition: all 0.15s;
    }
    .input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    /* TAB 1: 💬 AGENT CHAT (Cursor & Claude Level) */
    .chat-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
      min-height: 420px;
      max-height: calc(100vh - 290px);
      overflow-y: auto;
      padding: 6px 4px 16px 4px;
      margin-bottom: 8px;
    }
    .chat-msg {
      max-width: 92%;
      border-radius: var(--radius-md);
      font-size: 13.5px;
      line-height: 1.6;
      word-break: break-word;
      animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .chat-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, rgba(30, 58, 138, 0.32), rgba(37, 99, 235, 0.2));
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #ffffff;
      border-bottom-right-radius: 4px;
      padding: 12px 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }
    .chat-msg.assistant {
      align-self: flex-start;
      background: rgba(17, 23, 36, 0.78);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      border-bottom-left-radius: 4px;
      padding: 14px 18px;
      box-shadow: var(--shadow-card);
    }
    .chat-msg-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      gap: 12px;
    }
    .chat-avatar {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
      padding: 2px 8px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .chat-avatar.user {
      background: rgba(59, 130, 246, 0.25);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.4);
    }
    .chat-avatar.assistant {
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(59, 130, 246, 0.25));
      color: #c4b5fd;
      border: 1px solid rgba(139, 92, 246, 0.4);
    }
    .chat-msg-time {
      font-size: 10px;
      color: var(--text-dim);
    }
    .chat-msg-body {
      font-size: 13.5px;
      line-height: 1.6;
    }
    .typing-cursor {
      display: inline-block;
      margin-left: 2px;
      color: var(--accent);
      animation: blinkCursor 0.8s infinite;
      font-weight: 700;
    }
    @keyframes blinkCursor {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* Premium Code Blocks with Header & Copy Button */
    .code-block {
      margin: 12px 0;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #04060b;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }
    .code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 11px;
    }
    .code-lang {
      font-family: var(--font-mono);
      text-transform: lowercase;
      color: #94a3b8;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .copy-code-btn {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 5px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .copy-code-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
    .copy-code-btn.copied {
      background: rgba(16, 185, 129, 0.15);
      border-color: #10b981;
      color: #10b981;
    }
    .code-block pre {
      padding: 12px 14px;
      margin: 0;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.6;
      color: #e2e8f0;
    }
    .code-block code {
      font-family: var(--font-mono);
      background: transparent;
      padding: 0;
    }
    code.inline-code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
      color: #93c5fd;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    /* Prompt Suggestion Chips */
    .chat-prompt-chips {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .chip {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 11.5px;
      padding: 5px 12px;
      border-radius: 20px;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .chip:hover {
      color: var(--text);
      border-color: var(--accent);
      background: rgba(59, 130, 246, 0.08);
      transform: translateY(-1px);
    }

    /* Floating Chat Input Box */
    .chat-floating-bar {
      background: rgba(14, 19, 31, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: var(--radius-md);
      padding: 10px 12px;
      box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-bar-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
    }
    .chat-meta-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chat-model-select {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      outline: none;
      cursor: pointer;
    }
    .chat-preset-tag {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--violet);
      background: rgba(139, 92, 246, 0.12);
      border: 1px solid rgba(139, 92, 246, 0.3);
      padding: 2px 7px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .chat-bar {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .chat-textarea {
      flex: 1;
      min-height: 44px;
      max-height: 140px;
      resize: none;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      transition: all 0.15s;
    }
    .chat-textarea:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }
    .chat-action-btn {
      height: 44px;
      width: 48px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }

    /* TAB 2: 🎯 PRESETS (Linear Style) */
    .presets-filter-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 12px;
    }
    .search-input-wrapper {
      position: relative;
      flex: 1;
      min-width: 260px;
    }
    .overlay-chips-group {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .overlay-toggle {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 11.5px;
      padding: 5px 10px;
      border-radius: 20px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      user-select: none;
    }
    .overlay-toggle:hover {
      border-color: var(--violet);
      color: var(--text);
    }
    .overlay-toggle.active {
      background: rgba(139, 92, 246, 0.15);
      border-color: var(--violet);
      color: #ffffff;
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.3);
    }
    .overlay-toggle .toggle-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-dim);
      transition: background 0.15s;
    }
    .overlay-toggle.active .toggle-dot {
      background: var(--violet);
      box-shadow: 0 0 6px var(--violet);
    }
    .presets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }
    .preset-card {
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-md);
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
      cursor: pointer;
    }
    .preset-card:hover {
      border-color: rgba(139, 92, 246, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(139, 92, 246, 0.15);
    }
    .preset-card.active {
      border-color: var(--violet);
      background: rgba(139, 92, 246, 0.08);
      box-shadow: 0 0 20px rgba(139, 92, 246, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }
    .preset-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .preset-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .preset-icon-box {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .preset-name {
      font-size: 14.5px;
      font-weight: 700;
      color: #ffffff;
    }
    .preset-slug {
      font-size: 11px;
      color: var(--text-dim);
      font-family: var(--font-mono);
    }
    .preset-active-pill {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: 12px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid var(--green);
      color: var(--green);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .preset-active-pill .active-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 6px var(--green);
    }
    .preset-desc {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 14px;
      flex: 1;
    }
    .preset-skills-row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .skill-chip {
      font-size: 10px;
      font-family: var(--font-mono);
      color: #cbd5e1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.07);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .skill-chip.more {
      color: var(--violet);
      background: rgba(139, 92, 246, 0.1);
      border-color: rgba(139, 92, 246, 0.25);
    }
    .preset-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 10px;
      border-top: 1px solid var(--border-subtle);
    }
    .preset-skills-badge {
      font-size: 11px;
      font-weight: 600;
      color: #c4b5fd;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.3);
      padding: 2px 8px;
      border-radius: 12px;
    }
    .btn-preset-apply {
      padding: 5px 12px;
      font-size: 11.5px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
    }
    .btn-preset-apply:hover {
      background: linear-gradient(135deg, #8b5cf6, #6366f1);
      border-color: transparent;
      color: #fff;
    }
    .btn-preset-current {
      padding: 5px 12px;
      font-size: 11.5px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid var(--green);
      border-radius: 6px;
      color: var(--green);
    }

    /* TAB 3: 👥 ACCOUNT CAROUSEL */
    .slots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .slot-card {
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-md);
      padding: 16px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.2s ease;
    }
    .slot-card:hover {
      border-color: var(--border-hover);
      transform: translateY(-2px);
    }
    .slot-card.active {
      border-color: var(--green);
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      background: rgba(16, 185, 129, 0.04);
    }
    .slot-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .slot-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .slot-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }
    .slot-badge.active {
      background: rgba(16, 185, 129, 0.18);
      color: var(--green);
      border: 1px solid var(--green);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .slot-badge.standby {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-dim);
      border: 1px solid var(--border-subtle);
    }
    .slot-email {
      font-size: 12.5px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 14px;
      word-break: break-all;
      line-height: 1.4;
    }
    .slot-quota-box {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 14px;
    }
    .slot-quota-label {
      display: flex;
      justify-content: space-between;
      font-size: 10.5px;
      color: var(--text-muted);
      margin-bottom: 5px;
    }
    .slot-quota-label .quota-rate {
      font-weight: 600;
      color: var(--text);
    }
    .slot-quota-track {
      width: 100%;
      height: 5px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
    }
    .slot-quota-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }
    .slot-quota-fill.active {
      background: linear-gradient(90deg, #10b981, #3b82f6);
    }
    .slot-quota-fill.standby {
      background: rgba(255, 255, 255, 0.25);
    }
    .btn-slot-switch {
      width: 100%;
      font-size: 12px;
      padding: 7px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      border-radius: 7px;
      cursor: pointer;
      color: var(--text);
      font-weight: 600;
      transition: all 0.15s;
    }
    .btn-slot-switch:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: var(--border-hover);
    }
    .btn-slot-selected {
      width: 100%;
      font-size: 12px;
      padding: 7px;
      background: rgba(16, 185, 129, 0.18);
      border: 1px solid var(--green);
      border-radius: 7px;
      color: var(--green);
      font-weight: 600;
      cursor: default;
    }
    .failover-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid var(--border);
      padding-top: 14px;
      gap: 12px;
    }

    /* TAB 5: 💻 WEB CONSOLE (Terminal macOS/Linux Window) */
    .terminal-window-wrapper {
      background: #040609;
      border: 1px solid var(--border);
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: var(--radius-md);
      overflow: hidden;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
      margin-bottom: 12px;
    }
    .terminal-titlebar {
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      padding: 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .terminal-dots {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .t-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      display: inline-block;
    }
    .t-dot.red { background: #ff5f56; box-shadow: 0 0 6px rgba(255, 95, 86, 0.4); }
    .t-dot.yellow { background: #ffbd2e; box-shadow: 0 0 6px rgba(255, 189, 46, 0.4); }
    .t-dot.green { background: #27c93f; box-shadow: 0 0 6px rgba(39, 201, 63, 0.4); }
    .terminal-title {
      font-size: 11.5px;
      font-family: var(--font-mono);
      color: #94a3b8;
      letter-spacing: 0.3px;
    }
    .terminal-window {
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12.5px;
      min-height: 360px;
      max-height: 480px;
      overflow-y: auto;
      color: #86efac;
      white-space: pre-wrap;
      line-height: 1.6;
      background: transparent;
    }
    .terminal-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .t-chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .t-chip:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      border-color: var(--border-hover);
    }
    .terminal-input-bar {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .terminal-prompt {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--accent);
      font-size: 14px;
      padding-left: 4px;
    }

    /* Modal / PIN Lock Screen */
    .lock-screen {
      position: fixed;
      inset: 0;
      background: rgba(6, 8, 14, 0.88);
      backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .lock-card {
      background: rgba(15, 20, 32, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-top: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      padding: 32px 26px;
      width: 100%;
      max-width: 350px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(59, 130, 246, 0.15);
      animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .keypad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 20px;
    }
    .keypad-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #ffffff;
      font-size: 20px;
      font-weight: 600;
      height: 52px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.12s;
    }
    .keypad-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .keypad-btn:active {
      transform: scale(0.96);
      background: rgba(59, 130, 246, 0.25);
    }
    .pin-dots {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin: 20px 0;
    }
    .pin-dot {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.2);
      transition: all 0.2s ease;
    }
    .pin-dot.filled {
      background: var(--accent);
      border-color: var(--accent);
      box-shadow: 0 0 12px var(--accent);
      transform: scale(1.15);
    }
    .shake { animation: shakeCard 0.32s ease-in-out; }
    @keyframes shakeCard {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-9px); }
      40%, 80% { transform: translateX(9px); }
    }
  </style>
</head>
<body>

  <!-- Top Navigation Header -->
  <header>
    <div class="brand">
      <div class="brand-logo">🌌</div>
      <div>
        <span>Antigravity</span>
        <span class="brand-badge">SERVER 3.0</span>
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

    <!-- Right Status Pills -->
    <div class="header-pills">
      <div class="pill pill-interactive" id="slotPill" onclick="switchTab('accounts')" title="Активный слот">
        <span>👤</span> <span id="slotPillText">Слот 1</span>
      </div>
      <div class="pill pill-interactive" id="presetPill" onclick="switchTab('presets')" title="Активный пресет">
        <span id="presetPillIcon">🎭</span> <span id="presetPillText">orchestrator</span>
      </div>
      <div class="pill pill-interactive" onclick="logout()" title="Заблокировать сессию">
        <div class="radar-box">
          <div class="radar-dot" id="connDot"></div>
          <div class="radar-wave"></div>
        </div>
        <span style="font-size:11px; margin-left:2px;">🔒</span>
      </div>
    </div>
  </header>

  <!-- TAB 1: 💬 AGENT CHAT -->
  <main class="tab-content active" id="tab-chat">
    <div class="chat-container" id="chatBox">
      <div class="chat-msg assistant">
        <div class="chat-msg-header">
          <span class="chat-avatar assistant">✨ Antigravity</span>
          <span class="chat-msg-time">Ready</span>
        </div>
        <div class="chat-msg-body">
          👋 Привет! Я — Google Antigravity Headless Server. Управляй проектом, пресетами и кодогенерацией напрямую с сервера.
        </div>
      </div>
    </div>

    <div class="chat-prompt-chips">
      <div class="chip" onclick="quickPrompt('Проведи полный аудит безопасности и архитектуры текущего проекта')">🛡️ Аудит безопасности</div>
      <div class="chip" onclick="quickPrompt('Оптимизируй производительность и использование памяти')">⚡ Оптимизация памяти</div>
      <div class="chip" onclick="quickPrompt('Напиши модульные и интеграционные тесты для измененных файлов')">🧪 Написать тесты</div>
      <div class="chip" onclick="quickPrompt('Объясни модель владения и жизненных циклов в Rust')">🦀 Rust Ownership</div>
    </div>

    <div class="chat-floating-bar">
      <div class="chat-bar-meta">
        <div class="chat-meta-left">
          <select class="chat-model-select" id="chatModel">
            <option value="gemini-3.8-flash-high">⚡ Gemini 3.8 Flash High (Default)</option>
            <option value="gemini-2.5-pro">🧠 Gemini 2.5 Pro (Deep)</option>
            <option value="claude-sonnet-4-6">🎭 Claude Sonnet 4.6 (Thinking)</option>
            <option value="claude-opus-4-6-thinking">👑 Claude Opus 4.6 (Thinking)</option>
            <option value="gemini-2.5-flash">🚀 Gemini 2.5 Flash Lite</option>
          </select>
          <div class="chat-preset-tag">
            <span>🎭</span> <span id="chatPresetIndicator">orchestrator</span>
          </div>
          <span style="color:var(--text-dim); font-size:11px;" id="chatWsInfo">📁 ...</span>
        </div>
        <button class="btn btn-ghost" style="padding:2px 8px; font-size:11px;" onclick="clearChat()">🗑️ Очистить</button>
      </div>
      <div class="chat-bar">
        <textarea class="chat-textarea" id="chatInput" placeholder="Введите задачу для Antigravity (Enter - отправить, Shift+Enter - строка)..." onkeydown="handleChatKey(event)"></textarea>
        <button class="btn btn-primary chat-action-btn" id="chatSendBtn" onclick="sendChatMessage()" title="Отправить сообщение">➤</button>
        <button class="btn btn-danger chat-action-btn" id="chatStopBtn" style="display:none;" onclick="stopChatStream()" title="Остановить генерацию">⏹</button>
      </div>
    </div>
  </main>

  <!-- TAB 2: 🎯 PRESETS -->
  <main class="tab-content" id="tab-presets">
    <div class="card">
      <div class="card-title">
        <span>Активный пресет проекта</span>
        <span class="pill" id="activePresetBadge" style="color:var(--violet); border-color:rgba(139, 92, 246, 0.4);">🎭 orchestrator</span>
      </div>
      <p class="card-subtitle">
        Выберите пресет для загрузки специализированного набора навыков и системного контекста в текущий воркспейс.
      </p>
      <div class="presets-filter-bar">
        <div class="search-input-wrapper">
          <input type="text" class="input" id="presetSearch" placeholder="🔍 Поиск пресетов и навыков..." oninput="filterPresets()">
        </div>
        <div class="overlay-chips-group" id="overlayChips">
          <span class="overlay-toggle" onclick="toggleOverlay(this, '+qa')"><span class="toggle-dot"></span>+qa</span>
          <span class="overlay-toggle" onclick="toggleOverlay(this, '+devops')"><span class="toggle-dot"></span>+devops</span>
          <span class="overlay-toggle" onclick="toggleOverlay(this, '+docker')"><span class="toggle-dot"></span>+docker</span>
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
        <button class="btn btn-gradient" onclick="rotateSlot()">🔄 Ротация слота</button>
      </div>
      <p class="card-subtitle">
        Автономный пул учетных записей Antigravity с защитой от 429 ResourceExhausted и ротацией токенов.
      </p>
      <div class="slots-grid" id="slotsContainer">
        <!-- Generated via JS -->
      </div>
      <div class="failover-bar">
        <div>
          <div style="font-size:13px; font-weight:600;">Автоматический переход при 429 (Auto-Failover):</div>
          <div style="font-size:11px; color:var(--text-muted);">Переключение на резервный слот при исчерпании лимитов</div>
        </div>
        <button class="btn btn-success" id="btnToggleFailover" onclick="toggleFailover()">Включен (ON)</button>
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
      <p class="card-subtitle">
        Привяжите слот аккаунта и профиль пресета к директории (команда agy project init).
      </p>
      <div style="grid-template-columns:1fr 1fr; display:grid; gap:10px; margin-bottom:14px;">
        <div>
          <label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px;">Привязать слот:</label>
          <select class="input" id="initSlotSelect">
            <option value="1">Слот 1</option>
            <option value="2">Слот 2</option>
            <option value="3">Слот 3</option>
            <option value="4">Слот 4</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px;">Базовый пресет:</label>
          <select class="input" id="initPresetSelect"></select>
        </div>
      </div>
      <button class="btn btn-success" onclick="initProject()">🚀 Инициализировать проект (agy project init)</button>
    </div>

    <div class="card">
      <div class="card-title">Недавние проекты на сервере</div>
      <div id="recentWorkspacesList" style="display:flex; flex-direction:column; gap:8px;">
        <!-- Recent paths -->
      </div>
    </div>
  </main>

  <!-- TAB 5: 💻 WEB CONSOLE -->
  <main class="tab-content" id="tab-terminal">
    <div class="card" style="padding:10px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
      <div class="terminal-chips">
        <button class="t-chip" onclick="execCommand('agy preset current')">agy preset current</button>
        <button class="t-chip" onclick="execCommand('agy account status')">agy account status</button>
        <button class="t-chip" onclick="execCommand('agy daemon status')">agy daemon status</button>
        <button class="t-chip" onclick="execCommand('git status -s')">git status</button>
      </div>
      <button class="btn btn-ghost" style="padding:4px 8px; font-size:11px;" onclick="clearTerminal()">Очистить</button>
    </div>

    <div class="terminal-window-wrapper">
      <div class="terminal-titlebar">
        <div class="terminal-dots">
          <span class="t-dot red" title="Закрыть"></span>
          <span class="t-dot yellow" title="Свернуть"></span>
          <span class="t-dot green" title="Развернуть"></span>
        </div>
        <div class="terminal-title">antigravity@server: ~ (bash / ps)</div>
        <div style="font-size:10px; font-family:var(--font-mono); color:var(--text-dim);">v3.0.0</div>
      </div>
      <div class="terminal-window" id="terminalBox">Antigravity Web Console [v3.0.0]
Готов к выполнению CLI команд в контексте сервера.
</div>
    </div>

    <div class="terminal-input-bar">
      <div class="terminal-prompt">$</div>
      <input type="text" class="input" id="terminalInput" placeholder="Введите команду (например: agy preset switch web)..." onkeydown="handleTerminalKey(event)" style="font-family:var(--font-mono); font-size:12.5px;">
      <button class="btn btn-primary" onclick="runTerminalInput()">Выполнить</button>
    </div>
  </main>

  <!-- TAB 6: 📜 LOGS & DOCS -->
  <main class="tab-content" id="tab-logs">
    <div style="display:flex; gap:10px; margin-bottom:12px;">
      <button class="btn btn-primary" id="btnSubLogs" onclick="switchLogsSubTab('logs')">📋 Системные логи</button>
      <button class="btn btn-ghost" id="btnSubDocs" onclick="switchLogsSubTab('docs')">📖 Артефакты Brain (.md)</button>
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
          <label style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" id="logAutoRefresh" onchange="toggleLogAutoRefresh()"> Авто-обновление (3s)
          </label>
        </div>
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="fetchLogs()">Обновить</button>
      </div>
      <div class="terminal-window-wrapper">
        <div class="terminal-window" id="logsBox" style="color:#94a3b8; min-height:420px;">Загрузка логов...</div>
      </div>
    </div>

    <!-- Docs Subview -->
    <div id="subViewDocs" style="display:none;">
      <div class="card">
        <div class="card-title">Артефакты сессий Antigravity (.gemini/antigravity/brain)</div>
        <div id="artifactsList" style="display:flex; flex-direction:column; gap:6px; max-height:240px; overflow-y:auto; margin-bottom:14px;">
          Загрузка списка артефактов...
        </div>
        <div class="card-title" id="artifactTitle">Просмотр артефакта</div>
        <div id="artifactViewer" style="background:#090d16; border:1px solid var(--border); border-radius:8px; padding:16px; max-height:400px; overflow-y:auto; font-size:13px; line-height:1.6;">
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
      <div style="font-size:36px; margin-bottom:8px;">🌌</div>
      <h2 style="font-size:18px; margin-bottom:4px; font-weight:700;">Antigravity Server</h2>
      <p style="font-size:12px; color:var(--text-muted);">Введите 6-значный PIN-код для разблокировки</p>

      <div class="pin-dots">
        <div class="pin-dot" id="dot-0"></div>
        <div class="pin-dot" id="dot-1"></div>
        <div class="pin-dot" id="dot-2"></div>
        <div class="pin-dot" id="dot-3"></div>
        <div class="pin-dot" id="dot-4"></div>
        <div class="pin-dot" id="dot-5"></div>
      </div>

      <div id="authErrorMsg" style="font-size:12px; color:var(--red); min-height:16px; margin-bottom:8px; font-weight:600;"></div>

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
        const dot = document.getElementById("connDot");
        if (dot) dot.classList.add("offline");
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
      const dot = document.getElementById("connDot");
      if (dot) dot.classList.remove("offline");
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
          setTimeout(() => document.getElementById("lockCard").classList.remove("shake"), 320);
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

    // Physical Keyboard Listener for PIN
    window.addEventListener("keydown", (e) => {
      const lock = document.getElementById("lockScreen");
      if (!lock || lock.style.display === "none") return;
      if (e.key >= "0" && e.key <= "9") {
        pressKey(e.key);
      } else if (e.key === "Backspace") {
        backspacePin();
      } else if (e.key === "Escape" || e.key === "c" || e.key === "C") {
        clearPin();
      }
    });

    // Global State Sync
    async function syncState() {
      try {
        const data = await apiRequest("/api/state");
        if (data.ok) {
          appState = data;
          const dot = document.getElementById("connDot");
          if (dot) dot.classList.remove("offline");
          document.getElementById("slotPillText").innerText = "Слот " + data.activeSlot;
          document.getElementById("presetPillText").innerText = data.activePreset;
          document.getElementById("presetPillIcon").innerText = data.activePresetDetails?.icon || "⚡";
          document.getElementById("activePresetBadge").innerText = (data.activePresetDetails?.icon || "⚡") + " " + data.activePreset;
          
          const chatInd = document.getElementById("chatPresetIndicator");
          if (chatInd) chatInd.innerText = data.activePreset;

          if (data.workspace?.name) {
            document.getElementById("chatWsInfo").innerText = "📁 " + data.workspace.name;
            document.getElementById("currentWsInput").value = data.workspace.path || "";
            document.getElementById("wsInspectionInfo").innerHTML =
              "Статус: " + (data.workspace.hasConfig ? "<span style='color:var(--green); font-weight:600;'>Привязан (.agy/config.json)</span>" : "<span style='color:var(--orange); font-weight:600;'>Не инициализирован</span>") +
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
        const email = acc.email || ('developer-slot-' + acc.slot + '@server.local');
        return \`
          <div class="slot-card \${isActive ? 'active' : ''}">
            <div class="slot-card-header">
              <div class="slot-title">
                <span>👤</span>
                <span>Слот \${acc.slot}</span>
              </div>
              <span class="slot-badge \${isActive ? 'active' : 'standby'}">
                \${isActive ? '<span class="active-dot" style="width:6px; height:6px; border-radius:50%; background:var(--green); display:inline-block; box-shadow:0 0 6px var(--green);"></span> ACTIVE' : 'STANDBY'}
              </span>
            </div>
            <div class="slot-email" title="\${email}">\${email}</div>
            <div class="slot-quota-box">
              <div class="slot-quota-label">
                <span>Квота API</span>
                <span class="quota-rate">\${isActive ? '100% Ready' : 'Резерв'}</span>
              </div>
              <div class="slot-quota-track">
                <div class="slot-quota-fill \${isActive ? 'active' : 'standby'}" style="width: \${isActive ? '100%' : '80%'}"></div>
              </div>
            </div>
            <button class="btn \${isActive ? 'btn-slot-selected' : 'btn-slot-switch'}" onclick="rotateSlot(\${acc.slot})">
              \${isActive ? '✔ Текущий слот' : 'Переключить на слот'}
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
      cont.innerHTML = list.map(p => {
        const skillsList = p.skills || [];
        const skillsChips = skillsList.slice(0, 3).map(s => \`<span class="skill-chip">\${s}</span>\`).join("");
        const moreBadge = skillsList.length > 3 ? \`<span class="skill-chip more">+\${skillsList.length - 3}</span>\` : "";
        return \`
          <div class="preset-card \${p.isActive ? 'active' : ''}">
            <div class="preset-header">
              <div class="preset-title-group">
                <div class="preset-icon-box">\${p.icon || '⚡'}</div>
                <div>
                  <div class="preset-name">\${p.name}</div>
                  <div class="preset-slug">\${p.id}</div>
                </div>
              </div>
              \${p.isActive ? '<span class="preset-active-pill"><span class="active-dot"></span>ACTIVE</span>' : ''}
            </div>
            <div class="preset-desc">\${p.description}</div>
            <div class="preset-skills-row">
              \${skillsChips}
              \${moreBadge}
            </div>
            <div class="preset-card-footer">
              <span class="preset-skills-badge">\${p.skillsCount} skills</span>
              <button class="btn \${p.isActive ? 'btn-preset-current' : 'btn-preset-apply'}" onclick="applyPresetClick('\${p.id}')">
                \${p.isActive ? '✔ Активен' : 'Применить →'}
              </button>
            </div>
          </div>
        \`;
      }).join("");
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
        el.classList.remove("active");
      } else {
        selectedOverlays.add(overlay);
        el.classList.add("active");
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
              <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:10px 14px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-size:13px; font-weight:600;">\${w.name}</div>
                  <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px;">\${w.path}</div>
                </div>
                <button class="btn" style="font-size:11.5px; padding:4px 10px;" onclick="selectWorkspacePath('\${w.path.replace(/\\\\/g, '\\\\\\\\')}')">Открыть</button>
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
      const isUser = role === "user";
      const avatarTag = isUser
        ? '<span class="chat-avatar user">👤 You</span>'
        : '<span class="chat-avatar assistant">✨ Gemini</span>';
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      div.innerHTML =
        '<div class="chat-msg-header">' +
          avatarTag +
          '<span class="chat-msg-time">' + timeStr + '</span>' +
        '</div>' +
        '<div class="chat-msg-body">' + formatMarkdown(text) + '</div>';
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
      return div.querySelector(".chat-msg-body");
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
      document.getElementById("chatBox").innerHTML = \`
        <div class="chat-msg assistant">
          <div class="chat-msg-header">
            <span class="chat-avatar assistant">✨ Antigravity</span>
            <span class="chat-msg-time">Ready</span>
          </div>
          <div class="chat-msg-body">
            Контекст диалога очищен. Задайте новую задачу.
          </div>
        </div>
      \`;
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

      const assistantMsg = appendChatMessage("assistant", "⏳ Подключение к Antigravity на сервере...");
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
                  assistantMsg.innerHTML = formatMarkdown(accumulated) + '<span class="typing-cursor">▌</span>';
                  document.getElementById("chatBox").scrollTop = document.getElementById("chatBox").scrollHeight;
                } else if (payload.type === "done") {
                  assistantMsg.innerHTML = formatMarkdown(payload.fullText || accumulated);
                } else if (payload.type === "error") {
                  assistantMsg.innerHTML = '<span style="color:var(--red); font-weight:600;">⚠ ' + payload.error + '</span>';
                }
              } catch (_) {}
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          assistantMsg.innerHTML = '<span style="color:var(--red); font-weight:600;">⚠ Ошибка соединения: ' + err.message + '</span>';
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

    // Markdown Formatter with Code Copy Blocks
    function formatMarkdown(text) {
      if (!text) return "";
      let html = text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\`\`\`([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\`\`\`/g, (m, lang, code) => {
          const language = (lang || "code").toLowerCase();
          return '<div class="code-block">' +
            '<div class="code-header">' +
              '<span class="code-lang">' + language + '</span>' +
              '<button class="copy-code-btn" onclick="copyCode(this)" title="Копировать код">📋 Copy code</button>' +
            '</div>' +
            '<pre><code class="language-' + language + '">' + code.trim() + '</code></pre>' +
          '</div>';
        })
        .replace(/\`([^\`]+)\`/g, '<code class="inline-code">$1</code>')
        .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
        .replace(/^### (.*$)/gim, '<h3 style="margin:8px 0 4px; font-size:14px; font-weight:700; color:#f1f5f9;">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 style="margin:10px 0 6px; font-size:15px; font-weight:700; color:#f8fafc;">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 style="margin:12px 0 8px; font-size:16.5px; font-weight:700; color:#ffffff;">$1</h1>')
        .replace(/^\\- (.*$)/gim, '<div style="margin:2px 0; padding-left:4px;">• $1</div>')
        .replace(/\\n/g, '<br>');
      return html;
    }

    function copyCode(btn) {
      const block = btn.closest('.code-block');
      if (!block) return;
      const code = block.querySelector('pre code');
      if (!code) return;
      const text = code.innerText || code.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = '✔ Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.innerHTML = '📋 Copy code';
            btn.classList.remove('copied');
          }, 2000);
        }).catch(() => fallbackCopy(text, btn));
      } else {
        fallbackCopy(text, btn);
      }
    }

    function fallbackCopy(text, btn) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        btn.innerHTML = '✔ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = '📋 Copy code';
          btn.classList.remove('copied');
        }, 2000);
      } catch (_) {}
      document.body.removeChild(ta);
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
      document.getElementById("btnSubLogs").className = isLogs ? "btn btn-primary" : "btn btn-ghost";
      document.getElementById("btnSubDocs").className = !isLogs ? "btn btn-primary" : "btn btn-ghost";
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
            cont.innerHTML = "<div style='font-size:12px; color:var(--text-muted); padding:10px;'>Нет сгенерированных артефактов в brain/.</div>";
            return;
          }
          cont.innerHTML = data.artifacts.map(a => \`
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:10px 14px; border-radius:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="viewArtifact('\${a.cid}', '\${a.name}')">
              <div>
                <div style="font-size:13px; font-weight:600;">\${a.title}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">\${a.name} (\${Math.round(a.size/1024)} KB) • \${a.mtimeFormatted}</div>
              </div>
              <button class="btn" style="font-size:11px; padding:3px 10px;">Открыть</button>
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
