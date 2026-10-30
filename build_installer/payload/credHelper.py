import os
import sys
import json
import base64
import time
import subprocess
import shutil
import stat

IS_WINDOWS = sys.platform == 'win32'

if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes
    advapi32 = ctypes.windll.advapi32

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ('Flags', wintypes.DWORD),
            ('Type', wintypes.DWORD),
            ('TargetName', wintypes.LPWSTR),
            ('Comment', wintypes.LPWSTR),
            ('LastWritten', wintypes.FILETIME),
            ('CredentialBlobSize', wintypes.DWORD),
            ('CredentialBlob', ctypes.c_char_p),
            ('Persist', wintypes.DWORD),
            ('AttributeCount', wintypes.DWORD),
            ('Attributes', ctypes.c_void_p),
            ('TargetAlias', wintypes.LPWSTR),
            ('UserName', wintypes.LPWSTR),
        ]

TARGET_ACTIVE = 'gemini:antigravity'
TARGET_PRIMARY = 'gemini:antigravity_primary'
TARGET_RESERVE = 'gemini:antigravity_reserve'
SLOT_TARGET_PREFIX = 'gemini:antigravity_slot_'
MAX_SLOTS = 4

CONFIG_PATH = os.path.expanduser('~/.gemini/antigravity_multiacc.json')
VAULT_PATH = os.path.expanduser('~/.gemini/credentials_vault.json')

def get_slot_target(slot_num):
    return f"{SLOT_TARGET_PREFIX}{slot_num}"

def _vault_read(target):
    if not os.path.exists(VAULT_PATH):
        return None
    try:
        with open(VAULT_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get(target)
    except Exception:
        return None

def _vault_write(target, data_str):
    try:
        os.makedirs(os.path.dirname(VAULT_PATH), exist_ok=True)
        current = {}
        if os.path.exists(VAULT_PATH):
            try:
                with open(VAULT_PATH, 'r', encoding='utf-8') as f:
                    current = json.load(f)
            except Exception:
                pass
        current[target] = data_str
        with open(VAULT_PATH, 'w', encoding='utf-8') as f:
            json.dump(current, f, indent=2)
        try:
            os.chmod(VAULT_PATH, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass
        return True
    except Exception:
        return False

def _vault_delete(target):
    if not os.path.exists(VAULT_PATH):
        return True
    try:
        with open(VAULT_PATH, 'r', encoding='utf-8') as f:
            current = json.load(f)
        if target in current:
            del current[target]
            with open(VAULT_PATH, 'w', encoding='utf-8') as f:
                json.dump(current, f, indent=2)
            try:
                os.chmod(VAULT_PATH, stat.S_IRUSR | stat.S_IWUSR)
            except Exception:
                pass
        return True
    except Exception:
        return False

def read_cred(target):
    if IS_WINDOWS:
        pcred = ctypes.POINTER(CREDENTIAL)()
        if advapi32.CredReadW(target, 1, 0, ctypes.byref(pcred)):
            blob = ctypes.string_at(pcred.contents.CredentialBlob, pcred.contents.CredentialBlobSize)
            advapi32.CredFree(pcred)
            return blob.decode('utf-8', errors='ignore')
        return None
    else:
        if shutil.which('secret-tool'):
            try:
                res = subprocess.run(['secret-tool', 'lookup', 'service', target], capture_output=True, text=True, timeout=2.0)
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
            except Exception:
                pass
        return _vault_read(target)

def write_cred(target, data_str, user_name='antigravity'):
    if IS_WINDOWS:
        blob = data_str.encode('utf-8')
        c = CREDENTIAL()
        c.Flags = 0
        c.Type = 1 # CRED_TYPE_GENERIC
        c.TargetName = target
        c.Comment = 'Antigravity MultiAcc'
        c.CredentialBlobSize = len(blob)
        c.CredentialBlob = blob
        c.Persist = 2 # Local machine
        c.AttributeCount = 0
        c.Attributes = None
        c.TargetAlias = None
        c.UserName = user_name
        return bool(advapi32.CredWriteW(ctypes.byref(c), 0))
    else:
        success = False
        if shutil.which('secret-tool'):
            try:
                res = subprocess.run(
                    ['secret-tool', 'store', f'--label=Antigravity ({target})', 'service', target, 'user', user_name],
                    input=data_str, text=True, capture_output=True, timeout=2.0
                )
                if res.returncode == 0:
                    success = True
            except Exception:
                pass
        vault_ok = _vault_write(target, data_str)
        return success or vault_ok

def delete_cred(target):
    if IS_WINDOWS:
        return bool(advapi32.CredDeleteW(target, 1, 0))
    else:
        if shutil.which('secret-tool'):
            try:
                subprocess.run(['secret-tool', 'clear', 'service', target], capture_output=True, timeout=2.0)
            except Exception:
                pass
        return _vault_delete(target)

def extract_email(cred_str):
    if not cred_str:
        return None
    try:
        data = json.loads(cred_str)
        if isinstance(data, dict):
            if data.get('email'):
                return data['email']
            id_token = data.get('id_token')
            if id_token:
                parts = id_token.split('.')
                if len(parts) >= 2:
                    payload = parts[1] + '=' * (-len(parts[1]) % 4)
                    info = json.loads(base64.urlsafe_b64decode(payload))
                    return info.get('email')
    except Exception:
        pass
    return None

def load_config():
    cfg = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
        except Exception:
            pass
    if not isinstance(cfg, dict):
        cfg = {}

    if 'activeSlot' not in cfg:
        if cfg.get('active') == 'reserve':
            cfg['activeSlot'] = 2
        else:
            cfg['activeSlot'] = 1

    if 'autoFailover' not in cfg:
        cfg['autoFailover'] = True

    return cfg

def save_config(cfg):
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        clean_cfg = {
            'activeSlot': cfg.get('activeSlot', 1),
            'autoFailover': cfg.get('autoFailover', True),
            'accounts': cfg.get('accounts', []),
        }
        if cfg.get('pendingSlot'):
            clean_cfg['pendingSlot'] = cfg['pendingSlot']
        if cfg.get('restoreSlot'):
            clean_cfg['restoreSlot'] = cfg['restoreSlot']
        if cfg.get('pendingStartTime'):
            clean_cfg['pendingStartTime'] = cfg['pendingStartTime']

        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(clean_cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving config: {e}", file=sys.stderr)

def ensure_migrated():
    # 1. Slot 1 migration
    if not read_cred(get_slot_target(1)):
        prim = read_cred(TARGET_PRIMARY) or read_cred(TARGET_ACTIVE)
        if prim:
            write_cred(get_slot_target(1), prim)

    # 2. Slot 2 migration
    if not read_cred(get_slot_target(2)):
        resv = read_cred(TARGET_RESERVE)
        if resv:
            write_cred(get_slot_target(2), resv)

    # 3. Clean up legacy targets so they don't linger as phantom zombie credentials
    if read_cred(TARGET_PRIMARY):
        delete_cred(TARGET_PRIMARY)
    if read_cred(TARGET_RESERVE):
        delete_cred(TARGET_RESERVE)

def get_status():
    ensure_migrated()
    cfg = load_config()

    cur_cred = read_cred(TARGET_ACTIVE)

    # Self-healing ONLY if previous add-login flow was abandoned/crashed (> 3 minutes ago)
    pending_start = cfg.get('pendingStartTime', 0)
    now = time.time()
    if not cur_cred and cfg.get('pendingSlot') and (now - pending_start > 180):
        restore_slot = cfg.get('restoreSlot', 1)
        prev_cred = read_cred(get_slot_target(restore_slot))
        if prev_cred:
            write_cred(TARGET_ACTIVE, prev_cred)
            cur_cred = prev_cred
        cfg['pendingSlot'] = None
        cfg['restoreSlot'] = None
        cfg['pendingStartTime'] = None
        save_config(cfg)
    elif not cur_cred and not cfg.get('pendingSlot'):
        restore_slot = cfg.get('activeSlot', 1)
        prev_cred = read_cred(get_slot_target(restore_slot))
        if prev_cred:
            write_cred(TARGET_ACTIVE, prev_cred)
            cur_cred = prev_cred

    cur_email = extract_email(cur_cred)

    # Scan slots 1..MAX_SLOTS
    accounts = []
    for s in range(1, MAX_SLOTS + 1):
        target = get_slot_target(s)
        cred = read_cred(target)
        if cred:
            email = extract_email(cred) or f"Account {s}"
            accounts.append({'slot': s, 'email': email})

    # If no slots exist but active exists, populate slot 1
    if not accounts and cur_cred:
        write_cred(get_slot_target(1), cur_cred)
        accounts.append({'slot': 1, 'email': cur_email or 'Account 1'})

    # Determine active slot
    saved_slot = cfg.get('activeSlot', 1)
    matched_slot = None
    if cur_email:
        for acc in accounts:
            if acc['email'] == cur_email:
                matched_slot = acc['slot']
                break

    if matched_slot is not None:
        active_slot = matched_slot
    else:
        existing_slot_ids = [a['slot'] for a in accounts]
        if existing_slot_ids and saved_slot in existing_slot_ids:
            active_slot = saved_slot
        elif existing_slot_ids:
            active_slot = existing_slot_ids[0]
        else:
            active_slot = 1

    cfg['activeSlot'] = active_slot
    cfg['accounts'] = accounts
    save_config(cfg)

    return {
        'activeSlot': active_slot,
        'currentEmail': cur_email,
        'accounts': accounts,
        'slotsCount': len(accounts),
        'maxSlots': MAX_SLOTS,
        'autoFailover': cfg.get('autoFailover', True),
        'hasReserve': len(accounts) > 1,
        # Legacy compatibility
        'active': 'reserve' if active_slot == 2 else 'primary',
        'primaryEmail': accounts[0]['email'] if len(accounts) > 0 else cur_email,
        'reserveEmail': accounts[1]['email'] if len(accounts) > 1 else None,
    }

def switch(target=None):
    status = get_status()
    accounts = status.get('accounts', [])
    if not accounts:
        return {'error': 'Нет доступных аккаунтов для переключения'}

    cfg = load_config()
    current_active_slot = status['activeSlot']

    target_slot = None
    if target is None or target == '' or target == 'next':
        # Cycle to next account in carousel
        curr_idx = 0
        for i, a in enumerate(accounts):
            if a['slot'] == current_active_slot:
                curr_idx = i
                break
        next_idx = (curr_idx + 1) % len(accounts)
        target_slot = accounts[next_idx]['slot']
    elif target == 'primary':
        target_slot = 1
    elif target == 'reserve':
        target_slot = 2
    else:
        try:
            target_slot = int(target)
        except ValueError:
            return {'error': f'Неверный слот: {target}'}

    target_cred = read_cred(get_slot_target(target_slot))
    if not target_cred:
        return {'error': f'Аккаунт в слоте {target_slot} не найден'}

    # 1. Save current active credentials to its current slot (keeps refresh tokens updated)
    cur_cred = read_cred(TARGET_ACTIVE)
    if cur_cred:
        write_cred(get_slot_target(current_active_slot), cur_cred)

    # 2. Write target credentials to TARGET_ACTIVE
    write_cred(TARGET_ACTIVE, target_cred)

    cfg['activeSlot'] = target_slot
    save_config(cfg)

    return get_status()

def toggle_autofailover(enable=None):
    cfg = load_config()
    if enable is None:
        cfg['autoFailover'] = not cfg.get('autoFailover', True)
    else:
        cfg['autoFailover'] = bool(enable)
    save_config(cfg)
    return get_status()

def prepare_add_login(target_slot=None):
    status = get_status()
    accounts = status.get('accounts', [])
    if len(accounts) >= MAX_SLOTS:
        return {'error': f'Достигнут максимум аккаунтов ({MAX_SLOTS})'}

    new_slot = None
    if target_slot is not None and str(target_slot).isdigit():
        s = int(target_slot)
        if 1 <= s <= MAX_SLOTS:
            new_slot = s

    if new_slot is None:
        existing_slots = {a['slot'] for a in accounts}
        for s in range(1, MAX_SLOTS + 1):
            if s not in existing_slots:
                new_slot = s
                break

    if new_slot is None:
        return {'error': f'Все {MAX_SLOTS} слота заняты'}

    # Backup current active credential to its current slot
    cur_cred = read_cred(TARGET_ACTIVE)
    if cur_cred:
        write_cred(get_slot_target(status['activeSlot']), cur_cred)

    cfg = load_config()
    cfg['pendingSlot'] = new_slot
    cfg['restoreSlot'] = status['activeSlot']
    cfg['pendingStartTime'] = time.time()
    save_config(cfg)

    # Delete active credential so LS prompts login
    delete_cred(TARGET_ACTIVE)
    return {'status': 'ready_for_login', 'pendingSlot': new_slot, 'restoreSlot': status['activeSlot']}

def finalize_add_login(target_slot=None):
    new_cred = read_cred(TARGET_ACTIVE)
    if not new_cred:
        return {'error': 'Токен ещё не получен'}

    new_email = extract_email(new_cred)
    cfg = load_config()

    pending_slot = cfg.get('pendingSlot')
    if target_slot is not None and str(target_slot).isdigit():
        pending_slot = int(target_slot)

    restore_slot = cfg.get('restoreSlot', 1)
    status = get_status()
    accounts = status.get('accounts', [])

    # Check for duplicate email across existing slots!
    if new_email:
        duplicate_acc = next((a for a in accounts if a.get('email') and a['email'].lower() == new_email.lower()), None)
        if duplicate_acc:
            dup_slot = duplicate_acc['slot']
            write_cred(get_slot_target(dup_slot), new_cred)

            # Restore previous active credential
            prev_cred = read_cred(get_slot_target(restore_slot))
            if prev_cred:
                write_cred(TARGET_ACTIVE, prev_cred)

            cfg['pendingSlot'] = None
            cfg['restoreSlot'] = None
            cfg['pendingStartTime'] = None
            save_config(cfg)

            res = get_status()
            res['newEmail'] = new_email
            res['addedSlot'] = dup_slot
            res['isExisting'] = True
            res['message'] = f"Аккаунт {new_email} уже подключен (Слот {dup_slot}). Токен обновлен."
            return res

    if not pending_slot:
        existing_slots = {a['slot'] for a in accounts}
        for s in range(1, MAX_SLOTS + 1):
            if s not in existing_slots:
                pending_slot = s
                break
        if not pending_slot:
            pending_slot = len(accounts) + 1

    # Save new credential to target slot
    write_cred(get_slot_target(pending_slot), new_cred)

    # Restore previous active credential to TARGET_ACTIVE
    prev_cred = read_cred(get_slot_target(restore_slot))
    if prev_cred:
        write_cred(TARGET_ACTIVE, prev_cred)

    cfg['pendingSlot'] = None
    cfg['restoreSlot'] = None
    cfg['pendingStartTime'] = None
    save_config(cfg)

    res = get_status()
    res['newEmail'] = new_email
    res['addedSlot'] = pending_slot
    return res

def cancel_add_login():
    cfg = load_config()
    restore_slot = cfg.get('restoreSlot', 1)
    prev_cred = read_cred(get_slot_target(restore_slot))
    if prev_cred:
        write_cred(TARGET_ACTIVE, prev_cred)
    cfg['pendingSlot'] = None
    cfg['restoreSlot'] = None
    cfg['pendingStartTime'] = None
    save_config(cfg)
    return get_status()

def delete_slot(slot_num):
    try:
        slot_num = int(slot_num)
    except (TypeError, ValueError):
        return {'error': f'Неверный номер слота: {slot_num}'}

    status = get_status()
    accounts = status.get('accounts', [])
    if len(accounts) <= 1:
        return {'error': 'Нельзя удалить единственный аккаунт'}

    target_acc = next((a for a in accounts if a['slot'] == slot_num), None)
    if not target_acc:
        return {'error': f'Аккаунт в слоте {slot_num} не найден'}

    active_slot = status.get('activeSlot', 1)

    # 1. Save current active credentials into its slot so we don't lose fresh tokens
    cur_cred = read_cred(TARGET_ACTIVE)
    if cur_cred:
        write_cred(get_slot_target(active_slot), cur_cred)

    # 2. Collect remaining credentials in order, noting which one was active
    active_was_deleted = (active_slot == slot_num)
    remaining_creds = []
    for s in range(1, MAX_SLOTS + 1):
        if s == slot_num:
            continue
        c = read_cred(get_slot_target(s))
        if c:
            is_active = (s == active_slot)
            remaining_creds.append((c, is_active))

    # 3. Clear all slot targets
    for s in range(1, MAX_SLOTS + 1):
        delete_cred(get_slot_target(s))

    # 4. Write compacted slots 1..len(remaining_creds)
    new_active_slot = 1
    for idx, (c, was_active) in enumerate(remaining_creds, 1):
        write_cred(get_slot_target(idx), c)
        if was_active and not active_was_deleted:
            new_active_slot = idx

    # 5. If the active account itself was deleted, activate slot 1
    if active_was_deleted:
        new_active_cred = read_cred(get_slot_target(1))
        if new_active_cred:
            write_cred(TARGET_ACTIVE, new_active_cred)
        new_active_slot = 1
    else:
        # Keep TARGET_ACTIVE in sync with the active slot
        active_c = read_cred(get_slot_target(new_active_slot))
        if active_c:
            write_cred(TARGET_ACTIVE, active_c)

    cfg = load_config()
    cfg['activeSlot'] = new_active_slot
    save_config(cfg)

    return get_status()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        cmd = 'status'
    else:
        cmd = sys.argv[1].lower()

    if cmd == 'status':
        print(json.dumps(get_status()))
    elif cmd == 'switch':
        target = sys.argv[2] if len(sys.argv) > 2 else None
        print(json.dumps(switch(target)))
    elif cmd == 'toggle-autofailover':
        val = None
        if len(sys.argv) > 2:
            val = sys.argv[2].lower() in ('1', 'true', 'yes')
        print(json.dumps(toggle_autofailover(val)))
    elif cmd in ('prepare-add-login', 'prepare-reserve-login'):
        target = sys.argv[2] if len(sys.argv) > 2 else None
        print(json.dumps(prepare_add_login(target)))
    elif cmd in ('finalize-add-login', 'finalize-reserve-login'):
        target = sys.argv[2] if len(sys.argv) > 2 else None
        print(json.dumps(finalize_add_login(target)))
    elif cmd in ('cancel-add-login', 'cancel-reserve-login'):
        print(json.dumps(cancel_add_login()))
    elif cmd in ('delete-slot', 'remove-account'):
        slot = sys.argv[2] if len(sys.argv) > 2 else None
        print(json.dumps(delete_slot(slot)))
    else:
        print(json.dumps({'error': f'Unknown command: {cmd}'}))
