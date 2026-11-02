use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::time::{Duration, Instant};

use agy_core::credentials::{
    CredentialManager, CredentialStorage, MemoryCredentialStorage, TARGET_ACTIVE,
};
use agy_core::log_watcher::{LogTailWatcher, DEFAULT_QUOTA_REGEX};
use agy_core::presets::PresetManager;
use agy_core::symlink::SymlinkEngine;

#[test]
fn test_all_16_presets_and_always_active() {
    let mgr = PresetManager::load_default();
    let expected_presets = [
        "web",
        "backend",
        "devops",
        "appsec",
        "qa",
        "ai-agents",
        "web-research",
        "reverse-engineering",
        "product",
        "orchestrator",
        "systems",
        "vst3",
        "hardware",
        "media",
        "meta-dev",
        "minimal",
    ];

    assert_eq!(mgr.manifest.presets.len(), 16);

    let always_active = [
        "agent-preset-conductor",
        "grill-me",
        "systematic-debugging",
        "verification-before-completion",
        "concise-planning",
    ];

    for p in expected_presets {
        let res = mgr.resolve_active_skills(p, &[]).unwrap();
        assert_eq!(res.base, p);
        for aa in always_active {
            assert!(
                res.active_skills.contains(aa),
                "Preset '{}' missing always-active skill '{}'",
                p,
                aa
            );
        }
    }
}

#[test]
fn test_composite_overlays_syntax() {
    let mgr = PresetManager::load_default();

    // Test with + prefix, uppercase, whitespace
    let overlays = vec![
        "+QA".to_string(),
        "  +devops  ".to_string(),
        "custom-isolated-skill".to_string(),
    ];
    let res = mgr.resolve_active_skills("web", &overlays).unwrap();

    assert_eq!(res.base, "web");
    assert!(res.active_skills.contains("react-best-practices")); // from web
    assert!(res.active_skills.contains("playwright-e2e-guru")); // from QA
    assert!(res.active_skills.contains("docker-container-master")); // from devops
    assert!(res.active_skills.contains("custom-isolated-skill")); // direct skill
    assert!(res.active_skills.contains("grill-me")); // always active
}

#[test]
fn test_symlink_performance_and_isolation() {
    let temp = tempfile::tempdir().unwrap();
    let lib_dir = temp.path().join("library");
    let active_dir = temp.path().join("active");
    fs::create_dir_all(&lib_dir).unwrap();
    fs::create_dir_all(&active_dir).unwrap();

    // Create 30 mock skills in library
    let mut all_skills = Vec::new();
    for i in 1..=30 {
        let id = format!("mock-skill-{:02}", i);
        let s_dir = lib_dir.join(&id);
        fs::create_dir_all(&s_dir).unwrap();
        fs::write(s_dir.join("SKILL.md"), format!("# Skill {}", i)).unwrap();
        all_skills.push(id);
    }

    let engine = SymlinkEngine::new(lib_dir.clone(), active_dir.clone());

    // Switch 1: activate first 15 skills
    let set1: BTreeSet<String> = all_skills[..15].iter().cloned().collect();
    let start1 = Instant::now();
    let rep1 = engine.sync_skills(&set1).unwrap();
    let dur1 = start1.elapsed();

    assert_eq!(rep1.added.len(), 15);
    assert_eq!(rep1.removed.len(), 0);
    assert_eq!(rep1.kept.len(), 0);
    assert!(dur1.as_millis() < 250, "Switching 15 skills took too long: {:?}", dur1);

    // Verify all 15 are accessible
    for s in &all_skills[..15] {
        assert!(active_dir.join(s).join("SKILL.md").exists());
    }

    // Switch 2: shift to skills 10..25 (10..15 kept, 1..9 removed, 16..25 added)
    let set2: BTreeSet<String> = all_skills[9..25].iter().cloned().collect();
    let rep2 = engine.sync_skills(&set2).unwrap();

    assert_eq!(rep2.kept.len(), 6); // 10..15
    assert_eq!(rep2.removed.len(), 9); // 1..9
    assert_eq!(rep2.added.len(), 10); // 16..25

    // Switch 3: clear all (empty set)
    let set3: BTreeSet<String> = BTreeSet::new();
    let rep3 = engine.sync_skills(&set3).unwrap();
    assert_eq!(rep3.removed.len(), 16);
    assert_eq!(rep3.added.len(), 0);

    let remaining = engine.list_active().unwrap();
    assert!(remaining.is_empty());

    // CRITICAL INVARIANT: Library skills must NEVER be affected
    for i in 1..=30 {
        let s_file = lib_dir.join(format!("mock-skill-{:02}", i)).join("SKILL.md");
        assert!(s_file.exists(), "Original library skill file was damaged: {:?}", s_file);
    }
}

#[test]
fn test_credentials_pool_lifecycle_and_compaction() {
    let temp = tempfile::tempdir().unwrap();
    let cfg_path = temp.path().join("accounts_cfg.json");
    let storage = Box::new(MemoryCredentialStorage::new());

    // Setup 5 accounts
    for i in 1..=5 {
        let target = format!("gemini:antigravity_slot_{}", i);
        let blob = format!(r#"{{"email": "user{}@domain.com", "token": "tok_{}"}}"#, i, i);
        storage.write(&target, &blob, "test");
    }
    storage.write(
        TARGET_ACTIVE,
        r#"{"email": "user3@domain.com", "token": "tok_3"}"#,
        "test",
    );

    let mgr = CredentialManager::new(storage, cfg_path);

    // Initial status
    let status = mgr.get_status().unwrap();
    assert_eq!(status.slots_count, 5);
    assert_eq!(status.active_slot, 3);
    assert_eq!(status.current_email, Some("user3@domain.com".to_string()));

    // Delete active slot 3 -> zero-gap compaction: 1, 2, 4, 5 become 1, 2, 3, 4
    let after_delete = mgr.delete_slot(3).unwrap();
    assert_eq!(after_delete.slots_count, 4);
    assert_eq!(after_delete.accounts[0].slot, 1);
    assert_eq!(after_delete.accounts[0].email, "user1@domain.com");
    assert_eq!(after_delete.accounts[1].slot, 2);
    assert_eq!(after_delete.accounts[1].email, "user2@domain.com");
    assert_eq!(after_delete.accounts[2].slot, 3);
    assert_eq!(after_delete.accounts[2].email, "user4@domain.com");
    assert_eq!(after_delete.accounts[3].slot, 4);
    assert_eq!(after_delete.accounts[3].email, "user5@domain.com");
    // Since active slot was deleted, slot 1 becomes active
    assert_eq!(after_delete.active_slot, 1);

    // Carousel rotate: 1 -> 2 -> 3 -> 4 -> 1
    let r2 = mgr.rotate(None).unwrap();
    assert_eq!(r2.active_slot, 2);
    assert_eq!(r2.current_email, Some("user2@domain.com".to_string()));

    let r3 = mgr.rotate(None).unwrap();
    assert_eq!(r3.active_slot, 3);
    assert_eq!(r3.current_email, Some("user4@domain.com".to_string()));

    let r4 = mgr.rotate(None).unwrap();
    assert_eq!(r4.active_slot, 4);
    assert_eq!(r4.current_email, Some("user5@domain.com".to_string()));

    let r1 = mgr.rotate(None).unwrap();
    assert_eq!(r1.active_slot, 1);
    assert_eq!(r1.current_email, Some("user1@domain.com".to_string()));
}

#[test]
fn test_log_watcher_file_truncation_and_recovery() {
    let mut temp = tempfile::NamedTempFile::new().unwrap();
    let path = temp.path().to_path_buf();

    let mut watcher = LogTailWatcher::with_options(
        path.clone(),
        DEFAULT_QUOTA_REGEX,
        Duration::from_millis(10),
    )
    .unwrap();

    // Write some lines
    writeln!(temp, "Log line 1: normal init").unwrap();
    writeln!(temp, "Log line 2: connected to backend").unwrap();
    temp.flush().unwrap();
    assert!(watcher.poll_once().is_none());

    // Quota error
    writeln!(temp, "status: 429 Too Many Requests").unwrap();
    temp.flush().unwrap();
    let evt = watcher.poll_once();
    assert!(evt.is_some());

    // Truncate file (simulate log file overwrite / rotate)
    temp.as_file_mut().set_len(0).unwrap();
    std::thread::sleep(Duration::from_millis(20));

    // Write new line after truncation
    writeln!(
        temp,
        "new session: rpc error: code = ResourceExhausted: rate limit exceeded"
    )
    .unwrap();
    temp.flush().unwrap();

    let evt2 = watcher.poll_once();
    assert!(evt2.is_some());
    assert!(evt2.unwrap().matched_line.contains("ResourceExhausted"));
}

#[test]
fn test_multi_tenant_workspace_and_slot_isolation() {
    let temp = tempfile::tempdir().unwrap();
    let lib_dir = temp.path().join("library");
    let ws_alpha = temp.path().join("dev1_project_alpha");
    let ws_beta = temp.path().join("dev2_project_beta");

    fs::create_dir_all(&lib_dir).unwrap();
    fs::create_dir_all(&ws_alpha).unwrap();
    fs::create_dir_all(&ws_beta).unwrap();

    // Populate skills in library
    let preset_mgr = PresetManager::load_default();
    let backend_res = preset_mgr.resolve_active_skills("backend", &[]).unwrap();
    let web_res = preset_mgr.resolve_active_skills("web", &[]).unwrap();

    for skill in backend_res.active_skills.iter().chain(web_res.active_skills.iter()) {
        let s_dir = lib_dir.join(skill);
        if !s_dir.exists() {
            fs::create_dir_all(&s_dir).unwrap();
            fs::write(s_dir.join("SKILL.md"), format!("# Skill {}", skill)).unwrap();
        }
    }

    // 1. Project Alpha: Developer 1 initializes project with Slot 1, preset "backend"
    let cfg_alpha = agy_core::credentials::ProjectConfig {
        slot: Some(1),
        preset: Some("backend".to_string()),
        overlays: vec![],
    };
    cfg_alpha.save(&ws_alpha).unwrap();

    let rep_alpha = agy_core::symlink::sync_workspace_skills(
        &ws_alpha,
        &backend_res.active_skills.into_iter().collect::<Vec<_>>(),
        &lib_dir,
    )
    .unwrap();
    assert!(rep_alpha.added.len() > 0);

    // 2. Project Beta: Developer 2 initializes project with Slot 2, preset "web"
    let cfg_beta = agy_core::credentials::ProjectConfig {
        slot: Some(2),
        preset: Some("web".to_string()),
        overlays: vec![],
    };
    cfg_beta.save(&ws_beta).unwrap();

    let rep_beta = agy_core::symlink::sync_workspace_skills(
        &ws_beta,
        &web_res.active_skills.into_iter().collect::<Vec<_>>(),
        &lib_dir,
    )
    .unwrap();
    assert!(rep_beta.added.len() > 0);

    // 3. Verify complete workspace isolation (concurrent independent profiles)
    let engine_alpha = SymlinkEngine::for_workspace(&ws_alpha, Some(&lib_dir)).unwrap();
    let active_alpha = engine_alpha.list_active().unwrap();
    assert!(active_alpha.contains(&"postgres-dba-optimizer".to_string()));
    assert!(!active_alpha.contains(&"nextjs-fullstack-guru".to_string()));

    let engine_beta = SymlinkEngine::for_workspace(&ws_beta, Some(&lib_dir)).unwrap();
    let active_beta = engine_beta.list_active().unwrap();
    assert!(active_beta.contains(&"nextjs-fullstack-guru".to_string()));
    assert!(!active_beta.contains(&"postgres-dba-optimizer".to_string()));

    // 4. Verify Multi-Tenant Slot Resolution & Direct Token Retrieval
    let storage = Box::new(MemoryCredentialStorage::new());
    storage.write(
        "gemini:antigravity_slot_1",
        r#"{"token": "token-dev-1-backend", "email": "dev1@alpha.org"}"#,
        "u",
    );
    storage.write(
        "gemini:antigravity_slot_2",
        r#"{"access_token": "token-dev-2-frontend", "email": "dev2@beta.org"}"#,
        "u",
    );
    storage.write(
        TARGET_ACTIVE,
        r#"{"token": "global-active-token", "email": "admin@global.org"}"#,
        "u",
    );

    let cred_mgr = CredentialManager::new(storage.clone(), temp.path().join("cred_cfg.json"));

    // Developer 1 in Project Alpha gets Slot 1 token
    let (slot_a, src_a) = cred_mgr.resolve_slot(None, Some(&ws_alpha)).unwrap();
    assert_eq!(slot_a, 1);
    assert!(matches!(src_a, agy_core::credentials::SlotResolutionSource::ProjectConfig(_)));
    assert_eq!(cred_mgr.get_token_for_slot(slot_a).unwrap(), "token-dev-1-backend");

    // Developer 2 in Project Beta gets Slot 2 token
    let (slot_b, src_b) = cred_mgr.resolve_slot(None, Some(&ws_beta)).unwrap();
    assert_eq!(slot_b, 2);
    assert!(matches!(src_b, agy_core::credentials::SlotResolutionSource::ProjectConfig(_)));
    assert_eq!(cred_mgr.get_token_for_slot(slot_b).unwrap(), "token-dev-2-frontend");

    // Developer 2 overrides session slot via AGY_SLOT=1 temporarily
    std::env::set_var("AGY_SLOT", "1");
    let (slot_override, src_override) = cred_mgr.resolve_slot(None, Some(&ws_beta)).unwrap();
    assert_eq!(slot_override, 1);
    assert_eq!(src_override, agy_core::credentials::SlotResolutionSource::EnvironmentVariable("1".to_string()));
    std::env::remove_var("AGY_SLOT");

    // Invariant: TARGET_ACTIVE was NEVER touched
    let global_cred = storage.read(TARGET_ACTIVE).unwrap();
    assert!(global_cred.contains("global-active-token"));

    // 5. IPC custom path and normalization check
    #[cfg(windows)]
    {
        assert_eq!(agy_core::ipc::normalize_ipc_path("tenant-alpha"), r"\\.\pipe\tenant-alpha");
        assert_eq!(agy_core::ipc::normalize_ipc_path(r"\\.\pipe\tenant-alpha"), r"\\.\pipe\tenant-alpha");
    }
    #[cfg(not(windows))]
    {
        assert_eq!(agy_core::ipc::normalize_ipc_path("/tmp/tenant-alpha.sock"), "/tmp/tenant-alpha.sock");
    }
}

#[tokio::test]
async fn test_chat_and_api_integration_pipeline() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // 1. Verify preset system prompt builder
    let manifest = PresetManager::load_default().manifest;
    let system_prompt = agy_core::build_preset_system_prompt(&manifest, "systems").unwrap();
    assert!(system_prompt.contains("Systems & High-Perf"));
    assert!(system_prompt.contains("rust-systems-safe"));
    assert!(system_prompt.contains("Active Skills"));

    // 2. Mock SSE HTTP server simulating Gemini streaming API
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut req_buf = vec![0u8; 4096];
            let _ = socket.read(&mut req_buf).await;
            let req_str = String::from_utf8_lossy(&req_buf);

            // Verify bearer token header or API key was forwarded
            assert!(req_str.contains("authorization: Bearer test-secret-token") || req_str.contains("Authorization: Bearer test-secret-token"));

            let sse_data = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Chunk 1: Hello \"}],\"role\":\"model\"}}]}\n\n\
                            data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Chunk 2: from \"}],\"role\":\"model\"}}]}\n\n\
                            data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Antigravity!\"}],\"role\":\"model\"}}]}\n\n\
                            data: [DONE]\n\n";

            let http_response = format!(
                "HTTP/1.1 200 OK\r\n\
                Content-Type: text/event-stream\r\n\
                Content-Length: {}\r\n\
                Connection: close\r\n\r\n{}",
                sse_data.len(),
                sse_data
            );
            let _ = socket.write_all(http_response.as_bytes()).await;
        }
    });

    // 3. Client streaming execution
    let client = agy_core::GeminiClient::new(
        Some("gemini-2.0-flash".to_string()),
        Some("test-secret-token".to_string()),
    )
    .with_endpoint_base(format!("http://127.0.0.1:{}", port));

    let history = vec![
        agy_core::ChatMessage {
            role: "user".to_string(),
            content: "Who are you?".to_string(),
        },
        agy_core::ChatMessage {
            role: "model".to_string(),
            content: "I am Antigravity AI.".to_string(),
        },
    ];

    let mut chunks = Vec::new();
    let full_text = client
        .stream_generate(
            "Write a hello world in Rust",
            &history,
            Some(&system_prompt),
            |c| chunks.push(c.to_string()),
        )
        .await
        .unwrap();

    assert_eq!(full_text, "Chunk 1: Hello Chunk 2: from Antigravity!");
    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0], "Chunk 1: Hello ");
    assert_eq!(chunks[1], "Chunk 2: from ");
    assert_eq!(chunks[2], "Antigravity!");
}
