use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEFAULT_MODEL: &str = "gemini-2.0-flash";
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: String, // "user" or "model"
    pub content: String,
}

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

#[derive(Clone, Debug)]
pub struct GeminiClient {
    client: reqwest::Client,
    model: String,
    auth_token: Option<String>,
    api_key: Option<String>,
    endpoint_base: String,
}

impl GeminiClient {
    /// Create a new GeminiClient with optional model and token or API key.
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

        // If no token or key provided directly, check environment variables
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

        Self {
            client: reqwest::Client::builder().build().unwrap_or_default(),
            model: clean_model,
            auth_token,
            api_key,
            endpoint_base: DEFAULT_ENDPOINT_BASE.to_string(),
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
        self.auth_token.is_some() || self.api_key.is_some()
    }

    /// Perform streaming generation via Gemini SSE endpoint.
    /// Calls `on_chunk` callback for each text delta as it arrives.
    /// Returns the complete accumulated response text.
    pub async fn stream_generate<F>(
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
                "No Gemini API key or Bearer token available. Run 'agy account add' to configure an account, or set GEMINI_API_KEY environment variable.".to_string(),
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
        let client = GeminiClient::new(None, Some("test-token".to_string()));
        assert_eq!(client.model(), "gemini-2.0-flash");
        assert_eq!(client.endpoint_base(), DEFAULT_ENDPOINT_BASE);
        assert!(client.is_authenticated());
        assert_eq!(client.auth_token, Some("test-token".to_string()));
        assert!(client.api_key.is_none());
    }

    #[test]
    fn test_api_key_detection() {
        let client = GeminiClient::new(
            Some("gemini-1.5-pro".to_string()),
            Some("AIzaSyDummyKey123".to_string()),
        );
        assert_eq!(client.model(), "gemini-1.5-pro");
        assert!(client.auth_token.is_none());
        assert_eq!(client.api_key, Some("AIzaSyDummyKey123".to_string()));
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
                                data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Gemini!\"}]}}]}\n\n\
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

        let client = GeminiClient::new(
            Some("gemini-2.0-flash".to_string()),
            Some("test-token".to_string()),
        )
        .with_endpoint_base(format!("http://{}", local_addr));

        let mut received = Vec::new();
        let full = client
            .stream_generate("Hi", &[], None, |chunk| {
                received.push(chunk.to_string());
            })
            .await
            .unwrap();

        assert_eq!(full, "Hello from Gemini!");
        assert_eq!(received, vec!["Hello ", "from ", "Gemini!"]);
    }
}
