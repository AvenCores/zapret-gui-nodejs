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
  LINUX_SERVICE_NAME,
  NFQWS_BIN,
  SUDOERS_FILE,
  type FirewallBackend,
  type FirewallBackendResolved,
  type InitSystem
} from './constants'
import { loadLinuxConf, saveLinuxConf, type LinuxConf } from './config'
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
  detectInitSystem,
  queryLinuxServiceState
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

/** `pgrep -f nfqws` check. */
export async function isNfqwsRunning(): Promise<boolean> {
  try {
    const r = await execAsync('pgrep', ['-f', 'nfqws'], 8000)
    return r.code === 0 && r.stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Absolute path of the running nfqws (`/proc/<pid>/exe`), null when absent. */
export async function getNfqwsProcessPath(): Promise<string | null> {
  try {
    const r = await execAsync('pgrep', ['-n', '-f', 'nfqws'], 8000)
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

/** Best-effort `pkill -f nfqws` as a batch step (joins the operation batch — no extra prompt). Pure. */
function pkillStep(): BatchStep {
  return { kind: 'exec', file: 'pkill', args: ['-f', 'nfqws'], ignoreFailure: true }
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
    '',
    'elevate() {',
    '  if [ "$(id -u)" -eq 0 ]; then "$@"; return $?; fi',
    '  if command -v sudo >/dev/null 2>&1; then sudo "$@"; return $?; fi',
    '  if command -v doas >/dev/null 2>&1; then doas "$@"; return $?; fi',
    '  "$@";',
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
    '    elevate pkill -f nfqws 2>/dev/null || true',
    '    fw_clear || true',
    '    sleep 1',
    '    fw_setup',
    `    cd ${q(opts.binDir)}`,
    `    elevate "$NFQWS" ${argv}`,
    '    ;;',
    '  kill)',
    '    elevate pkill -f nfqws 2>/dev/null || true',
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
  let zapret: ServiceState = serviceState
  if (serviceState === 'NOT_INSTALLED') {
    zapret = nfqwsRunning ? 'RUNNING' : conf ? 'STOPPED' : 'NOT_INSTALLED'
  }
  const ownership = detectLinuxOwnership(serviceState, nfqwsRunning, nfqwsProcPath ?? nfqwsDiskPath, ownBinDir)
  const firewallActive = resolved ? await isFirewallActive(resolved).catch(() => false) : false

  const snapshot: StatusSnapshot = {
    zapret,
    windivert: resolved ? (firewallActive ? 'RUNNING' : 'STOPPED') : 'NOT_INSTALLED',
    winwsRunning: nfqwsRunning,
    activeStrategy: conf?.strategy ?? null,
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
  const prev = loadLinuxConf(dataDir)
  const conf: LinuxConf = {
    interface: opts.interface ?? prev?.interface ?? ANY_INTERFACE,
    gamefiltertcp: prev?.gamefiltertcp ?? false,
    gamefilterudp: prev?.gamefilterudp ?? false,
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
  const nfqwsArgv = buildNfqwsArgv(parsed, { binDir, listsDir, daemon: true })

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
      nfqwsArgv
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
      throw new Error(`nfqws failed to start: ${batchOut(r).slice(0, 500)}`)
    }
    if (r.failedStep !== null && installFromIdx >= 0 && r.failedStep >= installFromIdx) {
      throw new Error(`Service install failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
    }
    throw new Error(`Firewall setup failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
  }
  // Give the daemon a moment, then verify it survived.
  await new Promise((res) => setTimeout(res, 800))
  if (!(await isNfqwsRunning())) {
    throw new Error('nfqws exited immediately after start — check the strategy and firewall rules')
  }
  say(`Strategy "${strategy.name}" installed and started.`)
}

/** Start the init service (or foreground daemon when no init). Single auth prompt. */
export async function startLinuxService(dataDir: string, onLog?: (t: string) => void): Promise<void> {
  const init = await detectInitSystem().catch(() => 'unknown' as InitSystem)
  if (init === 'unknown') {
    // No init: re-run the stored runner daemon directly (one batch).
    const runner = getLinuxRunnerPath(dataDir)
    if (!fs.existsSync(runner)) throw new Error('No runner found — apply a strategy first')
    const r = await runBatch([{ kind: 'exec', file: 'bash', args: [runner, 'daemon'] }], { timeoutMs: 60000, onLog })
    if (r.code !== 0) throw new Error(`Start failed: ${batchOut(r).slice(0, 400)}`)
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
  if (unitState === 'NOT_INSTALLED') {
    const runner = getLinuxRunnerPath(dataDir)
    if (!fs.existsSync(runner)) {
      throw new Error('Service is not installed — apply a strategy on the Strategies tab first')
    }
    onLog?.(`Service unit is missing, reinstalling ${init} service (${LINUX_SERVICE_NAME})...`)
    steps.push(...buildInstallSteps(init, { runnerPath: runner, workDir: dataDir }))
  }
  steps.push(...buildStartSteps(init))
  const r = await runBatch(steps, { timeoutMs: 120000, onLog })
  if (r.code !== 0) throw new Error(`Service start failed${batchFailWhat(r, steps)}: ${batchOut(r)}`)
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
  const conf = loadLinuxConf(dataDir)
  const parsed = parseStrategyArgsForLinux(strategy.args, {
    useGameFilterTcp: conf?.gamefiltertcp ?? false,
    useGameFilterUdp: conf?.gamefilterudp ?? false,
    binDir,
    listsDir
  })
  const backend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto')
  onLog?.(`Test firewall: ${backend} TCP=${parsed.tcpPorts} UDP=${parsed.udpPorts}`)
  const argv = buildNfqwsArgv(parsed, { binDir, listsDir, daemon: false })
  onLog?.(`Starting foreground test: nfqws ${argv.join(' ')}`)
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
  const script = `${buildBatchScript(setupSteps)}exec ${[nfqwsPath, ...argv].map(shellQuote).join(' ')}\n`
  const child = await spawnElevated('bash', ['-c', script], { cwd: binDir })
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
  try {
    sudoers = fs.existsSync(SUDOERS_FILE) && fs.readFileSync(SUDOERS_FILE, 'utf8').includes('Zapret')
  } catch {
    try {
      // Read-only check that never prompts (background-safe).
      const r = await runQuery('cat', [SUDOERS_FILE], 8000)
      sudoers = r.code === 0 && r.stdout.includes('Zapret')
    } catch {
      sudoers = false
    }
  }
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
  const [systemctlPath, rcServicePath, rcUpdatePath, svPath, s6SvcPath, dinitctlPath, mkdirPath, rmPath, chmodPath, teePath, visudoPath, bashPath] =
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
      whichBin('bash')
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
      extraBins: [truePath, systemctlPath, rcServicePath, rcUpdatePath, svPath, s6SvcPath, dinitctlPath, mkdirPath, rmPath, chmodPath, teePath, bashPath]
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
