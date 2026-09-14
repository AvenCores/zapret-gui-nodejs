/**
 * Zapret GUI — NSIS customizations (wired via `nsis.include` in electron-builder.yml).
 *
 * 1. Options page after the install-directory page: program language + theme.
 *    The choice is kept in NSIS vars and written to
 *    `$INSTDIR\install-defaults.json` by `customInstall`. The app consumes
 *    that file once on first run (see `src/main/settings.ts`), then deletes it.
 * 2. Silent/unattended defaults (`customInit`): follow the OS — empty locale
 *    means "system language auto-detect", theme `auto`.
 * 3. The page is skipped on re-install/update when
 *    `%APPDATA%\zapret-gui\settings.json` already exists, so an update never
 *    resets the user's language/theme.
 *
 * UTF-8 encoded — compiled by electron-builder with the Unicode NSIS build.
 */

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro customInit
  StrCpy $ZguiLang ""
  StrCpy $ZguiTheme "auto"
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

!macro customPageAfterChangeDir
  Page custom ZguiOptionsCreate ZguiOptionsLeave
!macroend

Function ZguiOptionsCreate
  ; Existing user settings win: skip the page on update / re-install.
  IfFileExists "$APPDATA\zapret-gui\settings.json" 0 +2
    Abort

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
!macroend

!macro customUnInstall
  Delete "$INSTDIR\install-defaults.json"
!macroend
