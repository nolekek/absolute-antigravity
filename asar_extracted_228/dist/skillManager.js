"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const USER_HOME = os.homedir();
const CONFIG_FILE = path.join(USER_HOME, ".gemini", "antigravity", "control-center-config.json");

const PRESETS = {
    "web": {
        id: "web",
        name: "Web Modern",
        icon: "🌐",
        description: "Next.js 15, React, Tailwind v4, Vue 3, TanStack Query, Web Vitals, SEO & CRO",
        skills: [
            "ui-ux-pro-max", "frontend-design", "react-best-practices", "seo-audit", "form-cro",
            "nextjs-fullstack-guru", "tailwind-v4-master", "react-performance-opt", "vue-nuxt-expert",
            "web-state-query-master", "web-performance-auditor", "agent-preset-conductor",
            "ai-product-partner", "modern-web-guidance", "generative_ui"
        ]
    },
    "backend": {
        id: "backend",
        name: "Backend & DB",
        icon: "⚙️",
        description: "PostgreSQL DBA, Database design, API design, Node.js, FastAPI, Go, Rust, Redis, Kafka",
        skills: [
            "database-design", "api-design-principles", "nodejs-best-practices",
            "go-concurrency-patterns", "memory-safety-patterns",
            "postgres-dba-optimizer", "fastapi-async-architect", "go-highload-services",
            "rust-systems-safe", "redis-distributed-caching", "kafka-event-streaming",
            "agent-preset-conductor", "ai-product-partner"
        ]
    },
    "devops": {
        id: "devops",
        name: "DevOps & Cloud",
        icon: "🐳",
        description: "Docker multi-stage, Kubernetes, GitHub Actions, Terraform IaC, AWS Serverless, SRE, Observability",
        skills: [
            "incident-responder", "deployment-procedures", "aws-serverless",
            "docker-container-master", "k8s-manifest-generator", "github-actions-ci-cd",
            "terraform-iac-architect", "observability-telemetry-guru",
            "agent-preset-conductor", "ai-product-partner"
        ]
    },
    "appsec": {
        id: "appsec",
        name: "AppSec & Reversing",
        icon: "🛡️",
        description: "OWASP Top-10, API security, Ethical hacking, Electron ASAR, Win32/PS & Desktop UI, Network intercept",
        skills: [
            "top-web-vulnerabilities", "api-security-best-practices", "ethical-hacking-methodology",
            "appsec-code-auditor", "reverse-engineer-electron", "win32-powershell-automation", "windows-desktop-control",
            "network-traffic-intercept", "api-pentest-fuzzer", "agent-preset-conductor", "premortem-redteam"
        ]
    },
    "qa": {
        id: "qa",
        name: "QA & Testing",
        icon: "🧪",
        description: "Playwright E2E & Desktop UI (Windows-MCP), TDD, Test fixing, Code review audit, k6 load testing, API contracts",
        skills: [
            "test-driven-development", "test-fixing", "code-review-checklist",
            "playwright-e2e-guru", "windows-desktop-control", "unit-test-synthesizer", "k6-load-testing-pro",
            "api-contract-tester", "agent-preset-conductor", "ai-product-partner"
        ]
    },
    "ai-agents": {
        id: "ai-agents",
        name: "AI & MCP Engineering",
        icon: "🤖",
        description: "MCP серверы, RAG, Prompt Engineering, архитектура агентов и управление контекстом",
        skills: [
            "mcp-builder", "prompt-engineering", "rag-implementation",
            "context-window-management", "ai-agents-architect", "agent-evaluation",
            "langgraph", "browser", "fl-freelance-agent", "agent-preset-conductor", "ai-product-partner"
        ]
    },
    "web-research": {
        id: "web-research",
        name: "Web Research & OSINT",
        icon: "🔍",
        description: "Глубокий поиск, извлечение контента, веб-скрапинг, OSINT и аналитика",
        skills: ["search-specialist", "deep-research-synthesizer", "web-scraper-harvester", "osint-recon-investigator", "agent-preset-conductor", "ai-product-partner"]
    },
    "reverse-engineering": {
        id: "reverse-engineering",
        name: "Reverse Engineering & Replica",
        icon: "🧬",
        description: "Полный Clean-Room цикл (11 скиллов Replica) + Electron ASAR реверс-инжиниринг",
        skills: [
            "replica-recon", "replica-architect", "replica-backend", "replica-brand",
            "replica-build", "replica-deploy", "replica-design", "replica-diff",
            "replica-entrepreneur", "replica-launch", "replica-test",
            "reverse-engineer-electron", "agent-preset-conductor", "ai-product-partner"
        ]
    },
    "product": {
        id: "product",
        name: "Product & Monetization",
        icon: "💎",
        description: "Стратегия монетизации, юнит-экономика, офферы, карточки товаров, анализ рынка, ценообразование и CRO",
        skills: [
            "product-monetization-strategy", "market-competitor-intelligence", "ai-product-partner",
            "browser", "search-specialist", "deep-research-synthesizer",
            "replica-entrepreneur", "replica-brand", "replica-launch",
            "form-cro", "ui-ux-pro-max", "seo-audit", "agent-preset-conductor"
        ]
    },
    "orchestrator": {
        id: "orchestrator",
        name: "Orchestrator & Multi-Agent",
        icon: "🎭",
        description: "Мультиагентная оркестрация, декомпозиция крупных проектов, параллельные субагенты с фиксированными пресетами, арбитраж и верификация",
        skills: [
            "subagent-orchestrator", "hierarchical-task-decomposer", "multi-agent-debate-consensus",
            "context-synthesis-reducer", "ai-agents-architect", "prompt-engineering",
            "context-window-management", "agent-evaluation", "langgraph",
            "code-review-checklist", "premortem-redteam", "ai-product-partner", "agent-preset-conductor"
        ]
    },
    "systems": {
        id: "systems",
        name: "Systems & High-Perf",
        icon: "⚡",
        description: "Modern C++20/C++23, C, Zig, Rust, RAII, ручное управление памятью, lock-free, SIMD, санитайзеры ASan/TSan, CMake и профилирование",
        skills: [
            "cpp-systems-architect", "systems-lowlevel-perf", "lockfree-concurrency-patterns",
            "rust-systems-safe", "memory-safety-patterns", "test-driven-development",
            "test-fixing", "code-review-checklist", "agent-preset-conductor"
        ]
    },
    "vst3": {
        id: "vst3",
        name: "VST3 & Audio DSP Studio",
        icon: "🎛️",
        description: "Разработка VST3/VST3i плагинов, синтезаторов и DSP эффектов: JUCE C++, real-time audio thread safety, SIMD, аудио UI/UX дизайн и мультиагентная оркестрация",
        skills: [
            "vst3-dsp-architect", "audio-plugin-ui-ux", "cpp-systems-architect",
            "systems-lowlevel-perf", "lockfree-concurrency-patterns",
            "subagent-orchestrator", "hierarchical-task-decomposer",
            "test-driven-development", "test-fixing", "code-review-checklist",
            "agent-preset-conductor"
        ]
    },
    "minimal": {
        id: "minimal",
        name: "Minimal Context",
        icon: "⚡",
        description: "Минимум токенов в системном промпте",
        skills: ["agent-preset-conductor", "ai-product-partner"]
    }
};

function loadConfig() {
    let cfg = {
        activePreset: "minimal",
        disabledSkills: [],
        customPresets: {}
    };
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        }
    } catch (_) {}
    if (cfg.activePreset === "all" || !PRESETS[cfg.activePreset]) {
        cfg.activePreset = "minimal";
    }
    return cfg;
}

function saveConfig(cfg) {
    try {
        const dir = path.dirname(CONFIG_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
    } catch (e) {
        console.error("[SkillManager] Failed to save config:", e);
    }
}

function estimateTokens(text) {
    if (!text) return 0;
    return Math.max(1, Math.round(text.length / 3.7));
}

function parseSkillMetadata(skillDir) {
    let skillFile = path.join(skillDir, "SKILL.md");
    let isEnabled = true;

    if (!fs.existsSync(skillFile)) {
        const disabledFile = path.join(skillDir, "SKILL.md.disabled");
        if (fs.existsSync(disabledFile)) {
            skillFile = disabledFile;
            isEnabled = false;
        } else {
            const lowerFile = path.join(skillDir, "skill.md");
            if (fs.existsSync(lowerFile)) {
                skillFile = lowerFile;
            } else {
                const lowerDisabled = path.join(skillDir, "skill.md.disabled");
                if (fs.existsSync(lowerDisabled)) {
                    skillFile = lowerDisabled;
                    isEnabled = false;
                } else {
                    return null;
                }
            }
        }
    }

    try {
        const content = fs.readFileSync(skillFile, "utf8");
        const dirName = path.basename(skillDir);
        let name = dirName;
        let description = "";

        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match) {
            const frontmatter = match[1];
            const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
            const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
            if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, "");
            if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, "");
        } else {
            const h1 = content.match(/^#\s+(.+)$/m);
            if (h1) name = h1[1].trim();
            description = content.substring(0, 300).trim();
        }

        const promptSnippet = `${name}: ${description}`;
        const promptTokens = estimateTokens(promptSnippet);
        const fullTokens = estimateTokens(content);

        return {
            id: dirName,
            name: name || dirName,
            description: description || "No description provided",
            dirPath: skillDir,
            filePath: skillFile,
            enabled: isEnabled,
            promptTokens,
            fullTokens
        };
    } catch (e) {
        return null;
    }
}

function scanDirectoryForSkills(baseDir, sourceTag) {
    const list = [];
    if (!baseDir || !fs.existsSync(baseDir)) return list;

    try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const fullPath = path.join(baseDir, entry.name);
                const skill = parseSkillMetadata(fullPath);
                if (skill) {
                    skill.source = sourceTag;
                    list.push(skill);
                }
            }
        }
    } catch (_) {}

    return list;
}

class SkillManager {
    constructor() {
        this.config = loadConfig();
    }

    getPresets() {
        return Object.values(PRESETS);
    }

    getActivePreset() {
        this.config = loadConfig();
        return this.config.activePreset || "minimal";
    }

    getSkills(workspacePath) {
        const skillsMap = new Map();

        // 1. Built-in Antigravity skills
        const builtinDir = path.join(USER_HOME, ".gemini", "antigravity", "builtin", "skills");
        scanDirectoryForSkills(builtinDir, "builtin").forEach(s => skillsMap.set(s.id, s));

        // 2. Global user skills (~/.gemini/config/skills)
        const globalSkillsDir = path.join(USER_HOME, ".gemini", "config", "skills");
        scanDirectoryForSkills(globalSkillsDir, "global").forEach(s => skillsMap.set(s.id, s));

        // 3. Plugin skills
        const pluginsDir = path.join(USER_HOME, ".gemini", "config", "plugins");
        if (fs.existsSync(pluginsDir)) {
            try {
                const pluginDirs = fs.readdirSync(pluginsDir, { withFileTypes: true });
                for (const p of pluginDirs) {
                    if (p.isDirectory()) {
                        const pluginSkillsDir = path.join(pluginsDir, p.name, "skills");
                        scanDirectoryForSkills(pluginSkillsDir, `plugin:${p.name}`).forEach(s => skillsMap.set(s.id, s));
                    }
                }
            } catch (_) {}
        }

        // 4. Workspace skills (if workspace provided)
        if (workspacePath && fs.existsSync(workspacePath)) {
            scanDirectoryForSkills(path.join(workspacePath, ".gemini", "skills"), "workspace").forEach(s => skillsMap.set(s.id, s));
            scanDirectoryForSkills(path.join(workspacePath, ".agents", "skills"), "workspace").forEach(s => skillsMap.set(s.id, s));
        }

        const skills = Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        
        let totalActiveTokens = 0;
        let activeCount = 0;

        for (const s of skills) {
            if (s.enabled) {
                totalActiveTokens += s.promptTokens;
                activeCount++;
            }
        }

        return {
            skills,
            totalActiveTokens,
            activeCount,
            totalCount: skills.length,
            presets: this.getPresets(),
            activePreset: this.getActivePreset()
        };
    }

    toggleSkill(dirPath, targetState) {
        try {
            if (!dirPath || !fs.existsSync(dirPath)) {
                return { success: false, error: "Path does not exist" };
            }

            const activeFile = path.join(dirPath, "SKILL.md");
            const disabledFile = path.join(dirPath, "SKILL.md.disabled");
            const lowerActive = path.join(dirPath, "skill.md");
            const lowerDisabled = path.join(dirPath, "skill.md.disabled");

            const safeRename = (src, dst) => {
                let attempts = 0;
                while (attempts < 5) {
                    try {
                        fs.renameSync(src, dst);
                        return true;
                    } catch (err) {
                        attempts++;
                        if ((err.code === "EBUSY" || err.code === "EPERM") && attempts < 5) {
                            const start = Date.now();
                            while (Date.now() - start < 30) {}
                        } else {
                            throw err;
                        }
                    }
                }
            };

            if (targetState === false) {
                // Disable
                if (fs.existsSync(activeFile)) {
                    safeRename(activeFile, disabledFile);
                } else if (fs.existsSync(lowerActive)) {
                    safeRename(lowerActive, lowerDisabled);
                }
            } else if (targetState === true) {
                // Enable
                if (fs.existsSync(disabledFile)) {
                    safeRename(disabledFile, activeFile);
                } else if (fs.existsSync(lowerDisabled)) {
                    safeRename(lowerDisabled, lowerActive);
                }
            }

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

        applyPreset(presetSkills, workspacePath) {
        const { skills } = this.getSkills(workspacePath);
        const targetSet = new Set(presetSkills || []);
        const ALWAYS_ACTIVE = new Set([
            "agent-preset-conductor",
            "grill-me",
            "systematic-debugging",
            "verification-before-completion",
            "concise-planning"
        ]);

        for (const s of skills) {
            const shouldBeActive = ALWAYS_ACTIVE.has(s.id) || targetSet.has(s.id);
            if (s.enabled !== shouldBeActive) {
                this.toggleSkill(s.dirPath, shouldBeActive);
            }
        }

        return this.getSkills(workspacePath);
    }

    applyPresetByName(name, workspacePath) {
        const key = (name || "").toLowerCase().trim();
        const presetObj = PRESETS[key];
        if (!presetObj) {
            return { success: false, error: `Неизвестный пресет: "${name}". Доступные (${Object.keys(PRESETS).length} пресетов): ${Object.keys(PRESETS).join(", ")}` };
        }

        const { skills } = this.getSkills(workspacePath);
        const targetSet = new Set(presetObj.skills);
        const ALWAYS_ACTIVE = new Set([
            "agent-preset-conductor",
            "grill-me",
            "systematic-debugging",
            "verification-before-completion",
            "concise-planning"
        ]);

        const activated = [];
        for (const s of skills) {
            const shouldBeActive = ALWAYS_ACTIVE.has(s.id) || targetSet.has(s.id);
            if (shouldBeActive) activated.push(s.id);
            if (s.enabled !== shouldBeActive) {
                this.toggleSkill(s.dirPath, shouldBeActive);
            }
        }

        this.config = loadConfig();
        this.config.activePreset = key;
        saveConfig(this.config);

        const updated = this.getSkills(workspacePath);
        return {
            success: true,
            preset: key,
            name: presetObj.name,
            icon: presetObj.icon,
            activeSkills: activated,
            totalActiveTokens: updated.totalActiveTokens,
            activeCount: updated.activeCount,
            totalCount: updated.totalCount
        };
    }


}

const skillManager = new SkillManager();

module.exports = {
    skillManager,
    PRESETS
};
