use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub const WINDOWS_PIPE_NAME: &str = r"\\.\pipe\antigravity-ipc";
pub const UNIX_SOCKET_PATH: &str = "/tmp/antigravity-ipc.sock";

#[derive(Error, Debug)]
pub enum IpcError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("IPC communication error: {0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "method", content = "params")]
pub enum IpcRequest {
    #[serde(rename = "preset.switch")]
    PresetSwitch {
        name: String,
        #[serde(default)]
        overlays: Vec<String>,
        #[serde(default)]
        workspace: Option<PathBuf>,
    },
    #[serde(rename = "preset.list")]
    PresetList,
    #[serde(rename = "preset.current")]
    PresetCurrent {
        #[serde(default)]
        workspace: Option<PathBuf>,
    },

    #[serde(rename = "account.status")]
    AccountStatus,
    #[serde(rename = "account.rotate")]
    AccountRotate {
        #[serde(default)]
        slot: Option<u32>,
    },
    #[serde(rename = "account.prepare_add")]
    AccountPrepareAdd,
    #[serde(rename = "account.finalize_add")]
    AccountFinalizeAdd,
    #[serde(rename = "account.delete")]
    AccountDelete { slot: u32 },

    #[serde(rename = "daemon.status")]
    DaemonStatus,
    #[serde(rename = "daemon.stop")]
    DaemonStop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum IpcResponse {
    Success { data: serde_json::Value },
    Error { error: String },
}

impl IpcResponse {
    pub fn ok<T: Serialize>(value: T) -> Result<Self, IpcError> {
        let val = serde_json::to_value(value)?;
        Ok(IpcResponse::Success { data: val })
    }

    pub fn err(message: impl Into<String>) -> Self {
        IpcResponse::Error {
            error: message.into(),
        }
    }
}

/// Normalizes an IPC path or pipe name depending on OS
pub fn normalize_ipc_path(path: &str) -> String {
    #[cfg(windows)]
    {
        if !path.starts_with(r"\\.\pipe\") {
            return format!(r"\\.\pipe\{}", path);
        }
    }
    path.to_string()
}

pub fn get_default_ipc_path() -> String {
    if let Ok(custom) = std::env::var("AGY_SOCKET") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return normalize_ipc_path(trimmed);
        }
    }
    #[cfg(windows)]
    {
        WINDOWS_PIPE_NAME.to_string()
    }
    #[cfg(not(windows))]
    {
        if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
            let p = PathBuf::from(dir).join("agy.sock");
            return p.to_string_lossy().to_string();
        }
        UNIX_SOCKET_PATH.to_string()
    }
}

/// Helper function to send an IPC request and receive response over any AsyncRead + AsyncWrite stream
pub async fn send_ipc_request<S>(stream: &mut S, request: &IpcRequest) -> Result<IpcResponse, IpcError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut payload = serde_json::to_string(request)?;
    payload.push('\n');
    stream.write_all(payload.as_bytes()).await?;
    stream.flush().await?;

    let mut reader = BufReader::new(stream);
    let mut response_line = String::new();
    reader.read_line(&mut response_line).await?;

    if response_line.trim().is_empty() {
        return Err(IpcError::Message("Empty response received from IPC server".to_string()));
    }

    let response: IpcResponse = serde_json::from_str(&response_line)?;
    Ok(response)
}

/// Helper to read a single line of request from an IPC stream
pub async fn read_ipc_request<R>(reader: &mut R) -> Result<Option<IpcRequest>, IpcError>
where
    R: AsyncBufReadExt + Unpin,
{
    let mut line = String::new();
    let n = reader.read_line(&mut line).await?;
    if n == 0 || line.trim().is_empty() {
        return Ok(None);
    }
    let req: IpcRequest = serde_json::from_str(&line)?;
    Ok(Some(req))
}

/// Helper to write an IPC response
pub async fn write_ipc_response<W>(writer: &mut W, response: &IpcResponse) -> Result<(), IpcError>
where
    W: AsyncWriteExt + Unpin,
{
    let mut payload = serde_json::to_string(response)?;
    payload.push('\n');
    writer.write_all(payload.as_bytes()).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn test_ipc_serialization_roundtrip() {
        let (mut client, mut server) = duplex(1024);

        let req = IpcRequest::PresetSwitch {
            name: "backend".to_string(),
            overlays: vec!["qa".to_string()],
            workspace: None,
        };

        let server_task = tokio::spawn(async move {
            let mut reader = BufReader::new(&mut server);
            let received = read_ipc_request(&mut reader).await.unwrap().unwrap();
            assert_eq!(
                received,
                IpcRequest::PresetSwitch {
                    name: "backend".to_string(),
                    overlays: vec!["qa".to_string()],
                    workspace: None,
                }
            );

            let res = IpcResponse::ok(serde_json::json!({ "status": "switched" })).unwrap();
            write_ipc_response(&mut server, &res).await.unwrap();
        });

        let resp = send_ipc_request(&mut client, &req).await.unwrap();
        server_task.await.unwrap();

        match resp {
            IpcResponse::Success { data } => {
                assert_eq!(data["status"], "switched");
            }
            IpcResponse::Error { error } => panic!("Expected success, got error: {}", error),
        }
    }
}
