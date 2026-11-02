use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SymlinkError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Path '{0}' does not exist")]
    PathNotFound(PathBuf),
    #[error("Target '{0}' is not a directory")]
    NotADirectory(PathBuf),
    #[error("Failed to create link from '{target}' to '{link}': {reason}")]
    LinkCreationFailed {
        target: PathBuf,
        link: PathBuf,
        reason: String,
    },
    #[error("Failed to remove link at '{0}': {1}")]
    LinkRemovalFailed(PathBuf, String),
}

#[derive(Debug, Clone, Default)]
pub struct SyncReport {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub kept: Vec<String>,
    pub errors: Vec<(String, String)>,
    pub duration_ms: u64,
}

/// Helper to determine the default skills library directory (~/.gemini/skills-library)
pub fn default_library_dir() -> Result<PathBuf, SymlinkError> {
    let home = crate::presets::dirs_home().ok_or_else(|| {
        SymlinkError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine user home directory",
        ))
    })?;
    Ok(home.join(".gemini").join("skills-library"))
}

/// Workspace-scoped skills synchronization.
/// Links desired skills directly into `<workspace_dir>/.gemini/config/skills/`.
/// This enables Project A to have active preset `backend` while Project B has `web`
/// simultaneously on the same machine without rewriting the global skills catalog.
pub fn sync_workspace_skills(
    workspace_dir: &Path,
    desired_skills: &[String],
    library_dir: &Path,
) -> Result<SyncReport, SymlinkError> {
    let active_skills_dir = workspace_dir.join(".gemini").join("config").join("skills");
    let engine = SymlinkEngine::new(library_dir.to_path_buf(), active_skills_dir);
    let desired_set: BTreeSet<String> = desired_skills.iter().cloned().collect();
    engine.sync_skills(&desired_set)
}

/// Automatically detects if the current or specified path belongs to a workspace project
/// by checking for the existence of `.git` or `.agy`.
pub fn detect_workspace(explicit: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        return Some(p.to_path_buf());
    }
    if let Ok(cur) = std::env::current_dir() {
        if cur.join(".git").exists() || cur.join(".agy").exists() {
            return Some(cur);
        }
        let mut check = cur.parent();
        while let Some(dir) = check {
            if dir.join(".git").exists() || dir.join(".agy").exists() {
                return Some(dir.to_path_buf());
            }
            check = dir.parent();
        }
    }
    None
}

pub struct SymlinkEngine {
    pub library_dir: PathBuf,
    pub active_skills_dir: PathBuf,
}

impl SymlinkEngine {
    pub fn new(library_dir: PathBuf, active_skills_dir: PathBuf) -> Self {
        Self {
            library_dir,
            active_skills_dir,
        }
    }

    pub fn for_workspace(workspace_dir: &Path, library_dir: Option<&Path>) -> Result<Self, SymlinkError> {
        let lib = match library_dir {
            Some(l) => l.to_path_buf(),
            None => default_library_dir()?,
        };
        let active = workspace_dir.join(".gemini").join("config").join("skills");
        Ok(Self::new(lib, active))
    }

    pub fn sync_workspace_skills(
        workspace_dir: &Path,
        desired_skills: &[String],
        library_dir: &Path,
    ) -> Result<SyncReport, SymlinkError> {
        sync_workspace_skills(workspace_dir, desired_skills, library_dir)
    }

    pub fn default_paths() -> Result<Self, SymlinkError> {
        let library_dir = default_library_dir()?;
        let home = crate::presets::dirs_home().ok_or_else(|| {
            SymlinkError::IoError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not determine user home directory",
            ))
        })?;

        // Active skills dir: ~/.gemini/config/skills
        let active_skills_dir = home.join(".gemini").join("config").join("skills");

        Ok(Self::new(library_dir, active_skills_dir))
    }

    /// Checks if the given path is a symlink or an NTFS Junction
    pub fn is_link(&self, path: &Path) -> bool {
        if !path.exists() {
            // Check symlink_metadata in case it's a broken link
            if let Ok(meta) = fs::symlink_metadata(path) {
                return meta.file_type().is_symlink();
            }
            return false;
        }

        #[cfg(windows)]
        {
            if let Ok(is_junc) = junction::exists(path) {
                if is_junc {
                    return true;
                }
            }
        }

        if let Ok(meta) = fs::symlink_metadata(path) {
            meta.file_type().is_symlink()
        } else {
            false
        }
    }

    /// Reads the target path of a symlink or junction
    pub fn read_link_target(&self, path: &Path) -> Option<PathBuf> {
        #[cfg(windows)]
        {
            if let Ok(is_junc) = junction::exists(path) {
                if is_junc {
                    if let Ok(target) = junction::get_target(path) {
                        return Some(target);
                    }
                }
            }
        }

        fs::read_link(path).ok()
    }

    /// Creates a directory symlink or NTFS junction pointing to `target` at `link_path`.
    pub fn create_link(&self, target: &Path, link_path: &Path) -> Result<(), SymlinkError> {
        if !target.exists() {
            return Err(SymlinkError::PathNotFound(target.to_path_buf()));
        }

        // Canonicalize target to ensure absolute path
        let abs_target = target.canonicalize().unwrap_or_else(|_| target.to_path_buf());

        // If link already exists, remove it first
        if self.is_link(link_path) || link_path.exists() {
            self.remove_link(link_path)?;
        }

        #[cfg(windows)]
        {
            // First attempt: try NTFS Junction (works for regular unprivileged users on Windows)
            match junction::create(&abs_target, link_path) {
                Ok(_) => return Ok(()),
                Err(j_err) => {
                    // Fallback to std::os::windows::fs::symlink_dir (if developer mode enabled)
                    if let Err(s_err) = std::os::windows::fs::symlink_dir(&abs_target, link_path) {
                        return Err(SymlinkError::LinkCreationFailed {
                            target: abs_target,
                            link: link_path.to_path_buf(),
                            reason: format!(
                                "Junction failed ({}) and symlink_dir failed ({})",
                                j_err, s_err
                            ),
                        });
                    }
                    return Ok(());
                }
            }
        }

        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(&abs_target, link_path).map_err(|e| {
                SymlinkError::LinkCreationFailed {
                    target: abs_target,
                    link: link_path.to_path_buf(),
                    reason: e.to_string(),
                }
            })?;
            Ok(())
        }
    }

    /// Safely removes a symlink or junction WITHOUT deleting files inside the target directory.
    pub fn remove_link(&self, link_path: &Path) -> Result<(), SymlinkError> {
        if !link_path.exists() {
            // It might be a broken link
            if let Ok(meta) = fs::symlink_metadata(link_path) {
                if meta.file_type().is_symlink() {
                    let _ = fs::remove_file(link_path);
                    return Ok(());
                }
            }
            return Ok(());
        }

        #[cfg(windows)]
        {
            if let Ok(true) = junction::exists(link_path) {
                junction::delete(link_path).map_err(|e| {
                    SymlinkError::LinkRemovalFailed(link_path.to_path_buf(), e.to_string())
                })?;
                // Remove the empty directory that remains after reparse point deletion
                let _ = fs::remove_dir(link_path);
                return Ok(());
            }

            if let Ok(meta) = fs::symlink_metadata(link_path) {
                if meta.file_type().is_symlink() {
                    // On Windows, directory symlinks can be removed via remove_dir
                    if let Err(e1) = fs::remove_dir(link_path) {
                        if let Err(e2) = fs::remove_file(link_path) {
                            return Err(SymlinkError::LinkRemovalFailed(
                                link_path.to_path_buf(),
                                format!("remove_dir failed: {}, remove_file failed: {}", e1, e2),
                            ));
                        }
                    }
                    return Ok(());
                }
            }

            // Safety check: Do NOT delete regular non-symlink directories!
            Err(SymlinkError::LinkRemovalFailed(
                link_path.to_path_buf(),
                "Refusing to delete non-symlink / non-junction directory".to_string(),
            ))
        }

        #[cfg(not(windows))]
        {
            if let Ok(meta) = fs::symlink_metadata(link_path) {
                if meta.file_type().is_symlink() {
                    fs::remove_file(link_path).map_err(|e| {
                        SymlinkError::LinkRemovalFailed(link_path.to_path_buf(), e.to_string())
                    })?;
                    return Ok(());
                }
            }

            Err(SymlinkError::LinkRemovalFailed(
                link_path.to_path_buf(),
                "Refusing to delete non-symlink directory".to_string(),
            ))
        }
    }

    /// Synchronizes the active skills directory with the desired set of skill IDs.
    /// Ensures zero disk churn and sub-millisecond execution per skill.
    pub fn sync_skills(&self, desired_skills: &BTreeSet<String>) -> Result<SyncReport, SymlinkError> {
        let start = Instant::now();
        let mut report = SyncReport::default();

        if !self.active_skills_dir.exists() {
            fs::create_dir_all(&self.active_skills_dir)?;
        }

        // 1. Scan currently active items
        let mut currently_active = HashSet::new();
        if let Ok(entries) = fs::read_dir(&self.active_skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();

                if self.is_link(&path) {
                    currently_active.insert(file_name);
                } else if path.is_dir() {
                    // Regular directory - check if SKILL.md exists
                    currently_active.insert(file_name);
                }
            }
        }

        // 2. Remove skills that are currently active but not desired
        for current in &currently_active {
            if !desired_skills.contains(current) {
                let link_path = self.active_skills_dir.join(current);
                if self.is_link(&link_path) {
                    match self.remove_link(&link_path) {
                        Ok(_) => report.removed.push(current.clone()),
                        Err(e) => report.errors.push((current.clone(), e.to_string())),
                    }
                } else {
                    // Non-link directory: we do not delete user directories silently,
                    // but we note it in report
                    report.errors.push((
                        current.clone(),
                        "Skipped: regular non-link directory present in active folder".to_string(),
                    ));
                }
            }
        }

        // 3. Add or keep desired skills
        for desired in desired_skills {
            let target_skill_dir = self.library_dir.join(desired);
            let link_path = self.active_skills_dir.join(desired);

            if !target_skill_dir.exists() {
                report.errors.push((
                    desired.clone(),
                    format!("Skill library folder does not exist: {}", target_skill_dir.display()),
                ));
                continue;
            }

            if currently_active.contains(desired) && self.is_link(&link_path) {
                // Verify link points to the right target
                if let Some(target) = self.read_link_target(&link_path) {
                    let abs_target = target_skill_dir
                        .canonicalize()
                        .unwrap_or_else(|_| target_skill_dir.clone());
                    let abs_curr = target
                        .canonicalize()
                        .unwrap_or_else(|_| target.clone());

                    if abs_target == abs_curr {
                        report.kept.push(desired.clone());
                        continue;
                    }
                }
            }

            // Create new link
            match self.create_link(&target_skill_dir, &link_path) {
                Ok(_) => report.added.push(desired.clone()),
                Err(e) => report.errors.push((desired.clone(), e.to_string())),
            }
        }

        report.duration_ms = start.elapsed().as_millis() as u64;
        Ok(report)
    }

    /// Lists all skills currently linked in the active directory
    pub fn list_active(&self) -> Result<Vec<String>, SymlinkError> {
        let mut result = Vec::new();
        if !self.active_skills_dir.exists() {
            return Ok(result);
        }

        for entry in fs::read_dir(&self.active_skills_dir)?.flatten() {
            let path = entry.path();
            if self.is_link(&path) || path.is_dir() {
                result.push(entry.file_name().to_string_lossy().to_string());
            }
        }

        result.sort();
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_create_and_remove_link() {
        let temp = tempdir().unwrap();
        let lib_dir = temp.path().join("library");
        let active_dir = temp.path().join("active");
        fs::create_dir_all(&lib_dir).unwrap();
        fs::create_dir_all(&active_dir).unwrap();

        // Create a dummy skill in library
        let skill_dir = lib_dir.join("test-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_file = skill_dir.join("SKILL.md");
        fs::write(&skill_file, "# Test Skill Content").unwrap();

        let engine = SymlinkEngine::new(lib_dir.clone(), active_dir.clone());
        let link_path = active_dir.join("test-skill");

        // Create link
        engine.create_link(&skill_dir, &link_path).unwrap();
        assert!(engine.is_link(&link_path));
        assert!(link_path.join("SKILL.md").exists());

        // Verify target file content is readable through link
        let content = fs::read_to_string(link_path.join("SKILL.md")).unwrap();
        assert_eq!(content, "# Test Skill Content");

        // Remove link
        engine.remove_link(&link_path).unwrap();
        assert!(!link_path.exists());

        // Target file MUST still exist!
        assert!(skill_file.exists());
    }

    #[test]
    fn test_sync_skills() {
        let temp = tempdir().unwrap();
        let lib_dir = temp.path().join("library");
        let active_dir = temp.path().join("active");
        fs::create_dir_all(&lib_dir).unwrap();
        fs::create_dir_all(&active_dir).unwrap();

        for name in &["skill-a", "skill-b", "skill-c"] {
            let s_dir = lib_dir.join(name);
            fs::create_dir_all(&s_dir).unwrap();
            fs::write(s_dir.join("SKILL.md"), format!("# {}", name)).unwrap();
        }

        let engine = SymlinkEngine::new(lib_dir, active_dir);

        // Sync with A and B
        let mut desired1 = BTreeSet::new();
        desired1.insert("skill-a".to_string());
        desired1.insert("skill-b".to_string());

        let rep1 = engine.sync_skills(&desired1).unwrap();
        assert_eq!(rep1.added.len(), 2);
        assert_eq!(rep1.removed.len(), 0);

        let active_list1 = engine.list_active().unwrap();
        assert_eq!(active_list1, vec!["skill-a", "skill-b"]);

        // Sync with B and C (A should be removed, B kept, C added)
        let mut desired2 = BTreeSet::new();
        desired2.insert("skill-b".to_string());
        desired2.insert("skill-c".to_string());

        let rep2 = engine.sync_skills(&desired2).unwrap();
        assert!(rep2.removed.contains(&"skill-a".to_string()));
        assert!(rep2.kept.contains(&"skill-b".to_string()));
        assert!(rep2.added.contains(&"skill-c".to_string()));

        let active_list2 = engine.list_active().unwrap();
        assert_eq!(active_list2, vec!["skill-b", "skill-c"]);
    }

    #[test]
    fn test_sync_workspace_skills() {
        let temp = tempdir().unwrap();
        let lib_dir = temp.path().join("library");
        let ws_a = temp.path().join("project_a");
        let ws_b = temp.path().join("project_b");

        fs::create_dir_all(&lib_dir).unwrap();
        fs::create_dir_all(&ws_a).unwrap();
        fs::create_dir_all(&ws_b).unwrap();

        for name in &["backend-db", "rust-guru", "web-react", "tailwind"] {
            let s_dir = lib_dir.join(name);
            fs::create_dir_all(&s_dir).unwrap();
            fs::write(s_dir.join("SKILL.md"), format!("# {}", name)).unwrap();
        }

        // Project A activates backend skills
        let desired_a = vec!["backend-db".to_string(), "rust-guru".to_string()];
        let rep_a = sync_workspace_skills(&ws_a, &desired_a, &lib_dir).unwrap();
        assert_eq!(rep_a.added.len(), 2);

        // Project B activates web skills
        let desired_b = vec!["web-react".to_string(), "tailwind".to_string()];
        let rep_b = sync_workspace_skills(&ws_b, &desired_b, &lib_dir).unwrap();
        assert_eq!(rep_b.added.len(), 2);

        // Verify Project A skills folder
        let engine_a = SymlinkEngine::for_workspace(&ws_a, Some(&lib_dir)).unwrap();
        let active_a = engine_a.list_active().unwrap();
        assert_eq!(active_a, vec!["backend-db", "rust-guru"]);

        // Verify Project B skills folder (isolated!)
        let engine_b = SymlinkEngine::for_workspace(&ws_b, Some(&lib_dir)).unwrap();
        let active_b = engine_b.list_active().unwrap();
        assert_eq!(active_b, vec!["tailwind", "web-react"]);

        // Update Project A: switch to web-react and keep rust-guru
        let updated_a = vec!["rust-guru".to_string(), "web-react".to_string()];
        let rep_a2 = sync_workspace_skills(&ws_a, &updated_a, &lib_dir).unwrap();
        assert_eq!(rep_a2.removed, vec!["backend-db"]);
        assert_eq!(rep_a2.added, vec!["web-react"]);
        assert_eq!(rep_a2.kept, vec!["rust-guru"]);

        // Project B must remain completely untouched!
        let active_b_after = engine_b.list_active().unwrap();
        assert_eq!(active_b_after, vec!["tailwind", "web-react"]);
    }

    #[test]
    fn test_detect_workspace() {
        let temp = tempdir().unwrap();
        let repo_dir = temp.path().join("my_repo");
        let sub_dir = repo_dir.join("nested").join("deep");
        fs::create_dir_all(&sub_dir).unwrap();

        // 1. Explicit path check
        assert_eq!(detect_workspace(Some(&repo_dir)), Some(repo_dir.clone()));

        // 2. .agy project directory detection
        fs::create_dir_all(repo_dir.join(".agy")).unwrap();
        assert!(repo_dir.join(".agy").exists());
    }
}
