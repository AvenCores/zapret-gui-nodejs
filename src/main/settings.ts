/**
 * Persistent app settings (`%APPDATA%/zapret-gui/settings.json`).
 * @module main/settings
 */
import fs from 'node:fs'
import { app, nativeTheme } from 'electron'
import { getSettingsPath } from './paths'
import type { AppSettings } from '../shared/types'
import { normalizeLocale, resolveSystemLocale as resolveSystemLocaleImpl, type Locale } from '../shared/i18n'

const BASE_DEFAULTS = {
  autoLaunch: false,
  startMinimizedToTray: false,
  minimizeToTrayOnClose: true,
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

/**
 * First-run defaults taken from the OS: UI language from the system locale,
 * theme from the OS dark-mode setting. Used only while no settings file
 * exists (i.e. until the user explicitly picks a language/theme).
 */
export function systemDefaults(): Pick<AppSettings, 'locale' | 'theme'> {
  let locale: Locale = 'ru'
  try {
    locale = resolveSystemLocale(app.getLocale())
  } catch {
    /* keep fallback */
  }
  let theme: AppSettings['theme'] = 'dark'
  try {
    theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  } catch {
    /* keep fallback */
  }
  return { locale, theme }
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged: AppSettings = { ...BASE_DEFAULTS, ...systemDefaults(), ...parsed }
    // Backward compat: old files store 'ru' | 'en'; new files store any
    // supported code. Unknown/corrupted values fall back to English.
    merged.locale = normalizeLocale((parsed as Record<string, unknown>).locale ?? merged.locale)
    return merged
  } catch {
    return { ...BASE_DEFAULTS, ...systemDefaults() }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.locale !== undefined) patch = { ...patch, locale: normalizeLocale(patch.locale) }
  const next = { ...loadSettings(), ...patch }
  fs.mkdirSync(require('node:path').dirname(getSettingsPath()), { recursive: true })
  fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8')
  applyAutoLaunch(next.autoLaunch)
  return next
}

/** Windows auto-launch via Electron login-item settings (registry). */
export function applyAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, name: 'zapret-gui' })
  } catch {
    /* non-fatal (e.g. portable mode) */
  }
}
