pub mod credentials;
pub mod ipc;
pub mod log_watcher;
pub mod presets;
pub mod symlink;

pub use credentials::{
    get_token_for_slot, resolve_slot_priority, AccountInfo, CredentialManager, MultiaccStatus,
    ProjectConfig, SlotResolutionSource,
};
pub use ipc::{get_default_ipc_path, normalize_ipc_path, IpcError, IpcRequest, IpcResponse};
pub use log_watcher::{LogTailWatcher, QuotaTriggerEvent};
pub use presets::{Preset, PresetManager, PresetsManifest, ResolvedPreset};
pub use symlink::{
    default_library_dir, detect_workspace, sync_workspace_skills, SymlinkEngine, SyncReport,
};
