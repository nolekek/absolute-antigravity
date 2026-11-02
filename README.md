# Absolute Antigravity 🚀

> **Production-Grade расширение для клиента Google Antigravity (Electron):** мульти-аккаунтинг с автоматической ротацией и защитой от квот, автономное CLI-ядро `agy` на Rust (v3.0), Telegram Remote Commander, обход региональных ограничений (Eligibility Bypass) и **Control Center & Dynamic Skill Workshop** — система динамического управления навыками и пресетами контекста.

![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)
![Tests](https://img.shields.io/badge/tests-79%2F79%20passing-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20WSL-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 📑 Содержание
1. [Обзор ключевых возможностей](#-обзор-ключевых-возможностей)
2. [Модуль: Control Center & Dynamic Skill Workshop](#-модуль-control-center--dynamic-skill-workshop)
   - [Проблема и архитектурное решение](#проблема-и-архитектурное-решение)
   - [Каталог пресетов и матрица скиллов (101 навык, 16 пресетов)](#каталог-пресетов-и-матрица-скиллов)
   - [Автономное переключение агентом (`agent-preset-conductor`)](#автономное-переключение-агентом-agent-preset-conductor)
   - [Гарантия непрерывности (`ALWAYS_ACTIVE`)](#гарантия-непрерывности-always_active)
   - [Local HTTP IPC Bridge (порт 51122)](#local-http-ipc-bridge-порт-51122)
   - [Drawer UI в Electron (`Ctrl+Shift+S`)](#drawer-ui-в-electron-ctrlshifts)
3. [Автономное CLI-ядро `agy` на Rust (v3.0)](#-автономное-cli-ядро-agy-на-rust-v30)
   - [Архитектура и ультранизкая задержка (<5 мс)](#архитектура-и-ультранизкая-задержка-5-мс)
   - [Справочник команд CLI](#-справочник-команд-cli-agy)
   - [Фоновый демон и IPC Named Pipe (`agy-daemon`)](#3-управление-фоновым-демоном-agy-daemon)
   - [Безопасность: устранение RCE/CORS и $N$-слотовый пул](#безопасность-устранение-rcecors-и-n-слотовый-пул)
4. [Мульти-аккаунтинг и защита от квот ($N$ слотов)](#-мульти-аккаунтинг-и-защита-от-квот-n-слотов)
5. [Telegram Remote Commander & Guard Watchdog](#-telegram-remote-commander--guard-watchdog)
6. [Установка и запуск (CLI Guide)](#-установка-и-запуск-cli-guide)
   - [Быстрая установка (Готовый бинарник) — Windows](#1-быстрая-установка-через-cli--windows-powershell)
   - [Быстрая установка (Готовый бинарник) — Linux / WSL](#2-быстрая-установка-через-cli--linux--wsl-bash)
   - [Сборка из исходников (Build from Source)](#3-сборка-из-исходников-build-from-source)
7. [Структура проекта](#-структура-проекта)
8. [Тестирование и верификация](#-тестирование-и-верификация)
9. [Плагин Windows Desktop Automation (Windows-MCP)](#плагин-windows-desktop-automation-windows-mcp)

---

## 🌟 Обзор ключевых возможностей

- ⚡ **Автономное CLI-ядро `agy` (Rust, v3.0):** Высокопроизводительный консольный клиент и фоновый демон (`agy-daemon`) с откликом <5 мс, связью через Windows Named Pipe (`\\.\pipe\antigravity-ipc`), мгновенным переключением 16 пресетов с композитными оверлеями и управлением $N$-слотовым пулом аккаунтов.
- 👥 **Мульти-аккаунтинг Google ($N$ слотов):** Неограниченное количество независимых аккаунтов в защищённом системном хранилище (Windows Credential Manager / Linux secret-tool & encrypted vault) с авто-компактификацией Zero-Gap.
- ⚡ **1-Click ротация и карусель:** Интерактивный виджет `[1/3]` в заголовке окна для мгновенного переключения активного аккаунта без перезапуска IDE и без потери вкладок/сессий.
- 🛡️ **Auto-Failover по квотам:** Автоматический перехват gRPC `ResourceExhausted` и HTTP 429 ошибок Language Server с мягким переключением на следующий аккаунт (cooldown 25 сек).
- 🔒 **Hardened Security & Zero-Vulnerability:** Полное устранение RCE и CORS векторов, валидация Origin, rate-limiting с защитой от брутфорса (15-мин бан после 5 неудач) и безопасная песочница.
- 🔓 **Eligibility Bypass:** Встроенный патчер региональных ограничений (`manager.py`), открывающий полный доступ без VPN на Windows и Linux.
- 📱 **Mobile Web Client (LAN):** Полнофункциональный веб-клиент на порту `51125` для управления Antigravity со смартфона (чаты, переключение проектов, просмотр артефактов и планов, 16 пресетов, квоты без лагов).
- 🎨 **ArtCraft Suite & 10 Local MCP Engines (v2.0):** Интеграция локального флота из 10 нативных 64-битных Rust движков (CAD, SolidWorks-like 3D, Substance-like PBR, Premiere-like NLE, After Effects-like VFX, Lightroom-like RAW, Photoshop-like растр, Illustrator-like вектор, Figma-like UI и Clean-Room реверс).
- 🎛️ **Control Center & Dynamic Skill Workshop:** Умная оркестрация навыков модели (101 скилл, 16 сфокусированных пресетов), экономящая **до 15 000+ токенов** в системном контексте за счёт адаптивного переключения на лету.

---

## 🎛️ Модуль: Control Center & Dynamic Skill Workshop

### Проблема и архитектурное решение

В стандартном режиме Google Antigravity загружает все установленные навыки (skills) скопом в системный промпт (`<skills>`). При наличии 40+ навыков это приводит к:
1. **Засорению контекста (Context Bloat):** До 15 000–25 000 токенов расходуются в каждом запросе впустую на описания нерелевантных инструментов.
2. **Галлюцинациям модели:** Когда модель видит одновременно инструкции для Rust, Vue, Kubernetes, pentest-инструментов и биомолекулярных симуляторов, падает точность выполнения задач.
3. **Быстрому исчерпанию квот:** Каждый лишний токен в промпте ускоряет исчерпание лимитов TPM (Tokens Per Minute).

**Решение модуля Control Center:**
- Создана библиотека из **101 специализированный навык** (`skills-library/`), синхронизируемая в `~/.gemini/config/skills/`.
- Реализована система из **16 доменных пресетов** (Web, Backend, DevOps, AppSec, QA, AI-Agents, Web-Research, Reverse-Engineering, Product, Orchestrator, Systems, VST3, Hardware, Media, Meta-Dev, Minimal).
- Переключение происходит мгновенно на лету без перезапуска клиента через атомарный тогл файлов (`SKILL.md` ↔ `SKILL.md.disabled`) или через высокоскоростное Rust CLI-ядро `agy`.
- Модель снабжена автономным дирижёром `agent-preset-conductor`, позволяющим ей **самостоятельно переключать пресет** под конкретную задачу.

---

### Каталог пресетов и матрица скиллов

Библиотека включает **101 production-grade навык**, распределённых по целевым пресетам:

| Пресет | ID | Иконка | Состав навыков | Описание стека |
|---|---|---|---|---|
| **Web Modern** | `web` | 🌐 | `ui-ux-pro-max`, `frontend-design`, `react-best-practices`, `seo-audit`, `form-cro`, `nextjs-fullstack-guru`, `tailwind-v4-master`, `react-performance-opt`, `vue-nuxt-expert`, `web-state-query-master`, `web-performance-auditor`, `figcraft-design`, `vectorcraft-artwork`, `agent-preset-conductor`, `ai-product-partner` | Next.js 15, React, Tailwind v4, Vue 3, TanStack Query, UI/UX дизайн, Web Vitals, SEO & CRO форм |
| **Backend & DB** | `backend` | ⚙️ | `database-design`, `api-design-principles`, `nodejs-best-practices`, `go-concurrency-patterns`, `memory-safety-patterns`, `postgres-dba-optimizer`, `fastapi-async-architect`, `go-highload-services`, `rust-systems-safe`, `redis-distributed-caching`, `kafka-event-streaming` | Архитектура баз данных, дизайн REST/GraphQL API, Node.js, FastAPI, Go параллелизм, безопасный Rust, Redis и Kafka |
| **DevOps & Cloud** | `devops` | 🐳 | `incident-responder`, `deployment-procedures`, `aws-serverless`, `docker-container-master`, `k8s-manifest-generator`, `github-actions-ci-cd`, `terraform-iac-architect`, `observability-telemetry-guru` | Multi-stage Docker, K8s манифесты, CI/CD Actions, Terraform IaC, AWS Serverless, SRE реагирование и Zero-Downtime деплои |
| **AppSec & Reversing** | `appsec` | 🛡️ | `top-web-vulnerabilities`, `api-security-best-practices`, `ethical-hacking-methodology`, `appsec-code-auditor`, `craft-anything`, `reverse-engineer-electron`, `win32-powershell-automation`, `windows-desktop-control`, `network-traffic-intercept`, `api-pentest-fuzzer` | OWASP Top-10, аудит безопасности API, этичный пентест, декомпиляция ASAR, безопасность Win32/PS, автоматизация рабочего стола Windows (Windows-MCP) и фаззинг |
| **QA & Testing** | `qa` | 🧪 | `test-driven-development`, `test-fixing`, `code-review-checklist`, `playwright-e2e-guru`, `windows-desktop-control`, `unit-test-synthesizer`, `k6-load-testing-pro`, `api-contract-tester` | Playwright E2E тесты, автоматизация и тестирование рабочего стола Windows (Windows-MCP), TDD Red-Green-Refactor, исправление тестов, Code Review и k6 |
| **AI & MCP Engineering** | `ai-agents` | 🤖 | `mcp-builder`, `prompt-engineering`, `rag-implementation`, `context-window-management`, `ai-agents-architect`, `agent-evaluation`, `langgraph`, `browser`, `fl-freelance-agent` | Создание MCP серверов, RAG архитектура, промпт-инжиниринг, управление контекстным окном, браузерная автоматизация и LangGraph пайплайны |
| **Web Research & OSINT** | `web-research` | 🔍 | `search-specialist`, `deep-research-synthesizer`, `web-scraper-harvester`, `osint-recon-investigator` | Высокоточный веб-поиск (native `search_web`), извлечение контента, OSINT и чистая аналитика без генерации лишних скриптов |
| **Reverse Engineering** | `reverse-engineering` | 🧬 | Полный Clean-Room цикл (11 скиллов `replica-*`) + `craft-anything`, `reverse-engineer-electron` | Реверс-инжиниринг чужих сервисов с нуля по чистой методологии (recon, architect, backend, design, build, test, deploy) |
| **Product & Monetization** | `product` | 💎 | `product-monetization-strategy`, `market-competitor-intelligence`, `ai-product-partner`, `browser`, `search-specialist`, `deep-research-synthesizer`, `replica-entrepreneur`, `replica-brand`, `replica-launch`, `form-cro`, `ui-ux-pro-max`, `seo-audit` | Стратегия монетизации, юнит-экономика LTV/CAC, офферы (Hormozi), карточки товаров (маркетплейсы), конкурентный анализ и CRO |
| **Orchestrator & Multi-Agent** | `orchestrator` | 🎭 | `subagent-orchestrator`, `hierarchical-task-decomposer`, `multi-agent-debate-consensus`, `context-synthesis-reducer`, `ai-agents-architect`, `prompt-engineering`, `context-window-management`, `agent-evaluation`, `langgraph`, `artcraft-orchestrator`, `craft-anything`, `figcraft-design`, `code-review-checklist`, `premortem-redteam`, `ai-product-partner` | Мультиагентная оркестрация, декомпозиция крупных проектов, субагенты с изолированными профилями пресетов, арбитраж консенсуса и верификация |
| **Systems & High-Perf** | `systems` | ⚡ | `cpp-systems-architect`, `systems-lowlevel-perf`, `lockfree-concurrency-patterns`, `rust-systems-safe`, `memory-safety-patterns`, `test-driven-development`, `test-fixing`, `code-review-checklist` | Modern C++20/C++23, C, Zig, Rust, RAII, ручное управление памятью, lock-free, SIMD, санитайзеры ASan/TSan, CMake и профилирование |
| **VST3 & Audio DSP Studio** | `vst3` | 🎛️ | `vst3-dsp-architect`, `audio-plugin-ui-ux`, `figcraft-design`, `vectorcraft-artwork`, `cpp-systems-architect`, `systems-lowlevel-perf`, `lockfree-concurrency-patterns`, `subagent-orchestrator`, `hierarchical-task-decomposer`, `test-driven-development`, `test-fixing`, `code-review-checklist` | Разработка VST3/VST3i плагинов, синтезаторов и DSP эффектов: JUCE C++, real-time audio thread safety, SIMD, аудио UI/UX дизайн |
| **Hardware & CAD/CAM Studio** | `hardware` | 📐 | `solidcraft-modeling`, `cadcraft-drafting`, `texturecraft-pbr`, `cpp-systems-architect`, `systems-lowlevel-perf`, `agent-preset-conductor`, `ai-product-partner` | 3D параметрическое твердотельное моделирование (SolidCraft), 2D/3D чертежи DWG/DXF (CADCraft), 3D PBR текстуры (TextureCraft), экспорт STEP/STL |
| **Creative Studio & Media** | `media` | 🎨 | `filmcraft-video`, `effectcraft-vfx`, `lightcraft-photo`, `photocraft-studio`, `vectorcraft-artwork`, `figcraft-design`, `ui-ux-pro-max`, `frontend-design`, `ai-product-partner`, `agent-preset-conductor` | Нелинейный видеомонтаж NLE (FilmCraft), VFX моушн-дизайн (EffectCraft), проявка RAW (LightCraft), растр PSD (PhotoCraft), вектор SVG (VectorCraft), дизайн-системы (FigCraft) |
| **Antigravity Core & Self-Dev** | `meta-dev` | 🛠️ | `antigravity-core-dev`, `reverse-engineer-electron`, `win32-powershell-automation`, `windows-desktop-control`, `test-driven-development`, `test-fixing`, `code-review-checklist`, `nodejs-best-practices`, `subagent-orchestrator` | Разработка ядра Antigravity: Electron ASAR сборка/деплой, мультиаккаунт, ранбук `antigravity-core-dev`, тесты и автоматизация |
| **Minimal Context** | `minimal` | ⚡ | `agent-preset-conductor`, `ai-product-partner` (+ глобальные скиллы) | Чистый контекст для свободных диалогов и максимальной скорости ответов |

---

### Автономное переключение агентом (`agent-preset-conductor`)

В пресеты встроен мета-скилл **`agent-preset-conductor`**.

**Как агент работает автономно:**
1. При получении задачи (например: *«напиши Playwright тест»* или *«собери Dockerfile для Go»*) агент определяет требуемый профиль.
2. Агент вызывает локальный переключатель:
   ```bash
   python scripts/switch.py qa
   # или напрямую через высокоскоростное CLI-ядро:
   agy preset switch qa
   ```
3. Скрипт в первую очередь делегирует вызов скомпилированному ядру `agy` (<5 мс). Если бинарник отсутствует, происходит прозрачный фоллбек на HTTP IPC Bridge (`http://127.0.0.1:51122/api/switch-preset`) или прямое переключение файловой системы.
4. Движок активирует требуемые скиллы, пересчитывает токены и шлёт IPC-событие в Electron UI.
5. Карточка пресета в интерфейсе обновляется мгновенно в реальном времени.

---

### Гарантия непрерывности (`ALWAYS_ACTIVE`)

Для защиты от отключения самого инструмента дирижирования (Conductor Suicide Problem), в `skillManager.js` реализован защитный механизм:

```javascript
// asar_extracted_228/dist/skillManager.js
const ALWAYS_ACTIVE = new Set([
    "agent-preset-conductor",
    "grill-me",
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
```
Благодаря этому правилу 5 фундаментальных мета-скиллов **никогда не отключаются** и всегда доступны модели.

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

## ⚡ Автономное CLI-ядро `agy` на Rust (v3.0)

В релизе **v3.0** система Absolute Antigravity получила сверхбыстрое автономное ядро, написанное на Rust: консольный инструмент **`agy`** (`agy.exe`) и фоновый наблюдатель **`agy-daemon`** (`agy-daemon.exe`).

### Ключевые преимущества ядра v3.0:
1. **Ультранизкая задержка (<5 мс):** Переключение пресетов и ротация аккаунтов выполняются за единицы миллисекунд через прямой бинарный IPC или симлинк-движок без накладных расходов Node.js или Python.
2. **Асинхронный IPC через Windows Named Pipe:** Связь между CLI, демоном и клиентом осуществляется через безопасный канал `\\.\pipe\antigravity-ipc` (на Linux — Unix Domain Socket). При отсутствии запущенного демона утилита автоматически переходит в автономный standalone-режим.
3. **Фоновый watchdog (`agy-daemon`):** Демон в реальном времени отслеживает лог `language_server.log`, мгновенно обнаруживает gRPC `ResourceExhausted` и HTTP 429 ошибки и производит автоматическую ротацию аккаунтов с дебаунсом в 25 секунд.
4. **Безопасная архитектура и устранение RCE/CORS:** Все точки входа защищены от Command Injection, Path Traversal и Cross-Origin атак. Web Dashboard на порту 51125 снабжён строгой валидацией Origin, 6-значной криптографической PIN-аутентификацией и защитой от перебора (блокировка на 15 минут после 5 неудачных попыток).
5. **Поддержка пула из $N$ аккаунтов:** Динамическое управление неограниченным количеством Google-аккаунтов в системном хранилище (WinCred / Secret Service) с гарантией безынтервальной компактификации (Zero-Gap Compaction).
6. **Полная матрица 101 навыка и 16 пресетов:** Поддержка композитных оверлеев (например: `agy preset switch web +qa +docker`), объединяющих специализированные наборы инструментов под сложные задачи.

---

### 📖 Справочник команд CLI (`agy`)

#### 1. Управление пресетами навыков (`agy preset`)

- **Переключение активного пресета с композитными оверлеями:**
  ```bash
  # Переключение на базовый пресет
  agy preset switch backend

  # Переключение с добавлением оверлея
  agy preset switch backend qa

  # Композитное переключение с несколькими оверлеями
  agy preset switch web +qa +docker

  # Мультиагентный оркестратор
  agy preset switch orchestrator
  ```
  *Пример вывода:*
  ```text
  🎯 [Смена пресета: backend + qa] 21 навыков активно (синхронизировано за 22 мс via daemon)
    + Добавлено: playwright-e2e-guru, api-contract-tester, unit-test-synthesizer
    = Сохранено: 18 навыков
  ```

- **Вывод полного каталога 16 пресетов:**
  ```bash
  agy preset list
  ```
  *Выводит интерактивную таблицу всех доступных пресетов с иконками, количеством активных навыков, маркером текущего активного пресета (`*`) и описанием стека.*

- **Отображение текущего профиля и активных навыков:**
  ```bash
  agy preset current
  ```
  *Выводит имя пресета, число смонтированных ссылок на диске и полный список активных инструментов.*

---

#### 2. Управление аккаунтами и каруселью (`agy account`)

- **Просмотр статуса аккаунтов и карусели ($N$ слотов):**
  ```bash
  agy account status
  ```
  *Пример вывода:*
  ```text
  👤 Учетные записи Google Antigravity:
  ------------------------------------------------------------
  Активный слот: [1/3] developer@gmail.com
  Автопереход при 429 (Auto-Failover): Включен
  ------------------------------------------------------------
    ▶ [Слот 1] developer@gmail.com (ACTIVE)
      [Слот 2] backup-dev@gmail.com
      [Слот 3] team-lead@gmail.com
  ------------------------------------------------------------
  ```

- **Ротация активного аккаунта:**
  ```bash
  # Циклическое переключение на следующий аккаунт
  agy account rotate

  # Мгновенный переход на конкретный слот
  agy account rotate 2
  ```

- **Интерактивное добавление нового аккаунта:**
  ```bash
  agy account add
  ```
  *Безопасно подготавливает слот $N+1$, снимает текущую сессию и ожидает авторизации в окне Antigravity.*

- **Удаление аккаунта с Zero-Gap компактификацией:**
  ```bash
  agy account delete 2
  ```
  *Удаляет указанный слот из защищённого хранилища и автоматически сдвигает последующие слоты (слоты 3, 4 становятся 2, 3).*

---

#### 3. Управление фоновым демоном (`agy daemon`)

- **Запуск демона в фоне:**
  ```bash
  agy daemon start
  ```
  *Запускает фоновый процесс `agy-daemon` без консольного окна (`CREATE_NO_WINDOW | DETACHED_PROCESS`) и поднимает Named Pipe IPC.*

- **Запуск демона в консольном режиме (Foreground / Debug):**
  ```bash
  agy daemon start --foreground
  ```

- **Проверка статуса демона:**
  ```bash
  agy daemon status
  ```
  *Выводит аптайм демона, отслеживаемый путь к логам Language Server и количество подключенных слотов.*

- **Остановка демона:**
  ```bash
  agy daemon stop
  ```
  *Отправляет команду корректного завершения (Graceful Shutdown) через IPC.*

---

## 👥 Мульти-аккаунтинг и защита от квот ($N$ слотов)

1. **Изоляция OAuth:** Авторизационные ссылки Google строго перехватываются (`accounts.google.com`) и открываются во внешнем системном браузере через `shell.openExternal`.
2. **Принудительный выбор аккаунта:** При авторизации инжектируется параметр `prompt=select_account`, предотвращающий случайный вход в уже используемый профиль.
3. **Безопасное удаление слотов:** При удалении любого промежуточного аккаунта срабатывает **Zero-Gap Compaction** — оставшиеся слоты автоматически смещаются без пропусков (удаление слота 2 из 4 оставляет слоты 1, 2, 3).
4. **Сохранение токенов:** При ротации токен синхронизируется с фоновыми обновлениями Language Server, предотвращая неожиданный разлогин.
5. **Динамический размер карусели ($N$ аккаунтов):** Система масштабируется от 1 до произвольного числа аккаунтов, динамически выделяя слоты в системном защищённом хранилище.

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
- **`scripts/launch.vbs`**: Единая точка входа для Windows, запускающая `agy-daemon` и Antigravity Guard в фоновом скрытом режиме.
- **`scripts/autostart_daemon.vbs`** и **`scripts/register_daemon_task.bat`**: Скрипты автозапуска демона при входе пользователя в Windows (Task Scheduler / Startup).

---

## 📦 Установка и запуск (Готовые патчеры и CLI Guide)

> [!IMPORTANT]
> Перед установкой обязательно закройте клиент Antigravity.

### 🚀 Вариант А: Запуск скомпилированных патчеров в 1 клик (Standalone Binaries)

В каталоге `binaries/` собраны автономные бинарники под Windows (PE `.exe`) и Linux (ELF x86_64). Они не требуют наличия Python, Node.js или каких-либо внешних зависимостей.

#### 1. Windows (x64)
- **Полная установка всех компонентов (Мульти-аккаунты, Веб-панель, Пресеты, Обход ограничений, CLI agy)**:
  ```powershell
  .\binaries\windows-x64\AntigravityTweaksInstaller.exe
  # или из корня проекта:
  .\AntigravityTweaksInstaller.exe
  ```
- **Только патчинг региональных ограничений (Eligibility Bypass)**:
  ```powershell
  .\binaries\windows-x64\antigravity-eligibility-patcher.exe patch
  # Интерактивное меню:
  .\binaries\windows-x64\antigravity-eligibility-patcher.exe
  ```

#### 2. Linux / WSL (x86_64 ELF)
- **Полная установка всех компонентов (Мульти-аккаунты, Веб-панель, Пресеты, Обход ограничений, CLI agy)**:
  ```bash
  chmod +x binaries/linux-x64/*
  ./binaries/linux-x64/antigravity-tweaks-installer
  ```
- **Только патчинг региональных ограничений (Eligibility Bypass)**:
  ```bash
  ./binaries/linux-x64/antigravity-eligibility-patcher patch
  # Интерактивное меню:
  ./binaries/linux-x64/antigravity-eligibility-patcher
  ```

---

### 🛠️ Вариант Б: Ручная установка через CLI

#### 1. Пошаговая установка — Windows (PowerShell)

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

# 3. Развёртывание бинарников CLI и демона agy
$binDir = "$HOME\.gemini\antigravity\bin"
New-Item -ItemType Directory -Force $binDir | Out-Null
Copy-Item "agy\target\release\agy.exe" "$binDir\" -Force
Copy-Item "agy\target\release\agy-daemon.exe" "$binDir\" -Force

# 4. Развёртывание библиотеки 101 навыка (skills-library)
$skillsDir = "$HOME\.gemini\config\skills"
New-Item -ItemType Directory -Force $skillsDir | Out-Null
Copy-Item -Recurse -Force "skills-library\*" "$skillsDir\"

# 5. Обход региональных ограничений (Eligibility Bypass)
python eligibility-antigravity-patcher\manager.py --action patch

# 6. Запуск через launch.vbs (автостарт agy-daemon + Antigravity)
wscript scripts\launch.vbs
```

---

#### 2. Пошаговая установка — Linux / WSL (Bash)

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

Если вы хотите собрать компоненты самостоятельно из модифицированного исходного кода:

```bash
# 1. Сборка Rust CLI и демона agy
cd agy
cargo build --release
cd ..

# 2. Установка npm-зависимостей
npm install

# 3. Упаковка app.asar с сохранением credHelper и chrome-devtools распакованными
npx asar pack asar_extracted_228 app.asar --unpack "{**/chrome-devtools-mcp/**,**/credHelper.py}"

# 4. Скопируйте собранный app.asar в папку ресурсов Antigravity
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
├── agy/                             # Автономное Rust CLI-ядро (v3.0)
│   ├── crates/
│   │   ├── agy-cli/                 # Консольная утилита agy (switch, status, rotate)
│   │   ├── agy-daemon/              # Фоновый демон watchdog и Named Pipe IPC
│   │   └── agy-core/                # Общие модули (presests, credentials, IPC)
│   └── Cargo.toml
├── skills-library/                  # Мастер-библиотека 101 навыка
│   ├── agent-preset-conductor/      # Автономный мета-оркестратор (switch.py)
│   ├── nextjs-fullstack-guru/       # Скилл Web: Next.js 15 & RSC
│   ├── tailwind-v4-master/          # Скилл Web: Tailwind CSS v4
│   ├── postgres-dba-optimizer/      # Скилл Backend: PostgreSQL DBA
│   ├── fastapi-async-architect/     # Скилл Backend: Async FastAPI
│   ├── docker-container-master/     # Скилл DevOps: Multi-stage Docker
│   ├── k8s-manifest-generator/      # Скилл DevOps: Kubernetes manifests
│   ├── playwright-e2e-guru/         # Скилл QA: Playwright resilient E2E
│   ├── reverse-engineer-electron/   # Скилл AppSec: Electron ASAR reversing
│   └── ...                          # Полный набор 101 навыка
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
│   ├── switch.py                    # Быстрый шлюз к agy preset switch
│   ├── launch.vbs                   # Скрытый запуск agy-daemon + Antigravity
│   ├── autostart_daemon.vbs         # Автозапуск фонового демона agy-daemon
│   ├── register_daemon_task.bat     # Регистрация демона в Task Scheduler
│   ├── antigravity_bot.py           # Telegram Remote Commander
│   ├── antigravity_guard.py         # Watchdog-демон восстановления
│   └── agentapi.bat                 # Быстрый запуск на Windows
├── webDashboard.js                  # Mobile LAN Web Dashboard & Client (порт 51125)
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
