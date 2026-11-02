use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use clap::{Parser, Subcommand};
use colored::Colorize;

use agy_core::credentials::{CredentialManager, ProjectConfig, SlotResolutionSource};
use agy_core::ipc::{IpcRequest, IpcResponse};
use agy_core::presets::PresetManager;
use agy_core::symlink::SymlinkEngine;
use agy_core::{
    build_preset_system_prompt, resolve_preset, ChatMessage, GeminiClient, DEFAULT_MODEL,
};

#[derive(Parser)]
#[command(
    name = "agy",
    version = "3.0.0",
    about = "Autonomous Headless CLI for Absolute Antigravity",
    after_help = "Examples:\n  agy chat\n  agy chat --preset backend --model gemini-2.0-flash\n  cat code.rs | agy exec \"найди баги\"\n  agy exec \"Объясни модель владения в Rust\"\n  agy preset switch backend qa\n  agy preset switch web +qa +docker -w /path/to/project\n  agy preset list\n  agy account status\n  agy account rotate\n  agy account get-token\n  agy account export-env\n  agy project init --slot 2 --preset backend\n  agy daemon start"
)]
struct Cli {
    /// Custom Named Pipe / Unix Socket path
    #[arg(long, global = true, env = "AGY_SOCKET")]
    socket: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage and switch skill presets and composite overlays
    Preset {
        #[command(subcommand)]
        cmd: PresetCommands,
    },
    /// Manage multi-account carousel slots and failover
    Account {
        #[command(subcommand)]
        cmd: AccountCommands,
    },
    /// Control the background watchdog and IPC daemon
    Daemon {
        #[command(subcommand)]
        cmd: DaemonCommands,
    },
    /// Initialize and configure local project workspace (.agy/config.json)
    Project {
        #[command(subcommand)]
        cmd: ProjectCommands,
    },
    /// Interactive TUI chat session with Gemini streaming and preset context
    Chat {
        /// Account slot to use (optional, defaults to bound/active slot)
        #[arg(short, long)]
        slot: Option<usize>,
        /// Preset to use (optional, defaults to active preset)
        #[arg(short, long)]
        preset: Option<String>,
        /// Model name to use (optional, defaults to AGY_MODEL or gemini-2.0-flash)
        #[arg(short, long)]
        model: Option<String>,
    },
    /// Execute a one-shot prompt with streaming output (supports stdin pipes)
    Exec {
        /// Prompt string (can also be piped via stdin)
        prompt: Option<String>,
        /// Account slot to use (optional, defaults to bound/active slot)
        #[arg(short, long)]
        slot: Option<usize>,
        /// Preset to use (optional, defaults to active preset)
        #[arg(short, long)]
        preset: Option<String>,
        /// Model name to use (optional, defaults to AGY_MODEL or gemini-2.0-flash)
        #[arg(short, long)]
        model: Option<String>,
    },
}

#[derive(Subcommand)]
enum PresetCommands {
    /// Switch active preset with optional overlays
    Switch {
        /// Base preset name (e.g. web, backend, qa, devops, orchestrator)
        name: String,
        /// Target workspace directory (auto-detected if omitted)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
        /// Optional overlays (e.g. qa, +docker)
        #[arg(trailing_var_arg = true)]
        overlays: Vec<String>,
    },
    /// List all available presets
    List {
        /// Target workspace directory (auto-detected if omitted)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
    },
    /// Display current active preset and linked skills
    Current {
        /// Target workspace directory (auto-detected if omitted)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum AccountCommands {
    /// Show account status and carousel slots
    Status {
        /// Target workspace directory (auto-detected if omitted)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
    },
    /// Rotate to next slot or specified slot number
    Rotate {
        /// Target slot number (optional)
        slot: Option<u32>,
    },
    /// Interactively add a new Google account slot
    Add,
    /// Delete an account slot with zero-gap compaction
    Delete {
        /// Slot number to delete
        slot: u32,
    },
    /// Output bearer/refresh token for resolved slot
    GetToken {
        /// Slot number (optional, resolved via priority if omitted)
        #[arg(short, long, env = "AGY_SLOT")]
        slot: Option<u32>,
        /// Target workspace directory (auto-detected if omitted)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
    },
    /// Export ready environment variables for bash/cmd (AGY_SLOT=..., AGY_PRESET=...)
    ExportEnv {
        /// Slot number (optional, resolved via priority if omitted)
        #[arg(short, long, env = "AGY_SLOT")]
        slot: Option<u32>,
        /// Target workspace directory (auto-detected if omitted)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
        /// Output shell format: bash, cmd, powershell (default: bash)
        #[arg(long, default_value = "bash")]
        shell: String,
    },
}

#[derive(Subcommand)]
enum ProjectCommands {
    /// Initialize .agy/config.json and skills in target project workspace
    Init {
        /// Account slot to bind to this project
        #[arg(short, long)]
        slot: Option<u32>,
        /// Preset name to bind to this project
        #[arg(short, long)]
        preset: Option<String>,
        /// Target workspace directory (defaults to current dir)
        #[arg(short = 'w', long = "workspace")]
        workspace: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum DaemonCommands {
    /// Start the background daemon
    Start {
        #[arg(long, default_value_t = false, help = "Run in foreground")]
        foreground: bool,
    },
    /// Stop the background daemon
    Stop,
    /// Check daemon status
    Status,
}

fn get_control_center_config_path() -> Option<PathBuf> {
    agy_core::presets::dirs_home().map(|h| h.join(".gemini").join("antigravity").join("control-center-config.json"))
}

fn get_active_preset() -> String {
    if let Some(path) = get_control_center_config_path() {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(p) = val.get("activePreset").and_then(|v| v.as_str()) {
                        return p.to_string();
                    }
                }
            }
        }
    }
    "minimal".to_string()
}

fn save_active_preset(preset: &str) {
    if let Some(path) = get_control_center_config_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut obj = serde_json::json!({
            "activePreset": preset,
            "disabledSkills": [],
            "customPresets": {}
        });
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(existing) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(m) = existing.as_object() {
                        let mut map = m.clone();
                        map.insert("activePreset".to_string(), serde_json::Value::String(preset.to_string()));
                        obj = serde_json::Value::Object(map);
                    }
                }
            }
        }
        if let Ok(data) = serde_json::to_string_pretty(&obj) {
            let _ = std::fs::write(&path, data);
        }
    }
}

async fn try_ipc_request(req: &IpcRequest, socket_override: Option<&str>) -> Option<IpcResponse> {
    let socket_path = socket_override
        .map(agy_core::ipc::normalize_ipc_path)
        .unwrap_or_else(agy_core::ipc::get_default_ipc_path);

    #[cfg(windows)]
    {
        if let Ok(mut client) = tokio::net::windows::named_pipe::ClientOptions::new().open(&socket_path) {
            return agy_core::ipc::send_ipc_request(&mut client, req).await.ok();
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(mut stream) = tokio::net::UnixStream::connect(&socket_path).await {
            return agy_core::ipc::send_ipc_request(&mut stream, req).await.ok();
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Standalone Executors (Fallback if daemon is offline)
// ---------------------------------------------------------------------------
fn execute_preset_switch_standalone(
    name: &str,
    overlays: &[String],
    workspace: Option<&Path>,
) -> anyhow::Result<()> {
    let mgr = PresetManager::load_auto(None);
    let resolved = mgr.resolve_active_skills(name, overlays)?;

    let overlay_str = if overlays.is_empty() {
        String::new()
    } else {
        format!(" + {}", overlays.join(" + "))
    };

    if let Some(ws) = workspace {
        let lib_dir = agy_core::symlink::default_library_dir()?;
        let report = agy_core::symlink::sync_workspace_skills(
            ws,
            &resolved.active_skills.iter().cloned().collect::<Vec<_>>(),
            &lib_dir,
        )?;

        // Update .agy/config.json
        let mut cfg = ProjectConfig::load(ws)
            .ok()
            .flatten()
            .unwrap_or_default();
        cfg.preset = Some(name.to_string());
        cfg.overlays = overlays.to_vec();
        cfg.save(ws)?;

        println!(
            "{} [Смена пресета (Workspace: {}) : {}{}] {} навыков активно (синхронизировано за {} мс)",
            "🎯".bold(),
            ws.display().to_string().cyan(),
            name.cyan().bold(),
            overlay_str.yellow(),
            resolved.total_skills.to_string().green().bold(),
            report.duration_ms
        );

        if !report.added.is_empty() {
            println!("  {} {}", "+ Добавлено:".green(), report.added.join(", "));
        }
        if !report.removed.is_empty() {
            println!("  {} {}", "- Удалено:".red(), report.removed.join(", "));
        }
        if !report.kept.is_empty() {
            println!("  {} {} навыков", "= Сохранено:".blue(), report.kept.len());
        }
        if !report.errors.is_empty() {
            for (skill, err) in &report.errors {
                println!("  {} {}: {}", "! Ошибка:".yellow(), skill, err);
            }
        }
    } else {
        let engine = SymlinkEngine::default_paths()?;
        let report = engine.sync_skills(&resolved.active_skills)?;
        save_active_preset(name);

        println!(
            "{} [Смена пресета: {}{}] {} навыков активно (синхронизировано за {} мс)",
            "🎯".bold(),
            name.cyan().bold(),
            overlay_str.yellow(),
            resolved.total_skills.to_string().green().bold(),
            report.duration_ms
        );

        if !report.added.is_empty() {
            println!("  {} {}", "+ Добавлено:".green(), report.added.join(", "));
        }
        if !report.removed.is_empty() {
            println!("  {} {}", "- Удалено:".red(), report.removed.join(", "));
        }
        if !report.kept.is_empty() {
            println!("  {} {} навыков", "= Сохранено:".blue(), report.kept.len());
        }
        if !report.errors.is_empty() {
            for (skill, err) in &report.errors {
                println!("  {} {}: {}", "! Ошибка:".yellow(), skill, err);
            }
        }
    }

    Ok(())
}

fn execute_preset_list_standalone(workspace: Option<&Path>) -> anyhow::Result<()> {
    let mgr = PresetManager::load_auto(None);
    let presets = mgr.list_presets();
    let active = if let Some(ws) = workspace {
        ProjectConfig::load(ws)
            .ok()
            .flatten()
            .and_then(|c| c.preset)
            .unwrap_or_else(get_active_preset)
    } else {
        get_active_preset()
    };

    println!("\n{}", "📋 Доступные пресеты Absolute Antigravity:".bold());
    println!("{:-<80}", "");
    println!(
        "{:<18} {:<4} {:<8} {}",
        "ID ПРЕСЕТА", "ИКОН", "НАВЫКИ", "ОПИСАНИЕ"
    );
    println!("{:-<80}", "");

    for p in presets {
        let is_active = p.id.eq_ignore_ascii_case(&active);
        let id_col = if is_active {
            format!("* {}", p.id).green().bold()
        } else {
            format!("  {}", p.id).normal()
        };

        println!(
            "{:<18} {:<4} {:<8} {}",
            id_col,
            p.icon,
            p.skill_count,
            p.description
        );
    }
    println!("{:-<80}", "");
    if let Some(ws) = workspace {
        println!("Текущий активный пресет (Workspace: {}): {}\n", ws.display().to_string().cyan(), active.cyan().bold());
    } else {
        println!("Текущий активный пресет: {}\n", active.cyan().bold());
    }
    Ok(())
}

fn execute_preset_current_standalone(workspace: Option<&Path>) -> anyhow::Result<()> {
    let mgr = PresetManager::load_auto(None);

    if let Some(ws) = workspace {
        let ws_cfg = ProjectConfig::load(ws).ok().flatten();
        let active = ws_cfg.and_then(|c| c.preset).unwrap_or_else(get_active_preset);
        let overlays: Vec<String> = Vec::new();
        let resolved = mgr.resolve_active_skills(&active, &overlays)?;
        let active_links = agy_core::symlink::SymlinkEngine::for_workspace(ws, None)
            .map(|e| e.list_active().unwrap_or_default())
            .unwrap_or_default();

        let p_info = mgr.get_preset(&active);
        let name = p_info.map(|p| p.name.clone()).unwrap_or_else(|| active.clone());
        let icon = p_info.and_then(|p| p.icon.clone()).unwrap_or_else(|| "⚡".to_string());

        println!("\n{} Текущий профиль проекта (Workspace: {}):", icon, ws.display().to_string().cyan());
        println!("  Пресет: {} ({})", name.bold(), active.cyan());
        println!("  Активных ссылок на диске: {}", active_links.len().to_string().green());
        println!("  Ожидаемых навыков: {}", resolved.total_skills.to_string().cyan());
        println!("  Навыки: {}\n", active_links.join(", "));
    } else {
        let active = get_active_preset();
        let overlays: Vec<String> = Vec::new();
        let resolved = mgr.resolve_active_skills(&active, &overlays)?;
        let active_links = SymlinkEngine::default_paths()
            .map(|e| e.list_active().unwrap_or_default())
            .unwrap_or_default();

        let p_info = mgr.get_preset(&active);
        let name = p_info.map(|p| p.name.clone()).unwrap_or_else(|| active.clone());
        let icon = p_info.and_then(|p| p.icon.clone()).unwrap_or_else(|| "⚡".to_string());

        println!("\n{} Текущий глобальный профиль:", icon);
        println!("  Пресет: {} ({})", name.bold(), active.cyan());
        println!("  Активных ссылок на диске: {}", active_links.len().to_string().green());
        println!("  Ожидаемых навыков: {}", resolved.total_skills.to_string().cyan());
        println!("  Навыки: {}\n", active_links.join(", "));
    }
    Ok(())
}

fn execute_account_status_standalone(workspace: Option<&Path>) -> anyhow::Result<()> {
    let mgr = CredentialManager::default_manager();
    let status = mgr.get_status()?;
    let (bound_slot, source) = mgr.resolve_slot(None, workspace)?;

    println!("\n{}", "👤 Учетные записи Google Antigravity:".bold());
    println!("{:-<60}", "");
    println!(
        "Активный слот: [{}/{}] {}",
        status.active_slot.to_string().cyan().bold(),
        status.slots_count,
        status.current_email.as_deref().unwrap_or("Не авторизован").green()
    );
    println!(
        "Привязка сессии/воркспейса: [{}] ({})",
        bound_slot.to_string().cyan().bold(),
        source.to_string().yellow()
    );
    println!("Автопереход при 429 (Auto-Failover): {}", if status.auto_failover { "Включен".green() } else { "Выключен".red() });
    println!("{:-<60}", "");

    for acc in &status.accounts {
        let is_active = acc.slot == status.active_slot;
        let is_bound = acc.slot == bound_slot;

        let badge = match (is_active, is_bound) {
            (true, true) => "(ACTIVE & BOUND)".green().bold(),
            (true, false) => "(ACTIVE)".green().bold(),
            (false, true) => "[BOUND]".cyan().bold(),
            (false, false) => "".normal(),
        };

        let marker = if is_bound || is_active {
            "▶".green().bold()
        } else {
            " ".normal()
        };

        println!(
            "  {} [Слот {}] {} {}",
            marker,
            acc.slot,
            if is_bound || is_active { acc.email.bold() } else { acc.email.normal() },
            badge
        );
    }
    println!("{:-<60}\n", "");
    Ok(())
}

fn execute_account_get_token(slot: Option<u32>, workspace: Option<PathBuf>) -> anyhow::Result<()> {
    let ws = agy_core::symlink::detect_workspace(workspace.as_deref());
    let mgr = CredentialManager::default_manager();
    let (resolved_slot, _source) = mgr.resolve_slot(slot, ws.as_deref())?;
    let token = mgr.get_token_for_slot(resolved_slot)?;
    println!("{}", token);
    Ok(())
}

fn execute_account_export_env(
    slot: Option<u32>,
    workspace: Option<PathBuf>,
    shell: &str,
) -> anyhow::Result<()> {
    let ws = agy_core::symlink::detect_workspace(workspace.as_deref());
    let mgr = CredentialManager::default_manager();
    let (resolved_slot, _source) = mgr.resolve_slot(slot, ws.as_deref())?;

    let preset = if let Some(ref w) = ws {
        ProjectConfig::load(w)
            .ok()
            .flatten()
            .and_then(|c| c.preset)
            .unwrap_or_else(get_active_preset)
    } else {
        get_active_preset()
    };

    match shell.to_lowercase().as_str() {
        "cmd" | "bat" => {
            println!("set AGY_SLOT={}", resolved_slot);
            println!("set AGY_PRESET={}", preset);
        }
        "powershell" | "ps" | "pwsh" => {
            println!("$env:AGY_SLOT = \"{}\"", resolved_slot);
            println!("$env:AGY_PRESET = \"{}\"", preset);
        }
        _ => {
            println!("export AGY_SLOT={}", resolved_slot);
            println!("export AGY_PRESET={}", preset);
        }
    }

    Ok(())
}

fn execute_project_init(
    slot: Option<u32>,
    preset: Option<String>,
    workspace: Option<PathBuf>,
) -> anyhow::Result<()> {
    let ws_dir = workspace
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));

    let mgr = CredentialManager::default_manager();
    let status = mgr.get_status().ok();
    let target_slot = slot.unwrap_or_else(|| status.as_ref().map(|s| s.active_slot).unwrap_or(1));

    let pmgr = PresetManager::load_auto(None);
    let target_preset = preset.unwrap_or_else(|| {
        let cur = get_active_preset();
        if pmgr.get_preset(&cur).is_some() {
            cur
        } else {
            "backend".to_string()
        }
    });

    let resolved = pmgr.resolve_active_skills(&target_preset, &[])?;

    let cfg = ProjectConfig {
        slot: Some(target_slot),
        preset: Some(target_preset.clone()),
        overlays: vec![],
    };
    cfg.save(&ws_dir)?;

    let lib_dir = agy_core::symlink::default_library_dir()?;
    let report = agy_core::symlink::sync_workspace_skills(
        &ws_dir,
        &resolved.active_skills.into_iter().collect::<Vec<_>>(),
        &lib_dir,
    )?;

    println!(
        "\n{} {}",
        "✨".bold(),
        "Проект успешно инициализирован (Absolute Antigravity Workspace):".bold().green()
    );
    println!("{:-<70}", "");
    println!("  Каталог:   {}", ws_dir.display().to_string().cyan().bold());
    println!("  Конфиг:    {}", ws_dir.join(".agy").join("config.json").display().to_string().yellow());
    println!("  Слот:      [{}]", target_slot.to_string().cyan().bold());
    println!("  Пресет:    {} ({})", target_preset.bold(), resolved.total_skills.to_string().green());
    println!(
        "  Симлинки:  {}/.gemini/config/skills/ (активно {} навыков за {} мс)",
        ws_dir.display(),
        report.added.len() + report.kept.len(),
        report.duration_ms
    );
    println!("{:-<70}\n", "");
    Ok(())
}

fn execute_account_rotate_standalone(target_slot: Option<u32>) -> anyhow::Result<()> {
    let mgr = CredentialManager::default_manager();
    let status = mgr.rotate(target_slot)?;
    println!(
        "{} [Ротация аккаунта]: переключено на слот [{}/{}] {}",
        "🔄".bold(),
        status.active_slot.to_string().cyan().bold(),
        status.slots_count,
        status.current_email.as_deref().unwrap_or("Unknown").green().bold()
    );
    Ok(())
}

fn execute_account_add_standalone() -> anyhow::Result<()> {
    let mgr = CredentialManager::default_manager();
    let next_slot = mgr.prepare_add_login()?;

    println!("\n{}", "➕ Добавление нового аккаунта в пул:".bold());
    println!("1. Слот [{}] подготовлен для авторизации.", next_slot.to_string().cyan().bold());
    println!("2. Активный токен временно снят.");
    println!("3. Откройте Antigravity и выполните вход в новый Google аккаунт.");
    println!("\nНажмите [Enter] после завершения авторизации (или введите 'cancel' для отмены):");

    let mut input = String::new();
    let _ = io::stdin().read_line(&mut input);

    if input.trim().eq_ignore_ascii_case("cancel") {
        println!("Операция добавления отменена.");
        return Ok(());
    }

    match mgr.finalize_add_login() {
        Ok(status) => {
            println!(
                "{} Аккаунт успешно добавлен! Всего слотов в пуле: {}",
                "✅".green().bold(),
                status.slots_count.to_string().cyan().bold()
            );
        }
        Err(e) => {
            println!("{} Ошибка при получении токена: {}", "❌".red().bold(), e);
        }
    }
    Ok(())
}

fn execute_account_delete_standalone(slot: u32) -> anyhow::Result<()> {
    let mgr = CredentialManager::default_manager();
    let status = mgr.delete_slot(slot)?;
    println!(
        "{} Слот {} удален. Пул аккаунтов скомпактифицирован (1..{}).",
        "🗑️".bold(),
        slot,
        status.slots_count
    );
    println!(
        "Активный слот: [{}/{}] {}",
        status.active_slot,
        status.slots_count,
        status.current_email.as_deref().unwrap_or("Unknown").green()
    );
    Ok(())
}

fn execute_daemon_status(socket: Option<&str>) -> anyhow::Result<()> {
    let rt = tokio::runtime::Runtime::new()?;
    let resp = rt.block_on(async {
        try_ipc_request(&IpcRequest::DaemonStatus, socket).await
    });

    match resp {
        Some(IpcResponse::Success { data }) => {
            println!("\n{}", "🛡️  agy-daemon status: RUNNING (Online)".green().bold());
            if let Some(uptime) = data.get("uptime_secs").and_then(|v| v.as_u64()) {
                println!("  Аптайм: {} сек", uptime);
            }
            if let Some(log) = data.get("log_path").and_then(|v| v.as_str()) {
                println!("  Файл лога LS: {}", log);
            }
            if let Some(accs) = data.get("accounts_count").and_then(|v| v.as_u64()) {
                println!("  Слотов аккаунтов: {}", accs);
            }
            println!();
        }
        _ => {
            println!("\n{} agy-daemon is OFFLINE (not running).\n", "⚪".normal());
        }
    }
    Ok(())
}

fn execute_daemon_stop(socket: Option<&str>) -> anyhow::Result<()> {
    let rt = tokio::runtime::Runtime::new()?;
    let resp = rt.block_on(async {
        try_ipc_request(&IpcRequest::DaemonStop, socket).await
    });

    match resp {
        Some(_) => {
            println!("{} agy-daemon stopped successfully.", "🛑".bold());
        }
        None => {
            println!("agy-daemon is already stopped or not running.");
        }
    }
    Ok(())
}

fn execute_daemon_start(foreground: bool, socket: Option<&str>) -> anyhow::Result<()> {
    let rt = tokio::runtime::Runtime::new()?;
    let is_running = rt.block_on(async {
        try_ipc_request(&IpcRequest::DaemonStatus, socket).await.is_some()
    });

    if is_running {
        println!("{} agy-daemon is already running.", "ℹ️".blue());
        return Ok(());
    }

    // Locate agy-daemon executable
    let current_exe = std::env::current_exe()?;
    let exe_dir = current_exe.parent().unwrap();
    let daemon_bin = exe_dir.join(if cfg!(windows) { "agy-daemon.exe" } else { "agy-daemon" });

    if !daemon_bin.exists() {
        println!(
            "{} Could not find agy-daemon executable at: {}",
            "❌".red().bold(),
            daemon_bin.display()
        );
        return Ok(());
    }

    let mut cmd = std::process::Command::new(&daemon_bin);
    if let Some(s) = socket {
        cmd.arg("--socket").arg(s);
    }

    if foreground {
        println!("Starting agy-daemon in foreground...");
        let mut child = cmd.spawn()?;
        child.wait()?;
    } else {
        println!("Starting agy-daemon in background...");

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW (0x08000000) | DETACHED_PROCESS (0x00000008)
            cmd.creation_flags(0x08000000 | 0x00000008);
        }

        let _ = cmd.spawn()?;

        // Poll for up to 3 seconds for daemon IPC to become ready
        print!("Waiting for daemon initialization");
        let mut ready = false;
        for _ in 0..15 {
            std::thread::sleep(std::time::Duration::from_millis(200));
            print!(".");
            let _ = io::stdout().flush();
            let check = rt.block_on(async {
                try_ipc_request(&IpcRequest::DaemonStatus, socket).await.is_some()
            });
            if check {
                ready = true;
                break;
            }
        }
        println!();

        if ready {
            println!("{} agy-daemon started successfully!", "✅".green().bold());
        } else {
            println!("{} agy-daemon launched, but IPC did not respond within timeout.", "⚠️".yellow());
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Chat and Exec Subcommands
// ---------------------------------------------------------------------------

async fn execute_chat(
    slot: Option<usize>,
    preset: Option<String>,
    model: Option<String>,
) -> anyhow::Result<()> {
    let ws = agy_core::symlink::detect_workspace(None);
    let cred_mgr = CredentialManager::default_manager();
    let (mut current_slot, _) = cred_mgr
        .resolve_slot(slot.map(|s| s as u32), ws.as_deref())
        .unwrap_or((1, SlotResolutionSource::GlobalActive));

    let mut email = cred_mgr
        .get_status()
        .ok()
        .and_then(|st| {
            st.accounts
                .iter()
                .find(|a| a.slot == current_slot)
                .map(|a| a.email.clone())
        })
        .unwrap_or_else(|| "Не авторизован".to_string());

    let mut current_preset = match preset {
        Some(p) => p,
        None => {
            if let Some(ref w) = ws {
                if let Ok(Some(cfg)) = ProjectConfig::load(w) {
                    cfg.preset.unwrap_or_else(get_active_preset)
                } else {
                    get_active_preset()
                }
            } else {
                get_active_preset()
            }
        }
    };

    let preset_mgr = PresetManager::load_auto(None);
    let mut resolved_preset = resolve_preset(&preset_mgr.manifest, &current_preset).ok();
    let mut system_prompt = build_preset_system_prompt(&preset_mgr.manifest, &current_preset).ok();

    let current_model = model.unwrap_or_else(|| {
        std::env::var("AGY_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string())
    });

    let mut client = GeminiClient::from_slot(Some(current_slot), Some(current_model.clone()));

    let skills_count = resolved_preset.as_ref().map(|r| r.total_skills).unwrap_or(0);

    println!();
    println!("{}", "╭──────────────────────────────────────────────────────────────────╮".cyan());
    println!("{}  {}                      {}", "│".cyan(), "✨ Antigravity Headless TUI Chat".bold().white(), "│".cyan());
    println!("{}  {} [{}] ({})", "│".cyan(), "👤 Слот:".bold(), current_slot.to_string().yellow().bold(), email.green());
    println!("{}  {} {} ({} активных навыков)", "│".cyan(), "🎯 Пресет:".bold(), current_preset.bold().magenta(), skills_count.to_string().green());
    println!("{}  {} {}", "│".cyan(), "🤖 Модель:".bold(), current_model.cyan().bold());
    println!("{}                                                                  {}", "│".cyan(), "│".cyan());
    println!("{}  {} /preset <name>, /slot <N>, /status, /clear, /exit      {}", "│".cyan(), "Команды:".dimmed(), "│".cyan());
    println!("{}", "╰──────────────────────────────────────────────────────────────────╯".cyan());
    println!();

    let mut history: Vec<ChatMessage> = Vec::new();
    let stdin = io::stdin();
    let mut line_buf = String::new();

    loop {
        print!("{} ", "agy >".green().bold());
        let _ = io::stdout().flush();
        line_buf.clear();

        if stdin.read_line(&mut line_buf)? == 0 {
            // EOF reached (Ctrl+D / Ctrl+Z)
            println!("\n{}", "Сессия чата завершена.".dimmed());
            break;
        }

        let input = line_buf.trim();
        if input.is_empty() {
            continue;
        }

        // Handle Slash Commands
        if input.starts_with('/') {
            let parts: Vec<&str> = input.split_whitespace().collect();
            let cmd = parts[0];
            match cmd {
                "/exit" | "/quit" | "/q" => {
                    println!("{}", "👋 До свидания!".cyan().bold());
                    break;
                }
                "/help" | "/?" => {
                    println!("\n{}", "Доступные slash-команды:".bold());
                    println!("  {}     - сменить активный пресет (например: /preset backend, /preset web)", "/preset <name>".cyan().bold());
                    println!("  {}        - переключить слот учетной записи (например: /slot 2)", "/slot <N>".cyan().bold());
                    println!("  {}         - показать подробный статус сессии", "/status".cyan().bold());
                    println!("  {}          - очистить историю сообщений", "/clear".cyan().bold());
                    println!("  {}           - показать справку", "/help".cyan().bold());
                    println!("  {}           - выйти из чата\n", "/exit".cyan().bold());
                }
                "/clear" => {
                    history.clear();
                    println!("{}", "🧹 История диалога очищена.".yellow());
                }
                "/status" => {
                    let total = resolved_preset.as_ref().map(|r| r.total_skills).unwrap_or(0);
                    let skills_str = resolved_preset
                        .as_ref()
                        .map(|r| r.active_skills.iter().cloned().collect::<Vec<_>>().join(", "))
                        .unwrap_or_default();
                    println!("\n{}", "📊 Статус сессии:".bold());
                    println!("  👤 Слот: [{}] ({})", current_slot.to_string().cyan().bold(), email.green());
                    println!("  🎯 Пресет: {} ({} навыков)", current_preset.magenta().bold(), total.to_string().green());
                    println!("  🤖 Модель: {}", current_model.cyan().bold());
                    println!("  💬 Сообщений в истории: {}", history.len());
                    println!("  🛠️ Активные навыки: {}\n", skills_str.dimmed());
                }
                "/preset" => {
                    if parts.len() < 2 {
                        println!("{} Укажите имя пресета, например: /preset backend", "❌ Ошибка:".red().bold());
                    } else {
                        let target = parts[1].to_lowercase();
                        match resolve_preset(&preset_mgr.manifest, &target) {
                            Ok(res) => {
                                current_preset = target;
                                resolved_preset = Some(res.clone());
                                system_prompt = build_preset_system_prompt(&preset_mgr.manifest, &current_preset).ok();
                                println!(
                                    "{} Пресет переключен на {} ({} активных навыков).",
                                    "🎯".bold(),
                                    current_preset.cyan().bold(),
                                    res.total_skills.to_string().green().bold()
                                );
                            }
                            Err(_) => {
                                println!("{} Пресет '{}' не найден в манифесте.", "❌ Ошибка:".red().bold(), target);
                            }
                        }
                    }
                }
                "/slot" => {
                    if parts.len() < 2 {
                        println!("{} Укажите номер слота, например: /slot 2", "❌ Ошибка:".red().bold());
                    } else if let Ok(s) = parts[1].parse::<u32>() {
                        current_slot = s;
                        client = GeminiClient::from_slot(Some(current_slot), Some(current_model.clone()));
                        email = cred_mgr
                            .get_status()
                            .ok()
                            .and_then(|st| {
                                st.accounts
                                    .iter()
                                    .find(|a| a.slot == current_slot)
                                    .map(|a| a.email.clone())
                            })
                            .unwrap_or_else(|| "Unknown".to_string());
                        println!(
                            "{} Переключено на слот [{}] ({})",
                            "👤".bold(),
                            current_slot.to_string().cyan().bold(),
                            email.green().bold()
                        );
                    } else {
                        println!("{} Некорректный номер слота: '{}'", "❌ Ошибка:".red().bold(), parts[1]);
                    }
                }
                _ => {
                    println!("{} Неизвестная команда '{}'. Введите /help для справки.", "❌".red(), cmd);
                }
            }
            continue;
        }

        // Gemini Streaming Generation
        print!("\n{} ", "🤖 Gemini >".cyan().bold());
        let _ = io::stdout().flush();

        let stream_res = client
            .stream_generate(
                input,
                &history,
                system_prompt.as_deref(),
                |chunk| {
                    print!("{}", chunk);
                    let _ = io::stdout().flush();
                },
            )
            .await;

        println!("\n");

        match stream_res {
            Ok(response_text) => {
                history.push(ChatMessage {
                    role: "user".to_string(),
                    content: input.to_string(),
                });
                history.push(ChatMessage {
                    role: "model".to_string(),
                    content: response_text,
                });
            }
            Err(e) => {
                eprintln!("{} {}", "❌ Ошибка Gemini API:".red().bold(), e);
            }
        }
    }

    Ok(())
}

fn format_exec_prompt(prompt: Option<&str>, piped_context: &str) -> Option<String> {
    let piped = piped_context.trim();
    match (prompt, piped) {
        (Some(p), context) if !context.is_empty() => {
            Some(format!("{}\n\n---\nContext / Input:\n{}", p, context))
        }
        (Some(p), _) => Some(p.to_string()),
        (None, context) if !context.is_empty() => Some(context.to_string()),
        (None, _) => None,
    }
}

async fn execute_exec(
    prompt: Option<String>,
    slot: Option<usize>,
    preset: Option<String>,
    model: Option<String>,
) -> anyhow::Result<()> {
    let mut stdin_content = String::new();
    let is_piped = !io::stdin().is_terminal();
    if is_piped {
        let _ = io::stdin().read_to_string(&mut stdin_content);
    }

    let final_prompt = match format_exec_prompt(prompt.as_deref(), &stdin_content) {
        Some(p) => p,
        None => {
            anyhow::bail!("No prompt provided. Pass a prompt argument or pipe input via stdin (e.g. cat file.rs | agy exec 'найди баги')");
        }
    };

    let ws = agy_core::symlink::detect_workspace(None);
    let cred_mgr = CredentialManager::default_manager();
    let (resolved_slot, _) = cred_mgr
        .resolve_slot(slot.map(|s| s as u32), ws.as_deref())
        .unwrap_or((1, SlotResolutionSource::GlobalActive));

    let active_preset_name = match preset {
        Some(p) => p,
        None => {
            if let Some(ref w) = ws {
                if let Ok(Some(cfg)) = ProjectConfig::load(w) {
                    cfg.preset.unwrap_or_else(get_active_preset)
                } else {
                    get_active_preset()
                }
            } else {
                get_active_preset()
            }
        }
    };

    let preset_mgr = PresetManager::load_auto(None);
    let system_prompt = build_preset_system_prompt(&preset_mgr.manifest, &active_preset_name).ok();

    let target_model = model.unwrap_or_else(|| {
        std::env::var("AGY_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string())
    });

    let client = GeminiClient::from_slot(Some(resolved_slot), Some(target_model));

    client
        .stream_generate(
            &final_prompt,
            &[],
            system_prompt.as_deref(),
            |chunk| {
                print!("{}", chunk);
                let _ = io::stdout().flush();
            },
        )
        .await
        .map_err(|e| anyhow::anyhow!("Gemini API error: {}", e))?;

    println!();
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let socket = cli.socket.as_deref();

    match cli.command {
        Commands::Preset { cmd } => match cmd {
            PresetCommands::Switch {
                name,
                workspace,
                overlays,
            } => {
                let ws = agy_core::symlink::detect_workspace(workspace.as_deref());
                let rt = tokio::runtime::Runtime::new()?;
                let req = IpcRequest::PresetSwitch {
                    name: name.clone(),
                    overlays: overlays.clone(),
                    workspace: ws.clone(),
                };
                let resp = rt.block_on(async { try_ipc_request(&req, socket).await });
                if let Some(IpcResponse::Success { data }) = resp {
                    let total = data.get("total_skills").and_then(|v| v.as_u64()).unwrap_or(0);
                    let ms = data.get("duration_ms").and_then(|v| v.as_u64()).unwrap_or(0);
                    let overlay_str = if overlays.is_empty() {
                        String::new()
                    } else {
                        format!(" + {}", overlays.join(" + "))
                    };
                    let ws_str = if let Some(ref w) = ws {
                        format!(" (Workspace: {})", w.display().to_string().cyan())
                    } else {
                        String::new()
                    };
                    println!(
                        "{} [Смена пресета{}: {}{}] {} навыков активно (синхронизировано за {} мс via daemon)",
                        "🎯".bold(),
                        ws_str,
                        name.cyan().bold(),
                        overlay_str.yellow(),
                        total.to_string().green().bold(),
                        ms
                    );
                } else {
                    execute_preset_switch_standalone(&name, &overlays, ws.as_deref())?;
                }
            }
            PresetCommands::List { workspace } => {
                let ws = agy_core::symlink::detect_workspace(workspace.as_deref());
                execute_preset_list_standalone(ws.as_deref())?;
            }
            PresetCommands::Current { workspace } => {
                let ws = agy_core::symlink::detect_workspace(workspace.as_deref());
                let rt = tokio::runtime::Runtime::new()?;
                let req = IpcRequest::PresetCurrent {
                    workspace: ws.clone(),
                };
                let resp = rt.block_on(async { try_ipc_request(&req, socket).await });
                if let Some(IpcResponse::Success { data }) = resp {
                    let active = data.get("preset").and_then(|v| v.as_str()).unwrap_or("minimal");
                    let name = data.get("name").and_then(|v| v.as_str()).unwrap_or(active);
                    let icon = data.get("icon").and_then(|v| v.as_str()).unwrap_or("⚡");
                    let active_links = data
                        .get("active_skills")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|s| s.as_str().map(|s| s.to_string()))
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let expected_skills = data
                        .get("expected_skills")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.len())
                        .unwrap_or(0);

                    if let Some(ref w) = ws {
                        println!(
                            "\n{} Текущий профиль проекта (Workspace: {}, via daemon):",
                            icon,
                            w.display().to_string().cyan()
                        );
                    } else {
                        println!("\n{} Текущий профиль (via daemon):", icon);
                    }
                    println!("  Пресет: {} ({})", name.bold(), active.cyan());
                    println!("  Активных ссылок на диске: {}", active_links.len().to_string().green());
                    println!("  Ожидаемых навыков: {}", expected_skills.to_string().cyan());
                    println!("  Навыки: {}\n", active_links.join(", "));
                } else {
                    execute_preset_current_standalone(ws.as_deref())?;
                }
            }
        },
        Commands::Account { cmd } => match cmd {
            AccountCommands::Status { workspace } => {
                let ws = agy_core::symlink::detect_workspace(workspace.as_deref());
                let rt = tokio::runtime::Runtime::new()?;
                let resp = rt.block_on(async { try_ipc_request(&IpcRequest::AccountStatus, socket).await });
                if let Some(IpcResponse::Success { data }) = resp {
                    if let Ok(status) = serde_json::from_value::<agy_core::credentials::MultiaccStatus>(data) {
                        let mgr = CredentialManager::default_manager();
                        let (bound_slot, source) = mgr.resolve_slot(None, ws.as_deref()).unwrap_or((status.active_slot, agy_core::credentials::SlotResolutionSource::GlobalActive));

                        println!("\n{}", "👤 Учетные записи Google Antigravity (via daemon):".bold());
                        println!("{:-<60}", "");
                        println!(
                            "Активный слот: [{}/{}] {}",
                            status.active_slot.to_string().cyan().bold(),
                            status.slots_count,
                            status.current_email.as_deref().unwrap_or("Не авторизован").green()
                        );
                        println!(
                            "Привязка сессии/воркспейса: [{}] ({})",
                            bound_slot.to_string().cyan().bold(),
                            source.to_string().yellow()
                        );
                        println!("{:-<60}", "");
                        for acc in &status.accounts {
                            let is_active = acc.slot == status.active_slot;
                            let is_bound = acc.slot == bound_slot;

                            let badge = match (is_active, is_bound) {
                                (true, true) => "(ACTIVE & BOUND)".green().bold(),
                                (true, false) => "(ACTIVE)".green().bold(),
                                (false, true) => "[BOUND]".cyan().bold(),
                                (false, false) => "".normal(),
                            };

                            let marker = if is_bound || is_active {
                                "▶".green().bold()
                            } else {
                                " ".normal()
                            };

                            println!(
                                "  {} [Слот {}] {} {}",
                                marker,
                                acc.slot,
                                if is_bound || is_active { acc.email.bold() } else { acc.email.normal() },
                                badge
                            );
                        }
                        println!("{:-<60}\n", "");
                        return Ok(());
                    }
                }
                execute_account_status_standalone(ws.as_deref())?;
            }
            AccountCommands::Rotate { slot } => {
                let rt = tokio::runtime::Runtime::new()?;
                let resp = rt.block_on(async { try_ipc_request(&IpcRequest::AccountRotate { slot }, socket).await });
                if let Some(IpcResponse::Success { data }) = resp {
                    if let Ok(status) = serde_json::from_value::<agy_core::credentials::MultiaccStatus>(data) {
                        println!(
                            "{} [Ротация аккаунта]: переключено на слот [{}/{}] {}",
                            "🔄".bold(),
                            status.active_slot.to_string().cyan().bold(),
                            status.slots_count,
                            status.current_email.as_deref().unwrap_or("Unknown").green().bold()
                        );
                        return Ok(());
                    }
                }
                execute_account_rotate_standalone(slot)?;
            }
            AccountCommands::Add => {
                execute_account_add_standalone()?;
            }
            AccountCommands::Delete { slot } => {
                let rt = tokio::runtime::Runtime::new()?;
                let resp = rt.block_on(async { try_ipc_request(&IpcRequest::AccountDelete { slot }, socket).await });
                if let Some(IpcResponse::Success { data }) = resp {
                    if let Ok(status) = serde_json::from_value::<agy_core::credentials::MultiaccStatus>(data) {
                        println!(
                            "{} Слот {} удален. Пул аккаунтов скомпактифицирован (1..{}).",
                            "🗑️".bold(),
                            slot,
                            status.slots_count
                        );
                        return Ok(());
                    }
                }
                execute_account_delete_standalone(slot)?;
            }
            AccountCommands::GetToken { slot, workspace } => {
                execute_account_get_token(slot, workspace)?;
            }
            AccountCommands::ExportEnv { slot, workspace, shell } => {
                execute_account_export_env(slot, workspace, &shell)?;
            }
        },
        Commands::Project { cmd } => match cmd {
            ProjectCommands::Init { slot, preset, workspace } => {
                execute_project_init(slot, preset, workspace)?;
            }
        },
        Commands::Daemon { cmd } => match cmd {
            DaemonCommands::Status => {
                execute_daemon_status(socket)?;
            }
            DaemonCommands::Stop => {
                execute_daemon_stop(socket)?;
            }
            DaemonCommands::Start { foreground } => {
                execute_daemon_start(foreground, socket)?;
            }
        },
        Commands::Chat { slot, preset, model } => {
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(execute_chat(slot, preset, model))?;
        }
        Commands::Exec {
            prompt,
            slot,
            preset,
            model,
        } => {
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(execute_exec(prompt, slot, preset, model))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_command_parsing_defaults() {
        let args = ["agy", "chat"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse 'agy chat'");
        match cli.command {
            Commands::Chat { slot, preset, model } => {
                assert_eq!(slot, None);
                assert_eq!(preset, None);
                assert_eq!(model, None);
            }
            _ => panic!("Expected Commands::Chat"),
        }
    }

    #[test]
    fn test_chat_command_parsing_with_flags() {
        let args = ["agy", "chat", "-s", "2", "-p", "backend", "-m", "gemini-2.0-flash"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse 'agy chat with flags'");
        match cli.command {
            Commands::Chat { slot, preset, model } => {
                assert_eq!(slot, Some(2));
                assert_eq!(preset, Some("backend".to_string()));
                assert_eq!(model, Some("gemini-2.0-flash".to_string()));
            }
            _ => panic!("Expected Commands::Chat"),
        }
    }

    #[test]
    fn test_exec_command_parsing_with_prompt() {
        let args = ["agy", "exec", "найди баги в коде", "--slot", "1", "--preset", "qa"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse 'agy exec with prompt'");
        match cli.command {
            Commands::Exec { prompt, slot, preset, model } => {
                assert_eq!(prompt, Some("найди баги в коде".to_string()));
                assert_eq!(slot, Some(1));
                assert_eq!(preset, Some("qa".to_string()));
                assert_eq!(model, None);
            }
            _ => panic!("Expected Commands::Exec"),
        }
    }

    #[test]
    fn test_exec_command_parsing_piped_no_args() {
        let args = ["agy", "exec"];
        let cli = Cli::try_parse_from(args).expect("Failed to parse 'agy exec' without args");
        match cli.command {
            Commands::Exec { prompt, slot, preset, model } => {
                assert_eq!(prompt, None);
                assert_eq!(slot, None);
                assert_eq!(preset, None);
                assert_eq!(model, None);
            }
            _ => panic!("Expected Commands::Exec"),
        }
    }

    #[test]
    fn test_format_exec_prompt_combinations() {
        // Case 1: Prompt argument only
        assert_eq!(
            format_exec_prompt(Some("Explain RAII"), ""),
            Some("Explain RAII".to_string())
        );

        // Case 2: Piped context only
        assert_eq!(
            format_exec_prompt(None, "fn main() {}\n"),
            Some("fn main() {}".to_string())
        );

        // Case 3: Both prompt argument and piped context
        let combined = format_exec_prompt(Some("Find bugs"), "let x = 1;\n").unwrap();
        assert!(combined.starts_with("Find bugs\n\n---\nContext / Input:\nlet x = 1;"));

        // Case 4: Neither prompt nor piped context
        assert_eq!(format_exec_prompt(None, "   "), None);
    }
}
