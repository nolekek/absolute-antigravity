use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

pub const DEFAULT_MODEL: &str = "gemini-3.8-flash-high";
pub const DEFAULT_ENDPOINT_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

#[derive(Error, Debug)]
pub enum ApiError {
    #[error("HTTP request error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("API error (code {code:?}): {message}")]
    Api {
        code: Option<i64>,
        message: String,
        status: Option<String>,
    },
    #[error("Authentication error: {0}")]
    Auth(String),
    #[error("Invalid request: {0}")]
    InvalidRequest(String),
    #[error("Stream error: {0}")]
    Stream(String),
    #[error("Language server error: {0}")]
    LanguageServer(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: String, // "user" or "model"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageServerSession {
    pub port: u16,
    pub csrf: String,
    #[serde(default)]
    pub pid: Option<u32>,
}

/// Maps user-facing model names or aliases to Antigravity's internal planner model enums.
pub fn map_to_antigravity_model(model: &str) -> &'static str {
    let lower = model.to_lowercase();
    let clean = lower.trim().trim_start_matches("models/");

    match clean {
        "gemini-3.8-flash-high" | "flash" | "fast" | "3.8" | "flash-high" => "MODEL_PLACEHOLDER_M318",
        "gemini-2.5-pro" | "pro" | "deep" | "2.5-pro" => "MODEL_GOOGLE_GEMINI_2_5_PRO",
        "claude-sonnet-4-6" | "sonnet" | "claude-sonnet" => "MODEL_PLACEHOLDER_M35",
        "claude-opus-4-6-thinking" | "opus" | "claude-opus" => "MODEL_PLACEHOLDER_M26",
        "gemini-2.5-flash" | "flash-lite" | "lite" => "MODEL_GOOGLE_GEMINI_2_5_FLASH",
        "gemini-3.8-flash-medium" => "MODEL_PLACEHOLDER_M319",
        "gemini-3.8-flash-low" => "MODEL_PLACEHOLDER_M320",
        // Direct pass-through if already in internal format
        m if m.starts_with("model_") => match m {
            "model_placeholder_m318" => "MODEL_PLACEHOLDER_M318",
            "model_google_gemini_2_5_pro" => "MODEL_GOOGLE_GEMINI_2_5_PRO",
            "model_placeholder_m35" => "MODEL_PLACEHOLDER_M35",
            "model_placeholder_m26" => "MODEL_PLACEHOLDER_M26",
            "model_google_gemini_2_5_flash" => "MODEL_GOOGLE_GEMINI_2_5_FLASH",
            _ => "MODEL_PLACEHOLDER_M318",
        },
        _ => "MODEL_PLACEHOLDER_M318",
    }
}

/// Discovers an active Antigravity Language Server session:
/// 1. Environment variables (`AGY_LS_PORT`, `JETSKI_LS_PORT`, `AGY_LS_CSRF`)
/// 2. Active session file: `~/.gemini/antigravity/active_session.json`
/// 3. OS process detection and log parsing
pub fn discover_language_server() -> Option<LanguageServerSession> {
    // 1. Env vars
    let env_port = std::env::var("AGY_LS_PORT")
        .or_else(|_| std::env::var("JETSKI_LS_PORT"))
        .ok()
        .and_then(|p| p.parse::<u16>().ok());
    let env_csrf = std::env::var("AGY_LS_CSRF").ok();

    if let (Some(port), Some(csrf)) = (env_port, env_csrf) {
        return Some(LanguageServerSession {
            port,
            csrf,
            pid: None,
        });
    }

    // 2. ~/.gemini/antigravity/active_session.json
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if !home.is_empty() {
        let session_file = PathBuf::from(&home)
            .join(".gemini")
            .join("antigravity")
            .join("active_session.json");
        if session_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&session_file) {
                if let Ok(session) = serde_json::from_str::<LanguageServerSession>(&content) {
                    if session.port > 0 && !session.csrf.is_empty() {
                        return Some(session);
                    }
                }
            }
        }
    }

    // 3. Fallback: Parse logs or process commandline if available
    discover_from_logs_and_process(&home)
}

fn discover_from_logs_and_process(home: &str) -> Option<LanguageServerSession> {
    if home.is_empty() {
        return None;
    }

    let mut port = None;
    let candidates = [
        PathBuf::from(home).join("AppData").join("Roaming").join("Antigravity").join("logs").join("language_server.log"),
        PathBuf::from(home).join(".gemini").join("antigravity").join("language_server.log"),
    ];

    for log_path in &candidates {
        if log_path.exists() {
            if let Ok(content) = std::fs::read_to_string(log_path) {
                let re = regex::Regex::new(r"listening on (?:\w+ )?port at (\d+) for HTTP\b").ok()?;
                for line in content.lines() {
                    if let Some(caps) = re.captures(line) {
                        if let Some(p) = caps.get(1).and_then(|m| m.as_str().parse::<u16>().ok()) {
                            port = Some(p);
                        }
                    }
                }
            }
        }
        if port.is_some() {
            break;
        }
    }

    let resolved_port = port?;

    // Attempt to extract csrf from running process
    let csrf = extract_csrf_from_process()?;

    Some(LanguageServerSession {
        port: resolved_port,
        csrf,
        pid: None,
    })
}

#[cfg(windows)]
fn extract_csrf_from_process() -> Option<String> {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name like 'language_server%'\" | Select-Object -ExpandProperty CommandLine",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let re = regex::Regex::new(r"--csrf_token\s+([a-f0-9\-]+)").ok()?;
    re.captures(&text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

#[cfg(not(windows))]
fn extract_csrf_from_process() -> Option<String> {
    let re = regex::Regex::new(r"--csrf_token[\x00\s]+([a-f0-9\-]+)").ok()?;
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let path = entry.path().join("cmdline");
            if path.exists() {
                if let Ok(bytes) = std::fs::read(&path) {
                    let text = String::from_utf8_lossy(&bytes);
                    if text.contains("language_server") && text.contains("--csrf_token") {
                        if let Some(caps) = re.captures(&text) {
                            if let Some(c) = caps.get(1) {
                                return Some(c.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// External Gemini Fallback Request Structs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct GeminiGenerateContentRequest<'a> {
    #[serde(rename = "systemInstruction", skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiSystemInstruction<'a>>,
    contents: Vec<GeminiContent<'a>>,
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Debug, Serialize)]
struct GeminiSystemInstruction<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiContent<'a> {
    role: &'a str,
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Debug, Serialize)]
struct GeminiGenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiStreamChunk {
    pub candidates: Option<Vec<Candidate>>,
    pub error: Option<GeminiErrorPayload>,
}

#[derive(Debug, Deserialize)]
pub struct Candidate {
    pub content: Option<ContentResponse>,
    #[serde(rename = "finishReason")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ContentResponse {
    pub role: Option<String>,
    pub parts: Option<Vec<PartResponse>>,
}

#[derive(Debug, Deserialize)]
pub struct PartResponse {
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiErrorPayload {
    pub code: Option<i64>,
    pub message: Option<String>,
    pub status: Option<String>,
}

// ---------------------------------------------------------------------------
// Primary Antigravity Client
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct AntigravityClient {
    client: reqwest::Client,
    pub model: String,
    pub auth_token: Option<String>,
    pub api_key: Option<String>,
    pub endpoint_base: String,
    pub ls_session: Option<LanguageServerSession>,
}

/// Backwards compatible alias for existing imports
pub type GeminiClient = AntigravityClient;

impl AntigravityClient {
    /// Create a new AntigravityClient with optional model and token or API key.
    pub fn new(model: Option<String>, token_or_key: Option<String>) -> Self {
        let clean_model = model
            .filter(|m| !m.trim().is_empty())
            .or_else(|| std::env::var("AGY_MODEL").ok().filter(|m| !m.trim().is_empty()))
            .unwrap_or_else(|| DEFAULT_MODEL.to_string());

        let mut auth_token = None;
        let mut api_key = None;

        if let Some(tok) = token_or_key.filter(|t| !t.trim().is_empty()) {
            if tok.starts_with("AIza") {
                api_key = Some(tok);
            } else {
                auth_token = Some(tok);
            }
        }

        // Check environment variables if neither token nor key was provided
        if auth_token.is_none() && api_key.is_none() {
            if let Ok(key) = std::env::var("GEMINI_API_KEY")
                .or_else(|_| std::env::var("AGY_API_KEY"))
                .or_else(|_| std::env::var("GOOGLE_API_KEY"))
            {
                let trimmed = key.trim();
                if !trimmed.is_empty() {
                    if trimmed.starts_with("AIza") {
                        api_key = Some(trimmed.to_string());
                    } else {
                        auth_token = Some(trimmed.to_string());
                    }
                }
            }
        }

        let ls_session = discover_language_server();

        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            model: clean_model,
            auth_token,
            api_key,
            endpoint_base: DEFAULT_ENDPOINT_BASE.to_string(),
            ls_session,
        }
    }

    /// Instantiate client resolved from account slot and optional model
    pub fn from_slot(slot: Option<u32>, model: Option<String>) -> Self {
        let mgr = crate::credentials::CredentialManager::default_manager();
        let target_slot = slot.unwrap_or_else(|| {
            let (s, _) = mgr.resolve_slot(None, None).unwrap_or((1, crate::credentials::SlotResolutionSource::GlobalActive));
            s
        });

        let token_res = mgr.get_token_for_slot(target_slot);
        let token = token_res.ok();

        Self::new(model, token)
    }

    pub fn without_language_server(mut self) -> Self {
        self.ls_session = None;
        self
    }

    pub fn with_language_server(mut self, port: u16, csrf: String) -> Self {
        self.ls_session = Some(LanguageServerSession {
            port,
            csrf,
            pid: None,
        });
        self
    }

    pub fn with_model(mut self, model: String) -> Self {
        self.model = model;
        self
    }

    pub fn with_endpoint_base(mut self, endpoint: String) -> Self {
        self.endpoint_base = endpoint.trim_end_matches('/').to_string();
        self
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn endpoint_base(&self) -> &str {
        &self.endpoint_base
    }

    pub fn is_authenticated(&self) -> bool {
        self.ls_session.is_some() || self.auth_token.is_some() || self.api_key.is_some()
    }

    /// Perform streaming generation.
    /// If an active Antigravity Language Server session is detected, routes directly
    /// through the native Antigravity Cascade Agent API.
    /// If an external AI Studio API key is provided and LS is unavailable, falls back
    /// to Google Gemini AI Studio SSE endpoint.
    pub async fn stream_generate<F>(
        &self,
        prompt: &str,
        history: &[ChatMessage],
        system_prompt: Option<&str>,
        on_chunk: F,
    ) -> Result<String, ApiError>
    where
        F: FnMut(&str) + Send,
    {
        // 1. If custom endpoint_base is explicitly configured (e.g. test mock server or proxy), use fallback endpoint
        if self.endpoint_base != DEFAULT_ENDPOINT_BASE {
            return self
                .stream_generate_gemini_fallback(prompt, history, system_prompt, on_chunk)
                .await;
        }

        // 2. Native Antigravity Language Server Path
        if let Some(ref ls) = self.ls_session {
            return self
                .stream_generate_language_server(ls, prompt, history, system_prompt, on_chunk)
                .await;
        }

        // 3. Fallback: External Google Gemini AI Studio SSE endpoint
        self.stream_generate_gemini_fallback(prompt, history, system_prompt, on_chunk)
            .await
    }

    /// Native Antigravity Cascade Protocol implementation over local Language Server Connect/HTTP RPC.
    async fn stream_generate_language_server<F>(
        &self,
        ls: &LanguageServerSession,
        prompt: &str,
        history: &[ChatMessage],
        system_prompt: Option<&str>,
        mut on_chunk: F,
    ) -> Result<String, ApiError>
    where
        F: FnMut(&str) + Send,
    {
        let mapped_model = map_to_antigravity_model(&self.model);

        // Step 1: Start Cascade
        let start_url = format!(
            "http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/StartCascade",
            ls.port
        );
        let start_body = serde_json::json!({
            "source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
            "metadata": {
                "ideName": "antigravity",
                "ideVersion": "2.28.2"
            }
        });

        let start_resp = self
            .client
            .post(&start_url)
            .header("Content-Type", "application/json")
            .header("x-codeium-csrf-token", &ls.csrf)
            .json(&start_body)
            .send()
            .await?;

        if !start_resp.status().is_success() {
            let err_txt = start_resp.text().await.unwrap_or_default();
            return Err(ApiError::LanguageServer(format!(
                "Failed to initialize Antigravity Cascade session: {}",
                err_txt
            )));
        }

        let start_json: serde_json::Value = start_resp.json().await?;
        let cascade_id = start_json
            .get("cascadeId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ApiError::LanguageServer("StartCascade did not return a valid cascadeId".to_string())
            })?;

        // Step 2: Compose Message Prompt (including system directives and history if provided)
        let mut final_text = String::new();
        if let Some(sys) = system_prompt.filter(|s| !s.trim().is_empty()) {
            final_text.push_str(&format!("[System Directives]\n{}\n\n", sys.trim()));
        }

        for msg in history {
            let role_label = match msg.role.as_str() {
                "model" | "assistant" => "Antigravity",
                _ => "User",
            };
            final_text.push_str(&format!("[{}]\n{}\n\n", role_label, msg.content.trim()));
        }

        final_text.push_str(prompt);

        // Step 3: Send User Message
        let send_url = format!(
            "http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
            ls.port
        );
        let send_body = serde_json::json!({
            "cascadeId": cascade_id,
            "items": [
                { "text": final_text }
            ],
            "cascadeConfig": {
                "plannerConfig": {
                    "planModel": mapped_model,
                    "useAiCredits": true
                }
            }
        });

        let send_resp = self
            .client
            .post(&send_url)
            .header("Content-Type", "application/json")
            .header("x-codeium-csrf-token", &ls.csrf)
            .json(&send_body)
            .send()
            .await?;

        if !send_resp.status().is_success() {
            let err_txt = send_resp.text().await.unwrap_or_default();
            return Err(ApiError::LanguageServer(format!(
                "Failed to deliver prompt to Antigravity Language Server: {}",
                err_txt
            )));
        }

        // Step 4: Poll trajectory steps for streaming response
        let steps_url = format!(
            "http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps",
            ls.port
        );
        let query_body = serde_json::json!({ "cascadeId": cascade_id });

        let mut seen_len = 0;
        let mut full_accumulated = String::new();
        let timeout = Duration::from_secs(180);
        let start_time = std::time::Instant::now();

        loop {
            if start_time.elapsed() > timeout {
                return Err(ApiError::Stream("Antigravity response timed out after 180s".to_string()));
            }

            tokio::time::sleep(Duration::from_millis(200)).await;

            let steps_resp = self
                .client
                .post(&steps_url)
                .header("Content-Type", "application/json")
                .header("x-codeium-csrf-token", &ls.csrf)
                .json(&query_body)
                .send()
                .await?;

            if !steps_resp.status().is_success() {
                continue;
            }

            let steps_json: serde_json::Value = steps_resp.json().await?;
            let steps = steps_json
                .get("steps")
                .and_then(|s| s.as_array())
                .cloned()
                .unwrap_or_default();

            let mut is_done = false;

            for step in &steps {
                let step_type = step.get("type").and_then(|t| t.as_str()).unwrap_or_default();

                if step_type == "CORTEX_STEP_TYPE_ERROR_MESSAGE" {
                    let err_obj = step.get("errorMessage").and_then(|e| e.get("error"));
                    let msg = err_obj
                        .and_then(|e| e.get("shortError").or_else(|| e.get("userErrorMessage")))
                        .and_then(|m| m.as_str())
                        .unwrap_or("Antigravity Agent error occurred");
                    return Err(ApiError::Api {
                        code: Some(500),
                        message: msg.to_string(),
                        status: Some("ANTIGRAVITY_AGENT_ERROR".to_string()),
                    });
                }

                if step_type == "CORTEX_STEP_TYPE_PLANNER_RESPONSE" {
                    let pr = step.get("plannerResponse");
                    let resp_str = pr
                        .and_then(|p| p.get("response").or_else(|| p.get("modifiedResponse")))
                        .and_then(|r| r.as_str())
                        .unwrap_or_default();

                    if resp_str.len() > seen_len {
                        let delta = &resp_str[seen_len..];
                        on_chunk(delta);
                        seen_len = resp_str.len();
                        full_accumulated = resp_str.to_string();
                    }

                    let status = step.get("status").and_then(|s| s.as_str()).unwrap_or_default();
                    if status == "CORTEX_STEP_STATUS_DONE" {
                        is_done = true;
                        break;
                    }
                }
            }

            if is_done {
                break;
            }
        }

        Ok(full_accumulated)
    }

    /// Legacy / Fallback streaming generation via Gemini SSE endpoint.
    async fn stream_generate_gemini_fallback<F>(
        &self,
        prompt: &str,
        history: &[ChatMessage],
        system_prompt: Option<&str>,
        mut on_chunk: F,
    ) -> Result<String, ApiError>
    where
        F: FnMut(&str) + Send,
    {
        if !self.is_authenticated() {
            return Err(ApiError::Auth(
                "No Antigravity Language Server running and no Gemini API key available. Start Antigravity IDE/CLI or set GEMINI_API_KEY.".to_string(),
            ));
        }

        let model_name = self.model.strip_prefix("models/").unwrap_or(&self.model);
        let url = format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            self.endpoint_base, model_name
        );

        let mut req = self.client.post(&url);

        if let Some(ref key) = self.api_key {
            req = req.header("x-goog-api-key", key);
        } else if let Some(ref token) = self.auth_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let mut contents = Vec::with_capacity(history.len() + 1);
        for msg in history {
            let role = match msg.role.as_str() {
                "model" | "assistant" => "model",
                _ => "user",
            };
            contents.push(GeminiContent {
                role,
                parts: vec![GeminiPart { text: &msg.content }],
            });
        }
        contents.push(GeminiContent {
            role: "user",
            parts: vec![GeminiPart { text: prompt }],
        });

        let system_instruction = system_prompt
            .filter(|s| !s.trim().is_empty())
            .map(|s| GeminiSystemInstruction {
                parts: vec![GeminiPart { text: s }],
            });

        let payload = GeminiGenerateContentRequest {
            system_instruction,
            contents,
            generation_config: Some(GeminiGenerationConfig {
                temperature: Some(0.7),
                max_output_tokens: Some(8192),
            }),
        };

        let response = req.json(&payload).send().await?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(err_obj) = err_val.get("error") {
                    let code = err_obj.get("code").and_then(|c| c.as_i64());
                    let message = err_obj
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or(&text)
                        .to_string();
                    let st = err_obj
                        .get("status")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                    return Err(ApiError::Api {
                        code,
                        message,
                        status: st,
                    });
                }
            }
            return Err(ApiError::Api {
                code: Some(status.as_u16() as i64),
                message: text,
                status: None,
            });
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut accumulated_text = String::new();

        while let Some(item) = stream.next().await {
            let chunk = item?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                let json_data = if let Some(d) = line.strip_prefix("data:") {
                    d.trim()
                } else if line.starts_with('{') {
                    line.as_str()
                } else {
                    continue;
                };

                if json_data.is_empty() || json_data == "[DONE]" {
                    continue;
                }

                match serde_json::from_str::<GeminiStreamChunk>(json_data) {
                    Ok(chunk_obj) => {
                        if let Some(err) = chunk_obj.error {
                            return Err(ApiError::Api {
                                code: err.code,
                                message: err
                                    .message
                                    .unwrap_or_else(|| "Unknown API error in stream".to_string()),
                                status: err.status,
                            });
                        }

                        if let Some(candidates) = chunk_obj.candidates {
                            for candidate in candidates {
                                if let Some(content) = candidate.content {
                                    if let Some(parts) = content.parts {
                                        for part in parts {
                                            if let Some(t) = part.text {
                                                if !t.is_empty() {
                                                    on_chunk(&t);
                                                    accumulated_text.push_str(&t);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::debug!("Failed to parse stream chunk: {} ({})", e, json_data);
                    }
                }
            }
        }

        // Process any trailing line without trailing newline
        let remaining = buffer.trim();
        if !remaining.is_empty() {
            let json_data = if let Some(d) = remaining.strip_prefix("data:") {
                d.trim()
            } else if remaining.starts_with('{') {
                remaining
            } else {
                ""
            };

            if !json_data.is_empty() && json_data != "[DONE]" {
                if let Ok(chunk_obj) = serde_json::from_str::<GeminiStreamChunk>(json_data) {
                    if let Some(candidates) = chunk_obj.candidates {
                        for candidate in candidates {
                            if let Some(content) = candidate.content {
                                if let Some(parts) = content.parts {
                                    for part in parts {
                                        if let Some(t) = part.text {
                                            if !t.is_empty() {
                                                on_chunk(&t);
                                                accumulated_text.push_str(&t);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(accumulated_text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation_defaults() {
        let client = AntigravityClient::new(None, Some("test-token".to_string()));
        assert_eq!(client.model(), DEFAULT_MODEL);
        assert_eq!(client.endpoint_base(), DEFAULT_ENDPOINT_BASE);
        assert!(client.is_authenticated());
        assert_eq!(client.auth_token, Some("test-token".to_string()));
        assert!(client.api_key.is_none());
    }

    #[test]
    fn test_api_key_detection() {
        let client = AntigravityClient::new(
            Some("gemini-1.5-pro".to_string()),
            Some("AIzaSyDummyKey123".to_string()),
        );
        assert_eq!(client.model(), "gemini-1.5-pro");
        assert!(client.auth_token.is_none());
        assert_eq!(client.api_key, Some("AIzaSyDummyKey123".to_string()));
    }

    #[test]
    fn test_antigravity_model_mapping() {
        assert_eq!(map_to_antigravity_model("gemini-3.8-flash-high"), "MODEL_PLACEHOLDER_M318");
        assert_eq!(map_to_antigravity_model("flash"), "MODEL_PLACEHOLDER_M318");
        assert_eq!(map_to_antigravity_model("fast"), "MODEL_PLACEHOLDER_M318");
        assert_eq!(map_to_antigravity_model("gemini-2.5-pro"), "MODEL_GOOGLE_GEMINI_2_5_PRO");
        assert_eq!(map_to_antigravity_model("pro"), "MODEL_GOOGLE_GEMINI_2_5_PRO");
        assert_eq!(map_to_antigravity_model("claude-sonnet-4-6"), "MODEL_PLACEHOLDER_M35");
        assert_eq!(map_to_antigravity_model("sonnet"), "MODEL_PLACEHOLDER_M35");
        assert_eq!(map_to_antigravity_model("claude-opus-4-6-thinking"), "MODEL_PLACEHOLDER_M26");
        assert_eq!(map_to_antigravity_model("opus"), "MODEL_PLACEHOLDER_M26");
        assert_eq!(map_to_antigravity_model("gemini-2.5-flash"), "MODEL_GOOGLE_GEMINI_2_5_FLASH");
        assert_eq!(map_to_antigravity_model("unknown-custom"), "MODEL_PLACEHOLDER_M318");
    }

    #[test]
    fn test_stream_chunk_deserialization() {
        let sse_data = r#"{"candidates":[{"content":{"parts":[{"text":"Hello, world!"}],"role":"model"}}]}"#;
        let chunk: GeminiStreamChunk = serde_json::from_str(sse_data).unwrap();
        let candidates = chunk.candidates.unwrap();
        assert_eq!(candidates.len(), 1);
        let parts = candidates[0].content.as_ref().unwrap().parts.as_ref().unwrap();
        assert_eq!(parts[0].text.as_deref(), Some("Hello, world!"));
    }

    #[tokio::test]
    async fn test_mock_stream_generation() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local_addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut req_buf = vec![0u8; 2048];
                let _ = socket.read(&mut req_buf).await;

                let sse_body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello \"}]}}]}\n\n\
                                data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"from \"}]}}]}\n\n\
                                data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Antigravity!\"}]}}]}\n\n\
                                data: [DONE]\n\n";

                let resp = format!(
                    "HTTP/1.1 200 OK\r\n\
                    Content-Type: text/event-stream\r\n\
                    Content-Length: {}\r\n\
                    Connection: close\r\n\r\n{}",
                    sse_body.len(),
                    sse_body
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            }
        });

        let mut client = AntigravityClient::new(
            Some("gemini-2.0-flash".to_string()),
            Some("test-token".to_string()),
        )
        .with_endpoint_base(format!("http://{}", local_addr));
        // Force fallback to test the SSE mock listener
        client.ls_session = None;

        let mut received = Vec::new();
        let full = client
            .stream_generate("Hi", &[], None, |chunk| {
                received.push(chunk.to_string());
            })
            .await
            .unwrap();

        assert_eq!(full, "Hello from Antigravity!");
        assert_eq!(received, vec!["Hello ", "from ", "Antigravity!"]);
    }
}
