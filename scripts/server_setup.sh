#!/usr/bin/env bash
# ==============================================================================
# Absolute Antigravity: Multi-User Server Architecture Provisioner (v3.0)
# Supports:
#   Scenario 1: Distinct OS Users (User A & User B with isolated $HOME & Vaults)
#   Scenario 2: Shared Technical OS User (Dev-Box / Remote Runner with Slot Isolation)
# ==============================================================================
set -euo pipefail

# ------------------------------------------------------------------------------
# Color and Logging Helpers
# ------------------------------------------------------------------------------
if [[ -t 1 ]]; then
    C_RESET="\033[0m"
    C_BOLD="\033[1m"
    C_RED="\033[31m"
    C_GREEN="\033[32m"
    C_YELLOW="\033[33m"
    C_BLUE="\033[34m"
    C_CYAN="\033[36m"
    C_MAGENTA="\033[35m"
else
    C_RESET=""
    C_BOLD=""
    C_RED=""
    C_GREEN=""
    C_YELLOW=""
    C_BLUE=""
    C_CYAN=""
    C_MAGENTA=""
fi

log_info()    { echo -e "${C_BLUE}ℹ [SERVER-SETUP]${C_RESET} $*"; }
log_step()    { echo -e "${C_CYAN}➤ [STEP]${C_RESET} ${C_BOLD}$*${C_RESET}"; }
log_success() { echo -e "${C_GREEN}✔ [SUCCESS]${C_RESET} ${C_BOLD}$*${C_RESET}"; }
log_warn()    { echo -e "${C_YELLOW}⚠ [WARN]${C_RESET} $*"; }
log_error()   { echo -e "${C_RED}✖ [ERROR]${C_RESET} $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SHARED_OPT_DIR="/opt/gemini"
SHARED_SKILLS_DIR="${SHARED_OPT_DIR}/skills-library"
SHARED_CONFIG_DIR="${SHARED_OPT_DIR}/config"
SHARED_SOCKETS_DIR="/tmp/agy-sockets"
AGY_GROUP="agy-users"

SCENARIO=""
OS_USERS=()
PROJECT_DIRS=()
NON_INTERACTIVE=false

# ------------------------------------------------------------------------------
# Help / Usage
# ------------------------------------------------------------------------------
show_help() {
    cat << EOF
Absolute Antigravity Server Multi-User Provisioner (v3.0)

Usage:
  sudo ./scripts/server_setup.sh [options]

Scenarios:
  --scenario 1, --os-users       Scenario 1: Distinct OS Users (User A & User B)
                                 Creates shared /opt/gemini library and isolates
                                 user home directories, vaults, and IPC sockets.
  --scenario 2, --shared-user    Scenario 2: Shared OS User / Dev-Box
                                 Configures workspace-level skill sandbox,
                                 session slot bindings, and project sockets.

Options:
  --users "user1 user2"          Space-separated list of OS usernames for Scenario 1
  --projects "path1 path2"       Space-separated list of project root paths for Scenario 2
  --doctor                       Run isolation and permissions health audit
  -y, --yes                      Non-interactive mode
  -h, --help                     Show this help message

Examples:
  sudo ./scripts/server_setup.sh --scenario 1 --users "alice bob charlie"
  ./scripts/server_setup.sh --scenario 2 --projects "/home/dev/projectA /home/dev/projectB"
  ./scripts/server_setup.sh --doctor
EOF
    exit 0
}

# ------------------------------------------------------------------------------
# Argument Parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --scenario)
            SCENARIO="$2"
            shift 2
            ;;
        --os-users|--scenario-1)
            SCENARIO="1"
            shift
            ;;
        --shared-user|--scenario-2)
            SCENARIO="2"
            shift
            ;;
        --users)
            read -r -a OS_USERS <<< "$2"
            shift 2
            ;;
        --projects)
            read -r -a PROJECT_DIRS <<< "$2"
            shift 2
            ;;
        --doctor)
            SCENARIO="doctor"
            shift
            ;;
        -y|--yes)
            NON_INTERACTIVE=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            log_error "Unknown argument: $1"
            show_help
            ;;
    esac
done

# ------------------------------------------------------------------------------
# Root Check Helper
# ------------------------------------------------------------------------------
require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        log_error "This operation requires root privileges. Please re-run with sudo."
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Common: Provision Shared Read-Only Library (/opt/gemini)
# ------------------------------------------------------------------------------
provision_shared_library() {
    require_root
    log_step "Provisioning shared immutable skills library in ${SHARED_OPT_DIR}..."

    # 1. Create system group if not exists
    if ! getent group "${AGY_GROUP}" >/dev/null 2>&1; then
        groupadd "${AGY_GROUP}"
        log_success "Created system group: ${AGY_GROUP}"
    else
        log_info "System group '${AGY_GROUP}' already exists."
    fi

    # 2. Create directory hierarchy
    mkdir -p "${SHARED_SKILLS_DIR}"
    mkdir -p "${SHARED_CONFIG_DIR}"
    mkdir -p "${SHARED_OPT_DIR}/bin"

    # 3. Synchronize 101 skills to /opt/gemini/skills-library
    if [[ -d "${PROJECT_ROOT}/skills-library" ]]; then
        log_info "Copying 101 skills into ${SHARED_SKILLS_DIR}..."
        cp -rf "${PROJECT_ROOT}/skills-library/"* "${SHARED_SKILLS_DIR}/"
    fi

    # 4. Copy presets.yaml Single Source of Truth
    if [[ -f "${PROJECT_ROOT}/presets.yaml" ]]; then
        cp -f "${PROJECT_ROOT}/presets.yaml" "${SHARED_CONFIG_DIR}/presets.yaml"
        cp -f "${PROJECT_ROOT}/presets.yaml" "/etc/gemini-presets.yaml" 2>/dev/null || true
    fi

    # 5. Copy core binaries if available
    if [[ -f "${PROJECT_ROOT}/agy/target/release/agy" ]]; then
        cp -f "${PROJECT_ROOT}/agy/target/release/agy" "/usr/local/bin/agy"
        cp -f "${PROJECT_ROOT}/agy/target/release/agy-daemon" "/usr/local/bin/agy-daemon"
        chmod 755 /usr/local/bin/agy /usr/local/bin/agy-daemon
    fi

    # 6. Copy credHelper.py
    if [[ -f "${PROJECT_ROOT}/credHelper.py" ]]; then
        cp -f "${PROJECT_ROOT}/credHelper.py" "${SHARED_OPT_DIR}/bin/credHelper.py"
        chmod 755 "${SHARED_OPT_DIR}/bin/credHelper.py"
    fi

    # 7. Set strict POSIX permissions: Root owns, agy-users has RX access, NO write access
    chown -R root:"${AGY_GROUP}" "${SHARED_OPT_DIR}"
    chmod -R 755 "${SHARED_OPT_DIR}"

    # 8. Setup shared socket directory with sticky bit (1777)
    mkdir -p "${SHARED_SOCKETS_DIR}"
    chmod 1777 "${SHARED_SOCKETS_DIR}"
    chown root:root "${SHARED_SOCKETS_DIR}"

    log_success "Shared library provisioned at ${SHARED_OPT_DIR} (Permissions: 755, Group: ${AGY_GROUP})"
}

# ------------------------------------------------------------------------------
# Common: Install Systemd Services
# ------------------------------------------------------------------------------
install_systemd_services() {
    require_root
    log_step "Installing systemd service units for agy-daemon..."

    # 1. Systemd User Service Template (/etc/systemd/user/agy-daemon.service)
    mkdir -p /etc/systemd/user
    cat << 'EOF' > /etc/systemd/user/agy-daemon.service
[Unit]
Description=Absolute Antigravity Background IPC & Watchdog Daemon
Documentation=https://github.com/google/antigravity
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/agy-daemon --foreground
Restart=on-failure
RestartSec=5s
Environment=RUST_LOG=info
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOF
    chmod 644 /etc/systemd/user/agy-daemon.service
    log_success "Installed user service template: /etc/systemd/user/agy-daemon.service"

    # 2. Systemd Multi-Tenant Project Template (/etc/systemd/system/agy-project@.service)
    mkdir -p /etc/systemd/system
    cat << 'EOF' > /etc/systemd/system/agy-project@.service
[Unit]
Description=Antigravity Project Daemon for %I
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/agy-daemon --ipc-path /tmp/agy-sockets/agy-%i.sock --foreground
Restart=on-failure
RestartSec=5s
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF
    chmod 644 /etc/systemd/system/agy-project@.service
    systemctl daemon-reload 2>/dev/null || true
    log_success "Installed project daemon template: /etc/systemd/system/agy-project@.service"
}

# ------------------------------------------------------------------------------
# SCENARIO 1: Distinct OS Users
# ------------------------------------------------------------------------------
setup_scenario_1() {
    require_root
    echo -e "${C_BOLD}${C_MAGENTA}"
    echo "=================================================================="
    echo "  👥 SCENARIO 1: Distinct OS Users (User A & User B Isolation)   "
    echo "=================================================================="
    echo -e "${C_RESET}"

    provision_shared_library
    install_systemd_services

    if [[ ${#OS_USERS[@]} -eq 0 ]]; then
        if [[ "$NON_INTERACTIVE" == true ]]; then
            log_error "No users specified. Use --users 'user1 user2'"
            exit 1
        fi
        echo -e "${C_CYAN}Enter username(s) separated by space (e.g. alice bob):${C_RESET}"
        read -r -a OS_USERS
    fi

    if [[ ${#OS_USERS[@]} -eq 0 ]]; then
        log_error "No users specified to configure."
        exit 1
    fi

    for username in "${OS_USERS[@]}"; do
        log_step "Configuring isolated environment for OS user: ${username}..."

        # Create user if does not exist
        if ! id "${username}" >/dev/null 2>&1; then
            useradd -m -s /bin/bash "${username}"
            log_success "Created system user: ${username}"
        fi

        # Add user to agy-users group
        usermod -a -G "${AGY_GROUP}" "${username}"

        local user_home
        user_home=$(getent passwd "${username}" | cut -d: -f6)
        local gemini_dir="${user_home}/.gemini"
        local config_dir="${gemini_dir}/config"
        local skills_dir="${config_dir}/skills"
        local multiacc_file="${gemini_dir}/antigravity_multiacc.json"
        local vault_file="${gemini_dir}/credentials_vault.json"

        # Create directory skeleton
        mkdir -p "${gemini_dir}"
        mkdir -p "${config_dir}"
        mkdir -p "${skills_dir}"
        mkdir -p "${gemini_dir}/antigravity"
        mkdir -p "${gemini_dir}/antigravity/bin"

        # Symlink skills-library to shared /opt/gemini/skills-library
        ln -sfn "${SHARED_SKILLS_DIR}" "${gemini_dir}/skills-library"

        # Copy presets.yaml into user config
        cp -f "${SHARED_CONFIG_DIR}/presets.yaml" "${config_dir}/presets.yaml"

        # Copy credHelper.py into user bin
        cp -f "${SHARED_OPT_DIR}/bin/credHelper.py" "${gemini_dir}/antigravity/bin/credHelper.py"

        # Initialize multiacc config if not exists
        if [[ ! -f "$multiacc_file" ]]; then
            cat << EOF > "$multiacc_file"
{
  "active_slot": 1,
  "auto_failover": true,
  "accounts": []
}
EOF
        fi

        # Initialize credentials vault if not exists
        if [[ ! -f "$vault_file" ]]; then
            echo "{}" > "$vault_file"
        fi

        # Strict permissions: User only (0700 dir, 0600 credentials)
        chown -R "${username}:${username}" "${gemini_dir}"
        chmod 700 "${gemini_dir}"
        chmod 700 "${config_dir}"
        chmod 700 "${skills_dir}"
        chmod 600 "$multiacc_file" "$vault_file"

        # Ensure user runtime socket directory exists
        local runtime_sock_dir="/tmp/agy-${username}"
        mkdir -p "${runtime_sock_dir}"
        chown "${username}:${username}" "${runtime_sock_dir}"
        chmod 700 "${runtime_sock_dir}"

        # Enable lingering for systemd user service so daemon runs without active GUI
        loginctl enable-linger "${username}" 2>/dev/null || true

        log_success "User '${username}' configured: Isolated Home, Vault, and Sockets."
    done

    echo ""
    log_success "Scenario 1 Provisioning Complete!"
    echo -e "Each user can now log in, run ${C_CYAN}agy account add${C_RESET} to authenticate their Google Account,"
    echo -e "and control their presets via ${C_CYAN}agy preset switch <name>${C_RESET} without interfering with each other."
}

# ------------------------------------------------------------------------------
# SCENARIO 2: Shared OS User / Dev-Box Project Slots
# ------------------------------------------------------------------------------
setup_scenario_2() {
    echo -e "${C_BOLD}${C_MAGENTA}"
    echo "=================================================================="
    echo "  🚀 SCENARIO 2: Shared OS User / Dev-Box Project Slots          "
    echo "=================================================================="
    echo -e "${C_RESET}"

    if [[ ${#PROJECT_DIRS[@]} -eq 0 ]]; then
        if [[ "$NON_INTERACTIVE" == true ]]; then
            log_error "No project paths specified. Use --projects '/path/to/proj1 /path/to/proj2'"
            exit 1
        fi
        echo -e "${C_CYAN}Enter project directories separated by space:${C_RESET}"
        read -r -a PROJECT_DIRS
    fi

    if [[ ${#PROJECT_DIRS[@]} -eq 0 ]]; then
        log_error "No project paths specified."
        exit 1
    fi

    # Ensure shared sockets directory exists
    mkdir -p "${SHARED_SOCKETS_DIR}"
    chmod 1777 "${SHARED_SOCKETS_DIR}" 2>/dev/null || chmod 777 "${SHARED_SOCKETS_DIR}"

    local slot_counter=1

    for proj in "${PROJECT_DIRS[@]}"; do
        log_step "Setting up isolated slot sandbox for project: ${proj} (Slot ${slot_counter})..."
        mkdir -p "${proj}"

        # Generate a stable 8-char hash from project path
        local proj_hash
        proj_hash=$(echo -n "${proj}" | sha256sum 2>/dev/null | cut -c1-8 || echo "proj${slot_counter}")

        local proj_gemini="${proj}/.gemini"
        local proj_skills="${proj_gemini}/skills"
        local proj_config="${proj_gemini}/config"
        local proj_agy="${proj}/.agy"
        local proj_sock="${SHARED_SOCKETS_DIR}/agy-${proj_hash}.sock"

        mkdir -p "${proj_gemini}"
        mkdir -p "${proj_skills}"
        mkdir -p "${proj_config}"
        mkdir -p "${proj_agy}"

        # Copy presets.yaml to project config
        if [[ -f "${PROJECT_ROOT}/presets.yaml" ]]; then
            cp -f "${PROJECT_ROOT}/presets.yaml" "${proj_config}/presets.yaml"
        fi

        # Generate Project Configuration
        cat << EOF > "${proj_agy}/config.json"
{
  "project_path": "${proj}",
  "project_hash": "${proj_hash}",
  "slot": ${slot_counter},
  "socket": "${proj_sock}",
  "log_path": "${proj_gemini}/language_server.log",
  "active_preset": "web"
}
EOF

        # Generate per-project activation script
        cat << EOF > "${proj}/.env.agy"
# Auto-generated project environment for Absolute Antigravity
export AGY_WORKSPACE="${proj}"
export AGY_SLOT=${slot_counter}
export AGY_SOCKET="${proj_sock}"
export AGY_PROJECT_HASH="${proj_hash}"
export AGY_CONFIG_DIR="${proj_config}"
export XDG_RUNTIME_DIR="\$(dirname "${proj_sock}")"
EOF

        log_success "Project slot sandbox initialized:"
        echo -e "  Workspace:    ${C_CYAN}${proj}${C_RESET}"
        echo -e "  Slot:         ${C_GREEN}Slot ${slot_counter}${C_RESET}"
        echo -e "  Socket:       ${C_CYAN}${proj_sock}${C_RESET}"
        echo -e "  Activation:   ${C_BOLD}source ${proj}/.env.agy${C_RESET} or ${C_BOLD}source scripts/agy_project_env.sh ${slot_counter}${C_RESET}"

        slot_counter=$((slot_counter + 1))
    done

    echo ""
    log_success "Scenario 2 Workspace Slots Provisioned Successfully!"
}

# ------------------------------------------------------------------------------
# DOCTOR / AUDIT MODE
# ------------------------------------------------------------------------------
run_doctor() {
    echo -e "${C_BOLD}${C_CYAN}"
    echo "=================================================================="
    echo "  🩺 ANTIGRAVITY SERVER MULTI-USER ISOLATION AUDIT               "
    echo "=================================================================="
    echo -e "${C_RESET}"

    local issues=0

    # 1. Check binaries
    echo -n "Checking CLI binary (agy)... "
    if command -v agy >/dev/null 2>&1; then
        echo -e "${C_GREEN}PASS${C_RESET} ($(which agy))"
    else
        echo -e "${C_RED}FAIL${C_RESET} (agy not found in PATH)"
        issues=$((issues + 1))
    fi

    echo -n "Checking Daemon binary (agy-daemon)... "
    if command -v agy-daemon >/dev/null 2>&1; then
        echo -e "${C_GREEN}PASS${C_RESET} ($(which agy-daemon))"
    else
        echo -e "${C_YELLOW}WARN${C_RESET} (agy-daemon not found in PATH)"
    fi

    # 2. Check Shared Library
    echo -n "Checking shared skills library (/opt/gemini/skills-library)... "
    if [[ -d "${SHARED_SKILLS_DIR}" ]]; then
        local count
        count=$(find "${SHARED_SKILLS_DIR}" -mindepth 1 -maxdepth 1 -type d | wc -l)
        echo -e "${C_GREEN}PASS${C_RESET} (${count} skills present)"
    else
        echo -e "${C_YELLOW}WARN${C_RESET} (Shared /opt/gemini not found, checking user ~/.gemini/skills-library)"
        if [[ -d "${HOME}/.gemini/skills-library" ]]; then
            local count
            count=$(find "${HOME}/.gemini/skills-library" -mindepth 1 -maxdepth 1 -type d | wc -l)
            echo -e "  User library: ${C_GREEN}PASS${C_RESET} (${count} skills)"
        else
            echo -e "  User library: ${C_RED}FAIL${C_RESET} (Skills library missing)"
            issues=$((issues + 1))
        fi
    fi

    # 3. Check Sockets Directory
    echo -n "Checking socket directory permissions... "
    if [[ -d "${SHARED_SOCKETS_DIR}" ]]; then
        local perms
        perms=$(stat -c "%a" "${SHARED_SOCKETS_DIR}" 2>/dev/null || stat -f "%Op" "${SHARED_SOCKETS_DIR}" 2>/dev/null || echo "unknown")
        echo -e "${C_GREEN}PASS${C_RESET} (${SHARED_SOCKETS_DIR}, mode: ${perms})"
    else
        echo -e "${C_YELLOW}INFO${C_RESET} (${SHARED_SOCKETS_DIR} not yet created)"
    fi

    # 4. Check Vault Permissions
    local vault="${HOME}/.gemini/credentials_vault.json"
    if [[ -f "$vault" ]]; then
        echo -n "Checking credentials vault security (${vault})... "
        local v_perms
        v_perms=$(stat -c "%a" "$vault" 2>/dev/null || stat -f "%Op" "$vault" 2>/dev/null || echo "unknown")
        if [[ "$v_perms" == "600" || "$v_perms" == "0600" ]]; then
            echo -e "${C_GREEN}SECURE${C_RESET} (mode 0600 - Owner Only)"
        else
            echo -e "${C_RED}INSECURE${C_RESET} (mode ${v_perms} - Should be 0600!)"
            issues=$((issues + 1))
        fi
    fi

    echo ""
    if [[ $issues -eq 0 ]]; then
        echo -e "${C_GREEN}${C_BOLD}✔ All system isolation checks passed cleanly!${C_RESET}"
    else
        echo -e "${C_RED}${C_BOLD}✖ Found ${issues} issue(s). Please review the audit items above.${C_RESET}"
    fi
}

# ------------------------------------------------------------------------------
# Interactive Menu
# ------------------------------------------------------------------------------
interactive_menu() {
    echo -e "${C_BOLD}${C_MAGENTA}"
    echo "=================================================================="
    echo "  🚀 Absolute Antigravity: Server Multi-User Provisioner         "
    echo "=================================================================="
    echo -e "${C_RESET}"
    echo "Select Deployment Architecture Scenario:"
    echo "  1) Scenario 1: Distinct OS Users (User A & User B with isolated \$HOME)"
    echo "  2) Scenario 2: Shared OS User (Dev-Box / Remote Runner with Slot Isolation)"
    echo "  3) Doctor / Audit isolation health"
    echo "  4) Exit"
    echo ""
    read -r -p "Enter choice [1-4]: " choice
    case "$choice" in
        1) setup_scenario_1 ;;
        2) setup_scenario_2 ;;
        3) run_doctor ;;
        *) exit 0 ;;
    esac
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
main() {
    case "$SCENARIO" in
        1) setup_scenario_1 ;;
        2) setup_scenario_2 ;;
        doctor) run_doctor ;;
        *) interactive_menu ;;
    esac
}

main "$@"
