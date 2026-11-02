pub mod api;
pub mod credentials;
pub mod ipc;
pub mod log_watcher;
pub mod portable;
pub mod presets;
pub mod symlink;

pub use api::{AntigravityClient, ApiError, ChatMessage, GeminiClient, DEFAULT_MODEL};
pub use credentials::{
    get_token_for_slot, resolve_slot_priority, AccountInfo, CredentialManager, MultiaccStatus,
    ProjectConfig, SlotResolutionSource,
};
pub use ipc::{get_default_ipc_path, normalize_ipc_path, IpcError, IpcRequest, IpcResponse};
pub use log_watcher::{LogTailWatcher, QuotaTriggerEvent};
pub use portable::{
    check_portable_mode, extract_dashboard_if_needed, extract_dashboard_to, get_base_dir,
    get_config_dir, get_credentials_path, get_log_dir, get_skills_dir, is_portable_mode,
    EMBEDDED_DASHBOARD_JS, EMBEDDED_PRESETS_YAML, EMBEDDED_SCHEMA_JSON, EMBEDDED_STUDIO_HTML,
};
pub use presets::{
    build_preset_system_prompt, resolve_preset, Preset, PresetManager, PresetsManifest,
    ResolvedPreset,
};
pub use symlink::{
    default_library_dir, detect_workspace, sync_workspace_skills, SymlinkEngine, SyncReport,
};

#[cfg(windows)]
pub fn has_stdin_data() -> bool {
    use std::os::windows::io::AsRawHandle;
    let handle = std::io::stdin().as_raw_handle();
    let mut bytes_avail = 0u32;
    unsafe {
        windows_sys::Win32::System::Pipes::PeekNamedPipe(
            handle as _,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut bytes_avail,
            std::ptr::null_mut(),
        ) != 0 && bytes_avail > 0
    }
}

#[cfg(not(windows))]
pub fn has_stdin_data() -> bool {
    false
}
