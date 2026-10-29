# Antigravity Multi-Account Test Infrastructure Specification

**Document Version:** 1.0.0  
**Target Application:** Antigravity (v2.26.0)  
**Authoritative Sources:** `ORIGINAL_REQUEST.md`, `PROJECT.md`

---

## 1. Test Philosophy

The testing framework for Antigravity's multi-account system adheres to a strict **opaque-box, requirement-driven methodology**.

### Core Principles
1. **Opaque-Box Verification**: Tests inspect and validate system inputs, outputs, state transformations, and observable side-effects through external boundaries (HTTP/OAuth parameters, process environment variables, IPC responses, Windows Credential Manager storage, and packaged ASAR archives) without relying on internal private implementations.
2. **Authoritative Derivation**: All test specifications, expected values, and acceptance criteria are derived strictly from the authoritative requirements specified in `ORIGINAL_REQUEST.md` (R1 through R4) and the interface contracts in `PROJECT.md`.
3. **Zero Facade / Anti-Tamper Integrity**: Every test asserts concrete operational logic. Facade tests that unconditionally pass or assertions tailored to circumvent real execution paths are strictly prohibited and actively audited.
4. **Hermetic Test Isolation**: Tests execute in temporary isolated sandbox environments (`USERPROFILE` and filesystem sandbox for configuration files, mocked Win32 Credential API for safe memory-level credential persistence, and isolated process spawns). No live user credentials or production state in `~/.gemini/` are ever modified or risked.
5. **Deterministic Assertions with Known Variances**: Dynamic fields such as ephemeral ports (`127.0.0.1:<port>`), random CSRF tokens, and timestamps are validated via structural pattern matching, while deterministic fields (URL search parameters, slot compactions, JSON structures, exit codes) are strictly assert-equal tested.

---

## 2. Feature Inventory & 4-Tier Test Mapping

The requirements from `ORIGINAL_REQUEST.md` map to the 4-tier test architecture as follows:

| Requirement | Description | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|---|---|---|---|---|
| **R1. Strict External Browser OAuth Launch** | Force external system browser via `electron.shell.openExternal`; block all internal webview/pane rendering of `accounts.google.com`; pass `ANTIGRAVITY_VSCODE_HOST=1` to Language Server; support non-blocking OAuth cancellation. | >= 5 tests | >= 5 tests | Pairwise interactions | Real-world lifecycle |
| **R2. Force Google Account Selection** | Enforce `prompt=select_account` parameter injection in OAuth URLs across all variations (`prompt=consent` merging, idempotent prompt preservation, parameter ordering, hash preservation). | >= 5 tests | >= 5 tests | Pairwise interactions | Real-world lifecycle |
| **R3. Dynamic 3–4 Account Carousel** | Manage 4 persistent slots in Windows Credential Manager (`gemini:antigravity_slot_1..4`), active target `gemini:antigravity`, 1-click rotation, zero-gap slot compaction upon deletion, 25s debounced 429 quota auto-failover, legacy migration. | >= 5 tests | >= 5 tests | Pairwise interactions | Real-world lifecycle |
| **R4. Automated Testing & Packaging** | Programmatic verification of credential tokens; ASAR packaging with `--unpack "{**/chrome-devtools-mcp/**,**/credHelper.py}"`; binary and helper script hash parity verification. | >= 5 tests | >= 5 tests | Pairwise interactions | Real-world lifecycle |

---

## 3. Tiered Test Methodology Details

### Tier 1: Feature Coverage (Primary Behavior)
*Minimum threshold: >= 5 tests per requirement (R1, R2, R3, R4).*

- **R1: Strict External Browser Launch & Blocking**
  1. `T1_R1_01_AuthUrlIdentification`: `isAuthUrl()` correctly identifies Google OAuth endpoints (`accounts.google.com/o/oauth2/auth`, `accounts.google.com/o/oauth2/v2/auth`).
  2. `T1_R1_02_ServiceLoginIdentification`: `isAuthUrl()` identifies Google sign-in and ServiceLogin endpoints (`accounts.google.com/ServiceLogin`, `/v3/signin`).
  3. `T1_R1_03_NonAuthUrlRejection`: `isAuthUrl()` returns `false` for normal Google services (`mail.google.com`, `drive.google.com`, `google.com/search`).
  4. `T1_R1_04_ExtractAuthUrlFromLog`: `extractAuthUrl()` extracts clean OAuth URLs from Language Server log streams, stripping trailing delimiters.
  5. `T1_R1_05_VscodeHostEnvEnforcement`: Language Server startup environment enforces `ANTIGRAVITY_VSCODE_HOST=1` unconditionally on native Windows and WSL.
  6. `T1_R1_06_SessionInterceptionAttachment`: `configureAuthInterception()` attaches network filters intercepting `*://accounts.google.com/*` and cancels web requests.
  7. `T1_R1_07_NonBlockingOAuthCancellation`: `cancel-add-login` purges pending login states and restores active credentials without locking the application.

- **R2: Force Google Account Selection (`prompt=select_account`)**
  1. `T1_R2_01_InjectPromptWhenMissing`: `ensureAccountSelection()` appends `prompt=select_account` to OAuth URLs lacking a prompt parameter.
  2. `T1_R2_02_MergeConsentPrompt`: `ensureAccountSelection()` transforms existing `prompt=consent` to `prompt=select_account consent`.
  3. `T1_R2_03_IdempotentPromptHandling`: URLs already containing `prompt=select_account` are preserved unchanged without duplicate keys.
  4. `T1_R2_04_PreserveQueryParameters`: Query parameters (`client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`) are strictly preserved.
  5. `T1_R2_05_PreserveUrlFragment`: URL hash fragments (`#...`) are preserved after prompt parameter manipulation.
  6. `T1_R2_06_NonAuthUrlUntouched`: Non-auth URLs (e.g. `https://example.com`) pass through unmodified.

- **R3: Dynamic 3–4 Account Carousel & Quota Failover**
  1. `T1_R3_01_MultiSlotCredentialStorage`: Storage supports 4 accounts mapped to `gemini:antigravity_slot_1..4`.
  2. `T1_R3_02_OneClickSequentialRotation`: Carousel switches sequentially `1 -> 2 -> 3 -> 1` and updates `gemini:antigravity`.
  3. `T1_R3_03_ZeroGapSlotCompaction`: Deleting slot 2 of 3 purges slot targets and rewrites remaining accounts contiguously as slots 1 and 2.
  4. `T1_R3_04_ActiveSlotDeletionFallback`: Deleting active slot activates slot 1 and synchronizes active target `gemini:antigravity`.
  5. `T1_R3_05_QuotaErrorSignatureDetection`: Backend quota error regex detects gRPC `ResourceExhausted` and HTTP `429` signatures.
  6. `T1_R3_06_AutoFailoverCooldownDebounce`: Quota failover enforces 25-second debounce window.
  7. `T1_R3_07_AutoFailoverDisabledSetting`: When `autoFailover = false`, quota errors do not trigger profile switching.
  8. `T1_R3_08_SingleAccountPoolSafety`: Quota errors in a 1-account pool abort failover gracefully.
  9. `T1_R3_09_LegacyCredentialMigration`: `ensure_migrated()` migrates legacy single/primary credentials into slots 1 and 2, pruning legacy keys.

- **R4: Automated Testing & Packaging Pipeline**
  1. `T1_R4_01_AsarUnpackFlagValidation`: Packaging unpack pattern includes `{**/chrome-devtools-mcp/**,**/credHelper.py}`.
  2. `T1_R4_02_UnpackedAssetPresence`: Validates that `app.asar.unpacked/dist/credHelper.py` exists outside the archive.
  3. `T1_R4_03_CredHelperHashParity`: Validates bit-for-bit SHA256 parity between source and unpacked copies of `credHelper.py`.
  4. `T1_R4_04_JwtTokenEmailExtraction`: `extract_email()` decodes base64url JWT `id_token` payload and retrieves user email.
  5. `T1_R4_05_DirectEmailFieldExtraction`: `extract_email()` extracts direct `email` property when present in JSON blob.
  6. `T1_R4_06_AsarArchiveIntegrity`: Validates that `app.asar` can be packed and unpacked using `asar` CLI without corruption.

---

### Tier 2: Boundary & Corner Cases
*Minimum threshold: >= 5 tests per requirement (R1, R2, R3, R4).*

- **R1 Boundary Cases**:
  1. `T2_R1_01_ExtremeUrlLength`: Handles massive URLs (>4096 characters with hundreds of query parameters) safely.
  2. `T2_R1_02_MalformedAuthUrls`: Malformed URL strings (`http://///`, invalid host, port overflow) handled gracefully without uncaught exceptions.
  3. `T2_R1_03_NullEmptyTypeHandling`: `null`, `undefined`, empty string, and non-string inputs to URL helpers return safe defaults.
  4. `T2_R1_04_SubdomainSpoofingRejection`: URLs targeting `accounts.google.com.attacker.com` or `evil-accounts.google.com` are rejected.
  5. `T2_R1_05_RapidBrowserLaunchDebounce`: Repeated calls to `openAuthUrlExternal` within 4000ms debounce interval are suppressed.
  6. `T2_R1_06_TrailingDelimiterStripping`: Strips quotes, parentheses, brackets, and semicolons attached to URLs in log streams.

- **R2 Boundary Cases**:
  1. `T2_R2_01_MultiValuePromptNormalization`: Existing prompt containing whitespace/multiple values (`prompt="login consent"`) normalized with `select_account`.
  2. `T2_R2_02_CaseInsensitiveHostMatching`: Schemes and hostnames with uppercase characters (`HTTPS://ACCOUNTS.GOOGLE.COM/o/oauth2/auth`) recognized and transformed.
  3. `T2_R2_03_UrlEncodedParameterPreservation`: Special encoded characters in query string (`scope=openid%20profile%20email&state=foo%2Bbar%3D`) preserved without double-decoding.
  4. `T2_R2_04_HashFragmentQueryOrdering`: URLs with hash fragments and query params appended after hash remain well-formed.
  5. `T2_R2_05_EmptyQueryStringHandling`: URLs ending in `?` or `?&` cleanly append `prompt=select_account`.
  6. `T2_R2_06_DuplicatePromptParameters`: URLs with duplicate `prompt` keys handled idempotently.

- **R3 Boundary Cases**:
  1. `T2_R3_01_MaxSlotsLimitCap`: Attempting to add an account beyond `MAX_SLOTS = 4` is blocked.
  2. `T2_R3_02_MinSlotsDeleteProtection`: Attempting to delete slot when only 1 account exists is rejected with error.
  3. `T2_R3_03_InvalidSlotNumberHandling`: Negative numbers, out-of-range slots (`-1`, `0`, `5`), and non-numeric inputs rejected with descriptive errors.
  4. `T2_R3_04_NonExistentSlotDeletion`: Attempting to delete an unpopulated slot returns clear error response.
  5. `T2_R3_05_CorruptConfigJsonRecovery`: Corrupt or non-JSON content in `antigravity_multiacc.json` recovered gracefully without crash.
  6. `T2_R3_06_CorruptCredentialBlobHandling`: Malformed JSON or non-JSON string in credential blob handled safely.
  7. `T2_R3_07_ExactDebounceBoundary`: Debounce test at exact 25,000ms boundary (suppressed at 24,999ms, triggered at 25,001ms).
  8. `T2_R3_08_MixedCaseQuotaErrorLines`: Quota error lines with mixed case and leading/trailing log prefixes recognized.

- **R4 Boundary Cases**:
  1. `T2_R4_01_TruncatedJwtToken`: Truncated or signature-only JWT strings handled without exception, returning `None`.
  2. `T2_R4_02_MissingEmailClaimsInJwt`: Valid JWT lacking `email` claim handled safely, returning `None`.
  3. `T2_R4_03_InvalidBase64UrlPadding`: Base64 strings with incorrect padding decoded safely without raising exceptions.
  4. `T2_R4_04_EmptyOrNonDictCredentialBlob`: Empty string, integer, or array credential blobs handled gracefully.
  5. `T2_R4_05_UnpackGlobBoundaryMatching`: Glob pattern `{**/chrome-devtools-mcp/**,**/credHelper.py}` correctly matches required nested paths.

---

### Tier 3: Cross-Feature Combinations (Pairwise Interactions)
1. `T3_PAIR_01_SwitchDuringAddLogin`: Profile switch requested while OAuth login is in-progress; verifies pending state cleanup, credential restoration, and successful switch.
2. `T3_PAIR_02_QuotaFailoverDuringCompaction`: 429 quota error arriving during or immediately following slot deletion; verifies valid round-robin target calculated on compacted slot list.
3. `T3_PAIR_03_TokenRefreshDuringRotation`: Background token refresh written by Language Server to `gemini:antigravity` synchronized back to active slot before carousel rotation occurs.
4. `T3_PAIR_04_PacProxyInterceptionPreservation`: Session PAC proxy configuration does not wipe out or overwrite `configureAuthInterception` webRequest handlers.
5. `T3_PAIR_05_MigrationWithActiveMultiSlotCarousel`: Legacy migration invoked when multi-slot accounts already exist; verifies existing slots 1..4 are never overwritten.
6. `T3_PAIR_06_EndSlotCircularFailover`: Quota failover on slot 4 wraps around cleanly to slot 1: `(4 % 4) -> slot 1`.

---

### Tier 4: Real-World Application Scenarios
1. `T4_SCEN_01_Full4AccountLifecycle`: Simulate adding 4 accounts sequentially, cycling through `1 -> 2 -> 3 -> 4 -> 1`, verifying credential persistence and status reporting at each step.
2. `T4_SCEN_02_MiddleSlotDeletionCompaction`: 4-account configuration; delete middle slot 2; verify remaining accounts compacted contiguously to slots 1..3 with zero gaps and updated active indices.
3. `T4_SCEN_03_ActiveSlotDeletionCompaction`: Active account (slot 2) is deleted; verify slot 1 becomes active, `gemini:antigravity` is rewritten with slot 1 token, and UI status updates.
4. `T4_SCEN_04_BurstQuotaExhaustionDebounce`: Simulate 10 rapid backend quota error lines emitted within 1.5 seconds; verify single auto-failover occurs; simulate 11th error after 26s and verify second failover.
5. `T4_SCEN_05_AbortedAddLoginRecovery`: User initiates account addition, external browser opens with `prompt=select_account`, but user clicks `⏳ Отмена`; verify pre-add state and active credentials fully restored.
6. `T4_SCEN_06_PackagingAndUnpackParity`: Execute actual ASAR packaging on workspace tree, verify archive generation, unpacked file existence, and bit-for-bit file hash verification.

---

## 4. Test Suite Architecture & Unified Runner

### Directory Layout
```
.\
├── TEST_INFRA.md                   # Complete test methodology & mapping specification
├── TEST_READY.md                   # Verification summary and execution guide
└── tests\
    ├── run_all.js                  # Unified master test runner (Tiers 1-4)
    ├── helpers\
    │   ├── electron_mock.js        # Hermetic Electron API mock (zero dependencies)
    │   └── cred_sandbox.py         # Win32 Credential Manager memory sandbox
    ├── tier1_feature_coverage.test.js  # Tier 1 test suite (R1, R2, R3, R4)
    ├── tier2_boundary_cases.test.js    # Tier 2 boundary test suite
    ├── tier3_cross_feature.test.js     # Tier 3 pairwise interaction test suite
    ├── tier4_real_world.test.js        # Tier 4 end-to-end lifecycle test suite
    └── cred_helper_suite.py            # Deep Win32 Credential Helper suite
```

### Unified Execution Command
All test suites across Tiers 1 through 4 are executed via:
```bash
node tests/run_all.js
```
The unified runner executes each tier sequentially, aggregates all pass/fail counts, logs execution times, and terminates with exit code `0` on 100% pass or `1` on any failure.
