/**
 * `conf.env` handling — mirror of `src/lib/common.sh`
 * (`check_conf_file` / `load_config` / `create_conf_file`).
 * The GUI stores it as `<dataDir>/conf.env`.
 * @module main/linux/config
 */
import fs from 'node:fs'
import path from 'node:path'
import { LINUX_CONF_FILE, type FirewallBackend } from './constants'

export interface LinuxConf {
  /** Network interface (`any` = no restriction) */
  interface: string
  gamefiltertcp: boolean
  gamefilterudp: boolean
  /** Strategy `.bat` file name (e.g. `general.bat`; empty = not applied yet) */
  strategy: string
  firewall_backend: FirewallBackend
}

export function confFilePath(dataDir: string): string {
  return path.join(dataDir, LINUX_CONF_FILE)
}

function parseBool(v: string): boolean {
  return v.trim().toLowerCase() === 'true'
}

/**
 * Parse `conf.env` content. Throws on missing/invalid required fields.
 * `strategy` is optional (empty = preferences saved before the first Apply:
 * interface/firewall backend can be picked without a running zapret).
 * Pure — covered by unit tests.
 */
export function parseConfEnv(content: string): LinuxConf {
  const map = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    map.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim())
  }
  const iface = map.get('interface') ?? ''
  const gTcp = map.get('gamefiltertcp') ?? ''
  const gUdp = map.get('gamefilterudp') ?? ''
  const strategy = map.get('strategy') ?? ''
  if (!iface) throw new Error('conf.env: missing "interface"')
  if (!gTcp) throw new Error('conf.env: missing "gamefiltertcp"')
  if (!gUdp) throw new Error('conf.env: missing "gamefilterudp"')
  const fwRaw = (map.get('firewall_backend') ?? 'auto').toLowerCase()
  const firewall_backend: FirewallBackend = fwRaw === 'nftables' || fwRaw === 'iptables' ? fwRaw : 'auto'
  return {
    interface: iface,
    gamefiltertcp: parseBool(gTcp),
    gamefilterudp: parseBool(gUdp),
    strategy,
    firewall_backend
  }
}

/** Serialize a conf object back to `conf.env` format. Pure. */
export function serializeConfEnv(conf: LinuxConf): string {
  return [
    `interface=${conf.interface}`,
    `gamefiltertcp=${conf.gamefiltertcp ? 'true' : 'false'}`,
    `gamefilterudp=${conf.gamefilterudp ? 'true' : 'false'}`,
    `strategy=${conf.strategy}`,
    `firewall_backend=${conf.firewall_backend}`,
    ``
  ].join('\n')
}

/** Read conf from disk, or null when missing/invalid. */
export function loadLinuxConf(dataDir: string): LinuxConf | null {
  try {
    const p = confFilePath(dataDir)
    if (!fs.existsSync(p)) return null
    return parseConfEnv(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** Write conf to disk (creates the data dir). */
export function saveLinuxConf(dataDir: string, conf: LinuxConf): void {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(confFilePath(dataDir), serializeConfEnv(conf), 'utf8')
}

/**
 * `uid:gid` the nfqws daemon must run as (`--uid=` pin).
 *
 * Why not root: after `droproot()` upstream calls `dropcaps()`, which strips
 * everything but `NET_ADMIN`/`NET_RAW` — including `CAP_DAC_OVERRIDE`. A uid-0
 * process without that cap is subject to normal DAC checks, so it still gets
 * `EACCES` on lists under a `700` home dir (`Running as UID=0 ... Permission
 * denied`). Running as the data dir owner (upstream runs as `tpws`/`nobody`
 * over world-readable `/opt/zapret`) keeps both file access and, via
 * `PR_SET_KEEPCAPS`, the two netfilter caps. Never throws.
 */
export function resolveDataOwnerUid(dir: string): string {
  try {
    const st = fs.statSync(dir)
    if (Number.isInteger(st.uid) && Number.isInteger(st.gid)) return `${st.uid}:${st.gid}`
  } catch {
    /* missing dir (first Apply) — fall through to the process owner */
  }
  try {
    if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
      return `${process.getuid()}:${process.getgid()}`
    }
  } catch {
    /* non-POSIX — last resort below */
  }
  return '0:0'
}

/** Normalize a strategy reference to a `.bat` file name. Pure. */
export function normalizeStrategyFileName(input: string): string {
  let s = String(input ?? '').trim()
  if (!s) return s
  // Accept ids (`general`), `general_foo`, full file names, any case.
  if (!s.toLowerCase().endsWith('.bat')) s = `${s}.bat`
  return s
}

/** Validate an interface name (`any` or `[A-Za-z0-9._-]+`). Pure. */
export function isValidInterfaceName(name: string): boolean {
  if (name === 'any') return true
  return /^[A-Za-z0-9._-]{1,32}$/.test(name)
}
