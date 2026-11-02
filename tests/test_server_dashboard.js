// tests/test_server_dashboard.js
// Comprehensive automated verification suite for scripts/server_dashboard.js (v4.0)

const http = require("http");
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { ServerDashboard, mapToAntigravityModel } = require("../scripts/server_dashboard");

const TEST_PORT = 51199;
const MOCK_LS_PORT = 51198;
const TEST_PIN = "998877";

function makeRequest(method, endpoint, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "127.0.0.1",
            port: TEST_PORT,
            path: endpoint,
            method,
            headers: {
                ...headers
            }
        };
        if (body && typeof body === "object") {
            body = JSON.stringify(body);
            options.headers["Content-Type"] = "application/json";
        }
        if (body) {
            options.headers["Content-Length"] = Buffer.byteLength(body);
        }

        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(data); } catch (_) {}
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    raw: data,
                    json
                });
            });
        });

        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function runTests() {
    console.log("==============================================================================");
    console.log("   ANTIGRAVITY SERVER DASHBOARD & WEB STUDIO TEST SUITE (v4.0)");
    console.log("==============================================================================");

    const testWorkspace = path.resolve(__dirname, "..");
    const dashboard = new ServerDashboard({
        host: "127.0.0.1",
        port: TEST_PORT,
        pin: TEST_PIN,
        workspace: testWorkspace
    });

    await dashboard.start();
    console.log("✔ ServerDashboard started on port", TEST_PORT);

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✔ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✖ [FAIL] ${name}:`, err.message);
            failed++;
        }
    }

    // Set up a mock local Antigravity Language Server for testing Cascade API
    let mockLsCalls = [];
    const mockLsServer = http.createServer((req, res) => {
        let bodyStr = "";
        req.on("data", c => { bodyStr += c; });
        req.on("end", () => {
            const url = req.url;
            mockLsCalls.push({ url, headers: req.headers, body: bodyStr });
            res.setHeader("Content-Type", "application/json");

            if (url.includes("StartCascade")) {
                res.writeHead(200);
                res.end(JSON.stringify({ cascadeId: "mock-cascade-test-77" }));
            } else if (url.includes("SendUserCascadeMessage")) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
            } else if (url.includes("GetCascadeTrajectorySteps")) {
                res.writeHead(200);
                res.end(JSON.stringify({
                    steps: [
                        {
                            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
                            status: "CORTEX_STEP_STATUS_DONE",
                            plannerResponse: {
                                thinking: "Thinking deeply about Antigravity architecture...",
                                response: "Hello from Antigravity Cascade Agent!"
                            }
                        }
                    ]
                }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: "not found" }));
            }
        });
    });

    await new Promise(r => mockLsServer.listen(MOCK_LS_PORT, "127.0.0.1", r));
    console.log("✔ Mock Antigravity Language Server listening on port", MOCK_LS_PORT);

    // Save previous env vars
    const prevLsPort = process.env.AGY_LS_PORT;
    const prevLsCsrf = process.env.AGY_LS_CSRF;
    process.env.AGY_LS_PORT = String(MOCK_LS_PORT);
    process.env.AGY_LS_CSRF = "mock-csrf-token-12345";

    let sessionToken = null;

    try {
        // ---------------------------------------------------------------------
        // 1. Root UI SPA Delivery (serves web/dist/index.html or built-in Studio)
        // ---------------------------------------------------------------------
        await test("GET / serves single page application (web/dist or built-in studio)", async () => {
            const res = await makeRequest("GET", "/");
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.headers["content-type"].includes("text/html"));
            assert.ok(res.raw.includes("Antigravity"));
        });

        // ---------------------------------------------------------------------
        // 2. PIN Authentication & Session Token Generation
        // ---------------------------------------------------------------------
        await test("POST /api/auth rejects invalid PIN with 401", async () => {
            const res = await makeRequest("POST", "/api/auth", {}, { pin: "000000" });
            assert.strictEqual(res.statusCode, 401);
            assert.strictEqual(res.json.ok, false);
            assert.ok(res.json.error.includes("Неверный PIN"));
        });

        await test("POST /api/auth accepts valid PIN and returns session token and Set-Cookie", async () => {
            const res = await makeRequest("POST", "/api/auth", {}, { pin: TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.pin, TEST_PIN);
            assert.ok(res.json.token);
            assert.ok(res.headers["set-cookie"]);
            assert.ok(res.headers["set-cookie"][0].includes("agy_token="));
            sessionToken = res.json.token;
        });

        // ---------------------------------------------------------------------
        // 3. Security & Protected Endpoints Authorization
        // ---------------------------------------------------------------------
        await test("Protected endpoints reject unauthenticated requests with 401", async () => {
            const res = await makeRequest("GET", "/api/state");
            assert.strictEqual(res.statusCode, 401);
            assert.strictEqual(res.json.ok, false);
        });

        await test("Protected endpoints accept Authorization: Bearer <token>", async () => {
            const res = await makeRequest("GET", "/api/state", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.server);
            assert.ok(res.json.activePreset);
            assert.ok(res.json.workspace);
        });

        await test("Protected endpoints accept Cookie: agy_token=<token>", async () => {
            const res = await makeRequest("GET", "/api/state", { "Cookie": `agy_token=${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
        });

        await test("Localhost request allows bypass with ?pin= query parameter", async () => {
            const res = await makeRequest("GET", `/api/state?pin=${TEST_PIN}`);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
        });

        // ---------------------------------------------------------------------
        // 4. Presets API (16 Presets Invariant & Overlays)
        // ---------------------------------------------------------------------
        await test("GET /api/presets returns all 16 presets with skills and metadata", async () => {
            const res = await makeRequest("GET", "/api/presets", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.count, 16);
            assert.strictEqual(res.json.presets.length, 16);
            assert.ok(Array.isArray(res.json.commonOverlays));

            const presetIds = res.json.presets.map(p => p.id);
            const expected = [
                "web", "backend", "devops", "appsec", "qa", "ai-agents",
                "web-research", "reverse-engineering", "product", "orchestrator",
                "systems", "vst3", "hardware", "media", "meta-dev", "minimal"
            ];
            for (const exp of expected) {
                assert.ok(presetIds.includes(exp), `Preset ${exp} must be present`);
            }
        });

        await test("POST /api/presets/switch switches preset and applies overlays", async () => {
            const res = await makeRequest("POST", "/api/presets/switch", { "Authorization": `Bearer ${sessionToken}` }, {
                preset: "orchestrator",
                overlays: ["+qa", "+docker"]
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.activePreset, "orchestrator");
        });

        // ---------------------------------------------------------------------
        // 5. Multi-Account Carousel & Slots API
        // ---------------------------------------------------------------------
        await test("GET /api/accounts returns accounts carousel status", async () => {
            const res = await makeRequest("GET", "/api/accounts", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.slotsCount >= 1);
            assert.ok(Array.isArray(res.json.accounts));
        });

        await test("POST /api/accounts/switch-slot switches to target slot", async () => {
            const res = await makeRequest("POST", "/api/accounts/switch-slot", { "Authorization": `Bearer ${sessionToken}` }, {
                slot: 1
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
        });

        await test("POST /api/accounts/rotate rotates active slot", async () => {
            const res = await makeRequest("POST", "/api/accounts/rotate", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
        });

        await test("POST /api/toggle-autofailover toggles auto failover setting", async () => {
            const res = await makeRequest("POST", "/api/toggle-autofailover", { "Authorization": `Bearer ${sessionToken}` }, {
                enabled: true
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
        });

        // ---------------------------------------------------------------------
        // 6. Workspace File Explorer & Sandboxed Editor API
        // ---------------------------------------------------------------------
        await test("GET /api/fs/tree returns recursive workspace tree excluding ignored dirs", async () => {
            const res = await makeRequest("GET", "/api/fs/tree?path=.", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(Array.isArray(res.json.tree));

            const names = res.json.tree.map(t => t.name);
            assert.ok(names.includes("scripts"), "scripts folder must be present in tree");
            assert.ok(!names.includes("node_modules"), "node_modules must be excluded");
            assert.ok(!names.includes(".git"), ".git must be excluded");
        });

        await test("GET /api/fs/read prevents directory traversal outside workspace", async () => {
            const res = await makeRequest("GET", "/api/fs/read?path=../../windows/win.ini", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 403);
            assert.strictEqual(res.json.ok, false);
            assert.ok(res.json.error.includes("Access denied"));
        });

        await test("POST /api/fs/write and GET /api/fs/read safely write and read files with MIME detection", async () => {
            const testRelPath = ".agy/test_dashboard_sample.js";
            const testContent = "console.log('ANTIGRAVITY_DASHBOARD_SAMPLE_OK');\n";

            const writeRes = await makeRequest("POST", "/api/fs/write", { "Authorization": `Bearer ${sessionToken}` }, {
                path: testRelPath,
                content: testContent
            });
            assert.strictEqual(writeRes.statusCode, 200);
            assert.strictEqual(writeRes.json.ok, true);
            assert.strictEqual(writeRes.json.bytesWritten, Buffer.byteLength(testContent, "utf-8"));

            const readRes = await makeRequest("GET", `/api/fs/read?path=${encodeURIComponent(testRelPath)}`, { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(readRes.statusCode, 200);
            assert.strictEqual(readRes.json.ok, true);
            assert.strictEqual(readRes.json.content, testContent);
            assert.strictEqual(readRes.json.mime, "application/javascript");

            // Clean up test file
            const fullTestFile = path.resolve(testWorkspace, testRelPath);
            if (fs.existsSync(fullTestFile)) {
                fs.unlinkSync(fullTestFile);
            }
        });

        await test("GET /api/git/diff returns git status and diff output", async () => {
            const res = await makeRequest("GET", "/api/git/diff", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(typeof res.json.status === "string");
            assert.ok(typeof res.json.diff === "string");
        });

        // ---------------------------------------------------------------------
        // 7. Native Antigravity Cascade Agent Streaming API
        // ---------------------------------------------------------------------
        await test("Model mapping maps aliases to Antigravity internal planner models", async () => {
            assert.strictEqual(mapToAntigravityModel("gemini-3.8-flash-high"), "MODEL_PLACEHOLDER_M318");
            assert.strictEqual(mapToAntigravityModel("flash"), "MODEL_PLACEHOLDER_M318");
            assert.strictEqual(mapToAntigravityModel("gemini-2.5-pro"), "MODEL_GOOGLE_GEMINI_2_5_PRO");
            assert.strictEqual(mapToAntigravityModel("claude-sonnet-4-6"), "MODEL_PLACEHOLDER_M35");
            assert.strictEqual(mapToAntigravityModel("claude-opus-4-6-thinking"), "MODEL_PLACEHOLDER_M26");
            assert.strictEqual(mapToAntigravityModel("gemini-2.5-flash"), "MODEL_GOOGLE_GEMINI_2_5_FLASH");
        });

        await test("GET /api/cascade/status reports active Language Server health", async () => {
            const res = await makeRequest("GET", "/api/cascade/status", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.active, true);
            assert.strictEqual(res.json.port, MOCK_LS_PORT);
            assert.strictEqual(res.json.health, "ONLINE");
        });

        await test("POST /api/chat/stream connects to Language Server and streams thinking, text, and done events", async () => {
            const body = JSON.stringify({
                prompt: "Explain Antigravity Cascade streaming in one sentence",
                model: "gemini-3.8-flash-high"
            });

            const sseRes = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: "127.0.0.1",
                    port: TEST_PORT,
                    path: "/api/chat/stream",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(body),
                        "Authorization": `Bearer ${sessionToken}`
                    }
                }, (res) => {
                    let text = "";
                    res.on("data", c => { text += c; });
                    res.on("end", () => {
                        resolve({ statusCode: res.statusCode, headers: res.headers, text });
                    });
                });
                req.on("error", reject);
                req.write(body);
                req.end();
            });

            assert.strictEqual(sseRes.statusCode, 200);
            assert.ok(sseRes.headers["content-type"].includes("text/event-stream"));
            assert.ok(sseRes.text.includes('"type":"thinking"'));
            assert.ok(sseRes.text.includes('"type":"text"'));
            assert.ok(sseRes.text.includes('"type":"done"'));
            assert.ok(sseRes.text.includes("Hello from Antigravity Cascade Agent!"));
            assert.ok(sseRes.text.includes("MODEL_PLACEHOLDER_M318"));
        });

        // ---------------------------------------------------------------------
        // 8. Pure Node.js RFC 6455 WebSocket Interactive Terminal (/ws/terminal)
        // ---------------------------------------------------------------------
        await test("WebSocket /ws/terminal rejects unauthenticated connection with 401", async () => {
            const unauthorized = await new Promise((resolve) => {
                const ws = new globalThis.WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/terminal`);
                ws.onerror = () => { resolve(true); };
                ws.onopen = () => { ws.close(); resolve(false); };
            });
            assert.strictEqual(unauthorized, true);
        });

        await test("WebSocket /ws/terminal connects with PIN, pipes shell bidirectional stream, and supports resize", async () => {
            const wsUrl = `ws://127.0.0.1:${TEST_PORT}/ws/terminal?pin=${TEST_PIN}`;
            const ws = new globalThis.WebSocket(wsUrl);

            let receivedData = "";
            let receivedEcho = false;

            const wsSuccess = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error("WebSocket terminal communication timed out"));
                }, 8000);

                ws.onopen = () => {
                    // Send terminal resize control message
                    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 30 }));

                    // Send shell command
                    const cmd = process.platform === "win32"
                        ? "Write-Output 'TERMINAL_STREAM_OK'\r\n"
                        : "echo 'TERMINAL_STREAM_OK'\n";
                    ws.send(cmd);
                };

                ws.onmessage = (event) => {
                    receivedData += event.data;
                    if (receivedData.includes("TERMINAL_STREAM_OK")) {
                        receivedEcho = true;
                        clearTimeout(timeout);
                        ws.close();
                        resolve(true);
                    }
                };

                ws.onerror = (err) => {
                    clearTimeout(timeout);
                    reject(err);
                };
            });

            assert.strictEqual(wsSuccess, true);
            assert.strictEqual(receivedEcho, true);
        });

        // ---------------------------------------------------------------------
        // 9. Interactive Console Exec & Logs Endpoints
        // ---------------------------------------------------------------------
        await test("POST /api/terminal/exec executes command and returns stdout", async () => {
            const res = await makeRequest("POST", "/api/terminal/exec", { "Authorization": `Bearer ${sessionToken}` }, {
                command: 'node -e "console.log(\'SERVER_DASHBOARD_OK\')"'
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.stdout.includes("SERVER_DASHBOARD_OK"));
            assert.strictEqual(res.json.exitCode, 0);
        });

        await test("GET /api/logs returns server_dashboard activity logs", async () => {
            const res = await makeRequest("GET", "/api/logs?type=server_dashboard&lines=20", { "Authorization": `Bearer ${sessionToken}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.content.length > 0);
        });

        // ---------------------------------------------------------------------
        // 10. Brute-Force Rate Limiting (5 failed attempts -> 15 min lock)
        // ---------------------------------------------------------------------
        await test("Brute-Force Rate Limiting locks out IP with 429 after 5 failed attempts", async () => {
            const testAttackerIp = "198.51.100.77";
            const attackerHeaders = { "x-forwarded-for": testAttackerIp };

            for (let i = 1; i <= 4; i++) {
                const failRes = await makeRequest("POST", "/api/auth", attackerHeaders, { pin: "111111" });
                assert.strictEqual(failRes.statusCode, 401);
                assert.strictEqual(failRes.json.ok, false);
            }

            // 5th failed attempt triggers lockout (429)
            const lockRes = await makeRequest("POST", "/api/auth", attackerHeaders, { pin: "111111" });
            assert.strictEqual(lockRes.statusCode, 429);
            assert.strictEqual(lockRes.json.ok, false);
            assert.ok(lockRes.headers["retry-after"]);
            assert.ok(lockRes.json.error.includes("заблокирован"));

            // Subsequent requests from locked IP should be rejected immediately
            const blockedStateRes = await makeRequest("GET", "/api/state", attackerHeaders);
            assert.strictEqual(blockedStateRes.statusCode, 429);
        });

    } finally {
        // Restore environment variables
        if (prevLsPort) process.env.AGY_LS_PORT = prevLsPort;
        else delete process.env.AGY_LS_PORT;
        if (prevLsCsrf) process.env.AGY_LS_CSRF = prevLsCsrf;
        else delete process.env.AGY_LS_CSRF;

        await new Promise(r => mockLsServer.close(r));
        console.log("✔ Mock Language Server stopped");

        await dashboard.stop();
        console.log("✔ ServerDashboard stopped");
    }

    console.log("==============================================================================");
    console.log(`Passed: ${passed} | Failed: ${failed}`);
    console.log("==============================================================================");

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error("Test runner failed:", err);
    process.exit(1);
});
