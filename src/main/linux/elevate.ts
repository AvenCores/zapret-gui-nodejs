/**
 * Privilege elevation on Linux — mirror of `src/lib/elevate.sh`.
 * Uses `sudo`/`doas` when available, `pkexec` as a GUI fallback.
 * Already-root processes run commands directly (empty elevate cmd).
 * @module main/linux/elevate
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { ExecResult } from '../exec'

export type ElevateCmd = '' | 'sudo' | 'doas' | 'pkexec'

let cachedCmd: ElevateCmd | null = null

function hasBinary(name: string): boolean {
  const pathEnv = (process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(':')
  for (const dir of pathEnv) {
    try {
      const full = path.join(dir, name)
      fs.accessSync(full, fs.constants.X_OK)
      return true
    } catch {
      /* try next */
    }
  }
  return false
}

/** True when the current process is root (EUID 0). */
export function isRoot(): boolean {
  try {
    return typeof process.geteuid === 'function' ? process.geteuid() === 0 : false
  } catch {
    return false
  }
}

/**
 * Detect the elevate command (cached). Returns `''` when already root.
 * Pure-ish: touches PATH only. Throws when nothing is available.
 */
export function detectElevateCmd(): ElevateCmd {
  if (cachedCmd !== null) return cachedCmd
  if (isRoot()) {
    cachedCmd = ''
    return cachedCmd
  }
  // doas is preferred on some systems (mirrors elevate.sh), but sudo is far
  // more common — check sudo first so `sudo -n` NOPASSWD setups win.
  if (hasBinary('sudo')) cachedCmd = 'sudo'
  else if (hasBinary('doas')) cachedCmd = 'doas'
  else if (hasBinary('pkexec')) cachedCmd = 'pkexec'
  else throw new Error('No privilege escalation tool found (sudo/doas/pkexec). Run the app as root.')
  return cachedCmd
}

/** Reset the cached elevate command (tests / PATH changes). */
export function resetElevateCache(): void {
  cachedCmd = null
}

/** Whether elevation is available (or already root). Never throws. */
export function checkElevateAvailable(): boolean {
  try {
    detectElevateCmd()
    return true
  } catch {
    return false
  }
}

/**
 * Whether `sudo -n true` succeeds — i.e. NOPASSWD / cached credentials allow
 * passwordless operation (what `setup-permissions` configures).
 */
export async function canElevateWithoutPassword(timeoutMs = 8000): Promise<boolean> {
  try {
    if (isRoot()) return true
    const cmd = detectElevateCmd()
    if (cmd === 'sudo') {
      const r = await runRaw('sudo', ['-n', 'true'], timeoutMs)
      return r.code === 0
    }
    if (cmd === 'doas') {
      const r = await runRaw('doas', ['-n', 'true'], timeoutMs)
      return r.code === 0
    }
    return false
  } catch {
    return false
  }
}

function runRaw(file: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        code: error && 'code' in error ? ((error as { code?: number | null }).code ?? 1) : 0
      })
    })
  })
}

/**
 * Run a command with elevation (`sudo`/`doas`/`pkexec` prefix, or directly
 * when root). Never rejects — always resolves with code/stdout/stderr.
 */
export async function runElevatedArgs(file: string, args: string[], timeoutMs = 30000): Promise<ExecResult> {
  const cmd = detectElevateCmd()
  if (cmd === '') return runRaw(file, args, timeoutMs)
  return runRaw(cmd, [file, ...args], timeoutMs)
}

/** Shell-quote a single argv entry for `sh -c` / `bash -c` wrappers. */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Run an arbitrary shell script text as root via `sudo bash -c` (used for
 * heredoc service-file installs, sysctl, etc.).
 */
export async function runElevatedScript(script: string, timeoutMs = 30000): Promise<ExecResult> {
  const cmd = detectElevateCmd()
  if (cmd === '') return runRaw('bash', ['-c', script], timeoutMs)
  if (cmd === 'pkexec') return runRaw('pkexec', ['bash', '-c', script], timeoutMs)
  return runRaw(cmd, ['bash', '-c', script], timeoutMs)
}

/** Resolve a helper binary path (`command -v` fallback to /usr/bin). */
export async function whichBin(name: string): Promise<string> {
  const safe = String(name).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'nft'
  const r = await runRaw('sh', ['-c', `command -v ${safe} 2>/dev/null || echo /usr/bin/${safe}`], 5000)
  const out = (r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)[0]
  return out ?? `/usr/bin/${safe}`
}

// ---------------------------------------------------------------------------
// NOPASSWD content (mirrors `src/lib/permissions.sh`)
// ---------------------------------------------------------------------------

/** Build `/etc/sudoers.d/zapret` content for a user. Pure. */
export function buildSudoersContent(
  user: string,
  nfqwsPath: string,
  opts: { nftPath?: string; iptablesPath?: string; ip6tablesPath?: string; pkillPath?: string } = {}
): string {
  const safeUser = String(user).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'user'
  const nft = opts.nftPath ?? '/usr/sbin/nft'
  const ipt = opts.iptablesPath ?? '/usr/sbin/iptables'
  const ip6t = opts.ip6tablesPath ?? '/usr/sbin/ip6tables'
  const pkill = opts.pkillPath ?? '/usr/bin/pkill'
  return [
    `# Zapret Discord YouTube - NOPASSWD for ${safeUser}`,
    `# File: ${'/etc/sudoers.d/zapret'}`,
    ``,
    `${safeUser} ALL=(root) NOPASSWD: ${nft} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${ipt} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${ip6t} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${nfqwsPath} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${pkill} -f nfqws`,
    ``
  ].join('\n')
}

/** Build `doas.conf` rules for a user. Pure. */
export function buildDoasRules(
  user: string,
  nfqwsPath: string,
  opts: { nftPath?: string; iptablesPath?: string; ip6tablesPath?: string } = {}
): string {
  const safeUser = String(user).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'user'
  const nft = opts.nftPath ?? '/usr/sbin/nft'
  const ipt = opts.iptablesPath ?? '/usr/sbin/iptables'
  const ip6t = opts.ip6tablesPath ?? '/usr/sbin/ip6tables'
  return [
    `# Zapret Discord YouTube - nopass for ${safeUser}`,
    `permit nopass ${safeUser} as root cmd ${nft}`,
    `permit nopass ${safeUser} as root cmd ${ipt}`,
    `permit nopass ${safeUser} as root cmd ${ip6t}`,
    `permit nopass ${safeUser} as root cmd ${nfqwsPath}`,
    `permit nopass ${safeUser} as root cmd pkill args -f nfqws`,
    ``
  ].join('\n')
}
