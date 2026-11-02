#!/usr/bin/env bash
# ==============================================================================
# Absolute Antigravity: Remote Web Dashboard Launcher (Linux / macOS)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js is not installed or not in PATH." >&2
    echo "Please install Node.js 18+ to run the Antigravity Web Dashboard." >&2
    exit 1
fi

DASHBOARD_SCRIPT="${SCRIPT_DIR}/server_dashboard.js"
if [[ ! -f "$DASHBOARD_SCRIPT" ]]; then
    DASHBOARD_SCRIPT="${PROJECT_ROOT}/scripts/server_dashboard.js"
fi

# Detect daemon flag in arguments
IS_DAEMON=false
ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--daemon" || "$arg" == "-d" ]]; then
        IS_DAEMON=true
    else
        ARGS+=("$arg")
    fi
done

if [[ "$IS_DAEMON" == "true" ]]; then
    PID_DIR="${HOME}/.gemini/antigravity"
    PID_FILE="${PID_DIR}/web.pid"
    LOG_FILE="${PID_DIR}/web.log"
    mkdir -p "$PID_DIR"

    echo "🚀 Launching Antigravity Web Dashboard in background (daemon mode)..."
    nohup node "$DASHBOARD_SCRIPT" "${ARGS[@]}" > "$LOG_FILE" 2>&1 &
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"
    sleep 1

    if kill -0 "$DAEMON_PID" 2>/dev/null; then
        echo "✔ Web dashboard started in background (PID: $DAEMON_PID)"
        echo "Logs: $LOG_FILE"
    else
        echo "❌ Dashboard failed to start. Recent logs:"
        tail -n 20 "$LOG_FILE" 2>/dev/null || true
        exit 1
    fi
else
    exec node "$DASHBOARD_SCRIPT" "${ARGS[@]}"
fi
