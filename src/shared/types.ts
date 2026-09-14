/**
 * Shared types used by both the Electron main process and the renderer.
 * @module shared/types
 */
import type { I18nKey, Locale } from './i18n'

/** Windows service state as reported by `sc query`. */
export type ServiceState =
  | 'RUNNING'
  | 'STOPPED'
  | 'START_PENDING'
  | 'STOP_PENDING'
  | 'NOT_INSTALLED'
  | 'UNKNOWN'

/** High-level zapret status shown on the dashboard. */
export type ZapretStatus = 'running' | 'stopped' | 'not-installed' | 'unknown'

/** UI theme: fixed dark/light or follow the OS color scheme. */
export type AppTheme = 'dark' | 'light' | 'auto'

/** Game filter modes (mirrors service.bat `game_filter.enabled` flag file). */
export type GameFilterMode = 'disabled' | 'all' | 'tcp' | 'udp'

/** IPSet filter modes derived from `lists/ipset-all.txt` content. */
export type IPSetMode = 'none' | 'loaded' | 'any'

/** One DPI-bypass strategy (parsed from a `.bat` file). */
export interface Strategy {
  /** File base name without extension, e.g. `general (ALT)` */
  id: string
  /** Human readable name */
  name: string
  /** Original .bat file name */
  fileName: string
  /** Short description of the technique used */
  description: string
  /** Ordered list of winws.exe CLI tokens (placeholders kept as-is) */
  args: string[]
  /** Raw joined command line (for display / logs) */
  rawArgs: string
  /** Desync methods referenced, e.g. ["multisplit", "fake"] */
  desyncMethods: string[]
  /** Where the strategy came from: bundled Flowseal configs vs user import. */
  origin: 'bundled' | 'imported'
}

/** Result of parsing a `.bat` file. */
export interface ParsedStrategy {
  strategy: Strategy
  warnings: string[]
}

/** Who owns the `zapret` Windows service binary. */
export type ServiceOwnership =
  | 'ours'
  | 'foreign'
  | 'none'
  | 'unknown'

/** Dashboard snapshot. */
export interface StatusSnapshot {
  zapret: ServiceState
  windivert: ServiceState
  winwsRunning: boolean
  /** Strategy name stored in HKLM\...\Services\zapret / zapret-discord-youtube */
  activeStrategy: string | null
  /** Full service binary path (ImagePath) if installed */
  serviceBinPath: string | null
  /** Delivery path of the running winws.exe (null when not running / unknown). */
  winwsPath: string | null
  /** Whether the installed `zapret` service points into our own data/bin dir. */
  ownership: ServiceOwnership
  isAdmin: boolean
}

/** Single diagnostics check result. */
export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface DiagnosticCheck {
  id: string
  /** i18n key suffix, e.g. `diag.bfe` */
  labelKey: string
  level: CheckLevel
  /** English fallback text (also used in exported logs). */
  detail: string
  /** i18n key (`diag.detail.*`) for the localized detail sentence. */
  detailKey: I18nKey
  /** Values for `{placeholders}` in the localized template. */
  detailParams?: Record<string, string>
}

/** Update info from the upstream repository. */
export interface UpdateInfo {
  /** Bundled zapret *data* version (NOT the app version). */
  localVersion: string
  remoteVersion: string | null
  updateAvailable: boolean
  releaseUrl: string
  checkedAt: string
  /** App version from package.json (via `app.getVersion()`). */
  appVersion: string
}

/** Progress event for long downloads. */
export interface DownloadProgress {
  percent: number
  transferred: number
  total: number | null
}

/** A line of application / winws log streamed to the Logs page. */
export interface LogLine {
  ts: string
  source: 'app' | 'winws' | 'updater' | 'diag'
  level: 'info' | 'warn' | 'error'
  text: string
}

/** App settings persisted to disk (`%APPDATA%/zapret-gui/settings.json`). */
export interface AppSettings {
  locale: Locale
  theme: AppTheme
  autoLaunch: boolean
  startMinimizedToTray: boolean
  minimizeToTrayOnClose: boolean
  showTrayIcon: boolean
  /** Tray menu sections visibility (toggled from Settings → Tray). */
  trayStrategyMenu: boolean
  trayTuningMenu: boolean
  trayQuickSettings: boolean
  activeStrategyId: string | null
  discordFake: string | null
  gameFake: string | null
}

/** Bypass-test target id shown on the dashboard. */
export type BypassTargetId = 'youtube' | 'cloudflare' | 'discord'

/** Result of a single bypass connectivity check (main process). */
export interface BypassCheckResult {
  id: BypassTargetId
  ok: boolean
  /** Time until response headers, ms. */
  latencyMs: number
  /** HTTP status code (null on network error). */
  httpStatus: number | null
  /** Short error text (null on success). */
  error: string | null
  checkedAt: string
}
/** One user-editable `*-user.txt` list in the data `lists/` dir. */
export interface UserListMeta {
  /** File name, e.g. `list-exclude-user.txt` */
  name: string
  /** `ipset-*` files hold IPs/CIDRs, the rest hold domains. */
  kind: 'domains' | 'ipset'
  /** Meaningful entries (non-empty, non-comment lines). */
  lines: number
  bytes: number
  exists: boolean
}
/** A top-level UI page that the tray menu can navigate to. */
export type TrayPage = 'dashboard' | 'strategies' | 'settings' | 'lists' | 'updates' | 'diagnostics' | 'logs'

/** IPC channel names (kept in one place to avoid typos). */
export const IPC = {
  getStatus: 'zapret:get-status',
  installStrategy: 'zapret:install-strategy',
  removeServices: 'zapret:remove-services',
  startService: 'zapret:start-service',
  stopService: 'zapret:stop-service',
  listStrategies: 'zapret:list-strategies',
  importStrategy: 'zapret:import-strategy',
  deleteStrategy: 'zapret:delete-strategy',
  testStrategy: 'zapret:test-strategy',
  stopTest: 'zapret:stop-test',
  getGameFilter: 'zapret:get-game-filter',
  setGameFilter: 'zapret:set-game-filter',
  getIPSetMode: 'zapret:get-ipset-mode',
  setIPSetMode: 'zapret:set-ipset-mode',
  getAutoUpdateCheck: 'zapret:get-auto-update-check',
  setAutoUpdateCheck: 'zapret:set-auto-update-check',
  listFakes: 'zapret:list-fakes',
  replaceFake: 'zapret:replace-fake',
  checkUpdates: 'zapret:check-updates',
  updateIPSet: 'zapret:update-ipset',
  updateHosts: 'zapret:update-hosts',
  applyHosts: 'zapret:apply-hosts',
  updateStrategies: 'zapret:update-strategies',
  runDiagnostics: 'zapret:run-diagnostics',
  checkBypass: 'zapret:check-bypass',
  clearDiscordCache: 'zapret:clear-discord-cache',
  removeConflicts: 'zapret:remove-conflicts',
  runTests: 'zapret:run-tests',
  getSettings: 'zapret:get-settings',
  saveSettings: 'zapret:save-settings',
  listUserLists: 'zapret:list-user-lists',
  readUserList: 'zapret:read-user-list',
  saveUserList: 'zapret:save-user-list',
  relaunchAsAdmin: 'zapret:relaunch-as-admin',
  exportLogs: 'zapret:export-logs',
  onLog: 'zapret:on-log',
  onTestOutput: 'zapret:on-test-output',
  onDownloadProgress: 'zapret:on-download-progress',
  onAppUpdateAvailable: 'zapret:app-update-available',
  navigate: 'zapret:navigate',
  statusChanged: 'zapret:status-changed'
} as const
