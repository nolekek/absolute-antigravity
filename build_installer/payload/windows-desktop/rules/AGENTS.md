# Windows Desktop Automation Rules

When interacting with the Windows operating system via the `windows-desktop` tools:

## 1. Inspect Before Acting
- Always call `State` (or `Screenshot`) to locate UI elements and their coordinates before invoking `Click` or `Type`.
- Never guess coordinates blindly.
- If an application is not focused, use the `App` tool to focus or launch the window first.

## 2. Safe Execution & User Control
- Do NOT close critical system processes or windows without explicit instruction.
- When performing sequential interactions, confirm state changes between steps.
- Avoid rapid clicking that could trigger race conditions or accidental double-clicks.

## 3. Web & Browser Targets
- For web pages inside Chrome, Edge, or Firefox, use `State` with `use_dom=true` to isolate page content from browser frame controls.
