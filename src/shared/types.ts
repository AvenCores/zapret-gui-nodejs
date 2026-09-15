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

/** One bol-van/zapret engine release (carries Windows winws binaries). */
export interface EngineRelease {
  /** Tag name, e.g. `v72.13`. */
  tag: string
  name: string
  publishedAt: string
  htmlUrl: string
  /** Direct URL of the `zapret-<tag>.zip` asset. */
  zipUrl: string
}

/** Engine (winws.exe) version state. */
export interface EngineVersionInfo {
  /** Local engine version (`bin/engine-version.txt`, e.g. `v72.13`). */
  local: string
  /** Latest upstream tag (null when unreachable). */
  remote: string | null
  updateAvailable: boolean
  releasesUrl: string
  checkedAt: string
}

/** Application self-update state (electron-updater, GitHub releases). */
export interface AppUpdateInfo {
  /** Installed version (`app.getVersion()`). */
  currentVersion: string
  /** Available version (null when up to date / unreachable). */
  availableVersion: string | null
  updateAvailable: boolean
  /** True when the installer was already downloaded and waits for restart. */
  downloaded: boolean
  releasesUrl: string
  checkedAt: string
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
  source: 'app' | 'winws' | 'updater' | 'diag' | 'tg-proxy'
  level: 'info' | 'warn' | 'error'
  text: string
}

/** Telegram MTProto→WebSocket proxy status (in-process server). */
export type TgProxyStatus = 'running' | 'stopped' | 'error'

/** Persisted Telegram proxy settings (`settings.json → tgProxy`). */
export interface TgProxySettings {
  /** Desired state: true = should be running (set by Start/Stop). */
  enabled: boolean
  /** Local listen port (default 1443). */
  port: number
  /** Start the proxy automatically with the app. */
  autoStart: boolean
  /** 32-hex MTProto secret shown in the `tg://proxy` link (auto-generated). */
  secret: string
  /** Cloudflare-proxy fallback via `kws{dc}.*` domains (default true). */
  cfProxyEnabled: boolean
  /** Listen address (`--host`, default `127.0.0.1`; `0.0.0.0` = LAN). */
  host: string
  /** Custom DC targets (`--dc-ip`, e.g. `["2:149.154.167.220"]`; empty = built-in). */
  dcIps: string[]
  /** Pre-warmed WS sockets per DC (default 4, 0 = no pooling). */
  poolSize: number
  /** Socket buffer hint, KB (`--buf-kb`, default 256). */
  bufferKb: number
  /** User CF-proxy domains (override the auto-refreshed pool when non-empty). */
  cfDomains: string[]
  /** Cloudflare Worker domains for the worker fallback (tried first). */
  workerDomains: string[]
  /** FakeTLS masking domain (`ee`-secrets; empty = disabled). */
  fakeTlsDomain: string
  /** Route everything to test DCs (`--force-test-dc`). */
  forceTestDc: boolean
  /** Accept a PROXY protocol v1 header (behind nginx/haproxy). */
  proxyProtocol: boolean
}

/** Live statistics snapshot of the Telegram proxy. */
export interface TgProxyStats {
  running: boolean
  host: string
  port: number
  /** Total accepted client connections since start. */
  connectionsTotal: number
  /** Currently open client sessions. */
  connectionsActive: number
  /** Sessions bridged over WebSocket. */
  connectionsWs: number
  /** Sessions that fell back to direct TCP. */
  connectionsTcpFallback: number
  /** Sessions that fell back via Cloudflare proxy. */
  connectionsCf: number
  /** Rejected handshakes (wrong secret / proto). */
  connectionsBad: number
  /** Sessions proxied to the masking domain (FakeTLS wrong-secret probes). */
  connectionsMasked: number
  /** WebSocket handshake/connect errors. */
  wsErrors: number
  bytesUp: number
  bytesDown: number
  /** ISO timestamp of the current run start (null when stopped). */
  startedAt: string | null
  /** Last fatal error text (null when healthy). */
  lastError: string | null
}

/** Full proxy status payload for the renderer. */
export interface TgProxyStatusPayload {
  status: TgProxyStatus
  stats: TgProxyStats
  settings: TgProxySettings
  /** Ready-to-open `tg://proxy` link (`dd` or `ee` form). */
  link: string
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
  trayServiceMenu: boolean
  trayNavigateMenu: boolean
  trayGameFilterMenu: boolean
  trayIPSetMenu: boolean
  trayToolsMenu: boolean
  trayQuickSettings: boolean
  activeStrategyId: string | null
  discordFake: string | null
  gameFake: string | null
  tgProxy: TgProxySettings
}

/** Result of comparing the system hosts file with upstream (main process). */
export interface HostsCheckResult {
  needsUpdate: boolean
  firstLine: string
  lastLine: string
  remoteContent: string
  currentHasFirst: boolean
  currentHasLast: boolean
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

/** Native config-tester (replaces `utils/test zapret.ps1`). */
export type ConfigTestMode = 'standard' | 'dpi'

export interface ConfigTesterAnalyticsRow {
  configId: string
  configName: string
  ok: number
  err: number
  unsup: number
  pingOk: number
  pingFail: number
  blocked: number
}

export type ConfigTesterEvent =
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; text: string }
  | { kind: 'config-start'; index: number; total: number; configName: string; mode: ConfigTestMode }
  | { kind: 'config-done'; index: number; total: number; configName: string }
  | { kind: 'done'; cancelled: boolean; best: string | null; filePath: string | null; rows: ConfigTesterAnalyticsRow[] }
  | { kind: 'progress'; completed: number; total: number; current: string }

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
  removeHosts: 'zapret:remove-hosts',
  updateStrategies: 'zapret:update-strategies',
  listEngineReleases: 'zapret:list-engine-releases',
  checkEngineUpdates: 'zapret:check-engine-updates',
  updateEngine: 'zapret:update-engine',
  runDiagnostics: 'zapret:run-diagnostics',
  checkBypass: 'zapret:check-bypass',
  clearDiscordCache: 'zapret:clear-discord-cache',
  removeConflicts: 'zapret:remove-conflicts',
  configTesterStart: 'zapret:config-tester-start',
  configTesterStop: 'zapret:config-tester-stop',
  configTesterOpenFile: 'zapret:config-tester-open-file',
  openBackupFolder: 'zapret:open-backup-folder',
  getSettings: 'zapret:get-settings',
  saveSettings: 'zapret:save-settings',
  resetAppData: 'zapret:reset-app-data',
  listUserLists: 'zapret:list-user-lists',
  readUserList: 'zapret:read-user-list',
  saveUserList: 'zapret:save-user-list',
  relaunchAsAdmin: 'zapret:relaunch-as-admin',
  exportLogs: 'zapret:export-logs',
  onLog: 'zapret:on-log',
  onTestOutput: 'zapret:on-test-output',
  onConfigTesterEvent: 'zapret:on-config-tester-event',
  onDownloadProgress: 'zapret:on-download-progress',
  onAppUpdateAvailable: 'zapret:app-update-available',
  onAppUpdateDownloaded: 'zapret:app-update-downloaded',
  getAppVersion: 'zapret:get-app-version',
  checkAppUpdates: 'zapret:check-app-updates',
  downloadAppUpdate: 'zapret:download-app-update',
  installAppUpdate: 'zapret:install-app-update',
  tgProxyStart: 'tg-proxy:start',
  tgProxyStop: 'tg-proxy:stop',
  tgProxyRestart: 'tg-proxy:restart',
  tgProxyGetStatus: 'tg-proxy:get-status',
  tgProxyGetStats: 'tg-proxy:get-stats',
  tgProxyUpdateSettings: 'tg-proxy:update-settings',
  tgProxyResetSettings: 'tg-proxy:reset-settings',
  tgProxyOpenLink: 'tg-proxy:open-link',
  tgProxyStatusChanged: 'tg-proxy:status-changed',
  navigate: 'zapret:navigate',
  statusChanged: 'zapret:status-changed'
} as const
