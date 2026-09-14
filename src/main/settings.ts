/**
 * Persistent app settings (`%APPDATA%/zapret-gui/settings.json`).
 * @module main/settings
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getSettingsPath } from './paths'
import type { AppSettings, AppTheme } from '../shared/types'
import { isSupportedLocale, normalizeLocale, resolveSystemLocale as resolveSystemLocaleImpl, type Locale } from '../shared/i18n'

const BASE_DEFAULTS = {
  autoLaunch: false,
  startMinimizedToTray: false,
  minimizeToTrayOnClose: true,
  showTrayIcon: true,
  activeStrategyId: null,
  discordFake: null,
  gameFake: null
} as const

/**
 * Map an OS locale tag (e.g. `ru-RU`, `en-US`) to a supported app locale.
 * Pure — covered by unit tests. Re-exported from shared/i18n for
 * backward compatibility with existing imports.
 */
export function resolveSystemLocale(tag: string): Locale {
  return resolveSystemLocaleImpl(tag)
}

export { normalizeLocale }

/** Coerce an unknown value to a valid theme (fallback `dark`). Pure. */
export function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' || value === 'light' || value === 'auto' ? value : 'dark'
}

/**
 * Name of the file the NSIS installer optionally drops next to the installed
 * `.exe` (see `build/installer.nsh`, options page "Language / Theme").
 * Consumed once on first run (see `loadSettings`), then deleted.
 */
export const INSTALLER_DEFAULTS_FILE = 'install-defaults.json'

/**
 * Read the language/theme choice made on the installer options page.
 * Only explicit choices are returned: an empty locale means "system
 * language", an empty theme means "no choice" (silent install — the custom
 * page never shows there). The file is deleted after a successful read so a
 * stale choice can never resurface later.
 */
export function readInstallerDefaults(): Partial<Pick<AppSettings, 'locale' | 'theme'>> {
  try {
    const file = path.join(path.dirname(app.getPath('exe')), INSTALLER_DEFAULTS_FILE)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const out: Partial<Pick<AppSettings, 'locale' | 'theme'>> = {}
    if (typeof raw.locale === 'string' && isSupportedLocale(raw.locale)) out.locale = raw.locale
    if (raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'auto') out.theme = raw.theme
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* non-fatal: stale file is simply ignored once settings exist */
    }
    return out
  } catch {
    return {}
  }
}

/**
 * First-run defaults: UI language from the system locale, theme follows the
 * OS (`auto`). Used only while no settings file exists (i.e. until the user
 * explicitly picks a language/theme in the app or in the installer).
 */
export function systemDefaults(): Pick<AppSettings, 'locale' | 'theme'> {
  let locale: Locale = 'ru'
  try {
    locale = resolveSystemLocale(app.getLocale())
  } catch {
    /* keep fallback */
  }
  return { locale, theme: 'auto' }
}

function persistSettings(next: AppSettings): void {
  try {
    fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true })
    fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* non-fatal: settings stay in memory for this session */
  }
}

export function loadSettings(): AppSettings {
  // One-shot installer choice (deleted on read). An explicit pick on the
  // installer options page wins over stored settings; a silent install
  // leaves no choice and changes nothing.
  const installer = readInstallerDefaults()
  const hasInstallerChoice = installer.locale !== undefined || installer.theme !== undefined
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged: AppSettings = { ...BASE_DEFAULTS, ...systemDefaults(), ...parsed }
    // Backward compat: old files store 'ru' | 'en'; new files store any
    // supported code. Unknown/corrupted values fall back to English.
    merged.locale = normalizeLocale((parsed as Record<string, unknown>).locale ?? merged.locale)
    merged.theme = normalizeTheme((parsed as Record<string, unknown>).theme ?? merged.theme)
    if (hasInstallerChoice) {
      if (installer.locale !== undefined) merged.locale = installer.locale
      if (installer.theme !== undefined) merged.theme = installer.theme
      persistSettings(merged)
    }
    return merged
  } catch {
    // No settings yet: installer choice wins over OS detection, then persist
    // so the choice survives (the installer file is one-shot).
    const first: AppSettings = { ...BASE_DEFAULTS, ...systemDefaults(), ...installer }
    first.locale = normalizeLocale(first.locale)
    first.theme = normalizeTheme(first.theme)
    persistSettings(first)
    return first
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.locale !== undefined) patch = { ...patch, locale: normalizeLocale(patch.locale) }
  if (patch.theme !== undefined) patch = { ...patch, theme: normalizeTheme(patch.theme) }
  const next = { ...loadSettings(), ...patch }
  persistSettings(next)
  applyAutoLaunch(next.autoLaunch)
  return next
}

/** Windows auto-launch via Electron login-item settings (registry). */
export function applyAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, name: 'Zapret GUI' })
  } catch {
    /* non-fatal (e.g. portable mode) */
  }
}
