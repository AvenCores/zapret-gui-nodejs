/**
 * Global UI store (zustand): locale/theme, status snapshot, strategies,
 * logs and shared loading flags.
 * @module renderer/store
 */
import { create } from 'zustand'
import type { AppSettings, AppTheme, LogLine, StatusSnapshot, Strategy } from '../shared/types'
import { translate, type I18nKey, type Locale } from '../shared/i18n'

export type Page = 'dashboard' | 'strategies' | 'settings' | 'lists' | 'updates' | 'diagnostics' | 'logs'

/** Resolve a theme setting to a concrete dark flag (auto = OS color scheme). */
export function isDarkTheme(theme: AppTheme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

let systemThemeQuery: MediaQueryList | null = null

/**
 * Apply a theme setting to `<html class="dark">`. In `auto` mode a listener
 * keeps the UI in sync when the OS color scheme changes at runtime.
 */
export function syncThemeClass(theme: AppTheme): void {
  document.documentElement.classList.toggle('dark', isDarkTheme(theme))
  if (systemThemeQuery) {
    systemThemeQuery.onchange = null
    systemThemeQuery = null
  }
  if (theme === 'auto') {
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeQuery.onchange = (e) => document.documentElement.classList.toggle('dark', e.matches)
  }
}

interface UiState {
  page: Page
  setPage: (p: Page) => void
  locale: Locale
  theme: AppTheme
  t: (key: I18nKey) => string
  settings: AppSettings | null
  status: StatusSnapshot | null
  strategies: Strategy[]
  logs: LogLine[]
  busy: Record<string, boolean>
  setBusy: (key: string, v: boolean) => void
  error: string | null
  setError: (e: string | null) => void
  init: () => Promise<void>
  refreshStatus: () => Promise<void>
  refreshStrategies: () => Promise<void>
  pushLog: (l: LogLine) => void
  clearLogs: () => void
  applySettings: (patch: Partial<AppSettings>) => Promise<void>
}

async function call<T>(key: string, fn: () => Promise<T>, set: (p: Partial<UiState>) => void, get: () => UiState): Promise<T | null> {
  get().setBusy(key, true)
  try {
    return await fn()
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    get().setBusy(key, false)
  }
}

export const useUi = create<UiState>((set, get) => ({
  page: 'dashboard',
  setPage: (page) => set({ page }),
  locale: 'ru',
  theme: 'dark',
  t: (key) => translate(get().locale, key),
  settings: null,
  status: null,
  strategies: [],
  logs: [],
  busy: {},
  setBusy: (key, v) => set((s) => ({ busy: { ...s.busy, [key]: v } })),
  error: null,
  setError: (error) => set({ error }),

  init: async () => {
    const settings = await call('init', () => window.zapret.getSettings(), set, get)
    if (settings) {
      set({ settings, locale: settings.locale, theme: settings.theme })
      syncThemeClass(settings.theme)
    }
    window.zapret.onLog((line) => get().pushLog(line))
    await get().refreshStatus()
    await get().refreshStrategies()
  },

  refreshStatus: async () => {
    const status = await call('status', () => window.zapret.getStatus(), set, get)
    if (status) set({ status })
  },

  refreshStrategies: async () => {
    const strategies = await call('strategies', () => window.zapret.listStrategies(), set, get)
    if (strategies) set({ strategies })
  },

  pushLog: (line) =>
    set((s) => {
      const logs = [...s.logs, line]
      return { logs: logs.slice(-1000) }
    }),

  clearLogs: () => set({ logs: [] }),

  applySettings: async (patch) => {
    const prevTheme = get().theme
    const settings = await call('settings', () => window.zapret.saveSettings(patch), set, get)
    if (settings) {
      set({ settings, locale: settings.locale, theme: settings.theme })
      syncThemeClass(settings.theme)
      if (settings.theme !== prevTheme) {
        // Briefly enable surface recolor transitions (see .theme-anim in index.css).
        document.documentElement.classList.add('theme-anim')
        setTimeout(() => document.documentElement.classList.remove('theme-anim'), 350)
      }
    }
  }
}))
