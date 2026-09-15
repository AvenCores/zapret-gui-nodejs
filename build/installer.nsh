/**
 * Zapret GUI — NSIS customizations (wired via `nsis.include` in electron-builder.yml).
 *
 * 1. Options page after the install-directory page: program language + theme.
 *    The choice is kept in NSIS vars and written to
 *    `$INSTDIR\install-defaults.json` by `customInstall`. The app applies an
 *    explicit choice over stored settings on next launch, then deletes the
 *    file (see `src/main/settings.ts`).
 * 2. Sentinel defaults (`customInit`): empty locale/theme mean "no choice".
 *    They survive only in silent installs (custom pages never show there),
 *    so a silent update never touches the user's language/theme. When the
 *    page IS shown, `ZguiOptionsCreate` replaces the sentinels with the
 *    visible defaults (system language + auto theme).
 * 3. Service handling for updates (`customCheckAppRunning` + `customInstall`):
 *    the running GUI itself is terminated first via `taskkill /F` (its
 *    window only minimizes to tray, so the stock "close the app" prompt
 *    could never release the exe lock), then the `zapret` service runs winws.exe from %APPDATA%\zapret-gui\data
 *    (never from $INSTDIR), so strictly it cannot lock installer files —
 *    but it is still stopped right before the old version is removed and
 *    the new files are copied, then started again, so an update from the
 *    setup exe can neither fail nor leave the bypass down. Only a service
 *    that was RUNNING and that WE managed to stop is started back: a
 *    service the user stopped on purpose stays stopped. The `WinDivert`
 *    driver service is deliberately left loaded (fast reconnect, no reboot
 *    prompts). Every step is best-effort: if `net stop` fails (e.g. no
 *    rights in the outer UAC instance), the install simply proceeds as
 *    before — services never block an update.
 *
 * UTF-8 encoded — compiled by electron-builder with the Unicode NSIS build.
 */

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro customInit
  StrCpy $ZguiLang ""
  StrCpy $ZguiTheme ""
  StrCpy $ZguiZapretWasRunning "0"
!macroend

; The options page exists only in the installer. Without this guard the
; uninstaller build (BUILD_UNINSTALLER) compiles the vars/functions but never
; references them, failing the build on makensis warnings 6001/6010
; (electron-builder treats warnings as errors).
!ifndef BUILD_UNINSTALLER
Var ZguiLang
Var ZguiTheme
Var ZguiLangCombo
Var ZguiThemeCombo
; "1" when this install stopped a RUNNING zapret service (customInstall
; starts it back). Never "1" for a service the user had stopped themselves.
Var ZguiZapretWasRunning
; Needed by the default _CHECK_APP_RUNNING used in customCheckAppRunning
; below (the template skips its own include once the override is defined).
!include "getProcessInfo.nsh"
Var pid

; Runs in the install section after the user confirmed, right before the old
; version is removed and new files are copied (see installSection.nsh).
; Keeps electron-builder's default "close the running app" behavior, then
; quiesces the zapret service so nothing can interfere with the update.
; NOTE: this replaces only the *body* of CHECK_APP_RUNNING — its wrapper in
; the template already declares/sets $CmdPath/$PowerShellPath, but the
; IS_POWERSHELL_AVAILABLE probe must be replicated here, otherwise makensis
; fails with "unknown variable IsPowerShellAvailable" (warning 6000 is
; treated as an error by electron-builder).
!macro customCheckAppRunning
  ; Zapret GUI minimizes to tray on window close instead of quitting, so the
  ; stock "please close the app" dialog can never release the exe lock —
  ; terminate the GUI outright (hidden, best-effort: a non-zero exit just
  ; means "not running"). Runs first so the default check below passes
  ; silently on update.
  nsExec::ExecToStack `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Pop $1

  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING

  StrCpy $ZguiZapretWasRunning "0"
  ; Exit code 0 = "RUNNING" found in `sc query zapret` output (also covers
  ; missing service (1060) and STOPPED state: findstr matches nothing).
  nsExec::ExecToStack `"$SYSDIR\cmd.exe" /C sc query zapret | "$SYSDIR\findstr.exe" "RUNNING"`
  Pop $0
  Pop $1
  ${If} $0 == 0
    DetailPrint "Stopping zapret service for update..."
    ; Synchronous: returns only after the service actually stopped.
    nsExec::ExecToStack `"$SYSDIR\net.exe" stop zapret`
    Pop $0
    Pop $1
    ${If} $0 == 0
      StrCpy $ZguiZapretWasRunning "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom ZguiOptionsCreate ZguiOptionsLeave
!macroend

Function ZguiOptionsCreate
  ; The page is actually shown: replace the "no choice" sentinels from
  ; customInit with the visible defaults (system language + auto theme).
  StrCpy $ZguiLang ""
  StrCpy $ZguiTheme "auto"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "Program language / Язык программы:"
  Pop $0

  ${NSD_CreateDropList} 0 14u 100% 90u ""
  Pop $ZguiLangCombo
  ${NSD_CB_AddString} $ZguiLangCombo "Auto — system language / Авто — язык системы"
  ${NSD_CB_AddString} $ZguiLangCombo "ru — Русский"
  ${NSD_CB_AddString} $ZguiLangCombo "en — English"
  ${NSD_CB_AddString} $ZguiLangCombo "uk — Українська"
  ${NSD_CB_AddString} $ZguiLangCombo "be — Беларуская"
  ${NSD_CB_AddString} $ZguiLangCombo "kk — Қазақша"
  ${NSD_CB_AddString} $ZguiLangCombo "de — Deutsch"
  ${NSD_CB_AddString} $ZguiLangCombo "fr — Français"
  ${NSD_CB_AddString} $ZguiLangCombo "es — Español"
  ${NSD_CB_AddString} $ZguiLangCombo "it — Italiano"
  ${NSD_CB_AddString} $ZguiLangCombo "pt — Português"
  ${NSD_CB_AddString} $ZguiLangCombo "nl — Nederlands"
  ${NSD_CB_AddString} $ZguiLangCombo "pl — Polski"
  ${NSD_CB_AddString} $ZguiLangCombo "cs — Čeština"
  ${NSD_CB_AddString} $ZguiLangCombo "sk — Slovenčina"
  ${NSD_CB_AddString} $ZguiLangCombo "hu — Magyar"
  ${NSD_CB_AddString} $ZguiLangCombo "ro — Română"
  ${NSD_CB_AddString} $ZguiLangCombo "bg — Български"
  ${NSD_CB_AddString} $ZguiLangCombo "sr — Srpski"
  ${NSD_CB_AddString} $ZguiLangCombo "hr — Hrvatski"
  ${NSD_CB_AddString} $ZguiLangCombo "el — Ελληνικά"
  ${NSD_CB_AddString} $ZguiLangCombo "tr — Türkçe"
  ${NSD_CB_AddString} $ZguiLangCombo "ar — العربية"
  ${NSD_CB_AddString} $ZguiLangCombo "fa — فارسی"
  ${NSD_CB_AddString} $ZguiLangCombo "zh — 中文"
  ${NSD_CB_AddString} $ZguiLangCombo "ja — 日本語"
  ${NSD_CB_AddString} $ZguiLangCombo "ko — 한국어"
  ${NSD_CB_AddString} $ZguiLangCombo "hi — हिन्दी"
  ${NSD_CB_AddString} $ZguiLangCombo "id — Indonesia"
  SendMessage $ZguiLangCombo ${CB_SETCURSEL} 0 0

  ${NSD_CreateLabel} 0 40u 100% 12u "Theme / Тема оформления:"
  Pop $0

  ${NSD_CreateDropList} 0 54u 100% 48u ""
  Pop $ZguiThemeCombo
  ${NSD_CB_AddString} $ZguiThemeCombo "auto — Auto / Авто"
  ${NSD_CB_AddString} $ZguiThemeCombo "dark — Dark / Тёмная"
  ${NSD_CB_AddString} $ZguiThemeCombo "light — Light / Светлая"
  SendMessage $ZguiThemeCombo ${CB_SETCURSEL} 0 0

  nsDialogs::Show
FunctionEnd

Function ZguiOptionsLeave
  ; Language items are prefixed with the 2-letter code ("ru — Русский", …);
  ; index 0 is the "system language" entry and leaves the locale empty.
  SendMessage $ZguiLangCombo ${CB_GETCURSEL} 0 0 $0
  ${If} $0 <= 0
    StrCpy $ZguiLang ""
  ${Else}
    ${NSD_GetText} $ZguiLangCombo $1
    StrCpy $ZguiLang $1 2
  ${EndIf}

  SendMessage $ZguiThemeCombo ${CB_GETCURSEL} 0 0 $0
  ${If} $0 == 1
    StrCpy $ZguiTheme "dark"
  ${ElseIf} $0 == 2
    StrCpy $ZguiTheme "light"
  ${Else}
    StrCpy $ZguiTheme "auto"
  ${EndIf}
FunctionEnd
!endif

!macro customInstall
  ; Single quotes: inner double quotes stay literal, $vars still expand.
  FileOpen $0 "$INSTDIR\install-defaults.json" w
  FileWrite $0 '{"locale":"$ZguiLang","theme":"$ZguiTheme"}$\r$\n'
  FileClose $0

  ; Success path only: bring back a zapret service this install stopped.
  ; Best-effort (a `start= auto` service also recovers on reboot); a service
  ; the user had stopped before the update is never touched.
  ${If} $ZguiZapretWasRunning == "1"
    DetailPrint "Restarting zapret service..."
    nsExec::ExecToStack `"$SYSDIR\net.exe" start zapret`
    Pop $0
    Pop $1
    StrCpy $ZguiZapretWasRunning "0"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$INSTDIR\install-defaults.json"
!macroend
