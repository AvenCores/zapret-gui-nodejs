/**
 * Shared constants: upstream URLs, service names, file names.
 * @module shared/constants
 */

export const APP_NAME = 'Zapret GUI'
export const SERVICE_NAME = 'zapret'
export const WINDIVERT_SERVICE = 'WinDivert'
export const WINWS_EXE = 'winws.exe'

export const UPSTREAM_OWNER = 'Flowseal'
export const UPSTREAM_REPO = 'zapret-discord-youtube'
export const UPSTREAM_BRANCH = 'main'

/** Upstream DPI engine (winws.exe binaries): bol-van/zapret releases. */
export const ENGINE_OWNER = 'bol-van'
export const ENGINE_REPO = 'zapret'
/** Windows x64 binaries inside a release asset (e.g. `zapret-v72.13.zip`). */
export const ENGINE_WIN64_DIR = 'binaries/windows-x86_64'
export const ENGINE_FAKES_DIR = 'files/fake'
/** Engine binaries synced into `bin/` on update (allowlist — nothing else is touched). */
export const ENGINE_BIN_FILES = [
  'winws.exe',
  'WinDivert.dll',
  'WinDivert64.sys',
  'cygwin1.dll',
  'mdig.exe',
  'ip2net.exe',
  'killall.exe'
] as const
export const ENGINE_VERSION_FILE = 'engine-version.txt'

export const APP_OWNER = 'AvenCores'
export const APP_REPO = 'zapret-gui-nodejs'

export const URLS = {
  versionTxt: `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/refs/heads/${UPSTREAM_BRANCH}/.service/version.txt`,
  ipsetTxt: `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/refs/heads/${UPSTREAM_BRANCH}/.service/ipset-service.txt`,
  hostsTxt: `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/refs/heads/${UPSTREAM_BRANCH}/.service/hosts`,
  // Source tree (not release artifacts): full branch snapshot with
  // strategies/*.bat, bin/, lists/ and utils/ at its root.
  repoArchive: (branch: string) => `https://codeload.github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/zip/refs/heads/${branch}`,
  branchHeadApi: `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/commits/${UPSTREAM_BRANCH}`,
  releasesPage: `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`,
  releaseTag: (tag: string) => `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/tag/${tag}`,
  // DPI engine (bol-van/zapret): versioned release assets with Windows binaries.
  engineReleasesApi: `https://api.github.com/repos/${ENGINE_OWNER}/${ENGINE_REPO}/releases?per_page=20`,
  engineReleasesPage: `https://github.com/${ENGINE_OWNER}/${ENGINE_REPO}/releases`,
  engineReleaseTag: (tag: string) => `https://github.com/${ENGINE_OWNER}/${ENGINE_REPO}/releases/tag/${tag}`,
  engineAsset: (tag: string) => `https://github.com/${ENGINE_OWNER}/${ENGINE_REPO}/releases/download/${tag}/zapret-${tag}.zip`,
  // Project links + author socials (mirrors the badges at the top of README.md).
  appRepo: `https://github.com/${APP_OWNER}/${APP_REPO}`,
  appIssues: `https://github.com/${APP_OWNER}/${APP_REPO}/issues`,
  appReleases: `https://github.com/${APP_OWNER}/${APP_REPO}/releases`,
  youtube: 'https://www.youtube.com/@avencores/',
  telegram: 'https://t.me/avencoresyt',
  vk: 'https://vk.ru/avencoresreuploads',
  dzen: 'https://dzen.ru/avencores'
} as const

/**
 * Status dot colors — single source of truth shared by the tray badge
 * (`scripts/make-icon.mjs` → `bundled-assets/tray/tray-*.png`) and the
 * in-app `Dot` (`src/renderer/components/ui.tsx`). Both render these exact
 * hexes so the indicator looks identical in the tray and on the app logo.
 * Keep the three places in sync when changing a value.
 */
export const STATUS_DOT_COLORS = {
  running: '#22c55e',
  stopped: '#ef4444',
  pending: '#f59e0b',
  idle: '#9ca3af'
} as const

/**
 * In-memory ring-buffer caps per log storage category. Each category is
 * trimmed independently so the spammy tg-proxy sessions can never evict
 * zapret/app lines (and vice versa).
 */
export const LOG_BUFFER_LIMITS: Record<'app' | 'zapret' | 'tg-proxy', number> = {
  app: 1000,
  zapret: 1000,
  'tg-proxy': 500
}

/** Renderer-side mirror of the caps (single import, no drift). */
export const LOG_TOTAL_LIMIT = LOG_BUFFER_LIMITS.app + LOG_BUFFER_LIMITS.zapret + LOG_BUFFER_LIMITS['tg-proxy']

export const GAME_FILTER_FLAG = 'game_filter.enabled'
export const CHECK_UPDATES_FLAG = 'check_updates.enabled'
export const BYPASS_CHECK_TIMEOUT_MS = 10000

/** Targets for the dashboard bypass test (lightweight endpoints). */
export const BYPASS_TARGETS = [
  {
    id: 'youtube',
    name: 'YouTube',
    host: 'www.youtube.com',
    url: 'https://www.youtube.com/favicon.ico',
    openUrl: 'https://www.youtube.com/'
  },
  {
    id: 'discord',
    name: 'Discord',
    host: 'discord.com',
    url: 'https://discord.com/api/v10/gateway',
    openUrl: 'https://discord.com/'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    host: 'www.cloudflare.com',
    url: 'https://www.cloudflare.com/cdn-cgi/trace',
    openUrl: 'https://www.cloudflare.com/'
  }
] as const
export const IPSET_ALL = 'ipset-all.txt'
export const IPSET_BACKUP = 'ipset-all.txt.backup'
export const IPSET_NONE_SENTINEL = '203.0.113.113/32'

export const CONFLICTING_SERVICES = ['GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2'] as const

export const FAKE_DISCORD_ACTIVE = 'ACTIVE_DISCORD_UDP.bin'
export const FAKE_GAME_ACTIVE = 'ACTIVE_GAME_UDP.bin'

/**
 * Built-in Telegram MTProto→WebSocket proxy (port of Flowseal/tg-ws-proxy).
 * Listens on localhost and bridges Telegram Desktop MTProto connections
 * over TLS WebSocket to Telegram DCs (with CF-proxy / direct-TCP fallback).
 */
export const TG_PROXY_DEFAULT_HOST = '127.0.0.1'
export const TG_PROXY_DEFAULT_PORT = 1443
/**
 * CLI marker passed to the elevated copy during "relaunch as admin" when the
 * TG proxy listener was running. The new instance must (re)start the proxy
 * even if `tgProxy.autoStart` is off — the old instance stopped its listener
 * to free the port for handover. See `relaunchAsAdmin` handlers.
 */
export const TG_PROXY_RESTART_ARG = '--restart-tg-proxy'
/**
 * CLI marker always passed to the elevated copy during "relaunch as admin".
 * The new instance must show its window even if `startMinimizedToTray` is on:
 * the user just clicked a button and expects to see the result, not to hunt
 * the app in the tray.
 */
export const ADMIN_RELAUNCH_ARG = '--admin-relaunch'
export const TG_PROXY_WS_PATH = '/apiws'
export const TG_PROXY_WS_PATH_TEST = '/apiws_test'
/** Default target IPs per DC (mirrors upstream `DC_DEFAULT_IPS`). */
export const TG_PROXY_DC_IPS: Record<number, string> = {
  1: '149.154.175.50',
  2: '149.154.167.51',
  3: '149.154.175.100',
  4: '149.154.167.91',
  5: '149.154.171.5'
}
/** Test-DC IPs (DCs 10001+ map here after subtracting 10000). */
export const TG_PROXY_DC_TEST_IPS: Record<number, string> = {
  1: '149.154.175.10',
  2: '149.154.167.40',
  3: '149.154.175.117'
}
/**
 * Direct-TCP fallback targets (mirrors upstream `DC_DEFAULT_IPS`).
 * DC203 has no WS relay (`kws203.*` does not exist → CF answers 503),
 * so it is served exclusively by direct TCP to 91.105.192.100.
 */
export const TG_PROXY_DC_FALLBACK_IPS: Record<number, string> = {
  1: '149.154.175.50',
  2: '149.154.167.51',
  3: '149.154.175.100',
  4: '149.154.167.91',
  5: '149.154.171.5',
  203: '91.105.192.100'
}
