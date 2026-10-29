"use strict";

/**
 * controlCenterUi.js: Injected UI for Antigravity Skill & MCP Control Center
 * Renders the topbar button, drawer side sheet, and smart preset banner.
 */

function injectControlCenterUI(bridge) {
    if (document.getElementById("antigravity-control-center-root")) return;

    // Inject CSS styles
    const styleEl = document.createElement("style");
    styleEl.id = "antigravity-control-center-styles";
    styleEl.textContent = `
        /* Topbar Control Center Button */
        #ag-cc-topbar-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #2b2d30;
            color: #e6edf3;
            border: 1px solid #3c3f41;
            border-radius: 6px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            margin-right: 8px;
            user-select: none;
            transition: all 0.15s ease;
            height: 24px;
        }
        #ag-cc-topbar-btn:hover {
            background: #35373b;
            border-color: #4e5157;
            color: #58a6ff;
        }
        #ag-cc-topbar-btn .token-badge {
            background: rgba(88, 166, 255, 0.15);
            color: #58a6ff;
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 10px;
            font-family: monospace;
        }

        /* Smart Preset Banner */
        #ag-cc-preset-banner {
            position: fixed;
            top: 42px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999990;
            background: rgba(30, 31, 34, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid #388bfd;
            border-radius: 8px;
            padding: 8px 14px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            color: #e6edf3;
            animation: agSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes agSlideDown {
            from { opacity: 0; transform: translate(-50%, -12px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        #ag-cc-preset-banner .btn {
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: 0.15s;
        }
        #ag-cc-preset-banner .btn-confirm {
            background: #238636;
            color: #ffffff;
        }
        #ag-cc-preset-banner .btn-confirm:hover { background: #2ea043; }
        #ag-cc-preset-banner .btn-manual {
            background: #30363d;
            color: #c9d1d9;
        }
        #ag-cc-preset-banner .btn-manual:hover { background: #3c444d; color: #fff; }
        #ag-cc-preset-banner .btn-close {
            background: transparent;
            color: #8b949e;
            padding: 2px 5px;
        }
        #ag-cc-preset-banner .btn-close:hover { color: #f85149; }

        /* Drawer Overlay */
        #ag-cc-drawer-overlay {
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(3px);
            z-index: 999998;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }
        #ag-cc-drawer-overlay.open {
            opacity: 1;
            pointer-events: auto;
        }

        /* Drawer Side Sheet */
        #ag-cc-drawer {
            position: fixed;
            top: 0; right: 0; width: 440px; height: 100vh;
            background: #1e1f22;
            border-left: 1px solid #3c3f41;
            box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);
            z-index: 999999;
            transform: translateX(100%);
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e6edf3;
            user-select: none;
        }
        #ag-cc-drawer.open {
            transform: translateX(0);
        }

        /* Drawer Header */
        .ag-cc-header {
            padding: 14px 18px;
            border-bottom: 1px solid #2b2d30;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #18191c;
        }
        .ag-cc-title {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ag-cc-close {
            background: transparent;
            border: none;
            color: #8b949e;
            font-size: 18px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .ag-cc-close:hover { color: #fff; background: #2b2d30; }

        /* Token Summary HUD */
        .ag-cc-token-hud {
            padding: 10px 18px;
            background: #161b22;
            border-bottom: 1px solid #21262d;
            font-size: 11px;
        }
        .ag-cc-hud-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
        }
        .ag-cc-progress-bar {
            width: 100%;
            height: 5px;
            background: #21262d;
            border-radius: 3px;
            overflow: hidden;
        }
        .ag-cc-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #238636, #388bfd);
            width: 35%;
            transition: width 0.3s ease;
        }

        /* Tabs */
        .ag-cc-tabs {
            display: flex;
            border-bottom: 1px solid #2b2d30;
            background: #18191c;
        }
        .ag-cc-tab-btn {
            flex: 1;
            padding: 10px 0;
            background: transparent;
            border: none;
            color: #8b949e;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            text-align: center;
            border-bottom: 2px solid transparent;
            transition: 0.15s;
        }
        .ag-cc-tab-btn:hover { color: #e6edf3; }
        .ag-cc-tab-btn.active {
            color: #58a6ff;
            border-bottom-color: #58a6ff;
            background: rgba(88, 166, 255, 0.05);
        }

        /* Tab Content */
        .ag-cc-content {
            flex: 1;
            overflow-y: auto;
            padding: 14px 18px;
        }
        .ag-cc-content::-webkit-scrollbar { width: 6px; }
        .ag-cc-content::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }

        /* Presets Bar */
        .ag-cc-presets-bar {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }
        .ag-cc-preset-chip {
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 3px 10px;
            font-size: 11px;
            color: #c9d1d9;
            cursor: pointer;
            transition: 0.15s;
        }
        .ag-cc-preset-chip:hover {
            background: #30363d;
            border-color: #58a6ff;
            color: #fff;
        }

        /* Search input */
        .ag-cc-search {
            width: 100%;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #e6edf3;
            outline: none;
            margin-bottom: 12px;
            box-sizing: border-box;
        }
        .ag-cc-search:focus { border-color: #58a6ff; }

        /* Skill Item */
        .ag-cc-skill-item {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: 0.15s;
        }
        .ag-cc-skill-item:hover { border-color: #30363d; }
        .ag-cc-skill-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .ag-cc-skill-name {
            font-size: 12px;
            font-weight: 600;
            color: #e6edf3;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ag-cc-skill-desc {
            font-size: 11px;
            color: #8b949e;
            line-height: 1.35;
        }
        .ag-cc-skill-source {
            font-size: 9px;
            background: #21262d;
            color: #8b949e;
            border-radius: 3px;
            padding: 1px 4px;
        }
        .ag-cc-skill-tokens {
            font-size: 10px;
            font-family: monospace;
            background: rgba(56, 139, 253, 0.12);
            color: #58a6ff;
            padding: 1px 5px;
            border-radius: 4px;
        }

        /* Switch Toggle */
        .ag-switch {
            position: relative;
            display: inline-block;
            width: 34px;
            height: 18px;
        }
        .ag-switch input { opacity: 0; width: 0; height: 0; }
        .ag-slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #30363d;
            transition: .2s;
            border-radius: 18px;
        }
        .ag-slider:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 2px;
            bottom: 2px;
            background-color: white;
            transition: .2s;
            border-radius: 50%;
        }
        input:checked + .ag-slider { background-color: #238636; }
        input:checked + .ag-slider:before { transform: translateX(16px); }

        /* Workshop Form */
        .ag-cc-form-group {
            margin-bottom: 12px;
        }
        .ag-cc-form-label {
            display: block;
            font-size: 11px;
            font-weight: 500;
            color: #8b949e;
            margin-bottom: 4px;
        }
        .ag-cc-input, .ag-cc-textarea {
            width: 100%;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #e6edf3;
            box-sizing: border-box;
            outline: none;
        }
        .ag-cc-textarea { height: 70px; resize: vertical; }
        .ag-cc-btn-primary {
            width: 100%;
            background: #238636;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: 0.15s;
            margin-top: 6px;
        }
        .ag-cc-btn-primary:hover { background: #2ea043; }
        .ag-cc-btn-secondary {
            width: 100%;
            background: #21262d;
            color: #c9d1d9;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: 0.15s;
            margin-top: 6px;
        }
        .ag-cc-btn-secondary:hover { background: #30363d; color: #fff; }

        /* MCP Status Badges */
        .ag-mcp-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
        .ag-mcp-badge.running { background: rgba(35, 134, 54, 0.2); color: #3fb950; }
        .ag-mcp-badge.disabled { background: rgba(139, 148, 158, 0.2); color: #8b949e; }
    `;
    document.head.appendChild(styleEl);

    // Root Container
    const root = document.createElement("div");
    root.id = "antigravity-control-center-root";

    // Overlay & Drawer HTML
    root.innerHTML = `
        <div id="ag-cc-drawer-overlay"></div>
        <div id="ag-cc-drawer">
            <div class="ag-cc-header">
                <div class="ag-cc-title">
                    <span>⚡ Control Center</span>
                    <span style="font-size:10px; color:#8b949e; font-weight:normal;">[Ctrl+Shift+S]</span>
                </div>
                <button class="ag-cc-close" id="ag-cc-close-btn">&times;</button>
            </div>

            <div class="ag-cc-token-hud">
                <div class="ag-cc-hud-row">
                    <span style="color:#8b949e;">Системный контекст скиллов:</span>
                    <span id="ag-cc-hud-tokens" style="font-weight:600; color:#58a6ff;">~0 токенов</span>
                </div>
                <div class="ag-cc-progress-bar">
                    <div class="ag-cc-progress-fill" id="ag-cc-hud-progress"></div>
                </div>
                <div style="margin-top:4px; color:#8b949e; display:flex; justify-content:space-between;">
                    <span id="ag-cc-hud-count">0 активных скиллов</span>
                    <span id="ag-cc-hud-percent">0%</span>
                </div>
            </div>

            <div class="ag-cc-tabs">
                <button class="ag-cc-tab-btn active" data-tab="skills">Скиллы & Токены</button>
                <button class="ag-cc-tab-btn" data-tab="workshop">Skill Workshop</button>
                <button class="ag-cc-tab-btn" data-tab="mcp">MCP Серверы</button>
            </div>

            <!-- Tab 1: Skills -->
            <div class="ag-cc-content" id="ag-tab-skills">
                <div class="ag-cc-presets-bar">
                    <span style="font-size:11px; color:#8b949e; align-self:center;">Пресеты:</span>
                    <div class="ag-cc-preset-chip" data-preset="all">Все</div>
                    <div class="ag-cc-preset-chip" data-preset="web">Web Fullstack</div>
                    <div class="ag-cc-preset-chip" data-preset="python">Python/Backend</div>
                    <div class="ag-cc-preset-chip" data-preset="minimal">Minimal</div>
                </div>
                <input type="text" class="ag-cc-search" id="ag-cc-skill-search" placeholder="Поиск по скиллам...">
                <div id="ag-cc-skills-list"></div>
            </div>

            <!-- Tab 2: Workshop -->
            <div class="ag-cc-content" id="ag-tab-workshop" style="display:none;">
                <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Создать новый скилл</div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Название (Name):</label>
                    <input type="text" class="ag-cc-input" id="ag-ws-name" placeholder="например: Docker Helper">
                </div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Описание / Триггеры:</label>
                    <textarea class="ag-cc-textarea" id="ag-ws-desc" placeholder="Когда и для чего агенту использовать этот скилл..."></textarea>
                </div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Тип скилла:</label>
                    <select class="ag-cc-input" id="ag-ws-type">
                        <option value="prompt">Только инструкции (Prompt-only)</option>
                        <option value="script">Со вспомогательными скриптами (Scripts/Python)</option>
                    </select>
                </div>
                <button class="ag-cc-btn-primary" id="ag-ws-create-btn">✨ Создать заготовку SKILL.md</button>
                <button class="ag-cc-btn-secondary" id="ag-ws-ai-btn">🤖 Сгенерировать через ИИ в чате</button>

                <hr style="border:0; border-top:1px solid #30363d; margin:16px 0;">

                <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Импорт скилла (GitHub / папка)</div>
                <div class="ag-cc-form-group">
                    <label class="ag-cc-form-label">Ссылка на репозиторий или локальный путь:</label>
                    <input type="text" class="ag-cc-input" id="ag-ws-import-url" placeholder="https://github.com/... или C:\\...">
                </div>
                <button class="ag-cc-btn-secondary" id="ag-ws-import-btn">📥 Импортировать скилл</button>
            </div>

            <!-- Tab 3: MCP -->
            <div class="ag-cc-content" id="ag-tab-mcp" style="display:none;">
                <div style="font-size:11px; color:#8b949e; margin-bottom:10px;">
                    Включение и выключение установленных MCP серверов:
                </div>
                <div id="ag-cc-mcp-list"></div>
            </div>
        </div>
    `;

    document.body.appendChild(root);

    const drawer = document.getElementById("ag-cc-drawer");
    const overlay = document.getElementById("ag-cc-drawer-overlay");
    const closeBtn = document.getElementById("ag-cc-close-btn");

    function toggleDrawer(open) {
        const shouldOpen = open !== undefined ? open : !drawer.classList.contains("open");
        if (shouldOpen) {
            drawer.classList.add("open");
            overlay.classList.add("open");
            refreshData();
        } else {
            drawer.classList.remove("open");
            overlay.classList.remove("open");
        }
    }

    closeBtn.addEventListener("click", () => toggleDrawer(false));
    overlay.addEventListener("click", () => toggleDrawer(false));

    // Global Hotkey Ctrl+Shift+S
    window.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s" || e.key === "Ы" || e.key === "ы")) {
            e.preventDefault();
            toggleDrawer();
        }
        if (e.key === "Escape" && drawer.classList.contains("open")) {
            toggleDrawer(false);
        }
    });

    // Tab Switching
    const tabButtons = root.querySelectorAll(".ag-cc-tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const target = btn.dataset.tab;
            root.querySelectorAll(".ag-cc-content").forEach(c => c.style.display = "none");
            const activeContent = document.getElementById(`ag-tab-${target}`);
            if (activeContent) activeContent.style.display = "block";
        });
    });

    // Topbar Button Injection
    function attachTopbarBtn() {
        if (document.getElementById("ag-cc-topbar-btn")) return;
        const targetContainer = document.getElementById("antigravity-multiacc-root") || document.body;
        const btn = document.createElement("button");
        btn.id = "ag-cc-topbar-btn";
        btn.title = "Skill & MCP Control Center (Ctrl+Shift+S)";
        btn.innerHTML = `<span>⚡ Control</span> <span class="token-badge" id="ag-topbar-badge">0k</span>`;
        btn.addEventListener("click", () => toggleDrawer());
        
        if (targetContainer.id === "antigravity-multiacc-root") {
            targetContainer.insertBefore(btn, targetContainer.firstChild);
        } else {
            // Absolute fallback
            btn.style.position = "fixed";
            btn.style.top = "6px";
            btn.style.right = "240px";
            btn.style.zIndex = "999995";
            document.body.appendChild(btn);
        }
    }
    attachTopbarBtn();
    setInterval(attachTopbarBtn, 2000);

    // State & Rendering
    let currentSkills = [];
    let currentMcp = [];

    async function refreshData() {
        if (!bridge) return;
        try {
            const data = await bridge.getState();
            currentSkills = data.skills || [];
            currentMcp = data.mcpServers || [];

            renderHud(data.totalActiveTokens, data.activeCount, data.totalCount);
            renderSkills(currentSkills);
            renderMcp(currentMcp);

            // Handle Smart Preset Suggestion Banner
            if (data.recommendedPreset && !sessionStorage.getItem("ag_preset_banner_dismissed")) {
                showPresetBanner(data.recommendedPreset);
            }
        } catch (e) {
            console.error("[ControlCenterUI] Refresh failed:", e);
        }
    }

    function renderHud(tokens, active, total) {
        const hudTokens = document.getElementById("ag-cc-hud-tokens");
        const hudProgress = document.getElementById("ag-cc-hud-progress");
        const hudCount = document.getElementById("ag-cc-hud-count");
        const hudPercent = document.getElementById("ag-cc-hud-percent");
        const topbarBadge = document.getElementById("ag-topbar-badge");

        const tokenText = `~${(tokens / 1000).toFixed(1)}k токенов`;
        if (hudTokens) hudTokens.textContent = tokenText;
        if (topbarBadge) topbarBadge.textContent = `${(tokens / 1000).toFixed(1)}k`;

        if (hudCount) hudCount.textContent = `${active} из ${total} скиллов`;
        const pct = total > 0 ? Math.round((active / total) * 100) : 0;
        if (hudPercent) hudPercent.textContent = `${pct}%`;
        if (hudProgress) hudProgress.style.width = `${Math.min(100, pct)}%`;
    }

    function renderSkills(skills) {
        const listEl = document.getElementById("ag-cc-skills-list");
        if (!listEl) return;
        listEl.innerHTML = "";

        const query = (document.getElementById("ag-cc-skill-search")?.value || "").toLowerCase();
        const filtered = skills.filter(s => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));

        if (filtered.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#8b949e; font-size:12px;">Скиллы не найдены</div>`;
            return;
        }

        for (const skill of filtered) {
            const item = document.createElement("div");
            item.className = "ag-cc-skill-item";
            item.innerHTML = `
                <div class="ag-cc-skill-row">
                    <span class="ag-cc-skill-name">
                        ${skill.name}
                        <span class="ag-cc-skill-source">${skill.source}</span>
                    </span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="ag-cc-skill-tokens">~${skill.promptTokens} tkn</span>
                        <label class="ag-switch">
                            <input type="checkbox" ${skill.enabled ? "checked" : ""}>
                            <span class="ag-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="ag-cc-skill-desc">${skill.description}</div>
            `;

            const checkbox = item.querySelector("input");
            checkbox.addEventListener("change", async () => {
                await bridge.toggleSkill(skill.dirPath, checkbox.checked);
                refreshData();
            });

            listEl.appendChild(item);
        }
    }

    function renderMcp(servers) {
        const listEl = document.getElementById("ag-cc-mcp-list");
        if (!listEl) return;
        listEl.innerHTML = "";

        if (servers.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#8b949e; font-size:12px;">MCP серверы не найдены</div>`;
            return;
        }

        for (const server of servers) {
            const item = document.createElement("div");
            item.className = "ag-cc-skill-item";
            item.innerHTML = `
                <div class="ag-cc-skill-row">
                    <span class="ag-cc-skill-name">
                        🔌 ${server.name}
                        <span class="ag-mcp-badge ${server.status}">${server.status.toUpperCase()}</span>
                    </span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:10px; color:#8b949e;">${server.toolCount} tools</span>
                        <label class="ag-switch">
                            <input type="checkbox" ${server.enabled ? "checked" : ""}>
                            <span class="ag-slider"></span>
                        </label>
                    </div>
                </div>
            `;

            const checkbox = item.querySelector("input");
            checkbox.addEventListener("change", async () => {
                await bridge.toggleMcp(server.name, checkbox.checked);
                refreshData();
            });

            listEl.appendChild(item);
        }
    }

    // Search filter listener
    document.getElementById("ag-cc-skill-search")?.addEventListener("input", () => {
        renderSkills(currentSkills);
    });

    // Preset chips
    root.querySelectorAll(".ag-cc-preset-chip").forEach(chip => {
        chip.addEventListener("click", async () => {
            const preset = chip.dataset.preset;
            let targetSkills = [];
            if (preset === "all") {
                targetSkills = currentSkills.map(s => s.id);
            } else if (preset === "web") {
                targetSkills = ["modern-web-guidance", "generative_ui", "ai-product-partner", "chrome-devtools-plugin"];
            } else if (preset === "python") {
                targetSkills = ["uv", "gemini-api-dev", "ai-product-partner"];
            } else if (preset === "minimal") {
                targetSkills = ["ai-product-partner"];
            }

            await bridge.applyPreset(targetSkills);
            refreshData();
        });
    });

    // Workshop: Create
    document.getElementById("ag-ws-create-btn")?.addEventListener("click", async () => {
        const name = document.getElementById("ag-ws-name").value;
        const desc = document.getElementById("ag-ws-desc").value;
        const type = document.getElementById("ag-ws-type").value;
        const res = await bridge.createSkill({ name, description: desc, type, isGlobal: true });
        if (res.success) {
            alert(`Скилл "${name}" успешно создан в ${res.path}!`);
            document.getElementById("ag-ws-name").value = "";
            document.getElementById("ag-ws-desc").value = "";
            refreshData();
        } else {
            alert(`Ошибка: ${res.error}`);
        }
    });

    // Workshop: Generate with AI
    document.getElementById("ag-ws-ai-btn")?.addEventListener("click", () => {
        const name = document.getElementById("ag-ws-name").value || "новый скилл";
        const desc = document.getElementById("ag-ws-desc").value || "";
        const promptText = `Создай для меня новый агентский скилл (SKILL.md) с названием "${name}". Описание и задачи: ${desc}`;
        toggleDrawer(false);
        const chatInput = document.querySelector("textarea, input[placeholder*='message'], [contenteditable='true']");
        if (chatInput) {
            chatInput.value = promptText;
            chatInput.focus();
        } else {
            navigator.clipboard.writeText(promptText);
            alert("Промпт скопирован в буфер обмена!");
        }
    });

    // Workshop: Import
    document.getElementById("ag-ws-import-btn")?.addEventListener("click", async () => {
        const source = document.getElementById("ag-ws-import-url").value;
        const res = await bridge.importSkill({ source, isGlobal: true });
        if (res.success) {
            alert(`Скилл успешно импортирован в ${res.path}!`);
            document.getElementById("ag-ws-import-url").value = "";
            refreshData();
        } else {
            alert(`Ошибка импорта: ${res.error}`);
        }
    });

    // Smart Preset Banner
    function showPresetBanner(preset) {
        if (document.getElementById("ag-cc-preset-banner")) return;
        const banner = document.createElement("div");
        banner.id = "ag-cc-preset-banner";
        banner.innerHTML = `
            <span>${preset.icon || "💡"} Обнаружен стек: <b>${preset.name}</b>. Утвердить пресет?</span>
            <button class="btn btn-confirm" id="ag-banner-confirm">Подтвердить</button>
            <button class="btn btn-manual" id="ag-banner-manual">Ручное управление</button>
            <button class="btn btn-close" id="ag-banner-close">&times;</button>
        `;

        document.body.appendChild(banner);

        document.getElementById("ag-banner-confirm")?.addEventListener("click", async () => {
            await bridge.applyPreset(preset.skills || []);
            banner.remove();
            sessionStorage.setItem("ag_preset_banner_dismissed", "1");
            refreshData();
        });

        document.getElementById("ag-banner-manual")?.addEventListener("click", () => {
            banner.remove();
            sessionStorage.setItem("ag_preset_banner_dismissed", "1");
            toggleDrawer(true);
        });

        document.getElementById("ag-banner-close")?.addEventListener("click", () => {
            banner.remove();
            sessionStorage.setItem("ag_preset_banner_dismissed", "1");
        });
    }

    // Initial load
    refreshData();
}

module.exports = {
    injectControlCenterUI
};
