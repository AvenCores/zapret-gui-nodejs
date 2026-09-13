/**
 * Persistent app settings (`%APPDATA%/zapret-gui/settings.json`).
 * @module main/settings
 */
import fs from 'node:fs'
import { app } from 'electron'
import { getSettingsPath } from './paths'
import type { AppSettings } from '../shared/types'

const DEFAULTS: AppSettings = {
  locale: 'ru',
  theme: 'dark',
  autoLaunch: false,
  startMinimizedToTray: false,
  minimizeToTrayOnClose: true,
  activeStrategyId: null,
  discordFake: null,
  gameFake: null
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8')
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
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
