# Project: Antigravity Multi-Account Fix & Production Packaging

## Architecture
Antigravity is an Electron-based desktop client wrapping a Go language server backend (`language_server.exe`), a Python credential helper (`credHelper.py`), and a frontend user interface injected via `preload.js`.

- **Renderer Process (`preload.js`)**: Injects `#antigravity-multiacc-root` title bar widget (`[1/3]`), handles 1-click rotation, dropdown account switching, slot deletion, and OAuth cancellation. Interacts with main process via `window.multiacc` context bridge.
- **Main Process (`main.js`, `ipcHandlers.js`, `multiaccManager.js`, `utils.js`)**: Manages window lifecycle, webview sessions, navigation interception (`will-navigate`, `will-redirect`, `will-frame-navigate`, `setWindowOpenHandler`, `webRequest.onBeforeRequest`), dispatches Python credential helper commands, and monitors language server output.
- **Language Server (`languageServer.js`, `language_server.exe`)**: Executes backend tasks, communicates with Google APIs. Requires `ANTIGRAVITY_VSCODE_HOST=1` to delegate OAuth URL opening to Electron rather than launching raw browser directly. Emits stdout/stderr lines checked for gRPC `ResourceExhausted` and HTTP 429 errors.
- **Credential Manager & Keyring (`credHelper.py`, `advapi32.dll`)**: Persists credentials in Windows Credential Manager under `gemini:antigravity` (active target consumed by language server) and `gemini:antigravity_slot_1..4` (persistent account slots). Enforces zero-gap compaction upon slot deletion.
- **Packaging Pipeline (`asar`)**: Builds `app.asar` from `asar_extracted/` using `--unpack "{**/chrome-devtools-mcp/**,**/credHelper.py}"` and updates installed production binaries in `%LOCALAPPDATA%\Programs\antigravity\resources\`.

## Code Layout
- `.\asar_extracted\dist\`: Canonical source tree for application modifications
  - `dist\main.js`: Application lifecycle, window creation, `web-contents-created` handlers
  - `dist\preload.js`: Context bridge and `#antigravity-multiacc-root` UI widget
  - `dist\languageServer.js`: Language server spawn, `ANTIGRAVITY_VSCODE_HOST` env, stdout/stderr error streaming
  - `dist\multiaccManager.js`: Multi-account orchestration, switching, failover debounce, add/delete flows
  - `dist\credHelper.py`: Win32 Credential Manager API, compaction, migration, slot management
  - `dist\utils.js`: URL parsing, `ensureAccountSelection`, `isAuthUrl`, `configureAuthInterception`
  - `dist\beyondcorpPac.js`: Proxy configuration preserving auth interception
  - `dist\ipcHandlers.js`: IPC endpoints for multiacc actions
- `.\tests\`: E2E test track workspace
- `.\app.asar`: Packaged ASAR archive
- `.\app.asar.unpacked\`: Unpacked assets (`dist\credHelper.py`, `node_modules\chrome-devtools-mcp`)
- `%LOCALAPPDATA%\Programs\antigravity\resources\`: Production deployment target

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Strict External Browser OAuth Launch | Opening "+ Добавить" strictly delegates OAuth URL to external default system browser via `shell.openExternal`. | M1 | R1, Survey E1 |
| 2 | Internal Auth Navigation Blocking | Block and cancel any navigation, redirect, iframe, or webview request to `accounts.google.com`. | M1 | R1, Survey E1 |
| 3 | Forced Account Selection (`prompt=select_account`) | Pass `prompt=select_account` in OAuth URL so Google shows account picker instead of auto-authenticating existing session. | M1 | R2, Survey E1 |
| 4 | Non-Blocking OAuth Cancellation | Allow user to cancel in-progress OAuth flow (`⏳ Отмена`) immediately restoring active account without freezing UI. | M1 | R1/R4, Survey E1 |
| 5 | 4-Slot Windows Credential Storage | Persist accounts across `gemini:antigravity_slot_1..4` with `gemini:antigravity` as active target. | M2 | R3, Survey E2 |
| 6 | Zero-Gap Slot Compaction | Purge and rewrite slots 1..K contiguously on deletion of any slot (e.g. delete slot 2 of 3 -> slots 1, 2). | M2 | R3, Survey E2 |
| 7 | Legacy Credential Migration & Pruning | Automatically migrate legacy single-account and primary/reserve credentials into slot 1 and 2, pruning legacy targets. | M2 | R3, Survey E2 |
| 8 | Background Token Refresh Synchronization | Back up active credential before switching, adding, or deleting to prevent losing tokens refreshed by Language Server. | M2 | R3, Survey E2 |
| 9 | Carousel UI Widget & Status Display | Render `#antigravity-multiacc-root` with `[1/3]` slot indicator and active status dot. | M3 | R3, Survey E3 |
| 10 | 1-Click Carousel Rotation | Manual 1-click button (`↻ След. аккаунт`) cycling accounts sequentially (`1 -> 2 -> 3 -> 1`). | M3 | R3, Survey E3 |
| 11 | Dropdown Account Selection & Removal | Interactive dropdown menu to select specific slot or remove slot with confirmation. | M3 | R3, Survey E3 |
| 12 | Chat History & Session Preservation | Preserve conversation history, active tabs, and SQLite database turns across account switches. | M3 | R3, Survey E3 |
| 13 | Backend Quota Error Interception & Auto-Failover | Detect gRPC `ResourceExhausted` / HTTP 429 in LS output and auto-switch to next account with 25s debounce. | M3 | R3, Survey E3 |
| 14 | ASAR Packaging with Unpack Flags | Pack code into `app.asar` using `--unpack "{**/chrome-devtools-mcp/**,**/credHelper.py}"`. | M4 | R4, Survey E3 |
| 15 | Production Deployment & Asset Synchronization | Deploy verified `app.asar`, unpacked assets, and helper binaries to `%LOCALAPPDATA%\Programs\antigravity\resources\` and user profile. | M4 | R4, Survey E3 |
| 16 | 100% E2E Test Suite Pass (Tiers 1-4) | Independent opaque-box verification across all requirements. | M5 | R4, Dual Track |
| 17 | Tier 5 Adversarial Coverage Hardening | White-box stress testing and edge-case bug hunting. | M5 | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | OAuth & Browser Flow Hardening | Features 1, 2, 3, 4: `languageServer.js`, `utils.js`, `main.js`, `beyondcorpPac.js`, `preload.js` cancel handling | none | IN_PROGRESS |
| M2 | Credential Storage & Slot Compaction | Features 5, 6, 7, 8: `credHelper.py` Win32 Credential Manager integration, migration, zero-gap compaction, token backup | none | PLANNED |
| M3 | Dynamic Carousel UI & Quota Auto-Failover | Features 9, 10, 11, 12, 13: `preload.js` UI widget, `multiaccManager.js`, `languageServer.js` error stream interception | M1, M2 | PLANNED |
| M4 | Production Packaging & Deployment Pipeline | Features 14, 15: `asar` packaging with unpack rules, deployment to production resources & helper paths | M1, M2, M3 | PLANNED |
| M5 | Final E2E Test Verification & Adversarial Hardening | Features 16, 17: Pass 100% of E2E test suite (Tiers 1-4) + Tier 5 Adversarial Coverage Hardening | M4, E2E Test Suite | PLANNED |

## Interface Contracts
### `languageServer.js` ↔ `language_server.exe`
- Environment: `ANTIGRAVITY_VSCODE_HOST=1` must be set on all platforms (Windows + WSL) during spawn.
- Output: LS emits `ANTIGRAVITY_OPEN_URL: <url>` to stdout; parsed by `extractOpenUrl()`.
- Error Detection: stdout/stderr streams scanned line-by-line for `/(?:rpc error: code = ResourceExhausted|status:\s*429|RESOURCE_EXHAUSTED.*quota|Quota exceeded for quota metric|generativelanguage.*429)/i`.

### `utils.js` ↔ External Browser / WebContents
- `ensureAccountSelection(url)`: Ensures URL has `prompt=select_account` (or `select_account consent` if consent present).
- `isAuthUrl(url)`: Returns true for all `accounts.google.com` hostnames and Google OAuth/signin endpoints.
- `configureAuthInterception(session)`: Intercepts `*://accounts.google.com/*`, cancels web request, and calls `openAuthUrlExternal(url)` (`electron.shell.openExternal`).
- `web-contents-created`: Attaches `will-navigate`, `will-redirect`, `will-frame-navigate`, `setWindowOpenHandler` blocking internal rendering of auth URLs.

### `multiaccManager.js` ↔ `credHelper.py`
- Command Interface: `execFile("python", [SCRIPT_PATH, command, ...args], { encoding: "utf-8" })`
- Commands: `status`, `switch [slot|"next"]`, `toggle-autofailover [1|0]`, `prepare-add-login [slot]`, `finalize-add-login [slot]`, `cancel-add-login`, `delete-slot <slot>`
- Output Format: JSON object printed to stdout with `{ activeSlot, autoFailover, accounts: [{ slot, email }], ... }` or `{ error: "..." }`.
