// tests/test_server_dashboard.js
// Automated verification suite for scripts/server_dashboard.js

const http = require("http");
const path = require("path");
const assert = require("assert");
const { ServerDashboard } = require("../scripts/server_dashboard");

const TEST_PORT = 51199;
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
    console.log("   ANTIGRAVITY SERVER DASHBOARD TEST SUITE");
    console.log("==============================================================================");

    const dashboard = new ServerDashboard({
        host: "127.0.0.1",
        port: TEST_PORT,
        pin: TEST_PIN,
        workspace: path.resolve(__dirname, "..")
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

    try {
        // 1. Root SPA HTML delivery
        await test("GET / serves single page application with all 6 tabs", async () => {
            const res = await makeRequest("GET", "/");
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.headers["content-type"].includes("text/html"));
            assert.ok(res.raw.includes("Absolute Antigravity | Server Dashboard"));
            assert.ok(res.raw.includes("tab-chat"));
            assert.ok(res.raw.includes("tab-presets"));
            assert.ok(res.raw.includes("tab-accounts"));
            assert.ok(res.raw.includes("tab-workspaces"));
            assert.ok(res.raw.includes("tab-terminal"));
            assert.ok(res.raw.includes("tab-logs"));
            assert.ok(res.raw.includes("lockScreen"));
        });

        // 2. Auth rejection on wrong PIN
        await test("POST /api/auth rejects invalid PIN with 401", async () => {
            const res = await makeRequest("POST", "/api/auth", {}, { pin: "000000" });
            assert.strictEqual(res.statusCode, 401);
            assert.strictEqual(res.json.ok, false);
            assert.ok(res.json.error.includes("Неверный PIN"));
        });

        // 3. Auth success on valid PIN
        await test("POST /api/auth accepts valid PIN and returns token", async () => {
            const res = await makeRequest("POST", "/api/auth", {}, { pin: TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.pin, TEST_PIN);
            assert.ok(res.json.token);
        });

        // 4. Unauthorized rejection on protected endpoints
        await test("GET /api/state rejects unauthenticated requests with 401", async () => {
            const res = await makeRequest("GET", "/api/state");
            assert.strictEqual(res.statusCode, 401);
            assert.strictEqual(res.json.ok, false);
        });

        // 5. GET /api/state with valid auth header
        await test("GET /api/state returns full system status with x-agy-pin", async () => {
            const res = await makeRequest("GET", "/api/state", { "x-agy-pin": TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.server);
            assert.ok(res.json.server.version);
            assert.ok(res.json.activePreset);
            assert.ok(res.json.workspace);
            assert.ok(Array.isArray(res.json.slots));
            assert.ok(typeof res.json.activeSlot === "number");
        });

        // 6. GET /api/presets
        await test("GET /api/presets returns all 16 presets with skills and metadata", async () => {
            const res = await makeRequest("GET", "/api/presets", { "Authorization": `Bearer ${TEST_PIN}` });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.count, 16);
            assert.strictEqual(res.json.presets.length, 16);

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

        // 7. POST /api/switch-preset
        await test("POST /api/switch-preset switches preset and returns result", async () => {
            const res = await makeRequest("POST", "/api/switch-preset", { "x-agy-pin": TEST_PIN }, {
                preset: "orchestrator",
                overlays: ["+qa"]
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.strictEqual(res.json.activePreset, "orchestrator");
        });

        // 8. GET /api/slots
        await test("GET /api/slots returns account slots info", async () => {
            const res = await makeRequest("GET", "/api/slots", { "x-agy-pin": TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.slotsCount >= 1);
            assert.ok(Array.isArray(res.json.accounts));
        });

        // 9. POST /api/switch-slot
        await test("POST /api/switch-slot rotates or switches slot", async () => {
            const res = await makeRequest("POST", "/api/switch-slot", { "x-agy-pin": TEST_PIN }, {
                slot: 1
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
        });

        // 10. GET /api/workspaces
        await test("GET /api/workspaces returns recent workspaces and current info", async () => {
            const res = await makeRequest("GET", "/api/workspaces", { "x-agy-pin": TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.current);
            assert.ok(Array.isArray(res.json.workspaces));
        });

        // 11. POST /api/terminal/exec
        await test("POST /api/terminal/exec executes command and returns stdout", async () => {
            const res = await makeRequest("POST", "/api/terminal/exec", { "x-agy-pin": TEST_PIN }, {
                command: 'node -e "console.log(\'SERVER_DASHBOARD_OK\')"'
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.stdout.includes("SERVER_DASHBOARD_OK"));
            assert.strictEqual(res.json.exitCode, 0);
            assert.ok(typeof res.json.durationMs === "number");
        });

        // 12. GET /api/logs
        await test("GET /api/logs returns server_dashboard activity logs", async () => {
            const res = await makeRequest("GET", "/api/logs?type=server_dashboard&lines=20", { "x-agy-pin": TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(res.json.content.length > 0);
        });

        // 13. GET /api/artifacts
        await test("GET /api/artifacts returns list of artifacts", async () => {
            const res = await makeRequest("GET", "/api/artifacts", { "x-agy-pin": TEST_PIN });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.json.ok, true);
            assert.ok(Array.isArray(res.json.artifacts));
        });

        // 14. POST /api/chat/stream SSE
        await test("POST /api/chat/stream delivers Server-Sent Events stream", async () => {
            const body = JSON.stringify({
                prompt: "Тестовый пинг",
                preset: "minimal",
                slot: 1
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
                        "x-agy-pin": TEST_PIN
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
            assert.ok(sseRes.text.includes("data: "));
        });

        // 15. Brute-Force Rate Limiting (5 failed attempts -> 15 min lock)
        await test("Brute-Force Rate Limiting locks out IP with 429 after 5 failed attempts", async () => {
            const testAttackerIp = "198.51.100.99";
            const attackerHeaders = { "x-forwarded-for": testAttackerIp };

            for (let i = 1; i <= 4; i++) {
                const failRes = await makeRequest("POST", "/api/auth", attackerHeaders, { pin: "111111" });
                assert.strictEqual(failRes.statusCode, 401);
                assert.strictEqual(failRes.json.ok, false);
            }

            // 5th failed attempt should trigger lockout (429)
            const lockRes = await makeRequest("POST", "/api/auth", attackerHeaders, { pin: "111111" });
            assert.strictEqual(lockRes.statusCode, 429);
            assert.strictEqual(lockRes.json.ok, false);
            assert.ok(lockRes.headers["retry-after"]);
            assert.ok(lockRes.json.error.includes("заблокирован"));

            // Subsequent requests from locked IP should be blocked immediately
            const blockedStateRes = await makeRequest("GET", "/api/state", attackerHeaders);
            assert.strictEqual(blockedStateRes.statusCode, 429);
        });

    } finally {
        await dashboard.stop();
        console.log("✔ ServerDashboard stopped");
    }

    console.log("==============================================================================");
    console.log(`Passed: ${passed} | Failed: ${failed}`);
    console.log("==============================================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test runner failed:", err);
    process.exit(1);
});
