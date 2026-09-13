/**
 * Global UI store (zustand): locale/theme, status snapshot, strategies,
 * logs and shared loading flags.
 * @module renderer/store
 */
import { create } from 'zustand'
import type { AppSettings, LogLine, StatusSnapshot, Strategy } from '../shared/types'
import { translate, type I18nKey, type Locale } from '../shared/i18n'

export type Page = 'dashboard' | 'strategies' | 'settings' | 'updates' | 'diagnostics' | 'logs'

interface UiState {
  page: Page
  setPage: (p: Page) => void
  locale: Locale
  theme: 'dark' | 'light'
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
      document.documentElement.classList.toggle('dark', settings.theme === 'dark')
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

  applySettings: async (patch) => {
    const settings = await call('settings', () => window.zapret.saveSettings(patch), set, get)
    if (settings) {
      set({ settings, locale: settings.locale, theme: settings.theme })
      document.documentElement.classList.toggle('dark', settings.theme === 'dark')
    }
  }
}))
