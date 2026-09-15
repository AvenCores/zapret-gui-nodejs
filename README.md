<div align="center">
    <a href="https://www.youtube.com/@avencores/" target="_blank">
      <img src="https://github.com/user-attachments/assets/338bcd74-e3c3-4700-87ab-7985058bd17e" alt="YouTube" height="40">
    </a>
    <a href="https://t.me/avencoresyt" target="_blank">
      <img src="https://github.com/user-attachments/assets/939f8beb-a49a-48cf-89b9-d610ee5c4b26" alt="Telegram" height="40">
    </a>
    <a href="https://vk.ru/avencoresreuploads" target="_blank">
      <img src="https://github.com/user-attachments/assets/dc109dda-9045-4a06-95a5-3399f0e21dc4" alt="VK" height="40">
    </a>
    <a href="https://dzen.ru/avencores" target="_blank">
      <img src="https://github.com/user-attachments/assets/bd55f5cf-963c-4eb8-9029-7b80c8c11411" alt="Dzen" height="40">
    </a>
</div>

# 🚀 Zapret GUI

<p align="center">
  <a href="https://github.com/AvenCores/zapret-gui-nodejs"><img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge" alt="GPL-3.0 License"></a>
  <a href="https://github.com/AvenCores/zapret-gui-nodejs/releases/latest"><img src="https://img.shields.io/github/v/release/AvenCores/zapret-gui-nodejs?style=for-the-badge" alt="Latest release"></a>
  <a href="https://github.com/AvenCores/zapret-gui-nodejs/stargazers"><img src="https://img.shields.io/github/stars/AvenCores/zapret-gui-nodejs?style=for-the-badge" alt="GitHub stars"></a>
  <img src="https://img.shields.io/github/forks/AvenCores/zapret-gui-nodejs?style=for-the-badge" alt="GitHub forks">
  <a href="https://github.com/AvenCores/zapret-gui-nodejs/watchers">
  <img src="https://img.shields.io/github/watchers/AvenCores/zapret-gui-nodejs?style=for-the-badge" alt="GitHub Watchers"></a>
  <a href="https://github.com/AvenCores/zapret-gui-nodejs/releases"><img src="https://img.shields.io/github/downloads/AvenCores/zapret-gui-nodejs/total?style=for-the-badge" alt="Downloads"></a>
  <a href="https://github.com/AvenCores/zapret-gui-nodejs/pulls"><img src="https://img.shields.io/github/issues-pr/AvenCores/zapret-gui-nodejs?style=for-the-badge" alt="GitHub pull requests"></a>
  <a href="https://github.com/AvenCores/zapret-gui-nodejs/issues"><img src="https://img.shields.io/github/issues/AvenCores/zapret-gui-nodejs?style=for-the-badge" alt="GitHub issues"></a>
</p>

Десктопный GUI для [zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube)
— обход DPI-блокировок Discord / YouTube / Telegram через `winws.exe` + WinDivert.

Стек: **Electron + React + TypeScript + TailwindCSS + zustand**,
установщик через **electron-builder (NSIS)**, автообновление приложения через **electron-updater**.

> Только Windows 10/11 x64. Требуются права администратора
> (драйвер WinDivert + служба `zapret` + файл hosts).
> 
<img width="1609" height="926" alt="1" src="https://github.com/user-attachments/assets/61a5c4b8-09a3-4abd-aa03-9eb04209beb7" />

## ✨ Возможности

| Страница | Что умеет |
|---|---|
| Дашборд | Статус `zapret` / WinDivert / `winws.exe`, активная стратегия, путь сервиса, кнопки Старт / Стоп / Рестарт / Удалить, детект чужого сервиса + takeover, блок Hosts (проверка/применение/контроль), bypass-проверки Discord/YouTube/Cloudflare |
| Стратегии | Все 22 стратегии из upstream, установка службой Windows, тестовый запуск в foreground-режиме с живым выводом, поиск, бейджи desync-методов, импорт своих `.bat`, удаление импортированных + тюнинг поверх стратегии: Game Filter, режим IPSet, активные `.bin`-фейки Discord/Game |
| Списки | Редактор пользовательских `*-user.txt` (`list-general-user.txt`, `list-exclude-user.txt`, `ipset-exclude-user.txt` + любые новые `*-user.txt`): счётчик записей, добавление, дедупликация, сортировка, лимит 2 МБ |
| Обновления | Версия zapret-данных, IPSet, стратегии (снапшот ветки), движок `bol-van/zapret` (выбор тега, allowlist бинарей в `bin/`), автообновление приложения (`electron-updater`) |
| Настройки | Только автозапуск с Windows и поведение трея: иконка в трее, сворачивание при закрытии, старт свёрнутым, пункты меню стратегий/тюнинга/быстрых настроек; флаг автопроверки обновлений — на странице Обновлений |
| Диагностика | 17 проверок + инструменты: очистка кэша Discord, удаление конфликтующих сервисов, встроенные тесты стратегий (standard/dpi) + встроенная секция Логи (живой поток, фильтр, экспорт; отдельная страница `logs` оставлена как legacy-алиас на диагностику) |
| Прочее | 28 языков с автоопределением языка ОС и fallback на английский, тёмная/светлая/авто тема, иконка трея с цветом статуса, мастер первого запуска, флаги языков в сайдбаре, выбор языка и темы на странице установщика |

## 📊 Дашборд

* Бейджи состояний `RUNNING` / `STOPPED` / `NOT_INSTALLED` / `START_PENDING` / `STOP_PENDING` / `UNKNOWN`
* Активная стратегия (из реестра `HKLM\…\Services\zapret\zapret-discord-youtube` + `settings.json`)
* Путь сервиса (`ImagePath`) и путь запущенного `winws.exe` (через `Get-Process`)
* Бейдж прав администратора + баннер с кнопкой «Перезапустить с правами администратора» (UAC через `Start-Process -Verb RunAs`)
* Детект чужого сервиса:
  * `ownership === 'foreign'` — сервис `zapret` запущен не из `%APPDATA%\zapret-gui\data\bin` → баннер + кнопки «Взять под управление» / «Удалить чужой сервис»
  * Портативный кейс — сервиса нет, но `winws.exe` запущен → предупреждение о конфликте
* Блок ссылок: репозиторий, проблемы, релизы, YouTube, Telegram, VK, Dzen
* Блок Hosts: сверка системного `hosts` с upstream (маркеры first/last, размер блока, время проверки, превью содержимого), применение в системный `hosts` с бэкапом `.zapret-gui.bak` и автоповторной проверкой установки

## 🧩 Стратегии

* 22 встроенные стратегии (`bundled-assets/strategies/*.json`, сгенерированы из `bundled-assets/bat/*.bat`):
  `general`, `general (ALT…ALT13)`, `general (EXP)`, `general (FAKE TLS AUTO…)`, `general (SIMPLE FAKE…)` и др.
* Поиск по имени, группы `Flowseal (встроенные)` / `Импортированные`
* Автоописание по desync-методам: `fake`, `fakedsplit`, `multisplit`, `multidisorder`, `hostfakesplit`, `syndata`, `split`, `disorder`, `fake QUIC`, `fake TLS`, `фильтр Discord voice/STUN`, `game-фильтр`, `экспериментальная`
* Foreground-тест: `spawnLong(<data>/bin/winws.exe, args)` + стрим `stdout/stderr/exit` через `zapret:on-test-output`
* Импорт: диалог выбора `.bat` → `parseBatContent()` → `<id>.json` (`origin: 'imported'`) + копия исходного `.bat` рядом
* Удаление только импортированных (встроенные защищены от удаления)
* «Выбрать» сохраняет стратегию в настройки, не трогая сервис; бейджи `активна` (установлена службой) vs `выбрана` (ожидает); расхождение показывает только информационное уведомление «Стратегия … выбрана, но не применена. Примените стратегию» (без кнопок), само применение — через меню стратегий в трее или кнопку Старт на Дашборде

## ⚙️ Настройки и тюнинг

> Game Filter, IPSet и `.bin`-фейки живут на странице **Стратегии** (блок тюнинга поверх
> установленной стратегии), а не в Настройках. Страница **Настройки** — только автозапуск и трей.

| Параметр | Где | Значения / поведение |
|---|---|---|
| Game Filter (`utils/game_filter.enabled`) | Стратегии | `disabled` / `all` (TCP+UDP) / `tcp` / `udp` — порты `1024-65535` vs `12` |
| IPSet (`lists/ipset-all.txt`) | Стратегии | `none` (`203.0.113.113/32`) / `loaded` (restore из `.backup`) / `any` (пустой файл) |
| Фейки (`.bin`) | Стратегии | Списки из `bin/*.bin` (без `ACTIVE_*`), замена `ACTIVE_DISCORD_UDP.bin` / `ACTIVE_GAME_UDP.bin` копией выбранного фейка |
| Автопроверка обновлений | Обновления | Флаг-файл `utils/check_updates.enabled` |
| Автозапуск с Windows | Настройки | `app.setLoginItemSettings({ openAtLogin })` |
| Трей | Настройки | `showTrayIcon`, `minimizeToTrayOnClose`, `startMinimizedToTray`, видимость подменю `trayStrategyMenu` / `trayTuningMenu` / `trayQuickSettings` |
| Язык / Тема | Сайдбар + установщик | Сохраняются в `settings.json`, применяются мгновенно (трей перестраивается сразу через `onSettingsChanged` + по таймеру ~15с) |

## 🔄 Обновления

* `checkZapretUpdates()` — сравнивает локальный `bundled-assets/service/version.txt` (сейчас `1.10.2`, это версия **zapret-данных**, не приложения!) с upstream `.service/version.txt` через `compareVersions()`
* `updateIPSetList()` — качает `.service/ipset-service.txt` → `lists/ipset-all.txt`, удаляет stale `.backup`, возвращает `{ lines, bytes }`
* `checkHosts()` / `applyHosts()` — качает `.service/hosts`, сравнивает первую/последнюю строки с системным `hosts`, при применении заменяет zapret-блок или дописывает + бэкап `hosts.zapret-gui.bak`
* `updateStrategiesFromGithub()`:
  1. Снапшот исходников ветки `UPSTREAM_BRANCH` через `codeload.github.com/.../zip/refs/heads/<branch>` (не release-ассеты) + `branchHeadApi` для SHA
  2. Скачивание с прогрессом `zapret:on-download-progress` (0–80%)
  3. Бэкап `bin/lists/utils/strategies` → `data/_backup/<timestamp>`
  4. `Expand-Archive` через PowerShell, обход одного top-level каталога
  5. Копирование только изменённых файлов (сравнение по размеру + хешу), `lists/*-user.txt` никогда не затираются
  6. Регенерация `strategies/*.json` из `*.bat` корня архива (`origin: 'bundled'`, `service.bat` исключён), поверх накатываются Win7-драйверы при необходимости
* Движок `bol-van/zapret` (`listEngineReleases/checkEngineUpdates/updateEngineToTag`):
  выбор тега `/^v\d[\w.\-]{0,31}$/` → `zapret-<tag>.zip` → синхронизация только allowlist `ENGINE_BIN_FILES`
  (`winws.exe`, `WinDivert.dll`, `WinDivert64.sys`, `cygwin1.dll`, `mdig.exe`, `ip2net.exe`, `killall.exe`)
  + `files/fake/*.bin` (кроме `ACTIVE_*`) в `bin/`, версия в `bin/engine-version.txt`, перед копией `net stop zapret` + `taskkill winws.exe`
* Автообновление приложения: `electron-updater` (`autoDownload: false`, проверка при старте + каждые 6ч, события `zapret:app-update-available` / `zapret:app-update-downloaded`, нативный диалог «Скачать / Позже» + баннер в UI, установка через `quitAndInstall`)

## 🩺 Диагностика (17 проверок)

| № | Проверка | Смысл |
|---|---|---|
| 1 | BFE | `Base Filtering Engine` должен быть `RUNNING`, иначе WinDivert/zapret не работают |
| 2 | Системный прокси | `ProxyEnable` + `ProxyServer` из реестра — предупреждение, если включён |
| 3 | TCP timestamps | `netsh interface tcp show global`, автофикс `timestamps=enabled` (как в `service.bat`) |
| 4 | AdGuard | `AdguardSvc.exe` может ломать голосовой Discord |
| 5 | Killer Network | Сервисы `*killer*` конфликтуют с zapret |
| 6 | Intel Connectivity | `intel*connectivity` — конфликт |
| 7 | Check Point | `TracSrvWrapper` / `EPWD` — только удаление |
| 8 | SmartByte | `smartbyte` — отключать через `services.msc` |
| 9 | Кириллица в пути | Символы `[\u0400-\u04FF]` в пути установки |
| 10 | OneDrive | Установка внутри OneDrive → перенести, напр. в `C:\zapret` |
| 11 | WinDivert64.sys | Наличие `.sys` в `bin/` |
| 12 | VPN-сервисы | `sc query` + фильтр `/vpn/i` |
| 13 | Secure DNS | `DohFlags > 0` в `Dnscache\InterfaceSpecificParameters` — OK, если настроен DoH |
| 14 | Записи YouTube в hosts | `youtube.com` / `youtu.be` в системном hosts |
| 15 | Залипший WinDivert | `winws` не запущен, а `WinDivert` активен → автоудаление stale-службы |
| 16 | Сторонний zapret | Чужой `ImagePath` или портативный `winws.exe` без сервиса |
| 17 | Конфликтующие сервисы | `GoodbyeDPI`, `discordfix_zapret`, `winws1`, `winws2` |

Инструменты:

* Очистка кэша Discord — варианты `discord` / `discordptb` / `discordcanary` / `discorddevelopment` (`Cache`, `Code Cache`, `GPUCache`), с завершением процессов `Discord*.exe`
* Удаление конфликтующих сервисов + остатков `WinDivert` / `WinDivert14`
* Встроенные тесты стратегий (`src/main/config-tester.ts`): поочерёдный запуск каждой стратегии через `winws.exe`, проверки HTTP/TLS1.2/TLS1.3 + ping по `utils/targets.txt` (standard) или POST 64KB с `Range` для детекта TCP 16–20 freeze по suite hyperion-cs (dpi), аналитика + выбор лучшей + файл `utils/test results/test_results_*.txt` — всё внутри окна программы, без внешнего PowerShell

## 📝 Логи

* Источники: `app` / `winws` / `updater` / `diag`, уровни `info` / `warn` / `error`
* Файл `%APPDATA%\zapret-gui\app.log` + in-memory буфер 2000 строк
* Секция «Логи» встроена в страницу Диагностики (тип страницы `logs` в сторе — legacy-алиас на `diagnostics`): фильтр по тексту/источнику, моноширинный вывод `HH:MM:SS [source] text`, экспорт в `zapret-gui-logs-YYYY-MM-DD.log` через диалог сохранения + автооткрытие папки

## 🌍 Локализация (28 языков)

RU • EN • UK • BE • KK • DE • FR • ES • IT • PT • NL • PL • CS • SK • HU • RO • BG • SR • HR • EL • TR • AR • FA • ZH • JA • KO • HI • ID

* Словари: `src/shared/locales/*.ts`, тип `I18nKey = keyof typeof ru`
* Язык ОС → локаль приложения: `resolveSystemLocale()` (нормализация `ru-RU`/`en_US`, алиасы `bs→sr`, `pt-BR→pt`, `zh-TW→zh` и др., fallback `en`)
* `translate()` с fallback `locale → en → ru → key`, `formatDetail()` подставляет `{placeholders}` в шаблоны диагностики
* Main-процесс возвращает сырые данные + `labelKey`/`detailKey`, переводит только renderer (zustand `t()`)
* Первый запуск: локаль из `app.getLocale()`, тема из `nativeTheme.shouldUseDarkColors` (по умолчанию тёмная)

## 🎨 Тема и трей

* Тёмная/светлая тема через класс `dark` + Tailwind, анимация переключения `.theme-anim` ~350мс
* Трей: иконка по статусу `running` / `stopped` / `not-installed` / `unknown` (готовые `bundled-assets/tray/tray-*.png` или генерация 16×16 PNG-кружка), тултип `Zapret GUI — <статус>`, меню Старт / Стоп / Рестарт, подменю стратегий (лимит 8 + активная всегда видна), навигация по 6 страницам, GameFilter / IPSet / автозапуск / трей-тогглы, Открыть / Выйти, дабл-клик/клик — показать окно, автообновление каждые 15с + мгновенно по `onSettingsChanged`, скрытие через `showTrayIcon`, чужая служба (`ownership === 'foreign'`) блокирует управление из трея
* Модалка «О программе»: версии приложения/данных, ссылки, лицензия GPL-3.0, донат-блок SBER с кнопкой копирования

## 💾 Раскладка установки (без папки `zapret-discord-youtube-main`!)

* Установщик (NSIS): `%LOCALAPPDATA%\Programs\Zapret GUI\` (+ ярлыки на рабочем столе и в меню «Пуск»), запрашивает повышение прав (`requestedExecutionLevel: requireAdministrator`, `oneClick: false`, цель только `nsis`, `include: build/installer.nsh` с выбором языка/темы через `install-defaults.json`)
* Рабочие данные (при первом запуске копируются из `resources/bundled-assets` установщика, пользовательские файлы не перезаписываются): `%APPDATA%\zapret-gui\data\{bin,lists,utils,strategies}`
  * `bin/` — `winws.exe`, `WinDivert64.sys`, `WinDivert.dll`, `cygwin1.dll`, `engine-version.txt`, `tls_clienthello_*.bin` / `quic_initial_*.bin` / `stun*.bin` / `ACTIVE_*.bin`
  * `lists/` — `ipset-all.txt` (+ `.backup`), `list-general.txt`, `list-google.txt`, `list-exclude.txt`, `ipset-exclude.txt` + создаваемые `*-user.txt` заглушки (`list-general-user.txt`, `list-exclude-user.txt`, `ipset-exclude-user.txt`, лимит редактора 2 МБ)
  * `utils/` — `targets.txt`, результаты `test results/`, флаги `check_updates.enabled` / `game_filter.enabled`
  * `strategies/` — 22 × `*.json`
  * служебные: `_backup/<timestamp>` (снапшоты перед обновлением), `_tmp/`, `tray-icons/` (сгенерированные PNG)
* Настройки: `%APPDATA%\zapret-gui\settings.json` (`locale`, `theme`, `autoLaunch`, `showTrayIcon`, `trayStrategyMenu`, `trayTuningMenu`, `trayQuickSettings`, `startMinimizedToTray`, `minimizeToTrayOnClose`, `activeStrategyId`, `discordFake`, `gameFake`)
* Лог: `%APPDATA%\zapret-gui\app.log`
* Dev-режим: `bundled-assets` из репозитория, данные в `<repo>/.data`, `userData` изолирован в `zapret-gui-dev` во избежание лока кэша Chromium

## 🖥️ Windows 7 (экспериментально)

Штатно поддерживаются только Windows 10/11 x64: текущий Electron не запускается на Windows 7.
Подмена драйверов ниже решает только ошибку 577 (`ERROR_INVALID_IMAGE_HASH`), но не запуск самого приложения.

* `bundled-assets/bin-win7/` — WinDivert 2.2.0-C с двойной подписью SHA1+SHA256 (аналог `win7/` из zapret-win-bundle)
* На Windows 7 приложение само перезаписывает `WinDivert.dll` / `WinDivert64.sys` в `%APPDATA%\zapret-gui\data\bin` версиями из `bin-win7/` — при первом запуске и после каждого обновления стратегий. Вручную копировать ничего не нужно
* Без ESU-обновлений (патч KB3033929) стоковые драйверы из `bin/` на Windows 7 не загрузятся
* Полноценная поддержка Windows 7 потребовала бы отдельной сборки на Electron 22 + проверки `winws.exe` / `cygwin1.dll` на Win7 — пока не делается

## 🛠️ Разработка

```powershell
npm install                  # зависимости
npm run dev                  # electron-vite dev (для функций служб нужна Windows)
npm test                     # vitest run
npm run test:watch           # vitest watch
npm run lint                 # typecheck (tsc --noEmit)
npm run typecheck            # то же самое
npm run generate:strategies  # перепарсить bundled-assets/bat/*.bat → bundled-assets/strategies/*.json
npm run build                # generate:strategies + electron-vite build
npm run build:win            # установщик NSIS в dist/ (--publish never)
npm run build:win:publish    # то же + публикация в GitHub Releases (--publish always)
npm run clean                # удалить out/ и dist/ (scripts/clean.mjs)
npm run rebuild              # clean + полная пересборка из исходников
npm run icon                 # сгенерировать иконки (scripts/make-icon.mjs)
npm run preview              # electron-vite preview
```

`npm run generate:strategies` автоматически выполняется перед каждой сборкой.
В CI `bundled-assets/` уже закоммичен, скрипт только идемпотентно пересинхронизирует JSON-конфиги.

Тесты (vitest, 14 файлов + `setup.ts`): `strategy-parser`, `service-manager`, `strategies`, `strategy-updater`, `diagnostics-detail`, `exec`, `i18n-25`, `locale-tray`, `paths-win7`, `config-tester`, `installer-update`, `settings-notify`, `status-dot`, `user-lists`.

CI (`.github/workflows/`): `build.yml` + `release.yml`.

## 📁 Структура проекта

```
src/
  main/         index.ts (окно 1625x935 min 1080x680, tray, auto-updater, first-run wizard)
                tray.ts (цветные иконки, меню Start/Stop/Restart/Strategies/Goto/Tuning/QuickSettings)
                ipc-handlers.ts (все IPC + foreground-тест + экспорт логов)
                service-manager.ts (sc/net/reg/tasklist, install/remove/start/stop, GameFilter, IPSet, Discord-кэш, конфликты)
                strategy-parser.ts (парсинг .bat в args, плейсхолдеры <BIN>/<LISTS>/<GAME_TCP>/<GAME_UDP>/<ROOT>)
                strategy-updater.ts (version/IPSet/hosts/source-snapshot/engine bol-van, .bin-фейки)
                diagnostics.ts (17 проверок)
                config-tester.ts (нативный тестер standard/dpi, targets.txt, test results/)
                bypass-check.ts (HTTPS-пробы YouTube/Discord/Cloudflare из main-процесса)
                user-lists.ts (*-user.txt: list/read/write, лимит 2 МБ)
                app-updater.ts (electron-updater: check/download/install, диалог + баннер)
                settings.ts (settings.json + systemDefaults + install-defaults.json + autoLaunch)
                paths.ts (bundled-assets vs %APPDATA%/zapret-gui/data, Win7-детект + applyWin7Drivers)
                exec.ts (cmd/powershell, isAdmin, RunAs, spawnLong)
                window.ts (первое окно + best-effort IPC-отправка в renderer)
                logger.ts (файл + буфер 2000 + zapret:on-log)
  preload/      index.ts — типизированный мост window.zapret
  renderer/     App.tsx + main.tsx + store.ts — zustand (page/locale/theme/status/strategies/logs/busy/error, logs→diagnostics)
                components/ Layout.tsx (сайдбар, пикер языка с флагами SVG, темы, AboutModal с донатом) + ui.tsx
                pages/ Dashboard Strategies Lists Updates Settings Diagnostics (+ Logs как секция диагностики)
                assets/ app-icon.png
  shared/       types.ts (ServiceState, Strategy, StatusSnapshot, DiagnosticCheck, UpdateInfo, EngineVersionInfo, AppSettings, IPC ~53 канала)
                constants.ts (SERVICE_NAME=zapret, UPSTREAM_OWNER=Flowseal, ENGINE_OWNER=bol-van, URLS, CONFLICTING_SERVICES, FAKE_*.bin)
                i18n.ts + locales/ (28 словарей)
bundled-assets/ bin/ (engine-version.txt) bin-win7/ (WinDivert с подписью для Win7) lists/ utils/ strategies/ (22 JSON) bat/ (22 general*.bat + service.bat) service/ (version.txt + engine-version.txt + hosts) tray/ (4 PNG) icon.ico
scripts/        generate-strategies.mjs + clean.mjs + make-icon.mjs
tests/          14 x *.test.ts + setup.ts
.github/workflows/ build.yml release.yml
build/ installer.nsh electron-builder.yml electron.vite.config.ts tailwind.config.js postcss.config.cjs
```

## ⚙️ Как работает служба

Применение стратегии повторяет `service.bat :service_install`:

1. `netsh … timestamps=enabled`
2. `net stop zapret` / `sc delete zapret`
3. `sc create zapret binPath= "<data>\bin\winws.exe <подставленные аргументы>" start= auto` + `sc description`
4. `sc start zapret` + имя стратегии в `HKLM\…\Services\zapret\zapret-discord-youtube`

Bat-переменные при парсинге превращаются в плейсхолдеры и подставляются под конкретную машину в момент применения:

| .bat | Плейсхолдер | На применении |
|---|---|---|
| `%BIN%`, `%~dp0bin\` | `<BIN>` | `%APPDATA%\zapret-gui\data\bin` |
| `%LISTS%`, `%~dp0lists\` | `<LISTS>` | `%APPDATA%\zapret-gui\data\lists` |
| `%GameFilterTCP%` | `<GAME_TCP>` | `1024-65535` / `12` |
| `%GameFilterUDP%` | `<GAME_UDP>` | `1024-65535` / `12` |
| `%~dp0` | `<ROOT>` | `bin`-директория |
| `^!` | `!` | Снятие batch-экранирования |

Определение состояния — через `Get-Service` (locale-independent, в отличие от парсинга `sc query`, который на русской Windows возвращает `СОСТОЯНИЕ` вместо `STATE`), `sc` остаётся fallback-ом.

## ❓ FAQ

* **«Нет прав администратора»** — нажмите «Перезапустить с правами администратора», иначе недоступны старт/стоп/применение/hosts/диагностика.
* **«Обнаружен сторонний zapret»** — удалите чужой сервис (кнопка спросит подтверждение с путём) и примените стратегию из вкладки «Стратегии».
* **OneDrive / кириллица в пути** — перенесите установку, напр. в `C:\zapret` (подскажет диагностика).
* **YouTube не открывается** — проверьте записи `youtube.com` в hosts + настройте Secure DNS (DoH) в браузере/Windows 11.
* **Конфликты (GoodbyeDPI и др.)** — кнопка «Удалить конфликтующие сервисы» в диагностике.
* **Голосовой Discord хрипит** — проверьте AdGuard / Killer / SmartByte / VPN, очистите кэш Discord, попробуйте другую стратегию + foreground-тест.

# 📜 Лицензия

Проект распространяется под лицензией GPL-3.0. Полный текст лицензии содержится в файле [`LICENSE`](LICENSE).

---
# 💰 Поддержать автора
+ **SBER**: `2202 2050 1464 4675`
