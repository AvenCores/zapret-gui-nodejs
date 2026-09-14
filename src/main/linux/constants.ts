/**
 * Linux constants — TypeScript mirror of
 * `zapret-discord-youtube-linux-master/src/lib/constants.sh`.
 * @module main/linux/constants
 */

export const LINUX_SERVICE_NAME = 'zapret_discord_youtube'

export type FirewallBackend = 'auto' | 'nftables' | 'iptables'
export type FirewallBackendResolved = 'nftables' | 'iptables'

/** Init systems supported by `src/init-backends/*` in the Linux example. */
export type InitSystem = 'systemd' | 'openrc' | 'runit' | 's6' | 'dinit' | 'unknown'

export const NFT_TABLE = 'inet zapretunix'
export const NFT_CHAIN = 'post'
export const NFT_CHAIN_PRE = 'pre'
export const NFT_QUEUE_NUM = 220
export const NFT_MARK = '0x40000000'
export const NFT_RULE_COMMENT = 'Added by zapret script'

export const IPT_CHAIN = 'zapret'
export const IPT_CHAIN_REPLY = 'reply'
export const IPT_TABLE = 'mangle'

export const GAME_FILTER_PORTS = '1024-65535'
export const GAME_FILTER_OFF_PORTS = '12'

export const LINUX_REPO_URL = 'https://github.com/Flowseal/zapret-discord-youtube'
export const LINUX_MAIN_REPO_REV = 'ef19845a801e4e743f7bdfdbd58f9745c6adbd60'

export const LINUX_ZAPRET_REPO = 'bol-van/zapret'
/**
 * Version of `nfqws` shipped in `bundled-assets/bin-linux/<platform>/nfqws`.
 * Bundled so the app works fully offline (users behind DPI blocks may not be
 * able to download anything). The Updates page can still fetch newer ones.
 */
export const LINUX_ZAPRET_RECOMMENDED_VERSION = 'v72.13'
export const BUNDLED_NFQWS_VERSION = 'v72.13'
/** Subdir of `bundled-assets/` holding per-platform `nfqws` binaries. */
export const BIN_LINUX_DIR = 'bin-linux'

export const NFQWS_BIN = 'nfqws'
export const LINUX_CONF_FILE = 'conf.env'
export const LINUX_RUNNER_FILE = 'zapret-linux-run.sh'

export const SUDOERS_FILE = '/etc/sudoers.d/zapret'
export const DOAS_CONF = '/etc/doas.conf'

/** Default network interface label (no `oifname`/`-o` restriction). */
export const ANY_INTERFACE = 'any'

/** Sentinel used by ipset "none" mode (mirrors Windows `ipset-all.txt` logic). */
export const LINUX_IPSET_NONE_SENTINEL = '203.0.113.113/32'
