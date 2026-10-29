---
name: agent-preset-conductor
description: Autonomous preset orchestrator. Enables the agent to dynamically switch active skill presets (web, backend, devops, appsec, qa, web-research, reverse-engineering, minimal) via local HTTP IPC bridge (51122).
---

# Agent Preset Conductor

Autonomous meta-skill for dynamic context orchestration. Allows the agent to switch active skill presets during multi-turn workflows when transitioning across domains (e.g., from DB architecture to Playwright testing).

## Instructions for Agent
1. When a task requires specialized expertise or shifts domains:
   - Web frontend / React / Next / Tailwind / TanStack -> `web`
   - Backend APIs / Database / Go / Rust / Redis / Kafka -> `backend`
   - Containers / K8s / CI-CD / Terraform / Observability -> `devops`
   - Security auditing / ASAR / PowerShell / Network intercept / API fuzzer -> `appsec`
   - Test suites / Playwright / QA / k6 load / API contracts -> `qa`
   - Deep search / OSINT / Web scraping / Market intelligence -> `web-research`
   - Reverse engineering / Clean-Room Replica clone / Electron ASAR -> `reverse-engineering`
   - General discussion / Minimal context -> `minimal`
   - All tools enabled -> `all`
2. Run the switch script:
   `python scripts/switch.py <preset_name>`
3. Check the output confirmation before using new specialized skills.
