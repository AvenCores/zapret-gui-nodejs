/**
 * Privilege elevation on Linux.
 *
 * Model: the app ALWAYS runs as a regular user — it is never relaunched
 * as a whole under root. Only root-dependent operations elevate, and only
 * for the duration of a single call:
 * - `runPrivileged*` (mutations: firewall, services, nfqws, file installs):
 *   already-root runs directly; otherwise `sudo -n`/`doas -n` when the
 *   one-time passwordless setup (`setupPermissions`, a single auth) was
 *   done; otherwise one `pkexec` GUI prompt for that call.
 * - `runQuery*` (read-only status polling): never prompts — `sudo -n`
 *   when available, otherwise a direct unprivileged attempt (many queries
 *   such as `systemctl is-active` or `pgrep` work fine without root).
 * @module main/linux/elevate
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { ExecResult } from '../exec'

export type ElevateCmd = '' | 'sudo' | 'doas' | 'pkexec'

let cachedCmd: ElevateCmd | null = null

/**
 * Sync PATH lookup for an executable (used for terminal/polkit detection).
 * Pure-ish: touches PATH only. Never throws.
 */
export function commandExists(name: string): boolean {
  const clean = String(name ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)
  if (!clean || clean.includes('/') || clean.includes('..')) return false
  const pathEnv = (process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(':')
  for (const dir of pathEnv) {
    try {
      const full = path.join(dir, clean)
      fs.accessSync(full, fs.constants.X_OK)
      return true
    } catch {
      /* try next */
    }
  }
  return false
}

function hasBinary(name: string): boolean {
  return commandExists(name)
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
  else throw new Error('No privilege escalation tool found (sudo/doas/pkexec). Install one of them to manage the service.')
  return cachedCmd
}

/** Reset the cached elevate command (tests / PATH changes). */
export function resetElevateCache(): void {
  cachedCmd = null
  nopassCache.clear()
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
 * Whether `sudo -n true` / `doas -n true` succeeds — i.e. NOPASSWD /
 * cached credentials allow passwordless operation (what
 * `setup-permissions` configures).
 */
export async function canElevateWithoutPassword(timeoutMs = 8000): Promise<boolean> {
  try {
    if (isRoot()) return true
    const cmd = sudoishCmd()
    if (cmd === '') return false
    return await isPasswordless(cmd, timeoutMs)
  } catch {
    return false
  }
}

/** `sudo`/`doas` part of the elevate command (`''` when root/pkexec-only/none). Never throws. */
function sudoishCmd(): '' | 'sudo' | 'doas' {
  try {
    const cmd = detectElevateCmd()
    return cmd === 'sudo' || cmd === 'doas' ? cmd : ''
  } catch {
    return ''
  }
}

const nopassCache = new Map<string, { value: boolean; ts: number }>()
const NOPASS_TTL_MS = 30000

/**
 * Probe passwordless operation (`sudo -n true`), cached briefly to avoid a
 * failing probe (and its auth log line) on every single privileged call.
 * Never throws.
 */
async function isPasswordless(sudoish: 'sudo' | 'doas', timeoutMs = 8000): Promise<boolean> {
  const now = Date.now()
  const hit = nopassCache.get(sudoish)
  if (hit && now - hit.ts < NOPASS_TTL_MS) return hit.value
  let value = false
  try {
    const r = await runRaw(sudoish, ['-n', 'true'], timeoutMs)
    value = r.code === 0
  } catch {
    value = false
  }
  nopassCache.set(sudoish, { value, ts: now })
  return value
}

/**
 * Stable English output for privilege helpers: sudo/doas messages stay
 * parseable on localized systems (e.g. ru Fedora prints
 * `sudo: требуется указать пароль`), and wrapped-tool diagnostics
 * (`systemctl is-active`, `sv status`, …) match the English parsers.
 */
function cLocaleEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' }
}

function runRaw(
  file: string,
  args: string[],
  timeoutMs: number,
  opts: { input?: string } = {}
): Promise<ExecResult> {
  if (opts.input !== undefined) return runWithInput(file, args, opts.input, timeoutMs)
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, env: cLocaleEnv() }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        code: error && 'code' in error ? ((error as { code?: number | null }).code ?? 1) : 0
      })
    })
  })
}

/** execFile-equivalent with piped stdin (used for `tee` writes). */
function runWithInput(file: string, args: string[], input: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: ExecResult): void => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    let child: ChildProcess
    try {
      child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env: cLocaleEnv() })
    } catch (e) {
      done({ stdout: '', stderr: String(e instanceof Error ? e.message : e), code: 1 })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      done({ stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(), code: 1 })
    }, timeoutMs)
    if (timer.unref) timer.unref()
    child.stdout?.on('data', (d: Buffer) => {
      stdout += String(d)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += String(d)
    })
    child.on('error', (e: Error) => {
      clearTimeout(timer)
      done({ stdout, stderr: `${stderr}\n${e.message}`.trim(), code: 1 })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ stdout, stderr, code: code ?? 1 })
    })
    try {
      if (child.stdin) {
        child.stdin.write(input)
        child.stdin.end()
      }
    } catch (e) {
      clearTimeout(timer)
      done({ stdout, stderr: `${stderr}\n${e instanceof Error ? e.message : String(e)}`.trim(), code: 1 })
    }
  })
}

/**
 * True when a `sudo -n` / `doas -n` failure is an *authentication* failure
 * (as opposed to the wrapped command itself failing). Only auth failures
 * should fall through to the interactive `pkexec` prompt — otherwise every
 * genuinely broken firewall rule would pop a password dialog.
 *
 * Matching is multilingual on purpose: even with `LC_ALL=C` some sudo
 * builds still localize their own messages (seen on ru Fedora:
 * `sudo: требуется указать пароль`). The classifier only ever sees output
 * of the fixed `sudo -n <known-tool>` / `doas -n <known-tool>` wrappers, so
 * the broad stems cannot misfire on user content. Pure.
 */
export function isAuthFailure(output: string): boolean {
  const s = String(output ?? '').toLowerCase()
  return (
    s.includes('a password is required') ||
    s.includes('no tty present') ||
    s.includes('a terminal is required') ||
    s.includes('no askpass program specified') ||
    s.includes('askpass') ||
    s.includes('not in the sudoers') ||
    s.includes('sudoers') ||
    s.includes('user is not allowed to execute') ||
    s.includes('operation not permitted') ||
    (s.includes('permission denied') && s.includes('doas')) ||
    // ru/uk/be sudo: `sudo: требуется указать пароль`, `... файл sudoers`,
    // `... требуется терминал ...`
    s.includes('требуется указать пароль') ||
    s.includes('парол') ||
    s.includes('терминал')
  )
}

/** Short guidance surfaced when no elevation path exists. Pure. */
export function noAuthMessage(): string {
  return (
    'Cannot get root privileges: passwordless sudo/doas is not configured and no graphical prompt (pkexec/polkit) is available. ' +
    'Open Strategies → "Set up passwordless operation" (a single password prompt) or install polkit, then retry.'
  )
}

function combinedOut(r: ExecResult): string {
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
}

/**
 * Run a command with elevation, prompting at most once via `pkexec`.
 * Order: direct (root) → `sudo -n`/`doas -n` when the probe shows
 * passwordless operation (one-time NOPASSWD setup or cached credentials) →
 * `pkexec` (one GUI prompt for this call). Never rejects — always resolves
 * with code/stdout/stderr, except when sudo/doas needs a password but no
 * graphical prompt exists (throws with actionable guidance).
 */
export async function runPrivileged(
  file: string,
  args: string[],
  timeoutMs = 30000,
  opts: { input?: string } = {}
): Promise<ExecResult> {
  if (isRoot()) return runRaw(file, args, timeoutMs, opts)
  const sudoish = sudoishCmd()
  if (sudoish !== '' && (await isPasswordless(sudoish))) {
    // Silent path — a failure here is the command's own error (returned
    // as-is, no password dialog for broken firewall rules, ...).
    const r = await runRaw(sudoish, ['-n', file, ...args], timeoutMs, opts)
    if (r.code === 0) return r
    // Rare timestamp race (expired between probe and run): fall through to
    // the interactive prompt instead of failing outright.
    if (!isAuthFailure(combinedOut(r)) || !hasBinary('pkexec')) return r
  } else if (sudoish === '' && !hasBinary('pkexec')) {
    // No sudo/doas at all (and no pkexec): best-effort direct attempt —
    // some commands (e.g. `systemctl is-active`) do not need root.
    return runRaw(file, args, timeoutMs, opts)
  }
  if (hasBinary('pkexec')) {
    if (opts.input !== undefined) {
      return runPkexecWithInput(file, args, opts.input, timeoutMs)
    }
    return runRaw('pkexec', [file, ...args], timeoutMs)
  }
  // sudo/doas exists but needs a password, and there is no GUI prompt to
  // ask it: single attempt for an honest stderr, then guidance.
  const r = await runRaw(sudoish, ['-n', file, ...args], timeoutMs, opts)
  throw new Error(`${combinedOut(r).trim().slice(0, 300)}\n${noAuthMessage()}`)
}

/** `pkexec` with piped stdin (used for `tee` writes). */
function runPkexecWithInput(file: string, args: string[], input: string, timeoutMs: number): Promise<ExecResult> {
  return runWithInput('pkexec', [file, ...args], input, timeoutMs)
}

/**
 * Run an arbitrary shell script text with elevation (used for the one-time
 * NOPASSWD bootstrap, sysctl, etc.). Same probe-first order as
 * {@link runPrivileged}: silent passwordless path, else a single `pkexec`
 * prompt for this call.
 */
export async function runPrivilegedScript(script: string, timeoutMs = 30000): Promise<ExecResult> {
  if (isRoot()) return runRaw('bash', ['-c', script], timeoutMs)
  const sudoish = sudoishCmd()
  if (sudoish !== '' && (await isPasswordless(sudoish))) {
    const r = await runRaw(sudoish, ['-n', 'bash', '-c', script], timeoutMs)
    if (r.code === 0) return r
    if (!isAuthFailure(combinedOut(r)) || !hasBinary('pkexec')) return r
  } else if (sudoish === '' && !hasBinary('pkexec')) {
    throw new Error(noAuthMessage())
  }
  if (hasBinary('pkexec')) return runRaw('pkexec', ['bash', '-c', script], timeoutMs)
  const r = await runRaw(sudoish, ['-n', 'bash', '-c', script], timeoutMs)
  throw new Error(`${combinedOut(r).trim().slice(0, 300)}\n${noAuthMessage()}`)
}

/**
 * Run a command for *read-only* status polling. Never shows an auth
 * prompt: direct when root, `sudo -n`/`doas -n` when available, otherwise
 * a direct unprivileged attempt (works for `systemctl is-active`,
 * `pgrep`, …; root-only reads simply report absent). Never rejects.
 */
export async function runQuery(file: string, args: string[], timeoutMs = 10000): Promise<ExecResult> {
  if (isRoot()) return runRaw(file, args, timeoutMs)
  try {
    const cmd = detectElevateCmd()
    if (cmd === 'sudo' || cmd === 'doas') {
      const r = await runRaw(cmd, ['-n', file, ...args], timeoutMs)
      if (r.code === 0) return r
      if (!isAuthFailure(`${r.stdout}\n${r.stderr}`)) return r
      // Auth failed — fall through to the unprivileged attempt below.
    }
    // 'pkexec'/none: never prompt from background polling.
  } catch {
    /* no elevate tool — direct attempt below */
  }
  return runRaw(file, args, timeoutMs)
}

/**
 * Spawn a long-lived root process (foreground nfqws tests) while the app
 * itself keeps running as the user. Prefers passwordless sudo/doas
 * (`-n`, never blocks); otherwise a single `pkexec` prompt. Throws when
 * no elevation path exists.
 */
export async function spawnElevated(
  file: string,
  args: string[],
  opts: SpawnOptions = {}
): Promise<ChildProcess> {
  // Stable English diagnostics; an explicit caller env still wins.
  const withLocale: SpawnOptions = { ...opts, env: { ...cLocaleEnv(), ...((opts.env as Record<string, string> | undefined) ?? {}) } }
  if (isRoot()) return spawn(file, args, withLocale)
  if (await canElevateWithoutPassword()) {
    try {
      const cmd = detectElevateCmd()
      if (cmd === 'sudo' || cmd === 'doas') return spawn(cmd, ['-n', file, ...args], withLocale)
    } catch {
      /* fall through to pkexec */
    }
  }
  if (hasBinary('pkexec')) return spawn('pkexec', [file, ...args], withLocale)
  throw new Error(noAuthMessage())
}

/**
 * Write text to a root-owned path without a shell: `tee` via
 * {@link runPrivileged} (stdin carries the content, so no quoting
 * pitfalls), then `chmod`. Used for init-service files.
 */
export async function writeFileAsRoot(dest: string, content: string, mode = '0644'): Promise<void> {
  const safeDest = String(dest ?? '')
  if (!safeDest.startsWith('/') || safeDest.includes('\n') || safeDest.includes('..')) {
    throw new Error(`Refusing to write outside absolute system path: ${safeDest.slice(0, 120)}`)
  }
  if (!/^[0-7]{3,4}$/.test(mode)) throw new Error(`Invalid file mode: ${mode}`)
  const r = await runPrivileged('tee', [safeDest], 20000, { input: content })
  if (r.code !== 0) throw new Error(`Cannot write ${safeDest}: ${(r.stdout + r.stderr).trim().slice(0, 300)}`)
  const c = await runPrivileged('chmod', [mode, safeDest], 10000)
  if (c.code !== 0) throw new Error(`Cannot chmod ${safeDest}: ${(c.stdout + c.stderr).trim().slice(0, 300)}`)
}

/** Shell-quote a single argv entry for `sh -c` / `bash -c` wrappers. */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
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

function sanitizeUser(user: string): string {
  return String(user).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'user'
}

function sanitizeServiceName(name: string): string {
  return String(name).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'zapret_discord_youtube'
}

/**
 * Absolute-path variants for merged-/usr systems: sudo matches the
 * invoking path string after secure_path lookup, so emit both `/usr/bin/X`
 * and `/bin/X` spellings. Pure.
 */
export function withPathVariants(p: string): string[] {
  const s = String(p ?? '').trim()
  if (!s.startsWith('/')) return [s]
  const out = [s]
  if (s.startsWith('/usr/bin/')) out.push(`/bin/${s.slice(9)}`)
  else if (s.startsWith('/usr/sbin/')) out.push(`/sbin/${s.slice(10)}`)
  else if (s.startsWith('/bin/')) out.push(`/usr/bin/${s.slice(5)}`)
  else if (s.startsWith('/sbin/')) out.push(`/usr/sbin/${s.slice(6)}`)
  return [...new Set(out)]
}

export interface SudoersOpts {
  nftPath?: string
  iptablesPath?: string
  ip6tablesPath?: string
  pkillPath?: string
  systemctlPath?: string
  rcServicePath?: string
  rcUpdatePath?: string
  svPath?: string
  s6SvcPath?: string
  dinitctlPath?: string
  mkdirPath?: string
  rmPath?: string
  chmodPath?: string
  teePath?: string
  visudoPath?: string
  bashPath?: string
  /** Init-service name (default `zapret_discord_youtube`). */
  serviceName?: string
  /** Absolute runner path for the no-init fallback (`bash <runner> daemon`). */
  runnerPath?: string
  /** Extra absolute files writable via `tee` (e.g. /etc/hosts + backup). */
  extraTeePaths?: string[]
}

/**
 * Build `/etc/sudoers.d/zapret` content for a user. Covers the exact
 * privileged commands the app runs (firewall, nfqws, service management,
 * service-file installs); anything else falls back to a per-call `pkexec`
 * prompt instead of failing. Pure.
 */
export function buildSudoersContent(
  user: string,
  nfqwsPath: string,
  opts: SudoersOpts = {}
): string {
  const safeUser = sanitizeUser(user)
  const nft = opts.nftPath ?? '/usr/sbin/nft'
  const ipt = opts.iptablesPath ?? '/usr/sbin/iptables'
  const ip6t = opts.ip6tablesPath ?? '/usr/sbin/ip6tables'
  const pkill = opts.pkillPath ?? '/usr/bin/pkill'
  const svc = sanitizeServiceName(opts.serviceName ?? 'zapret_discord_youtube')
  const lines: string[] = [
    `# Zapret Discord YouTube - NOPASSWD for ${safeUser}`,
    `# File: ${'/etc/sudoers.d/zapret'}`,
    ``,
    `${safeUser} ALL=(root) NOPASSWD: ${nft} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${ipt} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${ip6t} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${nfqwsPath} *`,
    `${safeUser} ALL=(root) NOPASSWD: ${pkill} -f nfqws`,
    ``
  ]
  const rule = (bin: string | undefined, fallback: string, args: string): void => {
    const resolved = bin ?? fallback
    for (const variant of withPathVariants(resolved)) {
      lines.push(`${safeUser} ALL=(root) NOPASSWD: ${variant} ${args}`)
    }
  }
  // --- service management (one line per exact call shape) ---
  const sys = opts.systemctlPath ?? '/usr/bin/systemctl'
  for (const sub of ['daemon-reload', `enable ${svc}`, `disable ${svc}`, `start ${svc}`, `stop ${svc}`, `restart ${svc}`, `is-active ${svc}`]) {
    rule(sys, '/usr/bin/systemctl', sub)
  }
  for (const sub of [`add ${svc} default`, `del ${svc} default`]) {
    rule(opts.rcUpdatePath, '/sbin/rc-update', sub)
  }
  for (const sub of [`${svc} start`, `${svc} stop`, `${svc} restart`]) {
    rule(opts.rcServicePath, '/sbin/rc-service', sub)
  }
  for (const sub of [`up ${svc}`, `down ${svc}`]) {
    rule(opts.svPath, '/usr/bin/sv', sub)
  }
  rule(opts.s6SvcPath, '/usr/bin/s6-svc', `-u /etc/s6/sv/${svc}`)
  rule(opts.s6SvcPath, '/usr/bin/s6-svc', `-d /etc/s6/sv/${svc}`)
  for (const sub of [`enable ${svc}`, `disable ${svc}`, `start ${svc}`, `stop ${svc}`]) {
    rule(opts.dinitctlPath, '/usr/bin/dinitctl', sub)
  }
  // --- service-file installs (tee + chmod + mkdir + rm, exact paths) ---
  const managedFiles = [
    `/etc/systemd/system/${svc}.service`,
    `/etc/init.d/${svc}`,
    `/etc/sv/${svc}/run`,
    `/etc/sv/${svc}/finish`,
    `/etc/s6/sv/${svc}/run`,
    `/etc/s6/sv/${svc}/finish`,
    `/etc/s6/sv/${svc}/log/run`,
    `/etc/dinit.d/${svc}`,
    ...(opts.extraTeePaths ?? []).filter((p) => p.startsWith('/'))
  ]
  for (const f of managedFiles) {
    rule(opts.teePath, '/usr/bin/tee', f)
    rule(opts.chmodPath, '/usr/bin/chmod', `0644 ${f}`)
    rule(opts.chmodPath, '/usr/bin/chmod', `0755 ${f}`)
  }
  rule(opts.mkdirPath, '/usr/bin/mkdir', `-p /etc/sv/${svc}`)
  rule(opts.mkdirPath, '/usr/bin/mkdir', `-p /etc/s6/sv/${svc}/log`)
  rule(opts.rmPath, '/usr/bin/rm', `-f /etc/systemd/system/${svc}.service`)
  rule(opts.rmPath, '/usr/bin/rm', `-f /etc/init.d/${svc}`)
  rule(opts.rmPath, '/usr/bin/rm', `-rf /etc/sv/${svc}`)
  rule(opts.rmPath, '/usr/bin/rm', `-rf /etc/s6/sv/${svc}`)
  rule(opts.rmPath, '/usr/bin/rm', `-f /etc/dinit.d/${svc}`)
  rule(opts.visudoPath, '/usr/sbin/visudo', `-c -f /etc/sudoers.d/zapret`)
  if (opts.runnerPath && opts.runnerPath.startsWith('/')) {
    rule(opts.bashPath, '/usr/bin/bash', `${opts.runnerPath} daemon`)
  }
  lines.push(``)
  return lines.join('\n')
}

export interface DoasOpts {
  nftPath?: string
  iptablesPath?: string
  ip6tablesPath?: string
  /** Extra absolute binaries allowed without password (service tools, tee, …). */
  extraBins?: string[]
}

/** Build `doas.conf` rules for a user. Pure. */
export function buildDoasRules(
  user: string,
  nfqwsPath: string,
  opts: DoasOpts = {}
): string {
  const safeUser = sanitizeUser(user)
  const nft = opts.nftPath ?? '/usr/sbin/nft'
  const ipt = opts.iptablesPath ?? '/usr/sbin/iptables'
  const ip6t = opts.ip6tablesPath ?? '/usr/sbin/ip6tables'
  const lines = [
    `# Zapret Discord YouTube - nopass for ${safeUser}`,
    `permit nopass ${safeUser} as root cmd ${nft}`,
    `permit nopass ${safeUser} as root cmd ${ipt}`,
    `permit nopass ${safeUser} as root cmd ${ip6t}`,
    `permit nopass ${safeUser} as root cmd ${nfqwsPath}`,
    `permit nopass ${safeUser} as root cmd pkill args -f nfqws`,
    ``
  ]
  for (const bin of opts.extraBins ?? []) {
    const b = String(bin ?? '').trim()
    if (b.startsWith('/')) lines.push(`permit nopass ${safeUser} as root cmd ${b}`)
  }
  lines.push(``)
  return lines.join('\n')
}
