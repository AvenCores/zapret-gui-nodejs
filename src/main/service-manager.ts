/**
 * Windows service management for `zapret` + `WinDivert`.
 *
 * All operations shell out to `sc.exe` / `net` / `reg` / `tasklist` /
 * `taskkill`, mirroring `service.bat`. Every function returns data —
 * never throws for expected "not installed" states.
 * @module main/service-manager
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCmd, runPowershell } from './exec'
import { getBinDir, getListsDir } from './paths'
import { materializeArgs, quoteArg } from './strategy-parser'
import { SERVICE_NAME, WINDIVERT_SERVICE, WINWS_EXE, CONFLICTING_SERVICES } from '../shared/constants'
import type { GameFilterMode, IPSetMode, ServiceOwnership, ServiceState, StatusSnapshot, Strategy } from '../shared/types'
import { translate, type Locale } from '../shared/i18n'

// Re-exported so renderer-adjacent code can import from one place.
export type { ServiceState, StatusSnapshot }

/** Parse `sc query <name>` STATE line. */
export function parseScState(output: string): ServiceState {
  const m = output.match(/STATE\s*:\s*\d+\s+(\w+)/i)
  if (!m) {
    if (/FAILED\s*1060|specified service does not exist/i.test(output)) return 'NOT_INSTALLED'
    return 'UNKNOWN'
  }
  const s = m[1].toUpperCase()
  if (s === 'RUNNING') return 'RUNNING'
  if (s === 'STOPPED') return 'STOPPED'
  if (s === 'START_PENDING') return 'START_PENDING'
  if (s === 'STOP_PENDING') return 'STOP_PENDING'
  return 'UNKNOWN'
}

async function scQuery(name: string): Promise<ServiceState> {
  return queryServiceState(name)
}

/**
 * Map a `Get-Service -Name x` `.Status` value to {@link ServiceState}.
 * .NET enum names are English identifiers regardless of the OS display
 * language — unlike `sc query` output, which is localized (Russian Windows
 * prints "СОСТОЯНИЕ" instead of "STATE", so text parsing yields UNKNOWN).
 * Pure — covered by unit tests.
 */
export function mapServiceStatus(raw: string): ServiceState {
  const s = raw.trim().toLowerCase()
  if (s === '') return 'UNKNOWN'
  if (s.includes('startpending') || s.includes('continuepending')) return 'START_PENDING'
  if (s.includes('stoppending')) return 'STOP_PENDING'
  if (s.includes('running')) return 'RUNNING'
  if (s.includes('stopped')) return 'STOPPED'
  return 'UNKNOWN'
}

/**
 * Query a single Windows service state (NOT_INSTALLED when missing).
 * Primary path is PowerShell `Get-Service` (locale-independent); legacy
 * `sc` text parsing remains as a fallback.
 */
export async function queryServiceState(name: string): Promise<ServiceState> {
  // Service names are `[A-Za-z0-9_. -]`; strip everything else so the value
  // can be safely interpolated into PowerShell/cmd one-liners.
  const safe = String(name).replace(/[^A-Za-z0-9_. -]/g, '').slice(0, 64) || 'zapret'
  // Bounded timeouts: two sequential default-30s calls could stall getStatus
  // for a full minute when PowerShell is slow (cold start / AV scan) and
  // bust the caller's own timeout budget.
  const r = await runPowershell(`(Get-Service -Name '${safe}' -ErrorAction SilentlyContinue).Status`, 12000)
  const mapped = mapServiceStatus(r.stdout)
  if (mapped !== 'UNKNOWN') return mapped
  const sc = await runCmd(`sc query "${safe}"`, 8000)
  const combined = sc.stdout + '\n' + sc.stderr
  // 1060 = service does not exist. Match digits only: the message text is
  // localized (and OEM-decoded), but the numeric code survives any encoding.
  if (sc.code !== 0 && /\b1060\b|does not exist/i.test(combined)) return 'NOT_INSTALLED'
  return parseScState(combined)
}

/** `tasklist` check for a running image. */
export async function isProcessRunning(image: string): Promise<boolean> {
  const safe = String(image).replace(/[^A-Za-z0-9_. -]/g, '').slice(0, 64) || 'winws.exe'
  const r = await runCmd(`tasklist /FI "IMAGENAME eq ${safe}" /FO CSV /NH`)
  return r.stdout.toLowerCase().includes(safe.toLowerCase())
}

async function killProcess(image: string): Promise<void> {
  const safe = String(image).replace(/[^A-Za-z0-9_. -]/g, '').slice(0, 64) || 'winws.exe'
  await runCmd(`taskkill /IM ${safe} /F >nul 2>&1`)
}

async function readStrategyRegistry(): Promise<{ strategy: string | null; binPath: string | null }> {
  const r = await runCmd(`reg query "HKLM\\System\\CurrentControlSet\\Services\\${SERVICE_NAME}" /v zapret-discord-youtube`)
  let strategy: string | null = null
  const m = r.stdout.match(/zapret-discord-youtube\s+REG_SZ\s+(.+)/)
  if (m) strategy = m[1].trim()
  const r2 = await runCmd(`reg query "HKLM\\System\\CurrentControlSet\\Services\\${SERVICE_NAME}" /v ImagePath`)
  let binPath: string | null = null
  const m2 = r2.stdout.match(/ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)/)
  if (m2) binPath = m2[1].trim()
  return { strategy, binPath }
}

/**
 * Expand `%VAR%` segments using `process.env` (case-insensitive on Windows).
 * Pure — covered by unit tests.
 */
export function expandEnvVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (_m, name: string) => {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === String(name).toLowerCase())
    return (key != null ? process.env[key] : '') ?? ''
  })
}

/**
 * Normalize a Windows path for ownership comparison: expand env vars,
 * unify slashes, strip wrapping quotes, trim, lowercase.
 * Pure — covered by unit tests.
 */
export function normalizeWindowsPath(p: string): string {
  let s = expandEnvVars(p.trim())
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1)
  s = s.replace(/\//g, '\\').toLowerCase()
  return s
}

/**
 * Extract the exe path from a service `ImagePath` value
 * (e.g. `"C:\\zapret\\winws.exe" --args...` → `C:\\zapret\\winws.exe`).
 * Pure — covered by unit tests.
 */
export function extractExePathFromImagePath(imagePath: string): string {
  const s = imagePath.trim()
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    if (end > 1) return s.slice(1, end)
  }
  // Unquoted: first whitespace-separated token (ImagePath never contains
  // spaces unquoted except as arg separator).
  const token = s.split(/\s+/)[0] ?? ''
  return token.replace(/^["']|["']$/g, '')
}

function withTrailingSep(normalizedDir: string): string {
  const s = normalizedDir.replace(/\\+$/, '')
  return s + '\\'
}

/**
 * Decide who owns the `zapret` service by comparing its binary location
 * with our own `bin/` dir. A third-party bundle (different folder) reports
 * `RUNNING` under the same service name, so state alone is not enough.
 * Pure — covered by unit tests.
 */
export function detectServiceOwnership(
  serviceState: ServiceState,
  serviceBinPath: string | null,
  ownBinDir: string
): ServiceOwnership {
  if (serviceState === 'NOT_INSTALLED') return 'none'
  if (serviceBinPath == null || serviceBinPath.trim() === '') return 'unknown'
  const exe = normalizeWindowsPath(extractExePathFromImagePath(serviceBinPath))
  const own = withTrailingSep(normalizeWindowsPath(ownBinDir))
  const exeDir = exe.includes('\\') ? exe.slice(0, exe.lastIndexOf('\\') + 1) : ''
  if (exeDir === '' || own === '\\') return 'unknown'
  return exeDir.startsWith(own) ? 'ours' : 'foreign'
}

/** Full path of a running `winws.exe` (null when not running / unknown). */
export async function getWinwsProcessPath(): Promise<string | null> {
  const r = await runPowershell(
    `(Get-Process -Name 'winws' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path -ErrorAction SilentlyContinue)`
  )
  const p = (r.stdout ?? '').trim()
  return p === '' ? null : p
}

async function enableTcpTimestamps(): Promise<void> {
  // Mirrors service.bat :tcp_enable — harmless if already enabled.
  await runCmd('chcp 437 >nul & netsh interface tcp show global | findstr /i "timestamps" | findstr /i "enabled" >nul || netsh interface tcp set global timestamps=enabled >nul 2>&1')
}

/** One shared in-flight snapshot (see getStatus). */
let statusInflight: Promise<StatusSnapshot> | null = null

/** Full dashboard snapshot. */
export async function getStatus(isAdmin: boolean): Promise<StatusSnapshot> {
  // De-duplicate overlapping calls: the tray tick (15s) and the dashboard
  // often fire together, and each snapshot spawns ~5 powershell/cmd
  // processes — without sharing they pile up when the shell is slow.
  if (statusInflight) {
    const shared = await statusInflight
    return { ...shared, isAdmin }
  }
  const current = (async (): Promise<StatusSnapshot> => {
    const [zapret, windivert, winwsRunning, reg, winwsPath] = await Promise.all([
      scQuery(SERVICE_NAME),
      scQuery(WINDIVERT_SERVICE),
      isProcessRunning(WINWS_EXE),
      readStrategyRegistry(),
      getWinwsProcessPath()
    ])
    let ownBinDir = ''
    try {
      ownBinDir = getBinDir()
    } catch {
      ownBinDir = ''
    }
    const ownership = ownBinDir === '' ? 'unknown' : detectServiceOwnership(zapret, reg.binPath, ownBinDir)
    return {
      zapret,
      windivert,
      winwsRunning,
      activeStrategy: reg.strategy,
      serviceBinPath: reg.binPath,
      winwsPath,
      ownership,
      isAdmin
    }
  })()
  statusInflight = current
  try {
    return await current
  } finally {
    if (statusInflight === current) statusInflight = null
  }
}

/** Resolve current game-filter TCP/UDP port specs from the flag file. */
export function resolveGameFilterPorts(dataDir: string): { tcp: string; udp: string; mode: GameFilterMode } {
  const flag = path.join(dataDir, 'utils', 'game_filter.enabled')
  if (!fs.existsSync(flag)) return { tcp: '12', udp: '12', mode: 'disabled' }
  const raw = fs.readFileSync(flag, 'utf8').trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (raw === 'all') return { tcp: '1024-65535', udp: '1024-65535', mode: 'all' }
  if (raw === 'tcp') return { tcp: '1024-65535', udp: '12', mode: 'tcp' }
  return { tcp: '12', udp: '1024-65535', mode: 'udp' }
}

export function getGameFilterMode(dataDir: string): GameFilterMode {
  return resolveGameFilterPorts(dataDir).mode
}

export function setGameFilterMode(dataDir: string, mode: GameFilterMode): void {
  const flag = path.join(dataDir, 'utils', 'game_filter.enabled')
  fs.mkdirSync(path.dirname(flag), { recursive: true })
  if (mode === 'disabled') {
    if (fs.existsSync(flag)) fs.rmSync(flag, { force: true })
  } else {
    fs.writeFileSync(flag, mode === 'all' ? 'all' : mode, 'utf8')
  }
}

/** Derive IPSet mode from `lists/ipset-all.txt` (mirrors `:ipset_switch_status`). */
export function getIPSetMode(listsDir: string): IPSetMode {
  const listFile = path.join(listsDir, 'ipset-all.txt')
  let size: number
  try {
    size = fs.statSync(listFile).size
  } catch {
    return 'any'
  }
  if (size === 0) return 'any'
  // Fast path: the `none` marker file is 19 bytes and `any` is empty, so any
  // multi-MB file can only be a loaded list — don't block the main thread
  // reading megabytes on every tray tick.
  if (size > 1024 * 1024) return 'loaded'
  const content = fs.readFileSync(listFile, 'utf8')
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return 'any'
  if (/203\.0\.113\.113\/32/.test(content)) return 'none'
  return 'loaded'
}

/** Cycle/set IPSet mode (mirrors `:ipset_switch`). */
export function setIPSetMode(listsDir: string, mode: IPSetMode): void {
  const listFile = path.join(listsDir, 'ipset-all.txt')
  const backupFile = path.join(listsDir, 'ipset-all.txt.backup')
  if (mode === 'none') {
    if (fs.existsSync(listFile) && !fs.existsSync(backupFile)) {
      fs.renameSync(listFile, backupFile)
    } else if (fs.existsSync(listFile)) {
      fs.rmSync(listFile, { force: true })
    }
    fs.writeFileSync(listFile, '203.0.113.113/32\n', 'utf8')
  } else if (mode === 'any') {
    fs.writeFileSync(listFile, '', 'utf8')
  } else {
    if (fs.existsSync(backupFile)) {
      fs.rmSync(listFile, { force: true })
      fs.copyFileSync(backupFile, listFile)
    } else {
      throw new Error('No ipset backup to restore — update the IPSet list first')
    }
  }
}

/**
 * Auto-update-check flag (`utils/check_updates.enabled` existence).
 * Deleting it is the persisted "off" state — `ensureDataDirSeeded`
 * never restores it for existing installs.
 */
export function getAutoUpdateCheck(dataDir: string): boolean {
  return fs.existsSync(path.join(dataDir, 'utils', 'check_updates.enabled'))
}

export function setAutoUpdateCheck(dataDir: string, enabled: boolean): void {
  const flag = path.join(dataDir, 'utils', 'check_updates.enabled')
  if (enabled) fs.writeFileSync(flag, 'ENABLED\n', 'utf8')
  else fs.rmSync(flag, { force: true })
}

/**
 * Build the SCM ImagePath value for `sc create`: `"exe" args` — the exe
 * quoted on its own, args appended after it.
 * Wrapping the whole `exe + args` in one pair of quotes makes Windows look
 * for an executable literally named `winws.exe --args...` and the service
 * never starts (breaks on any path with spaces, e.g. `Ivan Petrov`).
 * `args` are expected to come from {@link quoteArg} (no newlines or inner
 * quotes, args with spaces already wrapped in balanced quotes).
 * Pure — covered by unit tests.
 */
export function buildServiceImagePath(exePath: string, args: string[]): string {
  const exe = String(exePath).replace(/[\r\n"]/g, '')
  const tail = args.join(' ').replace(/[\r\n]+/g, ' ')
  return tail === '' ? `"${exe}"` : `"${exe}" ${tail}`
}

/**
 * Wrap an ImagePath value for `sc create binPath= ...` so it survives the
 * whole transport chain as ONE argument: cmd.exe tokenizing → MSVCRT argv
 * parsing → sc.exe.
 *
 * - cmd.exe only understands `"...`" toggling (no backslash escapes), so the
 *   whole ImagePath is wrapped in one outer pair of quotes;
 * - MSVCRT understands `\"` (and `\\` before a quote), so every inner `"`
 *   is backslash-escaped (a preceding backslash run is doubled first).
 *
 * NOTE: `%VAR%` is left as-is. cmd.exe expands *defined* variables even
 * inside quotes (verified empirically) — but doubling to `%%` is worse: it
 * corrupts the common case, turning a literal `%BAR%` into `%%BAR%%`,
 * while a single `%BAR%` passes through untouched. Leftover `%...%` can
 * only come from unknown variables in hand-crafted imports (all known
 * placeholders are substituted beforehand).
 *
 * A naive `binPath= "exe args"` (quotes stripped) breaks on paths with
 * spaces; a naive `binPath= "exe" args` splits into several argv elements
 * and sc.exe answers with its USAGE text instead of creating the service.
 * Pure — covered by unit tests.
 */
export function quoteImagePathForSc(imagePath: string): string {
  const escaped = String(imagePath)
    .replace(/[\r\n]+/g, ' ')
    .replace(/(\\*)"/g, (_m, bs: string) => `${bs}${bs}\\"`)
  return `"${escaped}"`
}

/**
 * Install a strategy as the `zapret` Windows service.
 * Stops/deletes the old service first, then `sc create ... start= auto`,
 * writes the strategy name to the registry and starts the service.
 */
export async function installStrategy(
  strategy: Strategy,
  dataDir: string,
  onLog?: (text: string) => void
): Promise<void> {
  const binDir = getBinDir()
  const listsDir = getListsDir()
  const { tcp, udp } = resolveGameFilterPorts(dataDir)
  const args = materializeArgs(strategy.args, { binDir, listsDir, gameTcp: tcp, gameUdp: udp }).map(quoteArg)

  const say = (t: string): void => {
    onLog?.(t)
  }

  await enableTcpTimestamps()
  say(`Stopping previous service (if any)...`)
  await runCmd(`net stop ${SERVICE_NAME} >nul 2>&1`)
  await runCmd(`sc delete ${SERVICE_NAME} >nul 2>&1`)

  say(`Creating service: sc create ${SERVICE_NAME} ...`)
  // See quoteImagePathForSc: the value must reach sc.exe as a single argv
  // element with the exe quoted on its own (`"exe" args`).
  const imagePath = buildServiceImagePath(path.join(binDir, WINWS_EXE), args)
  const created = await runCmd(`sc create ${SERVICE_NAME} binPath= ${quoteImagePathForSc(imagePath)} DisplayName= "zapret" start= auto`)
  if (created.code !== 0 && !/FAILED 1072|already exists|marked for deletion/i.test(created.stdout + created.stderr)) {
    throw new Error(`sc create failed: ${(created.stdout + created.stderr).trim().slice(0, 500)}`)
  }
  await runCmd(`sc description ${SERVICE_NAME} "Zapret DPI bypass software"`)
  const started = await runCmd(`sc start ${SERVICE_NAME}`)
  if (started.code !== 0) {
    const out = (started.stdout + started.stderr).trim().slice(0, 500)
    throw new Error(`Service created but failed to start: ${out}`)
  }
  await runCmd(
    `reg add "HKLM\\System\\CurrentControlSet\\Services\\${SERVICE_NAME}" /v zapret-discord-youtube /t REG_SZ /d "${strategy.name.replace(/[\r\n"]/g, '').slice(0, 200)}" /f`
  )
  say(`Strategy "${strategy.name}" installed and started.`)
}

/** Stop + delete `zapret`, kill stray winws.exe, remove WinDivert services. */
export async function removeServices(onLog?: (text: string) => void): Promise<void> {
  const say = (t: string): void => {
    onLog?.(t)
  }
  const zapret = await scQuery(SERVICE_NAME)
  if (zapret !== 'NOT_INSTALLED') {
    say('Stopping zapret...')
    await runCmd(`net stop ${SERVICE_NAME} >nul 2>&1`)
    await runCmd(`sc delete ${SERVICE_NAME}`)
  } else {
    say('Service "zapret" is not installed.')
  }
  if (await isProcessRunning(WINWS_EXE)) {
    say('Killing stray winws.exe...')
    await killProcess(WINWS_EXE)
  }
  for (const svc of [WINDIVERT_SERVICE, 'WinDivert14']) {
    if ((await scQuery(svc)) !== 'NOT_INSTALLED') {
      say(`Removing ${svc}...`)
      await runCmd(`net stop "${svc}" >nul 2>&1`)
      await runCmd(`sc delete "${svc}"`)
    }
  }
}

export async function startService(): Promise<void> {
  const r = await runCmd(`sc start ${SERVICE_NAME}`)
  if (r.code !== 0) throw new Error(friendlyServiceError('start', r.stdout + r.stderr))
}

export async function stopService(): Promise<void> {
  const r = await runCmd(`net stop ${SERVICE_NAME}`)
  if (r.code !== 0) throw new Error(friendlyServiceError('stop', r.stdout + r.stderr))
}

/**
 * Map raw `sc`/`net` failure output to an actionable error.
 * 1060 (service does not exist) otherwise surfaces as raw localized `sc`
 * text — unreadable when OEM-decoded and telling the user nothing to do.
 * Pure — covered by unit tests.
 */
export function friendlyServiceError(action: 'start' | 'stop', output: string): string {
  if (/\b1060\b/.test(output)) {
    return `Service '${SERVICE_NAME}' is not installed — apply a strategy on the Strategies tab to install it`
  }
  return output.trim().slice(0, 500) || `Service ${action} failed`
}

/** Remove conflicting bypass services (GoodbyeDPI etc.) + WinDivert leftovers. */
export async function removeConflictingServices(onLog?: (text: string) => void, locale: Locale = 'en'): Promise<string[]> {
  const removed: string[] = []
  for (const svc of [...CONFLICTING_SERVICES]) {
    if ((await scQuery(svc)) !== 'NOT_INSTALLED') {
      onLog?.(translate(locale, 'tool.conflictRemoving').replace('{name}', svc))
      await runCmd(`net stop "${svc}" >nul 2>&1`)
      const r = await runCmd(`sc delete "${svc}"`)
      if (r.code === 0) removed.push(svc)
    }
  }
  // WinDivert leftovers are only touched when present — never blindly
  // deleted, they may belong to another program.
  for (const svc of [WINDIVERT_SERVICE, 'WinDivert14'] as const) {
    if ((await scQuery(svc)) !== 'NOT_INSTALLED') {
      onLog?.(translate(locale, 'tool.conflictRemovingDriver').replace('{name}', svc))
      await runCmd(`net stop "${svc}" >nul 2>&1`)
      await runCmd(`sc delete "${svc}" >nul 2>&1`)
    }
  }
  return removed
}

/** Clear Discord caches (Stable/PTB/Canary/Development). Returns human log lines. */
export async function clearDiscordCache(appData: string, onLog?: (text: string) => void, locale: Locale = 'en'): Promise<string[]> {
  const lines: string[] = []
  if (!appData || !path.isAbsolute(appData)) {
    const msg = translate(locale, 'tool.cacheNoAppData')
    onLog?.(msg)
    return [msg]
  }
  const variants: Array<[string, string]> = [
    ['Discord.exe', 'discord'],
    ['DiscordPTB.exe', 'discordptb'],
    ['DiscordCanary.exe', 'discordcanary'],
    ['DiscordDevelopment.exe', 'discorddevelopment']
  ]
  let found = false
  for (const [proc, dir] of variants) {
    const cacheDir = path.join(appData, dir)
    if (!fs.existsSync(cacheDir)) continue
    found = true
    if (await isProcessRunning(proc)) {
      await killProcess(proc)
      lines.push(translate(locale, 'tool.cacheClosed').replace('{dir}', dir))
    }
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) {
      const p = path.join(cacheDir, sub)
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { recursive: true, force: true })
          lines.push(translate(locale, 'tool.cacheCleared').replace('{dir}', dir).replace('{sub}', sub))
        } catch (e) {
          lines.push(
            translate(locale, 'tool.cacheFailed')
              .replace('{dir}', dir)
              .replace('{sub}', sub)
              .replace('{error}', String(e).slice(0, 120))
          )
        }
      }
    }
  }
  if (!found) lines.push(translate(locale, 'tool.cacheNotFound'))
  for (const l of lines) onLog?.(l)
  return lines
}

/**
 * Delete a user-imported strategy (`<id>.json` + sidecar `.bat` if present).
 * Bundled Flowseal strategies are protected: they are restored on update
 * anyway, so deleting them would only cause confusion.
 * @returns display name of the deleted strategy
 * @throws when the id is unknown or refers to a bundled strategy
 */
export function deleteImportedStrategy(strategiesDir: string, id: string): string {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error(`Invalid strategy id: ${id}`)
  }
  const jsonPath = path.join(strategiesDir, `${id}.json`)
  if (!fs.existsSync(jsonPath)) throw new Error(`Strategy not found: ${id}`)
  // Missing `origin` (configs written before the field existed) counts as bundled.
  let origin = 'bundled'
  let name = id
  let fileName: string | null = null
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Partial<Strategy>
    if (parsed.origin === 'imported') origin = 'imported'
    if (parsed.name) name = parsed.name
    if (parsed.fileName) fileName = parsed.fileName
  } catch {
    /* unreadable file keeps bundled default -> protected below */
  }
  if (origin === 'bundled') {
    throw new Error(`Cannot delete bundled strategy "${name}" — it ships with the app`)
  }
  fs.rmSync(jsonPath, { force: true })
  if (fileName && fileName.toLowerCase().endsWith('.bat') && !fileName.includes('/') && !fileName.includes('\\')) {
    fs.rmSync(path.join(strategiesDir, fileName), { force: true })
  }
  return name
}
