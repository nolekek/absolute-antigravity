# Autonomous Conductor & Preset Routing Rules

The agent MUST ALWAYS evaluate and follow the `agent-preset-conductor` workflow on EVERY user request, even when the user does not explicitly type `/agent-preset-conductor`.

## Core Routing Rules

1. **Autonomous Evaluation**:
   At the start of EVERY user request, analyze the request to determine the required domain and tech stack.

2. **Clear Domain Execution**:
   If the domain is clear and unambiguous (Web, Backend, DevOps, AppSec, QA, AI-Agents, Web-Research, Reverse-Engineering, Product, Orchestrator, Minimal):
   - Output the badge: `🎯 [Смена пресета: <Имя Пресета>] Причина: <технологии и цель задачи>`
   - Execute the switch script: `python "%USERPROFILE%\.gemini\config\skills\agent-preset-conductor\scripts\switch.py" <preset_name>`
   - Proceed with task execution using the newly active specialized tools.

3. **Disputable & Mixed Situations -> Activate `grill-me`**:
   Whenever a task:
   - Sits on the boundary between domains (e.g. Web UI + Playwright E2E testing, Backend API + DevOps deployment);
   - Contains ambiguous, competing, or underspecified requirements;
   - Has multiple architectural directions with trade-offs:
   
   **The agent MUST NOT guess or switch silently.** The agent MUST immediately activate the `grill-me` protocol:
   - Announce: `🎯 [Смена пресета: Согласование] Активирован протокол grill-me для разрешения спорных моментов`
   - Interview the user using the `ask_question` tool, asking exactly one question per turn with `(Recommended)` first.
   - Once aligned, switch to the chosen preset and continue.

4. **Continuous Global Quality**:
   The meta-skills `agent-preset-conductor`, `grill-me`, `systematic-debugging`, `verification-before-completion`, and `concise-planning` are permanent foundational skills and must remain active in all presets.


5. **Workspace Hygiene & Anti-Pollution Invariant**:
   - Zero Disposable Scripts: The agent must NEVER generate ad-hoc research, scraping, or temporary scripts (`.py`, `.js`, `.sh`, etc.) in the user's workspace root directory.
   - Native Tools First: For web research, documentation lookups, and internet queries, ALWAYS prioritize the native `search_web` tool over writing custom scraping scripts.
   - Scratch Directory Mandate: If exploratory scripts or local data parsing are strictly needed, store them exclusively in `<appDataDir>\brain\<conversation-id>\scratch\`, never polluting the user workspace.
