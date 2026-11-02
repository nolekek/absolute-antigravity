use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use clap::Parser;
use tracing::{error, info, warn};

use agy_core::credentials::CredentialManager;
use agy_core::ipc::{get_default_ipc_path, IpcError, IpcRequest, IpcResponse};
use agy_core::log_watcher::LogTailWatcher;
use agy_core::presets::PresetManager;
use agy_core::symlink::SymlinkEngine;

pub type DaemonArgs = Args;

#[derive(Parser, Debug, Clone)]
#[command(name = "agy-daemon", about = "Background watchdog and IPC server for Antigravity")]
pub struct Args {
    #[arg(short, long, help = "Path to language server log file to watch")]
    pub log_path: Option<PathBuf>,

    #[arg(short, long, env = "AGY_SOCKET", help = "IPC Pipe / Socket address")]
    pub ipc_path: Option<String>,

    #[arg(long, env = "AGY_SOCKET", help = "Alias for --ipc-path")]
    pub socket: Option<String>,

    #[arg(long, default_value_t = false, help = "Run in foreground")]
    pub foreground: bool,

    #[arg(long, default_value_t = false, help = "Disable web server auto-start")]
    pub no_web: bool,

    #[arg(long, default_value_t = false, help = "Do not open browser automatically")]
    pub no_open: bool,

    #[arg(long, default_value_t = 51125, env = "AGY_WEB_PORT", help = "Port for web dashboard server")]
    pub web_port: u16,

    #[arg(long, default_value = "0.0.0.0", env = "AGY_WEB_HOST", help = "Host for web dashboard server")]
    pub web_host: String,
}

pub struct DaemonState {
    pub start_time: Instant,
    pub log_path: PathBuf,
    pub watching: bool,
    pub shutdown_tx: tokio::sync::broadcast::Sender<()>,
    pub web_port: u16,
    pub web_host: String,
    pub no_web: bool,
}

pub fn get_control_center_config_path() -> Option<PathBuf> {
    agy_core::presets::dirs_home().map(|h| h.join(".gemini").join("antigravity").join("control-center-config.json"))
}

pub fn get_active_preset() -> String {
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

pub fn save_active_preset(preset: &str) {
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

pub fn find_dashboard_script() -> Option<PathBuf> {
    // 1. Current working directory and parent hierarchy
    if let Ok(cwd) = std::env::current_dir() {
        let mut curr = Some(cwd.as_path());
        for _ in 0..6 {
            if let Some(dir) = curr {
                let p1 = dir.join("scripts").join("server_dashboard.js");
                if p1.is_file() {
                    return p1.canonicalize().ok().or(Some(p1));
                }
                let p2 = dir.join("server_dashboard.js");
                if p2.is_file() {
                    return p2.canonicalize().ok().or(Some(p2));
                }
                curr = dir.parent();
            } else {
                break;
            }
        }
    }

    // 2. Executable location and its ancestor directories
    if let Ok(exe) = std::env::current_exe() {
        let mut curr = exe.parent();
        for _ in 0..7 {
            if let Some(dir) = curr {
                let p1 = dir.join("scripts").join("server_dashboard.js");
                if p1.is_file() {
                    return p1.canonicalize().ok().or(Some(p1));
                }
                let p2 = dir.join("server_dashboard.js");
                if p2.is_file() {
                    return p2.canonicalize().ok().or(Some(p2));
                }
                curr = dir.parent();
            } else {
                break;
            }
        }
    }

    // 3. User home directory ~/.gemini/antigravity/
    if let Some(home) = agy_core::presets::dirs_home() {
        let p1 = home.join(".gemini").join("antigravity").join("scripts").join("server_dashboard.js");
        if p1.is_file() {
            return Some(p1);
        }
        let p2 = home.join(".gemini").join("antigravity").join("server_dashboard.js");
        if p2.is_file() {
            return Some(p2);
        }
    }

    // 4. System directory /opt/antigravity/
    let opt1 = PathBuf::from("/opt/antigravity/scripts/server_dashboard.js");
    if opt1.is_file() {
        return Some(opt1);
    }
    let opt2 = PathBuf::from("/opt/antigravity/server_dashboard.js");
    if opt2.is_file() {
        return Some(opt2);
    }

    None
}

pub fn read_web_pin() -> Option<String> {
    if let Some(home) = agy_core::presets::dirs_home() {
        // 1. Check ~/.gemini/antigravity_server_config.json
        let server_cfg = home.join(".gemini").join("antigravity_server_config.json");
        if server_cfg.exists() {
            if let Ok(content) = std::fs::read_to_string(&server_cfg) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(pin) = val.get("pin").and_then(|v| v.as_str()) {
                        let trimmed = pin.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
            }
        }

        // 2. Check ~/.gemini/antigravity_web_config.json
        let web_cfg = home.join(".gemini").join("antigravity_web_config.json");
        if web_cfg.exists() {
            if let Ok(content) = std::fs::read_to_string(&web_cfg) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(pin) = val.get("pin").and_then(|v| v.as_str()) {
                        let trimmed = pin.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }

    // 3. /etc/antigravity/web.conf
    let etc_conf = PathBuf::from("/etc/antigravity/web.conf");
    if etc_conf.exists() {
        if let Ok(content) = std::fs::read_to_string(&etc_conf) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || trimmed.starts_with(';') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    if k.trim().eq_ignore_ascii_case("PIN") {
                        let val = v.trim().trim_matches('"').trim_matches('\'').trim();
                        if !val.is_empty() {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

pub fn has_gui_environment() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::env::var("DISPLAY").is_ok() || std::env::var("WAYLAND_DISPLAY").is_ok()
    }
}

pub fn open_browser(url: &str) {
    info!("Opening default browser to dashboard: {}", url);
    #[cfg(windows)]
    {
        let res = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
        if let Err(e) = res {
            warn!("Failed to open default browser via cmd.exe: {}", e);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let res = std::process::Command::new("open")
            .arg(url)
            .spawn();
        if let Err(e) = res {
            warn!("Failed to open default browser via open: {}", e);
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let res = std::process::Command::new("xdg-open")
            .arg(url)
            .spawn();
        if let Err(e) = res {
            warn!("Failed to open default browser via xdg-open: {}", e);
        }
    }
}

#[cfg(windows)]
pub fn is_pid_alive(pid: u32) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        return text.contains(&pid.to_string()) && !text.contains("No tasks");
    }
    false
}

#[cfg(not(windows))]
pub fn is_pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn cleanup_stale_web_process() {
    if let Some(home) = agy_core::presets::dirs_home() {
        let pid_path = home.join(".gemini").join("antigravity").join("web.pid");
        if pid_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = content.trim().parse::<u32>() {
                    if is_pid_alive(pid) {
                        info!("Found existing web dashboard process (PID: {}). Terminating stale instance...", pid);
                        #[cfg(windows)]
                        {
                            let _ = std::process::Command::new("taskkill")
                                .args(["/F", "/T", "/PID", &pid.to_string()])
                                .output();
                        }
                        #[cfg(not(windows))]
                        {
                            let _ = std::process::Command::new("kill")
                                .args(["-9", &pid.to_string()])
                                .output();
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(&pid_path);
        }
    }
}

pub fn spawn_web_server(
    script_path: &Path,
    host: &str,
    port: u16,
) -> anyhow::Result<std::process::Child> {
    let node_bin = if cfg!(windows) { "node.exe" } else { "node" };

    let mut cmd = std::process::Command::new(node_bin);
    cmd.arg(script_path);
    cmd.arg("--host").arg(host);
    cmd.arg("--port").arg(port.to_string());

    let log_path = agy_core::presets::dirs_home()
        .map(|h| h.join(".gemini").join("antigravity").join("web.log"));
    if let Some(ref lp) = log_path {
        if let Some(parent) = lp.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(lp) {
            if let Ok(out_file) = file.try_clone() {
                cmd.stdout(out_file);
            }
            cmd.stderr(file);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn()?;
    let pid = child.id();
    info!("Spawned web dashboard process (PID: {}) on {}:{}", pid, host, port);

    if let Some(home) = agy_core::presets::dirs_home() {
        let pid_path = home.join(".gemini").join("antigravity").join("web.pid");
        if let Some(parent) = pid_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&pid_path, pid.to_string());
    }

    Ok(child)
}

pub fn stop_child_process(mut child: std::process::Child) {
    let pid = child.id();
    info!("Shutting down web dashboard process (PID: {})...", pid);
    let _ = child.kill();
    let _ = child.wait();

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    if let Some(home) = agy_core::presets::dirs_home() {
        let pid_path = home.join(".gemini").join("antigravity").join("web.pid");
        let _ = std::fs::remove_file(pid_path);
    }
}

pub async fn dispatch_request(req: IpcRequest, state: &DaemonState) -> IpcResponse {
    match req {
        IpcRequest::PresetSwitch { name, overlays, workspace } => {
            let mgr = PresetManager::load_auto(None);
            match mgr.resolve_active_skills(&name, &overlays) {
                Ok(resolved) => {
                    let default_lib = agy_core::symlink::default_library_dir()
                        .unwrap_or_else(|_| PathBuf::from("."));

                    let (report_res, is_ws) = if let Some(ref ws) = workspace {
                        let rep = agy_core::symlink::sync_workspace_skills(
                            ws,
                            &resolved.active_skills.iter().cloned().collect::<Vec<_>>(),
                            &default_lib,
                        );
                        if rep.is_ok() {
                            let mut cfg = agy_core::credentials::ProjectConfig::load(ws)
                                .ok()
                                .flatten()
                                .unwrap_or_default();
                            cfg.preset = Some(name.clone());
                            cfg.overlays = overlays.clone();
                            let _ = cfg.save(ws);
                        }
                        (rep, true)
                    } else {
                        match SymlinkEngine::default_paths() {
                            Ok(engine) => {
                                let rep = engine.sync_skills(&resolved.active_skills);
                                if rep.is_ok() {
                                    save_active_preset(&name);
                                }
                                (rep, false)
                            }
                            Err(e) => (Err(e), false),
                        }
                    };

                    match report_res {
                        Ok(report) => {
                            IpcResponse::ok(serde_json::json!({
                                "preset": name,
                                "overlays": overlays,
                                "workspace": workspace,
                                "is_workspace": is_ws,
                                "active_skills": resolved.active_skills,
                                "total_skills": resolved.total_skills,
                                "added": report.added,
                                "removed": report.removed,
                                "kept": report.kept,
                                "duration_ms": report.duration_ms,
                            }))
                            .unwrap()
                        }
                        Err(e) => IpcResponse::err(format!("Symlink sync error: {}", e)),
                    }
                }
                Err(e) => IpcResponse::err(format!("Preset resolve error: {}", e)),
            }
        }
        IpcRequest::PresetList => {
            let mgr = PresetManager::load_auto(None);
            IpcResponse::ok(mgr.list_presets()).unwrap()
        }
        IpcRequest::PresetCurrent { workspace } => {
            let mgr = PresetManager::load_auto(None);
            if let Some(ref ws) = workspace {
                let ws_cfg = agy_core::credentials::ProjectConfig::load(ws).ok().flatten();
                let active = ws_cfg.and_then(|c| c.preset).unwrap_or_else(|| "minimal".to_string());
                let overlays: Vec<String> = Vec::new();
                match mgr.resolve_active_skills(&active, &overlays) {
                    Ok(resolved) => {
                        let active_links = agy_core::symlink::SymlinkEngine::for_workspace(ws, None)
                            .map(|e| e.list_active().unwrap_or_default())
                            .unwrap_or_default();
                        IpcResponse::ok(serde_json::json!({
                            "preset": active,
                            "workspace": ws,
                            "name": mgr.get_preset(&active).map(|p| p.name.clone()).unwrap_or_else(|| active.clone()),
                            "icon": mgr.get_preset(&active).and_then(|p| p.icon.clone()).unwrap_or_else(|| "⚡".to_string()),
                            "active_skills": active_links,
                            "expected_skills": resolved.active_skills,
                        }))
                        .unwrap()
                    }
                    Err(e) => IpcResponse::err(e.to_string()),
                }
            } else {
                let active = get_active_preset();
                let overlays: Vec<String> = Vec::new();
                match mgr.resolve_active_skills(&active, &overlays) {
                    Ok(resolved) => {
                        let active_links = match SymlinkEngine::default_paths() {
                            Ok(e) => e.list_active().unwrap_or_default(),
                            Err(_) => Vec::new(),
                        };
                        IpcResponse::ok(serde_json::json!({
                            "preset": active,
                            "name": mgr.get_preset(&active).map(|p| p.name.clone()).unwrap_or_else(|| active.clone()),
                            "icon": mgr.get_preset(&active).and_then(|p| p.icon.clone()).unwrap_or_else(|| "⚡".to_string()),
                            "active_skills": active_links,
                            "expected_skills": resolved.active_skills,
                        }))
                        .unwrap()
                    }
                    Err(e) => IpcResponse::err(e.to_string()),
                }
            }
        }
        IpcRequest::AccountStatus => {
            let mgr = CredentialManager::default_manager();
            match mgr.get_status() {
                Ok(status) => IpcResponse::ok(status).unwrap(),
                Err(e) => IpcResponse::err(e.to_string()),
            }
        }
        IpcRequest::AccountRotate { slot } => {
            let mgr = CredentialManager::default_manager();
            match mgr.rotate(slot) {
                Ok(status) => IpcResponse::ok(status).unwrap(),
                Err(e) => IpcResponse::err(e.to_string()),
            }
        }
        IpcRequest::AccountPrepareAdd => {
            let mgr = CredentialManager::default_manager();
            match mgr.prepare_add_login() {
                Ok(next_slot) => IpcResponse::ok(serde_json::json!({
                    "status": "ready_for_login",
                    "pending_slot": next_slot,
                }))
                .unwrap(),
                Err(e) => IpcResponse::err(e.to_string()),
            }
        }
        IpcRequest::AccountFinalizeAdd => {
            let mgr = CredentialManager::default_manager();
            match mgr.finalize_add_login() {
                Ok(status) => IpcResponse::ok(status).unwrap(),
                Err(e) => IpcResponse::err(e.to_string()),
            }
        }
        IpcRequest::AccountDelete { slot } => {
            let mgr = CredentialManager::default_manager();
            match mgr.delete_slot(slot) {
                Ok(status) => IpcResponse::ok(status).unwrap(),
                Err(e) => IpcResponse::err(e.to_string()),
            }
        }
        IpcRequest::DaemonStatus => {
            let uptime = state.start_time.elapsed().as_secs();
            let accounts_count = CredentialManager::default_manager()
                .get_status()
                .map(|s| s.accounts.len())
                .unwrap_or(0);
            IpcResponse::ok(serde_json::json!({
                "status": "running",
                "uptime_secs": uptime,
                "log_path": state.log_path.display().to_string(),
                "watching": state.watching,
                "accounts_count": accounts_count,
                "web": {
                    "enabled": !state.no_web,
                    "host": state.web_host,
                    "port": state.web_port,
                }
            }))
            .unwrap()
        }
        IpcRequest::DaemonStop => {
            IpcResponse::ok(serde_json::json!({ "status": "stopping" })).unwrap()
        }
    }
}

pub async fn handle_ipc_client<S>(stream: S, state: Arc<DaemonState>) -> Result<(), IpcError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (read_half, mut write_half) = tokio::io::split(stream);
    let mut reader = tokio::io::BufReader::new(read_half);
    while let Some(req) = agy_core::ipc::read_ipc_request(&mut reader).await? {
        let is_stop = matches!(req, IpcRequest::DaemonStop);
        let resp = dispatch_request(req, &state).await;
        agy_core::ipc::write_ipc_response(&mut write_half, &resp).await?;
        if is_stop {
            info!("Received DaemonStop request. Signaling graceful shutdown.");
            let _ = state.shutdown_tx.send(());
            break;
        }
    }
    Ok(())
}

#[cfg(windows)]
pub async fn run_named_pipe_server(
    pipe_name: String,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
    state: Arc<DaemonState>,
) -> anyhow::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    info!("Starting Windows Named Pipe IPC server at: {}", pipe_name);
    let mut is_first = true;

    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(is_first)
            .create(&pipe_name);

        let server = match server {
            Ok(s) => {
                is_first = false;
                s
            }
            Err(e) => {
                error!("Failed to create named pipe instance: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                continue;
            }
        };

        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("IPC server received shutdown signal");
                break;
            }
            conn_res = server.connect() => {
                match conn_res {
                    Ok(()) => {
                        let client_pipe = server;
                        let state_clone = Arc::clone(&state);
                        tokio::spawn(async move {
                            if let Err(e) = handle_ipc_client(client_pipe, state_clone).await {
                                tracing::debug!("IPC client disconnected: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        warn!("Pipe connect error: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub async fn run_unix_socket_server(
    socket_path: String,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
    state: Arc<DaemonState>,
) -> anyhow::Result<()> {
    let _ = std::fs::remove_file(&socket_path);
    info!("Starting Unix Domain Socket IPC server at: {}", socket_path);
    let listener = tokio::net::UnixListener::bind(&socket_path)?;

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("IPC server received shutdown signal");
                break;
            }
            conn_res = listener.accept() => {
                match conn_res {
                    Ok((stream, _)) => {
                        let state_clone = Arc::clone(&state);
                        tokio::spawn(async move {
                            if let Err(e) = handle_ipc_client(stream, state_clone).await {
                                tracing::debug!("IPC client disconnected: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        warn!("Socket accept error: {}", e);
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_file(&socket_path);
    Ok(())
}

#[cfg(unix)]
pub async fn wait_for_os_shutdown() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut sigterm = signal(SignalKind::terminate()).ok();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Received SIGINT / Ctrl-C signal.");
        }
        _ = async {
            if let Some(ref mut s) = sigterm {
                s.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        } => {
            info!("Received SIGTERM signal.");
        }
    }
}

#[cfg(not(unix))]
pub async fn wait_for_os_shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    info!("Received Ctrl-C signal.");
}

pub async fn run_daemon(args: Args) -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init()
        .ok();

    info!("Initializing agy-daemon v3.0 (Absolute Antigravity)");

    // Determine language server log path
    let log_path = args
        .log_path
        .clone()
        .or_else(LogTailWatcher::discover_default_log_path)
        .unwrap_or_else(|| PathBuf::from("language_server.log"));

    info!("Using language server log path: {}", log_path.display());

    let (shutdown_tx, _) = tokio::sync::broadcast::channel::<()>(16);

    let state = Arc::new(DaemonState {
        start_time: Instant::now(),
        log_path: log_path.clone(),
        watching: true,
        shutdown_tx: shutdown_tx.clone(),
        web_port: args.web_port,
        web_host: args.web_host.clone(),
        no_web: args.no_web,
    });

    // Spawn Log Tail Watcher
    let (quota_tx, mut quota_rx) = tokio::sync::mpsc::channel(32);
    let mut watcher = LogTailWatcher::new(log_path.clone())?;
    // Seek to end so we don't trigger rotation on historical logs
    let _ = watcher.seek_to_end();
    let watcher_handle = watcher.spawn_watcher(std::time::Duration::from_millis(100), quota_tx);

    // Auto-Failover listener task
    tokio::spawn(async move {
        while let Some(evt) = quota_rx.recv().await {
            warn!(
                "⚡ [Auto-Failover] Quota error detected: {}",
                evt.matched_line
            );
            let cred_mgr = CredentialManager::default_manager();
            match cred_mgr.rotate(None) {
                Ok(new_status) => {
                    info!(
                        "🔄 [Auto-Failover] Successfully rotated account to slot [{}/{}]: {:?}",
                        new_status.active_slot, new_status.slots_count, new_status.current_email
                    );
                }
                Err(err) => {
                    error!("❌ [Auto-Failover] Account rotation failed: {}", err);
                }
            }
        }
    });

    // Web Dashboard Management & Auto-Start
    let web_child: Arc<Mutex<Option<std::process::Child>>> = Arc::new(Mutex::new(None));

    if !args.no_web {
        match find_dashboard_script() {
            Some(script_path) => {
                info!("Found server dashboard script at: {}", script_path.display());
                cleanup_stale_web_process();
                match spawn_web_server(&script_path, &args.web_host, args.web_port) {
                    Ok(child) => {
                        *web_child.lock().unwrap() = Some(child);

                        // If auto-open is enabled and GUI is available, open dashboard URL in default browser
                        if !args.no_open && has_gui_environment() {
                            let web_port = args.web_port;
                            tokio::spawn(async move {
                                // Give server_dashboard a moment to initialize and persist PIN
                                let mut pin = None;
                                for _ in 0..30 {
                                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                    if let Some(p) = read_web_pin() {
                                        pin = Some(p);
                                        break;
                                    }
                                }
                                let url = match pin {
                                    Some(ref p) => format!("http://127.0.0.1:{}/?pin={}", web_port, p),
                                    None => format!("http://127.0.0.1:{}", web_port),
                                };
                                open_browser(&url);
                            });
                        }

                        // Child process supervisor task
                        let web_child_monitor = Arc::clone(&web_child);
                        let mut monitor_rx = shutdown_tx.subscribe();
                        tokio::spawn(async move {
                            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(1000));
                            loop {
                                tokio::select! {
                                    _ = monitor_rx.recv() => {
                                        break;
                                    }
                                    _ = interval.tick() => {
                                        let mut guard = web_child_monitor.lock().unwrap();
                                        if let Some(ref mut child) = *guard {
                                            match child.try_wait() {
                                                Ok(Some(status)) => {
                                                    warn!("⚠️ [Web-Supervisor] Web dashboard process exited unexpectedly with status: {:?}", status);
                                                    if let Some(home) = agy_core::presets::dirs_home() {
                                                        let pid_path = home.join(".gemini").join("antigravity").join("web.pid");
                                                        let _ = std::fs::remove_file(pid_path);
                                                    }
                                                    *guard = None;
                                                    break;
                                                }
                                                Ok(None) => {}
                                                Err(e) => {
                                                    warn!("⚠️ [Web-Supervisor] Error inspecting child process: {}", e);
                                                    *guard = None;
                                                    break;
                                                }
                                            }
                                        } else {
                                            break;
                                        }
                                    }
                                }
                            }
                        });
                    }
                    Err(e) => {
                        error!("❌ Failed to spawn web dashboard process: {}", e);
                    }
                }
            }
            None => {
                warn!("⚠️ Could not locate scripts/server_dashboard.js. Web dashboard will not be started.");
            }
        }
    } else {
        info!("Web dashboard auto-start disabled via --no-web flag.");
    }

    // Start IPC server
    let raw_ipc_path = args.socket.or(args.ipc_path).unwrap_or_else(get_default_ipc_path);
    let ipc_path = agy_core::ipc::normalize_ipc_path(&raw_ipc_path);
    let shutdown_rx = shutdown_tx.subscribe();

    #[cfg(windows)]
    let ipc_handle = tokio::spawn(run_named_pipe_server(ipc_path, shutdown_rx, Arc::clone(&state)));

    #[cfg(not(windows))]
    let ipc_handle = tokio::spawn(run_unix_socket_server(ipc_path, shutdown_rx, Arc::clone(&state)));

    info!("agy-daemon is active and watching for quota triggers and IPC commands.");

    // Wait for shutdown signal (OS Ctrl-C / SIGTERM / IPC DaemonStop)
    let mut shutdown_sub = shutdown_tx.subscribe();
    tokio::select! {
        _ = wait_for_os_shutdown() => {
            info!("OS shutdown signal received. Initiating graceful shutdown...");
            let _ = shutdown_tx.send(());
        }
        _ = shutdown_sub.recv() => {
            info!("IPC DaemonStop shutdown received. Initiating graceful shutdown...");
        }
        _ = ipc_handle => {}
    }

    watcher_handle.abort();

    // Terminate managed web server child process
    if let Some(child) = web_child.lock().unwrap().take() {
        stop_child_process(child);
    }

    info!("agy-daemon stopped gracefully.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_daemon_args_defaults() {
        let args = Args::try_parse_from(["agy-daemon"]).expect("Failed to parse default daemon args");
        assert_eq!(args.foreground, false);
        assert_eq!(args.no_web, false);
        assert_eq!(args.no_open, false);
        assert_eq!(args.web_port, 51125);
        assert_eq!(args.web_host, "0.0.0.0");
        assert_eq!(args.log_path, None);
        assert_eq!(args.ipc_path, None);
    }

    #[test]
    fn test_daemon_args_custom_web() {
        let args = Args::try_parse_from([
            "agy-daemon",
            "--no-web",
            "--no-open",
            "--web-port", "52000",
            "--web-host", "127.0.0.1",
            "--foreground",
        ]).expect("Failed to parse customized daemon args");
        assert_eq!(args.foreground, true);
        assert_eq!(args.no_web, true);
        assert_eq!(args.no_open, true);
        assert_eq!(args.web_port, 52000);
        assert_eq!(args.web_host, "127.0.0.1");
    }

    #[test]
    fn test_find_dashboard_script_detects_workspace_file() {
        let script = find_dashboard_script();
        assert!(script.is_some(), "Expected to find scripts/server_dashboard.js in workspace");
        let path = script.unwrap();
        assert!(path.exists());
        assert!(path.to_string_lossy().contains("server_dashboard.js"));
    }

    #[test]
    fn test_read_web_pin() {
        let pin = read_web_pin();
        if let Some(ref p) = pin {
            assert_eq!(p.len(), 6);
            assert!(p.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn test_gui_detection() {
        #[cfg(windows)]
        assert!(has_gui_environment());
    }
}
