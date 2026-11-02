use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use clap::Parser;
use tracing::{error, info, warn};

use agy_core::credentials::CredentialManager;
use agy_core::ipc::{get_default_ipc_path, IpcError, IpcRequest, IpcResponse};
use agy_core::log_watcher::LogTailWatcher;
use agy_core::presets::PresetManager;
use agy_core::symlink::SymlinkEngine;

#[derive(Parser, Debug)]
#[command(name = "agy-daemon", about = "Background watchdog and IPC server for Antigravity")]
struct Args {
    #[arg(short, long, help = "Path to language server log file to watch")]
    log_path: Option<PathBuf>,

    #[arg(short, long, env = "AGY_SOCKET", help = "IPC Pipe / Socket address")]
    ipc_path: Option<String>,

    #[arg(long, env = "AGY_SOCKET", help = "Alias for --ipc-path")]
    socket: Option<String>,

    #[arg(long, default_value_t = false, help = "Run in foreground")]
    foreground: bool,
}

pub struct DaemonState {
    pub start_time: Instant,
    pub log_path: PathBuf,
    pub watching: bool,
    pub shutdown_tx: tokio::sync::broadcast::Sender<()>,
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

async fn dispatch_request(req: IpcRequest, state: &DaemonState) -> IpcResponse {
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
            }))
            .unwrap()
        }
        IpcRequest::DaemonStop => {
            IpcResponse::ok(serde_json::json!({ "status": "stopping" })).unwrap()
        }
    }
}

async fn handle_ipc_client<S>(stream: S, state: Arc<DaemonState>) -> Result<(), IpcError>
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
async fn run_named_pipe_server(
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
async fn run_unix_socket_server(
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    info!("Initializing agy-daemon v3.0 (Absolute Antigravity)");

    // Determine language server log path
    let log_path = args
        .log_path
        .or_else(LogTailWatcher::discover_default_log_path)
        .unwrap_or_else(|| PathBuf::from("language_server.log"));

    info!("Using language server log path: {}", log_path.display());

    let (shutdown_tx, _) = tokio::sync::broadcast::channel::<()>(16);

    let state = Arc::new(DaemonState {
        start_time: Instant::now(),
        log_path: log_path.clone(),
        watching: true,
        shutdown_tx: shutdown_tx.clone(),
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

    // Start IPC server
    let raw_ipc_path = args.socket.or(args.ipc_path).unwrap_or_else(get_default_ipc_path);
    let ipc_path = agy_core::ipc::normalize_ipc_path(&raw_ipc_path);
    let shutdown_rx = shutdown_tx.subscribe();

    #[cfg(windows)]
    let ipc_handle = tokio::spawn(run_named_pipe_server(ipc_path, shutdown_rx, Arc::clone(&state)));

    #[cfg(not(windows))]
    let ipc_handle = tokio::spawn(run_unix_socket_server(ipc_path, shutdown_rx, Arc::clone(&state)));

    info!("agy-daemon is active and watching for quota triggers and IPC commands.");

    // Wait for shutdown or Ctrl-C
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Received Ctrl-C. Initiating graceful shutdown...");
            let _ = shutdown_tx.send(());
        }
        _ = ipc_handle => {}
    }

    watcher_handle.abort();
    info!("agy-daemon stopped gracefully.");
    Ok(())
}
