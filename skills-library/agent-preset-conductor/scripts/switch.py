#!/usr/bin/env python3
import sys
import json
import os
import urllib.request
import urllib.error

BRIDGE_SWITCH_URL = "http://127.0.0.1:51122/api/switch-preset"
BRIDGE_EVAL_URL = "http://127.0.0.1:51122/api/eval"
CONFIG_FILE = os.path.expanduser(r"~\.gemini\antigravity\control-center-config.json")

PRESET_SKILLS_MAP = {
    "web": [
        "nextjs-fullstack-guru", "tailwind-v4-master", "react-performance-opt", 
        "vue-nuxt-expert", "web-state-query-master", "web-performance-auditor", 
        "agent-preset-conductor", "ai-product-partner"
    ],
    "backend": [
        "postgres-dba-optimizer", "fastapi-async-architect", "go-highload-services", 
        "rust-systems-safe", "redis-distributed-caching", "kafka-event-streaming", 
        "agent-preset-conductor", "ai-product-partner"
    ],
    "devops": [
        "docker-container-master", "k8s-manifest-generator", "github-actions-ci-cd", 
        "terraform-iac-architect", "observability-telemetry-guru", 
        "agent-preset-conductor", "ai-product-partner"
    ],
    "appsec": [
        "appsec-code-auditor", "reverse-engineer-electron", "win32-powershell-automation", 
        "network-traffic-intercept", "api-pentest-fuzzer", 
        "agent-preset-conductor", "premortem-redteam"
    ],
    "qa": [
        "playwright-e2e-guru", "unit-test-synthesizer", "k6-load-testing-pro", 
        "api-contract-tester", "agent-preset-conductor", "ai-product-partner"
    ],
    "web-research": [
        "deep-research-synthesizer", "web-scraper-harvester", "osint-recon-investigator", 
        "replica-entrepreneur", "agent-preset-conductor", "ai-product-partner"
    ],
    "reverse-engineering": [
        "replica-recon", "replica-architect", "replica-backend", "replica-brand", 
        "replica-build", "replica-deploy", "replica-design", "replica-diff", 
        "replica-entrepreneur", "replica-launch", "replica-test", 
        "reverse-engineer-electron", "agent-preset-conductor", "ai-product-partner"
    ],
    "minimal": [
        "agent-preset-conductor", "ai-product-partner"
    ],
    "all": []
}

def update_config_active_preset(preset_name):
    try:
        cfg = {}
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        cfg["activePreset"] = preset_name
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

def switch_preset(preset_name):
    skills = PRESET_SKILLS_MAP.get(preset_name, [])
    # Always use live IPC Control Center bridge to ensure real-time application of updated skills
    js_code = f"""
    window.controlCenter ? window.controlCenter.applyPreset({json.dumps(skills)}).then(res => ({{
        success: true,
        preset: '{preset_name}',
        activeSkills: {json.dumps(skills)},
        totalActiveTokens: res.totalActiveTokens,
        activeCount: res.activeCount,
        totalCount: res.totalCount
    }})) : null
    """
    payload = json.dumps({"code": js_code}).encode("utf-8")
    req = urllib.request.Request(BRIDGE_EVAL_URL, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok") and data.get("result"):
                res = data["result"]
                update_config_active_preset(preset_name)
                print(f"✔ Successfully switched to preset: '{preset_name}'")
                print(f"Active skills ({res.get('activeCount', len(skills))}): {', '.join(skills if skills else ['(all skills enabled)']) }")
                print(f"Estimated context: ~{res.get('totalActiveTokens', 0)} tokens")
                return True
    except Exception:
        pass

    # Fallback to direct HTTP endpoint
    payload = json.dumps({"preset": preset_name}).encode("utf-8")
    req = urllib.request.Request(BRIDGE_SWITCH_URL, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success"):
                update_config_active_preset(preset_name)
                print(f"✔ Successfully switched to preset: '{data.get('preset')}'")
                print(f"Active skills ({len(data.get('activeSkills', []))}): {', '.join(data.get('activeSkills', []))}")
                print(f"Estimated context: ~{data.get('totalActiveTokens', 0)} tokens")
                return True
            else:
                print(f"❌ Failed: {data.get('error', 'Unknown error')}")
                return False
    except urllib.error.URLError as e:
        print(f"❌ Error connecting to Antigravity Bridge on 51122: {e}")
        return False

def main():
    valid_presets = list(PRESET_SKILLS_MAP.keys())
    if len(sys.argv) < 2:
        print(f"Usage: python switch.py <preset_name> ({'|'.join(valid_presets)})")
        sys.exit(1)

    target_preset = sys.argv[1].strip().lower()
    if target_preset not in PRESET_SKILLS_MAP:
        print(f"❌ Unknown preset: '{target_preset}'. Available: {', '.join(valid_presets)}")
        sys.exit(1)

    success = switch_preset(target_preset)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
