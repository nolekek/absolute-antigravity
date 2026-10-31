# Antigravity Workspace Invariants & Conductor Rules

This file defines mandatory workspace-level guardrails, architectural invariants, and behavioral rules for any AI agent or developer operating within this repository.

---

## 1. Preset Conductor Automation & Grill-Me Protocol
- **Autonomous Evaluation**: Every incoming user request must be evaluated for its target technical domain, even if the user did not explicitly mention `/agent-preset-conductor`.
- **Announcement Invariant**: Before executing any preset switch, the agent must output a concise badge in chat:
  `🎯 [Смена пресета: <Имя Пресета>] Причина: <технологии и цель задачи>`
- **Disputable & Mixed Situations**: Whenever a task touches multiple domains (e.g., Web UI + Playwright E2E, Backend API + DevOps CI/CD) or requirements have multiple trade-offs:
  - **NEVER guess blindly or switch presets silently.**
  - **Immediately trigger the `grill-me` protocol**: announce `🎯 [Смена пресета: Согласование] Активирован протокол grill-me для разрешения спорных моментов` and interview the user using `ask_question` (one question at a time, `(Recommended)` first).

---

## 2. No "All-Inclusive" Preset
- The `all` ("Все включено") preset is permanently retired to eliminate prompt bloat and context rot.
- The system strictly maintains 13 focused presets:
  `web`, `backend`, `devops`, `appsec`, `qa`, `ai-agents`, `web-research`, `reverse-engineering`, `product`, `orchestrator`, `systems`, `vst3`, `minimal`.
- Automatic fallback in `loadConfig()` must route invalid or legacy `all` configs to `minimal`.

---

## 3. Permanent Foundational Skills (`ALWAYS_ACTIVE`)
The following 5 meta-skills are fundamental quality guardrails and must NEVER be disabled, regardless of which preset is active:
1. `agent-preset-conductor` (domain classification and IPC routing)
2. `grill-me` (interactive interview & requirement alignment)
3. `systematic-debugging` (4-phase root-cause debugging without guesswork)
4. `verification-before-completion` (mandatory test/log verification before claiming success)
5. `concise-planning` (atomic checklists and planning artifacts)

---

## 4. Test Verification Invariant
- Any changes to `skillManager.js`, `multiaccManager.js`, `preload.js`, `credHelper.py`, or `stackDetector.js` must be verified by running the complete master test runner:
  ```bash
  node tests/run_all.js
  ```
- **100% PASS (79/79 tests)** is a non-negotiable invariant before committing or deploying updates.


---

## 5. Workspace Hygiene & Anti-Pollution Invariant
- **Zero Disposable Scripts in Workspace**: Agents must NEVER generate ad-hoc research, test, or scraping scripts (`.py`, `.js`, `.sh`, etc.) in the user's project root directory.
- **Native Tools First**: For web searches, documentation lookups, and public web intelligence, ALWAYS utilize the native `search_web` tool over creating custom scrapers.
- **Scratch Directory Mandate**: If exploratory scripts or local data parsing are strictly needed, store and run them exclusively in `<appDataDir>\brain\<conversation-id>\scratch\`, keeping the workspace pristine.

---

## 6. Mandatory Subagent Dispatch Invariant (Пресет Orchestrator)
- **Zero In-Place Feature Coding**: When the active preset is `orchestrator`, the main agent is STRICTLY PROHIBITED from writing feature implementation code directly in the main conversation context.
- **Mandatory Subagent Delegation**: The agent MUST act exclusively as Team Lead & Orchestrator:
  1. Brief and align requirements with the user via `grill-me`.
  2. Decompose the architecture into modular subtasks with clear file ownership.
  3. Register specialized subagents (`define_subagent`) using the pre-compiled native profiles (`subagents_manifest.json`) or compiled preset profiles with embedded `<skills>` blocks.
  4. Launch execution via `invoke_subagent` and yield the turn.
  5. Merge deliverables, review code, and verify with tests before reporting completion.
- Writing feature implementation code in the orchestrator dialogue instead of delegating to subagents is a violation of the orchestrator role.

### 6.1. Concurrent Multi-Agent Fan-Out Mandate
- **Запрет искусственной последовательности**: Если этап или задача декомпозируется на две или более независимые подзадачи (например: Frontend UX + Backend API, Интеграция экшена + Синтетический бенчмарк-сьют, Парсер логов + Схемы данных):
  - Оркестратор **ОБЯЗАН вызывать `invoke_subagent` для нескольких субагентов одновременно в рамках ОДНОГО хода**.
  - Для параллельных субагентов, изменяющих код, использовать изоляцию `Workspace: 'branch'` или строго разграниченные файлы (MECE File Ownership).
  - Завершать ход без лишних промежуточных действий, позволяя системе запустить субагентов в параллельном фоновом режиме.
  - По возвращении результатов от всех параллельных агентов — проводить ревью diff'ов, разрешение конфликтов и единый прогон тестов.

### 6.2. Anti-Single-Subagent Invariant & Focused Preset Routing
- **Запрет одиночного субагента в Orchestrator**: Пресет `orchestrator` предназначен ИСКЛЮЧИТЕЛЬНО для:
  1. Кросс-доменных задач, затрагивающих 2 и более области (например, Backend + Frontend, DevOps + QA).
  2. Параллельного веерного запуска нескольких субагентов (Concurrent Multi-Agent Fan-Out).
- **Прямое выполнение в целевом пресете**: Если текущая задача полностью укладывается в рамки ОДНОГО технического домена (например, только написать GitHub Action, только обновить CSS, только написать SQL-миграцию):
  - Оркестратор **НЕ ДОЛЖЕН оставаться в `orchestrator` и спавнить одного субагента**.
  - Агент **ОБЯЗАН переключить пресет** через `agent-preset-conductor` на специализированный (`devops`, `backend`, `web`, `qa` и т.д.) и выполнить задачу напрямую в основном диалоге со специализированными скиллами без лишних задержек и накладных расходов.
