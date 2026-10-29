import os
import sys
import json
import time
import base64
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
import subprocess
import uuid
import datetime
import glob
import html
import socket
import ssl
from datetime import timezone
import threading

# --- Configuration & Paths ---
CONFIG_FILE = os.path.expanduser("~/.gemini/antigravity_telegram.json")
STATE_FILE = os.path.expanduser("~/.gemini/antigravity_bot_state.json")
CMD_FILE = os.path.expanduser("~/.gemini/antigravity_command.json")
GEMINI_DIR = os.path.expanduser("~/.gemini/antigravity")
BIN_DIR = os.path.join(GEMINI_DIR, "bin")
BRAIN_DIR = os.path.join(GEMINI_DIR, "brain")
DB_PATH = os.path.join(GEMINI_DIR, "conversation_summaries.db")
CRED_HELPER = os.path.join(BIN_DIR, "credHelper.py")
BRIDGE_URL = "http://127.0.0.1:51122"
INSTANCE_LOCK_PORT = 51123

from http.server import HTTPServer, BaseHTTPRequestHandler

class ExclusiveHTTPServer(HTTPServer):
    allow_reuse_address = False

class BotControlHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        data = {
            "ok": True,
            "running": True,
            "pid": os.getpid()
        }
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_POST(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok": true, "message": "shutting down"}')
        def shutdown_bot():
            time.sleep(0.3)
            os._exit(0)
        threading.Thread(target=shutdown_bot, daemon=True).start()

    def log_message(self, format, *args):
        pass

_lock_server = None


def acquire_instance_lock():
    global _lock_server
    try:
        server = ExclusiveHTTPServer(('127.0.0.1', INSTANCE_LOCK_PORT), BotControlHandler)
        _lock_server = server
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return True
    except OSError:
        return False


def kill_other_bot_instances():
    try:
        req = urllib.request.Request("http://127.0.0.1:51123/stop", data=b"{}", method="POST")
        urllib.request.urlopen(req, timeout=1.0)
        time.sleep(0.5)
    except Exception:
        pass

    my_pid = os.getpid()
    if os.name == "nt":
        try:
            cmd = f'Get-CimInstance Win32_Process -Filter "Name like \'python%\'" | Where-Object {{ $_.ProcessId -ne {my_pid} -and $_.CommandLine -like "*antigravity_bot.py*" }} | Select-Object -ExpandProperty ProcessId'
            out = subprocess.check_output(['powershell', '-NoProfile', '-Command', cmd], encoding='utf-8', errors='ignore')
            for line in out.splitlines():
                pid_str = line.strip()
                if pid_str and pid_str.isdigit():
                    other_pid = int(pid_str)
                    try:
                        subprocess.call(['taskkill', '/F', '/PID', str(other_pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except Exception:
                        pass
        except Exception as e:
            print(f"Error checking other bot instances: {e}", file=sys.stderr)
    else:
        import signal
        try:
            out = subprocess.check_output(['pgrep', '-f', 'antigravity_bot.py'], text=True, errors='ignore')
            for line in out.splitlines():
                pid_str = line.strip()
                if pid_str and pid_str.isdigit() and int(pid_str) != my_pid:
                    try:
                        os.kill(int(pid_str), signal.SIGTERM)
                    except Exception:
                        pass
        except Exception:
            pass


def load_bot_config():
    if not os.path.exists(CONFIG_FILE):
        return {"botToken": "", "allowedChatId": None, "enabled": False}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"botToken": "", "allowedChatId": None, "enabled": False}


def save_bot_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def load_bot_state():
    if not os.path.exists(STATE_FILE):
        return {"active_workspace": None, "active_conversation_id": None, "awaiting_mode": None}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"active_workspace": None, "active_conversation_id": None, "awaiting_mode": None}


def save_bot_state(st):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)


# --- Local HTTP Bridge to Antigravity ---

def call_bridge(endpoint, method="GET", data=None, timeout=6):
    try:
        url = f"{BRIDGE_URL}{endpoint}"
        headers = {"Content-Type": "application/json"}
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": str(e)}




# --- Quotas Integration ---

def get_antigravity_quotas():
    # 1. Try bridge direct endpoint first if available
    try:
        res = call_bridge("/api/quotas", timeout=4)
        if res.get("ok") and "data" in res:
            return res["data"]
    except Exception:
        pass

    # 2. Fallback via /api/eval + LS Connect-Web RPC
    try:
        st = call_bridge("/api/status", timeout=3)
        current_url = st.get("currentUrl")
        if not current_url:
            return None
        parsed = urllib.parse.urlparse(current_url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

        csrf_token = st.get("csrfToken")
        if not csrf_token:
            eval_res = call_bridge("/api/eval", method="POST", data={"code": "window.__APP_CONFIG__?.csrfToken"}, timeout=3)
            csrf_token = eval_res.get("result")

        if not csrf_token:
            return None

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        rpc_url = f"{base_url}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary"
        rpc_req = urllib.request.Request(
            rpc_url,
            data=json.dumps({"forceRefresh": True}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Connect-Protocol-Version": "1",
                "x-codeium-csrf-token": csrf_token
            },
            method="POST"
        )
        with urllib.request.urlopen(rpc_req, context=ctx, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error fetching quotas: {e}", file=sys.stderr)
        return None


def render_quota_bar(pct, width=8):
    pct = max(0.0, min(100.0, pct))
    filled = int(round(pct / (100 / width)))
    empty = width - filled
    if pct > 50:
        return "🟩" * filled + "⬜" * empty
    elif pct > 20:
        return "🟨" * filled + "⬜" * empty
    else:
        return "🟥" * filled + "⬜" * empty


def format_reset_time_str(iso_str):
    if not iso_str:
        return "неизвестно"
    try:
        dt = datetime.datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        now = datetime.datetime.now(timezone.utc)
        diff = dt - now
        total_sec = int(diff.total_seconds())
        if total_sec <= 0:
            return "сейчас"
        days = total_sec // 86400
        rem = total_sec % 86400
        hours = rem // 3600
        mins = (rem % 3600) // 60
        if days > 0:
            return f"{days} дн. {hours} ч." if hours > 0 else f"{days} дн."
        if hours > 0:
            return f"{hours} ч. {mins} мин." if mins > 0 else f"{hours} ч."
        return f"{max(1, mins)} мин."
    except Exception:
        return iso_str


def format_quotas_text(quota_data):
    if not quota_data or "response" not in quota_data:
        return "❌ <i>Не удалось получить данные о квотах из Antigravity. Убедитесь, что IDE запущена на ноутбуке.</i>"

    groups = quota_data.get("response", {}).get("groups", [])
    if not groups:
        return "ℹ️ <i>Информация о квотах отсутствует или пока не загрузилась.</i>"

    lines = ["⏳ <b>Квоты моделей Antigravity:</b>\n"]
    for g in groups:
        title = g.get("displayName", "Модели")
        lines.append(f"<b>🔹 {html.escape(title)}:</b>")
        buckets = g.get("buckets", [])
        for b in buckets:
            b_name = b.get("displayName") or b.get("window") or "Лимит"
            fraction = b.get("remainingFraction", 0.0)
            pct = fraction * 100
            bar = render_quota_bar(pct, width=8)
            reset_time = b.get("resetTime")
            reset_str = format_reset_time_str(reset_time)

            window = b.get("window", "").lower()
            if "5h" in window or "five" in b_name.lower():
                label = "5-часовой лимит"
            elif "weekly" in window or "недел" in b_name.lower():
                label = "Недельный лимит"
            else:
                label = b_name

            if pct >= 99.9:
                status_sub = "100% (полный)"
            else:
                status_sub = f"{pct:.1f}% (сброс: {reset_str})"

            lines.append(f"  • {label}: <b>{status_sub}</b>")
            lines.append(f"    {bar}")
        lines.append("")

    return "\n".join(lines).strip()


def get_quota_brief_summary(quota_data=None):
    if not quota_data:
        quota_data = get_antigravity_quotas()
    if not quota_data or "response" not in quota_data:
        return None
    groups = quota_data.get("response", {}).get("groups", [])
    gemini_group = next((g for g in groups if "gemini" in g.get("displayName", "").lower()), None)
    if not gemini_group and groups:
        gemini_group = groups[0]
    if not gemini_group:
        return None

    w_b = next((b for b in gemini_group.get("buckets", []) if b.get("window") == "weekly"), None)
    h_b = next((b for b in gemini_group.get("buckets", []) if b.get("window") == "5h"), None)
    parts = []
    if h_b:
        parts.append(f"5ч: <b>{h_b.get('remainingFraction', 0)*100:.0f}%</b>")
    if w_b:
        parts.append(f"Неделя: <b>{w_b.get('remainingFraction', 0)*100:.0f}%</b>")
    return " | ".join(parts) if parts else None


def send_desktop_command(action, **kwargs):
    if action == "focus_window" or action == "open_conversation":
        cid = kwargs.get("conversationId")
        if cid:
            call_bridge("/api/switch-conversation", method="POST", data={"conversationId": cid})
        else:
            call_bridge("/api/focus-window", method="POST")
    elif action == "switch_slot":
        slot = kwargs.get("slot")
        if slot:
            call_bridge("/api/switch-slot", method="POST", data={"slot": slot})

    try:
        payload = {"action": action, **kwargs}
        with open(CMD_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except Exception as e:
        print(f"Error sending desktop command: {e}", file=sys.stderr)


# --- Workspace & Conversation Utilities ---

def clean_uri(uri):
    if not uri:
        return ""
    if uri.startswith("file:///"):
        path = urllib.parse.unquote(uri[8:])
        if len(path) > 2 and path[1] == ":":
            path = path[0].upper() + path[1:]
        return os.path.normpath(path)
    return uri


def get_all_workspaces():
    workspaces = {}
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("SELECT workspace_uris FROM conversation_summaries WHERE (parent_conversation_id IS NULL OR parent_conversation_id = '') AND workspace_uris IS NOT NULL AND workspace_uris != '';")
            for (ws_json,) in cur.fetchall():
                try:
                    arr = json.loads(ws_json)
                    for u in arr:
                        p = clean_uri(u)
                        if p and os.path.isdir(p):
                            workspaces[p] = workspaces.get(p, 0) + 1
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass

    st = get_antigravity_status()
    default_ws = (st.get("activeWorkspace") if st else None) or os.getcwd()
    if os.path.isdir(default_ws) and default_ws not in workspaces:
        workspaces[default_ws] = 1

    res = []
    for path, count in sorted(workspaces.items(), key=lambda x: x[1], reverse=True):
        res.append({
            "path": path,
            "name": os.path.basename(path) or path,
            "chat_count": count
        })
    return res


def get_conversations(workspace_path=None, limit=8):
    if not os.path.exists(DB_PATH):
        return []
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries WHERE (parent_conversation_id IS NULL OR parent_conversation_id = '') ORDER BY last_modified_time DESC LIMIT 50;")
        rows = cur.fetchall()
        conn.close()
    except Exception:
        return []

    res = []
    for cid, title, ws_json, mtime in rows:
        ws_clean = ""
        try:
            arr = json.loads(ws_json)
            if arr:
                ws_clean = clean_uri(arr[0])
        except Exception:
            pass

        if workspace_path and os.path.normpath(ws_clean).lower() != os.path.normpath(workspace_path).lower():
            continue

        res.append({
            "id": cid,
            "title": title or "Без названия",
            "workspace": ws_clean,
            "workspace_name": os.path.basename(ws_clean) if ws_clean else "Общий",
            "mtime": mtime[:16] if mtime else ""
        })
        if len(res) >= limit:
            break
    return res


def get_latest_active_cid():
    st = call_bridge("/api/status")
    if st.get("ok") and st.get("activeConversationId"):
        return st.get("activeConversationId")

    try:
        transcripts = glob.glob(os.path.join(BRAIN_DIR, "*", ".system_generated", "logs", "transcript.jsonl"))
        if transcripts:
            transcripts.sort(key=lambda p: os.path.getmtime(p), reverse=True)
            latest = transcripts[0]
            cid = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(latest))))
            return cid
    except Exception:
        pass

    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("SELECT conversation_id FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 1;")
            row = cur.fetchone()
            conn.close()
            if row:
                return row[0]
        except Exception:
            pass

    return None


def get_conversation_details(cid):
    tr_path = os.path.join(BRAIN_DIR, cid, ".system_generated", "logs", "transcript.jsonl")
    last_user = ""
    last_agent = ""
    step_count = 0
    if os.path.exists(tr_path):
        try:
            with open(tr_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.strip():
                        continue
                    d = json.loads(line)
                    step_count += 1
                    if d.get("type") == "USER_INPUT" and d.get("content"):
                        txt = d["content"].replace("<USER_REQUEST>", "").replace("</USER_REQUEST>", "").strip()
                        if "<ADDITIONAL_METADATA>" in txt:
                            txt = txt[:txt.find("<ADDITIONAL_METADATA>")].strip()
                        last_user = txt
                    elif d.get("type") == "PLANNER_RESPONSE" and d.get("content"):
                        last_agent = d["content"]
        except Exception:
            pass

    artifacts = []
    brain_dir = os.path.join(BRAIN_DIR, cid)
    if os.path.exists(brain_dir):
        try:
            artifacts = [f for f in os.listdir(brain_dir) if f.endswith(".md")]
        except Exception:
            pass

    return {
        "last_user": last_user,
        "last_agent": last_agent,
        "step_count": step_count,
        "artifacts": artifacts
    }


def get_conversation_recent_history(cid, max_turns=6):
    tr_path = os.path.join(BRAIN_DIR, cid, ".system_generated", "logs", "transcript.jsonl")
    if not os.path.exists(tr_path):
        return []
    history = []
    try:
        with open(tr_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                t = d.get("type")
                if t == "USER_INPUT" and d.get("content"):
                    txt = d["content"].replace("<USER_REQUEST>", "").replace("</USER_REQUEST>", "").strip()
                    if "<ADDITIONAL_METADATA>" in txt:
                        txt = txt[:txt.find("<ADDITIONAL_METADATA>")].strip()
                    if txt:
                        history.append({"role": "user", "text": txt})
                elif t == "PLANNER_RESPONSE" and d.get("content"):
                    txt = d["content"].strip()
                    if txt:
                        history.append({"role": "assistant", "text": txt})
    except Exception:
        pass
    return history[- (max_turns * 2):]


# --- Multiacc & Credential Helper Calls ---

def get_multiacc_status():
    if not os.path.exists(CRED_HELPER):
        return None
    try:
        out = subprocess.check_output([sys.executable, CRED_HELPER, "status"], encoding="utf-8")
        return json.loads(out.strip())
    except Exception as e:
        print(f"Error getting multiacc status: {e}", file=sys.stderr)
        return None


def switch_multiacc_slot(slot_num):
    send_desktop_command("switch_slot", slot=int(slot_num))
    if not os.path.exists(CRED_HELPER):
        return None
    try:
        out = subprocess.check_output([sys.executable, CRED_HELPER, "switch", str(slot_num)], encoding="utf-8")
        return json.loads(out.strip())
    except Exception as e:
        print(f"Error switching slot: {e}", file=sys.stderr)
        return None


def transcribe_voice_via_gemini(audio_bytes, mime_type="audio/ogg"):
    cfg = load_bot_config()
    api_key = cfg.get("geminiApiKey")
    if not api_key:
        return None, "no_key"

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    b64 = base64.b64encode(audio_bytes).decode("ascii")

    payload = {
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64}},
                {"text": "Точно расшифруйте эту русскую или английскую речь в текст. Верните ТОЛЬКО расшифрованный текст, без вводных фраз и без кавычек."}
            ]
        }]
    }

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                text_parts = [p.get("text", "") for p in parts if "text" in p]
                text = "\n".join(text_parts).strip()
                return text, None
            return None, "empty_response"
    except Exception as e:
        return None, str(e)


# --- Telegram Client ---

class TelegramClient:
    def __init__(self, token):
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}"

    def api_call(self, method, data=None):
        url = f"{self.base_url}/{method}"
        headers = {"Content-Type": "application/json"}
        payload = json.dumps(data).encode("utf-8") if data else None
        req = urllib.request.Request(url, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def send_message(self, chat_id, text, reply_markup=None, parse_mode="HTML"):
        if len(text) > 4000:
            text = text[:3990] + "..."
        data = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True
        }
        if parse_mode:
            data["parse_mode"] = parse_mode
        if reply_markup:
            data["reply_markup"] = reply_markup

        res = self.api_call("sendMessage", data)
        # Fallback to plain text if HTML entity parsing failed
        if not res.get("ok") and parse_mode:
            data.pop("parse_mode", None)
            return self.api_call("sendMessage", data)
        return res

    def edit_message_text(self, chat_id, message_id, text, reply_markup=None, parse_mode="HTML"):
        if len(text) > 4000:
            text = text[:3990] + "..."
        data = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "disable_web_page_preview": True
        }
        if parse_mode:
            data["parse_mode"] = parse_mode
        if reply_markup:
            data["reply_markup"] = reply_markup

        res = self.api_call("editMessageText", data)
        if not res.get("ok") and parse_mode:
            data.pop("parse_mode", None)
            return self.api_call("editMessageText", data)
        return res

    def send_chat_action(self, chat_id, action="typing"):
        return self.api_call("sendChatAction", {"chat_id": chat_id, "action": action})

    def get_updates(self, offset=None, timeout=20):
        data = {"timeout": timeout}
        if offset:
            data["offset"] = offset
        return self.api_call("getUpdates", data)

    def get_file(self, file_id):
        return self.api_call("getFile", {"file_id": file_id})

    def download_file(self, file_path):
        url = f"https://api.telegram.org/file/bot{self.token}/{file_path}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()


# --- Keyboards ---

def get_main_reply_keyboard():
    return {
        "keyboard": [
            [{"text": "📊 Статус"}, {"text": "⏳ Квоты"}],
            [{"text": "🔄 Аккаунты"}, {"text": "📁 Папки"}],
            [{"text": "💬 Чаты"}, {"text": "➕ Новый чат"}],
            [{"text": "💻 Окно на ПК"}]
        ],
        "resize_keyboard": True
    }


def build_quotas_keyboard():
    return {
        "inline_keyboard": [
            [
                {"text": "🔄 Обновить квоты", "callback_data": "refresh_quotas"},
                {"text": "📊 Общий статус", "callback_data": "refresh_status"}
            ]
        ]
    }


def build_status_keyboard(multiacc_status):
    accounts = multiacc_status.get("accounts", []) if multiacc_status else []
    active_slot = multiacc_status.get("activeSlot", 1) if multiacc_status else 1

    buttons = []
    row = []
    for acc in accounts:
        slot = acc.get("slot")
        is_active = (slot == active_slot)
        prefix = "✅ " if is_active else ""
        row.append({
            "text": f"{prefix}Слот {slot}",
            "callback_data": f"slot:{slot}"
        })
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)

    buttons.append([
        {"text": "📁 Выбрать папку", "callback_data": "nav:folders"},
        {"text": "💬 Список чатов", "callback_data": "nav:chats"}
    ])
    buttons.append([
        {"text": "⏳ Проверить квоты", "callback_data": "nav:quotas"},
        {"text": "🔄 Обновить статус", "callback_data": "refresh_status"}
    ])
    buttons.append([
        {"text": "💻 Развернуть на ПК", "callback_data": "act:focus_pc"}
    ])
    return {"inline_keyboard": buttons}


def build_workspaces_keyboard():
    workspaces = get_all_workspaces()
    buttons = []
    for i, ws in enumerate(workspaces):
        name = ws["name"]
        count = ws["chat_count"]
        btn_text = f"📁 {name} ({count})"
        buttons.append([{"text": btn_text, "callback_data": f"ws:{i}"}])
    buttons.append([
        {"text": "💬 Все недавние чаты", "callback_data": "nav:chats"},
        {"text": "🔙 В главное меню", "callback_data": "refresh_status"}
    ])
    return {"inline_keyboard": buttons}


def build_chats_keyboard(workspace_path=None):
    convs = get_conversations(workspace_path=workspace_path, limit=8)
    buttons = []
    for c in convs:
        title = c["title"]
        if len(title) > 28:
            title = title[:26] + ".."
        ws_tag = f"[{c['workspace_name']}]" if not workspace_path else ""
        buttons.append([{
            "text": f"💬 {ws_tag} {title}",
            "callback_data": f"convo:{c['id']}"
        }])

    controls = []
    if workspace_path:
        controls.append({"text": "🌐 Все проекты", "callback_data": "nav:all_chats"})
    controls.append({"text": "➕ Новый чат", "callback_data": "nav:new_chat"})
    buttons.append(controls)
    buttons.append([{"text": "📁 Сменить папку", "callback_data": "nav:folders"}])
    return {"inline_keyboard": buttons}


def build_conversation_keyboard(cid, title):
    return {
        "inline_keyboard": [
            [
                {"text": "📝 История (шаги)", "callback_data": f"hist:{cid}"},
                {"text": "📄 Артефакты / План", "callback_data": f"art:{cid}"}
            ],
            [
                {"text": "💻 Открыть в окне на ПК", "callback_data": f"pc:{cid}"}
            ],
            [
                {"text": "🔙 К списку чатов", "callback_data": "nav:chats"},
                {"text": "📁 К папкам", "callback_data": "nav:folders"}
            ]
        ]
    }


# --- Bot Daemon ---

class AntigravityBotDaemon:
    def __init__(self):
        self.cfg = load_bot_config()
        self.state = load_bot_state()
        self.token = self.cfg.get("botToken")
        self.bot = TelegramClient(self.token) if self.token else None
        self.running = False
        self.last_update_id = 0

    def start(self):
        if not self.token:
            print("Telegram Bot Token is missing. Run setup first.", file=sys.stderr)
            return

        self.running = True
        print(f"[Antigravity Bot] Remote Commander Daemon started with token: {self.token[:10]}...")

        # Flush any stale unacknowledged backlog on startup
        try:
            init_res = self.bot.get_updates(offset=-1, timeout=1)
            if init_res.get("ok") and init_res.get("result"):
                self.last_update_id = init_res["result"][-1]["update_id"]
                # Acknowledge all prior updates immediately
                self.bot.get_updates(offset=self.last_update_id + 1, timeout=0)
        except Exception as e:
            print(f"Error flushing backlog: {e}", file=sys.stderr)

        while self.running:
            try:
                res = self.bot.get_updates(offset=self.last_update_id + 1, timeout=15)
                if res.get("ok"):
                    for update in res.get("result", []):
                        self.last_update_id = update["update_id"]
                        threading.Thread(target=self.handle_update, args=(update,), daemon=True).start()
            except Exception as e:
                time.sleep(2)

    def handle_update(self, update):
        # 1. Handle Callback Query (Inline Buttons)
        if "callback_query" in update:
            cb = update["callback_query"]
            chat_id = cb["message"]["chat"]["id"]
            user_id = cb["from"]["id"]
            allowed = self.cfg.get("allowedChatId")
            if allowed and user_id != allowed:
                return

            data = cb.get("data", "")
            self.handle_callback(chat_id, data)
            return

        # 2. Handle Messages
        msg = update.get("message")
        if not msg:
            return

        chat_id = msg["chat"]["id"]
        user_id = msg["from"]["id"]
        allowed = self.cfg.get("allowedChatId")

        # Auto-bind first user if allowedChatId is empty
        if not allowed:
            self.cfg["allowedChatId"] = user_id
            save_bot_config(self.cfg)
            allowed = user_id
            self.bot.send_message(
                chat_id,
                f"🔒 <b>Белый список настроен!</b>\nВаш Telegram ID (<code>{user_id}</code>) сохранён как единственный владелец бота.",
                reply_markup=get_main_reply_keyboard()
            )

        if user_id != allowed:
            self.bot.send_message(chat_id, "⛔ Доступ запрещен. Бот привязан к другому пользователю.")
            return

        text = msg.get("text", "").strip()
        voice = msg.get("voice")

        # Handle Commands & Reply Buttons
        if text in ("/start", "/help"):
            self.cmd_start(chat_id)
        elif text.startswith("/key"):
            parts = text.split(maxsplit=1)
            if len(parts) > 1 and parts[1].strip():
                k = parts[1].strip()
                self.cfg["geminiApiKey"] = k
                save_bot_config(self.cfg)
                self.bot.send_message(
                    chat_id,
                    "✅ <b>Ключ Gemini API сохранен!</b>\nТеперь бот может распознавать голосовые команды и отправлять их в Antigravity.",
                    reply_markup=get_main_reply_keyboard()
                )
            else:
                cur = self.cfg.get("geminiApiKey")
                masked = (cur[:6] + "..." + cur[-4:]) if cur else "не установлен"
                self.bot.send_message(
                    chat_id,
                    f"Текущий ключ: <code>{masked}</code>\n\n"
                    "Чтобы установить или сменить, отправьте:\n"
                    "<code>/key AIzaSy...</code>\n\n"
                    "<i>(Нужен только для распознавания голосовых сообщений. Текстовые задачи выполняются прямо на ноутбуке без ключей!)</i>"
                )
        elif text in ("📊 Статус", "/status"):
            self.cmd_status(chat_id)
        elif text in ("⏳ Квоты", "/quotas", "/quota"):
            self.cmd_quotas(chat_id)
        elif text in ("🔄 Аккаунты", "/accounts", "/switch"):
            self.cmd_accounts(chat_id)
        elif text in ("📁 Папки", "/folders", "/workspaces", "/projects"):
            self.cmd_folders(chat_id)
        elif text in ("💬 Чаты", "/chats", "/conversations", "/convo"):
            self.cmd_chats(chat_id)
        elif text in ("➕ Новый чат", "/new", "/newchat"):
            self.cmd_new_chat(chat_id)
        elif text in ("💻 Окно на ПК", "/desktop", "/focus"):
            call_bridge("/api/focus-window", method="POST")
            self.bot.send_message(chat_id, "🖥 <b>Окно Antigravity на ноутбуке развернуто и сфокусировано!</b>")
        elif voice:
            self.handle_voice(chat_id, voice)
        elif text:
            self.handle_text(chat_id, text)

    def handle_callback(self, chat_id, data):
        if data.startswith("slot:"):
            target = data.split(":")[1]
            res = switch_multiacc_slot(target)
            status = get_multiacc_status()
            kb = build_status_keyboard(status)
            active = status.get("currentEmail", "") if status else ""
            slot = status.get("activeSlot", "") if status else target
            self.bot.send_message(
                chat_id,
                f"✅ <b>Аккаунт переключен!</b>\nАктивен слот: <code>[{slot}] {html.escape(str(active))}</code>",
                reply_markup=kb
            )
        elif data == "refresh_status":
            self.cmd_status(chat_id)
        elif data in ("refresh_quotas", "nav:quotas"):
            self.cmd_quotas(chat_id)
        elif data == "nav:folders":
            self.cmd_folders(chat_id)
        elif data == "nav:chats":
            self.cmd_chats(chat_id)
        elif data == "nav:all_chats":
            self.cmd_chats(chat_id, force_all=True)
        elif data == "nav:new_chat":
            self.cmd_new_chat(chat_id)
        elif data == "act:focus_pc":
            call_bridge("/api/focus-window", method="POST")
            self.bot.send_message(chat_id, "🖥 <b>Окно Antigravity развернуто на ноутбуке!</b>")
        elif data.startswith("ws:"):
            idx = int(data.split(":")[1])
            workspaces = get_all_workspaces()
            if 0 <= idx < len(workspaces):
                ws = workspaces[idx]
                self.state["active_workspace"] = ws["path"]
                save_bot_state(self.state)
                text = (
                    f"📂 <b>Выбрана рабочая папка:</b> <code>{html.escape(ws['name'])}</code>\n"
                    f"📍 <code>{html.escape(ws['path'])}</code>\n"
                    f"💬 Чатов в проекте: <b>{ws['chat_count']}</b>"
                )
                kb = {
                    "inline_keyboard": [
                        [{"text": "💬 Чаты проекта", "callback_data": "nav:chats"}],
                        [{"text": "➕ Новый чат в этой папке", "callback_data": "nav:new_chat"}],
                        [{"text": "🔙 Все папки", "callback_data": "nav:folders"}]
                    ]
                }
                self.bot.send_message(chat_id, text, reply_markup=kb)
        elif data.startswith("convo:"):
            cid = data.split(":")[1]
            self.select_conversation(chat_id, cid)
        elif data.startswith("hist:"):
            cid = data.split(":")[1]
            self.show_conversation_history(chat_id, cid)
        elif data.startswith("art:"):
            cid = data.split(":")[1]
            self.show_conversation_artifacts(chat_id, cid)
        elif data.startswith("pc:"):
            cid = data.split(":")[1]
            call_bridge("/api/switch-conversation", method="POST", data={"conversationId": cid})
            self.bot.send_message(chat_id, "🖥 <b>Чат открыт в окне Antigravity на ноутбуке!</b>")

    def cmd_start(self, chat_id):
        welcome = (
            "🚀 <b>Antigravity Remote Controller</b>\n\n"
            "Прямое управление запущенным Antigravity на вашем ноутбуке:\n\n"
            "• <b>📁 Папки</b> — переключение рабочих проектов ноутбука\n"
            "• <b>💬 Чаты</b> — выбор сессий и открытие в окне ПК\n"
            "• <b>➕ Новый чат</b> — запуск новой задачи на ноутбуке\n"
            "• <b>🔄 Аккаунты</b> — переключение слотов Google аккаунтов\n"
            "• <b>📊 Статус</b> — текущее состояние и активный чат\n"
            "• <b>💻 Окно на ПК</b> — развернуть окно программы на ноутбуке\n\n"
            "💡 <i>Отправьте любую задачу текстом — Antigravity на ноутбуке начнёт её выполнять локально!</i>"
        )
        self.bot.send_message(chat_id, welcome, reply_markup=get_main_reply_keyboard())
        self.cmd_status(chat_id)

    def cmd_status(self, chat_id):
        status = get_multiacc_status()
        active_email = status.get("currentEmail", "Неизвестно") if status else "Недоступно"
        active_slot = status.get("activeSlot", 1) if status else 1
        accounts = status.get("accounts", []) if status else []
        failover = "🟢 ВКЛ" if (status and status.get("autoFailover")) else "🔴 ВЫКЛ"

        bridge_st = call_bridge("/api/status")
        bridge_alive = "🟢 Подключен" if bridge_st.get("ok") else "🔴 Не отвечает"

        st = get_antigravity_status()
        act_ws = st.get("activeWorkspace") if st else None
        ws_path = self.state.get("active_workspace") or act_ws or os.getcwd()
        ws_name = os.path.basename(ws_path) or ws_path

        active_cid = bridge_st.get("activeConversationId") or self.state.get("active_conversation_id")
        cid_title = "Не выбран"
        if active_cid:
            convs = get_conversations(limit=25)
            for c in convs:
                if c["id"] == active_cid:
                    cid_title = c["title"]
                    break

        quota_summary = get_quota_brief_summary()
        quota_line = f"⏳ <b>Квоты Gemini:</b> {quota_summary}\n" if quota_summary else ""

        msg = (
            f"📊 <b>Статус локального Antigravity:</b>\n\n"
            f"💻 <b>Мост с окном ПК:</b> {bridge_alive}\n"
            f"👤 <b>Аккаунт:</b> <code>[{active_slot}/{len(accounts)}] {html.escape(str(active_email))}</code>\n"
            f"{quota_line}"
            f"⚡ <b>Автопереход квот:</b> {failover}\n"
            f"📂 <b>Активная папка:</b> <code>{html.escape(str(ws_name))}</code>\n"
            f"💬 <b>Активный чат:</b> {html.escape(str(cid_title))}\n"
        )
        kb = build_status_keyboard(status)
        self.bot.send_message(chat_id, msg, reply_markup=kb)

    def cmd_quotas(self, chat_id):
        quotas = get_antigravity_quotas()
        text = format_quotas_text(quotas)
        kb = build_quotas_keyboard()
        self.bot.send_message(chat_id, text, reply_markup=kb)

    def cmd_accounts(self, chat_id):
        status = get_multiacc_status()
        kb = build_status_keyboard(status)
        self.bot.send_message(chat_id, "🔄 <b>Выберите аккаунт для переключения:</b>", reply_markup=kb)

    def cmd_folders(self, chat_id):
        workspaces = get_all_workspaces()
        if not workspaces:
            self.bot.send_message(chat_id, "📁 <i>Активных рабочих папок не найдено.</i>")
            return
        kb = build_workspaces_keyboard()
        self.bot.send_message(
            chat_id,
            f"📁 <b>Рабочие папки и проекты ({len(workspaces)}):</b>\nНажмите на проект для выбора:",
            reply_markup=kb
        )

    def cmd_chats(self, chat_id, force_all=False):
        ws_path = None if force_all else self.state.get("active_workspace")
        convs = get_conversations(workspace_path=ws_path, limit=8)
        if not convs:
            if ws_path:
                self.bot.send_message(
                    chat_id,
                    f"💬 В папке <code>{html.escape(os.path.basename(ws_path))}</code> пока нет сохраненных чатов.\nСоздайте новый через кнопку ниже!",
                    reply_markup={"inline_keyboard": [[{"text": "➕ Создать чат", "callback_data": "nav:new_chat"}], [{"text": "🌐 Все чаты", "callback_data": "nav:all_chats"}]]}
                )
            else:
                self.bot.send_message(chat_id, "💬 <i>Чатов не найдено.</i>")
            return

        kb = build_chats_keyboard(workspace_path=ws_path)
        ws_label = f"в проекте <code>{html.escape(os.path.basename(ws_path))}</code>" if ws_path else "всех проектов"
        self.bot.send_message(chat_id, f"💬 <b>Недавние чаты ({ws_label}):</b>", reply_markup=kb)

    def select_conversation(self, chat_id, cid):
        self.state["active_conversation_id"] = cid
        save_bot_state(self.state)

        call_bridge("/api/switch-conversation", method="POST", data={"conversationId": cid})

        details = get_conversation_details(cid)
        convs = get_conversations(limit=40)
        title = "Чат"
        ws_name = "Общий"
        for c in convs:
            if c["id"] == cid:
                title = c["title"]
                ws_name = c["workspace_name"]
                if c.get("workspace"):
                    self.state["active_workspace"] = c["workspace"]
                    save_bot_state(self.state)
                break

        last_user = details["last_user"] or "Нет сообщений"
        if len(last_user) > 200:
            last_user = last_user[:197] + "..."

        last_agent = details["last_agent"] or "Нет ответа"
        if len(last_agent) > 350:
            last_agent = last_agent[:347] + "..."

        text = (
            f"🏷 <b>Чат:</b> {html.escape(title)}\n"
            f"📂 <b>Проект:</b> <code>{html.escape(ws_name)}</code>\n"
            f"📊 <b>Всего шагов:</b> {details['step_count']}\n"
            f"💻 <i>Открыт на экране ноутбука</i>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👤 <b>Вы:</b>\n<blockquote>{html.escape(last_user)}</blockquote>\n\n"
            f"🤖 <b>Antigravity:</b>\n<blockquote>{html.escape(last_agent)}</blockquote>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💡 <i>Отправьте сообщение, чтобы продолжить работу в этом чате.</i>"
        )
        kb = build_conversation_keyboard(cid, title)
        self.bot.send_message(chat_id, text, reply_markup=kb)

    def show_conversation_history(self, chat_id, cid):
        history = get_conversation_recent_history(cid, max_turns=6)
        if not history:
            self.bot.send_message(chat_id, "📝 <i>История пуста или файл лога пока не содержит завершенных шагов.</i>")
            return

        out = f"📝 <b>История чата (последние {len(history)} сообщений):</b>\n\n"
        for h in history:
            role = "👤 <b>Вы:</b>" if h["role"] == "user" else "🤖 <b>Antigravity:</b>"
            raw_text = h["text"]
            if len(raw_text) > 600:
                raw_text = raw_text[:590] + "..."
            out += f"{role}\n<blockquote>{html.escape(raw_text)}</blockquote>\n\n"

        kb = {
            "inline_keyboard": [
                [{"text": "🔄 Обновить историю", "callback_data": f"hist:{cid}"}],
                [{"text": "🔙 К чату", "callback_data": f"convo:{cid}"}]
            ]
        }
        self.bot.send_message(chat_id, out, reply_markup=kb)

    def show_conversation_artifacts(self, chat_id, cid):
        brain_dir = os.path.join(BRAIN_DIR, cid)
        if not os.path.exists(brain_dir):
            self.bot.send_message(chat_id, "📄 <i>Артефакты не найдены.</i>")
            return
        files = [f for f in os.listdir(brain_dir) if f.endswith(".md")]
        if not files:
            self.bot.send_message(chat_id, "📄 <i>В этом чате пока нет созданных планов или артефактов.</i>")
            return

        out = f"📄 <b>Артефакты и планы чата ({len(files)}):</b>\n\n"
        for fn in files:
            fp = os.path.join(brain_dir, fn)
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read().strip()
                out += f"<b>📑 {html.escape(fn)}</b>\n<pre>{html.escape(content[:600])}</pre>\n\n"
            except Exception:
                pass

        kb = {"inline_keyboard": [[{"text": "🔙 К чату", "callback_data": f"convo:{cid}"}]]}
        self.bot.send_message(chat_id, out, reply_markup=kb)

    def cmd_new_chat(self, chat_id):
        st = get_antigravity_status()
        act_ws = st.get("activeWorkspace") if st else None
        ws_path = self.state.get("active_workspace") or act_ws or os.getcwd()
        ws_name = os.path.basename(ws_path)
        self.state["awaiting_mode"] = "new_chat"
        save_bot_state(self.state)

        call_bridge("/api/new-conversation", method="POST")

        msg = (
            f"✨ <b>Создание нового чата</b>\n"
            f"📂 <b>Проект:</b> <code>{html.escape(ws_name)}</code>\n"
            f"💻 <i>На ноутбуке открыт чистый диалог</i>\n\n"
            f"Отправьте задачу текстом или голосом — Antigravity на ноутбуке немедленно начнёт работу!"
        )
        self.bot.send_message(chat_id, msg)

    def handle_voice(self, chat_id, voice):
        file_id = voice["file_id"]
        self.bot.send_chat_action(chat_id, "record_voice")
        finfo = self.bot.get_file(file_id)
        if not finfo.get("ok"):
            self.bot.send_message(chat_id, "❌ Не удалось загрузить аудиофайл из Telegram.")
            return

        file_path = finfo["result"]["file_path"]
        audio_bytes = self.bot.download_file(file_path)

        self.bot.send_chat_action(chat_id, "typing")
        transcribed, err = transcribe_voice_via_gemini(audio_bytes)
        if err == "no_key":
            self.bot.send_message(
                chat_id,
                "🎤 <b>Для голосовых команд нужен бесплатный ключ Gemini API</b> (для распознавания речи).\n\n"
                "👉 Получите за 1 минуту: <a href=\"https://aistudio.google.com/apikey\">aistudio.google.com/apikey</a>\n"
                "И отправьте сюда команду:\n"
                "<code>/key AIzaSyВашКлюч...</code>\n\n"
                "<i>(Или просто отправьте задачу обычным текстом — текстовые задачи работают локально без ключей!)</i>"
            )
            return
        elif err or not transcribed:
            self.bot.send_message(chat_id, f"❌ Ошибка распознавания речи: {err or 'не удалось разобрать слова'}")
            return

        self.bot.send_message(chat_id, f"🎤 <i>Распознано:</i> «<b>{html.escape(transcribed)}</b>»")
        self.execute_user_prompt(chat_id, prompt=transcribed)

    def handle_text(self, chat_id, text):
        self.execute_user_prompt(chat_id, prompt=text)

    def execute_user_prompt(self, chat_id, prompt=""):
        if not prompt or not prompt.strip():
            return

        st = call_bridge("/api/status")
        if not st.get("ok"):
            self.bot.send_message(
                chat_id,
                "❌ <b>Локальный Antigravity не отвечает</b> (порт 51122).\n"
                "Убедитесь, что клиент Antigravity запущен на ноутбуке."
            )
            return

        awaiting = self.state.get("awaiting_mode")
        target_cid = None if awaiting == "new_chat" else self.state.get("active_conversation_id")

        status_text = f"⏳ <b>Задача передана в Antigravity на ноутбуке...</b>\n\n<blockquote>{html.escape(prompt[:250])}</blockquote>"
        sent = self.bot.send_message(chat_id, status_text)
        status_msg_id = sent.get("result", {}).get("message_id") if sent.get("ok") else None

        if awaiting == "new_chat":
            call_bridge("/api/new-conversation", method="POST")
            time.sleep(0.4)
            inject_res = call_bridge("/api/inject-prompt", method="POST", data={"prompt": prompt})
            self.state["awaiting_mode"] = None
            save_bot_state(self.state)
        else:
            inject_res = call_bridge("/api/inject-prompt", method="POST", data={"prompt": prompt, "conversationId": target_cid})

        res_payload = inject_res.get("result", {})
        if not inject_res.get("ok") or (isinstance(res_payload, dict) and not res_payload.get("ok")):
            err_msg = inject_res.get("error") or (res_payload.get("error") if isinstance(res_payload, dict) else "Ошибка инъекции в чат")
            if status_msg_id:
                self.bot.edit_message_text(chat_id, status_msg_id, f"❌ Ошибка отправки в Antigravity: {html.escape(str(err_msg))}")
            else:
                self.bot.send_message(chat_id, f"❌ Ошибка отправки в Antigravity: {html.escape(str(err_msg))}")
            return

        time.sleep(1.0)
        active_cid = get_latest_active_cid()
        if active_cid:
            self.state["active_conversation_id"] = active_cid
            save_bot_state(self.state)

        self.stream_execution_progress(chat_id, status_msg_id, active_cid, prompt)

    def stream_execution_progress(self, chat_id, status_msg_id, cid, prompt):
        if not cid:
            time.sleep(2.0)
            cid = get_latest_active_cid()
            if not cid:
                return

        tr_path = os.path.join(BRAIN_DIR, cid, ".system_generated", "logs", "transcript.jsonl")

        existing_count = 0
        if os.path.exists(tr_path):
            try:
                with open(tr_path, "r", encoding="utf-8", errors="ignore") as f:
                    existing_count = sum(1 for l in f if l.strip())
            except Exception:
                pass

        last_status_update = 0
        last_action_desc = "Запуск агента..."
        final_response = None
        max_wait_seconds = 900
        start_time = time.time()

        while time.time() - start_time < max_wait_seconds:
            time.sleep(1.5)
            if not os.path.exists(tr_path):
                continue

            try:
                with open(tr_path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = [l for l in f if l.strip()]
            except Exception:
                continue

            if len(lines) <= existing_count:
                continue

            new_lines = lines[existing_count:]
            has_new_action = False

            for l in new_lines:
                try:
                    step = json.loads(l)
                except Exception:
                    continue

                stype = step.get("type")
                tool_calls = step.get("tool_calls", [])

                if tool_calls:
                    summaries = []
                    for tc in tool_calls:
                        s = tc.get("toolSummary")
                        if not s:
                            fn = tc.get("function", {}).get("name") or tc.get("name")
                            s = f"Инструмент: {fn}" if fn else "Действие с кодом"
                        summaries.append(s)
                    last_action_desc = " | ".join(summaries[:2])
                    has_new_action = True

                elif stype == "PLANNER_RESPONSE" and step.get("content"):
                    final_response = step.get("content")
                    break

            if final_response:
                break

            now = time.time()
            if has_new_action and status_msg_id and (now - last_status_update > 3.0):
                last_status_update = now
                self.bot.send_chat_action(chat_id, "typing")
                update_text = (
                    f"⚙️ <b>Antigravity выполняет задачу на ноутбуке:</b>\n\n"
                    f"<blockquote>{html.escape(prompt[:180])}</blockquote>\n\n"
                    f"▶️ <code>{html.escape(last_action_desc)}</code>\n"
                    f"<i>(Выполняется в локальном терминале/файлах...)</i>"
                )
                self.bot.edit_message_text(chat_id, status_msg_id, update_text)

        kb = build_conversation_keyboard(cid, "Текущий чат")
        if final_response:
            if status_msg_id:
                self.bot.edit_message_text(chat_id, status_msg_id, "✅ <b>Задача завершена в Antigravity!</b>")

            self.send_chunked_response(chat_id, final_response, reply_markup=kb)
        else:
            if status_msg_id:
                self.bot.edit_message_text(
                    chat_id,
                    status_msg_id,
                    "⌛ <b>Задача отправлена в Antigravity.</b>\n"
                    "Окно IDE продолжает выполнение на ноутбуке.\n"
                    "Вы можете просмотреть результат нажав «💻 Открыть в окне на ПК».",
                    reply_markup=kb
                )

    def send_chunked_response(self, chat_id, text, reply_markup=None):
        max_chunk = 3800
        if len(text) <= max_chunk:
            self.bot.send_message(chat_id, text, reply_markup=reply_markup, parse_mode="Markdown")
            return

        parts = []
        remaining = text
        while len(remaining) > max_chunk:
            split_at = remaining.rfind("\n", 0, max_chunk)
            if split_at == -1 or split_at < 2000:
                split_at = remaining.rfind(" ", 0, max_chunk)
            if split_at == -1:
                split_at = max_chunk
            parts.append(remaining[:split_at])
            remaining = remaining[split_at:].lstrip()

        if remaining:
            parts.append(remaining)

        for i, part in enumerate(parts):
            is_last = (i == len(parts) - 1)
            kb = reply_markup if is_last else None
            self.bot.send_message(chat_id, part, reply_markup=kb, parse_mode="Markdown")
            time.sleep(0.3)


def send_push_notification(text):
    cfg = load_bot_config()
    token = cfg.get("botToken")
    chat_id = cfg.get("allowedChatId")
    if token and chat_id:
        try:
            client = TelegramClient(token)
            client.send_message(chat_id, text)
        except Exception as e:
            print(f"[Push Alert Failed]: {e}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "notify":
        msg = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "Alert from Antigravity"
        send_push_notification(msg)
    else:
        if not acquire_instance_lock():
            print("[Antigravity Bot] Another instance is already running on port 51123. Exiting.", file=sys.stderr)
            sys.exit(0)

        daemon = AntigravityBotDaemon()
        daemon.start()
