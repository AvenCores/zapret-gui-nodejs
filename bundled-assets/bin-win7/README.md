# WinDivert для Windows 7

Здесь лежат WinDivert 2.2.0-C (`WinDivert.dll`, `WinDivert64.sys`) с двойной
подписью SHA1+SHA256 — аналог папки `win7/` из
[bol-van/zapret-win-bundle](https://github.com/bol-van/zapret-win-bundle/tree/master/win7).

Обычный `../bin/` содержит вариант драйвера только с SHA2-подписью, который
Windows 7 без ESU-обновлений (патч KB3033929) отклоняет с ошибкой 577
(`ERROR_INVALID_IMAGE_HASH`).

Приложение само подменяет эти два файла в рабочем каталоге данных
(`%APPDATA%/zapret-gui/data/bin`) на версии отсюда, если запущено на
Windows 7 (см. `applyWin7Drivers()` в `src/main/paths.ts`). Вручную ничего
копировать не нужно. Основной `bin/` при этом не трогается и продолжает
использоваться на Windows 10/11.
