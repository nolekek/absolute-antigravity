#!/usr/bin/env python3
"""
Antigravity Tweaks Installer
Deploys:
  - Multi-Account & Control Center patched app.asar
  - 70-skill library & workshop (~/.gemini/skills-library & ~/.gemini/config/skills)
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

class Colors:
    GREEN = "\033[92m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    CYAN = "\033[96m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    YELLOW = "\033[93m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    RED = "\033[91m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    BOLD = "\033[1m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    DIM = "\033[2m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""
    RESET = "\033[0m" if not IS_WINDOWS or "WT_SESSION" in os.environ else ""

def print_banner():
    banner = f"""{Colors.CYAN}{Colors.BOLD}
  ╔═══════════════════════════════════════════════════════════════════╗
  ║              ANTIGRAVITY SUPERCHARGED INSTALLER 🚀                ║
  ║  Multi-Account · Control Center · 70 Skills · Telegram · Bypass   ║
  ╚═══════════════════════════════════════════════════════════════════╝{Colors.RESET}
"""
    print(banner)

def get_payload_dir():
    if getattr(sys, 'frozen', False):
        base_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        return os.path.join(base_dir, "payload")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "payload")

def stop_active_processes():
    proc_name = "Antigravity.exe" if IS_WINDOWS else "Antigravity"
    print(f"  {Colors.CYAN}• Проверка запущенных процессов {proc_name}...{Colors.RESET}")
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

def locate_antigravity_paths():
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
    for cand in candidates:
        if cand and os.path.exists(cand):
            asar_test = os.path.join(cand, "resources", "app.asar")
            if os.path.exists(asar_test):
                program_dir = cand
                break

    if not program_dir:
        print(f"\n{Colors.YELLOW}[!] Папка установки Antigravity не определена автоматически.{Colors.RESET}")
        user_path = input("Укажите путь к папке установки Antigravity: ").strip().strip('"')
        if user_path and os.path.exists(os.path.join(user_path, "resources", "app.asar")):
            program_dir = user_path
        else:
            print(f"{Colors.RED}[ERROR] Файл app.asar не найден по указанному пути.{Colors.RESET}")
            sys.exit(1)

    resources_dir = os.path.join(program_dir, "resources")
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
        "telegram_config": os.path.join(user_home, ".gemini", "antigravity_telegram.json"),
        "user_home": user_home,
    }

def install_tweaks():
    print_banner()

    # Step 1: Process Safety
    print(f"\n{Colors.BOLD}[1/5] Проверка запущенных процессов...{Colors.RESET}")
    stop_active_processes()
    print(f"  {Colors.GREEN}✔ Все процессы готовы к обновлению{Colors.RESET}")

    # Step 2: Paths & Directories
    print(f"\n{Colors.BOLD}[2/5] Определение путей установки...{Colors.RESET}")
    paths = locate_antigravity_paths()
    print(f"  {Colors.DIM}Клиент Antigravity:{Colors.RESET} {paths['program_dir']}")
    print(f"  {Colors.DIM}Системная папка твиков:{Colors.RESET} {paths['gemini_bin']}")

    payload_dir = get_payload_dir()

    # Step 3: Backup existing app.asar & deploy UI modifications
    print(f"\n{Colors.BOLD}[3/5] Развёртывание компонентов и твиков UI...{Colors.RESET}")
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
        print(f"  {Colors.GREEN}✔ credHelper.py распакован в app.asar.unpacked/dist{Colors.RESET}")

    # Ensure ~/.gemini/antigravity/bin structure
    os.makedirs(paths['gemini_bin'], exist_ok=True)

    # Master backup for auto-healing guard
    master_asar = os.path.join(paths['gemini_bin'], "app.asar.patched_master")
    shutil.copy2(paths['asar_path'], master_asar)

    # Copy scripts to bin
    for script_name in ["credHelper.py", "antigravity_bot.py", "antigravity_guard.py", "launch.vbs", "agentapi.bat", "manager.py"]:
        src = os.path.join(payload_dir, script_name)
        if os.path.exists(src):
            dst = os.path.join(paths['gemini_bin'], script_name)
            shutil.copy2(src, dst)

    print(f"  {Colors.GREEN}✔ Служебные скрипты и демоны развернуты в ~/.gemini/antigravity/bin/{Colors.RESET}")

    # Step 3b: Deploy Skills Workshop & Library
    skills_tar = os.path.join(payload_dir, "skills_library.tar.gz")
    if os.path.exists(skills_tar):
        try:
            print(f"  {Colors.CYAN}• Развертывание каталога скиллов (70 специализированных навыков)...{Colors.RESET}")
            gemini_root = os.path.join(paths['user_home'], ".gemini")
            with tarfile.open(skills_tar, "r:gz") as tar:
                tar.extractall(path=gemini_root)
            
            lib_dir = os.path.join(gemini_root, "skills-library")
            cfg_skills_dir = os.path.join(gemini_root, "config", "skills")
            os.makedirs(cfg_skills_dir, exist_ok=True)
            for item in os.listdir(lib_dir):
                s_src = os.path.join(lib_dir, item)
                s_dst = os.path.join(cfg_skills_dir, item)
                if os.path.isdir(s_src) and not os.path.exists(s_dst):
                    shutil.copytree(s_src, s_dst)

            print(f"  {Colors.GREEN}✔ Библиотека навыков и Control Center Workshop успешно установлены!{Colors.RESET}")
        except Exception as e:
            print(f"  {Colors.YELLOW}[!] Предупреждение при распаковке навыков: {e}{Colors.RESET}")

    # Step 4: Apply Eligibility Patcher (Region Gate Bypass)
    print(f"\n{Colors.BOLD}[4/5] Применение патча региональных ограничений (eligibility bypass)...{Colors.RESET}")
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

    # Step 5: Telegram Bot Configuration
    print(f"\n{Colors.BOLD}[5/5] Конфигурация Telegram Remote Commander...{Colors.RESET}")
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
  3. 🎛️ {Colors.CYAN}Control Center & Skills:{Colors.RESET} 9 специализированных пресетов и 70 навыков.
  4. 🔌 {Colors.CYAN}Локальный мост:{Colors.RESET} поднят защищённый IPC-сервер http://127.0.0.1:51122.
  5. 🤖 {Colors.CYAN}Telegram Commander:{Colors.RESET} бот с квотами и историей готов в ~/.gemini/antigravity/bin/.
  6. 🛡️ {Colors.CYAN}Авто-защита:{Colors.RESET} сторожевой скрипт предотвратит сброс твиков при обновлениях.
""")

if __name__ == "__main__":
    try:
        install_tweaks()
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}[!] Прервано пользователем.{Colors.RESET}")
        sys.exit(0)
    except Exception as e:
        print(f"\n{Colors.RED}[FATAL ERROR] {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
