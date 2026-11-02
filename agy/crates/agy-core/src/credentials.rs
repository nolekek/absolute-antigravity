use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const TARGET_ACTIVE: &str = "gemini:antigravity";
pub const SLOT_PREFIX: &str = "gemini:antigravity_slot_";

#[derive(Error, Debug)]
pub enum CredError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Credential error: {0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccountInfo {
    pub slot: u32,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MultiaccStatus {
    pub active_slot: u32,
    pub current_email: Option<String>,
    pub accounts: Vec<AccountInfo>,
    pub slots_count: usize,
    pub auto_failover: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MultiaccConfig {
    #[serde(default = "default_active_slot")]
    pub active_slot: u32,
    #[serde(default = "default_auto_failover")]
    pub auto_failover: bool,
    #[serde(default)]
    pub accounts: Vec<AccountInfo>,
    #[serde(default)]
    pub pending_slot: Option<u32>,
    #[serde(default)]
    pub restore_slot: Option<u32>,
    #[serde(default)]
    pub pending_start_time: Option<f64>,
}

fn default_active_slot() -> u32 {
    1
}

fn default_auto_failover() -> bool {
    true
}

/// Project-scoped configuration saved in `<workspace>/.agy/config.json`.
/// Binds a specific account slot and skill preset to a project workspace.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ProjectConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overlays: Vec<String>,
}

impl ProjectConfig {
    pub fn config_path(workspace: &Path) -> PathBuf {
        workspace.join(".agy").join("config.json")
    }

    pub fn load(workspace: &Path) -> Result<Option<Self>, CredError> {
        let path = Self::config_path(workspace);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let cfg: ProjectConfig = serde_json::from_str(&content)?;
        Ok(Some(cfg))
    }

    pub fn save(&self, workspace: &Path) -> Result<(), CredError> {
        let path = Self::config_path(workspace);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }
}

/// Identifies where the active account slot was resolved from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SlotResolutionSource {
    CliFlag,
    EnvironmentVariable(String),
    ProjectConfig(PathBuf),
    GlobalActive,
}

impl std::fmt::Display for SlotResolutionSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SlotResolutionSource::CliFlag => write!(f, "CLI Flag (--slot)"),
            SlotResolutionSource::EnvironmentVariable(val) => write!(f, "Env Variable AGY_SLOT={}", val),
            SlotResolutionSource::ProjectConfig(p) => write!(f, "Project Config ({})", p.display()),
            SlotResolutionSource::GlobalActive => write!(f, "Global Active Slot"),
        }
    }
}

/// Resolves active slot according to strict multi-tenant priority hierarchy:
/// 1. CLI flag `--slot <N>`
/// 2. Environment variable `AGY_SLOT`
/// 3. Project configuration file `<workspace>/.agy/config.json`
/// 4. Global active slot (`TARGET_ACTIVE`)
pub fn resolve_slot_priority(
    cli_slot: Option<u32>,
    workspace: Option<&Path>,
    global_active: u32,
) -> (u32, SlotResolutionSource) {
    // 1. CLI flag --slot <N>
    if let Some(s) = cli_slot {
        return (s, SlotResolutionSource::CliFlag);
    }

    // 2. Environment variable AGY_SLOT
    if let Ok(val) = std::env::var("AGY_SLOT") {
        let trimmed = val.trim();
        if let Ok(s) = trimmed.parse::<u32>() {
            return (s, SlotResolutionSource::EnvironmentVariable(trimmed.to_string()));
        }
    }

    // 3. Project configuration file <workspace>/.agy/config.json
    if let Some(ws) = workspace {
        if let Ok(Some(cfg)) = ProjectConfig::load(ws) {
            if let Some(s) = cfg.slot {
                return (s, SlotResolutionSource::ProjectConfig(ProjectConfig::config_path(ws)));
            }
        }
    }

    // 4. Global active slot
    (global_active, SlotResolutionSource::GlobalActive)
}

pub fn get_slot_target(slot: u32) -> String {
    format!("{}{}", SLOT_PREFIX, slot)
}

/// Helper to extract email from credential JSON or JWT id_token
pub fn extract_email(cred_str: &str) -> Option<String> {
    if cred_str.trim().is_empty() {
        return None;
    }
    let val: serde_json::Value = serde_json::from_str(cred_str).ok()?;

    if let Some(email) = val.get("email").and_then(|e| e.as_str()) {
        if !email.trim().is_empty() {
            return Some(email.to_string());
        }
    }

    if let Some(id_token) = val.get("id_token").and_then(|t| t.as_str()) {
        let parts: Vec<&str> = id_token.split('.').collect();
        if parts.len() >= 2 {
            let payload = parts[1];
            // Base64 URL decode with padding
            let mut padded = payload.to_string();
            while padded.len() % 4 != 0 {
                padded.push('=');
            }
            use base64::engine::general_purpose::URL_SAFE;
            use base64::Engine;
            if let Ok(bytes) = URL_SAFE.decode(&padded) {
                if let Ok(jwt_val) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    if let Some(jwt_email) = jwt_val.get("email").and_then(|e| e.as_str()) {
                        return Some(jwt_email.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Abstract storage trait for credentials
pub trait CredentialStorage: Send + Sync {
    fn read(&self, target: &str) -> Option<String>;
    fn write(&self, target: &str, data: &str, user: &str) -> bool;
    fn delete(&self, target: &str) -> bool;
}

// ---------------------------------------------------------------------------
// In-Memory Storage (for unit testing and mock mode)
// ---------------------------------------------------------------------------
#[derive(Default, Clone)]
pub struct MemoryCredentialStorage {
    map: Arc<Mutex<HashMap<String, String>>>,
}

impl MemoryCredentialStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStorage for MemoryCredentialStorage {
    fn read(&self, target: &str) -> Option<String> {
        let map = self.map.lock().unwrap();
        map.get(target).cloned()
    }

    fn write(&self, target: &str, data: &str, _user: &str) -> bool {
        let mut map = self.map.lock().unwrap();
        map.insert(target.to_string(), data.to_string());
        true
    }

    fn delete(&self, target: &str) -> bool {
        let mut map = self.map.lock().unwrap();
        map.remove(target).is_some()
    }
}

// ---------------------------------------------------------------------------
// Vault JSON File Storage (non-Windows fallback)
// ---------------------------------------------------------------------------
pub struct VaultCredentialStorage {
    pub vault_path: PathBuf,
}

impl VaultCredentialStorage {
    pub fn new(vault_path: PathBuf) -> Self {
        Self { vault_path }
    }

    pub fn default_path() -> PathBuf {
        let home = crate::presets::dirs_home().unwrap_or_else(|| PathBuf::from("."));
        home.join(".gemini").join("credentials_vault.json")
    }

    fn read_all(&self) -> HashMap<String, String> {
        if !self.vault_path.exists() {
            return HashMap::new();
        }
        if let Ok(data) = fs::read_to_string(&self.vault_path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    fn write_all(&self, map: &HashMap<String, String>) -> bool {
        if let Some(parent) = self.vault_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(data) = serde_json::to_string_pretty(map) {
            fs::write(&self.vault_path, data).is_ok()
        } else {
            false
        }
    }
}

impl CredentialStorage for VaultCredentialStorage {
    fn read(&self, target: &str) -> Option<String> {
        self.read_all().get(target).cloned()
    }

    fn write(&self, target: &str, data: &str, _user: &str) -> bool {
        let mut all = self.read_all();
        all.insert(target.to_string(), data.to_string());
        self.write_all(&all)
    }

    fn delete(&self, target: &str) -> bool {
        let mut all = self.read_all();
        if all.remove(target).is_some() {
            self.write_all(&all)
        } else {
            true
        }
    }
}

// ---------------------------------------------------------------------------
// Windows Credential Manager Native Storage (advapi32.dll FFI)
// ---------------------------------------------------------------------------
#[cfg(windows)]
pub struct Win32CredentialStorage;

#[cfg(windows)]
impl Win32CredentialStorage {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct Win32Credential {
    Flags: u32,
    Type: u32,
    TargetName: *mut u16,
    Comment: *mut u16,
    LastWritten: Win32FileTime,
    CredentialBlobSize: u32,
    CredentialBlob: *mut u8,
    Persist: u32,
    AttributeCount: u32,
    Attributes: *mut std::ffi::c_void,
    TargetAlias: *mut u16,
    UserName: *mut u16,
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct Win32FileTime {
    dwLowDateTime: u32,
    dwHighDateTime: u32,
}

#[cfg(windows)]
#[link(name = "advapi32")]
extern "system" {
    fn CredReadW(
        TargetName: *const u16,
        Type: u32,
        Flags: u32,
        Credential: *mut *mut Win32Credential,
    ) -> i32;

    fn CredWriteW(Credential: *const Win32Credential, Flags: u32) -> i32;

    fn CredDeleteW(TargetName: *const u16, Type: u32, Flags: u32) -> i32;

    fn CredFree(Buffer: *mut std::ffi::c_void);
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
impl CredentialStorage for Win32CredentialStorage {
    fn read(&self, target: &str) -> Option<String> {
        let target_wide = to_wide(target);
        let mut p_cred: *mut Win32Credential = std::ptr::null_mut();

        unsafe {
            // CRED_TYPE_GENERIC = 1
            let ret = CredReadW(target_wide.as_ptr(), 1, 0, &mut p_cred);
            if ret != 0 && !p_cred.is_null() {
                let blob_ptr = (*p_cred).CredentialBlob;
                let blob_size = (*p_cred).CredentialBlobSize as usize;
                let slice = std::slice::from_raw_parts(blob_ptr, blob_size);
                let result = String::from_utf8_lossy(slice).to_string();
                CredFree(p_cred as *mut std::ffi::c_void);
                return Some(result);
            }
        }
        None
    }

    fn write(&self, target: &str, data: &str, user: &str) -> bool {
        let mut target_wide = to_wide(target);
        let mut user_wide = to_wide(user);
        let mut comment_wide = to_wide("Antigravity MultiAcc");
        let mut bytes = data.as_bytes().to_vec();

        let cred = Win32Credential {
            Flags: 0,
            Type: 1, // CRED_TYPE_GENERIC
            TargetName: target_wide.as_mut_ptr(),
            Comment: comment_wide.as_mut_ptr(),
            LastWritten: Win32FileTime {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            },
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: 2, // CRED_PERSIST_LOCAL_MACHINE
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: user_wide.as_mut_ptr(),
        };

        unsafe {
            let ret = CredWriteW(&cred, 0);
            ret != 0
        }
    }

    fn delete(&self, target: &str) -> bool {
        let target_wide = to_wide(target);
        unsafe {
            // CRED_TYPE_GENERIC = 1
            let ret = CredDeleteW(target_wide.as_ptr(), 1, 0);
            ret != 0
        }
    }
}

// ---------------------------------------------------------------------------
// Credential Manager High-Level API
// ---------------------------------------------------------------------------
pub struct CredentialManager {
    pub storage: Box<dyn CredentialStorage>,
    pub config_path: PathBuf,
}

impl CredentialManager {
    pub fn new(storage: Box<dyn CredentialStorage>, config_path: PathBuf) -> Self {
        Self {
            storage,
            config_path,
        }
    }

    pub fn default_manager() -> Self {
        let home = crate::presets::dirs_home().unwrap_or_else(|| PathBuf::from("."));
        let config_path = home.join(".gemini").join("antigravity_multiacc.json");

        #[cfg(windows)]
        {
            Self::new(Box::new(Win32CredentialStorage::new()), config_path)
        }
        #[cfg(not(windows))]
        {
            Self::new(
                Box::new(VaultCredentialStorage::new(
                    VaultCredentialStorage::default_path(),
                )),
                config_path,
            )
        }
    }

    pub fn load_config(&self) -> MultiaccConfig {
        if !self.config_path.exists() {
            return MultiaccConfig::default();
        }
        if let Ok(content) = fs::read_to_string(&self.config_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            MultiaccConfig::default()
        }
    }

    pub fn save_config(&self, cfg: &MultiaccConfig) -> Result<(), CredError> {
        if let Some(parent) = self.config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let data = serde_json::to_string_pretty(cfg)?;
        fs::write(&self.config_path, data)?;
        Ok(())
    }

    /// Scans the dynamic pool of 1..N accounts.
    /// No hardcoded 4-slot limit: supports arbitrary N accounts.
    pub fn get_status(&self) -> Result<MultiaccStatus, CredError> {
        let mut cfg = self.load_config();
        let cur_cred = self.storage.read(TARGET_ACTIVE);
        let cur_email = cur_cred.as_deref().and_then(extract_email);

        // Scan slots 1..N until no more slots exist (scan at least up to 64 slots)
        let mut accounts = Vec::new();
        let mut slot = 1;
        let mut consecutive_empty = 0;

        while consecutive_empty < 5 && slot <= 128 {
            let target = get_slot_target(slot);
            if let Some(cred) = self.storage.read(&target) {
                let email = extract_email(&cred).unwrap_or_else(|| format!("Account {}", slot));
                accounts.push(AccountInfo { slot, email });
                consecutive_empty = 0;
            } else {
                consecutive_empty += 1;
            }
            slot += 1;
        }

        // If no slots exist but active credential exists, auto-populate slot 1
        if accounts.is_empty() {
            if let Some(ref cred) = cur_cred {
                self.storage.write(&get_slot_target(1), cred, "antigravity");
                let email = cur_email.clone().unwrap_or_else(|| "Account 1".to_string());
                accounts.push(AccountInfo { slot: 1, email });
            }
        }

        // Determine active slot
        let mut active_slot = cfg.active_slot;
        if let Some(ref email) = cur_email {
            if let Some(acc) = accounts.iter().find(|a| a.email.eq_ignore_ascii_case(email)) {
                active_slot = acc.slot;
            }
        } else if !accounts.iter().any(|a| a.slot == active_slot) {
            active_slot = accounts.first().map(|a| a.slot).unwrap_or(1);
        }

        cfg.active_slot = active_slot;
        cfg.accounts = accounts.clone();
        let _ = self.save_config(&cfg);

        Ok(MultiaccStatus {
            active_slot,
            current_email: cur_email,
            slots_count: accounts.len(),
            accounts,
            auto_failover: cfg.auto_failover,
        })
    }

    /// Rotate to target slot, or next in carousel if None
    pub fn rotate(&self, target_slot: Option<u32>) -> Result<MultiaccStatus, CredError> {
        let status = self.get_status()?;
        if status.accounts.is_empty() {
            return Err(CredError::Message("No accounts configured in pool".to_string()));
        }

        let next_slot = match target_slot {
            Some(slot) => {
                if !status.accounts.iter().any(|a| a.slot == slot) {
                    return Err(CredError::Message(format!("Slot {} not found in pool", slot)));
                }
                slot
            }
            None => {
                // Next account in carousel
                let curr_idx = status
                    .accounts
                    .iter()
                    .position(|a| a.slot == status.active_slot)
                    .unwrap_or(0);
                let next_idx = (curr_idx + 1) % status.accounts.len();
                status.accounts[next_idx].slot
            }
        };

        let target_cred = self
            .storage
            .read(&get_slot_target(next_slot))
            .ok_or_else(|| CredError::Message(format!("No credentials in slot {}", next_slot)))?;

        // 1. Save current active credentials back into its slot (preserve updated tokens)
        if let Some(cur_cred) = self.storage.read(TARGET_ACTIVE) {
            self.storage.write(
                &get_slot_target(status.active_slot),
                &cur_cred,
                "antigravity",
            );
        }

        // 2. Write new target credentials to TARGET_ACTIVE
        self.storage.write(TARGET_ACTIVE, &target_cred, "antigravity");

        let mut cfg = self.load_config();
        cfg.active_slot = next_slot;
        self.save_config(&cfg)?;

        self.get_status()
    }

    /// Zero-gap compactification delete
    pub fn delete_slot(&self, slot: u32) -> Result<MultiaccStatus, CredError> {
        let status = self.get_status()?;
        if status.accounts.len() <= 1 {
            return Err(CredError::Message(
                "Cannot delete the only remaining account in pool".to_string(),
            ));
        }

        if !status.accounts.iter().any(|a| a.slot == slot) {
            return Err(CredError::Message(format!("Slot {} not found in pool", slot)));
        }

        // 1. Save current active credential into its slot
        if let Some(cur_cred) = self.storage.read(TARGET_ACTIVE) {
            self.storage.write(
                &get_slot_target(status.active_slot),
                &cur_cred,
                "antigravity",
            );
        }

        // 2. Collect remaining credentials in order
        let mut remaining = Vec::new();
        let active_was_deleted = status.active_slot == slot;

        for acc in &status.accounts {
            if acc.slot == slot {
                continue;
            }
            if let Some(cred) = self.storage.read(&get_slot_target(acc.slot)) {
                let was_active = acc.slot == status.active_slot;
                remaining.push((cred, was_active));
            }
        }

        // 3. Clear all old slot targets
        for acc in &status.accounts {
            self.storage.delete(&get_slot_target(acc.slot));
        }

        // 4. Write compacted slots 1..M
        let mut new_active_slot = 1;
        for (idx, (cred, was_active)) in remaining.iter().enumerate() {
            let new_slot = (idx + 1) as u32;
            self.storage.write(&get_slot_target(new_slot), cred, "antigravity");
            if *was_active && !active_was_deleted {
                new_active_slot = new_slot;
            }
        }

        // 5. Update TARGET_ACTIVE
        if active_was_deleted {
            if let Some(c1) = self.storage.read(&get_slot_target(1)) {
                self.storage.write(TARGET_ACTIVE, &c1, "antigravity");
            }
            new_active_slot = 1;
        } else if let Some(ca) = self.storage.read(&get_slot_target(new_active_slot)) {
            self.storage.write(TARGET_ACTIVE, &ca, "antigravity");
        }

        let mut cfg = self.load_config();
        cfg.active_slot = new_active_slot;
        self.save_config(&cfg)?;

        self.get_status()
    }

    pub fn prepare_add_login(&self) -> Result<u32, CredError> {
        let status = self.get_status()?;
        let existing_slots: std::collections::HashSet<u32> =
            status.accounts.iter().map(|a| a.slot).collect();

        let mut next_slot = 1;
        while existing_slots.contains(&next_slot) {
            next_slot += 1;
        }

        // Backup current active credential to its current slot
        if let Some(cur_cred) = self.storage.read(TARGET_ACTIVE) {
            self.storage.write(
                &get_slot_target(status.active_slot),
                &cur_cred,
                "antigravity",
            );
        }

        let mut cfg = self.load_config();
        cfg.pending_slot = Some(next_slot);
        cfg.restore_slot = Some(status.active_slot);
        cfg.pending_start_time = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64(),
        );
        self.save_config(&cfg)?;

        // Delete active credential so LS prompts login
        self.storage.delete(TARGET_ACTIVE);

        Ok(next_slot)
    }

    pub fn finalize_add_login(&self) -> Result<MultiaccStatus, CredError> {
        let new_cred = self
            .storage
            .read(TARGET_ACTIVE)
            .ok_or_else(|| CredError::Message("No token received yet in active slot".to_string()))?;

        let new_email = extract_email(&new_cred);
        let mut cfg = self.load_config();
        let restore_slot = cfg.restore_slot.unwrap_or(1);
        let status = self.get_status()?;

        // Check if duplicate email
        if let Some(ref email) = new_email {
            if let Some(dup) = status.accounts.iter().find(|a| a.email.eq_ignore_ascii_case(email)) {
                let dup_slot = dup.slot;
                self.storage.write(&get_slot_target(dup_slot), &new_cred, "antigravity");

                // Restore previous active credential
                if let Some(prev) = self.storage.read(&get_slot_target(restore_slot)) {
                    self.storage.write(TARGET_ACTIVE, &prev, "antigravity");
                }

                cfg.pending_slot = None;
                cfg.restore_slot = None;
                cfg.pending_start_time = None;
                self.save_config(&cfg)?;

                return self.get_status();
            }
        }

        let target_slot = cfg.pending_slot.unwrap_or_else(|| (status.accounts.len() + 1) as u32);
        self.storage.write(&get_slot_target(target_slot), &new_cred, "antigravity");

        // Restore previous active credential
        if let Some(prev) = self.storage.read(&get_slot_target(restore_slot)) {
            self.storage.write(TARGET_ACTIVE, &prev, "antigravity");
        }

        cfg.pending_slot = None;
        cfg.restore_slot = None;
        cfg.pending_start_time = None;
        self.save_config(&cfg)?;

        self.get_status()
    }

    /// Extracts the bearer/access/refresh token or raw credential string
    /// for the specified slot directly without altering or switching the active target.
    pub fn get_token_for_slot(&self, slot: u32) -> Result<String, CredError> {
        let target = get_slot_target(slot);
        let raw = self
            .storage
            .read(&target)
            .ok_or_else(|| CredError::Message(format!("No credentials found for slot {}", slot)))?;

        // If it's a JSON blob, try extracting token fields
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(token) = val.get("token").and_then(|v| v.as_str()) {
                if !token.trim().is_empty() {
                    return Ok(token.to_string());
                }
            }
            if let Some(token) = val.get("access_token").and_then(|v| v.as_str()) {
                if !token.trim().is_empty() {
                    return Ok(token.to_string());
                }
            }
            if let Some(token) = val.get("refresh_token").and_then(|v| v.as_str()) {
                if !token.trim().is_empty() {
                    return Ok(token.to_string());
                }
            }
            if let Some(token) = val.get("id_token").and_then(|v| v.as_str()) {
                if !token.trim().is_empty() {
                    return Ok(token.to_string());
                }
            }
        }

        // Return raw credential string
        Ok(raw)
    }

    /// Resolves active slot for given CLI and workspace context against this manager's storage.
    pub fn resolve_slot(
        &self,
        cli_slot: Option<u32>,
        workspace: Option<&Path>,
    ) -> Result<(u32, SlotResolutionSource), CredError> {
        let status = self.get_status()?;
        Ok(resolve_slot_priority(cli_slot, workspace, status.active_slot))
    }
}

/// Standalone helper to directly get token for a slot using default manager
pub fn get_token_for_slot(slot: u32) -> Result<String, CredError> {
    let mgr = CredentialManager::default_manager();
    mgr.get_token_for_slot(slot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_extract_email_json() {
        let json = r#"{"email": "developer@example.com", "token": "xyz"}"#;
        assert_eq!(extract_email(json), Some("developer@example.com".to_string()));
    }

    #[test]
    fn test_memory_storage_and_rotation() {
        let temp = tempdir().unwrap();
        let cfg_path = temp.path().join("config.json");
        let storage = Box::new(MemoryCredentialStorage::new());

        // Prepopulate slots
        storage.write(
            "gemini:antigravity_slot_1",
            r#"{"email": "user1@example.com"}"#,
            "user",
        );
        storage.write(
            "gemini:antigravity_slot_2",
            r#"{"email": "user2@example.com"}"#,
            "user",
        );
        storage.write(
            TARGET_ACTIVE,
            r#"{"email": "user1@example.com"}"#,
            "user",
        );

        let mgr = CredentialManager::new(storage, cfg_path);
        let status = mgr.get_status().unwrap();
        assert_eq!(status.accounts.len(), 2);
        assert_eq!(status.active_slot, 1);

        // Rotate to next
        let rotated = mgr.rotate(None).unwrap();
        assert_eq!(rotated.active_slot, 2);
        assert_eq!(rotated.current_email, Some("user2@example.com".to_string()));

        // Rotate back
        let rotated2 = mgr.rotate(None).unwrap();
        assert_eq!(rotated2.active_slot, 1);
        assert_eq!(rotated2.current_email, Some("user1@example.com".to_string()));
    }

    #[test]
    fn test_zero_gap_delete_compaction() {
        let temp = tempdir().unwrap();
        let cfg_path = temp.path().join("config.json");
        let storage = Box::new(MemoryCredentialStorage::new());

        storage.write("gemini:antigravity_slot_1", r#"{"email": "a@ex.com"}"#, "u");
        storage.write("gemini:antigravity_slot_2", r#"{"email": "b@ex.com"}"#, "u");
        storage.write("gemini:antigravity_slot_3", r#"{"email": "c@ex.com"}"#, "u");
        storage.write(TARGET_ACTIVE, r#"{"email": "b@ex.com"}"#, "u");

        let mgr = CredentialManager::new(storage, cfg_path);
        let status = mgr.get_status().unwrap();
        assert_eq!(status.accounts.len(), 3);
        assert_eq!(status.active_slot, 2);

        // Delete slot 2 (which was active)
        let after_delete = mgr.delete_slot(2).unwrap();
        assert_eq!(after_delete.accounts.len(), 2);
        assert_eq!(after_delete.accounts[0].slot, 1);
        assert_eq!(after_delete.accounts[0].email, "a@ex.com");
        assert_eq!(after_delete.accounts[1].slot, 2);
        assert_eq!(after_delete.accounts[1].email, "c@ex.com");
        // Compacted with zero gaps: slots are 1 and 2!
        assert_eq!(after_delete.active_slot, 1);
    }

    #[test]
    fn test_project_config_save_load() {
        let temp = tempdir().unwrap();
        let ws = temp.path().join("proj");
        fs::create_dir_all(&ws).unwrap();

        // Initially None
        assert_eq!(ProjectConfig::load(&ws).unwrap(), None);

        let cfg = ProjectConfig {
            slot: Some(2),
            preset: Some("backend".to_string()),
            overlays: vec!["qa".to_string(), "docker".to_string()],
        };
        cfg.save(&ws).unwrap();

        let loaded = ProjectConfig::load(&ws).unwrap().expect("Config should exist");
        assert_eq!(loaded.slot, Some(2));
        assert_eq!(loaded.preset, Some("backend".to_string()));
        assert_eq!(loaded.overlays, vec!["qa", "docker"]);
    }

    #[test]
    fn test_slot_priority_resolution() {
        let temp = tempdir().unwrap();
        let ws = temp.path().join("workspace");
        fs::create_dir_all(&ws).unwrap();

        let cfg = ProjectConfig {
            slot: Some(4),
            preset: Some("qa".to_string()),
            overlays: vec![],
        };
        cfg.save(&ws).unwrap();

        // Priority 1: CLI flag overrides env, project config, and global
        std::env::set_var("AGY_SLOT", "2");
        let (slot1, src1) = resolve_slot_priority(Some(3), Some(&ws), 1);
        assert_eq!(slot1, 3);
        assert_eq!(src1, SlotResolutionSource::CliFlag);

        // Priority 2: AGY_SLOT env overrides project config and global
        let (slot2, src2) = resolve_slot_priority(None, Some(&ws), 1);
        assert_eq!(slot2, 2);
        assert_eq!(src2, SlotResolutionSource::EnvironmentVariable("2".to_string()));

        // Priority 3: Project config overrides global active slot
        std::env::remove_var("AGY_SLOT");
        let (slot3, src3) = resolve_slot_priority(None, Some(&ws), 1);
        assert_eq!(slot3, 4);
        assert!(matches!(src3, SlotResolutionSource::ProjectConfig(_)));

        // Priority 4: Global active slot fallback
        let empty_ws = temp.path().join("empty_proj");
        fs::create_dir_all(&empty_ws).unwrap();
        let (slot4, src4) = resolve_slot_priority(None, Some(&empty_ws), 1);
        assert_eq!(slot4, 1);
        assert_eq!(src4, SlotResolutionSource::GlobalActive);
    }

    #[test]
    fn test_get_token_for_slot_direct_extraction() {
        let temp = tempdir().unwrap();
        let cfg_path = temp.path().join("config.json");
        let storage = Box::new(MemoryCredentialStorage::new());

        storage.write(
            "gemini:antigravity_slot_1",
            r#"{"token": "bearer-token-111", "email": "dev1@test.com"}"#,
            "u",
        );
        storage.write(
            "gemini:antigravity_slot_2",
            r#"{"access_token": "bearer-token-222", "email": "dev2@test.com"}"#,
            "u",
        );
        storage.write(
            TARGET_ACTIVE,
            r#"{"token": "bearer-token-111", "email": "dev1@test.com"}"#,
            "u",
        );

        let mgr = CredentialManager::new(storage.clone(), cfg_path);

        // Direct token extraction from slot 2
        let token2 = mgr.get_token_for_slot(2).unwrap();
        assert_eq!(token2, "bearer-token-222");

        // Direct token extraction from slot 1
        let token1 = mgr.get_token_for_slot(1).unwrap();
        assert_eq!(token1, "bearer-token-111");

        // Crucial invariant: TARGET_ACTIVE must NOT have been changed or overwritten!
        let active_cred = storage.read(TARGET_ACTIVE).unwrap();
        assert!(active_cred.contains("bearer-token-111"));
        assert!(active_cred.contains("dev1@test.com"));
    }
}
