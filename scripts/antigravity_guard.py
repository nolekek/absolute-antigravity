"""
Antigravity Guard & Watchdog Launcher (Universal Windows & Linux)
Ensures that Google auto-updates never wipe:
1. Eligibility patch in language_server (offsets/signatures for region and access bypass)
2. Multi-Account carousel widget & external OAuth handlers in app.asar

Runs in <50ms before launching Antigravity.
"""

import os
import sys
import shutil
import subprocess
import glob

GEMINI_DIR = os.path.expanduser(r"~/.gemini/antigravity")
GEMINI_BIN = os.path.join(GEMINI_DIR, "bin")
MASTER_ASAR = os.path.join(GEMINI_BIN, "app.asar.patched_master")
CRED_HELPER_SRC = os.path.join(GEMINI_BIN, "credHelper.py")
MANAGER_SCRIPT = os.path.join(GEMINI_BIN, "manager.py")

def find_antigravity_paths():
    if sys.platform == "win32":
        programs_dir = os.path.expandvars(r"%LOCALAPPDATA%\Programs\antigravity")
        resources_dir = os.path.join(programs_dir, "resources")
        exe_path = os.path.join(programs_dir, "Antigravity.exe")
        ls_path = os.path.join(resources_dir, "bin", "language_server.exe")
    else:
        # Linux / POSIX
        candidates = [
            "/opt/Antigravity",
            "/opt/antigravity",
            os.path.expanduser("~/.local/share/antigravity"),
            "/usr/lib/antigravity",
            "/usr/share/antigravity",
        ]
        programs_dir = None
        for c in candidates:
            if os.path.exists(os.path.join(c, "resources", "app.asar")):
                programs_dir = c
                break
        if not programs_dir:
            w = shutil.which("antigravity")
            if w:
                real = os.path.realpath(w)
                p = os.path.dirname(real)
                if os.path.exists(os.path.join(p, "resources", "app.asar")):
                    programs_dir = p
        if not programs_dir:
            programs_dir = "/opt/Antigravity"
        resources_dir = os.path.join(programs_dir, "resources")
        exe_path = os.path.join(programs_dir, "antigravity")
        ls_path = os.path.join(resources_dir, "bin", "language_server")

    return {
        "programs_dir": programs_dir,
        "resources_dir": resources_dir,
        "exe_path": exe_path,
        "ls_path": ls_path,
        "asar_path": os.path.join(resources_dir, "app.asar"),
        "unpacked_dist": os.path.join(resources_dir, "app.asar.unpacked", "dist"),
        "cred_helper_dest": os.path.join(resources_dir, "app.asar.unpacked", "dist", "credHelper.py")
    }

def patch_language_server(paths):
    # Try manager.py if present
    if os.path.exists(MANAGER_SCRIPT):
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("manager", MANAGER_SCRIPT)
            mgr = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mgr)
            mgr.run("patch", ["manager"], {})
            return True
        except Exception:
            pass

    # Windows fallback direct signature patch if manager.py is not reachable
    ls_path = paths["ls_path"]
    if not os.path.exists(ls_path):
        return False

    prefix_sig = bytes.fromhex("4885db7541")
    stock_bytes = bytes.fromhex("80780800743b")
    patched_bytes = bytes.fromhex("c64008019090")
    suffix_sig = bytes.fromhex("488b5424")

    try:
        with open(ls_path, "rb") as f:
            data = f.read()

        target_seq = prefix_sig + patched_bytes + suffix_sig
        if target_seq in data:
            return True

        stock_seq = prefix_sig + stock_bytes + suffix_sig
        idx = data.find(stock_seq)
        if idx != -1:
            bak_path = ls_path + ".agybak"
            if not os.path.exists(bak_path):
                try:
                    shutil.copy2(ls_path, bak_path)
                except Exception:
                    pass
            patched_data = data[:idx] + target_seq + data[idx + len(target_seq):]
            with open(ls_path, "wb") as f:
                f.write(patched_data)
            return True
    except Exception:
        pass
    return False

def patch_app_asar(paths):
    asar_path = paths["asar_path"]
    if not os.path.exists(asar_path):
        return False

    try:
        with open(asar_path, "rb") as f:
            header = f.read(2048)
            f.seek(max(0, os.path.getsize(asar_path) - 100000))
            tail = f.read()

        is_patched = b"antigravity-multiacc-root" in tail or b"antigravity-multiacc-root" in header
        if not is_patched:
            with open(asar_path, "rb") as f:
                is_patched = b"antigravity-multiacc-root" in f.read()

        if not is_patched and os.path.exists(MASTER_ASAR):
            print("[Guard] Detected stock app.asar! Restoring multi-account carousel...")
            shutil.copy2(MASTER_ASAR, asar_path)
            os.makedirs(paths["unpacked_dist"], exist_ok=True)
            if os.path.exists(CRED_HELPER_SRC):
                shutil.copy2(CRED_HELPER_SRC, paths["cred_helper_dest"])
            print("[Guard] Multi-account carousel restored successfully!")
            return True
    except Exception as e:
        print(f"[Guard] Warning: Failed to restore app.asar: {e}", file=sys.stderr)
    return False

def launch_antigravity(paths, args=None):
    exe_path = paths["exe_path"]
    if not os.path.exists(exe_path):
        print(f"[Guard] Error: Executable not found at {exe_path}", file=sys.stderr)
        return

    cmd = [exe_path]
    if args:
        cmd.extend(args)

    subprocess.Popen(cmd, close_fds=True)

def main():
    paths = find_antigravity_paths()
    patch_language_server(paths)
    patch_app_asar(paths)

    if "--check-only" not in sys.argv:
        launch_args = [a for a in sys.argv[1:] if a != "--check-only"]
        launch_antigravity(paths, launch_args)

if __name__ == "__main__":
    main()
