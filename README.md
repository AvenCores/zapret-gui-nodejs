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

# zapret-gui

Десктопный GUI для [zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube)
(обход DPI-блокировок Discord / YouTube / Telegram через `winws.exe` + WinDivert).

Автор: **avencores** — https://github.com/AvenCores/zapret-gui-nodejs

Стек: **Electron + React + TypeScript + TailwindCSS + zustand**,
установщик через **electron-builder (NSIS)**, автообновление приложения через **electron-updater**.

> Только Windows 10/11 x64. Требуются права администратора
> (драйвер WinDivert + служба `zapret` + файл hosts).

## Возможности (паритет с `service.bat`)

- **Дашборд** — статус `zapret` / WinDivert / `winws.exe`, активная стратегия, кнопки Старт/Стоп/Рестарт
- **Стратегии** — все 22 стратегии из upstream, установка службой Windows, тестовый запуск в foreground-режиме, импорт своих `.bat`
- **Настройки** — Game Filter, режим IPSet, флаг автопроверки обновлений, автозапуск, трей, активные `.bin`-фейки
- **Обновления** — проверка версии zapret, обновление IPSet-списка, diff и применение hosts, обновление стратегий из release-ZIP с GitHub (с бэкапом), автообновление самого приложения
- **Диагностика** — BFE, прокси, TCP timestamps, AdGuard/Killer/Intel/Check Point/SmartByte/VPN, кириллица в пути, OneDrive, Secure DNS, WinDivert64.sys, записи YouTube в hosts, зависший WinDivert, конфликтующие сервисы; очистка кэша Discord; запуск PowerShell-тестов
- **Логи** — живой поток app/winws/updater + экспорт в файл
- Локализация RU/EN, тёмная/светлая тема, иконка трея с цветом статуса

## Раскладка установки (без папки `zapret-discord-youtube-main`!)

- Установщик (NSIS): `%LOCALAPPDATA%\Programs\zapret-gui\` (+ ярлыки на рабочем столе и в меню «Пуск»), запрашивает повышение прав
- Рабочие данные (при первом запуске копируются из `resources/bundled-assets` установщика): `%APPDATA%\zapret-gui\data\{bin,lists,utils,strategies}`
- Настройки: `%APPDATA%\zapret-gui\settings.json`

## Разработка

```powershell
npm install
npm run dev        # electron-vite dev (для функций служб нужна Windows)
npm test           # vitest
npm run lint       # typecheck
npm run build:win  # установщик + portable zip в dist/
npm run clean      # удалить out/ и dist/
npm run rebuild    # clean + полная пересборка из исходников
```

`npm run generate:strategies` перепарсивает `bundled-assets/bat/*.bat`
в `bundled-assets/strategies/*.json` (автоматически перед каждой сборкой).

## Структура проекта

```
src/
  main/         index.ts tray.ts ipc-handlers.ts service-manager.ts
                strategy-parser.ts strategy-updater.ts diagnostics.ts
                settings.ts paths.ts exec.ts logger.ts
  preload/      index.ts            # типизированный мост window.zapret
  renderer/     App.tsx store.ts    # zustand + ru/en
                pages/ Dashboard Strategies Settings Updates Diagnostics Logs
  shared/       types.ts constants.ts i18n.ts
bundled-assets/ bin/ lists/ utils/ strategies/ bat/ service/
scripts/        generate-strategies.mjs
tests/          strategy-parser.test.ts service-manager.test.ts
.github/workflows/ build.yml release.yml
```

## Как работает служба

Применение стратегии повторяет `service.bat :service_install`:

1. `netsh … timestamps=enabled`
2. `net stop zapret` / `sc delete zapret`
3. `sc create zapret binPath= "<data>\bin\winws.exe <подставленные аргументы>" start= auto`
4. `sc start zapret` + имя стратегии в `HKLM\…\Services\zapret\zapret-discord-youtube`

Bat-переменные `%GameFilterTCP/UDP%` и `%BIN%/%LISTS%` при парсинге
превращаются в плейсхолдеры (`<GAME_TCP>`, `<BIN>` …) и подставляются
под конкретную машину в момент применения.

# 📜 Лицензия

Проект распространяется под лицензией GPL-3.0. Полный текст лицензии содержится в файле [`LICENSE`](LICENSE).

---
# 💰 Поддержать автора
+ **SBER**: `2202 2050 1464 4675`