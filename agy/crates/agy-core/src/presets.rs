use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PresetError {
    #[error("Manifest parse error: {0}")]
    YamlError(#[from] serde_yaml::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Preset '{0}' not found in manifest")]
    PresetNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preset {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub skills: Vec<String>,
    #[serde(default)]
    pub adjacent_presets: Option<Vec<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HybridRule {
    pub trigger: Vec<String>,
    pub compose: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PresetsManifest {
    pub version: String,
    pub always_active: Vec<String>,
    pub presets: BTreeMap<String, Preset>,
    #[serde(default)]
    pub hybrid_rules: Vec<HybridRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolvedPreset {
    pub base: String,
    pub overlays: Vec<String>,
    pub active_skills: BTreeSet<String>,
    pub total_skills: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PresetSummary {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub skill_count: usize,
    pub skills: Vec<String>,
}

pub const DEFAULT_PRESETS_YAML: &str = r#"version: "3.0"
always_active:
  - agent-preset-conductor
  - grill-me
  - systematic-debugging
  - verification-before-completion
  - concise-planning

presets:
  web:
    name: "Web Modern"
    icon: "🌐"
    description: "Next.js 15, React, Tailwind v4, Vue 3, TanStack Query, Web Vitals, SEO & CRO"
    skills:
      - ui-ux-pro-max
      - frontend-design
      - react-best-practices
      - seo-audit
      - form-cro
      - nextjs-fullstack-guru
      - tailwind-v4-master
      - react-performance-opt
      - vue-nuxt-expert
      - web-state-query-master
      - web-performance-auditor
      - figcraft-design
      - vectorcraft-artwork
      - agent-preset-conductor
      - ai-product-partner
      - modern-web-guidance
      - generative_ui
    adjacent_presets: [qa, product]
    tags: [frontend, ui, browser, react]

  backend:
    name: "Backend & DB"
    icon: "⚙️"
    description: "PostgreSQL DBA, Database design, API design, Node.js, FastAPI, Go, Rust, Redis, Kafka"
    skills:
      - database-design
      - api-design-principles
      - nodejs-best-practices
      - go-concurrency-patterns
      - memory-safety-patterns
      - postgres-dba-optimizer
      - fastapi-async-architect
      - go-highload-services
      - rust-systems-safe
      - redis-distributed-caching
      - kafka-event-streaming
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [devops, systems]
    tags: [backend, api, db, server]

  devops:
    name: "DevOps & Cloud"
    icon: "🐳"
    description: "Docker multi-stage, Kubernetes, GitHub Actions, Terraform IaC, AWS Serverless, SRE, Observability"
    skills:
      - incident-responder
      - deployment-procedures
      - aws-serverless
      - docker-container-master
      - k8s-manifest-generator
      - github-actions-ci-cd
      - terraform-iac-architect
      - observability-telemetry-guru
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [backend]
    tags: [devops, docker, ci-cd, cloud]

  appsec:
    name: "AppSec & Reversing"
    icon: "🛡️"
    description: "OWASP Top-10, API security, Ethical hacking, Electron ASAR, Win32/PS & Desktop UI, Network intercept"
    skills:
      - top-web-vulnerabilities
      - api-security-best-practices
      - ethical-hacking-methodology
      - appsec-code-auditor
      - craft-anything
      - reverse-engineer-electron
      - win32-powershell-automation
      - windows-desktop-control
      - network-traffic-intercept
      - api-pentest-fuzzer
      - agent-preset-conductor
      - premortem-redteam
    adjacent_presets: [reverse-engineering, qa]
    tags: [security, appsec, audit, pentest]

  qa:
    name: "QA & Testing"
    icon: "🧪"
    description: "Playwright E2E & Desktop UI (Windows-MCP), TDD, Test fixing, Code review audit, k6 load testing, API contracts"
    skills:
      - test-driven-development
      - test-fixing
      - code-review-checklist
      - playwright-e2e-guru
      - windows-desktop-control
      - unit-test-synthesizer
      - k6-load-testing-pro
      - api-contract-tester
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [web, backend]
    tags: [qa, testing, e2e, unit-test]

  ai-agents:
    name: "AI & MCP Engineering"
    icon: "🤖"
    description: "MCP серверы, RAG, Prompt Engineering, архитектура агентов и управление контекстом"
    skills:
      - mcp-builder
      - prompt-engineering
      - rag-implementation
      - context-window-management
      - ai-agents-architect
      - agent-evaluation
      - langgraph
      - browser
      - fl-freelance-agent
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [orchestrator]
    tags: [ai, mcp, agents, llm]

  web-research:
    name: "Web Research & OSINT"
    icon: "🔍"
    description: "Глубокий поиск, извлечение контента, веб-скрапинг, OSINT и аналитика"
    skills:
      - search-specialist
      - deep-research-synthesizer
      - web-scraper-harvester
      - osint-recon-investigator
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [product]
    tags: [search, osint, scraping, research]

  reverse-engineering:
    name: "Reverse Engineering & Replica"
    icon: "🧬"
    description: "Полный Clean-Room цикл (11 скиллов Replica) + Electron ASAR реверс-инжиниринг"
    skills:
      - craft-anything
      - replica-recon
      - replica-architect
      - replica-backend
      - replica-brand
      - replica-build
      - replica-deploy
      - replica-design
      - replica-diff
      - replica-entrepreneur
      - replica-launch
      - replica-test
      - reverse-engineer-electron
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [appsec]
    tags: [reverse-engineering, replica, decompile]

  product:
    name: "Product & Monetization"
    icon: "💎"
    description: "Стратегия монетизации, юнит-экономика, офферы, карточки товаров, анализ рынка, ценообразование и CRO"
    skills:
      - product-monetization-strategy
      - market-competitor-intelligence
      - ai-product-partner
      - browser
      - search-specialist
      - deep-research-synthesizer
      - replica-entrepreneur
      - replica-brand
      - replica-launch
      - form-cro
      - ui-ux-pro-max
      - seo-audit
      - agent-preset-conductor
    adjacent_presets: [web]
    tags: [product, business, cro, monetization]

  orchestrator:
    name: "Orchestrator & Multi-Agent"
    icon: "🎭"
    description: "Мультиагентная оркестрация, декомпозиция крупных проектов, параллельные субагенты с фиксированными пресетами, арбитраж и верификация"
    skills:
      - subagent-orchestrator
      - hierarchical-task-decomposer
      - multi-agent-debate-consensus
      - context-synthesis-reducer
      - ai-agents-architect
      - prompt-engineering
      - context-window-management
      - agent-evaluation
      - langgraph
      - artcraft-orchestrator
      - craft-anything
      - figcraft-design
      - code-review-checklist
      - premortem-redteam
      - ai-product-partner
      - agent-preset-conductor
    adjacent_presets: [ai-agents]
    tags: [orchestrator, multi-agent, delegation]

  systems:
    name: "Systems & High-Perf"
    icon: "⚡"
    description: "Modern C++20/C++23, C, Zig, Rust, RAII, ручное управление памятью, lock-free, SIMD, санитайзеры ASan/TSan, CMake и профилирование"
    skills:
      - cpp-systems-architect
      - systems-lowlevel-perf
      - lockfree-concurrency-patterns
      - rust-systems-safe
      - memory-safety-patterns
      - test-driven-development
      - test-fixing
      - code-review-checklist
      - agent-preset-conductor
    adjacent_presets: [backend, vst3]
    tags: [systems, rust, cpp, low-level]

  vst3:
    name: "VST3 & Audio DSP Studio"
    icon: "🎛️"
    description: "Разработка VST3/VST3i плагинов, синтезаторов и DSP эффектов: JUCE C++, real-time audio thread safety, SIMD, аудио UI/UX дизайн и мультиагентная оркестрация"
    skills:
      - vst3-dsp-architect
      - audio-plugin-ui-ux
      - figcraft-design
      - vectorcraft-artwork
      - cpp-systems-architect
      - systems-lowlevel-perf
      - lockfree-concurrency-patterns
      - subagent-orchestrator
      - hierarchical-task-decomposer
      - test-driven-development
      - test-fixing
      - code-review-checklist
      - agent-preset-conductor
    adjacent_presets: [systems]
    tags: [vst3, audio, dsp, juce]

  hardware:
    name: "Hardware & CAD/CAM Studio"
    icon: "📐"
    description: "Параметрическое 3D твердотельное моделирование (SolidCraft), 2D/3D черчение DWG/DXF (CADCraft), 3D PBR текстурирование (TextureCraft), экспорт STEP/STL"
    skills:
      - solidcraft-modeling
      - cadcraft-drafting
      - texturecraft-pbr
      - cpp-systems-architect
      - systems-lowlevel-perf
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: [systems]
    tags: [hardware, cad, 3d, modeling]

  media:
    name: "Creative Studio & Media Production"
    icon: "🎨"
    description: "Нелинейный видеомонтаж (FilmCraft), моушн-дизайн и визуальные эффекты (EffectCraft), проявка RAW и HDR (LightCraft), растр PSD (PhotoCraft), вектор SVG (VectorCraft), дизайн-системы (FigCraft)"
    skills:
      - filmcraft-video
      - effectcraft-vfx
      - lightcraft-photo
      - photocraft-studio
      - vectorcraft-artwork
      - figcraft-design
      - ui-ux-pro-max
      - frontend-design
      - ai-product-partner
      - agent-preset-conductor
    adjacent_presets: [web]
    tags: [media, video, vfx, design]

  meta-dev:
    name: "Antigravity Core & Self-Dev"
    icon: "🛠️"
    description: "Разработка ядра Antigravity: Electron ASAR сборка/распаковка, синхронизация скиллов, тесты Multi-Account, инсталлятор и Win32 автоматизация"
    skills:
      - antigravity-core-dev
      - reverse-engineer-electron
      - win32-powershell-automation
      - windows-desktop-control
      - test-driven-development
      - test-fixing
      - code-review-checklist
      - nodejs-best-practices
      - subagent-orchestrator
      - hierarchical-task-decomposer
      - github-actions-ci-cd
      - agent-preset-conductor
    adjacent_presets: [orchestrator]
    tags: [meta-dev, core, internal]

  minimal:
    name: "Minimal Context"
    icon: "⚡"
    description: "Минимум токенов в системном промпте"
    skills:
      - agent-preset-conductor
      - ai-product-partner
    adjacent_presets: []
    tags: [minimal]

hybrid_rules:
  - trigger: ["react", "playwright"]
    compose: [web, qa]
  - trigger: ["api", "docker"]
    compose: [backend, devops]
  - trigger: ["fastapi", "react"]
    compose: [backend, web]
  - trigger: ["backend", "qa"]
    compose: [backend, qa]
  - trigger: ["web", "qa"]
    compose: [web, qa]
  - trigger: ["backend", "devops"]
    compose: [backend, devops]
"#;

pub struct PresetManager {
    pub manifest: PresetsManifest,
}

impl PresetManager {
    pub fn new(manifest: PresetsManifest) -> Self {
        Self { manifest }
    }

    pub fn load_from_str(yaml_str: &str) -> Result<Self, PresetError> {
        let manifest: PresetsManifest = serde_yaml::from_str(yaml_str)?;
        Ok(Self { manifest })
    }

    pub fn load_from_file(path: &Path) -> Result<Self, PresetError> {
        let content = std::fs::read_to_string(path)?;
        Self::load_from_str(&content)
    }

    pub fn load_default() -> Self {
        Self::load_from_str(crate::portable::EMBEDDED_PRESETS_YAML)
            .or_else(|_| Self::load_from_str(DEFAULT_PRESETS_YAML))
            .expect("Embedded presets YAML must be valid")
    }

    pub fn load_auto(config_path: Option<&Path>) -> Self {
        if let Some(p) = config_path {
            if p.exists() {
                if let Ok(mgr) = Self::load_from_file(p) {
                    return mgr;
                }
            }
        }

        // 1. Try portable config directory: <base_dir>/config/presets.yaml
        let portable_config = crate::portable::get_config_dir().join("presets.yaml");
        if portable_config.exists() {
            if let Ok(mgr) = Self::load_from_file(&portable_config) {
                return mgr;
            }
        }

        // 2. Try ~/.gemini/config/presets.yaml
        if let Some(home) = dirs_home() {
            let global_path = home.join(".gemini").join("config").join("presets.yaml");
            if global_path.exists() {
                if let Ok(mgr) = Self::load_from_file(&global_path) {
                    return mgr;
                }
            }
        }

        // 3. Fallback to embedded presets
        Self::load_default()
    }

    pub fn get_preset(&self, name: &str) -> Option<&Preset> {
        let key = name.to_lowercase().trim().to_string();
        self.manifest.presets.get(&key)
    }

    pub fn list_presets(&self) -> Vec<PresetSummary> {
        self.manifest
            .presets
            .iter()
            .map(|(id, p)| PresetSummary {
                id: id.clone(),
                name: p.name.clone(),
                icon: p.icon.clone().unwrap_or_else(|| "📦".to_string()),
                description: p.description.clone().unwrap_or_default(),
                skill_count: p.skills.len(),
                skills: p.skills.clone(),
            })
            .collect()
    }

    /// Resolves the active skills for a base preset plus optional overlays.
    /// Overlays can be named "qa", "+qa", "docker", etc.
    /// Automatic hybrid composition rules are applied if base + overlay trigger matches.
    pub fn resolve_active_skills(
        &self,
        base_preset: &str,
        raw_overlays: &[String],
    ) -> Result<ResolvedPreset, PresetError> {
        let base_key = base_preset.to_lowercase().trim().to_string();
        let base = self
            .get_preset(&base_key)
            .ok_or_else(|| PresetError::PresetNotFound(base_preset.to_string()))?;

        let mut active_skills = BTreeSet::new();

        // 1. Always active foundational skills
        for skill in &self.manifest.always_active {
            active_skills.insert(skill.clone());
        }

        // 2. Base preset skills
        for skill in &base.skills {
            active_skills.insert(skill.clone());
        }

        // 3. Process overlays
        let mut clean_overlays = Vec::new();
        let mut all_preset_keys = vec![base_key.clone()];

        for ov in raw_overlays {
            let clean = ov.trim().trim_start_matches('+').to_lowercase();
            if clean.is_empty() {
                continue;
            }
            if let Some(ov_preset) = self.get_preset(&clean) {
                for skill in &ov_preset.skills {
                    active_skills.insert(skill.clone());
                }
                clean_overlays.push(clean.clone());
                all_preset_keys.push(clean);
            } else {
                // If the overlay refers to an individual skill directly
                active_skills.insert(clean.clone());
                clean_overlays.push(clean);
            }
        }

        // 4. Check hybrid composition rules
        for rule in &self.manifest.hybrid_rules {
            let mut matched_skills = BTreeSet::new();
            let mut matches_all = true;

            for trig in &rule.trigger {
                let trig_clean = trig.to_lowercase();
                if all_preset_keys.contains(&trig_clean) {
                    continue;
                }
                if let Some(skill) = active_skills.iter().find(|s| {
                    !matched_skills.contains(*s) && s.to_lowercase().contains(&trig_clean)
                }) {
                    matched_skills.insert(skill.clone());
                } else {
                    matches_all = false;
                    break;
                }
            }

            if matches_all {
                for comp in &rule.compose {
                    let comp_clean = comp.to_lowercase();
                    if let Some(p) = self.get_preset(&comp_clean) {
                        for skill in &p.skills {
                            active_skills.insert(skill.clone());
                        }
                    }
                }
            }
        }

        let total = active_skills.len();
        Ok(ResolvedPreset {
            base: base_key,
            overlays: clean_overlays,
            active_skills,
            total_skills: total,
        })
    }
}

/// Convenience helper to resolve a preset and its active skills from a manifest.
pub fn resolve_preset(manifest: &PresetsManifest, preset_name: &str) -> Result<ResolvedPreset, PresetError> {
    let mgr = PresetManager::new(manifest.clone());
    mgr.resolve_active_skills(preset_name, &[])
}

/// Generate a structured system prompt based on preset configuration and resolved active skills.
pub fn build_preset_system_prompt(manifest: &PresetsManifest, preset_name: &str) -> Result<String, PresetError> {
    let resolved = resolve_preset(manifest, preset_name)?;
    let preset = manifest.presets.get(&resolved.base);
    let name = preset.map(|p| p.name.as_str()).unwrap_or(preset_name);
    let desc = preset.and_then(|p| p.description.as_deref()).unwrap_or("");
    let icon = preset.and_then(|p| p.icon.as_deref()).unwrap_or("📦");

    let skills_list: Vec<&str> = resolved.active_skills.iter().map(|s| s.as_str()).collect();

    let prompt = format!(
        "You are Antigravity AI Assistant, operating in CLI mode.\n\
        Active Preset: {} {} ({})\n\
        Active Skills ({} total):\n- {}\n\n\
        Instructions:\n\
        - Act according to the domain expertise implied by the active preset and skills.\n\
        - Provide direct, concise, production-ready code and solutions.\n\
        - Follow systematic debugging and verification best practices.",
        icon,
        name,
        desc,
        resolved.total_skills,
        skills_list.join("\n- ")
    );

    Ok(prompt)
}

pub fn dirs_home() -> Option<PathBuf> {
    if let Ok(val) = std::env::var("USERPROFILE") {
        if !val.trim().is_empty() {
            return Some(PathBuf::from(val));
        }
    }
    if let Ok(val) = std::env::var("HOME") {
        if !val.trim().is_empty() {
            return Some(PathBuf::from(val));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_default_manifest() {
        let mgr = PresetManager::load_default();
        assert_eq!(mgr.manifest.version, "3.0");
        assert_eq!(mgr.manifest.presets.len(), 16);
        assert!(mgr.manifest.always_active.contains(&"grill-me".to_string()));
        assert!(mgr.manifest.always_active.contains(&"agent-preset-conductor".to_string()));
    }

    #[test]
    fn test_resolve_base_preset() {
        let mgr = PresetManager::load_default();
        let res = mgr.resolve_active_skills("web", &[]).unwrap();
        assert_eq!(res.base, "web");
        assert!(res.active_skills.contains("react-best-practices"));
        assert!(res.active_skills.contains("grill-me"));
        assert!(res.active_skills.contains("systematic-debugging"));
        assert!(!res.active_skills.contains("postgres-dba-optimizer"));
    }

    #[test]
    fn test_resolve_with_overlays() {
        let mgr = PresetManager::load_default();
        let overlays = vec!["+qa".to_string()];
        let res = mgr.resolve_active_skills("backend", &overlays).unwrap();
        assert_eq!(res.base, "backend");
        assert_eq!(res.overlays, vec!["qa".to_string()]);
        // Backend skills
        assert!(res.active_skills.contains("postgres-dba-optimizer"));
        // QA overlay skills
        assert!(res.active_skills.contains("playwright-e2e-guru"));
        assert!(res.active_skills.contains("test-driven-development"));
        // Always active
        assert!(res.active_skills.contains("verification-before-completion"));
    }

    #[test]
    fn test_nonexistent_preset_error() {
        let mgr = PresetManager::load_default();
        let res = mgr.resolve_active_skills("unknown_preset_xyz", &[]);
        assert!(res.is_err());
    }

    #[test]
    fn test_hybrid_rule_composition() {
        let mgr = PresetManager::load_default();
        // Trigger rule for fastapi and react
        let overlays = vec!["web".to_string()];
        let res = mgr.resolve_active_skills("backend", &overlays).unwrap();
        assert!(res.active_skills.contains("fastapi-async-architect"));
        assert!(res.active_skills.contains("react-best-practices"));
    }

    #[test]
    fn test_resolve_preset_and_system_prompt() {
        let manifest = PresetManager::load_default().manifest;
        let res = resolve_preset(&manifest, "backend").unwrap();
        assert_eq!(res.base, "backend");
        assert!(res.active_skills.contains("postgres-dba-optimizer"));

        let prompt = build_preset_system_prompt(&manifest, "backend").unwrap();
        assert!(prompt.contains("Backend & DB"));
        assert!(prompt.contains("postgres-dba-optimizer"));
        assert!(prompt.contains("Active Preset:"));
    }
}
