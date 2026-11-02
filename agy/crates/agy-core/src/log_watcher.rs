use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use regex::Regex;
use thiserror::Error;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

#[derive(Error, Debug)]
pub enum LogWatcherError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),
}

pub const DEFAULT_QUOTA_REGEX: &str =
    r"(?i)(?:rpc error: code = ResourceExhausted|status:\s*429|RESOURCE_EXHAUSTED.*quota|Quota exceeded for quota metric|generativelanguage.*429)";

pub const DEFAULT_DEBOUNCE_SECS: u64 = 25;

#[derive(Debug, Clone)]
pub struct QuotaTriggerEvent {
    pub matched_line: String,
    pub timestamp: Instant,
    pub file_path: PathBuf,
}

pub struct LogTailWatcher {
    pub log_path: PathBuf,
    pub regex: Regex,
    pub debounce: Duration,
    pub last_trigger: Option<Instant>,
    pub file_pos: u64,
    pub line_buffer: String,
}

impl LogTailWatcher {
    pub fn new(log_path: PathBuf) -> Result<Self, LogWatcherError> {
        Self::with_options(log_path, DEFAULT_QUOTA_REGEX, Duration::from_secs(DEFAULT_DEBOUNCE_SECS))
    }

    pub fn with_options(
        log_path: PathBuf,
        pattern: &str,
        debounce: Duration,
    ) -> Result<Self, LogWatcherError> {
        let regex = Regex::new(pattern)?;
        Ok(Self {
            log_path,
            regex,
            debounce,
            last_trigger: None,
            file_pos: 0,
            line_buffer: String::new(),
        })
    }

    pub fn discover_default_log_path() -> Option<PathBuf> {
        if let Some(home) = crate::presets::dirs_home() {
            // Check AppData\Roaming\Antigravity\logs\language_server.log
            let candidate1 = home
                .join("AppData")
                .join("Roaming")
                .join("Antigravity")
                .join("logs")
                .join("language_server.log");
            if candidate1.exists() {
                return Some(candidate1);
            }

            // Check AppData\Roaming\antigravity\logs\language_server.log
            let candidate2 = home
                .join("AppData")
                .join("Roaming")
                .join("antigravity")
                .join("logs")
                .join("language_server.log");
            if candidate2.exists() {
                return Some(candidate2);
            }

            // Check ~/.gemini/antigravity/logs/language_server.log
            let candidate3 = home
                .join(".gemini")
                .join("antigravity")
                .join("logs")
                .join("language_server.log");
            if candidate3.exists() {
                return Some(candidate3);
            }
        }
        None
    }

    fn open_shared_file(&self) -> std::io::Result<File> {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);

        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // FILE_SHARE_READ (1) | FILE_SHARE_WRITE (2) | FILE_SHARE_DELETE (4) = 7
            options.share_mode(7);
        }

        options.open(&self.log_path)
    }

    /// Seeks to the end of the file so we only tail new lines going forward
    pub fn seek_to_end(&mut self) -> std::io::Result<()> {
        if let Ok(mut file) = self.open_shared_file() {
            self.file_pos = file.seek(SeekFrom::End(0))?;
        }
        Ok(())
    }

    /// Inspects a single log line against the quota error regex with debounce
    pub fn check_line(&mut self, line: &str) -> Option<QuotaTriggerEvent> {
        if self.regex.is_match(line) {
            let now = Instant::now();
            if let Some(last) = self.last_trigger {
                if now.duration_since(last) < self.debounce {
                    debug!("Quota error matched but suppressed by debounce: {}", line);
                    return None;
                }
            }
            self.last_trigger = Some(now);
            info!("Quota error detected in LS log: {}", line);
            return Some(QuotaTriggerEvent {
                matched_line: line.to_string(),
                timestamp: now,
                file_path: self.log_path.clone(),
            });
        }
        None
    }

    /// Single poll step: reads any newly appended bytes, parses lines, checks for quota error
    pub fn poll_once(&mut self) -> Option<QuotaTriggerEvent> {
        let mut file = match self.open_shared_file() {
            Ok(f) => f,
            Err(_) => return None,
        };

        let metadata = match file.metadata() {
            Ok(m) => m,
            Err(_) => return None,
        };

        let len = metadata.len();
        // Handle log rotation or truncation
        if len < self.file_pos {
            self.file_pos = 0;
            self.line_buffer.clear();
        }

        if len == self.file_pos {
            return None;
        }

        if file.seek(SeekFrom::Start(self.file_pos)).is_err() {
            return None;
        }

        let bytes_to_read = (len - self.file_pos) as usize;
        let mut buffer = vec![0u8; bytes_to_read];
        if file.read_exact(&mut buffer).is_err() {
            return None;
        }

        self.file_pos = len;

        let text = String::from_utf8_lossy(&buffer);
        self.line_buffer.push_str(&text);

        let mut trigger_event = None;

        while let Some(pos) = self.line_buffer.find('\n') {
            let line = self.line_buffer[..pos].trim_end_matches('\r').to_string();
            self.line_buffer = self.line_buffer[pos + 1..].to_string();

            if trigger_event.is_none() {
                if let Some(evt) = self.check_line(&line) {
                    trigger_event = Some(evt);
                }
            }
        }

        trigger_event
    }

    /// Spawns an asynchronous tail loop in a background tokio task
    pub fn spawn_watcher(
        mut self,
        poll_interval: Duration,
        tx: mpsc::Sender<QuotaTriggerEvent>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(poll_interval);
            loop {
                interval.tick().await;
                if let Some(evt) = self.poll_once() {
                    if tx.send(evt).await.is_err() {
                        warn!("LogWatcher receiver dropped, stopping watcher loop");
                        break;
                    }
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_regex_matching() {
        let mut watcher = LogTailWatcher::with_options(
            PathBuf::from("dummy.log"),
            DEFAULT_QUOTA_REGEX,
            Duration::from_millis(50),
        )
        .unwrap();

        assert!(watcher.check_line("normal log line: server started").is_none());
        assert!(watcher
            .check_line("error: rpc error: code = ResourceExhausted desc = Quota exceeded")
            .is_some());

        // Immediately second match must be debounced
        assert!(watcher
            .check_line("status: 429 Too Many Requests")
            .is_none());

        // Wait for debounce
        std::thread::sleep(Duration::from_millis(70));
        assert!(watcher
            .check_line("status: 429 Too Many Requests")
            .is_some());
    }

    #[test]
    fn test_poll_once_tailing() {
        let mut temp = NamedTempFile::new().unwrap();
        let path = temp.path().to_path_buf();

        let mut watcher = LogTailWatcher::with_options(
            path.clone(),
            DEFAULT_QUOTA_REGEX,
            Duration::from_secs(10),
        )
        .unwrap();

        // Write initial lines
        writeln!(temp, "2026-11-02 [INFO] Language server started").unwrap();
        temp.flush().unwrap();

        assert!(watcher.poll_once().is_none());

        // Write a quota error line
        writeln!(
            temp,
            "2026-11-02 [ERROR] rpc error: code = ResourceExhausted: rate limit hit"
        )
        .unwrap();
        temp.flush().unwrap();

        let evt = watcher.poll_once();
        assert!(evt.is_some());
        assert!(evt
            .unwrap()
            .matched_line
            .contains("ResourceExhausted"));

        // Another line - should be debounced
        writeln!(temp, "generativelanguage 429 quota").unwrap();
        temp.flush().unwrap();
        assert!(watcher.poll_once().is_none());
    }
}
