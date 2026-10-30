---
name: agent-preset-conductor
description: Autonomous preset orchestrator. Enables the agent to dynamically switch active skill presets (web, backend, devops, appsec, qa, ai-agents, web-research, reverse-engineering, minimal) via local HTTP IPC bridge (51122) or atomic filesystem fallback.
---

# Agent Preset Conductor

Автономный мета-оркестратор динамического управления контекстом. Позволяет агенту активировать специализированные профили навыков (пресеты) без засорения системного промпта нерелевантными инструментами.

---

## 🛑 ЖЕЛЕЗНЫЕ ПРАВИЛА ВЫБОРА И ПЕРЕКЛЮЧЕНИЯ ПРЕСЕТОВ

### 1. Правило однозначного домена (Single Clear Domain)
Если задача на 100% относится к конкретному стеку технологий:
1. **ОБЯЗАТЕЛЬНО вывести в чат лаконичный бейдж перед вызовом скрипта**:
   `🎯 [Смена пресета: <Название Пресета>] Причина: <Четкое обоснование: ключевые технологии и цель задачи>`
2. Выполнить команду:
   `python "%USERPROFILE%\.gemini\config\skills\agent-preset-conductor\scripts\switch.py" <preset_name>`
3. Дождаться подтверждения переключения и продолжать решение задачи.

### 2. Правило стыковых и неоднозначных задач (Ambiguity Prohibition)
> [!CAUTION]
> **СТРОГО ЗАПРЕЩЕНО** угадывать пресет вслепую, если задача:
> - Находится на стыке двух доменов (например, «создай форму на React и напиши к ней тест на Playwright» — это Web или QA?);
> - Не содержит явных маркеров стека (например, «оптимизируй производительность приложения»);
> - Смешивает архитектуру, бэкенд и облачный деплой.

**Действие агента при сомнениях:**
НЕ вызывать `switch.py`! Задать пользователю прямой вопрос в чате:
*«Данная задача затрагивает [Домен 1] и [Домен 2]. Какой пресет активировать для работы: `<preset1>` или `<preset2>`?»*

### 3. Правило стабильности (No Churn)
- Не переключать пресет, если текущий активный пресет уже содержит нужные инструменты.
- Не переключать пресет ради тривиальных операций (git commit, просмотр одного файла, формулировка ответа).

---

## 🧭 МАТРИЦА ПРЕСЕТОВ И МАРКЕРЫ ТЕХНОЛОГИЙ

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
> Фундаментальные скиллы качества (`systematic-debugging`, `verification-before-completion`, `concise-planning`) и сам `agent-preset-conductor` **всегда активны** во всех пресетах и никогда не отключаются.
