#!/usr/bin/env python3
"""
Antigravity Core Developer CLI Tool (antigravity_dev.py)
Automates the full development, ASAR packaging, skills synchronization,
testing, and payload release cycle for Antigravity core engineers.
"""

import os
import sys
import shutil
import subprocess
import gzip
import tarfile
import argparse

WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASAR_SRC = os.path.join(WORKSPACE_ROOT, "asar_extracted_228")
ASAR_DIST = os.path.join(ASAR_SRC, "dist")
ASAR_OUT = os.path.join(WORKSPACE_ROOT, "app.asar.patched_master")
LOCAL_APP_DIR = os.path.expanduser(r"~\AppData\Local\Programs\Antigravity\resources")
APP_ASAR_DEST = os.path.join(LOCAL_APP_DIR, "app.asar")
PAYLOAD_DIR = os.path.join(WORKSPACE_ROOT, "build_installer", "payload")
PAYLOAD_ASAR_GZ = os.path.join(PAYLOAD_DIR, "app.asar.gz")
SKILLS_DIR = os.path.join(WORKSPACE_ROOT, "skills-library")
PAYLOAD_SKILLS_TAR = os.path.join(PAYLOAD_DIR, "skills_library.tar.gz")
GLOBAL_SKILLS_LIB = os.path.expanduser(r"~\.gemini\skills-library")
GLOBAL_CONFIG_SKILLS = os.path.expanduser(r"~\.gemini\config\skills")

CORE_FILES = [
    "skillManager.js",
    "preload.js",
    "stackDetector.js",
    "multiaccManager.js",
    "languageServer.js"
]

class Colors:
    GREEN = "\033[92m"
    BLUE = "\033[94m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

def log_info(msg):
    print(f"{Colors.BLUE}[INFO]{Colors.RESET} {msg}")

def log_success(msg):
    print(f"{Colors.GREEN}[✔ SUCCESS]{Colors.RESET} {msg}")

def log_warn(msg):
    print(f"{Colors.YELLOW}[WARN]{Colors.RESET} {msg}")

def log_error(msg):
    print(f"{Colors.RED}[ERROR]{Colors.RESET} {msg}")

def check_syntax():
    """Validates JavaScript syntax for all core files in root and asar_extracted."""
    log_info("Running JavaScript syntax verification (node -c)...")
    errors = 0
    for f in CORE_FILES:
        root_path = os.path.join(WORKSPACE_ROOT, f)
        if os.path.exists(root_path):
            res = subprocess.run(["node", "-c", root_path], capture_output=True, text=True)
            if res.returncode != 0:
                log_error(f"Syntax error in {f}:\n{res.stderr.strip()}")
                errors += 1
            else:
                print(f"  ✔ {f} (root)")
        dist_path = os.path.join(ASAR_DIST, f)
        if os.path.exists(dist_path):
            res = subprocess.run(["node", "-c", dist_path], capture_output=True, text=True)
            if res.returncode != 0:
                log_error(f"Syntax error in asar_extracted/dist/{f}:\n{res.stderr.strip()}")
                errors += 1
            else:
                print(f"  ✔ dist/{f}")
    if errors == 0:
        log_success("All core files passed syntax validation.")
        return True
    return False

def sync_core_files():
    """Synchronizes core files from workspace root into asar_extracted_228/dist/."""
    log_info("Synchronizing core files into asar_extracted_228/dist/...")
    os.makedirs(ASAR_DIST, exist_ok=True)
    count = 0
    for f in CORE_FILES:
        src = os.path.join(WORKSPACE_ROOT, f)
        dst = os.path.join(ASAR_DIST, f)
        if os.path.exists(src):
            shutil.copy2(src, dst)
            print(f"  ✔ Synced: {f} -> asar_extracted_228/dist/{f}")
            count += 1
    # Also sync credHelper.py
    ch_src = os.path.join(WORKSPACE_ROOT, "credHelper.py")
    ch_dst = os.path.join(ASAR_SRC, "credHelper.py")
    if os.path.exists(ch_src):
        shutil.copy2(ch_src, ch_dst)
        print("  ✔ Synced: credHelper.py -> asar_extracted_228/credHelper.py")
        count += 1
    log_success(f"Synced {count} core files successfully.")
    return True

def sync_skills():
    """Syncs skills-library to ~/.gemini/skills-library/ and ~/.gemini/config/skills/."""
    log_info("Synchronizing skills-library with global directories...")
    os.makedirs(GLOBAL_SKILLS_LIB, exist_ok=True)
    os.makedirs(GLOBAL_CONFIG_SKILLS, exist_ok=True)
    
    skill_folders = [d for d in os.listdir(SKILLS_DIR) if os.path.isdir(os.path.join(SKILLS_DIR, d))]
    for sf in skill_folders:
        src_folder = os.path.join(SKILLS_DIR, sf)
        dst_lib_folder = os.path.join(GLOBAL_SKILLS_LIB, sf)
        os.makedirs(dst_lib_folder, exist_ok=True)
        for item in os.listdir(src_folder):
            s = os.path.join(src_folder, item)
            d = os.path.join(dst_lib_folder, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
    log_success(f"Synchronized {len(skill_folders)} skills to ~/.gemini/skills-library/.")
    
    # Update skills_library.tar.gz
    log_info(f"Packaging {PAYLOAD_SKILLS_TAR}...")
    os.makedirs(PAYLOAD_DIR, exist_ok=True)
    with tarfile.open(PAYLOAD_SKILLS_TAR, "w:gz") as tar:
        tar.add(SKILLS_DIR, arcname="skills-library")
    tar_size = os.path.getsize(PAYLOAD_SKILLS_TAR)
    log_success(f"Updated skills_library.tar.gz ({tar_size} bytes).")
    return True

def repack_asar():
    """Packs asar_extracted_228 with unpack rules, deploys to installation, updates payload."""
    log_info("Packing app.asar with native unpack rules...")
    cmd = f'npx asar pack "{ASAR_SRC}" "{ASAR_OUT}" --unpack "{{**/chrome-devtools-mcp/**,**/credHelper.py}}"'
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=WORKSPACE_ROOT)
    if res.returncode != 0:
        log_error(f"ASAR pack failed: {res.stderr.strip()}")
        return False
    asar_size = os.path.getsize(ASAR_OUT)
    log_success(f"Packed app.asar.patched_master successfully ({asar_size} bytes).")
    
    # Deploy to live Antigravity installation
    if os.path.exists(LOCAL_APP_DIR):
        try:
            shutil.copy2(ASAR_OUT, APP_ASAR_DEST)
            log_success(f"Deployed app.asar to {APP_ASAR_DEST}.")
        except Exception as e:
            log_warn(f"Could not copy to {APP_ASAR_DEST} (maybe Antigravity is running): {e}")
    
    # Gzip to build_installer/payload/app.asar.gz
    log_info(f"Compressing payload {PAYLOAD_ASAR_GZ} (gzip -9)...")
    os.makedirs(PAYLOAD_DIR, exist_ok=True)
    with open(ASAR_OUT, "rb") as f_in:
        with gzip.open(PAYLOAD_ASAR_GZ, "wb", compresslevel=9) as f_out:
            shutil.copyfileobj(f_in, f_out)
    gz_size = os.path.getsize(PAYLOAD_ASAR_GZ)
    log_success(f"Compressed app.asar.gz ({gz_size} bytes).")
    return True

def run_tests():
    """Executes the complete master test runner."""
    log_info("Running master test runner (node tests/run_all.js)...")
    res = subprocess.run(["node", "tests/run_all.js"], cwd=WORKSPACE_ROOT, text=True)
    if res.returncode == 0:
        log_success("All tests passed (100% PASS).")
        return True
    else:
        log_error("Test suite failed.")
        return False

def full_cycle():
    """Executes complete full-cycle build, verification, and deploy."""
    print(f"\n{Colors.BOLD}=== ANTIGRAVITY FULL CORE CYCLE ==={Colors.RESET}\n")
    if not check_syntax():
        sys.exit(1)
    if not sync_core_files():
        sys.exit(1)
    if not sync_skills():
        sys.exit(1)
    if not repack_asar():
        sys.exit(1)
    if not run_tests():
        sys.exit(1)
    print(f"\n{Colors.GREEN}{Colors.BOLD}=== FULL CYCLE COMPLETED SUCCESSFULLY (100% INVARIANTS VERIFIED) ==={Colors.RESET}\n")

def main():
    parser = argparse.ArgumentParser(description="Antigravity Core Developer Utility")
    parser.add_argument("action", choices=["check", "sync", "sync-skills", "repack", "test", "full-cycle"],
                        help="Action to execute")
    args = parser.parse_args()

    if args.action == "check":
        ok = check_syntax()
        sys.exit(0 if ok else 1)
    elif args.action == "sync":
        sync_core_files()
    elif args.action == "sync-skills":
        sync_skills()
    elif args.action == "repack":
        sync_core_files()
        ok = repack_asar()
        sys.exit(0 if ok else 1)
    elif args.action == "test":
        ok = run_tests()
        sys.exit(0 if ok else 1)
    elif args.action == "full-cycle":
        full_cycle()

if __name__ == "__main__":
    main()
