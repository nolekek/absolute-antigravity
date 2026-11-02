# Absolute-Antigravity v2.0: ArtCraft Suite & Dedicated Presets Handoff Guide

> **Документ передачи контекста (Technical Handoff & Runbook)**  
> **Целевая аудитория**: Смежный чат Antigravity, проводящий тестирование, сборку инсталлятора, перепаковку ASAR и интеграцию с остальными компонентами.  
> **Дата релиза**: Ноябрь 2026 | **Версия**: v2.0.0 (Крупное обновление №2)  
> **Статус тестов**: 100% PASS (79/79 тестов, `node tests/run_all.js`)

---

## 1. Резюме релиза v2.0

В рамках второго крупного обновления репозитория **`absolute-antigravity`** (`antigravityBUTmultiacc`) реализована полная интеграция нативного локального комплекса **ArtCraft Suite** (10 высокопроизводительных 64-битных Rust CLI/MCP движков), расширена матрица пресетов с 14 до **16 сфокусированных пресетов** (добавлены специализированные пресеты `hardware` и `media`), обновлен интеллектуальный детектор рабочего пространства `stackDetector.js`, развернуто 11 новых скиллов и автоматизирована синхронизация `mcp_config.json`.

---

## 2. Спецификация флота 10 MCP-серверов (ArtCraft Suite)

Все 10 движков установлены локально на машине, скомпилированы на **Rust**, имеют нулевые внешние облачные зависимости и работают по стандартному протоколу **Model Context Protocol (JSON-RPC 2.0 stdio transport, ревизия 2024-11-05 / 2025-06-18)**.

### Реестр движков в `~/.gemini/config/mcp_config.json`:
| ID сервера | Продукт | Категория и задачи | Исполняемый файл | Аргументы запуска | Поддерживаемые форматы |
|---|---|---|---|---|---|
| `craft-anything` | **Craft Anything v0.2.0** | Реверс-инжиниринг, декомпиляция, Clean-Room анализ (314 инструментов) | `C:\Program Files\Craft Anything\craft-anything-cli.exe` | `["mcp"]` | `.cany`, `.exe`, `.dll`, `app.asar`, `.apk`, `.dex`, `.so`, `.wasm` |
| `artcraft-cadcraft` | **CADCraft v0.16.0** | 2D/3D САПР черчение, архитектура, DWG/DXF (аналог AutoCAD) | `C:\Program Files\ArtCraft\CADCraft\cadcraft-cli.exe` | `["mcp"]` | `.dwg`, `.dxf`, `.dwt`, `.svg`, `.pdf`, `.png` |
| `artcraft-solidcraft` | **SolidCraft v0.30.0** | Параметрическое 3D твердотельное CAD-моделирование, STEP (аналог SolidWorks) | `C:\Program Files\SolidCraft\solidcraft-cli.exe` | `["mcp", "--headless", "--allow-any-path"]` | `.sc`, `.step`, `.stp`, `.stl`, `.obj` |
| `artcraft-texturecraft` | **TextureCraft v0.2.0** | 3D PBR текстурирование, UV-карты, материалы (аналог Substance Painter) | `C:\Program Files\TextureCraft\texturecraft-cli.exe` | `["mcp"]` | `.tcraft`, `.obj`, `.gltf`, Albedo, Roughness, Metal, Normal |
| `artcraft-filmcraft` | **FilmCraft v0.16.0** | Нелинейный видеомонтаж NLE, таймлайн, звук, экспорт (аналог Premiere) | `C:\Program Files\ArtCraft\FilmCraft\filmcraft-cli.exe` | `["mcp"]` | `.fcproj`, H.264, HEVC, ProRes, DNxHR, WAV, AAC |
| `artcraft-effectcraft` | **EffectCraft v0.20.0** | Моушн-дизайн, визуальные эффекты VFX, композитинг (аналог After Effects) | `C:\Program Files\ArtCraft\EffectCraft\effectcraft-cli.exe` | `["mcp"]` | `.ecproj`, `.aep`, JSX-скрипты, PNG-секвенции |
| `artcraft-lightcraft` | **LightCraft v0.17.0** | Проявка RAW фото, HDR сшивка, панорамы, LUT (аналог Lightroom) | `C:\Program Files\ArtCraft\LightCraft\lightcraft-cli.exe` | `["mcp"]` | RAW (ARW/NEF/CR3/RAF), DNG, AVIF, JXL, TIFF |
| `artcraft-photocraft` | **PhotoCraft v0.19.0** | Растровый графический редактор, слои, маски, PSD (аналог Photoshop) | `C:\Program Files\ArtCraft\PhotoCraft\photocraft-cli.exe` | `["mcp"]` | `.pcraft`, `.psd`, `.png`, `.jpg`, `.webp`, `.exr` |
| `artcraft-vectorcraft` | **VectorCraft v0.20.0** | Векторная графика, кривые Безье, SVG, типографика (аналог Illustrator) | `C:\Program Files\ArtCraft\VectorCraft\vectorcraft-cli.exe` | `["mcp", "--headless"]` | `.vcraft`, `.svg`, `.ai`, `.pdf`, `.eps` |
| `artcraft-figcraft` | **FigCraft v0.14.0** | UI/UX дизайн-системы, компоненты, токены, экспорт (Figma/Penpot) | `C:\Program Files\ArtCraft\FigCraft\figcraft-cli.exe` | `["mcp"]` | `.figcraft`, `.penpot`, `.fig`, `.sketch`, `.json`, `.svg` |

---

## 3. Матрица пресетов Absolute-Antigravity v2.0 (16 Presets)

Число сфокусированных пресетов расширено с 14 до 16. Запрет на универсальный раздутый пресет `all` сохраняется.

```
+---------------------------------------------------------------------------------------------------+
| PRESET ID            | ИКОНКА | ДОМЕН И НАЗНАЧЕНИЕ                        | КЛЮЧЕВЫЕ СКИЛЛЫ               |
+---------------------------------------------------------------------------------------------------+
| hardware [НОВЫЙ]     |  📐   | Hardware & CAD/CAM Studio                 | solidcraft-modeling,          |
|                      |        | 3D твердотельное моделирование, DWG/DXF,  | cadcraft-drafting,            |
|                      |        | PBR текстуры, STEP/STL экспорт            | texturecraft-pbr, cpp-systems |
+---------------------------------------------------------------------------------------------------+
| media [НОВЫЙ]        |  🎨   | Creative Studio & Media Production        | filmcraft-video,              |
|                      |        | Видеомонтаж NLE, моушн-дизайн VFX,        | effectcraft-vfx,              |
|                      |        | проявка RAW, растр PSD, вектор SVG, UI    | lightcraft-photo, photocraft, |
|                      |        |                                           | vectorcraft, figcraft-design  |
+---------------------------------------------------------------------------------------------------+
| reverse-engineering  |  🧬   | Reverse Engineering & Replica             | craft-anything [НОВЫЙ],       |
|                      |        | Clean-Room репликация, 314 инструментов   | replica-*, reverse-electron   |
+---------------------------------------------------------------------------------------------------+
| appsec               |  🛡️   | AppSec & Reversing                        | craft-anything [НОВЫЙ],       |
|                      |        | Аудит бинарников, декомпиляция ASAR       | appsec-code-auditor, etc.     |
+---------------------------------------------------------------------------------------------------+
| web                  |  🌐   | Modern Web (React / Next / Vue / Tailwind)| figcraft-design [НОВЫЙ],      |
|                      |        |                                           | vectorcraft-artwork [НОВЫЙ]   |
+---------------------------------------------------------------------------------------------------+
| orchestrator         |  🎭   | Multi-Agent Orchestration & Cross-Domain  | artcraft-orchestrator [НОВЫЙ],|
|                      |        | Координация аппаратных и медиа пайплайнов | craft-anything, figcraft      |
+---------------------------------------------------------------------------------------------------+
| vst3                 |  🎛️   | VST3 & Audio DSP Studio                   | figcraft-design [НОВЫЙ],      |
|                      |        | JUCE C++, аудио UI, регуляторы            | vectorcraft-artwork [НОВЫЙ]   |
+---------------------------------------------------------------------------------------------------+
| systems              |  ⚡   | Systems & High-Perf (C++, Rust, Zig)      | cpp-systems-architect, etc.   |
| backend              |  ⚙️   | Backend & DB (Node, FastAPI, Go, Postgres)| database-design, etc.         |
| devops               |  🐳   | DevOps, Docker, K8s, CI/CD                | docker-container-master, etc. |
| qa                   |  🧪   | QA, Testing, Playwright E2E               | playwright-e2e-guru, etc.     |
| ai-agents            |  🤖   | AI, MCP & RAG Engineering                 | mcp-builder, prompt-eng, etc. |
| web-research         |  🔍   | Web Research & OSINT                      | search-specialist, etc.       |
| product              |  💎   | Product & Monetization                    | product-monetization, etc.    |
| meta-dev             |  🛠️   | Antigravity Core & Self-Dev               | antigravity-core-dev, etc.    |
| minimal              |  ⚡   | Minimal Context Baseline                  | agent-preset-conductor, etc.  |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Карта модификаций репозитория

В репозитории `antigravityBUTmultiacc` были изменены и добавлены следующие файлы:

1. **`scripts/sync_artcraft_mcp.py`** (НОВЫЙ):
   - Автоматический скрипт обнаружения установленных ArtCraft движков в `Program Files`.
   - Встроенный health-check пинг по протоколу JSON-RPC 2.0 (`--ping`).
   - Безопасное обновление `~/.gemini/config/mcp_config.json` с созданием `.artcraft.backup`.
2. **`skillManager.js`**:
   - Добавлены объекты пресетов `hardware` и `media`.
   - Обновлены списки скиллов для `reverse-engineering`, `appsec`, `web`, `vst3`, `orchestrator`.
   - Поддерживает 16 пресетов через `getPresets()`.
3. **`stackDetector.js`**:
   - Добавлены эвристики детекции аппаратных CAD-файлов (`.sc`, `.step`, `.stp`, `.stl`, `.dxf`, `.dwg`, `.dwt` $\to$ `hardware`).
   - Добавлены эвристики медиа-файлов (`.fcproj`, `.ecproj`, `.pcraft`, `.psd`, `.vcraft`, `.tcraft`, `.figcraft`, `.penpot`, RAW $\to$ `media`).
   - Добавлены эвристики реверса (`.cany`, `.apk`, `.dex`, `.asar` $\to$ `reverse-engineering`).
4. **`scripts/switch.py`** и **`~/.gemini/config/skills/agent-preset-conductor/scripts/switch.py`**:
   - Синхронизирован словарь `PRESET_SKILLS_MAP` на 16 пресетов.
5. **`skills-library/`** и **`~/.gemini/config/skills/`** (11 новых скиллов):
   - `craft-anything` (официальный скилл из бинарника v0.2.0).
   - `cadcraft-drafting`, `solidcraft-modeling`, `texturecraft-pbr`.
   - `filmcraft-video`, `effectcraft-vfx`, `lightcraft-photo`, `photocraft-studio`, `vectorcraft-artwork`, `figcraft-design`.
   - `artcraft-orchestrator`.
6. **`agent-preset-conductor/SKILL.md`**:
   - Обновлена таблица до 16 пресетов.

---

## 5. Инструкция для смежного чата (Verification & Integration Runbook)

Смежному чату рекомендуется выполнить следующие шаги верификации:

### Шаг 1. Контрольный прогон мастер-тестов (79/79 PASS)
Запустить мастер-тест раннер репозитория:
```powershell
node tests/run_all.js
```
*Критерий успеха*: `Total Passed: 79 | Total Failed: 0 | Final Result: ✔ 100% ALL TESTS PASSED`.

### Шаг 2. Проверка доступности и пинг MCP-серверов
Запустить health-check всех 10 серверов:
```powershell
python scripts/sync_artcraft_mcp.py --ping
```
*Критерий успеха*: Все 10 серверов выдают `✔ PASS -> <Название> v<Версия>`.

### Шаг 3. Проверка переключения пресетов через Conductor CLI
Протестировать переключение на новые и обновленные пресеты:
```powershell
python scripts/switch.py hardware
python scripts/switch.py media
python scripts/switch.py reverse-engineering
python scripts/switch.py meta-dev
```
*Критерий успеха*: Каждое переключение возвращает `✔ Successfully switched to preset` с правильным списком активных скиллов.

### Шаг 4. Проверка детектора стека (Unit-check)
Проверить, что стек корректно детектирует файлы:
```powershell
node -e "const sd = require('./stackDetector.js'); console.log(sd.detectProjectStack(process.cwd()).id);"
```
*Критерий успеха*: Возвращает `meta-dev`.

### Шаг 5. Сборка и перепаковка инсталлятора
При необходимости перепаковать ASAR и обновить инсталлятор для конечных пользователей:
```powershell
python scripts/antigravity_dev.py build-asar
```
Или использовать `build_installer/` для генерации свежего `AntigravityTweaksInstaller.exe`.

---

## 6. Известные нюансы и рекомендации

1. **Режим Headless vs Bridge**:
   - `solidcraft-cli` и `vectorcraft-cli` запускаются в `mcp_config.json` с флагом `--headless` и `--allow-any-path` для автономной работы без GUI.
   - Если пользователь открывает графическое окно программы (например, `SolidCraft.exe`), он может запустить CLI с флагом `--bridge <PORT>` для управления живым окном.
2. **Конфликты портов**:
   - Локальный мост Multi-Account использует порт `51122`. ArtCraft CLI используют прямые каналы stdio и не занимают сетевые порты, исключая риск EADDRINUSE.
3. **Безопасность файлов**:
   - Все изменения конфигурации `mcp_config.json` сохраняют резервную копию `mcp_config.json.artcraft.backup`.
