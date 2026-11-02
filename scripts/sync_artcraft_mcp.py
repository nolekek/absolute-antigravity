#!/usr/bin/env python3
"""
ArtCraft Suite MCP Discovery & Synchronization Engine for Antigravity v2.0
Discovers and registers all 10 local Rust MCP engines into Antigravity mcp_config.json
"""

import os
import sys
import json
import shutil
import subprocess
from pathlib import Path

DEFAULT_CONFIG_PATH = os.path.expanduser(r"~\.gemini\config\mcp_config.json")

# 10 Known ArtCraft Suite engines with detection paths and required arguments
FLEET_DEFINITIONS = [
    {
        "id": "craft-anything",
        "name": "Craft Anything",
        "category": "Reverse Engineering & Clean-Room",
        "paths": [
            r"C:\Program Files\Craft Anything\craft-anything-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-cadcraft",
        "name": "CADCraft",
        "category": "2D/3D CAD & Drafting",
        "paths": [
            r"C:\Program Files\ArtCraft\CADCraft\cadcraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-solidcraft",
        "name": "SolidCraft",
        "category": "Parametric 3D Solid CAD & STEP",
        "paths": [
            r"C:\Program Files\SolidCraft\solidcraft-cli.exe",
            r"C:\Program Files\ArtCraft\SolidCraft\solidcraft-cli.exe",
        ],
        "args": ["mcp", "--headless", "--allow-any-path"],
        "env": {}
    },
    {
        "id": "artcraft-texturecraft",
        "name": "TextureCraft",
        "category": "3D PBR Textures & Materials",
        "paths": [
            r"C:\Program Files\TextureCraft\texturecraft-cli.exe",
            r"C:\Program Files\ArtCraft\TextureCraft\texturecraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-filmcraft",
        "name": "FilmCraft",
        "category": "NLE Video Editing & Timeline",
        "paths": [
            r"C:\Program Files\ArtCraft\FilmCraft\filmcraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-effectcraft",
        "name": "EffectCraft",
        "category": "Motion Graphics & VFX Compositing",
        "paths": [
            r"C:\Program Files\ArtCraft\EffectCraft\effectcraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-lightcraft",
        "name": "LightCraft",
        "category": "RAW Photo Development & HDR",
        "paths": [
            r"C:\Program Files\ArtCraft\LightCraft\lightcraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-photocraft",
        "name": "PhotoCraft",
        "category": "Raster Image Editing & PSD",
        "paths": [
            r"C:\Program Files\ArtCraft\PhotoCraft\photocraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    },
    {
        "id": "artcraft-vectorcraft",
        "name": "VectorCraft",
        "category": "Vector Illustration & SVG",
        "paths": [
            r"C:\Program Files\ArtCraft\VectorCraft\vectorcraft-cli.exe",
        ],
        "args": ["mcp", "--headless"],
        "env": {}
    },
    {
        "id": "artcraft-figcraft",
        "name": "FigCraft",
        "category": "UI/UX Design Systems & Components",
        "paths": [
            r"C:\Program Files\ArtCraft\FigCraft\figcraft-cli.exe",
        ],
        "args": ["mcp"],
        "env": {}
    }
]

def discover_installed_engines():
    discovered = []
    for item in FLEET_DEFINITIONS:
        found_path = None
        for p in item["paths"]:
            if os.path.exists(p):
                found_path = p
                break
        if found_path:
            discovered.append({
                "id": item["id"],
                "name": item["name"],
                "category": item["category"],
                "command": found_path,
                "args": item["args"],
                "env": item.get("env", {})
            })
    return discovered

def ping_engine(command, args):
    """Sends JSON-RPC initialize packet via stdio to verify engine readiness"""
    try:
        proc = subprocess.Popen(
            [command] + args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        req = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "antigravity-sync", "version": "2.0.0"}
            }
        }
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        proc.terminate()
        data = json.loads(line)
        res = data.get("result", {})
        info = res.get("serverInfo", {})
        return True, f"{info.get('title', info.get('name'))} v{info.get('version', '?')}"
    except Exception as e:
        return False, str(e)

def sync_mcp_config(config_path=DEFAULT_CONFIG_PATH, dry_run=False, ping=False):
    print("=" * 70)
    print("  ARTCRAFT SUITE MCP SYNCHRONIZATION ENGINE (Antigravity v2.0)")
    print("=" * 70)
    print(f"Target Configuration: {config_path}")

    discovered = discover_installed_engines()
    print(f"Discovered installed engines: {len(discovered)} / {len(FLEET_DEFINITIONS)}")

    if not discovered:
        print("[!] No ArtCraft engines found. Ensure they are installed in Program Files.")
        return False

    for item in discovered:
        print(f"  * [{item['id']}] {item['name']} ({item['category']})")
        print(f"    Binary: {item['command']}")
        if ping:
            ok, msg = ping_engine(item["command"], item["args"])
            status = "✔ PASS" if ok else "✖ FAIL"
            print(f"    Ping: {status} -> {msg}")

    # Load existing config
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    cfg = {"mcpServers": {}}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            print(f"[!] Warning: existing config could not be parsed ({e}), starting clean")

    if "mcpServers" not in cfg:
        cfg["mcpServers"] = {}

    # Merge entries
    added = 0
    updated = 0
    for item in discovered:
        entry = {
            "command": item["command"],
            "args": item["args"]
        }
        if item.get("env"):
            entry["env"] = item["env"]

        server_id = item["id"]
        if server_id in cfg["mcpServers"]:
            if cfg["mcpServers"][server_id] != entry:
                updated += 1
                cfg["mcpServers"][server_id] = entry
        else:
            added += 1
            cfg["mcpServers"][server_id] = entry

    print(f"\nConfiguration changes planned: {added} added, {updated} updated, total servers: {len(cfg['mcpServers'])}")

    if dry_run:
        print("[DRY-RUN] No changes written.")
        return True

    # Backup existing
    if os.path.exists(config_path):
        backup_path = config_path + ".artcraft.backup"
        if not os.path.exists(backup_path):
            shutil.copy2(config_path, backup_path)
            print(f"Created backup at: {backup_path}")

    # Atomic write
    tmp_path = config_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    shutil.move(tmp_path, config_path)
    print(f"✔ Successfully synchronized {len(discovered)} ArtCraft MCP servers to {config_path}")
    return True

if __name__ == "__main__":
    is_dry = "--dry-run" in sys.argv
    is_ping = "--ping" in sys.argv or "--check" in sys.argv
    sync_mcp_config(dry_run=is_dry, ping=is_ping)
