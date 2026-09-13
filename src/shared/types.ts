/**
 * Shared types used by both the Electron main process and the renderer.
 * @module shared/types
 */

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
}

/** Result of parsing a `.bat` file. */
export interface ParsedStrategy {
  strategy: Strategy
  warnings: string[]
}

/** Dashboard snapshot. */
export interface StatusSnapshot {
  zapret: ServiceState
  windivert: ServiceState
  winwsRunning: boolean
  /** Strategy name stored in HKLM\...\Services\zapret / zapret-discord-youtube */
  activeStrategy: string | null
  /** Full service binary path (ImagePath) if installed */
  serviceBinPath: string | null
  isAdmin: boolean
}

/** Single diagnostics check result. */
export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface DiagnosticCheck {
  id: string
  /** i18n key suffix, e.g. `diag.bfe` */
  labelKey: string
  level: CheckLevel
  detail: string
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
  locale: 'ru' | 'en'
  theme: 'dark' | 'light'
  autoLaunch: boolean
  startMinimizedToTray: boolean
  minimizeToTrayOnClose: boolean
  activeStrategyId: string | null
  discordFake: string | null
  gameFake: string | null
}

/** IPC channel names (kept in one place to avoid typos). */
export const IPC = {
  getStatus: 'zapret:get-status',
  installStrategy: 'zapret:install-strategy',
  removeServices: 'zapret:remove-services',
  startService: 'zapret:start-service',
  stopService: 'zapret:stop-service',
  listStrategies: 'zapret:list-strategies',
  importStrategy: 'zapret:import-strategy',
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
  clearDiscordCache: 'zapret:clear-discord-cache',
  removeConflicts: 'zapret:remove-conflicts',
  runTests: 'zapret:run-tests',
  getSettings: 'zapret:get-settings',
  saveSettings: 'zapret:save-settings',
  relaunchAsAdmin: 'zapret:relaunch-as-admin',
  exportLogs: 'zapret:export-logs',
  onLog: 'zapret:on-log',
  onTestOutput: 'zapret:on-test-output',
  onDownloadProgress: 'zapret:on-download-progress'
} as const
