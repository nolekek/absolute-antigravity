# Absolute Antigravity 🚀

> **Production-Grade расширение для клиента Google Antigravity (Electron):** мульти-аккаунтинг с автоматической ротацией и защитой от квот, Telegram Remote Commander, обход региональных ограничений (Eligibility Bypass) и **Control Center & Dynamic Skill Workshop** — система динамического управления навыками и пресетами контекста.

![Version](https://img.shields.io/badge/version-2.28.1-blue.svg)
![Tests](https://img.shields.io/badge/tests-79%2F79%20passing-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20WSL-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 📑 Содержание
1. [Обзор ключевых возможностей](#-обзор-ключевых-возможностей)
2. [Модуль: Control Center & Dynamic Skill Workshop](#-модуль-control-center--dynamic-skill-workshop)
   - [Проблема и архитектурное решение](#проблема-и-архитектурное-решение)
   - [Каталог пресетов и матрица скиллов (70 навыков)](#каталог-пресетов-и-матрица-скиллов)
   - [Автономное переключение агентом (`agent-preset-conductor`)](#автономное-переключение-агентом-agent-preset-conductor)
   - [Гарантия непрерывности (`ALWAYS_ACTIVE`)](#гарантия-непрерывности-always_active)
   - [Local HTTP IPC Bridge (порт 51122)](#local-http-ipc-bridge-порт-51122)
   - [Drawer UI в Electron (`Ctrl+Shift+S`)](#drawer-ui-в-electron-ctrlshifts)
3. [Мульти-аккаунтинг и защита от квот](#-мульти-аккаунтинг-и-защита-от-квот)
4. [Telegram Remote Commander & Guard Watchdog](#-telegram-remote-commander--guard-watchdog)
5. [Установка и запуск (CLI Guide)](#-установка-и-запуск-cli-guide)
   - [Быстрая установка (Готовый бинарник) — Windows](#1-быстрая-установка-через-cli--windows-powershell)
   - [Быстрая установка (Готовый бинарник) — Linux / WSL](#2-быстрая-установка-через-cli--linux--wsl-bash)
   - [Сборка из исходников (Build from Source)](#3-сборка-из-исходников-build-from-source)
6. [Структура проекта](#-структура-проекта)
7. [Тестирование и верификация](#-тестирование-и-верификация)

---

## 🌟 Обзор ключевых возможностей

- 👥 **Мульти-аккаунтинг Google:** До 4 независимых аккаунтов в защищённом системном хранилище (Windows Credential Manager / Linux secret-tool & encrypted vault).
- ⚡ **1-Click ротация и карусель:** Интерактивный виджет `[1/3]` в заголовке окна для мгновенного переключения активного аккаунта без перезапуска IDE и без потери вкладок/сессий.
- 🛡️ **Auto-Failover по квотам:** Автоматический перехват gRPC `ResourceExhausted` и HTTP 429 ошибок Language Server с мягким переключением на следующий аккаунт (cooldown 25 сек).
- 🔓 **Eligibility Bypass:** Встроенный патчер региональных ограничений (`manager.py`), открывающий полный доступ без VPN на Windows и Linux.
- 🤖 **Telegram Remote Commander:** Управление клиентом со смартфона: выполнение команд, голосовой ввод, запуск задач, мониторинг квот (недельная + 5-часовая) и уведомления.
- 🎛️ **Control Center & Dynamic Skill Workshop:** Умная оркестрация навыков модели (41 скилл, 8 пресетов), экономящая **до 15 000+ токенов** в системном контексте за счёт адаптивного переключения на лету.

---

## 🎛️ Модуль: Control Center & Dynamic Skill Workshop

### Проблема и архитектурное решение

В стандартном режиме Google Antigravity загружает все установленные навыки (skills) скопом в системный промпт (`<skills>`). При наличии 40+ навыков это приводит к:
1. **Засорению контекста (Context Bloat):** До 15 000–25 000 токенов расходуются в каждом запросе впустую на описания нерелевантных инструментов.
2. **Галлюцинациям модели:** Когда модель видит одновременно инструкции для Rust, Vue, Kubernetes, pentest-инструментов и биомолекулярных симуляторов, падает точность выполнения задач.
3. **Быстрому исчерпанию квот:** Каждый лишний токен в промпте ускоряет исчерпание лимитов TPM (Tokens Per Minute).

**Решение модуля Control Center:**
- Создана библиотека из **73 специализированных навыков** (`skills-library/`), синхронизируемая в `~/.gemini/config/skills/`.
- Реализована система из **9 доменных пресетов** (Web, Backend, DevOps, AppSec, QA, AI-Agents, Web-Research, Reverse-Engineering, Minimal).
- Переключение происходит мгновенно на лету без перезапуска клиента через атомарный тогл файлов (`SKILL.md` ↔ `SKILL.md.disabled`).
- Модель снабжена автономным дирижёром `agent-preset-conductor`, позволяющим ей **самостоятельно переключать пресет** под конкретную задачу.

---

### Каталог пресетов и матрица скиллов

Библиотека включает **73 production-grade навыка**, распределённых по целевым пресетам:

| Пресет | ID | Иконка | Состав навыков | Описание стека |
|---|---|---|---|---|
| **Web Modern** | `web` | 🌐 | `ui-ux-pro-max`, `frontend-design`, `react-best-practices`, `seo-audit`, `form-cro`, `nextjs-fullstack-guru`, `tailwind-v4-master`, `react-performance-opt`, `vue-nuxt-expert`, `web-state-query-master`, `web-performance-auditor`, `agent-preset-conductor`, `ai-product-partner` | Next.js 15, React, Tailwind v4, Vue 3, TanStack Query, UI/UX дизайн, Web Vitals, SEO & CRO форм |
| **Backend & DB** | `backend` | ⚙️ | `database-design`, `api-design-principles`, `nodejs-best-practices`, `go-concurrency-patterns`, `memory-safety-patterns`, `postgres-dba-optimizer`, `fastapi-async-architect`, `go-highload-services`, `rust-systems-safe`, `redis-distributed-caching`, `kafka-event-streaming` | Архитектура баз данных, дизайн REST/GraphQL API, Node.js, FastAPI, Go параллелизм, безопасный Rust, Redis и Kafka |
| **DevOps & Cloud** | `devops` | 🐳 | `incident-responder`, `deployment-procedures`, `aws-serverless`, `docker-container-master`, `k8s-manifest-generator`, `github-actions-ci-cd`, `terraform-iac-architect`, `observability-telemetry-guru` | Multi-stage Docker, K8s манифесты, CI/CD Actions, Terraform IaC, AWS Serverless, SRE реагирование и Zero-Downtime деплои |
| **AppSec & Reversing** | `appsec` | 🛡️ | `top-web-vulnerabilities`, `api-security-best-practices`, `ethical-hacking-methodology`, `appsec-code-auditor`, `reverse-engineer-electron`, `win32-powershell-automation`, `windows-desktop-control`, `network-traffic-intercept`, `api-pentest-fuzzer` | OWASP Top-10, аудит безопасности API, этичный пентест, декомпиляция ASAR, безопасность Win32/PS, автоматизация рабочего стола Windows (Windows-MCP) и фаззинг |
| **QA & Testing** | `qa` | 🧪 | `test-driven-development`, `test-fixing`, `code-review-checklist`, `playwright-e2e-guru`, `windows-desktop-control`, `unit-test-synthesizer`, `k6-load-testing-pro`, `api-contract-tester` | Playwright E2E тесты, автоматизация и тестирование рабочего стола Windows (Windows-MCP), TDD Red-Green-Refactor, исправление тестов, Code Review и k6 |
| **AI & MCP Engineering** | `ai-agents` | 🤖 | `mcp-builder`, `prompt-engineering`, `rag-implementation`, `context-window-management`, `ai-agents-architect`, `agent-evaluation`, `langgraph` | Создание MCP серверов, RAG архитектура, промпт-инжиниринг, управление контекстным окном и LangGraph пайплайны |
| **Web Research & OSINT** | `web-research` | 🔍 | `search-specialist`, `deep-research-synthesizer`, `web-scraper-harvester`, `osint-recon-investigator` | Высокоточный веб-поиск (native `search_web`), извлечение контента, OSINT и чистая аналитика без генерации лишних скриптов |
| **Reverse Engineering** | `reverse-engineering` | 🧬 | Полный Clean-Room цикл (11 скиллов `replica-*`) + `reverse-engineer-electron` | Реверс-инжиниринг чужих сервисов с нуля по чистой методологии (recon, architect, backend, design, build, test, deploy) |
| **Minimal Context** | `minimal` | ⚡ | `agent-preset-conductor`, `ai-product-partner` (+ глобальные скиллы) | Чистый контекст для свободных диалогов и максимальной скорости ответов |

---

### Автономное переключение агентом (`agent-preset-conductor`)

В пресеты встроен мета-скилл **`agent-preset-conductor`**.

**Как агент работает автономно:**
1. При получении задачи (например: *«напиши Playwright тест»* или *«собери Dockerfile для Go»*) агент определяет требуемый профиль.
2. Агент вызывает локальный переключатель:
   ```bash
   python skills-library/agent-preset-conductor/scripts/switch.py qa
   ```
3. Скрипт отправляет HTTP POST запрос на `http://127.0.0.1:51122/api/switch-preset`.
4. Движок `skillManager.js` активирует требуемые скиллы, пересчитывает токены и шлёт IPC-событие в Electron UI.
5. Карточка пресета в интерфейсе обновляется мгновенно в реальном времени.

---

### Гарантия непрерывности (`ALWAYS_ACTIVE`)

Для защиты от отключения самого инструмента дирижирования (Conductor Suicide Problem), в `skillManager.js` реализован защитный механизм:

```javascript
// asar_extracted_228/dist/skillManager.js
const ALWAYS_ACTIVE = new Set([
    "agent-preset-conductor",
    "systematic-debugging",
    "verification-before-completion",
    "concise-planning"
]);

for (const s of skills) {
    const shouldBeActive = ALWAYS_ACTIVE.has(s.id) || targetSet.has(s.id);
    if (s.enabled !== shouldBeActive) {
        this.toggleSkill(s.dirPath, shouldBeActive);
    }
}
}
```
Благодаря этому правилу мета-скилл `agent-preset-conductor` **никогда не отключается** и всегда доступен модели.

---

### Local HTTP IPC Bridge (порт 51122)

Внутри клиента развернут легковесный non-blocking HTTP IPC сервер:

| Метод | Эндпоинт | Описание |
|---|---|---|
| `GET` | `/api/status` | Полный статус аккаунтов, текущий слот, активный URL и токен сессии |
| `GET` | `/api/presets` | Список доступных пресетов, текущий активный пресет, количество активных навыков и оценка токенов |
| `POST` | `/api/switch-preset` | Применение пресета `{ "preset": "backend" }` с мгновенным оповещением UI |

---

### Drawer UI в Electron (`Ctrl+Shift+S`)

Интерфейс Control Center встроен в `preload.js` и открывается сочетанием клавиш **`Ctrl+Shift+S`** или кликом на виджет в заголовке:
- **Интерактивная сетка карточек:** Адаптивный грид с иконками, бейджами активного состояния и описанием стека.
- **Счётчик токенов:** Индикатор с расчётом сэкономленного контекста (`~2,500 токенов` вместо `~15,000`).
- **Real-time синхронизация:** При переключении через агент или CLI интерфейс обновляется мгновенно.

---

## 👥 Мульти-аккаунтинг и защита от квот

1. **Изоляция OAuth:** Авторизационные ссылки Google строго перехватываются (`accounts.google.com`) и открываются во внешнем системном браузере через `shell.openExternal`.
2. **Принудительный выбор аккаунта:** При авторизации инжектируется параметр `prompt=select_account`, предотвращающий случайный вход в уже используемый профиль.
3. **Безопасное удаление слотов:** При удалении любого промежуточного аккаунта срабатывает **Zero-Gap Compaction** — оставшиеся слоты автоматически смещаются без пропусков (удаление слота 2 из 4 оставляет слоты 1, 2, 3).
4. **Сохранение токенов:** При ротации токен синхронизируется с фоновыми обновлениями Language Server, предотвращая неожиданный разлогин.

---

## 🤖 Telegram Remote Commander & Guard Watchdog

В папке `scripts/` содержатся инструменты для удалённого управления и автоматического поддержания работоспособности:

- **`scripts/antigravity_bot.py`**: Полнофункциональный Telegram-бот для удалённого контроля:
  - Выполнение shell-команд, запуск промптов в Antigravity.
  - Отображение текущих квот (недельная квота + скользящее 5-часовое окно).
  - Уведомления об исчерпании лимитов и ротации аккаунтов.
  - Поддержка голосовых сообщений (преобразование в текст).
- **`scripts/antigravity_guard.py`**: Watchdog-демон авто-восстановления:
  - Проверяет целостность пропатченного `app.asar`.
  - Автоматически повторно накладывает патчи при обновлении клиента Google.
  - Поддерживает запуск фонового Telegram-бота.

---

## 📦 Установка и запуск (CLI Guide)

> [!IMPORTANT]
> Перед установкой обязательно закройте клиент Antigravity.

### 1. Быстрая установка через CLI — Windows (PowerShell)

Откройте PowerShell в папке репозитория:

```powershell
# 1. Создание резервной копии оригинального app.asar
$resources = "$env:LOCALAPPDATA\Programs\antigravity\resources"
if (Test-Path "$resources\app.asar") {
    Copy-Item "$resources\app.asar" "$resources\app.asar.bak" -Force
}

# 2. Установка пропатченного app.asar и распакованных библиотек
Copy-Item "app.asar" "$resources\app.asar" -Force
Copy-Item -Recurse -Force "app.asar.unpacked\*" "$resources\app.asar.unpacked\"

# 3. Развёртывание библиотеки 70 навыкова (skills-library)
$skillsDir = "$HOME\.gemini\config\skills"
New-Item -ItemType Directory -Force $skillsDir | Out-Null
Copy-Item -Recurse -Force "skills-library\*" "$skillsDir\"

# 4. Обход региональных ограничений (Eligibility Bypass)
python eligibility-antigravity-patcher\manager.py --action patch

# 5. Запуск Antigravity
Start-Process "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
```

---

### 2. Быстрая установка через CLI — Linux / WSL (Bash)

Откройте терминал Bash:

```bash
# 1. Определение директории ресурсов Antigravity
if [ -d "/opt/Antigravity/resources" ]; then
    ANTIGRAVITY_DIR="/opt/Antigravity/resources"
elif [ -d "$HOME/.local/share/antigravity/resources" ]; then
    ANTIGRAVITY_DIR="$HOME/.local/share/antigravity/resources"
else
    echo "Укажите путь к resources Antigravity вручную"
    exit 1
fi

# 2. Резервная копия и копирование пропатченных файлов
cp -n "$ANTIGRAVITY_DIR/app.asar" "$ANTIGRAVITY_DIR/app.asar.bak"
cp -f app.asar "$ANTIGRAVITY_DIR/app.asar"
mkdir -p "$ANTIGRAVITY_DIR/app.asar.unpacked"
cp -rf app.asar.unpacked/* "$ANTIGRAVITY_DIR/app.asar.unpacked/"

# 3. Развёртывание библиотеки навыков
mkdir -p ~/.gemini/config/skills
cp -rf skills-library/* ~/.gemini/config/skills/

# 4. Снятие региональных ограничений (Eligibility Bypass для ELF)
python3 eligibility-antigravity-patcher/manager.py --action patch

echo "Установка завершена! Запустите Antigravity."
```

---

### 3. Сборка из исходников (Build from Source)

Если вы хотите собрать `app.asar` самостоятельно из модифицированного исходного кода:

```bash
# 1. Установка npm-зависимостей
npm install

# 2. Упаковка app.asar с сохранением credHelper и chrome-devtools распакованными
npx asar pack asar_extracted_228 app.asar --unpack "{**/chrome-devtools-mcp/**,**/credHelper.py}"

# 3. Скопируйте собранный app.asar в папку ресурсов Antigravity
# (по инструкции для Windows или Linux выше)
```

---

### 4. Настройка Telegram Remote Commander (Опционально)

Для первого запуска и настройки бота:
```bash
python scripts/antigravity_bot.py
```
Скрипт интерактивно запросит:
1. Токен вашего Telegram-бота (от `@BotFather`).
2. Ваш цифровой Telegram User ID (для защиты от несанкционированного доступа).

Конфигурация сохранится в `~/.gemini/antigravity/bot_config.json` с правами доступа владельца.

---

## 📁 Структура проекта

```
absolute-antigravity/
├── skills-library/                  # Мастер-библиотека 70 навыкова
│   ├── agent-preset-conductor/      # Автономный мета-оркестратор (switch.py)
│   ├── nextjs-fullstack-guru/       # Скилл Web: Next.js 15 & RSC
│   ├── tailwind-v4-master/          # Скилл Web: Tailwind CSS v4
│   ├── postgres-dba-optimizer/      # Скилл Backend: PostgreSQL DBA
│   ├── fastapi-async-architect/     # Скилл Backend: Async FastAPI
│   ├── docker-container-master/     # Скилл DevOps: Multi-stage Docker
│   ├── k8s-manifest-generator/      # Скилл DevOps: Kubernetes manifests
│   ├── playwright-e2e-guru/         # Скилл QA: Playwright resilient E2E
│   ├── reverse-engineer-electron/   # Скилл AppSec: Electron ASAR reversing
│   └── ...                          # Полный набор 70 навыкова
├── asar_extracted_228/dist/         # Исходный код модификаций клиента (v2.28.1)
│   ├── skillManager.js              # Движок пресетов и управления навыками
│   ├── stackDetector.js             # Эвристический детектор стека проекта
│   ├── multiaccManager.js           # Менеджер аккаунтов и HTTP IPC Bridge (51122)
│   ├── preload.js                   # UI карусели и Drawer Control Center
│   ├── credHelper.py                # Cross-Platform Credential Helper (WinCred / Linux Secret)
│   ├── beyondcorpPac.js             # Проксификатор с сохранением auth-перехвата
│   ├── languageServer.js            # Перехват OAuth и ротация LS
│   └── utils.js                     # Сетевые и OAuth перехватчики
├── eligibility-antigravity-patcher/ # Кроссплатформенный патчер региональных лимитов
│   ├── manager.py                   # Патчер бинарников (PE .exe / ELF x86_64)
│   └── README.md
├── scripts/                         # Скрипты автоматизации и управления
│   ├── antigravity_bot.py           # Telegram Remote Commander
│   ├── antigravity_guard.py         # Watchdog-демон восстановления
│   ├── agentapi.bat                 # Быстрый запуск на Windows
│   └── launch.vbs                   # Скрытый запуск для Windows
├── tests/                           # Унифицированная тестовая инфраструктура (79 тестов)
│   ├── run_all.js                   # Мастер-раннер тестов (Tiers 1-4 + Python)
│   ├── tier1_feature_coverage.test.js
│   ├── tier2_boundary_cases.test.js
│   ├── tier3_cross_feature.test.js
│   ├── tier4_real_world.test.js
│   └── cred_helper_suite.py
├── app.asar                         # Готовый собранный пропатченный архив
├── app.asar.unpacked/               # Распакованные бинарные модули
├── package.json                     # Конфигурация сборки и зависимости
├── PROJECT.md                       # Архитектурная спецификация мульти-аккаунтинга
└── README.md                        # Главная документация проекта
```

---

## 🧪 Тестирование и верификация

Проект снабжён полной матрицей сквозного E2E тестирования (79/79 тестов проходят):

```bash
node tests/run_all.js
```

### Результаты регрессионного прогона:
```
==============================================================================
                          TEST EXECUTION SUMMARY
==============================================================================
Suite                                               Status    Passed  Failed  
------------------------------------------------------------------------------
Tier 1: Feature Coverage (R1, R2, R3, R4)           ✔ PASS    29      0       
Tier 2: Boundary & Corner Cases                     ✔ PASS    25      0       
Tier 3: Cross-Feature Combinations                  ✔ PASS    6       0       
Tier 4: Real-World Application Scenarios            ✔ PASS    6       0       
Python Win32 Credential Manager & Compaction Suite  ✔ PASS    13      0       
==============================================================================
Total Passed: 79 | Total Failed: 0 | Duration: 21.51s
Final Result: ✔ 100% ALL TESTS PASSED
==============================================================================
```


---

### Плагин Windows Desktop Automation (`Windows-MCP`)

Интегрирован нативный движок автоматизации рабочего стола Windows на базе **Windows-MCP**:
* **Инспекция экрана (`State` / `Screenshot`):** извлечение полного дерева элементов UI активных окон (кнопки, поля ввода, текст) с физическими координатами $(x, y)$.
* **DOM режим для браузеров (`use_dom=True`):** фильтрация системной панели браузера и прямое взаимодействие с веб-страницами в Chrome, Edge и Firefox.
* **Эмуляция ввода (`Click`, `Move`, `Type`, `Shortcut`, `Scroll`):** клики по точным координатам, ввод текста, системные горячие клавиши (`Ctrl+C`, `Alt+Tab`, `Enter`).
* **Управление приложениями и буфером (`App`, `Clipboard`, `Process`):** открытие программ по имени, фокусировка окон, чтение/запись системного буфера обмена.
* **Безопасность:** строгий протокол в правилах агента (`AGENTS.md`) — обязательная инспекция перед действием, предотвращение race conditions и запрет на закрытие критических процессов.
