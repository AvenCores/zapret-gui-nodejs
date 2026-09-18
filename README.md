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
— обход DPI-блокировок Discord / YouTube / Telegram через `winws.exe` + WinDivert,
плюс встроенный MTProto-прокси для Telegram Desktop (мост MTProto → WebSocket, порт `127.0.0.1:1443`).

Стек: **Electron + React + TypeScript + TailwindCSS + zustand**,
установщик через **electron-builder (NSIS)**, автообновление приложения через **electron-updater**.

> Только Windows 10/11 x64. Требуются права администратора
> (драйвер WinDivert + служба `zapret` + файл hosts).
> 
<img width="1609" height="926" alt="1" src="https://i.ibb.co/6JYnxWSc/1.png" />

# 🎦 Видео гайд по установке

![maxresdefault](https://i.ibb.co/SwxyHpRX/2.png)

<div align="center">

[**Смотреть на YouTube**](https://youtu.be/OBO6CJBKgVU)

[**Смотреть на Dzen**](https://dzen.ru/video/watch/6aaa90d3fff8b146741fe07f)

[**Смотреть в VK Video**](https://vkvideo.ru/video-234234162_456239119)

[**Смотреть в Telegram**](https://t.me/avencoreschat/579826)

</div>

## ✨ Возможности

| Страница | Что умеет |
|---|---|
| Дашборд | Статус `zapret` / WinDivert / `winws.exe`, активная стратегия, путь сервиса, кнопки Старт / Стоп / Рестарт / Удалить, детект чужого сервиса + takeover, блок Hosts (проверка/применение/контроль), блок Telegram-прокси (статус, Старт / Стоп / Рестарт, соединения, трафик, `tg://proxy`-ссылка + копирование / открытие в Telegram), bypass-проверки Discord/YouTube/Cloudflare |
| Стратегии | Все 22 стратегии из upstream, установка службой Windows, тестовый запуск в foreground-режиме с живым выводом, поиск, бейджи desync-методов, импорт своих `.bat`, удаление импортированных + тюнинг поверх стратегии: Game Filter, режим IPSet, активные `.bin`-фейки Discord/Game |
| Списки | Редактор пользовательских `*-user.txt` (`list-general-user.txt`, `list-exclude-user.txt`, `ipset-exclude-user.txt` + любые новые `*-user.txt`): счётчик записей, добавление, дедупликация, сортировка, лимит 2 МБ |
| Обновления | Версия zapret-данных, IPSet, стратегии (снапшот ветки), движок `bol-van/zapret` (выбор тега, allowlist бинарей в `bin/`), автообновление приложения (`electron-updater`) |
| Настройки | Автозапуск с Windows + рядом опция «Запускаться свёрнутым в трей», поведение трея: иконка в трее, сворачивание при закрытии, пункты меню стратегий/тюнинга/быстрых настроек; секция Telegram-прокси (автозапуск прокси, CF-fallback, порт, адрес, IP дата-центров, пул, буфер, CF/Worker-домены, FakeTLS, тестовые DC, PROXY-протокол); флаг автопроверки обновлений — на странице Обновлений |
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
* Блок Telegram-прокси (подробности — в разделе «📡 Telegram-прокси» ниже):
  статус `running` / `stopped` / `error`, кнопки Старт / Стоп / Рестарт,
  `host:port`, активные соединения, трафик ↑/↓, `tg://proxy`-ссылка
  с кнопками «Скопировать ссылку» и «Открыть в Telegram» (открытие — через main-процесс и `shell.openExternal`, ссылку собирает main из своих настроек)

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
| Автозапуск с Windows | Настройки | `app.setLoginItemSettings({ openAtLogin })` — окно при таком старте **показывается как обычно**; чтобы стартовать в фоне, включи рядом «Запускаться свёрнутым в трей» |
| Трей | Настройки | `showTrayIcon`, `minimizeToTrayOnClose`, `startMinimizedToTray`, видимость секций `trayServiceMenu` / `trayStrategyMenu` / `trayNavigateMenu` / `trayGameFilterMenu` / `trayIPSetMenu` / `trayToolsMenu` / `trayQuickSettings` |
| Язык / Тема | Сайдбар + установщик | Сохраняются в `settings.json`, применяются мгновенно (трей перестраивается сразу через `onSettingsChanged` + по таймеру ~15с) |

## 📡 Telegram-прокси (встроенный MTProto → WebSocket мост)

Сделан на базе [Flowseal/tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy) —
TypeScript-порт оригинала,
работает внутри приложения (`src/main/tg-proxy.ts`) без внешних зависимостей —
только встроенные `node:net` / `node:tls` / `node:crypto` (raw TLS+WebSocket клиент
написан вручную, как и `RawWebSocket` в оригинале).

Как это работает:

1. Слушает `127.0.0.1:1443`, перехватывает 64-байт MTProto obfuscation init-пакет
2. Извлекает DC ID / media-флаг / протокол через AES-256-CTR + `sha256(prekey + secret)`
3. Поднимает TLS WebSocket к DC (`kws{dc}(−1).web.telegram.org/apiws`), каждый MTProto-пакет — отдельный WS-фрейм (`MsgSplitter` режет TCP-поток по границам пакетов abridged/intermediate)
4. Трафик перешифровывается на лету (4 потока `CryptoCtx`: клиент ↔ прокси ↔ Telegram)
5. Fallback-цепочка: прямое WS → CF-прокси (`kws{dc}.*`, пул доменов с hourly-refresh с GitHub) → прямое TCP `:443` (включая `203 → 91.105.192.100`, у DC203 нет WS-релеев)

Подключение Telegram Desktop: Настройки → Продвинутые → Тип соединения → Прокси → MTProto,
сервер `127.0.0.1`, порт `1443`, secret из приложения — или одной кнопкой «Открыть в Telegram»
(`tg://proxy`-ссылка, в т.ч. из трея виден статус `TG: …` в тултипе и подменю Старт / Стоп / Рестарт).

Управление и состояние:

* Дашборд: блок «Telegram-прокси», Настройки: автозапуск прокси / CF-fallback / порт /
  адрес / IP дата-центров / пул WS / буфер сокета / свои CF-домены / Worker-домены /
  FakeTLS-домен / тестовые DC / PROXY-протокол + кнопка сброса к дефолтам
  (secret и запущенное состояние сохраняются)
* `settings.json → tgProxy`: `{ enabled, port, autoStart, secret, cfProxyEnabled, host, dcIps, poolSize, bufferKb, cfDomains, workerDomains, fakeTlsDomain, forceTestDc, proxyProtocol }`
  (secret из 32 hex генерируется один раз и хранится — иначе Telegram пришлось бы
  перенастраивать после каждого перезапуска)
* Свои CF-домены при задании вытесняют авто-пул с GitHub; Worker-домены пробуются первыми
  (`/apiws?dst=<ip>&dc=<n>`); FakeTLS-домен включает `ee`-секреты с маскировкой под SNI
  (чужие пробы уходят на настоящий `:443` маскирующего домена, plain-HTTP — в 301 редирект)
* Автозапуск прокси при старте приложения (`tgProxy.autoStart`), graceful stop при выходе/сбросе
* Логи идут через общий логгер с источником `tg-proxy`
* IPC-каналы `tg-proxy:start` / `stop` / `restart` / `get-status` / `get-stats` / `update-settings` / `open-link`

Известные нюансы реализации (найдены при отладке живого трафика):

* Клиентский сокет ставится на `pause()` на время dial upstream и `resume()` при старте моста:
  сокет без `data`-слушателя во flowing-режиме Node.js **молча теряет** пайплайнированные байты —
  без этого все сессии висели с `^0.0B v0.0B` до idle-таймаута
* Вне скоупа остаются только `--verbose` / `--log-file`: всё и так идёт в общий `app.log`
  (у shared-логгера нет debug-уровня), а `--buf-kb` применён как `highWaterMark`
  исходящих сокетов (у Node нет API для `SO_RCVBUF`/`SO_SNDBUF`)

## 🔄 Обновления

* `checkZapretUpdates()` — сравнивает локальный `bundled-assets/service/version.txt` (сейчас `1.10.2`, это версия **zapret-данных**, не приложения!) с upstream `.service/version.txt` через `compareVersions()`
* `updateIPSetList()` — качает `.service/ipset-service.txt` → `lists/ipset-all.txt`, удаляет stale `.backup`, возвращает `{ lines, bytes }`
* `checkHosts()` / `applyHosts()` — качает `.service/hosts`, сравнивает первую/последнюю строки с системным `hosts`, при применении заменяет zapret-блок или дописывает + бэкап `hosts.zapret-gui.bak`
* `updateStrategiesFromGithub()`:
  1. Снапшот исходников ветки `UPSTREAM_BRANCH` через `codeload.github.com/.../zip/refs/heads/<branch>` (не release-ассеты) + `branchHeadApi` для SHA
  2. Скачивание с прогрессом `zapret:on-download-progress` (0–80%)
  3. Бэкап `bin/lists/utils/strategies` → `data/_backup/<timestamp>` (хранятся последние 5)
  4. `Expand-Archive` через PowerShell, обход одного top-level каталога
  5. Копирование только изменённых файлов (сравнение по размеру + хешу), `lists/*-user.txt` никогда не затираются
  6. Регенерация `strategies/*.json` из `*.bat` корня архива (`origin: 'bundled'`, `service.bat` исключён, импортированные стратегии с тем же id не затираются)
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
| 15 | Залипший WinDivert | `winws` не запущен, а `WinDivert` активен → fail, только отчёт (удаление — кнопкой «Удалить конфликтующие сервисы») |
| 16 | Сторонний zapret | Чужой `ImagePath` или портативный `winws.exe` без сервиса |
| 17 | Конфликтующие сервисы | `GoodbyeDPI`, `discordfix_zapret`, `winws1`, `winws2` |

Инструменты:

* Очистка кэша Discord — варианты `discord` / `discordptb` / `discordcanary` / `discorddevelopment` (`Cache`, `Code Cache`, `GPUCache`), с завершением процессов `Discord*.exe`
* Удаление конфликтующих сервисов + остатков `WinDivert` / `WinDivert14`
* Встроенные тесты стратегий (`src/main/config-tester.ts`): поочерёдный запуск каждой стратегии через `winws.exe`, проверки HTTP/TLS1.2/TLS1.3 + ping по `utils/targets.txt` (standard) или POST 64KB с `Range` для детекта TCP 16–20 freeze по suite hyperion-cs (dpi), аналитика + выбор лучшей + файл `utils/test results/test_results_*.txt` — всё внутри окна программы, без внешнего PowerShell

## 📝 Логи

* Источники: `app` / `winws` / `updater` / `diag` / `tg-proxy`, уровни `info` / `warn` / `error`
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
* Трей: иконка по статусу `running` / `stopped` / `not-installed` / `unknown` (готовые `bundled-assets/tray/tray-*.png` или генерация 16×16 PNG-кружка), тултип `Zapret GUI — <статус>[ · <стратегия>][ | TG: <статус прокси>]`, меню Старт / Стоп / Рестарт, подменю стратегий (лимит 8 + активная всегда видна), подменю «TG-прокси» (Старт / Стоп / Рестарт + строка статуса с портом), навигация по 6 страницам, GameFilter / IPSet / автозапуск / трей-тогглы, Открыть / Выйти, дабл-клик/клик — показать окно, автообновление каждые 15с + мгновенно по `onSettingsChanged`, скрытие через `showTrayIcon`, чужая служба (`ownership === 'foreign'`) блокирует управление из трея
* Модалка «О программе»: версии приложения/данных, ссылки, лицензия GPL-3.0, донат-блок SBER с кнопкой копирования

## 💾 Раскладка установки (без папки `zapret-discord-youtube-main`!)

* Установщик (NSIS): `%LOCALAPPDATA%\Programs\Zapret GUI\` (+ ярлыки на рабочем столе и в меню «Пуск»), приложение запускается без UAC (`requestedExecutionLevel: asInvoker`, повышение прав только по требованию через «перезапустить как админ», `oneClick: false`, цель только `nsis`, `include: build/installer.nsh` с выбором языка/темы через `install-defaults.json`)
* Рабочие данные (при первом запуске копируются из `resources/bundled-assets` установщика, пользовательские файлы не перезаписываются): `%APPDATA%\zapret-gui\data\{bin,lists,utils,strategies}`
  * `bin/` — `winws.exe`, `WinDivert64.sys`, `WinDivert.dll`, `cygwin1.dll`, `engine-version.txt`, `tls_clienthello_*.bin` / `quic_initial_*.bin` / `stun*.bin` / `ACTIVE_*.bin`
  * `lists/` — `ipset-all.txt` (+ `.backup`), `list-general.txt`, `list-google.txt`, `list-exclude.txt`, `ipset-exclude.txt` + создаваемые `*-user.txt` заглушки (`list-general-user.txt`, `list-exclude-user.txt`, `ipset-exclude-user.txt`, лимит редактора 2 МБ)
  * `utils/` — `targets.txt`, результаты `test results/`, флаги `check_updates.enabled` / `game_filter.enabled`
  * `strategies/` — 22 × `*.json`
  * служебные: `_backup/<timestamp>` (снапшоты перед обновлением, хранятся последние 5), `_tmp/`, `tray-icons/` (сгенерированные PNG)
* Настройки: `%APPDATA%\zapret-gui\settings.json` (`locale`, `theme`, `autoLaunch`, `showTrayIcon`, `trayServiceMenu`, `trayStrategyMenu`, `trayNavigateMenu`, `trayGameFilterMenu`, `trayIPSetMenu`, `trayToolsMenu`, `trayQuickSettings`, `startMinimizedToTray`, `minimizeToTrayOnClose`, `activeStrategyId`, `discordFake`, `gameFake`, `tgProxy: { enabled, port, autoStart, secret, cfProxyEnabled, host, dcIps, poolSize, bufferKb, cfDomains, workerDomains, fakeTlsDomain, forceTestDc, proxyProtocol }`; старый `trayTuningMenu` мигрирует в `trayGameFilterMenu` + `trayIPSetMenu`)
* Лог: `%APPDATA%\zapret-gui\app.log`
* Dev-режим: `bundled-assets` из репозитория, данные в `<repo>/.data`, `userData` изолирован в `zapret-gui-dev` во избежание лока кэша Chromium

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

Тесты (vitest, 17 файлов + `setup.ts`): `strategy-parser`, `service-manager`, `strategies`, `strategy-updater`, `diagnostics-detail`, `exec`, `i18n-25`, `locale-tray`, `config-tester`, `installer-update`, `settings-notify`, `status-dot`, `user-lists`, `tg-proxy`, `app-reset`, `app-updater-autocheck`, `data-seed-flag` (39 тестов: handshake roundtrip по схеме obfuscated2, relay-init, `MsgSplitter`, pause/resume dial-gap регрессия, lifecycle на свободном порту, валидаторы host/DC/domain, PROXY-строка, worker-путь, ee-ссылки, FakeTLS verify/hello/record layer).

CI (`.github/workflows/`): `build.yml` + `release.yml`.

## 📁 Структура проекта

```
src/
  main/         index.ts (окно 1625x935 min 1080x680, tray, auto-updater, first-run wizard, автозапуск TG-прокси)
                tray.ts (цветные иконки, меню Start/Stop/Restart/Strategies/Goto/Tuning/QuickSettings + подменю TG-прокси)
                ipc-handlers.ts (все IPC + foreground-тест + экспорт логов + tg-proxy:start/stop/restart/status/stats/settings/open-link)
                tg-proxy.ts (встроенный MTProto→WebSocket мост: handshake/DC, RawWebSocket, пул, MsgSplitter, CryptoCtx, CF/TCP fallback)
                service-manager.ts (sc/net/reg/tasklist, install/remove/start/stop, GameFilter, IPSet, Discord-кэш, конфликты)
                strategy-parser.ts (парсинг .bat в args, плейсхолдеры <BIN>/<LISTS>/<GAME_TCP>/<GAME_UDP>/<ROOT>)
                strategy-updater.ts (version/IPSet/hosts/source-snapshot/engine bol-van, .bin-фейки)
                diagnostics.ts (17 проверок, параллельно, таймаут 20с на проверку)
                config-tester.ts (нативный тестер standard/dpi, targets.txt, test results/)
                bypass-check.ts (HTTPS-пробы YouTube/Discord/Cloudflare из main-процесса)
                user-lists.ts (*-user.txt: list/read/write, лимит 2 МБ)
                app-updater.ts (electron-updater: check/download/install, диалог + баннер)
                settings.ts (settings.json + systemDefaults + install-defaults.json + autoLaunch)
                paths.ts (bundled-assets vs %APPDATA%/zapret-gui/data)
                exec.ts (cmd/powershell, isAdmin, RunAs, spawnLong, killPidTree)
                window.ts (первое окно + best-effort IPC-отправка в renderer)
                logger.ts (файл app.log до 2 МБ + ротация .1, буфер 2000 + zapret:on-log)
  preload/      index.ts — типизированный мост window.zapret
  renderer/     App.tsx + main.tsx + store.ts — zustand (page/locale/theme/status/strategies/logs/busy/error, logs→diagnostics, tgProxyStatus/tgProxyStats/tgProxySettings + экшены прокси)
                components/ Layout.tsx (сайдбар, пикер языка с флагами SVG, темы, AboutModal с донатом) + ui.tsx
                pages/ Dashboard (статус + Hosts + Telegram-прокси + bypass) Strategies Lists Updates Settings (автозапуск + трей + TG-прокси + сброс) Diagnostics (+ Logs как секция диагностики)
                assets/ app-icon.png
  shared/       types.ts (ServiceState, Strategy, StatusSnapshot, DiagnosticCheck, UpdateInfo, EngineVersionInfo, AppSettings, TgProxySettings/TgProxyStats, IPC ~65 каналов)
                constants.ts (SERVICE_NAME=zapret, UPSTREAM_OWNER=Flowseal, ENGINE_OWNER=bol-van, URLS, CONFLICTING_SERVICES, FAKE_*.bin, TG_PROXY_DEFAULT_PORT/DC_IPS/WS_PATH)
                i18n.ts + locales/ (28 словарей)
bundled-assets/ bin/ (engine-version.txt) lists/ utils/ strategies/ (22 JSON) bat/ (22 general*.bat + service.bat) service/ (version.txt + engine-version.txt + hosts) tray/ (4 PNG) icon.ico
scripts/        generate-strategies.mjs + clean.mjs + make-icon.mjs
tests/          17 x *.test.ts + setup.ts
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
* **Telegram не грузится через встроенный прокси** — смотрите источник `tg-proxy` в логах:
  сессии с `^0.0B v0.0B` означают, что трафик не идёт (старая версия без pause/resume фикса);
  `DC203` без TCP-фолбэка (`HTTP 503` от CF) — обновитесь, теперь `203 → 91.105.192.100`;
  постоянные `WS failed, cooldown 60s` — DPI режет `kws*.web.telegram.org`, должен спасать CF/TCP fallback.
* **Кнопка «Открыть в Telegram» ничего не делает** — Telegram Desktop не зарегистрировал `tg://`-схему в ОС (обычно лечится переустановкой Telegram); скопируйте ссылку вручную и откройте её в «Избранном».

# 📜 Лицензия

Проект распространяется под лицензией GPL-3.0. Полный текст лицензии содержится в файле [`LICENSE`](LICENSE).

---
# 💰 Поддержать автора
+ **SBER**: `2202 2050 1464 4675`
