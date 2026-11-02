#!/usr/bin/env python3
"""
Antigravity Tweaks Installer
Deploys:
  - Multi-Account & Control Center patched app.asar
  - 101-skill library & workshop (~/.gemini/skills-library & ~/.gemini/config/skills)
  - Autonomous Rust CLI core (agy, agy-daemon) & 16 presets (~/.gemini/antigravity/bin & ~/.gemini/config)
  - Helper daemons & scripts (~/.gemini/antigravity/bin)
  - Regional Eligibility Bypass Patch
  - Telegram Remote Commander Config
"""
import os
import sys
import shutil
import gzip
import tarfile
import json
import subprocess
import importlib.util
from datetime import datetime

IS_WINDOWS = sys.platform == "win32"
if IS_WINDOWS:
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

class Colors:
    GREEN = "\033[92m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    CYAN = "\033[96m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    YELLOW = "\033[93m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    RED = "\033[91m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    BOLD = "\033[1m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    DIM = "\033[2m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    RESET = "\033[0m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""

def print_banner():
    try:
        banner = f"""{Colors.CYAN}{Colors.BOLD}
  ╔═══════════════════════════════════════════════════════════════════╗
  ║              ANTIGRAVITY SUPERCHARGED INSTALLER 🚀                ║
  ║  Multi-Account · 16 Presets · 101 Skills · Rust CLI (agy) · Bypass║
  ╚═══════════════════════════════════════════════════════════════════╝{Colors.RESET}
"""
        print(banner)
    except Exception:
        print("\n=== ANTIGRAVITY SUPERCHARGED INSTALLER (STANDALONE & TWEAKS) ===\n")

def get_payload_dir():
    if getattr(sys, 'frozen', False):
        base_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        return os.path.join(base_dir, "payload")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "payload")

def stop_active_processes():
    proc_names = ["Antigravity.exe", "agy.exe", "agy-daemon.exe"] if IS_WINDOWS else ["Antigravity", "agy", "agy-daemon"]
    print(f"  {Colors.CYAN}• Проверка запущенных процессов ({', '.join(proc_names)})...{Colors.RESET}")
    for proc_name in proc_names:
        if IS_WINDOWS:
            try:
                subprocess.run(["taskkill", "/F", "/IM", proc_name, "/T"], capture_output=True, check=False)
            except Exception:
                pass
        else:
            try:
                subprocess.run(["pkill", "-f", proc_name], capture_output=True, check=False)
            except Exception:
                pass

def add_to_user_path(directory):
    if not IS_WINDOWS:
        return False
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_ALL_ACCESS)
        try:
            current_path, _ = winreg.QueryValueEx(key, "PATH")
        except FileNotFoundError:
            current_path = ""
        paths = [p.strip() for p in current_path.split(";") if p.strip()]
        norm_dir = os.path.normpath(directory)
        if not any(os.path.normpath(p).lower() == norm_dir.lower() for p in paths):
            new_path = (current_path + ";" if current_path and not current_path.endswith(";") else current_path) + norm_dir
            winreg.SetValueEx(key, "PATH", 0, winreg.REG_EXPAND_SZ, new_path)
            winreg.CloseKey(key)
            try:
                import ctypes
                HWND_BROADCAST = 0xFFFF
                WM_SETTINGCHANGE = 0x001A
                SMTO_ABORTIFHUNG = 0x0002
                result = ctypes.c_ulong()
                ctypes.windll.user32.SendMessageTimeoutW(
                    HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment",
                    SMTO_ABORTIFHUNG, 3000, ctypes.byref(result)
                )
            except Exception:
                pass
            return True
        winreg.CloseKey(key)
        return False
    except Exception:
        try:
            ps_cmd = f'$p = [Environment]::GetEnvironmentVariable("PATH", "User"); if (($p -split ";") -notcontains "{directory}") {{ [Environment]::SetEnvironmentVariable("PATH", $p + ";{directory}", "User") }}'
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, check=False)
            return True
        except Exception:
            return False

def create_dir_link(target, link_path):
    target = os.path.abspath(target)
    link_path = os.path.abspath(link_path)
    if os.path.lexists(link_path):
        try:
            if os.path.islink(link_path):
                os.unlink(link_path)
            elif os.path.isdir(link_path):
                shutil.rmtree(link_path)
            else:
                os.remove(link_path)
        except Exception:
            return False
    if IS_WINDOWS:
        try:
            res = subprocess.run(["cmd", "/c", f'mklink /J "{link_path}" "{target}"'], capture_output=True, text=True)
            if res.returncode == 0:
                return True
        except Exception:
            pass
        try:
            os.symlink(target, link_path, target_is_directory=True)
            return True
        except Exception:
            pass
    else:
        try:
            os.symlink(target, link_path, target_is_directory=True)
            return True
        except Exception:
            pass
    try:
        shutil.copytree(target, link_path)
        return True
    except Exception:
        return False

def locate_antigravity_paths(custom_path=None):
    user_home = os.path.expanduser("~")
    if IS_WINDOWS:
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            os.path.join(local_app_data, "Programs", "antigravity"),
            os.path.join(os.environ.get("ProgramFiles", ""), "antigravity"),
            os.path.join(os.environ.get("ProgramFiles(x86)", ""), "antigravity"),
        ]
        exe_name = "Antigravity.exe"
    else:
        candidates = [
            "/opt/Antigravity",
            "/opt/antigravity",
            "/opt/google/antigravity",
            os.path.join(user_home, ".local", "share", "antigravity"),
            os.path.join(user_home, ".local", "share", "Antigravity"),
            "/usr/lib/antigravity",
            "/usr/share/antigravity",
        ]
        exe_name = "antigravity"

    program_dir = None
    if custom_path:
        cand = os.path.abspath(custom_path.strip().strip('"'))
        if os.path.exists(os.path.join(cand, "resources", "app.asar")):
            program_dir = cand
        elif os.path.exists(os.path.join(cand, "app.asar")):
            program_dir = os.path.dirname(cand)
        elif os.path.exists(cand):
            program_dir = cand

    if not program_dir:
        for cand in candidates:
            if cand and os.path.exists(cand):
                asar_test = os.path.join(cand, "resources", "app.asar")
                if os.path.exists(asar_test):
                    program_dir = cand
                    break

    if not program_dir:
        print(f"\n{Colors.YELLOW}[!] Папка установки Antigravity не определена автоматически.{Colors.RESET}")
        try:
            user_path = input("Укажите путь к папке установки Antigravity: ").strip().strip('"')
        except (EOFError, KeyboardInterrupt):
            user_path = ""
        if user_path and os.path.exists(os.path.join(user_path, "resources", "app.asar")):
            program_dir = user_path
        elif user_path and os.path.exists(os.path.join(user_path, "app.asar")):
            program_dir = os.path.dirname(user_path)
        else:
            print(f"{Colors.RED}[ERROR] Файл app.asar не найден по указанному пути.{Colors.RESET}")
            sys.exit(1)

    resources_dir = os.path.join(program_dir, "resources")
    if not os.path.exists(resources_dir) and os.path.exists(os.path.join(program_dir, "app.asar")):
        resources_dir = program_dir
    asar_path = os.path.join(resources_dir, "app.asar")

    return {
        "program_dir": program_dir,
        "resources_dir": resources_dir,
        "asar_path": asar_path,
        "exe_path": os.path.join(program_dir, exe_name),
        "unpacked_dir": os.path.join(resources_dir, "app.asar.unpacked"),
        "unpacked_dist": os.path.join(resources_dir, "app.asar.unpacked", "dist"),
        "gemini_dir": os.path.join(user_home, ".gemini", "antigravity"),
        "gemini_bin": os.path.join(user_home, ".gemini", "antigravity", "bin"),
        "gemini_config": os.path.join(user_home, ".gemini", "config"),
        "telegram_config": os.path.join(user_home, ".gemini", "antigravity_telegram.json"),
        "user_home": user_home,
    }

def install_tweaks(custom_path=None):
    print_banner()

    # Step 1: Process Safety
    print(f"\n{Colors.BOLD}[1/6] Проверка запущенных процессов...{Colors.RESET}")
    stop_active_processes()
    print(f"  {Colors.GREEN}✔ Все процессы готовы к обновлению{Colors.RESET}")

    # Step 2: Paths & Directories
    print(f"\n{Colors.BOLD}[2/6] Определение путей установки...{Colors.RESET}")
    paths = locate_antigravity_paths(custom_path=custom_path)
    print(f"  {Colors.DIM}Клиент Antigravity:{Colors.RESET} {paths['program_dir']}")
    print(f"  {Colors.DIM}Системная папка бинарников:{Colors.RESET} {paths['gemini_bin']}")

    payload_dir = get_payload_dir()

    # Step 3: Backup existing app.asar & deploy UI modifications & Rust CLI binaries
    print(f"\n{Colors.BOLD}[3/6] Развёртывание компонентов, Rust CLI ядра и твиков UI...{Colors.RESET}")
    if os.path.exists(paths['asar_path']):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"app.asar.backup_{timestamp}"
        backup_path = os.path.join(paths['resources_dir'], backup_name)
        try:
            shutil.copy2(paths['asar_path'], backup_path)
            print(f"  {Colors.GREEN}✔ Создана резервная копия:{Colors.RESET} {backup_name}")
        except Exception as e:
            print(f"  {Colors.YELLOW}[!] Предупреждение: не удалось создать бэкап: {e}{Colors.RESET}")

    # Extract app.asar.gz to app.asar
    asar_gz = os.path.join(payload_dir, "app.asar.gz")
    if not os.path.exists(asar_gz):
        print(f"  {Colors.RED}[ERROR] Файл app.asar.gz отсутствует в пакете установщика!{Colors.RESET}")
        sys.exit(1)

    print(f"  {Colors.CYAN}• Распаковка модифицированного app.asar (мульти-аккаунты + Control Center)...{Colors.RESET}")
    with gzip.open(asar_gz, 'rb') as f_in, open(paths['asar_path'], 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)
    print(f"  {Colors.GREEN}✔ app.asar успешно установлен!{Colors.RESET}")

    # Ensure app.asar.unpacked/dist/credHelper.py exists
    os.makedirs(paths['unpacked_dist'], exist_ok=True)
    cred_src = os.path.join(payload_dir, "credHelper.py")
    if os.path.exists(cred_src):
        shutil.copy2(cred_src, os.path.join(paths['unpacked_dist'], "credHelper.py"))
        shutil.copy2(cred_src, os.path.join(paths['unpacked_dir'], "credHelper.py"))
        print(f"  {Colors.GREEN}✔ credHelper.py распакован в app.asar.unpacked/dist{Colors.RESET}")

    # Ensure resources/bin and app.asar.unpacked/bin embedded binaries
    resources_bin = os.path.join(paths['resources_dir'], "bin")
    unpacked_bin = os.path.join(paths['unpacked_dir'], "bin")
    os.makedirs(resources_bin, exist_ok=True)
    os.makedirs(unpacked_bin, exist_ok=True)

    bin_executables = ["agy.exe", "agy-daemon.exe"] if IS_WINDOWS else ["agy", "agy-daemon"]
    for b in bin_executables:
        src_b = os.path.join(payload_dir, b)
        if os.path.exists(src_b):
            shutil.copy2(src_b, os.path.join(resources_bin, b))
            shutil.copy2(src_b, os.path.join(unpacked_bin, b))
            if not IS_WINDOWS:
                try:
                    os.chmod(os.path.join(resources_bin, b), 0o755)
                    os.chmod(os.path.join(unpacked_bin, b), 0o755)
                except Exception:
                    pass
    print(f"  {Colors.GREEN}✔ Встроенные бинарники Rust ядра развернуты в resources/bin/ и app.asar.unpacked/bin/{Colors.RESET}")

    # Ensure ~/.gemini/antigravity/bin structure
    os.makedirs(paths['gemini_bin'], exist_ok=True)

    # Master backup for auto-healing guard
    master_asar = os.path.join(paths['gemini_bin'], "app.asar.patched_master")
    shutil.copy2(paths['asar_path'], master_asar)

    # Copy Rust CLI binaries (agy, agy-daemon) and service scripts to bin
    bin_items = [
        "agy.exe", "agy-daemon.exe", "agy", "agy-daemon",
        "credHelper.py", "antigravity_bot.py", "antigravity_guard.py",
        "launch.vbs", "agentapi.bat", "manager.py"
    ]
    for item_name in bin_items:
        src = os.path.join(payload_dir, item_name)
        if os.path.exists(src):
            dst = os.path.join(paths['gemini_bin'], item_name)
            shutil.copy2(src, dst)
            if not IS_WINDOWS:
                try:
                    os.chmod(dst, 0o755)
                except Exception:
                    pass

    print(f"  {Colors.GREEN}✔ Автономные бинарники Rust CLI (agy, agy-daemon) и скрипты развернуты в ~/.gemini/antigravity/bin/{Colors.RESET}")

    # Deploy presets.yaml configuration
    presets_src = os.path.join(payload_dir, "presets.yaml")
    if os.path.exists(presets_src):
        os.makedirs(paths['gemini_config'], exist_ok=True)
        shutil.copy2(presets_src, os.path.join(paths['gemini_config'], "presets.yaml"))
        shutil.copy2(presets_src, os.path.join(paths['gemini_bin'], "presets.yaml"))
        shutil.copy2(presets_src, os.path.join(paths['resources_dir'], "presets.yaml"))
        print(f"  {Colors.GREEN}✔ Конфигурация 16 пресетов (presets.yaml) развернута в config/ и resources/{Colors.RESET}")

    # Deploy schemas/ validation
    schemas_src = os.path.join(payload_dir, "schemas")
    if os.path.exists(schemas_src):
        res_schemas = os.path.join(paths['resources_dir'], "schemas")
        cfg_schemas = os.path.join(paths['gemini_config'], "schemas")
        os.makedirs(res_schemas, exist_ok=True)
        os.makedirs(cfg_schemas, exist_ok=True)
        for item in os.listdir(schemas_src):
            shutil.copy2(os.path.join(schemas_src, item), os.path.join(res_schemas, item))
            shutil.copy2(os.path.join(schemas_src, item), os.path.join(cfg_schemas, item))
        print(f"  {Colors.GREEN}✔ JSON-схемы валидации (schemas/) развернуты в resources/schemas/ и config/schemas/{Colors.RESET}")

    # Register ~/.gemini/antigravity/bin in User PATH
    if add_to_user_path(paths['gemini_bin']):
        print(f"  {Colors.GREEN}✔ ~/.gemini/antigravity/bin добавлен в системный PATH (команда agy доступна глобально){Colors.RESET}")
    else:
        print(f"  {Colors.DIM}• ~/.gemini/antigravity/bin уже присутствует в системном PATH{Colors.RESET}")

    # Step 4: Deploy Skills Workshop & Library (101 skills, 16 presets)
    print(f"\n{Colors.BOLD}[4/6] Развёртывание каталога навыков (101 навык, 16 пресетов)...{Colors.RESET}")
    skills_tar = os.path.join(payload_dir, "skills_library.tar.gz")
    if os.path.exists(skills_tar):
        try:
            print(f"  {Colors.CYAN}• Распаковка библиотеки скиллов в ~/.gemini/skills-library...{Colors.RESET}")
            gemini_root = os.path.join(paths['user_home'], ".gemini")
            with tarfile.open(skills_tar, "r:gz") as tar:
                tar.extractall(path=gemini_root)
            
            lib_dir = os.path.join(gemini_root, "skills-library")
            cfg_skills_dir = os.path.join(gemini_root, "config", "skills")
            os.makedirs(cfg_skills_dir, exist_ok=True)

            # Synchronize active preset symlinks via agy CLI
            agy_bin = os.path.join(paths['gemini_bin'], "agy.exe" if IS_WINDOWS else "agy")
            synced_via_cli = False
            if os.path.exists(agy_bin):
                try:
                    res = subprocess.run([agy_bin, "preset", "switch", "orchestrator"], capture_output=True, text=True, timeout=10)
                    if res.returncode == 0:
                        print(f"  {Colors.GREEN}✔ Симлинки пресета оркестратора успешно синхронизированы через agy core!{Colors.RESET}")
                        synced_via_cli = True
                except Exception:
                    pass

            if not synced_via_cli and os.path.exists(lib_dir):
                for item in os.listdir(lib_dir):
                    s_src = os.path.join(lib_dir, item)
                    s_dst = os.path.join(cfg_skills_dir, item)
                    if os.path.isdir(s_src) and not os.path.exists(s_dst):
                        create_dir_link(s_src, s_dst)

            print(f"  {Colors.GREEN}✔ Библиотека навыков (101 навык) и Control Center Workshop успешно установлены!{Colors.RESET}")

            # Deploy agent-orchestrator user rules
            plugin_src = os.path.join(payload_dir, "agent-orchestrator")
            plugin_dst = os.path.join(gemini_root, "config", "plugins", "agent-orchestrator")
            if os.path.exists(plugin_src):
                os.makedirs(os.path.dirname(plugin_dst), exist_ok=True)
                if os.path.exists(plugin_dst):
                    shutil.rmtree(plugin_dst)
                shutil.copytree(plugin_src, plugin_dst)
                print(f"  {Colors.GREEN}✔ Правила авто-маршрутизации (AGENTS.md) развернуты в config/plugins/agent-orchestrator/{Colors.RESET}")

            # Deploy windows-desktop plugin
            win_plugin_src = os.path.join(payload_dir, "windows-desktop")
            win_plugin_dst = os.path.join(gemini_root, "config", "plugins", "windows-desktop")
            if os.path.exists(win_plugin_src):
                os.makedirs(os.path.dirname(win_plugin_dst), exist_ok=True)
                if os.path.exists(win_plugin_dst):
                    shutil.rmtree(win_plugin_dst)
                shutil.copytree(win_plugin_src, win_plugin_dst)
                print(f"  {Colors.GREEN}✔ Плагин Windows Desktop Automation развернут в config/plugins/windows-desktop/{Colors.RESET}")

            # Register windows-desktop MCP server in ~/.gemini/config/mcp_config.json
            mcp_cfg_path = os.path.join(gemini_root, "config", "mcp_config.json")
            mcp_data = {"mcpServers": {}}
            if os.path.exists(mcp_cfg_path):
                try:
                    with open(mcp_cfg_path, "r", encoding="utf-8") as f_mcp:
                        mcp_data = json.load(f_mcp)
                except Exception:
                    pass
            if "mcpServers" not in mcp_data:
                mcp_data["mcpServers"] = {}
            if "windows-desktop" not in mcp_data["mcpServers"]:
                mcp_data["mcpServers"]["windows-desktop"] = {
                    "command": "uvx",
                    "args": ["windows-mcp", "serve"],
                    "env": {"ANONYMIZED_TELEMETRY": "false"}
                }
                with open(mcp_cfg_path, "w", encoding="utf-8") as f_mcp:
                    json.dump(mcp_data, f_mcp, indent=2, ensure_ascii=False)
                print(f"  {Colors.GREEN}✔ MCP сервер windows-desktop зарегистрирован в {mcp_cfg_path}{Colors.RESET}")
        except Exception as e:
            print(f"  {Colors.YELLOW}[!] Предупреждение при распаковке навыков: {e}{Colors.RESET}")

    # Step 5: Apply Eligibility Patcher (Region Gate Bypass)
    print(f"\n{Colors.BOLD}[5/6] Применение патча региональных ограничений (eligibility bypass)...{Colors.RESET}")
    manager_path = os.path.join(payload_dir, "manager.py")
    if os.path.exists(manager_path):
        try:
            spec = importlib.util.spec_from_file_location("manager", manager_path)
            mgr = importlib.util.module_from_spec(spec)
            sys.modules["manager"] = mgr
            spec.loader.exec_module(mgr)

            targets = list(mgr.TARGETS)
            overrides = {t: None for t in targets}
            print(f"  {Colors.CYAN}• Патчинг компонентов: {', '.join(targets)}...{Colors.RESET}")
            res = mgr.run("patch", targets, overrides)
            if res == 0:
                print(f"  {Colors.GREEN}✔ Все найденные компоненты Antigravity успешно пропатчены!{Colors.RESET}")
            else:
                print(f"  {Colors.YELLOW}[!] Патчер завершился с кодом {res} (проверьте вывод выше){Colors.RESET}")
        except Exception as e:
            print(f"  {Colors.YELLOW}[!] Запуск патчера через подпроцесс ({e})...{Colors.RESET}")
            try:
                py_bin = "python3" if not IS_WINDOWS else sys.executable
                subprocess.run([py_bin, manager_path, "patch"], check=False)
            except Exception as e2:
                print(f"  {Colors.RED}[!] Ошибка вызова manager.py: {e2}{Colors.RESET}")

    # Step 6: Telegram Bot Configuration
    print(f"\n{Colors.BOLD}[6/6] Конфигурация Telegram Remote Commander...{Colors.RESET}")
    cfg_path = paths['telegram_config']
    existing_cfg = False
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                c = json.load(f)
                if c.get("botToken"):
                    existing_cfg = True
                    print(f"  {Colors.GREEN}✔ Обнаружена существующая конфигурация бота (токен сохранён){Colors.RESET}")
        except Exception:
            pass

    if not existing_cfg:
        print(f"  {Colors.CYAN}Telegram-бот позволяет управлять Antigravity с телефона (задачи, голос, квоты).{Colors.RESET}")
        print(f"  {Colors.DIM}Вы сможете настроить бота позже в окне Antigravity (клик правой кнопкой мыши по кнопке бота).{Colors.RESET}")

    # Summary
    print(f"\n{Colors.GREEN}{Colors.BOLD}" + "═" * 67 + f"{Colors.RESET}")
    print(f"{Colors.GREEN}{Colors.BOLD}  🎉  УСТАНОВКА УСПЕШНО ЗАВЕРШЕНА! ВСЕ ТВЕЙКИ АКТИВИРОВАНЫ!{Colors.RESET}")
    print(f"{Colors.GREEN}{Colors.BOLD}" + "═" * 67 + f"{Colors.RESET}")
    print(f"""
  {Colors.BOLD}Что готово к работе:{Colors.RESET}
  1. 🔓 {Colors.CYAN}Обход геолокации:{Colors.RESET} сняты региональные ограничения в CLI, Manager и IDE.
  2. 👥 {Colors.CYAN}Мульти-аккаунты:{Colors.RESET} панель переключения аккаунтов добавлена в окно.
  3. 📱 {Colors.CYAN}Мобильный Веб-Клиент:{Colors.RESET} LAN-панель на порту 51125 (чаты, квоты, артефакты).
  4. 🎛️ {Colors.CYAN}Control Center & Skills:{Colors.RESET} 16 сфокусированных пресетов и 101 специализированный навык.
  5. ⚡ {Colors.CYAN}Rust CLI ядро (agy):{Colors.RESET} мгновенное переключение пресетов за мс, ротация карусели аккаунтов, watchdog демон.
  6. 🔌 {Colors.CYAN}Локальный мост:{Colors.RESET} поднят защищённый IPC-сервер http://127.0.0.1:51122.
  7. 🤖 {Colors.CYAN}Telegram Commander:{Colors.RESET} бот с квотами и историей готов в ~/.gemini/antigravity/bin/.
  8. 🛡️ {Colors.CYAN}Авто-защита:{Colors.RESET} сторожевой скрипт предотвратит сброс твиков при обновлениях.
""")

def build_standalone_distro(target_dir=None, source_runtime_dir=None):
    print_banner()
    print(f"\n{Colors.BOLD}{Colors.CYAN}=== СБОРКА АВТОНОМНОГО ДИСТРИБУТИВА ANTIGRAVITY ABSOLUTE (STANDALONE) ==={Colors.RESET}\n")

    payload_dir = get_payload_dir()
    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

    if not target_dir:
        target_dir = os.path.join(repo_root, "dist", "AntigravityAbsolute")
    target_dir = os.path.abspath(target_dir)

    print(f"  {Colors.DIM}Целевая директория дистрибутива:{Colors.RESET} {target_dir}")
    os.makedirs(target_dir, exist_ok=True)

    # 1. Locate source runtime to copy Electron host files (if available)
    source_dir = None
    if source_runtime_dir and os.path.exists(source_runtime_dir):
        source_dir = os.path.abspath(source_runtime_dir)
    else:
        try:
            cand_paths = locate_antigravity_paths(custom_path=None) if not getattr(sys, 'frozen', False) else None
            if cand_paths and os.path.exists(cand_paths['program_dir']):
                source_dir = cand_paths['program_dir']
        except Exception:
            pass

    if source_dir and os.path.exists(source_dir):
        print(f"  {Colors.CYAN}• Копирование рантайма Electron из: {source_dir}...{Colors.RESET}")
        for item in os.listdir(source_dir):
            if item.lower() in ["resources", "app.asar", "app.asar.unpacked"]:
                continue
            src_item = os.path.join(source_dir, item)
            dst_item = os.path.join(target_dir, item)
            try:
                if os.path.isdir(src_item):
                    shutil.copytree(src_item, dst_item, dirs_exist_ok=True)
                else:
                    shutil.copy2(src_item, dst_item)
            except Exception:
                pass
        src_res = os.path.join(source_dir, "resources")
        if os.path.exists(src_res):
            dst_res = os.path.join(target_dir, "resources")
            os.makedirs(dst_res, exist_ok=True)
            for item in os.listdir(src_res):
                if item.startswith("app.asar") or item == "bin":
                    continue
                si = os.path.join(src_res, item)
                di = os.path.join(dst_res, item)
                try:
                    if os.path.isdir(si):
                        shutil.copytree(si, di, dirs_exist_ok=True)
                    else:
                        shutil.copy2(si, di)
                except Exception:
                    pass
        print(f"  {Colors.GREEN}✔ Базовый рантайм Electron скопирован в дистрибутив{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}[i] Базовый рантайм Electron не найден локально; создаётся автономная портативная структура компонентов.{Colors.RESET}")

    # 2. Setup resources directory structure
    resources_dir = os.path.join(target_dir, "resources")
    resources_bin = os.path.join(resources_dir, "bin")
    unpacked_dir = os.path.join(resources_dir, "app.asar.unpacked")
    unpacked_dist = os.path.join(unpacked_dir, "dist")
    unpacked_bin = os.path.join(unpacked_dir, "bin")
    distro_bin = os.path.join(target_dir, "bin")

    os.makedirs(resources_dir, exist_ok=True)
    os.makedirs(resources_bin, exist_ok=True)
    os.makedirs(unpacked_dist, exist_ok=True)
    os.makedirs(unpacked_bin, exist_ok=True)
    os.makedirs(distro_bin, exist_ok=True)

    # 3. Deploy Rust CLI binaries (agy, agy-daemon)
    print(f"  {Colors.CYAN}• Встраивание бинарников agy и agy-daemon в структуру клиента...{Colors.RESET}")
    bin_names = ["agy.exe", "agy-daemon.exe"] if IS_WINDOWS else ["agy", "agy-daemon"]
    for b in bin_names:
        b_src = os.path.join(payload_dir, b)
        if not os.path.exists(b_src):
            b_src = os.path.join(repo_root, "binaries", "windows-x64" if IS_WINDOWS else "linux-x64", b)
        if not os.path.exists(b_src):
            b_src = os.path.join(repo_root, "agy", "target", "release", b)

        if os.path.exists(b_src):
            shutil.copy2(b_src, os.path.join(resources_bin, b))
            shutil.copy2(b_src, os.path.join(unpacked_bin, b))
            shutil.copy2(b_src, os.path.join(distro_bin, b))
            if not IS_WINDOWS:
                try:
                    os.chmod(os.path.join(resources_bin, b), 0o755)
                    os.chmod(os.path.join(unpacked_bin, b), 0o755)
                    os.chmod(os.path.join(distro_bin, b), 0o755)
                except Exception:
                    pass
            print(f"    ✔ {b} встроена в resources/bin, app.asar.unpacked/bin и bin/")

    # 4. Deploy credHelper.py
    cred_src = os.path.join(payload_dir, "credHelper.py")
    if not os.path.exists(cred_src):
        cred_src = os.path.join(repo_root, "credHelper.py")
    if os.path.exists(cred_src):
        shutil.copy2(cred_src, os.path.join(unpacked_dir, "credHelper.py"))
        shutil.copy2(cred_src, os.path.join(unpacked_dist, "credHelper.py"))
        shutil.copy2(cred_src, os.path.join(distro_bin, "credHelper.py"))
        print(f"    ✔ credHelper.py развернут в app.asar.unpacked")

    # 5. Deploy presets.yaml and schemas/
    presets_src = os.path.join(payload_dir, "presets.yaml")
    if not os.path.exists(presets_src):
        presets_src = os.path.join(repo_root, "presets.yaml")
    if os.path.exists(presets_src):
        shutil.copy2(presets_src, os.path.join(resources_dir, "presets.yaml"))
        shutil.copy2(presets_src, os.path.join(target_dir, "presets.yaml"))
        print(f"    ✔ presets.yaml (16 сфокусированных пресетов) скопирован")

    schemas_src = os.path.join(payload_dir, "schemas")
    if not os.path.exists(schemas_src):
        schemas_src = os.path.join(repo_root, "schemas")
    if os.path.exists(schemas_src):
        res_schemas = os.path.join(resources_dir, "schemas")
        target_schemas = os.path.join(target_dir, "schemas")
        os.makedirs(res_schemas, exist_ok=True)
        os.makedirs(target_schemas, exist_ok=True)
        for item in os.listdir(schemas_src):
            shutil.copy2(os.path.join(schemas_src, item), os.path.join(res_schemas, item))
            shutil.copy2(os.path.join(schemas_src, item), os.path.join(target_schemas, item))
        print(f"    ✔ schemas/ (JSON-схемы валидации) скопированы")

    # 6. Deploy / pack app.asar
    target_asar = os.path.join(resources_dir, "app.asar")
    print(f"  {Colors.CYAN}• Развёртывание модифицированного app.asar...{Colors.RESET}")
    packed_direct = False
    asar_extracted = os.path.join(repo_root, "asar_extracted_228")
    if os.path.exists(asar_extracted) and shutil.which("npx"):
        try:
            print(f"    • Упаковка asar напрямую с unpack-правилами...")
            cmd = f'npx asar pack "{asar_extracted}" "{target_asar}" --unpack "{{**/chrome-devtools-mcp/**,**/credHelper.py,**/bin/**}}"'
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=repo_root)
            if res.returncode == 0 and os.path.exists(target_asar):
                packed_direct = True
                print(f"    ✔ app.asar собран напрямую из исходников с полным набором unpack-правил")
        except Exception:
            pass

    if not packed_direct:
        root_asar = os.path.join(repo_root, "app.asar")
        asar_gz = os.path.join(payload_dir, "app.asar.gz")
        if os.path.exists(root_asar):
            shutil.copy2(root_asar, target_asar)
            print(f"    ✔ Скопирован готовый app.asar из репозитория")
        elif os.path.exists(asar_gz):
            with gzip.open(asar_gz, 'rb') as f_in, open(target_asar, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
            print(f"    ✔ app.asar распакован из архива пакета payload")

    # 7. Deploy launch scripts
    launch_vbs_src = os.path.join(payload_dir, "launch.vbs")
    if not os.path.exists(launch_vbs_src):
        launch_vbs_src = os.path.join(repo_root, "scripts", "launch.vbs")
    if os.path.exists(launch_vbs_src):
        shutil.copy2(launch_vbs_src, os.path.join(target_dir, "launch.vbs"))
        shutil.copy2(launch_vbs_src, os.path.join(distro_bin, "launch.vbs"))

    if IS_WINDOWS:
        bat_launcher = os.path.join(target_dir, "AntigravityAbsolute.bat")
        with open(bat_launcher, "w", encoding="utf-8") as f:
            f.write('@echo off\r\nstart "" wscript.exe "%~dp0launch.vbs"\r\n')
    else:
        sh_launcher = os.path.join(target_dir, "launch.sh")
        with open(sh_launcher, "w", encoding="utf-8") as f:
            f.write('#!/bin/bash\nDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\n"$DIR/bin/agy-daemon" &\n"$DIR/antigravity" "$@"\n')
        try: os.chmod(sh_launcher, 0o755)
        except Exception: pass

    # 8. Copy skills library and plugins if available
    skills_src = os.path.join(repo_root, "skills-library")
    if os.path.exists(skills_src):
        dst_skills = os.path.join(target_dir, "skills-library")
        shutil.copytree(skills_src, dst_skills, dirs_exist_ok=True)
        print(f"    ✔ skills-library (101 навык) скопирована в дистрибутив")

    # Summary
    print(f"\n{Colors.GREEN}{Colors.BOLD}" + "═" * 70 + f"{Colors.RESET}")
    print(f"{Colors.GREEN}{Colors.BOLD}  🎉  АВТОНОМНЫЙ ДИСТРИБУТИВ ANTIGRAVITY ABSOLUTE УСПЕШНО СОБРАН!{Colors.RESET}")
    print(f"{Colors.GREEN}{Colors.BOLD}" + "═" * 70 + f"{Colors.RESET}")
    print(f"""
  {Colors.BOLD}Расположение дистрибутива:{Colors.RESET} {target_dir}
  {Colors.BOLD}Состав сборки:{Colors.RESET}
  1. 📦 {Colors.CYAN}resources/app.asar:{Colors.RESET} модифицированный мульти-аккаунт клиент + Control Center.
  2. 📂 {Colors.CYAN}resources/app.asar.unpacked/bin/:{Colors.RESET} встроенные бинарники agy и agy-daemon.
  3. 📂 {Colors.CYAN}resources/bin/:{Colors.RESET} встроенные бинарники Rust ядра для быстрого доступа.
  4. 📋 {Colors.CYAN}resources/presets.yaml & schemas/:{Colors.RESET} 16 пресетов и JSON-схемы валидации.
  5. 🚀 {Colors.CYAN}launch.vbs & AntigravityAbsolute.bat:{Colors.RESET} запуск клиента с автоматическим управлением демоном.
  6. 📚 {Colors.CYAN}skills-library/:{Colors.RESET} полный каталог из 101 профессионального навыка.
""")
    return target_dir

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Antigravity Supercharged Tweaks & Eligibility Installer / Standalone Distro Builder")
    parser.add_argument("-p", "--path", help="Путь к папке установки Antigravity")
    parser.add_argument("--standalone", "--distro", "-s", "-d", dest="standalone",
                        nargs="?", const="", default=None,
                        help="Сборка/установка автономного дистрибутива 'Antigravity Absolute' (Standalone Distro)")
    parser.add_argument("--source", help="Исходный каталог Antigravity для копирования рантайма при сборке standalone")
    args = parser.parse_args()
    try:
        if args.standalone is not None:
            build_standalone_distro(target_dir=args.standalone if args.standalone != "" else None,
                                   source_runtime_dir=args.source or args.path)
        else:
            install_tweaks(custom_path=args.path)
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}[!] Прервано пользователем.{Colors.RESET}")
        sys.exit(0)
    except Exception as e:
        print(f"\n{Colors.RED}[FATAL ERROR] {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
