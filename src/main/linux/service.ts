/**
 * Linux service manager — GUI equivalent of `service.sh` +
 * `src/cli/run.sh` + `src/cli/service.sh` + `src/cli/config.sh`.
 *
 * Model:
 * - `<dataDir>/conf.env` is the source of truth (interface, gamefilters,
 *   strategy `.bat` name, firewall backend) — mirrors the example repo.
 * - `<dataDir>/zapret-linux-run.sh` is a generated runner (`daemon`/`kill`)
 *   used both for foreground runs and as `ExecStart` for init services.
 * - System services (systemd/OpenRC/runit/s6/dinit) wrap the runner for
 *   autostart; without a supported init the GUI still runs nfqws directly.
 * @module main/linux/service
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, type ChildProcess } from 'node:child_process'
import type { ServiceState, StatusSnapshot, Strategy } from '../../shared/types'
import {
  ANY_INTERFACE,
  LINUX_RUNNER_FILE,
  LINUX_RUNNER_LOG_FILE,
  LINUX_SERVICE_NAME,
  NFQWS_BIN,
  SUDOERS_FILE,
  type FirewallBackend,
  type FirewallBackendResolved,
  type InitSystem
} from './constants'
import { loadLinuxConf, saveLinuxConf, resolveDataOwnerUid, type LinuxConf } from './config'
import {
  batchFailWhat,
  batchOut,
  buildBatchScript,
  runBatch,
  runQuery,
  spawnElevated,
  buildSudoersContent,
  buildDoasRules,
  canElevateWithoutPassword,
  checkElevateAvailable,
  detectElevateCmd,
  isRoot,
  resetElevateCache,
  shellQuote,
  whichBin,
  type BatchStep
} from './elevate'
import {
  buildFirewallClearSteps,
  buildFirewallSetupSteps,
  detectFirewallBackend,
  firewallClear,
  isFirewallActive,
  listAvailableBackends
} from './firewall'
import {
  buildInstallSteps,
  buildRemoveSteps,
  buildStartSteps,
  buildStopSteps,
  buildSystemdUnit,
  detectInitSystem,
  getSystemdDetails,
  queryLinuxServiceState,
  type SystemdDetails
} from './init-system'
import { buildNfqwsArgv, parseStrategyArgsForLinux } from './strategy-linux'

export interface LinuxStatusExtra {
  initSystem: InitSystem
  firewallBackend: FirewallBackend
  firewallResolved: FirewallBackendResolved | null
  firewallActive: boolean
  interface: string
  nfqwsPath: string | null
  nfqwsRunning: boolean
  confExists: boolean
}

let foregroundProc: ChildProcess | null = null
/** Firewall backend of the running foreground test (for one-batch cleanup on stop). */
let foregroundBackend: FirewallBackendResolved | null = null

function execAsync(cmd: string, args: string[], timeoutMs = 10000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        code: error && 'code' in error ? (((error as { code?: number | null }).code ?? 1) as number) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '')
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Paths / processes
// ---------------------------------------------------------------------------

export function getLinuxBinDir(dataDir: string): string {
  return path.join(dataDir, 'bin')
}

export function getLinuxNfqwsPath(dataDir: string): string {
  return path.join(getLinuxBinDir(dataDir), NFQWS_BIN)
}

export function getLinuxRunnerPath(dataDir: string): string {
  return path.join(dataDir, LINUX_RUNNER_FILE)
}

/** Runner-owned log file (daemon/kill output, world-readable). */
export function getLinuxRunnerLogPath(dataDir: string): string {
  return path.join(dataDir, LINUX_RUNNER_LOG_FILE)
}

/**
 * Tail of the runner log (last ~40 lines). The runner runs as root but the
 * file stays world-readable, so failure diagnostics need no privileges and
 * no extra auth prompt — on any init system, not just systemd/journal.
 * Never throws (null when absent/unreadable, e.g. a stale pre-log runner).
 */
export function readRunnerLogTail(dataDir: string, maxLines = 40): string | null {
  try {
    const p = getLinuxRunnerLogPath(dataDir)
    const content = fs.readFileSync(p, 'utf8')
    const lines = content.split('\n')
    const tail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n').trim()
    return tail ? tail.slice(-4000) : null
  } catch {
    return null
  }
}

/** `pgrep -x nfqws` check (`-x`: exact process name — never matches wrappers). */
export async function isNfqwsRunning(): Promise<boolean> {
  try {
    const r = await execAsync('pgrep', ['-x', 'nfqws'], 8000)
    return r.code === 0 && r.stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Absolute path of the running nfqws (`/proc/<pid>/exe`), null when absent. */
export async function getNfqwsProcessPath(): Promise<string | null> {
  try {
    const r = await execAsync('pgrep', ['-n', '-x', 'nfqws'], 8000)
    const pid = (r.stdout ?? '').trim().split(/\s+/)[0]
    if (!pid || !/^\d+$/.test(pid)) return null
    try {
      return fs.readlinkSync(`/proc/${pid}/exe`)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

/** `ldd` "=> not found" entries parsed out. Pure — covered by unit tests. */
export function parseLddMissing(output: string): string[] {
  const missing: string[] = []
  for (const line of String(output ?? '').split('\n')) {
    const m = line.trim().match(/^(\S+)\s+=>\s+not found\b/)
    if (m?.[1] && !missing.includes(m[1])) missing.push(m[1])
  }
  return missing
}

export interface NfqwsDepsStatus {
  ok: boolean
  missing: string[]
}

/** `-rwxr-xr-x` style mode string. Pure. */
function formatMode(mode: number, isDir: boolean): string {
  const r = (b: number, c: string): string => ((mode & b) !== 0 ? c : '-')
  const x = (b: number, s: number, sc: string): string => {
    if ((mode & s) !== 0) return (mode & b) !== 0 ? sc.toLowerCase() : sc.toUpperCase()
    return (mode & b) !== 0 ? 'x' : '-'
  }
  return `${isDir ? 'd' : '-'}${r(0o400, 'r')}${r(0o200, 'w')}${x(0o100, 0o4000, 's')}${r(0o40, 'r')}${r(
    0o20,
    'w'
  )}${x(0o10, 0o2000, 's')}${r(0o4, 'r')}${r(0o2, 'w')}${x(0o1, 0o1000, 't')}`
}

export interface NfqwsBinaryInfo {
  modeText: string
  mode: number
  uid: number
  gid: number
  setuid: boolean
  setgid: boolean
}

/**
 * stat() the engine binary: owner/mode/setuid bits. The classic Fedora
 * trap is a setuid bit (restored from an archive in the root era) with a
 * bogus numeric owner: the runner starts as root, but nfqws then runs as
 * e.g. UID 2147483647 and cannot read its own lists (restart loop).
 * Never throws (null when missing/unstatable).
 */
export function describeNfqwsBinary(nfqwsPath: string): NfqwsBinaryInfo | null {
  try {
    if (!fs.existsSync(nfqwsPath)) return null
    const st = fs.statSync(nfqwsPath)
    const mode = st.mode & 0o7777
    return {
      modeText: formatMode(mode, st.isDirectory()),
      mode,
      uid: st.uid,
      gid: st.gid,
      setuid: (mode & 0o4000) !== 0,
      setgid: (mode & 0o2000) !== 0
    }
  } catch {
    return null
  }
}

export interface NfqwsLaunchCheck {
  ok: boolean
  /** Human problem list (empty when ok) — for errors and diagnostics detail. */
  list: string
  /** Fix hint (empty when ok). */
  hint: string
}

/**
 * Can the engine binary actually start: no setuid/setgid trap plus
 * resolvable shared libraries. Unprivileged, no prompts, never throws.
 * (A missing file is NOT our department — existence has better messages
 * at each call site — so it counts as ok here.)
 */
export async function checkNfqwsLaunchable(nfqwsPath: string): Promise<NfqwsLaunchCheck> {
  const problems: string[] = []
  const hints: string[] = []
  const info = describeNfqwsBinary(nfqwsPath)
  if (info && (info.setuid || info.setgid)) {
    const bits = [info.setuid && 'setuid', info.setgid && 'setgid'].filter(Boolean).join('/')
    problems.push(`binary has ${bits} bits set (${info.modeText}, owner ${info.uid}:${info.gid})`)
    hints.push(`re-download Linux dependencies (Updates page) or run: sudo chmod u-s,g-s ${nfqwsPath}`)
  }
  if (info) {
    const deps = await checkNfqwsDeps(nfqwsPath)
    if (!deps.ok) {
      problems.push(`missing shared libraries: ${deps.missing.join(', ')}`)
      hints.push(distroInstallHint())
    }
  }
  if (problems.length === 0) return { ok: true, list: '', hint: '' }
  return { ok: false, list: problems.join('; '), hint: [...new Set(hints)].join(' / ') }
}

/**
 * Whether the nfqws binary can actually load (shared libraries present).
 * `ldd` needs no privileges. Optimistic (ok) when ldd itself is unavailable
 * or the file is missing (existence is checked separately with better text).
 * Never throws.
 */
export async function checkNfqwsDeps(nfqwsPath: string): Promise<NfqwsDepsStatus> {
  try {
    if (!fs.existsSync(nfqwsPath)) return { ok: true, missing: [] }
    const r = await execAsync('ldd', [nfqwsPath], 10000)
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    if (/not a dynamic executable|statically linked/i.test(out)) return { ok: true, missing: [] }
    const missing = parseLddMissing(out)
    return { ok: missing.length === 0, missing }
  } catch {
    return { ok: true, missing: [] }
  }
}

/**
 * Install command for nfqws runtime libs per distro family. Pure
 * (injectable id/like — covered by unit tests).
 */
export function distroInstallHintFor(id: string, like: string): string {
  const hay = `${id} ${like}`.toLowerCase()
  const has = (...names: string[]): boolean => hay.split(/[\s,]+/).some((t) => names.includes(t))
  if (has('fedora', 'rhel', 'centos', 'rocky', 'alma', 'almalinux', 'oracle', 'nobara')) {
    return 'sudo dnf install libnetfilter_queue libnfnetlink libmnl'
  }
  if (has('debian', 'ubuntu', 'linuxmint', 'mint', 'pop', 'kali', 'raspbian')) {
    return 'sudo apt install libnetfilter-queue1 libnfnetlink0 libmnl0'
  }
  if (has('arch', 'manjaro', 'endeavouros', 'cachyos', 'garuda')) {
    return 'sudo pacman -S libnetfilter_queue libnfnetlink libmnl'
  }
  if (has('opensuse', 'sles', 'sled')) {
    return 'sudo zypper install libnetfilter_queue1 libnfnetlink0 libmnl0'
  }
  if (has('alpine', 'postmarketos')) return 'sudo apk add libnetfilter_queue libnfnetlink libmnl'
  if (has('void')) return 'sudo xbps-install -S libnetfilter_queue libnfnetlink libmnl'
  if (has('gentoo')) return 'sudo emerge net-libs/libnetfilter_queue net-libs/libnfnetlink net-libs/libmnl'
  return 'install libnetfilter_queue (+ libnfnetlink, libmnl) from your distro repositories'
}

/** Install command for nfqws runtime libs, detected from /etc/os-release. */
export function distroInstallHint(): string {
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf8')
    const get = (k: string): string => {
      const m = text.match(new RegExp(`^${k}=(.*)$`, 'm'))
      return (m?.[1] ?? '').trim().replace(/^"|"$/g, '')
    }
    return distroInstallHintFor(get('ID'), get('ID_LIKE'))
  } catch {
    return distroInstallHintFor('', '')
  }
}

/**
 * Absolute file paths referenced by nfqws argv (`--key=/path.ext` and
 * `--key /path.ext` forms). Only list/binary-ish extensions — numbers,
 * IPs and keywords are skipped. Pure — covered by unit tests.
 */
export function extractNfqwsFileRefs(argv: string[]): string[] {
  const out: string[] = []
  const push = (v: string): void => {
    const clean = String(v ?? '').trim().replace(/^"|"$/g, '')
    if (/^\/[^*?]*\.(txt|bin|dat|hosts|list)$/i.test(clean) && !out.includes(clean)) out.push(clean)
  }
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] ?? '')
    const eq = tok.match(/^--[A-Za-z0-9_-]+=(.+)$/)
    if (eq?.[1]) {
      push(eq[1])
      continue
    }
    if (/^--[A-Za-z0-9_-]+$/.test(tok) && i + 1 < argv.length) push(argv[i + 1] as string)
  }
  return out
}

/** Subset of paths that do not exist on disk. Never throws. */
export function missingFiles(paths: string[]): string[] {
  return paths.filter((p) => {
    try {
      return !fs.existsSync(p)
    } catch {
      return true
    }
  })
}

const STALE_PKFILL_PATTERN = 'pkill -f nfqws'

/**
 * One-time migration of a stale generated runner: `pkill -f nfqws` matches
 * our own `pkexec bash -c '...nfqws...'` wrapper cmdline, so a looping
 * service assassinates our batches (vanishing password prompts). The runner
 * is user-writable — no privileges needed. Returns true when patched.
 * Never throws.
 */
export function migrateStaleRunner(dataDir: string): boolean {
  try {
    const p = getLinuxRunnerPath(dataDir)
    if (!fs.existsSync(p)) return false
    const content = fs.readFileSync(p, 'utf8')
    if (!content.includes('Generated by Zapret GUI')) return false
    if (!content.includes(STALE_PKFILL_PATTERN)) return false
    fs.writeFileSync(p, content.split(STALE_PKFILL_PATTERN).join('pkill -x nfqws'), 'utf8')
    try {
      fs.chmodSync(p, 0o755)
    } catch {
      /* keep existing mode */
    }
    return true
  } catch {
    return false
  }
}

/** Best-effort `pkill -x nfqws` as a batch step (joins the operation batch — no extra prompt). Pure. */
function pkillStep(): BatchStep {
  // `-x` (exact process name): unlike `-f`, it can never match our own
  // `pkexec bash -c '...nfqws...'` wrapper and suicide the batch.
  return { kind: 'exec', file: 'pkill', args: ['-x', 'nfqws'], ignoreFailure: true }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * Collect `systemctl status` + journal tail for a failed unit (one batch,
 * silent with NOPASSWD; the caller only invokes this when reads are free).
 * Never throws — returns '' when nothing could be collected.
 */
async function collectUnitFailureContext(serviceName: string): Promise<string> {
  try {
    const safe = String(serviceName).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'zapret_discord_youtube'
    const steps: BatchStep[] = [
      { kind: 'exec', file: 'systemctl', args: ['status', safe, '--no-pager'], ignoreFailure: true }
    ]
    try {
      const j = await execAsync('sh', ['-c', 'command -v journalctl'], 5000)
      if (j.code === 0) {
        steps.push({ kind: 'exec', file: 'journalctl', args: ['--no-pager', '-n', '40', '-u', safe], ignoreFailure: true })
      }
    } catch {
      /* journal unavailable (non-systemd loggers) */
    }
    const r = await runBatch(steps, { timeoutMs: 30000 })
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim()
    return out ? `\n--- systemctl status + journal ---\n${out.slice(0, 2000)}` : ''
  } catch {
    return ''
  }
}

/**
 * Verify a start/install actually worked: unit active (when known), nfqws
 * alive (polled — the daemon fork takes a moment under load), firewall
 * rules present *when readable without a prompt* (root/NOPASSWD; an
 * unprivileged `nft list` fails and must not count as "absent").
 * Throws a detailed error (with unit forensics + journal when available)
 * instead of leaving a green "RUNNING" service with dead workers.
 */
async function verifyLinuxRunning(
  dataDir: string,
  init: InitSystem,
  backend: FirewallBackendResolved | null,
  onLog?: (t: string) => void
): Promise<void> {
  void dataDir
  // Baseline for restart-loop detection (unprivileged reads).
  const d0 = init === 'systemd' ? await getSystemdDetails().catch(() => null) : null
  let alive = await isNfqwsRunning()
  for (let i = 0; !alive && i < 11; i++) {
    await sleepMs(500)
    alive = await isNfqwsRunning()
  }
  const sampleUnit = async (): Promise<{ state: ServiceState; details: SystemdDetails | null }> => {
    let state: ServiceState = 'UNKNOWN'
    if (init !== 'unknown') {
      try {
        state = await queryLinuxServiceState(init)
      } catch {
        state = 'UNKNOWN'
      }
    }
    const details = init === 'systemd' ? await getSystemdDetails().catch(() => null) : null
    return { state, details }
  }
  let { state: unitState, details } = await sampleUnit()
  // Transient start/stop windows are not verdicts — resample before failing.
  for (let i = 0; (unitState === 'START_PENDING' || unitState === 'STOP_PENDING') && i < 2; i++) {
    await sleepMs(1500)
    ;({ state: unitState, details } = await sampleUnit())
  }
  // Firewall reads need privileges; without them the check would lie.
  let fwOk: boolean | null = null
  const canReadFw = isRoot() || (await canElevateWithoutPassword().catch(() => false))
  if (canReadFw && backend) {
    try {
      fwOk = await isFirewallActive(backend)
    } catch {
      fwOk = null
    }
  }
  const serviceOk = init === 'unknown' ? alive : unitState === 'RUNNING'
  if (serviceOk && alive && fwOk !== false) return
  const parts: string[] = []
  if (!serviceOk) parts.push(`service state is ${unitState}`)
  if (!alive) parts.push('nfqws process is not running')
  if (fwOk === false) parts.push(`no ${backend} firewall rules detected`)
  // Forensics need no privileges: exact SubState, restart counter delta and
  // the stuck main process cmdline tell a stuck start job apart from a
  // restart loop.
  const forensics: string[] = []
  if (details) {
    const sub = details.subState ? `${details.activeState}/${details.subState}` : details.activeState
    let line = `systemd: ${sub || unitState}`
    if (details.result && details.result !== 'success') line += ` (result: ${details.result})`
    forensics.push(line)
    if (d0 && details.nRestarts !== d0.nRestarts) {
      forensics.push(
        `service restarted ${d0.nRestarts}→${details.nRestarts} times during the check — the runner exits right after start, see the journal: journalctl -u ${LINUX_SERVICE_NAME} -n 50`
      )
    } else if (details.subState === 'start' || unitState === 'START_PENDING') {
      forensics.push(
        `start job is stuck (MainPID=${details.mainPid || 'none'}) — often a hung After= dependency; check: systemctl status ${LINUX_SERVICE_NAME}`
      )
    }
    if (details.mainPid > 0) {
      const cmd = readProcCmdline(details.mainPid)
      if (cmd) forensics.push(`main process: ${cmd}`)
    }
  }
  onLog?.(`Start verification failed: ${parts.join('; ')}. Collecting service logs...`)
  let ctx = ''
  if (init !== 'unknown' && (isRoot() || (await canElevateWithoutPassword().catch(() => false)))) {
    ctx = await collectUnitFailureContext(LINUX_SERVICE_NAME)
  }
  // Runner log tail needs no privileges at all (world-readable file).
  const runLog = readRunnerLogTail(dataDir)
  const runLogText =
    runLog !== null
      ? `\n--- zapret-linux-run.log tail ---\n${runLog}`
      : '\n(runner log not found — apply the strategy again to refresh zapret-linux-run.sh)'
  const forensicsText = forensics.length > 0 ? `\n--- diagnosis ---\n${forensics.join('\n').slice(0, 1200)}` : ''
  throw new Error(`Zapret did not start properly (${parts.join('; ')})${forensicsText}${runLogText}${ctx}`)
}

/** `/proc/<pid>/cmdline` as a readable string (world-readable). Never throws. */
function readProcCmdline(pid: number): string | null {
  try {
    if (!Number.isInteger(pid) || pid <= 0) return null
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
    return raw ? raw.slice(0, 300) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Network interfaces (`any` + /sys/class/net)
// ---------------------------------------------------------------------------

/** List interfaces for the GUI selector (`any` first). Never throws. */
export async function listNetworkInterfaces(): Promise<string[]> {
  const set = new Set<string>(['any'])
  try {
    for (const name of fs.readdirSync('/sys/class/net')) {
      if (/^[A-Za-z0-9._-]+$/.test(name)) set.add(name)
    }
  } catch {
    /* fall back to os.networkInterfaces */
  }
  try {
    for (const name of Object.keys(os.networkInterfaces() ?? {})) {
      if (/^[A-Za-z0-9._-]+$/.test(name)) set.add(name)
    }
  } catch {
    /* ignore */
  }
  const rest = [...set].filter((s) => s !== 'any').sort()
  return ['any', ...rest]
}

// ---------------------------------------------------------------------------
// Runner script (`zapret-linux-run.sh daemon|kill`)
// ---------------------------------------------------------------------------

/**
 * Generate the runner script. It re-resolves strategy args via the stored
 * JSON configs? No — the GUI bakes the *current* strategy argv into the
 * runner at install time (plus conf.env for transparency), so the service
 * keeps working even if the user later edits strategies.
 */
export function buildRunnerScript(opts: {
  nfqwsPath: string
  binDir: string
  listsDir: string
  tcpPorts: string
  udpPorts: string
  interface: string
  firewallBackend: FirewallBackendResolved
  nfqwsArgv: string[]
  /** Absolute path of the runner-owned log file (daemon/kill output). */
  logPath: string
}): string {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  const argv = opts.nfqwsArgv.map(q).join(' ')
  return [
    '#!/usr/bin/env bash',
    '# Generated by Zapret GUI — do not edit manually (recreated on strategy apply).',
    'set -u',
    `NFQWS=${q(opts.nfqwsPath)}`,
    `TCP_PORTS=${q(opts.tcpPorts)}`,
    `UDP_PORTS=${q(opts.udpPorts)}`,
    `IFACE=${q(opts.interface)}`,
    `BACKEND=${q(opts.firewallBackend)}`,
    `RUN_LOG=${q(opts.logPath)}`,
    '',
    'elevate() {',
    '  if [ "$(id -u)" -eq 0 ]; then "$@"; return $?; fi',
    '  if command -v sudo >/dev/null 2>&1; then sudo "$@"; return $?; fi',
    '  if command -v doas >/dev/null 2>&1; then doas "$@"; return $?; fi',
    '  "$@";',
    '}',
    '',
    '# Mirror stdout/stderr into the runner log (readable by the app without',
    '# root, on every init system). Falls back to /dev/null when unwritable.',
    'log_start() {',
    '  if [ "${1:-}" = truncate ]; then : > "$RUN_LOG" 2>/dev/null || RUN_LOG=/dev/null; fi',
    '  exec >>"$RUN_LOG" 2>&1 || exit 1',
    '  echo "zapret-linux-run: $1 at $(date -u +%FT%TZ) (uid=$(id -u))"',
    '}',
    '',
    'nft_setup() {',
    '  local table="inet zapretunix"',
    '  if elevate nft list tables 2>/dev/null | grep -q "$table"; then',
    '    elevate nft flush chain $table post 2>/dev/null || true',
    '    elevate nft delete chain $table post 2>/dev/null || true',
    '    elevate nft flush chain $table pre 2>/dev/null || true',
    '    elevate nft delete chain $table pre 2>/dev/null || true',
    '    elevate nft delete table $table 2>/dev/null || true',
    '  fi',
    '  elevate nft add table $table',
    '  elevate nft add chain $table post "{ type filter hook postrouting priority mangle; }"',
    '  elevate nft add chain $table pre "{ type filter hook prerouting priority filter; }"',
    '  local oif="" iif=""',
    '  if [ -n "$IFACE" ] && [ "$IFACE" != "any" ]; then oif="oifname \\"$IFACE\\""; iif="iifname \\"$IFACE\\""; fi',
    // eslint-disable-next-line no-template-curly-in-string
    '  # shellcheck disable=SC2086',
    '  # TCP/UDP dports may be comma lists like 80,443,1024-65535',
    '  elevate nft add rule $table post $oif meta mark and 0x40000000 == 0 tcp dport "{$TCP_PORTS}" ct original packets 1-6 queue num 220 bypass comment "\\"Added by zapret script\\""',
    '  elevate nft add rule $table post $oif meta mark and 0x40000000 == 0 udp dport "{$UDP_PORTS}" ct original packets 1-6 queue num 220 bypass comment "\\"Added by zapret script\\""',
    '  elevate nft add rule $table pre $iif tcp sport "{$TCP_PORTS}" ct reply packets 1-3 queue num 220 bypass comment "\\"Added by zapret script\\""',
    '}',
    '',
    'nft_clear() {',
    '  local table="inet zapretunix"',
    '  if elevate nft list tables 2>/dev/null | grep -q "$table"; then',
    '    elevate nft flush chain $table post 2>/dev/null || true',
    '    elevate nft delete chain $table post 2>/dev/null || true',
    '    elevate nft flush chain $table pre 2>/dev/null || true',
    '    elevate nft delete chain $table pre 2>/dev/null || true',
    '    elevate nft delete table $table 2>/dev/null || true',
    '  fi',
    '}',
    '',
    'ipt_setup() {',
    '  for cmd in iptables ip6tables; do',
    '    elevate "$cmd" -t mangle -D POSTROUTING -j zapret 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -F zapret 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -X zapret 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -D PREROUTING -j reply 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -F reply 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -X reply 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -N zapret',
    '    elevate "$cmd" -t mangle -A POSTROUTING -j zapret',
    '    elevate "$cmd" -t mangle -A zapret -p tcp -m multiport --dports "$TCP_PORTS" -m connbytes --connbytes-dir=original --connbytes-mode=packets --connbytes 1:6 -m mark ! --mark 0x40000000 -j NFQUEUE --queue-num 220 --queue-bypass',
    '    elevate "$cmd" -t mangle -A zapret -p udp -m multiport --dports "$UDP_PORTS" -m connbytes --connbytes-dir=original --connbytes-mode=packets --connbytes 1:6 -m mark ! --mark 0x40000000 -j NFQUEUE --queue-num 220 --queue-bypass',
    '    elevate "$cmd" -t mangle -N reply',
    '    elevate "$cmd" -t mangle -A PREROUTING -j reply',
    '    elevate "$cmd" -t mangle -A reply -p tcp -m multiport --sports "$TCP_PORTS" -m connbytes --connbytes-dir=reply --connbytes-mode=packets --connbytes 1:3 -m mark ! --mark 0x40000000 -j NFQUEUE --queue-num 220 --queue-bypass',
    '  done',
    '}',
    '',
    'ipt_clear() {',
    '  for cmd in iptables ip6tables; do',
    '    elevate "$cmd" -t mangle -D POSTROUTING -j zapret 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -F zapret 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -X zapret 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -D PREROUTING -j reply 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -F reply 2>/dev/null || true',
    '    elevate "$cmd" -t mangle -X reply 2>/dev/null || true',
    '  done',
    '}',
    '',
    'fw_setup() { if [ "$BACKEND" = "iptables" ]; then ipt_setup; else nft_setup; fi; }',
    'fw_clear() { if [ "$BACKEND" = "iptables" ]; then ipt_clear; else nft_clear; fi; }',
    '',
    'case "${1:-daemon}" in',
    '  daemon)',
    '    log_start truncate',
    '    elevate pkill -x nfqws 2>/dev/null || true',
    '    fw_clear || true',
    '    sleep 1',
    '    fw_setup || echo "zapret-linux-run: firewall setup FAILED (see nft/iptables errors above)" >&2',
    `    cd ${q(opts.binDir)}`,
    `    elevate "$NFQWS" ${argv} || echo "zapret-linux-run: nfqws failed to start (code $?) — check the strategy args" >&2`,
    '    ;;',
    '  kill)',
    '    log_start kill',
    '    elevate pkill -x nfqws 2>/dev/null || true',
    '    fw_clear || true',
    '    ;;',
    'esac',
    ''
  ].join('\n')
}

function writeRunner(dataDir: string, content: string): string {
  const p = getLinuxRunnerPath(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(p, content, { mode: 0o755 })
  try {
    fs.chmodSync(p, 0o755)
  } catch {
    /* ignore */
  }
  return p
}

/**
 * Whether a generated runner is fresh: has the runner-owned log *and* a
 * working `--uid`/`--user` pin. Runners generated before the droproot fixes
 * either lack the pin (nfqws drops to UID 2147483647) or pin root
 * (`--uid=0:0` — still `EACCES`: `dropcaps()` strips `CAP_DAC_OVERRIDE`, so
 * even uid 0 cannot traverse a `700` home dir). Both fail with
 * `cannot access hostlist file ... Permission denied` on lists under
 * `$HOME`. Pure — unit tested.
 */
export function isRunnerFresh(content: string): boolean {
  if (!content.includes('RUN_LOG=')) return false
  const pins = [...content.matchAll(/--(user|uid)[=\s]+([^\s'"]+)/g)]
  if (pins.length === 0) return false
  // A root pin cannot read $HOME lists (no CAP_DAC_OVERRIDE after dropcaps).
  return pins.some((m) => {
    const kind = m[1]
    const val = m[2] ?? ''
    if (kind === 'uid') {
      const uid = val.split(':')[0] ?? ''
      return uid !== '' && uid !== '0'
    }
    return val !== '' && val !== 'root'
  })
}

/**
 * Rebuild the runner from the stored conf.env + strategy JSON (same derivation
 * as installLinuxStrategy, but without touching the service). Used by the
 * start self-heal so a stale runner (pre-logging template, old args) is
 * refreshed without forcing the user through a full Apply. Returns the
 * runner path, or null when it cannot be derived (then Apply is required).
 * Never throws.
 */
export async function rebuildRunnerFromConf(dataDir: string): Promise<string | null> {
  try {
    const conf = loadLinuxConf(dataDir)
    if (!conf?.strategy) return null
    const nfqwsPath = getLinuxNfqwsPath(dataDir)
    if (!fs.existsSync(nfqwsPath)) return null
    const stratDir = path.join(dataDir, 'strategies')
    let files: string[] = []
    try {
      files = fs.readdirSync(stratDir).filter((f) => f.toLowerCase().endsWith('.json'))
    } catch {
      return null
    }
    let match: Strategy | null = null
    for (const f of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(stratDir, f), 'utf8')) as Partial<Strategy>
        if (
          typeof s.fileName === 'string' &&
          typeof s.id === 'string' &&
          Array.isArray(s.args) &&
          (s.fileName === conf.strategy || s.name === conf.strategy || `${s.id}.bat` === conf.strategy)
        ) {
          match = s as Strategy
          break
        }
      } catch {
        /* skip broken file */
      }
    }
    if (!match) return null
    const binDir = getLinuxBinDir(dataDir)
    const listsDir = path.join(dataDir, 'lists')
    const parsed = parseStrategyArgsForLinux(match.args, {
      useGameFilterTcp: conf.gamefiltertcp,
      useGameFilterUdp: conf.gamefilterudp,
      binDir,
      listsDir
    })
    const backend = await detectFirewallBackend(conf.firewall_backend ?? 'auto')
    const nfqwsArgv = buildNfqwsArgv(parsed, { binDir, listsDir, daemon: true, runUid: resolveDataOwnerUid(dataDir) })
    return writeRunner(
      dataDir,
      buildRunnerScript({
        nfqwsPath,
        binDir,
        listsDir,
        tcpPorts: parsed.tcpPorts,
        udpPorts: parsed.udpPorts,
        interface: conf.interface,
        firewallBackend: backend,
        nfqwsArgv,
        logPath: getLinuxRunnerLogPath(dataDir)
      })
    )
  } catch {
    return null
  }
}

/**
 * Rebuild a stale on-disk runner when possible (user-writable, no prompt).
 * Returns true when the runner is fresh afterwards. Never throws.
 */
async function healStaleRunner(dataDir: string, runnerPath: string, onLog?: (t: string) => void): Promise<boolean> {
  let fresh = false
  try {
    fresh = isRunnerFresh(fs.readFileSync(runnerPath, 'utf8'))
  } catch {
    fresh = false
  }
  if (fresh) return true
  if (!fs.existsSync(runnerPath)) return false
  onLog?.('Runner is outdated, rebuilding from the stored strategy...')
  const rebuilt = await rebuildRunnerFromConf(dataDir).catch(() => null)
  if (!rebuilt) {
    onLog?.('Could not rebuild the runner — continuing with the stored one (consider applying the strategy again).')
    return false
  }
  try {
    if (!isRunnerFresh(fs.readFileSync(rebuilt, 'utf8'))) {
      // Rebuild kept a root pin — only possible when the custom strategy
      // itself forces `--user=root`/`--uid=0`: nfqws then runs cap-stripped
      // and cannot read lists under a 700 $HOME. Tell the user plainly.
      onLog?.(
        'Strategy forces nfqws to run as root, which cannot read lists under your home directory ' +
          '(missing CAP_DAC_OVERRIDE after privilege drop). Remove --user/--uid from the custom strategy and apply again.'
      )
      return false
    }
  } catch {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Decide ownership: `ours` when the running nfqws (or conf strategy) points
 * into our own `data/bin`, `foreign` when it runs from elsewhere, `none`
 * when nothing is installed/running. Pure helper.
 */
export function detectLinuxOwnership(
  serviceState: ServiceState,
  nfqwsRunning: boolean,
  nfqwsPath: string | null,
  ownBinDir: string
): 'ours' | 'foreign' | 'none' | 'unknown' {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (serviceState === 'NOT_INSTALLED' && !nfqwsRunning) return 'none'
  if (nfqwsPath) {
    const dir = norm(path.dirname(nfqwsPath))
    const own = norm(ownBinDir)
    if (dir === own || dir.startsWith(`${own}/`)) return 'ours'
    return 'foreign'
  }
  if (serviceState !== 'NOT_INSTALLED') return 'ours'
  return 'unknown'
}

/** Full Linux status snapshot (service + nfqws + conf + firewall). */
export async function getLinuxStatus(dataDir: string): Promise<{ snapshot: StatusSnapshot; extra: LinuxStatusExtra }> {
  // The app itself runs as the user; `isAdmin` means "privileged operations
  // are available" (root or per-call elevation via sudo/doas/pkexec).
  const root = isRoot()
  let elevateCmd = 'none'
  try {
    const cmd = detectElevateCmd()
    elevateCmd = cmd === '' ? 'root' : cmd
  } catch {
    elevateCmd = 'none'
  }
  const nopass = root || (await canElevatePasswordless())
  const admin = root || (elevateCmd !== 'none' && checkElevateAvailable())
  const init = await detectInitSystem().catch(() => 'unknown' as InitSystem)
  const conf = loadLinuxConf(dataDir)
  const requested: FirewallBackend = conf?.firewall_backend ?? 'auto'
  let resolved: FirewallBackendResolved | null = null
  try {
    resolved = await detectFirewallBackend(requested)
  } catch {
    resolved = null
  }
  let serviceState: ServiceState = 'NOT_INSTALLED'
  try {
    serviceState = init === 'unknown' ? 'NOT_INSTALLED' : await queryLinuxServiceState(init)
  } catch {
    serviceState = 'UNKNOWN'
  }
  const nfqwsRunning = await isNfqwsRunning()
  const nfqwsProcPath = nfqwsRunning ? await getNfqwsProcessPath() : null
  const ownBinDir = getLinuxBinDir(dataDir)
  const nfqwsDiskPath = fs.existsSync(getLinuxNfqwsPath(dataDir)) ? getLinuxNfqwsPath(dataDir) : null

  // Effective zapret state: prefer the init service when installed,
  // otherwise reflect the daemon directly (foreground runs).
  // A partial conf (preferences saved before the first Apply, empty
  // strategy) still counts as NOT_INSTALLED — nothing runs yet.
  let zapret: ServiceState = serviceState
  if (serviceState === 'NOT_INSTALLED') {
    zapret = nfqwsRunning ? 'RUNNING' : conf?.strategy ? 'STOPPED' : 'NOT_INSTALLED'
  }
  const ownership = detectLinuxOwnership(serviceState, nfqwsRunning, nfqwsProcPath ?? nfqwsDiskPath, ownBinDir)
  const firewallActive = resolved ? await isFirewallActive(resolved).catch(() => false) : false

  const snapshot: StatusSnapshot = {
    zapret,
    windivert: resolved ? (firewallActive ? 'RUNNING' : 'STOPPED') : 'NOT_INSTALLED',
    winwsRunning: nfqwsRunning,
    activeStrategy: conf?.strategy || null,
    serviceBinPath: nfqwsDiskPath,
    winwsPath: nfqwsProcPath,
    ownership,
    isAdmin: admin,
    isRoot: root,
    elevateCmd,
    nopass,
    platform: 'linux',
    initSystem: init,
    firewallBackend: requested,
    firewallResolved: resolved,
    linuxInterface: conf?.interface ?? ANY_INTERFACE,
    linuxNfqws: nfqwsDiskPath
  }
  const extra: LinuxStatusExtra = {
    initSystem: init,
    firewallBackend: requested,
    firewallResolved: resolved,
    firewallActive,
    interface: conf?.interface ?? ANY_INTERFACE,
    nfqwsPath: nfqwsDiskPath,
    nfqwsRunning,
    confExists: conf !== null
  }
  return { snapshot, extra }
}

async function canElevatePasswordless(): Promise<boolean> {
  try {
    const cmd = detectElevateCmd()
    if (cmd === '') return true
    if (cmd === 'sudo') {
      const r = await execAsync('sudo', ['-n', 'true'], 8000)
      return r.code === 0
    }
    return false
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Apply / start / stop / remove
// ---------------------------------------------------------------------------

export interface LinuxApplyOptions {
  interface?: string
  firewallBackend?: FirewallBackend
  installService?: boolean
}

/**
 * Install a strategy on Linux: parse args → firewall ports + nfqws argv →
 * write `conf.env` + runner → (one batch:) stop previous + clear firewall +
 * setup firewall + nfqws --daemon + init service. The whole privileged part
 * is a single auth prompt (pkexec) or silent (NOPASSWD).
 */
export async function installLinuxStrategy(
  strategy: Strategy,
  dataDir: string,
  opts: LinuxApplyOptions = {},
  onLog?: (t: string) => void
): Promise<void> {
  const say = (t: string): void => onLog?.(t)
  const binDir = getLinuxBinDir(dataDir)
  const listsDir = path.join(dataDir, 'lists')
  const nfqwsPath = getLinuxNfqwsPath(dataDir)
  if (!fs.existsSync(nfqwsPath)) {
    throw new Error(
      `nfqws not found in ${binDir}. Open Updates → "Download Linux dependencies" (or run download-deps) first.`
    )
  }
  // Fail fast (no prompts spent): an unloadable binary (missing shared
  // libraries, setuid trap, ...) would only die in a restart loop later.
  const deps = await checkNfqwsLaunchable(nfqwsPath)
  if (!deps.ok) {
    throw new Error(`nfqws cannot start — ${deps.list}. ${deps.hint}`)
  }
  const prev = loadLinuxConf(dataDir)
  // First Apply with no conf yet: honor a game filter picked beforehand
  // (its setter only writes the flag file when no conf exists).
  let flagTcp = false
  let flagUdp = false
  if (!prev) {
    try {
      const { getGameFilterMode } = await import('../service-manager')
      const mode = getGameFilterMode(dataDir)
      flagTcp = mode === 'all' || mode === 'tcp'
      flagUdp = mode === 'all' || mode === 'udp'
    } catch {
      /* flag file unreadable — defaults stand */
    }
  }
  const conf: LinuxConf = {
    interface: opts.interface ?? prev?.interface ?? ANY_INTERFACE,
    gamefiltertcp: prev?.gamefiltertcp ?? flagTcp,
    gamefilterudp: prev?.gamefilterudp ?? flagUdp,
    strategy: strategy.fileName?.toLowerCase().endsWith('.bat') ? strategy.fileName : `${strategy.id}.bat`,
    firewall_backend: opts.firewallBackend ?? prev?.firewall_backend ?? 'auto'
  }
  let parsed
  try {
    parsed = parseStrategyArgsForLinux(strategy.args, {
      useGameFilterTcp: conf.gamefiltertcp,
      useGameFilterUdp: conf.gamefilterudp,
      binDir,
      listsDir
    })
  } catch (e) {
    throw new Error(`Strategy "${strategy.name}" has no Linux firewall ports (--wf-tcp/--wf-udp): ${(e as Error).message}`)
  }
  const backend = await detectFirewallBackend(conf.firewall_backend)
  say(`Firewall backend: ${backend} (requested: ${conf.firewall_backend})`)
  const nfqwsArgv = buildNfqwsArgv(parsed, { binDir, listsDir, daemon: true, runUid: resolveDataOwnerUid(dataDir) })
  // Fail fast (zero prompts): a strategy pointing at missing list/fake
  // files would only die inside the daemon with a truncated log.
  const missingRefs = missingFiles(extractNfqwsFileRefs(nfqwsArgv))
  if (missingRefs.length > 0) {
    throw new Error(
      `Strategy references missing files:\n${missingRefs.join('\n')}\nUpdate the lists or re-download the dependencies, then retry.`
    )
  }

  saveLinuxConf(dataDir, conf)
  say(`Configuration saved to conf.env (strategy=${conf.strategy}, iface=${conf.interface})`)
  const runner = writeRunner(
    dataDir,
    buildRunnerScript({
      nfqwsPath,
      binDir,
      listsDir,
      tcpPorts: parsed.tcpPorts,
      udpPorts: parsed.udpPorts,
      interface: conf.interface,
      firewallBackend: backend,
      nfqwsArgv,
      logPath: getLinuxRunnerLogPath(dataDir)
    })
  )
  say(`Runner written: ${runner}`)

  // One batch for everything privileged: stop previous + clear stale rules
  // of every backend + set up the chosen backend + start nfqws (+ install
  // the init service). Exactly one auth prompt.
  const steps: BatchStep[] = [pkillStep()]
  try {
    const avail = await listAvailableBackends()
    for (const b of avail) steps.push(...buildFirewallClearSteps(b))
  } catch {
    /* ignore */
  }
  say(`Setting up ${backend} (TCP: ${parsed.tcpPorts}, UDP: ${parsed.udpPorts}, iface: ${conf.interface}) ...`)
  steps.push(...buildFirewallSetupSteps(backend, { tcp: parsed.tcpPorts, udp: parsed.udpPorts, interface: conf.interface }))
  const nfqwsIdx = steps.length
  steps.push({ kind: 'exec', file: nfqwsPath, args: nfqwsArgv, label: 'nfqws --daemon' })
  let installFromIdx = -1
  let init: InitSystem = 'unknown'
  if (opts.installService !== false) {
    init = await detectInitSystem().catch(() => 'unknown' as InitSystem)
    if (init === 'unknown') {
      say('No supported init system detected — running without autostart service.')
    } else {
      say(`Installing ${init} service (${LINUX_SERVICE_NAME}) for autostart...`)
      installFromIdx = steps.length
      steps.push(...buildInstallSteps(init, { runnerPath: runner, workDir: dataDir }))
    }
  } else {
    say('Foreground install (no init service requested).')
  }

  say('Starting nfqws --daemon ...')
  const r = await runBatch(steps, { timeoutMs: 180000, onLog: say })
  if (r.code !== 0) {
    if (r.failedStep !== null && r.failedStep === nfqwsIdx) {
      throw new Error(`nfqws failed to start: ${batchOut(r)}`)
    }
    if (r.failedStep !== null && installFromIdx >= 0 && r.failedStep >= installFromIdx) {
      throw new Error(`Service install failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
    }
    throw new Error(`Firewall setup failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
  }
  // The batch succeeding only means the commands exited 0 — verify the
  // daemon actually survived and the service is up.
  await verifyLinuxRunning(dataDir, init, backend, say)
  say(`Strategy "${strategy.name}" installed and started.`)
}

/** Start the init service (or foreground daemon when no init). Single auth prompt. */
export async function startLinuxService(dataDir: string, onLog?: (t: string) => void): Promise<void> {
  const init = await detectInitSystem().catch(() => 'unknown' as InitSystem)
  // Fail fast (zero prompts): a missing binary or unloadable shared
  // libraries would otherwise only die in a restart loop after start.
  const nfqwsPath = getLinuxNfqwsPath(dataDir)
  if (!fs.existsSync(nfqwsPath)) {
    throw new Error(`nfqws not found in ${getLinuxBinDir(dataDir)} — download Linux dependencies or apply a strategy first`)
  }
  const startDeps = await checkNfqwsLaunchable(nfqwsPath)
  if (!startDeps.ok) {
    throw new Error(`nfqws cannot start — ${startDeps.list}. ${startDeps.hint}`)
  }
  if (init === 'unknown') {
    // No init: re-run the stored runner daemon directly (one batch).
    const runner = getLinuxRunnerPath(dataDir)
    if (!fs.existsSync(runner)) throw new Error('No runner found — apply a strategy first')
    await healStaleRunner(dataDir, runner, onLog)
    const r = await runBatch([{ kind: 'exec', file: 'bash', args: [runner, 'daemon'] }], { timeoutMs: 60000, onLog })
    if (r.code !== 0) throw new Error(`Start failed: ${batchOut(r)}`)
    let noInitBackend: FirewallBackendResolved | null = null
    try {
      const conf = loadLinuxConf(dataDir)
      noInitBackend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto')
    } catch {
      noInitBackend = null
    }
    await verifyLinuxRunning(dataDir, init, noInitBackend, onLog)
    onLog?.('nfqws daemon started (no init system).')
    return
  }
  // Self-heal: the unit can be absent while conf/runner exist (service
  // removed externally, or a previous install that failed after nfqws had
  // started). Reinstall from the stored runner instead of failing with
  // `Unit ... not found` — all in the same batch (one prompt).
  const steps: BatchStep[] = []
  let unitState: ServiceState = 'UNKNOWN'
  try {
    unitState = await queryLinuxServiceState(init)
  } catch {
    unitState = 'UNKNOWN'
  }
  const runner = getLinuxRunnerPath(dataDir)
  // Stale-runner heal runs on EVERY start (not only when the unit is
  // missing): runners generated before the stay-root fix lack `--uid` and
  // fail with `UID=2147483647 ... cannot access hostlist file` even though
  // the unit itself is fine. Rebuilding is user-writable, needs no prompt.
  await healStaleRunner(dataDir, runner, onLog)
  let needReinstall = unitState === 'NOT_INSTALLED'
  // Stale-unit migration (systemd): an existing unit whose content differs
  // from what the current app generates (old After=, old paths, ...) is
  // rewritten — otherwise a broken unit would linger forever and every
  // start would fail the same way. Unit files are world-readable.
  if (!needReinstall && init === 'systemd' && fs.existsSync(runner)) {
    try {
      const dest = `/etc/systemd/system/${LINUX_SERVICE_NAME}.service`
      const onDisk = fs.readFileSync(dest, 'utf8')
      const expected = buildSystemdUnit({ runnerPath: runner, workDir: dataDir })
      if (onDisk !== expected) {
        onLog?.('Service unit differs from the generated one, reinstalling...')
        needReinstall = true
      }
    } catch {
      /* unreadable — proceed with a plain start */
    }
  }
  if (needReinstall) {
    if (!fs.existsSync(runner)) {
      throw new Error('Service is not installed — apply a strategy on the Strategies tab first')
    }
    // Runner was already healed above; this second check only covers the
    // narrow reinstall path for extra safety (kept for clarity).
    let runnerFresh = false
    try {
      runnerFresh = isRunnerFresh(fs.readFileSync(runner, 'utf8'))
    } catch {
      runnerFresh = false
    }
    if (!runnerFresh) {
      onLog?.('Runner is outdated, rebuilding from the stored strategy...')
      const rebuilt = await rebuildRunnerFromConf(dataDir).catch(() => null)
      if (!rebuilt) {
        onLog?.('Could not rebuild the runner — continuing with the stored one (consider applying the strategy again).')
      }
    }
    if (unitState === 'NOT_INSTALLED') {
      onLog?.(`Service unit is missing, reinstalling ${init} service (${LINUX_SERVICE_NAME})...`)
    }
    steps.push(...buildInstallSteps(init, { runnerPath: runner, workDir: dataDir }))
  }
  steps.push(...buildStartSteps(init))
  const r = await runBatch(steps, { timeoutMs: 120000, onLog })
  if (r.code !== 0) throw new Error(`Service start failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
  // `systemctl start` returns once the transition begins — verify the
  // workers actually came up instead of trusting it blindly.
  let startBackend: FirewallBackendResolved | null = null
  try {
    const conf = loadLinuxConf(dataDir)
    startBackend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto')
  } catch {
    startBackend = null
  }
  await verifyLinuxRunning(dataDir, init, startBackend, onLog)
  onLog?.('Service started.')
}

/** Stop nfqws + init service + firewall rules. Single auth prompt. */
export async function stopLinuxService(dataDir: string, onLog?: (t: string) => void): Promise<void> {
  const steps: BatchStep[] = []
  const init = await detectInitSystem().catch(() => 'unknown' as InitSystem)
  if (init !== 'unknown') {
    // Old behavior tolerated a failing stop (fell through to pkill).
    for (const s of buildStopSteps(init)) steps.push({ ...s, ignoreFailure: true })
  }
  steps.push(pkillStep())
  try {
    const conf = loadLinuxConf(dataDir)
    const backend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto').catch(() => null)
    if (backend) steps.push(...buildFirewallClearSteps(backend))
    else {
      for (const b of await listAvailableBackends()) steps.push(...buildFirewallClearSteps(b))
    }
  } catch {
    /* best-effort */
  }
  await runBatch(steps, { timeoutMs: 120000, onLog })
  onLog?.('Service stopped, firewall cleared.')
}

/** Remove init service(s) + kill nfqws + clear firewall (all backends). Single auth prompt. */
export async function removeLinuxServices(dataDir: string, onLog?: (t: string) => void): Promise<void> {
  const say = (t: string): void => onLog?.(t)
  const steps: BatchStep[] = []
  const init = await detectInitSystem().catch(() => 'unknown' as InitSystem)
  if (init !== 'unknown') {
    steps.push(...buildRemoveSteps(init, LINUX_SERVICE_NAME))
  } else {
    say('No init system detected — removing daemon state only.')
  }
  if (await isNfqwsRunning()) {
    say('Killing nfqws...')
  } else {
    say('nfqws is not running.')
  }
  steps.push(pkillStep())
  for (const b of (await listAvailableBackends().catch(() => [] as FirewallBackendResolved[]))) {
    say(`Clearing ${b} rules...`)
    steps.push(...buildFirewallClearSteps(b))
  }
  const r = await runBatch(steps, { timeoutMs: 180000, onLog: say })
  if (r.code !== 0) {
    say(`Service remove warning: ${`Remove failed${batchFailWhat(r, steps)}: ${batchOut(r)}`.slice(0, 200)}`)
  } else {
    const done: Record<string, string> = {
      systemd: 'systemd service removed.',
      openrc: 'OpenRC service removed.',
      runit: 'runit service removed.',
      s6: 's6 service removed.',
      dinit: 'dinit service removed.',
      unknown: 'Daemon state removed.'
    }
    say(done[init] ?? 'Service removed.')
  }
}

// ---------------------------------------------------------------------------
// Foreground test (`run` without installing a service)
// ---------------------------------------------------------------------------

/** Stop the foreground test process (spawned by testLinuxStrategy). Single auth prompt. */
export function stopLinuxTest(): void {
  const child = foregroundProc
  foregroundProc = null
  const backend = foregroundBackend
  foregroundBackend = null
  try {
    child?.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  // One batch for pkill + firewall cleanup instead of a prompt per command.
  void (async () => {
    try {
      const steps: BatchStep[] = [pkillStep()]
      if (backend) steps.push(...buildFirewallClearSteps(backend))
      else {
        for (const b of await listAvailableBackends().catch(() => [] as FirewallBackendResolved[])) {
          steps.push(...buildFirewallClearSteps(b))
        }
      }
      await runBatch(steps, { timeoutMs: 60000 })
    } catch {
      /* best-effort */
    }
  })()
}

/**
 * Spawn nfqws in the foreground for strategy testing (no --daemon).
 * pkill + firewall setup + nfqws run as ONE elevated `bash -c` script
 * (single auth prompt), ending with `exec nfqws` so stdio keeps streaming
 * to the test console. Firewall rules are cleared on stop.
 */
export async function testLinuxStrategy(
  strategy: Strategy,
  dataDir: string,
  onLog?: (t: string) => void,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
): Promise<ChildProcess> {
  const binDir = getLinuxBinDir(dataDir)
  const listsDir = path.join(dataDir, 'lists')
  const nfqwsPath = getLinuxNfqwsPath(dataDir)
  if (!fs.existsSync(nfqwsPath)) throw new Error(`nfqws not found in ${binDir}`)
  const testDeps = await checkNfqwsLaunchable(nfqwsPath)
  if (!testDeps.ok) {
    throw new Error(`nfqws cannot start — ${testDeps.list}. ${testDeps.hint}`)
  }
  const conf = loadLinuxConf(dataDir)
  const parsed = parseStrategyArgsForLinux(strategy.args, {
    useGameFilterTcp: conf?.gamefiltertcp ?? false,
    useGameFilterUdp: conf?.gamefilterudp ?? false,
    binDir,
    listsDir
  })
  const backend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto')
  onLog?.(`Test firewall: ${backend} TCP=${parsed.tcpPorts} UDP=${parsed.udpPorts}`)
  const argv = buildNfqwsArgv(parsed, { binDir, listsDir, daemon: false, runUid: resolveDataOwnerUid(dataDir) })
  onLog?.(`Starting foreground test: nfqws ${argv.join(' ')}`)
  const missingTestRefs = missingFiles(extractNfqwsFileRefs(argv))
  if (missingTestRefs.length > 0) {
    throw new Error(`Strategy references missing files:\n${missingTestRefs.join('\n')}`)
  }
  // Drop any previous test silently (its rules are cleared by the setup
  // batch below, which covers every backend for backend switches).
  try {
    foregroundProc?.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  foregroundProc = null
  foregroundBackend = null
  const ports = { tcp: parsed.tcpPorts, udp: parsed.udpPorts, interface: conf?.interface ?? ANY_INTERFACE }
  const setupSteps: BatchStep[] = [pkillStep()]
  try {
    for (const b of await listAvailableBackends()) setupSteps.push(...buildFirewallClearSteps(b))
  } catch {
    /* ignore */
  }
  setupSteps.push(...buildFirewallSetupSteps(backend, ports))
  // Marker protocol lines must not leak into the test console.
  const filterOut = (stream: 'stdout' | 'stderr', text: string): void => {
    const clean = String(text ?? '')
      .split('\n')
      .filter((l) => !/^ZAPRET_BATCH_(STEP|FAIL) \d+\r?$/.test(l))
      .join('\n')
    if (clean !== '') onOutput?.(stream, clean)
  }
  let child: ChildProcess
  if (isRoot() || (await canElevateWithoutPassword().catch(() => false))) {
    // Silent path: the setup batch uses individually NOPASSWD-covered
    // commands (`sudo -n bash -c` as a whole would NOT be covered).
    const setupRes = await runBatch(setupSteps, { timeoutMs: 120000, onLog })
    if (setupRes.code !== 0) {
      throw new Error(`Test firewall setup failed${batchFailWhat(setupRes, setupSteps)}: ${batchOut(setupRes)}`)
    }
    child = await spawnElevated(nfqwsPath, argv, { cwd: binDir })
  } else {
    // Single-prompt path: setup + `exec nfqws` in one elevated shell, so
    // stdio keeps streaming to the test console.
    const script = `${buildBatchScript(setupSteps)}exec ${[nfqwsPath, ...argv].map(shellQuote).join(' ')}\n`
    child = await spawnElevated('bash', ['-c', script], { cwd: binDir })
  }
  foregroundProc = child
  foregroundBackend = backend
  child.stdout?.on('data', (d: Buffer) => filterOut('stdout', String(d)))
  child.stderr?.on('data', (d: Buffer) => filterOut('stderr', String(d)))
  child.on('exit', () => {
    if (foregroundProc === child) {
      foregroundProc = null
      foregroundBackend = null
      firewallClear(backend).catch(() => undefined)
    }
  })
  return child
}

// ---------------------------------------------------------------------------
// Permissions (NOPASSWD) + hosts path
// ---------------------------------------------------------------------------

/** Current user login (for sudoers generation). */
export function currentLoginUser(): string {
  try {
    return process.env.SUDO_USER ?? process.env.USER ?? process.env.LOGNAME ?? os.userInfo().username ?? 'user'
  } catch {
    return 'user'
  }
}

/** Whether NOPASSWD rules appear to be installed. */
export async function getLinuxPermissionsStatus(
  dataDir: string
): Promise<{ sudoers: boolean; doas: boolean; elevateCmd: string; nopass: boolean }> {
  let elevateCmd = 'none'
  try {
    elevateCmd = detectElevateCmd() === '' ? 'root' : detectElevateCmd()
  } catch {
    elevateCmd = 'none'
  }
  let sudoers = false
  let doas = false
  // Current rules carry the `-x nfqws` pkill form plus service-management
  // coverage; older files count as missing so the UI nudges to re-run the
  // one-time setup.
  let sudoersContent: string | null = null
  try {
    if (fs.existsSync(SUDOERS_FILE)) sudoersContent = fs.readFileSync(SUDOERS_FILE, 'utf8')
  } catch {
    sudoersContent = null
  }
  if (sudoersContent === null) {
    try {
      // Read-only check that never prompts (background-safe).
      const r = await runQuery('cat', [SUDOERS_FILE], 8000)
      if (r.code === 0) sudoersContent = r.stdout
    } catch {
      sudoersContent = null
    }
  }
  sudoers =
    sudoersContent !== null &&
    sudoersContent.includes('Zapret') &&
    sudoersContent.includes('-x nfqws') &&
    sudoersContent.includes('systemctl')
  try {
    doas = fs.existsSync('/etc/doas.conf') && fs.readFileSync('/etc/doas.conf', 'utf8').includes('Zapret Discord YouTube')
  } catch {
    doas = false
  }
  let nopass = false
  try {
    nopass = await canElevateWithoutPassword()
  } catch {
    nopass = false
  }
  void dataDir
  return { sudoers, doas, elevateCmd, nopass }
}

/**
 * Install NOPASSWD rules (sudoers.d file, or doas.conf block when doas is
 * the elevate command). This is the *one-time* elevation: a single auth
 * (pkexec prompt) here makes all later service operations passwordless
 * while the app itself keeps running as the user.
 */
export async function setupLinuxPermissions(dataDir: string, onLog?: (t: string) => void): Promise<void> {
  const say = (t: string): void => onLog?.(t)
  const user = currentLoginUser()
  const nfqwsPath = getLinuxNfqwsPath(dataDir)
  const [nftPath, iptPath, ip6tPath, pkillPath] = await Promise.all([
    whichBin('nft'),
    whichBin('iptables'),
    whichBin('ip6tables'),
    whichBin('pkill')
  ])
  const [systemctlPath, rcServicePath, rcUpdatePath, svPath, s6SvcPath, dinitctlPath, mkdirPath, rmPath, chmodPath, teePath, visudoPath, bashPath, journalctlPath] =
    await Promise.all([
      whichBin('systemctl'),
      whichBin('rc-service'),
      whichBin('rc-update'),
      whichBin('sv'),
      whichBin('s6-svc'),
      whichBin('dinitctl'),
      whichBin('mkdir'),
      whichBin('rm'),
      whichBin('chmod'),
      whichBin('tee'),
      whichBin('visudo'),
      whichBin('bash'),
      whichBin('journalctl')
    ])
  // `true` for the passwordless probe (`doas -n true`); resolved without
  // `command -v` because shells report the builtin instead of a path.
  const truePath = fs.existsSync('/usr/bin/true') ? '/usr/bin/true' : '/bin/true'
  let cmd: string
  try {
    cmd = detectElevateCmd()
  } catch (e) {
    throw e
  }
  if (cmd === 'doas') {
    const rules = buildDoasRules(user, nfqwsPath, {
      nftPath,
      iptablesPath: iptPath,
      ip6tablesPath: ip6tPath,
      extraBins: [truePath, systemctlPath, rcServicePath, rcUpdatePath, svPath, s6SvcPath, dinitctlPath, mkdirPath, rmPath, chmodPath, teePath, bashPath, journalctlPath]
    })
    say(`Appending NOPASSWD rules to /etc/doas.conf for ${user} ...`)
    // Single batch = single auth prompt.
    const steps: BatchStep[] = [{ kind: 'write', dest: '/etc/doas.conf', content: `\n${rules}`, mode: '0644', append: true }]
    const r = await runBatch(steps, { timeoutMs: 60000, onLog: say })
    if (r.code !== 0) throw new Error(`doas setup failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
    resetElevateCache()
    say('doas rules installed.')
    return
  }
  const content = buildSudoersContent(user, nfqwsPath, {
    nftPath,
    iptablesPath: iptPath,
    ip6tablesPath: ip6tPath,
    pkillPath,
    systemctlPath,
    rcServicePath,
    rcUpdatePath,
    svPath,
    s6SvcPath,
    dinitctlPath,
    mkdirPath,
    rmPath,
    chmodPath,
    teePath,
    visudoPath,
    bashPath,
    journalctlPath,
    runnerPath: getLinuxRunnerPath(dataDir),
    extraTeePaths: ['/etc/hosts', '/etc/hosts.zapret-gui.bak']
  })
  say(`Writing ${SUDOERS_FILE} for ${user} ...`)
  // Single batch = single auth prompt: write + chmod + syntax check.
  const visudoIdx = 1
  const steps: BatchStep[] = [
    { kind: 'write', dest: SUDOERS_FILE, content, mode: '0440', label: `write ${SUDOERS_FILE}` },
    { kind: 'exec', file: 'visudo', args: ['-c', '-f', SUDOERS_FILE] }
  ]
  const r = await runBatch(steps, { timeoutMs: 60000, onLog: say })
  if (r.code !== 0) {
    if (r.failedStep !== null && r.failedStep >= visudoIdx) {
      await runBatch([{ kind: 'exec', file: 'rm', args: ['-f', SUDOERS_FILE], ignoreFailure: true }], {
        timeoutMs: 15000
      }).catch(() => undefined)
      throw new Error('sudoers syntax check failed — file removed')
    }
    throw new Error(`sudoers setup failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
  }
  // Fresh NOPASSWD must apply immediately, not after the probe-cache TTL.
  resetElevateCache()
  say('NOPASSWD configured (visudo OK).')
}

/** Absolute system hosts path on Linux. */
export function getLinuxHostsPath(): string {
  return '/etc/hosts'
}
