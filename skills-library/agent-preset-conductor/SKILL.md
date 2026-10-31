---
name: agent-preset-conductor
description: "MANDATORY GLOBAL META-ORCHESTRATOR. Must be evaluated by the agent on EVERY user request, even without explicit /agent-preset-conductor mention. Determines task domain, switches presets (web, backend, devops, appsec, qa, ai-agents, web-research, reverse-engineering, product, orchestrator, systems, vst3, minimal), and activates the grill-me skill in disputable/ambiguous situations."
---

# Agent Preset Conductor & Context Orchestrator

Автономный мета-оркестратор динамического управления контекстом.

## ⚡ ПРАВИЛО АВТОМАТИЧЕСКОЙ АКТИВАЦИИ
> [!IMPORTANT]
> Агент ОБЯЗАН применять логику `agent-preset-conductor` **на КАЖДЫЙ входящий запрос пользователя**, даже если пользователь не упомянул `/agent-preset-conductor` явно.
> На старте каждого ответа агент оценивает домен задачи и определяет целевой пресет.

---

## 🛑 АЛГОРИТМ ПРИНЯТИЯ РЕШЕНИЙ

### ⚡ ЖЕСТКИЙ ПРИОРИТЕТ ДЛЯ VST3 / VST3i (HARD KEYWORD ROUTING)
> [!IMPORTANT]
> При обнаружении в запросе пользователя ЛЮБОГО из ключевых маркеров:
> **`vst3`, `vst3i`, `vst`, `juce`, `audio plugin`, `аудиоплагин`, `dsp плагин`, `синтезатор vst`, `audioplugin`, `vst3 sdk`**:
> 
> 1. Агент **ОБЯЗАН БЕЗУСЛОВНО И НЕМЕДЛЕННО** переключиться на пресет `vst3` (`VST3 & Audio DSP Studio`).
> 2. **ЗАПРЕЩЕНО** путать этот домен с `systems`, `orchestrator` или `web`.
> 3. **ЗАПРЕЩЕНО** запускать лишние согласования — домен аудиоплагинов однозначен и требует совмещения DSP (C++/JUCE), аудио UI/UX и мультиагентной координации!

### 1. Однозначный домен (Clear Domain)
Если задача на 100% относится к конкретному стеку технологий (только CI/CD, только API/БД, только Web UI):
> [!NOTE]
> **Anti-Single-Subagent Rule**: Если задача монодоменная, НЕ используйте пресет `orchestrator` для запуска одного субагента! Переключайтесь напрямую на специализированный пресет (`devops`, `backend`, `web`, `qa`) и решайте задачу в основном диалоге.

1. Вывести в чат обязательный лаконичный бейдж:
   `🎯 [Смена пресета: <Имя>] Причина: <технологии и цель задачи>`
2. Выполнить переключение:
   `python "%USERPROFILE%\.gemini\config\skills\agent-preset-conductor\scripts\switch.py" <preset_name>`
3. Дождаться подтверждения и приступать к решению.

### 2. Мультидоменная координация vs Согласование
* **Спорная ситуация или неясные требования** $\to$ **ВКЛЮЧИТЬ `grill-me`**:
  Если требования допускают несколько альтернативных путей реализации или выбор пресета неочевиден:
  1. Объявить в чате: `🎯 [Смена пресета: Согласование] Активирован протокол grill-me для разрешения спорных моментов`
  2. Запустить интерактивное интервью через `ask_question` (по одному вопросу за раз).
* **Масштабный проект или параллельный веер (2+ субагента)** $\to$ **Пресет `orchestrator`**:
  Использовать пресет `orchestrator` ТОЛЬКО тогда, когда требуется декомпозиция на параллельные независимые подзадачи (Concurrent Fan-Out) или кросс-доменная координация команды субагентов.
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

## 🧭 МАТРИЦА 13 ПРЕСЕТОВ
| Пресет (`ID`) | Название | Маркеры технологий и задачи | Ключевые скиллы пресета |
|---|---|---|---|
| `web` | Web Modern | React, Next.js, Vue, Nuxt, Tailwind v4, CSS, HTML, UI/UX дизайн, frontend-design, Web Vitals, SEO, CRO форм, TanStack Query | `ui-ux-pro-max`, `frontend-design`, `react-best-practices`, `nextjs-fullstack-guru`, `tailwind-v4-master`, `seo-audit`, `form-cro` |
| `backend` | Backend & DB | PostgreSQL, SQL, базы данных, схемы данных, REST/GraphQL API дизайн, FastAPI, Python backend, Node.js, Go highload, Rust systems | `postgres-dba-optimizer`, `fastapi-async-architect`, `database-design`, `api-design-principles`, `nodejs-best-practices`, `go-highload-services`, `rust-systems-safe` |
| `devops` | DevOps & Cloud | Docker multi-stage, Kubernetes, GitHub Actions CI/CD, Terraform IaC, AWS Serverless, Helm, инциденты SRE, деплой-процедуры, Observability | `docker-container-master`, `k8s-manifest-generator`, `github-actions-ci-cd`, `terraform-iac-architect`, `incident-responder`, `deployment-procedures`, `aws-serverless` |
| `appsec` | AppSec & Reversing | OWASP Top-10, аудит уязвимостей, фаззинг API, перехват сетевого трафика (mitmproxy), декомпиляция Electron ASAR, Win32/PowerShell безопасность, автоматизация рабочего стола Windows | `appsec-code-auditor`, `top-web-vulnerabilities`, `api-security-best-practices`, `ethical-hacking-methodology`, `reverse-engineer-electron`, `windows-desktop-control` |
| `qa` | QA & Testing | Playwright E2E тесты, автоматизация десктопа Windows (Windows-MCP), TDD цикл, исправление тестов, нагрузка k6, Code Review | `playwright-e2e-guru`, `windows-desktop-control`, `test-driven-development`, `test-fixing`, `code-review-checklist`, `unit-test-synthesizer`, `k6-load-testing-pro` |
| `ai-agents` | AI & MCP Engineering | Создание MCP серверов (Model Context Protocol), Prompt Engineering, RAG архитектура, управление контекстным окном, LangGraph, оценка агентов | `mcp-builder`, `prompt-engineering`, `rag-implementation`, `context-window-management`, `ai-agents-architect`, `agent-evaluation`, `langgraph` |
| `web-research` | Web Research & OSINT | Высокоточный веб-поиск (native search), сбор данных, OSINT расследования, аналитика без мусора | `search-specialist`, `deep-research-synthesizer`, `web-scraper-harvester`, `osint-recon-investigator` |
| `reverse-engineering` | Reverse Engineering & Replica | Полный Clean-Room цикл клонирования приложений (Replica pack: recon, architect, backend, design, build, test, deploy) + Electron ASAR | Полная пачка из 11 скиллов `replica-*` + `reverse-engineer-electron` |
| `product` | Product & Monetization | Стратегия монетизации, тарифы/pricing, юнит-экономика LTV/CAC, карточки товаров, офферы, анализ рынка и конкурентов, CRO | `product-monetization-strategy`, `market-competitor-intelligence`, `ai-product-partner`, `browser`, `search-specialist`, `deep-research-synthesizer`, `replica-entrepreneur`, `replica-brand`, `replica-launch`, `form-cro`, `ui-ux-pro-max`, `seo-audit` |
| `orchestrator` | Orchestrator & Multi-Agent | Масштабные мультидоменные проекты, координация команды субагентов, параллельная разработка с компиляцией изолированных пресетов | `subagent-orchestrator`, `hierarchical-task-decomposer`, `multi-agent-debate-consensus`, `context-synthesis-reducer`, `ai-agents-architect`, `prompt-engineering`, `langgraph`, `code-review-checklist`, `premortem-redteam` |
| `systems` | Systems & High-Perf | C++, C, Zig, Rust, ассемблер, RAII, ручное управление памятью, lock-free многопоточность, SIMD, санитайзеры ASan/TSan, CMake/Ninja, низкоуровневая оптимизация и профилирование | `cpp-systems-architect`, `systems-lowlevel-perf`, `lockfree-concurrency-patterns`, `rust-systems-safe`, `memory-safety-patterns`, `test-driven-development`, `test-fixing`, `code-review-checklist` |
| `vst3` | VST3 & Audio DSP Studio | VST3/VST3i плагины, синтезаторы, DSP эффекты, JUCE C++, real-time audio thread safety, кастомный LookAndFeel и аудио UI/UX дизайн | `vst3-dsp-architect`, `audio-plugin-ui-ux`, `cpp-systems-architect`, `systems-lowlevel-perf`, `lockfree-concurrency-patterns`, `subagent-orchestrator`, `hierarchical-task-decomposer`, `test-driven-development`, `test-fixing`, `code-review-checklist` |
| `minimal` | Minimal Context | Свободный диалог, концептуальные обсуждения, задачи без специфики конкретного стека. Максимальная экономия контекста | Только фундаментальные глобальные скиллы качества |

> [!NOTE]
> Фундаментальные скиллы качества (`grill-me`, `systematic-debugging`, `verification-before-completion`, `concise-planning`) и сам `agent-preset-conductor` **всегда активны** во всех пресетах и никогда не отключаются.
