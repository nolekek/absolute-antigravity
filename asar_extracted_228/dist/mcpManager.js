"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const USER_HOME = os.homedir();
const MCP_DIRS = [
    path.join(USER_HOME, ".gemini", "antigravity", "mcp"),
    path.join(USER_HOME, ".gemini", "config", "mcp")
];

class McpManager {
    getServers() {
        const servers = [];
        const seen = new Set();

        for (const baseDir of MCP_DIRS) {
            if (!fs.existsSync(baseDir)) continue;

            try {
                const entries = fs.readdirSync(baseDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;

                    const folderName = entry.name;
                    const isDisabled = folderName.endsWith(".disabled");
                    const serverName = isDisabled ? folderName.slice(0, -".disabled".length) : folderName;

                    if (seen.has(serverName)) continue;
                    seen.add(serverName);

                    const fullPath = path.join(baseDir, folderName);
                    let toolCount = 0;
                    let hasInstructions = false;

                    try {
                        const files = fs.readdirSync(fullPath);
                        toolCount = files.filter(f => f.endsWith(".json")).length;
                        hasInstructions = files.includes("instructions.md");
                    } catch (_) {}

                    servers.push({
                        name: serverName,
                        folderName,
                        dirPath: fullPath,
                        baseDir,
                        enabled: !isDisabled,
                        toolCount,
                        hasInstructions,
                        status: isDisabled ? "disabled" : "running"
                    });
                }
            } catch (err) {
                console.error("[McpManager] Failed reading MCP dir:", baseDir, err);
            }
        }

        return servers.sort((a, b) => a.name.localeCompare(b.name));
    }

    toggleServer(serverName, targetState) {
        const servers = this.getServers();
        const server = servers.find(s => s.name === serverName);
        if (!server) {
            return { success: false, error: `MCP server ${serverName} not found` };
        }

        try {
            if (targetState === false && server.enabled) {
                // Disable
                const newPath = path.join(server.baseDir, `${server.name}.disabled`);
                fs.renameSync(server.dirPath, newPath);
            } else if (targetState === true && !server.enabled) {
                // Enable
                const newPath = path.join(server.baseDir, server.name);
                fs.renameSync(server.dirPath, newPath);
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

const mcpManager = new McpManager();

module.exports = {
    mcpManager
};
