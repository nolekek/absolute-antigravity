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
- The system strictly maintains 9 focused presets:
  `web`, `backend`, `devops`, `appsec`, `qa`, `ai-agents`, `web-research`, `reverse-engineering`, `minimal`.
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
