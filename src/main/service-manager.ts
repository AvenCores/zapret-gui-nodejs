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
import { runCmd } from './exec'
import { getBinDir, getListsDir } from './paths'
import { materializeArgs, quoteArg } from './strategy-parser'
import { SERVICE_NAME, WINDIVERT_SERVICE, WINWS_EXE, CONFLICTING_SERVICES } from '../shared/constants'
import type { GameFilterMode, IPSetMode, ServiceState, StatusSnapshot, Strategy } from '../shared/types'

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
  const r = await runCmd(`sc query "${name}"`)
  const combined = r.stdout + '\n' + r.stderr
  if (r.code !== 0 && /FAILED 1060|does not exist/i.test(combined)) return 'NOT_INSTALLED'
  // Localized Windows: STATE line still contains the numeric code — fall back to it.
  const numeric = combined.match(/STATE\s*:\s*(\d+)/i)
  if (numeric) {
    const code = Number(numeric[1])
    if (code === 4) return 'RUNNING'
    if (code === 1) return 'STOPPED'
    if (code === 2) return 'START_PENDING'
    if (code === 3) return 'STOP_PENDING'
  }
  return parseScState(combined)
}

/** `tasklist` check for a running image. */
export async function isProcessRunning(image: string): Promise<boolean> {
  const r = await runCmd(`tasklist /FI "IMAGENAME eq ${image}" /FO CSV /NH`)
  return r.stdout.toLowerCase().includes(image.toLowerCase())
}

async function killProcess(image: string): Promise<void> {
  await runCmd(`taskkill /IM ${image} /F >nul 2>&1`)
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

async function enableTcpTimestamps(): Promise<void> {
  // Mirrors service.bat :tcp_enable — harmless if already enabled.
  await runCmd('chcp 437 >nul & netsh interface tcp show global | findstr /i "timestamps" | findstr /i "enabled" >nul || netsh interface tcp set global timestamps=enabled >nul 2>&1')
}

/** Full dashboard snapshot. */
export async function getStatus(isAdmin: boolean): Promise<StatusSnapshot> {
  const [zapret, windivert, winwsRunning, reg] = await Promise.all([
    scQuery(SERVICE_NAME),
    scQuery(WINDIVERT_SERVICE),
    isProcessRunning(WINWS_EXE),
    readStrategyRegistry()
  ])
  return {
    zapret,
    windivert,
    winwsRunning,
    activeStrategy: reg.strategy,
    serviceBinPath: reg.binPath,
    isAdmin
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
  if (!fs.existsSync(listFile)) return 'any'
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

/** Auto-update-check flag (`utils/check_updates.enabled` existence). */
export function getAutoUpdateCheck(dataDir: string): boolean {
  return fs.existsSync(path.join(dataDir, 'utils', 'check_updates.enabled'))
}

export function setAutoUpdateCheck(dataDir: string, enabled: boolean): void {
  const flag = path.join(dataDir, 'utils', 'check_updates.enabled')
  if (enabled) fs.writeFileSync(flag, 'ENABLED\n', 'utf8')
  else fs.rmSync(flag, { force: true })
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

  const binPath = `"${path.join(binDir, WINWS_EXE)}" ${args.join(' ')}`
  say(`Creating service: sc create ${SERVICE_NAME} ...`)
  const created = await runCmd(`sc create ${SERVICE_NAME} binPath= "${binPath.replace(/"/g, '\\"')}" DisplayName= "zapret" start= auto`)
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
    `reg add "HKLM\\System\\CurrentControlSet\\Services\\${SERVICE_NAME}" /v zapret-discord-youtube /t REG_SZ /d "${strategy.name.replace(/"/g, '')}" /f`
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
  if (r.code !== 0) throw new Error((r.stdout + r.stderr).trim().slice(0, 500) || 'sc start failed')
}

export async function stopService(): Promise<void> {
  const r = await runCmd(`net stop ${SERVICE_NAME}`)
  if (r.code !== 0) throw new Error((r.stdout + r.stderr).trim().slice(0, 500) || 'net stop failed')
}

/** Remove conflicting bypass services (GoodbyeDPI etc.) + WinDivert leftovers. */
export async function removeConflictingServices(onLog?: (text: string) => void): Promise<string[]> {
  const removed: string[] = []
  for (const svc of [...CONFLICTING_SERVICES]) {
    if ((await scQuery(svc)) !== 'NOT_INSTALLED') {
      onLog?.(`Removing conflicting service: ${svc}`)
      await runCmd(`net stop "${svc}" >nul 2>&1`)
      const r = await runCmd(`sc delete "${svc}"`)
      if (r.code === 0) removed.push(svc)
    }
  }
  await runCmd(`net stop "${WINDIVERT_SERVICE}" >nul 2>&1`)
  await runCmd(`sc delete "${WINDIVERT_SERVICE}" >nul 2>&1`)
  await runCmd(`net stop "WinDivert14" >nul 2>&1`)
  await runCmd(`sc delete "WinDivert14" >nul 2>&1`)
  return removed
}

/** Clear Discord caches (Stable/PTB/Canary/Development). Returns human log lines. */
export async function clearDiscordCache(appData: string, onLog?: (text: string) => void): Promise<string[]> {
  const lines: string[] = []
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
      lines.push(`${dir}: process closed`)
    }
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) {
      const p = path.join(cacheDir, sub)
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { recursive: true, force: true })
          lines.push(`${dir}/${sub}: cleared`)
        } catch (e) {
          lines.push(`${dir}/${sub}: FAILED (${String(e).slice(0, 120)})`)
        }
      }
    }
  }
  if (!found) lines.push('Discord installations were not found')
  for (const l of lines) onLog?.(l)
  return lines
}
