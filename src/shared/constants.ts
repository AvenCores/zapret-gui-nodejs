/**
 * Shared constants: upstream URLs, service names, file names.
 * @module shared/constants
 */

export const APP_NAME = 'zapret-gui'
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
  issues: `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/issues`,
  // Links shown on the dashboard. NOTE: upstream explicitly states it runs
  // NO Telegram/YouTube pages and NO Discord server — anything like that
  // "from Flowseal" outside github.com/Flowseal is fake. So only GitHub links.
  appRepo: `https://github.com/${APP_OWNER}/${APP_REPO}`,
  appIssues: `https://github.com/${APP_OWNER}/${APP_REPO}/issues`,
  appReleases: `https://github.com/${APP_OWNER}/${APP_REPO}/releases`,
  upstreamRepo: `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}`,
  upstreamDiscussions: `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/discussions`,
  tgWsProxy: 'https://github.com/Flowseal/tg-ws-proxy',
  bolvanZapret: 'https://github.com/bol-van/zapret'
} as const

export const GAME_FILTER_FLAG = 'game_filter.enabled'
export const CHECK_UPDATES_FLAG = 'check_updates.enabled'
export const IPSET_ALL = 'ipset-all.txt'
export const IPSET_BACKUP = 'ipset-all.txt.backup'
export const IPSET_NONE_SENTINEL = '203.0.113.113/32'

export const CONFLICTING_SERVICES = ['GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2'] as const

export const FAKE_DISCORD_ACTIVE = 'ACTIVE_DISCORD_UDP.bin'
export const FAKE_GAME_ACTIVE = 'ACTIVE_GAME_UDP.bin'
