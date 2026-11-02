pub mod api;
pub mod credentials;
pub mod ipc;
pub mod log_watcher;
pub mod portable;
pub mod presets;
pub mod symlink;

pub use api::{ApiError, ChatMessage, GeminiClient, DEFAULT_MODEL};
pub use credentials::{
    get_token_for_slot, resolve_slot_priority, AccountInfo, CredentialManager, MultiaccStatus,
    ProjectConfig, SlotResolutionSource,
};
pub use ipc::{get_default_ipc_path, normalize_ipc_path, IpcError, IpcRequest, IpcResponse};
pub use log_watcher::{LogTailWatcher, QuotaTriggerEvent};
pub use portable::{
    check_portable_mode, extract_dashboard_if_needed, extract_dashboard_to, get_base_dir,
    get_config_dir, get_credentials_path, get_log_dir, get_skills_dir, is_portable_mode,
    EMBEDDED_DASHBOARD_JS, EMBEDDED_PRESETS_YAML, EMBEDDED_SCHEMA_JSON,
};
pub use presets::{
    build_preset_system_prompt, resolve_preset, Preset, PresetManager, PresetsManifest,
    ResolvedPreset,
};
pub use symlink::{
    default_library_dir, detect_workspace, sync_workspace_skills, SymlinkEngine, SyncReport,
};
