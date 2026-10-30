"use strict";
const fs = require("fs");
const path = require("path");

function detectProjectStack(workspacePath) {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
        return {
            id: "minimal",
            name: "Minimal Context",
            icon: "⚡",
            description: "Базовые инструменты архитектуры и продуктовой разработки",
            skills: ["agent-preset-conductor", "ai-product-partner"]
        };
    }

    try {
        const files = fs.readdirSync(workspacePath);
        const fileSet = new Set(files.map(f => f.toLowerCase()));

        // 1. DevOps / K8s / Docker-heavy repo
        if (fileSet.has("docker-compose.yml") || fileSet.has("dockerfile") || fileSet.has("k8s") || fileSet.has(".github")) {
            const hasCi = fs.existsSync(path.join(workspacePath, ".github", "workflows"));
            if (hasCi && !fileSet.has("package.json") && !fileSet.has("pyproject.toml")) {
                return {
                    id: "devops",
                    name: "DevOps & Cloud",
                    icon: "🐳",
                    description: "Контейнеризация Docker, Kubernetes и пайплайны CI/CD",
                    skills: ["docker-container-master", "k8s-manifest-generator", "github-actions-ci-cd", "agent-preset-conductor"]
                };
            }
        }

        // 2. Web Fullstack / Frontend
        if (fileSet.has("package.json")) {
            let pkgJson = {};
            try {
                pkgJson = JSON.parse(fs.readFileSync(path.join(workspacePath, "package.json"), "utf8"));
            } catch (_) {}

            const allDeps = {
                ...(pkgJson.dependencies || {}),
                ...(pkgJson.devDependencies || {})
            };

            const isNext = "next" in allDeps;
            const isReact = "react" in allDeps || isNext;
            const isVue = "vue" in allDeps || "nuxt" in allDeps;
            const isMcpOrAi = "@modelcontextprotocol/sdk" in allDeps || "langchain" in allDeps || "langgraph" in allDeps || "@google/genai" in allDeps;
            if (isMcpOrAi) {
                return {
                    id: "ai-agents",
                    name: "AI & MCP Engineering",
                    icon: "🤖",
                    description: "Разработка MCP серверов, RAG и архитектура AI агентов",
                    skills: ["mcp-builder", "prompt-engineering", "rag-implementation", "context-window-management", "ai-agents-architect", "agent-preset-conductor"]
                };
            }
            const isPlaywright = "@playwright/test" in allDeps || "playwright" in allDeps;

            if (isPlaywright && !isReact && !isVue) {
                return {
                    id: "qa",
                    name: "QA & Testing",
                    icon: "🧪",
                    description: "Автоматизированное E2E тестирование и синтез тестов",
                    skills: ["playwright-e2e-guru", "unit-test-synthesizer", "agent-preset-conductor"]
                };
            }

            return {
                id: "web",
                name: isNext ? "Web Modern (Next.js 15)" : isReact ? "Web Modern (React)" : isVue ? "Web Modern (Vue 3)" : "Web Modern (TS/Node)",
                icon: "🌐",
                description: "Next.js 15, React, Tailwind v4, Vue 3 и современные веб-компоненты",
                skills: ["nextjs-fullstack-guru", "tailwind-v4-master", "react-performance-opt", "vue-nuxt-expert", "agent-preset-conductor"]
            };
        }

        // 3. Backend & Highload: Python, Go, Rust, PostgreSQL
        if (fileSet.has("pyproject.toml") || fileSet.has("requirements.txt") || fileSet.has("cargo.toml") || fileSet.has("go.mod")) {
            let reqText = "";
            try {
                if (fileSet.has("requirements.txt")) reqText = fs.readFileSync(path.join(workspacePath, "requirements.txt"), "utf8").toLowerCase();
                if (fileSet.has("pyproject.toml")) reqText += fs.readFileSync(path.join(workspacePath, "pyproject.toml"), "utf8").toLowerCase();
            } catch (_) {}
            if (reqText.includes("mcp") || reqText.includes("langchain") || reqText.includes("chromadb") || reqText.includes("langgraph")) {
                return {
                    id: "ai-agents",
                    name: "AI & MCP Engineering",
                    icon: "🤖",
                    description: "Разработка MCP серверов, RAG и архитектура AI агентов",
                    skills: ["mcp-builder", "prompt-engineering", "rag-implementation", "context-window-management", "ai-agents-architect", "agent-preset-conductor"]
                };
            }
            const isRust = fileSet.has("cargo.toml");
            const isGo = fileSet.has("go.mod");
            return {
                id: "backend",
                name: isRust ? "Backend & Systems (Rust)" : isGo ? "Backend & Highload (Go)" : "Backend & DB (FastAPI)",
                icon: "⚙️",
                description: "PostgreSQL DBA, FastAPI async, Go параллелизм и безопасный Rust",
                skills: ["postgres-dba-optimizer", "fastapi-async-architect", "go-highload-services", "rust-systems-safe", "agent-preset-conductor"]
            };
        }

        // 4. Security / Reversing
        if (files.some(f => f.endsWith(".asar") || f.toLowerCase().includes("patch") || f.toLowerCase().includes("crack") || f.toLowerCase().includes("exploit"))) {
            return {
                id: "appsec",
                name: "AppSec & Reversing",
                icon: "🛡️",
                description: "OWASP аудит уязвимостей, реверс Electron/ASAR и Win32",
                skills: ["appsec-code-auditor", "reverse-engineer-electron", "win32-powershell-automation", "agent-preset-conductor"]
            };
        }
    } catch (err) {
        console.error("[StackDetector] Error analyzing directory:", err);
    }

    return {
        id: "minimal",
        name: "Minimal Context",
        icon: "⚡",
        description: "Универсальный профиль с минимальным расходом контекста",
        skills: ["agent-preset-conductor", "ai-product-partner"]
    };
}

module.exports = {
    detectProjectStack
};
