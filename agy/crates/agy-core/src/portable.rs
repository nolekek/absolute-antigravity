//! Portable Storage and Compilation-Embedded Assets Module.
//!
//! Provides support for:
//! 1. Compile-time embedded core assets (presets manifest, web dashboard, schemas).
//! 2. Portable mode detection (via env, CLI flag `--portable`, exe name, or adjacent `data` directory).
//! 3. Portable storage directory resolution (`<exe_dir>/data`).
//! 4. Automatic web dashboard extraction when running in standalone / portable mode.

use std::path::{Path, PathBuf};

/// Compile-time embedded presets manifest (`presets.yaml`).
pub const EMBEDDED_PRESETS_YAML: &str = include_str!("../../../../presets.yaml");

/// Compile-time embedded server dashboard script (`scripts/server_dashboard.js`).
pub const EMBEDDED_DASHBOARD_JS: &str = include_str!("../../../../scripts/server_dashboard.js");

/// Compile-time embedded Modern AI Web Studio bundle (`web/dist/index.html`).
pub const EMBEDDED_STUDIO_HTML: &str = include_str!("../../../../web/dist/index.html");

/// Compile-time embedded JSON schema for presets (`schemas/presets.schema.json`).
pub const EMBEDDED_SCHEMA_JSON: &str = include_str!("../../../../schemas/presets.schema.json");

/// Determines whether the application is running in portable mode.
///
/// Portable mode is triggered if any of the following conditions is met:
/// 1. Environment variable `AGY_PORTABLE=1` (or "true" / "yes").
/// 2. Command-line argument `--portable` is present in `std::env::args()`.
/// 3. Executable file name (`std::env::current_exe()`) contains `"portable"` (case-insensitive).
/// 4. A directory named `data` or `.agy-data` exists directly adjacent to the executable.
pub fn is_portable_mode() -> bool {
    let env_val = std::env::var("AGY_PORTABLE").ok();
    let args: Vec<String> = std::env::args().collect();
    let exe = std::env::current_exe().ok();
    check_portable_mode(env_val.as_deref(), &args, exe.as_deref())
}

/// Helper for determining portable mode with explicit arguments (isolated from process global state).
pub fn check_portable_mode(
    env_val: Option<&str>,
    args: &[String],
    exe_path: Option<&Path>,
) -> bool {
    // 1. Environment variable AGY_PORTABLE=1
    if let Some(val) = env_val {
        let v = val.trim();
        if v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes") {
            return true;
        }
    }

    // 2. Command line argument --portable
    if args.iter().any(|arg| arg == "--portable") {
        return true;
    }

    // 3. Executable name or adjacent data directory
    if let Some(path) = exe_path {
        // Check if exe filename contains "portable"
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            if file_name.to_lowercase().contains("portable") {
                return true;
            }
        }

        // Check if data or .agy-data directory exists adjacent to exe
        if let Some(parent) = path.parent() {
            if parent.join("data").is_dir() || parent.join(".agy-data").is_dir() {
                return true;
            }
        }
    }

    false
}

/// Returns the base directory for antigravity data and configuration.
///
/// In portable mode:
/// - Returns `<exe_dir>/data` (or `<exe_dir>/.agy-data` if it exists).
/// - Falls back to `./data` if the executable directory cannot be resolved.
///
/// In standard mode:
/// - Returns the user-global directory `~/.gemini/antigravity`.
pub fn get_base_dir() -> PathBuf {
    if is_portable_mode() {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let agy_data = parent.join(".agy-data");
                if agy_data.is_dir() && !parent.join("data").is_dir() {
                    return agy_data;
                }
                return parent.join("data");
            }
        }
        if Path::new(".agy-data").is_dir() && !Path::new("data").is_dir() {
            PathBuf::from(".agy-data")
        } else {
            PathBuf::from("data")
        }
    } else {
        if let Some(home) = crate::presets::dirs_home() {
            home.join(".gemini").join("antigravity")
        } else {
            PathBuf::from(".gemini").join("antigravity")
        }
    }
}

/// Returns the configuration directory: `<base_dir>/config`.
pub fn get_config_dir() -> PathBuf {
    get_base_dir().join("config")
}

/// Returns the skills directory: `<base_dir>/skills`.
pub fn get_skills_dir() -> PathBuf {
    get_base_dir().join("skills")
}

/// Returns the credentials path: `<base_dir>/credentials.json`.
pub fn get_credentials_path() -> PathBuf {
    get_base_dir().join("credentials.json")
}

/// Returns the logs directory: `<base_dir>/logs`.
pub fn get_log_dir() -> PathBuf {
    get_base_dir().join("logs")
}

/// Automatically extracts the embedded web dashboard (`EMBEDDED_DASHBOARD_JS`) if needed.
///
/// In portable mode:
/// Extracts `EMBEDDED_DASHBOARD_JS` to `<base_dir>/web/server_dashboard.js` if missing
/// or outdated, and returns the path to it.
///
/// In standard mode:
/// Checks workspace `scripts/server_dashboard.js` first, then falls back to extracting
/// into `<base_dir>/web/server_dashboard.js`.
pub fn extract_dashboard_if_needed() -> PathBuf {
    let base_dir = get_base_dir();
    let target_dir = base_dir.join("web");
    let target_file = target_dir.join("server_dashboard.js");

    if is_portable_mode() {
        let _ = extract_dashboard_to(&target_dir);
        target_file
    } else {
        if let Ok(cwd) = std::env::current_dir() {
            let script = cwd.join("scripts").join("server_dashboard.js");
            if script.is_file() {
                return script;
            }
        }
        if target_file.is_file() {
            return target_file;
        }
        let _ = extract_dashboard_to(&target_dir);
        target_file
    }
}

/// Extracts `EMBEDDED_DASHBOARD_JS` to `<target_dir>/server_dashboard.js` if missing or outdated.
pub fn extract_dashboard_to(target_dir: &Path) -> std::io::Result<PathBuf> {
    if !target_dir.exists() {
        std::fs::create_dir_all(target_dir)?;
    }
    let target_file = target_dir.join("server_dashboard.js");

    let needs_extract = if !target_file.exists() {
        true
    } else if let Ok(metadata) = std::fs::metadata(&target_file) {
        if metadata.len() != EMBEDDED_DASHBOARD_JS.len() as u64 {
            true
        } else {
            std::fs::read_to_string(&target_file)
                .map(|content| content != EMBEDDED_DASHBOARD_JS)
                .unwrap_or(true)
        }
    } else {
        true
    };

    if needs_extract {
        std::fs::write(&target_file, EMBEDDED_DASHBOARD_JS)?;
    }

    // Also extract the embedded Modern AI Studio single-file HTML bundle alongside the script
    let html_file = target_dir.join("index.html");
    let needs_extract_html = if !html_file.exists() {
        true
    } else if let Ok(metadata) = std::fs::metadata(&html_file) {
        metadata.len() != EMBEDDED_STUDIO_HTML.len() as u64
    } else {
        true
    };
    if needs_extract_html {
        let _ = std::fs::write(&html_file, EMBEDDED_STUDIO_HTML);
    }

    Ok(target_file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_embedded_presets_yaml_validity() {
        assert!(!EMBEDDED_PRESETS_YAML.is_empty());
        assert!(EMBEDDED_PRESETS_YAML.contains("version: \"3.0\""));
        assert!(EMBEDDED_PRESETS_YAML.contains("presets:"));
        let manifest: crate::presets::PresetsManifest =
            serde_yaml::from_str(EMBEDDED_PRESETS_YAML).expect("EMBEDDED_PRESETS_YAML must deserialize");
        assert_eq!(manifest.version, "3.0");
        assert_eq!(manifest.presets.len(), 16);
    }

    #[test]
    fn test_embedded_dashboard_and_schema_validity() {
        assert!(!EMBEDDED_DASHBOARD_JS.is_empty());
        assert!(EMBEDDED_DASHBOARD_JS.len() > 1000);
        assert!(EMBEDDED_DASHBOARD_JS.contains("server_dashboard"));

        assert!(!EMBEDDED_SCHEMA_JSON.is_empty());
        let val: serde_json::Value =
            serde_json::from_str(EMBEDDED_SCHEMA_JSON).expect("EMBEDDED_SCHEMA_JSON must be valid json");
        assert!(val.get("properties").is_some() || val.get("$schema").is_some());
    }

    #[test]
    fn test_portable_mode_detection_env() {
        assert!(check_portable_mode(Some("1"), &[], None));
        assert!(check_portable_mode(Some("true"), &[], None));
        assert!(check_portable_mode(Some("TRUE"), &[], None));
        assert!(check_portable_mode(Some("yes"), &[], None));
        assert!(!check_portable_mode(Some("0"), &[], None));
        assert!(!check_portable_mode(Some("false"), &[], None));
        assert!(!check_portable_mode(None, &[], None));
    }

    #[test]
    fn test_portable_mode_detection_cli_arg() {
        let args = vec!["agy".to_string(), "--portable".to_string()];
        assert!(check_portable_mode(None, &args, None));

        let other_args = vec!["agy".to_string(), "--help".to_string()];
        assert!(!check_portable_mode(None, &other_args, None));
    }

    #[test]
    fn test_portable_mode_detection_exe_name() {
        let portable_exe = PathBuf::from("C:\\tools\\agy-portable.exe");
        assert!(check_portable_mode(None, &[], Some(&portable_exe)));

        let linux_portable_exe = PathBuf::from("/usr/local/bin/portable-agy");
        assert!(check_portable_mode(None, &[], Some(&linux_portable_exe)));

        let standard_exe = PathBuf::from("C:\\tools\\agy.exe");
        assert!(!check_portable_mode(None, &[], Some(&standard_exe)));
    }

    #[test]
    fn test_portable_mode_detection_adjacent_data_dir() {
        let temp = tempdir().unwrap();
        let exe_path = temp.path().join("agy.exe");
        assert!(!check_portable_mode(None, &[], Some(&exe_path)));

        // Create data folder
        let data_dir = temp.path().join("data");
        fs::create_dir_all(&data_dir).unwrap();
        assert!(check_portable_mode(None, &[], Some(&exe_path)));

        // Remove data folder
        fs::remove_dir_all(&data_dir).unwrap();
        assert!(!check_portable_mode(None, &[], Some(&exe_path)));

        // Create .agy-data folder
        let agy_data_dir = temp.path().join(".agy-data");
        fs::create_dir_all(&agy_data_dir).unwrap();
        assert!(check_portable_mode(None, &[], Some(&exe_path)));
    }

    #[test]
    fn test_paths_structure() {
        let base = get_base_dir();
        assert_eq!(get_config_dir(), base.join("config"));
        assert_eq!(get_skills_dir(), base.join("skills"));
        assert_eq!(get_credentials_path(), base.join("credentials.json"));
        assert_eq!(get_log_dir(), base.join("logs"));
    }

    #[test]
    fn test_extract_dashboard_to_custom_dir() {
        let temp = tempdir().unwrap();
        let target_dir = temp.path().join("web");

        // 1. Initial extraction
        let extracted_path = extract_dashboard_to(&target_dir).expect("extract should succeed");
        assert!(extracted_path.is_file());
        let content = fs::read_to_string(&extracted_path).unwrap();
        assert_eq!(content, EMBEDDED_DASHBOARD_JS);

        // 2. Modify to simulate outdated dashboard
        fs::write(&extracted_path, "// outdated").unwrap();
        assert_ne!(fs::read_to_string(&extracted_path).unwrap(), EMBEDDED_DASHBOARD_JS);

        // 3. Re-extract: should detect outdated and overwrite with embedded version
        let re_extracted = extract_dashboard_to(&target_dir).expect("re-extract should succeed");
        assert_eq!(re_extracted, extracted_path);
        let updated_content = fs::read_to_string(&re_extracted).unwrap();
        assert_eq!(updated_content, EMBEDDED_DASHBOARD_JS);
    }
}
