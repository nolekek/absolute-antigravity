#!/usr/bin/env bash
# ==============================================================================
# Absolute Antigravity: Project Environment & Session Slot Activator (v3.0)
#
# Usage (must be sourced!):
#   source scripts/agy_project_env.sh [slot] [preset] [workspace_path]
#
# Examples:
#   source scripts/agy_project_env.sh 1 web
#   source scripts/agy_project_env.sh 2 backend /home/dev/microservice
# ==============================================================================

# Detect if the script is being sourced or executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo -e "\033[31m✖ [ERROR] This script must be SOURCED, not executed directly!\033[0m"
    echo -e "Run it as: \033[1;36msource ${BASH_SOURCE[0]} [slot] [preset] [workspace_path]\033[0m"
    echo -e "   or as:  \033[1;36m. ${BASH_SOURCE[0]} [slot] [preset] [workspace_path]\033[0m"
    exit 1
fi

# ------------------------------------------------------------------------------
# Resolve Parameters
# ------------------------------------------------------------------------------
_AGY_TARGET_SLOT="${1:-}"
_AGY_TARGET_PRESET="${2:-}"
_AGY_TARGET_WORKSPACE="${3:-}"

# Resolve workspace directory (default to current working directory)
if [[ -z "$_AGY_TARGET_WORKSPACE" ]]; then
    _AGY_TARGET_WORKSPACE="$PWD"
fi
_AGY_TARGET_WORKSPACE="$(cd "$_AGY_TARGET_WORKSPACE" 2>/dev/null && pwd || echo "$_AGY_TARGET_WORKSPACE")"

# Check if project has an existing .agy/config.json
_AGY_PROJECT_CFG="${_AGY_TARGET_WORKSPACE}/.agy/config.json"
if [[ -f "$_AGY_PROJECT_CFG" ]]; then
    _SAVED_SLOT=$(grep -o '"slot":[[:space:]]*[0-9]*' "$_AGY_PROJECT_CFG" 2>/dev/null | awk -F: '{print $2}' | tr -d ' ' || true)
    _SAVED_PRESET=$(grep -o '"active_preset":[[:space:]]*"[^"]*"' "$_AGY_PROJECT_CFG" 2>/dev/null | awk -F'"' '{print $4}' || true)
    if [[ -z "$_AGY_TARGET_SLOT" && -n "$_SAVED_SLOT" ]]; then
        _AGY_TARGET_SLOT="$_SAVED_SLOT"
    fi
    if [[ -z "$_AGY_TARGET_PRESET" && -n "$_SAVED_PRESET" ]]; then
        _AGY_TARGET_PRESET="$_SAVED_PRESET"
    fi
fi

# Final defaults
_AGY_TARGET_SLOT="${_AGY_TARGET_SLOT:-1}"
_AGY_TARGET_PRESET="${_AGY_TARGET_PRESET:-web}"

# ------------------------------------------------------------------------------
# Stable Project Hash & IPC Socket
# ------------------------------------------------------------------------------
_AGY_HASH=$(echo -n "$_AGY_TARGET_WORKSPACE" | sha256sum 2>/dev/null | cut -c1-8 || echo "p${_AGY_TARGET_SLOT}")
_AGY_USER="${USER:-$(id -un 2>/dev/null || echo dev)}"

# Socket path resolution
if [[ -d "/run/user/$(id -u 2>/dev/null || echo 1000)" ]]; then
    _AGY_SOCKET_DIR="/run/user/$(id -u 2>/dev/null || echo 1000)"
elif [[ -d "/tmp/agy-sockets" ]]; then
    _AGY_SOCKET_DIR="/tmp/agy-sockets"
else
    _AGY_SOCKET_DIR="/tmp/agy-${_AGY_USER}"
    mkdir -p "$_AGY_SOCKET_DIR" 2>/dev/null || true
fi

_AGY_SOCKET="${_AGY_SOCKET_DIR}/agy-${_AGY_USER}-${_AGY_HASH}.sock"

# ------------------------------------------------------------------------------
# Export Environment Variables
# ------------------------------------------------------------------------------
export AGY_WORKSPACE="$_AGY_TARGET_WORKSPACE"
export AGY_SLOT="$_AGY_TARGET_SLOT"
export AGY_PRESET="$_AGY_TARGET_PRESET"
export AGY_PROJECT_HASH="$_AGY_HASH"
export AGY_SOCKET="$_AGY_SOCKET"
export AGY_CONFIG_DIR="${_AGY_TARGET_WORKSPACE}/.gemini/config"
export AGY_LOG_PATH="${_AGY_TARGET_WORKSPACE}/.gemini/language_server.log"
export XDG_RUNTIME_DIR="$(dirname "$_AGY_SOCKET")"

# ------------------------------------------------------------------------------
# Project Sandbox Initialization
# ------------------------------------------------------------------------------
mkdir -p "${_AGY_TARGET_WORKSPACE}/.gemini/config"
mkdir -p "${_AGY_TARGET_WORKSPACE}/.gemini/skills"
mkdir -p "${_AGY_TARGET_WORKSPACE}/.agy"

# Save or update project config
cat << EOF > "$_AGY_PROJECT_CFG"
{
  "project_path": "${_AGY_TARGET_WORKSPACE}",
  "project_hash": "${_AGY_HASH}",
  "slot": ${_AGY_TARGET_SLOT},
  "socket": "${_AGY_SOCKET}",
  "log_path": "${_AGY_TARGET_WORKSPACE}/.gemini/language_server.log",
  "active_preset": "${_AGY_TARGET_PRESET}"
}
EOF

# Find skills library source
_AGY_LIB_DIR=""
for _cand in "/opt/gemini/skills-library" "${HOME}/.gemini/skills-library" "${_AGY_TARGET_WORKSPACE}/skills-library"; do
    if [[ -d "$_cand" ]]; then
        _AGY_LIB_DIR="$_cand"
        break
    fi
done

# Synchronize project-level skills for selected preset
_sync_project_skills() {
    local target_preset="$1"
    local proj_skills="${AGY_WORKSPACE}/.gemini/skills"
    mkdir -p "$proj_skills"

    if [[ -z "$_AGY_LIB_DIR" || ! -d "$_AGY_LIB_DIR" ]]; then
        return 0
    fi

    # Read skills from presets.yaml if python3 is available
    local python_bin="python3"
    command -v python3 >/dev/null 2>&1 || python_bin="python"

    if command -v "$python_bin" >/dev/null 2>&1; then
        "$python_bin" - << PYEOF 2>/dev/null || true
import os, sys, yaml, json, glob

workspace = "${AGY_WORKSPACE}"
lib_dir = "${_AGY_LIB_DIR}"
preset_name = "${target_preset}"
dest_dir = os.path.join(workspace, ".gemini", "skills")
os.makedirs(dest_dir, exist_ok=True)

manifest_paths = [
    os.path.join(workspace, ".gemini", "config", "presets.yaml"),
    "/opt/gemini/config/presets.yaml",
    os.path.expanduser("~/.gemini/config/presets.yaml"),
    os.path.join(workspace, "presets.yaml")
]

presets_file = None
for p in manifest_paths:
    if os.path.exists(p):
        presets_file = p
        break

skills_to_link = set([
    "agent-preset-conductor", "grill-me", "systematic-debugging",
    "verification-before-completion", "concise-planning"
])

if presets_file:
    try:
        with open(presets_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            if data and "presets" in data and preset_name in data["presets"]:
                skills_to_link.update(data["presets"][preset_name].get("skills", []))
    except Exception:
        pass

# Clean old symlinks in project skills dir
for entry in os.listdir(dest_dir):
    p = os.path.join(dest_dir, entry)
    if os.path.islink(p):
        os.unlink(p)

# Create links
for s in skills_to_link:
    src = os.path.join(lib_dir, s)
    dst = os.path.join(dest_dir, s)
    if os.path.exists(src) and not os.path.exists(dst):
        try:
            os.symlink(src, dst)
        except Exception:
            pass
PYEOF
    fi
}

_sync_project_skills "$_AGY_TARGET_PRESET"

# ------------------------------------------------------------------------------
# Interactive Helper Functions for Developer Shell
# ------------------------------------------------------------------------------

# 1. agy-status
agy-status() {
    echo -e "\033[1;35m==================================================================\033[0m"
    echo -e "\033[1;35m  👤 ANTIGRAVITY PROJECT ENVIRONMENT STATUS                        \033[0m"
    echo -e "\033[1;35m==================================================================\033[0m"
    echo -e "  Project Workspace:  \033[1;36m${AGY_WORKSPACE}\033[0m"
    echo -e "  Project Hash:       \033[1;33m${AGY_PROJECT_HASH}\033[0m"
    echo -e "  Active Slot:        \033[1;32mSlot ${AGY_SLOT}\033[0m"
    echo -e "  Active Preset:      \033[1;36m${AGY_PRESET}\033[0m"
    echo -e "  IPC Socket:         \033[1;34m${AGY_SOCKET}\033[0m"
    echo -e "  Language Log:       \033[0;37m${AGY_LOG_PATH}\033[0m"
    echo -e "  Local Skills:       \033[1;32m$(find "${AGY_WORKSPACE}/.gemini/skills" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l) mounted\033[0m"
    echo -e "\033[1;35m------------------------------------------------------------------\033[0m"

    # Daemon status check
    if [[ -S "${AGY_SOCKET}" ]]; then
        echo -e "  Daemon Status:      \033[1;32m● RUNNING\033[0m (Socket active)"
    else
        echo -e "  Daemon Status:      \033[1;33m○ STOPPED\033[0m (Run 'agy-daemon-start' to launch)"
    fi

    # Account slot info if agy CLI is present
    if command -v agy >/dev/null 2>&1; then
        echo ""
        agy account status 2>/dev/null || true
    fi
}

# 2. agy-switch
agy-switch() {
    local target="$1"
    if [[ -z "$target" ]]; then
        echo "Usage: agy-switch <preset_name> (e.g. web, backend, qa, devops, orchestrator)"
        return 1
    fi
    export AGY_PRESET="$target"
    _sync_project_skills "$target"
    echo -e "\033[1;32m✔ [SWITCH] Project preset updated to '${target}'\033[0m (${AGY_WORKSPACE})"

    # Update project config
    if [[ -f "${AGY_WORKSPACE}/.agy/config.json" ]]; then
        sed -i "s/\"active_preset\":[[:space:]]*\"[^\"]*\"/\"active_preset\": \"${target}\"/" "${AGY_WORKSPACE}/.agy/config.json" 2>/dev/null || true
    fi

    # If agy CLI exists, synchronize
    if command -v agy >/dev/null 2>&1; then
        agy preset switch "$target" 2>/dev/null || true
    fi
}

# 3. agy-daemon-start
agy-daemon-start() {
    if [[ -S "${AGY_SOCKET}" ]]; then
        echo -e "\033[1;33m⚠ Daemon socket already exists at ${AGY_SOCKET}\033[0m"
    fi
    echo -e "\033[1;34m➤ Launching agy-daemon for project [${AGY_PROJECT_HASH}]...\033[0m"
    if command -v agy-daemon >/dev/null 2>&1; then
        nohup agy-daemon --ipc-path "${AGY_SOCKET}" --log-path "${AGY_LOG_PATH}" > "${AGY_WORKSPACE}/.gemini/daemon.log" 2>&1 &
        local pid=$!
        echo -e "\033[1;32m✔ agy-daemon launched (PID: ${pid})\033[0m"
    else
        echo -e "\033[31m✖ Binary 'agy-daemon' not found in PATH!\033[0m"
    fi
}

# 4. agy-daemon-stop
agy-daemon-stop() {
    if command -v agy >/dev/null 2>&1; then
        agy daemon stop 2>/dev/null || true
    fi
    if [[ -S "${AGY_SOCKET}" ]]; then
        rm -f "${AGY_SOCKET}"
    fi
    echo -e "\033[1;32m✔ Stopped project daemon.\033[0m"
}

# ------------------------------------------------------------------------------
# Banner Display
# ------------------------------------------------------------------------------
echo -e "\033[1;32m"
echo "  🚀 Absolute Antigravity Project Environment Activated!"
echo -e "\033[0m"
echo -e "  📂 Workspace: \033[1;36m${AGY_WORKSPACE}\033[0m"
echo -e "  👤 Slot:      \033[1;32m[Slot ${AGY_SLOT}]\033[0m"
echo -e "  🎛️ Preset:    \033[1;33m${AGY_PRESET}\033[0m"
echo -e "  🔌 Socket:    \033[0;34m${AGY_SOCKET}\033[0m"
echo ""
echo -e "  Available project commands:"
echo -e "    \033[1;37magy-status\033[0m        - Inspect current slot, quota & preset status"
echo -e "    \033[1;37magy-switch <name>\033[0m - Switch preset for this project"
echo -e "    \033[1;37magy-daemon-start\033[0m  - Start isolated project IPC watchdog"
echo -e "    \033[1;37magy-daemon-stop\033[0m   - Stop project watchdog"
echo ""
