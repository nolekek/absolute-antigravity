---
name: subagent-orchestrator
description: "Master multi-agent orchestration skill for Antigravity. Drives large-scale projects by briefing users via grill-me, decomposing architecture into subtasks, dynamically defining specialized subagents with compiled preset profiles, managing asynchronous execution, milestone reporting, and conducting final verification."
risk: low
source: antigravity-orchestrator-core (Apache 2.0)
date_added: 2026-10-31
---

# Subagent Orchestrator & Team Conductor

The **Subagent Orchestrator** skill governs end-to-end execution of large, complex, and multi-domain engineering tasks within Antigravity. It enables an agent to operate as a Chief Technical Lead and Multi-Agent Orchestrator, dynamically spawning, configuring, and coordinating worker subagents.

---

## 🏛️ Core Architectural Invariants

1. **Initial Alignment & Risk Briefing (`grill-me`)**:
   - Before writing code or spawning subagents, the orchestrator MUST analyze risks, edge cases, and architectural trade-offs.
   - Surface ambiguities and critical decisions to the user using the `grill-me` protocol (`ask_question` or structured dialog).
   - Once the user aligns and confirms, proceed autonomously.

2. **Subagent Preset Profile Compilation**:
   - Subagents do NOT toggle global files in `~/.gemini/config/skills/` (preventing filesystem race conditions and context bleed).
   - Instead, the orchestrator dynamically compiles the target preset's domain instructions, standards, and rules directly into the `SystemPrompt` parameter of `define_subagent`.

3. **Hybrid Workspace Isolation**:
   - `Workspace: 'inherit'`: Used for linear tasks, exploratory research, or read-only analysis.
   - `Workspace: 'branch'` or `'share'`: Mandatory when multiple worker subagents perform parallel code edits, isolating git state and preventing file collisions until review and merge.

4. **Autonomous Reactive Execution & Milestone Updates**:
   - Do NOT poll or busy-wait. Workers communicate asynchronously via `send_message` or completion events.
   - After each completed milestone, emit a concise user update:
     `📢 [Этап завершен: <Имя Субагента>] <Результаты, артефакты и следующий шаг>`

5. **Strict Pre-Merge Code Review & Test Verification**:
   - No subagent work is committed or merged without inspection.
   - Always run the master verification test runner (`node tests/run_all.js`) before claiming completion.

---

## 🔄 The 6-Phase Orchestration Lifecycle

### Phase 1: User Briefing & Alignment (grill-me)
- Scan the user's requirements for ambiguities, breaking changes, or scope creep.
- Formulate high-value questions via `ask_question` (one question per turn, `(Recommended)` first).
- Present an architectural summary and risk warning before delegating work.

### Phase 2: Hierarchical MECE Task Decomposition
- Decompose the project into Mutually Exclusive, Collectively Exhaustive (MECE) subtasks.
- Formulate explicit contract boundaries:
  - File/folder ownership (which subagent edits which files).
  - Data contracts (TypeScript interfaces, schemas, mock contracts).
  - Verification criteria (which unit/integration tests must pass).

### Phase 3: Dynamic Subagent Registration (`define_subagent`)
Compile the required preset persona into `define_subagent`:

```javascript
// Example: Registering a Backend Specialist Subagent
define_subagent({
  Name: "backend-specialist",
  Description: "Specialist in PostgreSQL, highload APIs, and database schemas",
  EnableWriteTools: true,
  EnableMCPTools: true,
  EnableSubagentTools: false, // Prevent nested recursion
  SystemPrompt: `
You are a Senior Backend & Database Specialist operating under the 'backend' preset profile.
Rules:
- Enforce strict database normalization and migration integrity.
- Build clean REST/FastAPI/Node.js endpoints adhering to contract types.
- Follow Section 5 Workspace Hygiene: zero disposable scripts in root workspace.
- Validate changes with tests before signaling completion.
`
});
```

### Phase 4: Subagent Invocation & Monitoring (`invoke_subagent`)
- Invoke worker subagents:
  ```javascript
  invoke_subagent({
    TypeName: "backend-specialist",
    Role: "Database & API Engineer",
    Workspace: "branch", // or "inherit" for linear flow
    Model: "inherit",
    Prompt: "Implement the OAuth account rotation endpoint and migration scripts as per CONTRACT.md."
  });
  ```
- Yield turn without polling. The system will resume execution automatically when the subagent responds.

### Phase 5: Synthesis, Review & Conflict Resolution
- Upon subagent completion, inspect the git diff and created artifacts.
- Verify adherence to `code-review-checklist`.
- Merge branch changes into the primary workspace branch cleanly.

### Phase 6: Global Verification & Handover
- Execute project verification (`node tests/run_all.js` or domain-specific test suites).
- Generate a final delivery report summarizing changes, architecture, and verification proof.
