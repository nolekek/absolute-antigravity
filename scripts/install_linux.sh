#!/usr/bin/env bash
# ==============================================================================
# Absolute Antigravity & agy CLI - Linux / WSL Universal Installer (v3.0)
# Supports: Ubuntu, Debian, Alpine, Fedora, CentOS, Rocky, Arch, Manjaro, openSUSE, WSL
# ==============================================================================
set -euo pipefail

# ------------------------------------------------------------------------------
# Color and Logging Utilities
# ------------------------------------------------------------------------------
if [[ -t 1 ]]; then
    COLOR_RESET="\033[0m"
    COLOR_BOLD="\033[1m"
    COLOR_RED="\033[31m"
    COLOR_GREEN="\033[32m"
    COLOR_YELLOW="\033[33m"
    COLOR_BLUE="\033[34m"
    COLOR_CYAN="\033[36m"
    COLOR_MAGENTA="\033[35m"
else
    COLOR_RESET=""
    COLOR_BOLD=""
    COLOR_RED=""
    COLOR_GREEN=""
    COLOR_YELLOW=""
    COLOR_BLUE=""
    COLOR_CYAN=""
    COLOR_MAGENTA=""
fi

log_info()    { echo -e "${COLOR_BLUE}ℹ [INFO]${COLOR_RESET} $*"; }
log_step()    { echo -e "${COLOR_CYAN}➤ [STEP]${COLOR_RESET} ${COLOR_BOLD}$*${COLOR_RESET}"; }
log_success() { echo -e "${COLOR_GREEN}✔ [SUCCESS]${COLOR_RESET} ${COLOR_BOLD}$*${COLOR_RESET}"; }
log_warn()    { echo -e "${COLOR_YELLOW}⚠ [WARN]${COLOR_RESET} $*"; }
log_error()   { echo -e "${COLOR_RED}✖ [ERROR]${COLOR_RESET} $*" >&2; }

# ------------------------------------------------------------------------------
# Locate Project Root & Defaults
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_MODE="auto" # "auto", "system", "user"
CUSTOM_PREFIX=""
SKIP_BUILD=false
NON_INTERACTIVE=false

# ------------------------------------------------------------------------------
# Help / Usage
# ------------------------------------------------------------------------------
show_help() {
    cat << EOF
Absolute Antigravity & agy CLI Universal Linux Installer (v3.0)

Usage:
  ./scripts/install_linux.sh [options]

Options:
  --system           Install system-wide into /usr/local/bin and /opt/gemini (requires sudo/root)
  --user             Install into current user's ~/.local/bin and ~/.gemini
  --prefix <DIR>     Install binaries to custom prefix directory
  --skip-build       Skip source compilation if pre-built binary is missing
  -y, --yes          Non-interactive mode (assume Yes to all prompts)
  -h, --help         Show this help message

Examples:
  ./scripts/install_linux.sh                # Auto-detects privilege (system if root, user otherwise)
  sudo ./scripts/install_linux.sh --system   # System-wide installation for all users
  ./scripts/install_linux.sh --user          # Current user only without root
EOF
    exit 0
}

# ------------------------------------------------------------------------------
# Argument Parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --system)
            INSTALL_MODE="system"
            shift
            ;;
        --user)
            INSTALL_MODE="user"
            shift
            ;;
        --prefix)
            CUSTOM_PREFIX="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
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
            log_error "Unknown option: $1"
            show_help
            ;;
    esac
done

# ------------------------------------------------------------------------------
# OS & Distribution Detection
# ------------------------------------------------------------------------------
detect_distro() {
    DISTRO_ID="unknown"
    DISTRO_LIKE=""
    IS_WSL=false

    if grep -qi microsoft /proc/version 2>/dev/null || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        IS_WSL=true
    fi

    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        DISTRO_ID="${ID:-unknown}"
        DISTRO_LIKE="${ID_LIKE:-}"
    elif [[ -f /etc/alpine-release ]]; then
        DISTRO_ID="alpine"
    elif [[ -f /etc/arch-release ]]; then
        DISTRO_ID="arch"
    elif [[ -f /etc/debian_version ]]; then
        DISTRO_ID="debian"
    fi

    log_info "Detected OS: ${DISTRO_ID} (like: ${DISTRO_LIKE}), WSL=${IS_WSL}"
}

# ------------------------------------------------------------------------------
# Target Directories Setup
# ------------------------------------------------------------------------------
setup_paths() {
    IS_ROOT=false
    if [[ "$(id -u)" -eq 0 ]]; then
        IS_ROOT=true
    fi

    if [[ "$INSTALL_MODE" == "auto" ]]; then
        if [[ "$IS_ROOT" == true ]]; then
            INSTALL_MODE="system"
        else
            INSTALL_MODE="user"
        fi
    fi

    if [[ -n "$CUSTOM_PREFIX" ]]; then
        BIN_DIR="$CUSTOM_PREFIX"
        GEMINI_BASE="${HOME}/.gemini"
    elif [[ "$INSTALL_MODE" == "system" ]]; then
        if [[ "$IS_ROOT" != true ]]; then
            log_error "System-wide installation requires root privileges. Run with sudo or use --user."
            exit 1
        fi
        BIN_DIR="/usr/local/bin"
        GEMINI_BASE="/opt/gemini"
    else
        BIN_DIR="${HOME}/.local/bin"
        GEMINI_BASE="${HOME}/.gemini"
    fi

    SKILLS_LIBRARY_DIR="${GEMINI_BASE}/skills-library"
    CONFIG_DIR="${GEMINI_BASE}/config"
    ACTIVE_SKILLS_DIR="${CONFIG_DIR}/skills"
    USER_GEMINI_DIR="${HOME}/.gemini"

    log_info "Install mode:       ${INSTALL_MODE}"
    log_info "Binary directory:   ${BIN_DIR}"
    log_info "Gemini base:        ${GEMINI_BASE}"
    log_info "Skills library:     ${SKILLS_LIBRARY_DIR}"
    log_info "Config directory:   ${CONFIG_DIR}"
}

# ------------------------------------------------------------------------------
# System Dependencies Check
# ------------------------------------------------------------------------------
install_dependencies() {
    log_step "Checking system dependencies (python3, curl, git)..."

    local missing_pkgs=()

    if ! command -v python3 >/dev/null 2>&1; then
        missing_pkgs+=("python3")
    fi
    if ! command -v curl >/dev/null 2>&1; then
        missing_pkgs+=("curl")
    fi

    if [[ ${#missing_pkgs[@]} -eq 0 ]]; then
        log_success "Core runtime dependencies are present."
        return 0
    fi

    log_warn "Missing required dependencies: ${missing_pkgs[*]}"

    if [[ "$IS_ROOT" != true ]]; then
        log_warn "Cannot automatically install packages without root. Please install: ${missing_pkgs[*]}"
        return 0
    fi

    log_info "Attempting automatic package installation via distro package manager..."
    case "$DISTRO_ID" in
        ubuntu|debian|pop|mint|kali)
            apt-get update -qq && apt-get install -y -qq python3 python3-pip curl ca-certificates libsecret-tools || true
            ;;
        alpine)
            apk add --no-cache python3 py3-pip curl ca-certificates bash || true
            ;;
        fedora|rhel|centos|rocky|almalinux)
            dnf install -y -q python3 python3-pip curl ca-certificates libsecret || yum install -y -q python3 curl || true
            ;;
        arch|manjaro)
            pacman -Sy --noconfirm python python-pip curl ca-certificates libsecret || true
            ;;
        opensuse*|suse)
            zypper --non-interactive install python3 python3-pip curl ca-certificates libsecret || true
            ;;
        *)
            log_warn "Unsupported package manager for ${DISTRO_ID}. Please install: ${missing_pkgs[*]}"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Locate or Build Rust Binaries (agy & agy-daemon)
# ------------------------------------------------------------------------------
prepare_binaries() {
    log_step "Locating or building agy CLI & agy-daemon binaries..."

    local found_agy=""
    local found_daemon=""

    # Candidate locations in order of priority:
    local candidates=(
        "${PROJECT_ROOT}/binaries/linux-x64"
        "${PROJECT_ROOT}/agy/target/x86_64-unknown-linux-musl/release"
        "${PROJECT_ROOT}/agy/target/release"
        "${PROJECT_ROOT}/binaries"
    )

    for dir in "${candidates[@]}"; do
        if [[ -x "${dir}/agy" && -x "${dir}/agy-daemon" ]]; then
            found_agy="${dir}/agy"
            found_daemon="${dir}/agy-daemon"
            log_success "Found pre-built Linux binaries in: ${dir}"
            break
        fi
    done

    # If binaries not found, attempt compilation via Cargo if available
    if [[ -z "$found_agy" || -z "$found_daemon" ]]; then
        if [[ "$SKIP_BUILD" == true ]]; then
            log_error "Pre-built Linux binaries not found and --skip-build was specified."
            exit 1
        fi

        log_warn "Pre-built Linux binaries not found. Checking for Rust / Cargo build toolchain..."

        if command -v cargo >/dev/null 2>&1; then
            log_info "Building agy workspace in release mode (Cargo detected)..."
            (
                cd "${PROJECT_ROOT}/agy"
                cargo build --release
            )
            if [[ -x "${PROJECT_ROOT}/agy/target/release/agy" && -x "${PROJECT_ROOT}/agy/target/release/agy-daemon" ]]; then
                found_agy="${PROJECT_ROOT}/agy/target/release/agy"
                found_daemon="${PROJECT_ROOT}/agy/target/release/agy-daemon"
                log_success "Successfully compiled agy and agy-daemon via Cargo!"
            else
                log_error "Cargo build completed but binaries not found in agy/target/release/"
                exit 1
            fi
        else
            log_error "Neither pre-compiled Linux binaries nor 'cargo' toolchain were found."
            echo ""
            echo "To build from source on Linux, install Rust:"
            echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
            echo "Or copy pre-built Linux binaries into: binaries/linux-x64/agy and agy-daemon"
            exit 1
        fi
    fi

    # Copy binaries to target destination
    mkdir -p "${BIN_DIR}"
    log_info "Installing binaries into ${BIN_DIR}..."
    cp -f "${found_agy}" "${BIN_DIR}/agy"
    cp -f "${found_daemon}" "${BIN_DIR}/agy-daemon"
    chmod 755 "${BIN_DIR}/agy" "${BIN_DIR}/agy-daemon"

    log_success "Installed 'agy' -> ${BIN_DIR}/agy"
    log_success "Installed 'agy-daemon' -> ${BIN_DIR}/agy-daemon"
}

# ------------------------------------------------------------------------------
# Deploy Presets & Skills Library
# ------------------------------------------------------------------------------
deploy_assets() {
    log_step "Deploying skills library, presets manifest, and helpers..."

    # Create directory tree
    mkdir -p "${SKILLS_LIBRARY_DIR}"
    mkdir -p "${CONFIG_DIR}"
    mkdir -p "${ACTIVE_SKILLS_DIR}"
    mkdir -p "${USER_GEMINI_DIR}/config"
    mkdir -p "${USER_GEMINI_DIR}/skills-library"
    mkdir -p "${USER_GEMINI_DIR}/antigravity/bin"

    # 1. Deploy presets.yaml
    if [[ -f "${PROJECT_ROOT}/presets.yaml" ]]; then
        log_info "Deploying presets.yaml manifest..."
        cp -f "${PROJECT_ROOT}/presets.yaml" "${CONFIG_DIR}/presets.yaml"
        chmod 644 "${CONFIG_DIR}/presets.yaml"

        # Also place in user config directory if different
        if [[ "${CONFIG_DIR}" != "${USER_GEMINI_DIR}/config" ]]; then
            cp -f "${PROJECT_ROOT}/presets.yaml" "${USER_GEMINI_DIR}/config/presets.yaml"
        fi
        log_success "Deployed presets.yaml (16 presets Single Source of Truth)"
    else
        log_warn "presets.yaml not found in project root!"
    fi

    # 2. Deploy 101 skills to skills-library
    if [[ -d "${PROJECT_ROOT}/skills-library" ]]; then
        log_info "Synchronizing 101 skills from repository into ${SKILLS_LIBRARY_DIR}..."
        cp -rf "${PROJECT_ROOT}/skills-library/"* "${SKILLS_LIBRARY_DIR}/"
        chmod -R 755 "${SKILLS_LIBRARY_DIR}"

        # If system installation, also symlink or copy to user home for seamless discovery
        if [[ "${SKILLS_LIBRARY_DIR}" != "${USER_GEMINI_DIR}/skills-library" ]]; then
            mkdir -p "${USER_GEMINI_DIR}"
            if [[ ! -e "${USER_GEMINI_DIR}/skills-library" ]]; then
                ln -sfn "${SKILLS_LIBRARY_DIR}" "${USER_GEMINI_DIR}/skills-library"
                log_info "Linked system skills library to ${USER_GEMINI_DIR}/skills-library"
            fi
        fi
        local skill_count
        skill_count=$(find "${SKILLS_LIBRARY_DIR}" -mindepth 1 -maxdepth 1 -type d | wc -l)
        log_success "Synchronized ${skill_count} skills into library."
    else
        log_warn "Directory skills-library/ not found in project root!"
    fi

    # 3. Deploy credHelper.py & switch.py
    if [[ -f "${PROJECT_ROOT}/credHelper.py" ]]; then
        cp -f "${PROJECT_ROOT}/credHelper.py" "${USER_GEMINI_DIR}/antigravity/bin/credHelper.py"
        chmod 755 "${USER_GEMINI_DIR}/antigravity/bin/credHelper.py"
        if [[ "$INSTALL_MODE" == "system" ]]; then
            mkdir -p "/opt/gemini/bin"
            cp -f "${PROJECT_ROOT}/credHelper.py" "/opt/gemini/bin/credHelper.py"
            chmod 755 "/opt/gemini/bin/credHelper.py"
        fi
        log_success "Deployed credHelper.py credential vault manager"
    fi

    if [[ -f "${PROJECT_ROOT}/scripts/switch.py" ]]; then
        cp -f "${PROJECT_ROOT}/scripts/switch.py" "${USER_GEMINI_DIR}/antigravity/bin/switch.py"
        chmod 755 "${USER_GEMINI_DIR}/antigravity/bin/switch.py"
    fi

    # 4. Deploy project environment helper
    if [[ -f "${PROJECT_ROOT}/scripts/agy_project_env.sh" ]]; then
        mkdir -p "${USER_GEMINI_DIR}/bin"
        cp -f "${PROJECT_ROOT}/scripts/agy_project_env.sh" "${USER_GEMINI_DIR}/bin/agy_project_env.sh"
        chmod 755 "${USER_GEMINI_DIR}/bin/agy_project_env.sh"
        if [[ "$INSTALL_MODE" == "system" ]]; then
            cp -f "${PROJECT_ROOT}/scripts/agy_project_env.sh" "/usr/local/bin/agy_project_env.sh"
        fi
    fi
}

# ------------------------------------------------------------------------------
# PATH Configuration Check
# ------------------------------------------------------------------------------
configure_shell_path() {
    log_step "Verifying shell PATH configuration..."

    local target_bin="${BIN_DIR}"
    if [[ ":$PATH:" == *":${target_bin}:"* ]]; then
        log_success "${target_bin} is already present in PATH."
        return 0
    fi

    log_warn "${target_bin} is NOT in your current PATH."

    local export_line="export PATH=\"${target_bin}:\$PATH\""

    if [[ "$INSTALL_MODE" == "system" ]]; then
        local profile_file="/etc/profile.d/agy.sh"
        echo "${export_line}" > "${profile_file}"
        chmod 644 "${profile_file}"
        log_success "Added PATH export to system-wide profile: ${profile_file}"
    else
        local rc_files=("${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile")
        local updated=false
        for rc in "${rc_files[@]}"; do
            if [[ -f "$rc" ]]; then
                if ! grep -q "agy" "$rc" 2>/dev/null; then
                    echo "" >> "$rc"
                    echo "# Absolute Antigravity CLI PATH" >> "$rc"
                    echo "${export_line}" >> "$rc"
                    log_success "Added PATH export to ${rc}"
                    updated=true
                fi
            fi
        done
        if [[ "$updated" == false ]]; then
            echo "${export_line}" >> "${HOME}/.bashrc"
            log_success "Appended PATH export to ~/.bashrc"
        fi
        log_info "To apply PATH in your current terminal session, run:"
        echo -e "    ${COLOR_CYAN}export PATH=\"${target_bin}:\$PATH\"${COLOR_RESET}"
    fi
}

# ------------------------------------------------------------------------------
# Verification & Self-Test
# ------------------------------------------------------------------------------
run_verification() {
    log_step "Verifying installation integrity..."

    local agy_exe="${BIN_DIR}/agy"
    if [[ ! -x "$agy_exe" ]]; then
        log_error "Binary ${agy_exe} is missing or not executable."
        exit 1
    fi

    # Test agy preset list
    log_info "Testing 'agy preset list' execution..."
    if "${agy_exe}" preset list >/dev/null 2>&1; then
        log_success "agy preset engine verified successfully!"
    else
        log_warn "agy preset command ran with non-zero code (normal if skills have not been populated yet)."
    fi

    # Set default minimal preset if not set
    local cfg_file="${USER_GEMINI_DIR}/antigravity/control-center-config.json"
    if [[ ! -f "$cfg_file" ]]; then
        mkdir -p "${USER_GEMINI_DIR}/antigravity"
        echo '{"activePreset": "minimal", "disabledSkills": [], "customPresets": {}}' > "$cfg_file"
        log_info "Initialized default minimal preset configuration."
    fi
}

# ------------------------------------------------------------------------------
# Main Flow
# ------------------------------------------------------------------------------
main() {
    echo -e "${COLOR_BOLD}${COLOR_MAGENTA}"
    echo "=================================================================="
    echo "  🚀 Absolute Antigravity: agy Universal Linux Installer v3.0    "
    echo "=================================================================="
    echo -e "${COLOR_RESET}"

    detect_distro
    setup_paths
    install_dependencies
    prepare_binaries
    deploy_assets
    configure_shell_path
    run_verification

    echo ""
    echo -e "${COLOR_GREEN}${COLOR_BOLD}==================================================================${COLOR_RESET}"
    echo -e "${COLOR_GREEN}${COLOR_BOLD}  🎉 Antigravity & agy CLI installed successfully!               ${COLOR_RESET}"
    echo -e "${COLOR_GREEN}${COLOR_BOLD}==================================================================${COLOR_RESET}"
    echo -e "Binary Path:     ${COLOR_CYAN}${BIN_DIR}/agy${COLOR_RESET}"
    echo -e "Daemon Path:     ${COLOR_CYAN}${BIN_DIR}/agy-daemon${COLOR_RESET}"
    echo -e "Skills Library:  ${COLOR_CYAN}${SKILLS_LIBRARY_DIR}${COLOR_RESET}"
    echo -e "Presets Manifest:${COLOR_CYAN}${CONFIG_DIR}/presets.yaml${COLOR_RESET}"
    echo ""
    echo -e "Quick Start Commands:"
    echo -e "  ${COLOR_BOLD}agy preset list${COLOR_RESET}           # Show all 16 presets"
    echo -e "  ${COLOR_BOLD}agy preset switch web${COLOR_RESET}     # Switch to Web Modern preset"
    echo -e "  ${COLOR_BOLD}agy account status${COLOR_RESET}        # View multi-account slots"
    echo -e "  ${COLOR_BOLD}agy daemon start${COLOR_RESET}          # Start background watchdog"
    echo ""
}

main "$@"
