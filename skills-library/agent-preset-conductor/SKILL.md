---
name: agent-preset-conductor
description: "MANDATORY GLOBAL META-ORCHESTRATOR. Must be evaluated by the agent on EVERY user request, even without explicit /agent-preset-conductor mention. Determines task domain, switches presets (web, backend, devops, appsec, qa, ai-agents, web-research, reverse-engineering, minimal), and activates the grill-me skill in disputable/ambiguous situations."
---

# Agent Preset Conductor & Context Orchestrator

Автономный мета-оркестратор динамического управления контекстом.

## ⚡ ПРАВИЛО АВТОМАТИЧЕСКОЙ АКТИВАЦИИ
> [!IMPORTANT]
> Агент ОБЯЗАН применять логику `agent-preset-conductor` **на КАЖДЫЙ входящий запрос пользователя**, даже если пользователь не упомянул `/agent-preset-conductor` явно.
> На старте каждого ответа агент оценивает домен задачи и определяет целевой пресет.

---

## 🛑 АЛГОРИТМ ПРИНЯТИЯ РЕШЕНИЙ

### 1. Однозначный домен (Clear Domain)
Если задача на 100% относится к конкретному стеку технологий:
1. Вывести в чат обязательный лаконичный бейдж:
   `🎯 [Смена пресета: <Имя>] Причина: <технологии и цель задачи>`
2. Выполнить переключение:
   `python "%USERPROFILE%\.gemini\config\skills\agent-preset-conductor\scripts\switch.py" <preset_name>`
3. Дождаться подтверждения и приступать к решению.

### 2. Спорная ситуация или стык технологий -> ВКЛЮЧИТЬ `grill-me`
> [!IMPORTANT]
> Если задача находится на стыке доменов (например, «создай форму и напиши Playwright тест» — Web или QA?), требования допускают несколько альтернативных путей реализации или выбор пресета неочевиден:
> 
> **Агент ОБЯЗАН немедленно активировать скилл `grill-me`**:
> 1. Объявить в чате:
>    `🎯 [Смена пресета: Согласование] Активирован протокол grill-me для разрешения спорных моментов`
> 2. Запустить интерактивное интервью через инструмент `ask_question`.
> 3. Задавать строго по **одному вопросу за раз**, помещая рекомендованный вариант первым с префиксом `(Recommended)`.
> 4. После того как пользователь сделает выбор — переключиться на согласованный пресет и продолжить работу.

### 3. Стабильность (No Churn)
Если текущий активный пресет уже содержит нужные инструменты, или запрос является промежуточным (мелкий вопрос, просмотр файлов), пресет не меняется.

---

## 🧭 МАТРИЦА 9 ПРЕСЕТОВ
| Пресет (`ID`) | Название | Маркеры технологий и задачи | Ключевые скиллы пресета |
|---|---|---|---|
| `web` | Web Modern | React, Next.js, Vue, Nuxt, Tailwind v4, CSS, HTML, UI/UX дизайн, frontend-design, Web Vitals, SEO, CRO форм, TanStack Query | `ui-ux-pro-max`, `frontend-design`, `react-best-practices`, `nextjs-fullstack-guru`, `tailwind-v4-master`, `seo-audit`, `form-cro` |
| `backend` | Backend & DB | PostgreSQL, SQL, базы данных, схемы данных, REST/GraphQL API дизайн, FastAPI, Python backend, Node.js, Go highload, Rust systems | `postgres-dba-optimizer`, `fastapi-async-architect`, `database-design`, `api-design-principles`, `nodejs-best-practices`, `go-highload-services`, `rust-systems-safe` |
| `devops` | DevOps & Cloud | Docker multi-stage, Kubernetes, GitHub Actions CI/CD, Terraform IaC, AWS Serverless, Helm, инциденты SRE, деплой-процедуры, Observability | `docker-container-master`, `k8s-manifest-generator`, `github-actions-ci-cd`, `terraform-iac-architect`, `incident-responder`, `deployment-procedures`, `aws-serverless` |
| `appsec` | AppSec & Reversing | OWASP Top-10, аудит уязвимостей, фаззинг API, перехват сетевого трафика (mitmproxy), декомпиляция Electron ASAR, Win32/PowerShell безопасность | `appsec-code-auditor`, `top-web-vulnerabilities`, `api-security-best-practices`, `ethical-hacking-methodology`, `reverse-engineer-electron`, `network-traffic-intercept` |
| `qa` | QA & Testing | Playwright E2E тесты, TDD цикл Red-Green-Refactor, исправление упавших тестов (test-fixing), нагрузочное тестирование k6, аудит Code Review | `playwright-e2e-guru`, `test-driven-development`, `test-fixing`, `code-review-checklist`, `unit-test-synthesizer`, `k6-load-testing-pro`, `api-contract-tester` |
| `ai-agents` | AI & MCP Engineering | Создание MCP серверов (Model Context Protocol), Prompt Engineering, RAG архитектура, управление контекстным окном, LangGraph, оценка агентов | `mcp-builder`, `prompt-engineering`, `rag-implementation`, `context-window-management`, `ai-agents-architect`, `agent-evaluation`, `langgraph` |
| `web-research` | Web Research & OSINT | Глубокий веб-поиск, сбор данных, веб-скрапинг (Playwright/Cheerio), OSINT расследования, анализ конкурентов | `deep-research-synthesizer`, `web-scraper-harvester`, `osint-recon-investigator`, `replica-entrepreneur` |
| `reverse-engineering` | Reverse Engineering & Replica | Полный Clean-Room цикл клонирования приложений (Replica pack: recon, architect, backend, design, build, test, deploy) + Electron ASAR | Полная пачка из 11 скиллов `replica-*` + `reverse-engineer-electron` |
| `minimal` | Minimal Context | Свободный диалог, концептуальные обсуждения, задачи без специфики конкретного стека. Максимальная экономия контекста | Только фундаментальные глобальные скиллы качества |

> [!NOTE]
> Фундаментальные скиллы качества (`grill-me`, `systematic-debugging`, `verification-before-completion`, `concise-planning`) и сам `agent-preset-conductor` **всегда активны** во всех пресетах и никогда не отключаются.
