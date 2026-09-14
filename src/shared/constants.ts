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

export const APP_OWNER = 'AvenCores'
export const APP_REPO = 'zapret-gui-nodejs'

export const URLS = {
  versionTxt: `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/refs/heads/${UPSTREAM_BRANCH}/.service/version.txt`,
  ipsetTxt: `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/refs/heads/${UPSTREAM_BRANCH}/.service/ipset-service.txt`,
  hostsTxt: `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/refs/heads/${UPSTREAM_BRANCH}/.service/hosts`,
  releasesLatestApi: `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`,
  releasesPage: `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`,
  releaseTag: (tag: string) => `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/tag/${tag}`,
  // Project links + author socials (mirrors the badges at the top of README.md).
  appRepo: `https://github.com/${APP_OWNER}/${APP_REPO}`,
  appIssues: `https://github.com/${APP_OWNER}/${APP_REPO}/issues`,
  appReleases: `https://github.com/${APP_OWNER}/${APP_REPO}/releases`,
  youtube: 'https://www.youtube.com/@avencores/',
  telegram: 'https://t.me/avencoresyt',
  vk: 'https://vk.ru/avencoresreuploads',
  dzen: 'https://dzen.ru/avencores'
} as const

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
