/**
 * Global UI store (zustand): locale/theme, status snapshot, strategies,
 * logs and shared loading flags.
 * @module renderer/store
 */
import { create } from 'zustand'
import type {
  AppSettings,
  AppTheme,
  BypassCheckResult,
  BypassTargetId,
  ConfigTesterAnalyticsRow,
  ConfigTesterEvent,
  ConfigTestMode,
  HostsCheckResult,
  LogLine,
  StatusSnapshot,
  Strategy
} from '../shared/types'
import { translate, type I18nKey, type Locale } from '../shared/i18n'

export type Page = 'dashboard' | 'strategies' | 'settings' | 'lists' | 'updates' | 'diagnostics' | 'logs'

/**
 * Identity of the strategy the cached bypass results belong to.
 * Registry strategy name + settings selection: reinstalling / switching
 * the strategy changes at least one of them, while plain tab switches
 * and service start/stop keep it stable.
 * Pure — kept outside the store for reuse in Dashboard.
 */
export function bypassStrategyKeyOf(activeStrategy: string | null, activeStrategyId: string | null): string {
  return `${activeStrategy ?? ''}::${activeStrategyId ?? ''}`
}

/** Resolve a theme setting to a concrete dark flag (auto = OS color scheme). */
export function isDarkTheme(theme: AppTheme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

let systemThemeQuery: MediaQueryList | null = null
let logSubscribed = false
let configTesterSubscribed = false

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
  /** Re-read settings from disk (tray checkboxes change them behind our back). */
  refreshSettings: () => Promise<void>
  /** Cached bypass results — survive Dashboard unmount on tab switches. */
  bypass: Record<BypassTargetId, BypassCheckResult | null>
  bypassChecking: Record<BypassTargetId, boolean>
  bypassCheckingAll: boolean
  /** Strategy key the cached `bypass` results were measured for. */
  bypassStrategyKey: string | null
  /** Cached hosts check — survives Dashboard unmount on tab switches. */
  hostsCheck: HostsCheckResult | null
  hostsCheckedAt: string | null
  setHostsCheck: (r: HostsCheckResult | null, checkedAt: string | null) => void
  /**
   * Native config-tester state — lives here (not in the Diagnostics page)
   * so the results table survives tab switches: App unmounts inactive
   * pages, which used to wipe `rows`/`best` right after a test run.
   * The `onConfigTesterEvent` subscription below is also global, so a
   * run started on Diagnostics keeps streaming while the user is elsewhere.
   */
  configMode: ConfigTestMode
  configRunning: boolean
  configProgress: { completed: number; total: number; current: string } | null
  configLogs: string[]
  configRows: ConfigTesterAnalyticsRow[]
  configBest: string | null
  configFilePath: string | null
  configCancelled: boolean
  setConfigMode: (m: ConfigTestMode) => void
  startConfigTests: (strategyIds: string[], mode: ConfigTestMode) => Promise<void>
  stopConfigTests: () => Promise<void>
  checkBypassOne: (id: BypassTargetId) => Promise<void>
  checkBypassAll: (strategyKey: string) => Promise<void>
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
  bypass: { youtube: null, cloudflare: null, discord: null },
  bypassChecking: { youtube: false, cloudflare: false, discord: false },
  bypassCheckingAll: false,
  bypassStrategyKey: null,
  hostsCheck: null,
  hostsCheckedAt: null,
  setHostsCheck: (hostsCheck, hostsCheckedAt) => set({ hostsCheck, hostsCheckedAt }),
  configMode: 'standard',
  configRunning: false,
  configProgress: null,
  configLogs: [],
  configRows: [],
  configBest: null,
  configFilePath: null,
  configCancelled: false,
  setConfigMode: (configMode) => set({ configMode }),

  startConfigTests: async (strategyIds, mode) => {
    if (get().configRunning) return
    set({
      configMode: mode,
      configRunning: true,
      configProgress: { completed: 0, total: strategyIds.length, current: '' },
      configLogs: [],
      configRows: [],
      configBest: null,
      configFilePath: null,
      configCancelled: false
    })
    try {
      await window.zapret.startConfigTester(strategyIds, mode)
    } catch (e) {
      set({ configRunning: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  stopConfigTests: async () => {
    try {
      await window.zapret.stopConfigTester()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  checkBypassOne: async (id) => {
    if (get().bypassChecking[id] || get().bypassCheckingAll) return
    set((s) => ({ bypassChecking: { ...s.bypassChecking, [id]: true } }))
    try {
      const r = await window.zapret.checkBypass(id)
      set((s) => ({ bypass: { ...s.bypass, [id]: r } }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set((s) => ({ bypassChecking: { ...s.bypassChecking, [id]: false } }))
    }
  },

  checkBypassAll: async (strategyKey) => {
    if (get().bypassCheckingAll) return
    set((s) => ({
      bypassCheckingAll: true,
      bypassChecking: { ...s.bypassChecking, youtube: true, cloudflare: true, discord: true }
    }))
    try {
      const ids: BypassTargetId[] = ['youtube', 'discord', 'cloudflare']
      // One flaky target must not discard the other two results.
      const settled = await Promise.allSettled(ids.map((id) => window.zapret.checkBypass(id)))
      const errors: string[] = []
      set((s) => {
        const bypass = { ...s.bypass }
        for (const r of settled) {
          if (r.status === 'fulfilled') bypass[r.value.id] = r.value
          else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
        }
        // A strategy switch mid-flight makes these results stale — record
        // them anyway but tag with the key they were measured for, so the
        // Dashboard can tell they belong to the previous strategy.
        return { bypass, bypassStrategyKey: strategyKey }
      })
      if (errors.length > 0) set({ error: errors.join(' · ').slice(0, 500) })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ bypassCheckingAll: false, bypassChecking: { youtube: false, cloudflare: false, discord: false } })
    }
  },

  init: async () => {
    // StrictMode double-invokes effects in dev: subscribing twice would
    // duplicate every log line. Subscribe once per page lifetime.
    if (!logSubscribed) {
      logSubscribed = true
      window.zapret.onLog((line) => get().pushLog(line))
    }
    // Same for config-tester events: a run keeps streaming into the store
    // even when Diagnostics is unmounted (other tab open), and the results
    // are still there when the user comes back.
    if (!configTesterSubscribed) {
      configTesterSubscribed = true
      window.zapret.onConfigTesterEvent((e: ConfigTesterEvent) => {
        if (e.kind === 'log') {
          set((s) => ({ configLogs: [...s.configLogs.slice(-400), e.text] }))
        } else if (e.kind === 'config-start') {
          set((s) => ({
            configProgress: { completed: e.index - 1, total: e.total, current: e.configName },
            configLogs: [...s.configLogs.slice(-400), `[${e.index}/${e.total}] ${e.configName}`]
          }))
        } else if (e.kind === 'progress') {
          set({ configProgress: { completed: e.completed, total: e.total, current: e.current } })
        } else if (e.kind === 'config-done') {
          set({ configProgress: { completed: e.index, total: e.total, current: e.configName } })
        } else if (e.kind === 'done') {
          set((s) => ({
            configRunning: false,
            configRows: e.rows,
            configBest: e.best,
            configFilePath: e.filePath,
            configCancelled: e.cancelled,
            configProgress: s.configProgress ? { ...s.configProgress, completed: s.configProgress.total } : s.configProgress
          }))
        }
      })
    }
    const settings = await call('init', () => window.zapret.getSettings(), set, get)
    if (settings) {
      set({ settings, locale: settings.locale, theme: settings.theme })
      syncThemeClass(settings.theme)
    }
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
  },

  refreshSettings: async () => {
    const settings = await call('settings', () => window.zapret.getSettings(), set, get)
    if (settings) {
      set({ settings, locale: settings.locale, theme: settings.theme })
      syncThemeClass(settings.theme)
    }
  }
}))
