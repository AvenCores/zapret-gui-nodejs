/**
 * All IPC handlers between the renderer and main processes.
 * Long-running outputs (test run, downloads) stream back via
 * `zapret:on-test-output` / `zapret:on-download-progress` events.
 * @module main/ipc-handlers
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/types'
import type { AppSettings, GameFilterMode, IPSetMode, Strategy, TgProxySettings } from '../shared/types'
import {
  getStatus,
  installStrategy,
  removeServices,
  startService,
  stopService,
  getGameFilterMode,
  setGameFilterMode,
  getIPSetMode,
  setIPSetMode,
  getAutoUpdateCheck,
  setAutoUpdateCheck,
  removeConflictingServices,
  clearDiscordCache,
  deleteImportedStrategy
} from './service-manager'
import { parseBatContent, materializeArgsForSpawn, quoteArg } from './strategy-parser'
import { resolveGameFilterPorts } from './service-manager'
import { runDiagnostics } from './diagnostics'
import {
  checkZapretUpdates,
  updateIPSetList,
  checkHosts,
  applyHosts,
  removeHosts,
  updateStrategiesFromGithub,
  listEngineReleases,
  checkEngineUpdates,
  updateEngineToTag,
  listAvailableFakes,
  replaceActiveFake
} from './strategy-updater'
import { getDataDir, getBinDir, getListsDir, getStrategiesDir, getUtilsDir, getBundledAssetsDir } from './paths'
import { listUserLists, readUserList, writeUserList } from './user-lists'
import { checkBypassTarget } from './bypass-check'
import { checkAppUpdates, downloadAppUpdate, getAppUpdateState, getAppVersion, installAppUpdate } from './app-updater'
import type { BypassTargetId } from '../shared/types'
import { loadSettings, normalizeTgProxySettings, saveSettings } from './settings'
import { resetAppData } from './app-reset'
import { translate } from '../shared/i18n'
import { getBufferedLogs, info, warn, err } from './logger'
import { isAdmin, relaunchAppAsAdmin, spawnLong, killPidTree } from './exec'
import { WINWS_EXE } from '../shared/constants'
import { abortActiveChild, runConfigTests } from './config-tester'
import { win, safeSend } from './window'
import type { ConfigTestMode } from '../shared/types'
import {
  buildTgLink,
  generateTgSecret,
  getTgProxyStats,
  getTgProxyStatus,
  isValidDomain,
  isValidTgSecret,
  normalizeDcIpEntries,
  normalizeDomainEntries,
  normalizeOptionalDomain,
  normalizeTgHost,
  normalizeTgPort,
  parseDcIpList,
  parseDomainList,
  startTgProxy,
  stopTgProxy,
  tgStartOptsFromSettings
} from './tg-proxy'
import { TG_PROXY_DEFAULT_HOST } from '../shared/constants'

let testProc: ChildProcess | null = null
let configTesterAbort: AbortController | null = null

function sendLog(source: 'app' | 'winws' | 'updater' | 'diag' | 'tg-proxy', level: 'info' | 'warn' | 'error', text: string): void {
  // log() already forwards to the renderer via the global onLog subscription
  // (armLogForwarding in index.ts) — a direct safeSend here would deliver
  // every line twice.
  if (level === 'error') err(source, text)
  else if (level === 'warn') warn(source, text)
  else info(source, text)
}

/** Read strategies from data dir (seeded from bundled assets on first run). */
export function listStrategies(): Strategy[] {
  // Merge both dirs by id (data wins): returning only the first non-empty
  // dir hid all 50 bundled strategies whenever a single file lingered in
  // data/strategies (e.g. after a partial update or a lone import).
  const byId = new Map<string, Strategy>()
  for (const dir of [path.join(getBundledAssetsDir(), 'strategies'), getStrategiesDir()]) {
    try {
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.json')) continue
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Strategy
          // Configs generated before `origin` existed count as bundled.
          if (parsed.origin !== 'imported') parsed.origin = 'bundled'
          if (parsed.id) byId.set(parsed.id, parsed)
        } catch {
          /* skip broken file */
        }
      }
    } catch {
      /* try next dir */
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
}

function findStrategy(id: string): Strategy | null {
  return listStrategies().find((s) => s.id === id) ?? null
}

/**
 * Ensure a stable MTProto secret exists (generated once, then persisted).
 * A fresh secret on every start would force the user to reconfigure
 * Telegram Desktop after each reboot.
 */
export function ensureTgProxySecret(): AppSettings {
  const settings = loadSettings()
  if (isValidTgSecret(settings.tgProxy.secret)) return settings
  return saveSettings({ tgProxy: { ...settings.tgProxy, secret: generateTgSecret() } })
}

function getTgProxyStatusPayload(): { status: 'running' | 'stopped' | 'error'; stats: ReturnType<typeof getTgProxyStats> } {
  return getTgProxyStatus()
}

/**
 * Build the `tg://proxy` link for logs / open-in-Telegram. `bound` is the
 * actual listen endpoint when the proxy just started (port 0 impossible here
 * — settings ports are normalized — but bound is still authoritative).
 */
function buildTgProxyLink(settings: TgProxySettings, bound: { host: string; port: number } | null): string {
  const host = (bound?.host ?? settings.host) === '0.0.0.0' ? '127.0.0.1' : (bound?.host ?? settings.host)
  return buildTgLink(host, bound?.port ?? settings.port, settings.secret, settings.fakeTlsDomain)
}

/** Strict validators for explicitly-provided setting values (throw → error banner). */
function validateTgHost(value: unknown): string {
  const fallback = TG_PROXY_DEFAULT_HOST
  const s = normalizeTgHost(value, fallback)
  if (typeof value !== 'string' || s === fallback && value.trim() !== fallback) {
    throw new Error(`Invalid TG proxy host: ${String(value).slice(0, 80)}`)
  }
  return s
}

function validateDcIpEntries(value: unknown): string[] {
  const entries = parseDomainList(value)
  if (entries.length === 0) return []
  // Throws on the first malformed entry (message lists the culprit).
  const merged = parseDcIpList(entries)
  return Object.entries(merged).map(([dc, ip]) => `${dc}:${ip}`)
}

function validatePoolSize(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n) || n < 0 || n > 32) throw new Error(`Invalid TG proxy pool size (0–32): ${String(value).slice(0, 20)}`)
  return n
}

function validateBufferKb(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n) || n < 4 || n > 4096) throw new Error(`Invalid TG proxy buffer (4–4096 KB): ${String(value).slice(0, 20)}`)
  return n
}

function validateDomainEntries(value: unknown, what: string): string[] {
  const entries = parseDomainList(value)
  const bad = entries.filter((d) => !isValidDomain(d))
  if (bad.length > 0) throw new Error(`Invalid ${what}: ${bad[0].slice(0, 80)}`)
  return normalizeDomainEntries(entries)
}

function validateFakeTlsDomain(value: unknown): string {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (s === '') return ''
  if (!isValidDomain(s)) throw new Error(`Invalid FakeTLS domain: ${s.slice(0, 80)}`)
  return normalizeOptionalDomain(s)
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.getStatus, async () => getStatus(await isAdmin()))

  ipcMain.handle(IPC.listStrategies, async () => listStrategies())

  ipcMain.handle(IPC.installStrategy, async (_e, strategyId: string) => {
    const s = findStrategy(strategyId)
    if (!s) throw new Error(`Strategy not found: ${strategyId}`)
    sendLog('app', 'info', `Installing strategy "${s.name}"...`)
    await installStrategy(s, getDataDir(), (t) => sendLog('app', 'info', t))
    saveSettings({ activeStrategyId: s.id })
    return true
  })

  ipcMain.handle(IPC.removeServices, async () => {
    sendLog('app', 'info', 'Removing services...')
    await removeServices((t) => sendLog('app', 'info', t))
    return true
  })

  ipcMain.handle(IPC.startService, async () => {
    await startService()
    sendLog('app', 'info', 'Service started.')
    return true
  })

  ipcMain.handle(IPC.stopService, async () => {
    await stopService()
    sendLog('app', 'info', 'Service stopped.')
    return true
  })

  ipcMain.handle(IPC.importStrategy, async () => {
    const w = win()
    const locale = loadSettings().locale
    const res = await dialog.showOpenDialog(w ?? undefined as unknown as BrowserWindow, {
      title: translate(locale, 'dialog.importTitle'),
      filters: [{ name: translate(locale, 'dialog.importFilter'), extensions: ['bat'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    const stat = fs.statSync(file)
    if (stat.size > 1024 * 1024) throw new Error('Selected .bat is too large (max 1 MB)')
    const content = fs.readFileSync(file, 'utf8')
    const { strategy, warnings } = parseBatContent(content, path.basename(file))
    for (const warnText of warnings) sendLog('app', 'warn', `Import warnings: ${warnText}`)
    strategy.origin = 'imported'
    fs.mkdirSync(getStrategiesDir(), { recursive: true })
    fs.writeFileSync(path.join(getStrategiesDir(), `${strategy.id}.json`), JSON.stringify(strategy, null, 2), 'utf8')
    // Keep the original .bat next to it for reference.
    fs.copyFileSync(file, path.join(getStrategiesDir(), strategy.fileName))
    sendLog('app', 'info', `Imported strategy "${strategy.name}".`)
    return strategy
  })

  ipcMain.handle(IPC.deleteStrategy, async (_e, strategyId: string) => {
    stopTestInternal()
    const name = deleteImportedStrategy(getStrategiesDir(), strategyId)
    if (loadSettings().activeStrategyId === strategyId) {
      saveSettings({ activeStrategyId: null })
    }
    sendLog('app', 'info', `Deleted imported strategy "${name}".`)
    return true
  })

  ipcMain.handle(IPC.testStrategy, async (_e, strategyId: string) => {
    // Foreground test and config-tester share WinDivert — never run both.
    if (configTesterAbort) throw new Error('Config tests are running — stop them first')
    stopTestInternal()
    const s = findStrategy(strategyId)
    if (!s) throw new Error(`Strategy not found: ${strategyId}`)
    const { tcp, udp } = resolveGameFilterPorts(getDataDir())
    // Direct spawn (no shell): strip the .bat-era quotes, otherwise winws
    // receives literal `"` inside argv and fails to open list/bin files.
    const args = materializeArgsForSpawn(s.args, { binDir: getBinDir(), listsDir: getListsDir(), gameTcp: tcp, gameUdp: udp })
    const exe = path.join(getBinDir(), WINWS_EXE)
    if (!fs.existsSync(exe)) throw new Error(`winws.exe not found in ${getBinDir()}`)
    sendLog('winws', 'info', `Starting foreground test: winws.exe ${args.map(quoteArg).join(' ')}`)
    const proc = spawnLong(exe, args, getBinDir())
    testProc = proc
    proc.stdout?.on('data', (d: Buffer) => safeSend(IPC.onTestOutput, { stream: 'stdout', text: String(d) }))
    proc.stderr?.on('data', (d: Buffer) => safeSend(IPC.onTestOutput, { stream: 'stderr', text: String(d) }))
    proc.on('error', (e) => {
      // ENOENT (missing winws.exe / AV quarantine) otherwise throws an
      // unhandled 'error' event and crashes the main process.
      sendLog('winws', 'error', `Test process failed to start: ${String(e).slice(0, 300)}`)
      if (testProc === proc) testProc = null
      safeSend(IPC.onTestOutput, { stream: 'exit', text: '1' })
    })
    proc.on('exit', (code) => {
      sendLog('winws', 'info', `Test process exited with code ${code}`)
      // Only clear our own reference: a newer test may already be running
      // (stopTestInternal kills without waiting for 'exit').
      if (testProc === proc) testProc = null
      safeSend(IPC.onTestOutput, { stream: 'exit', text: String(code ?? '') })
    })
    return true
  })

  ipcMain.handle(IPC.stopTest, async () => {
    stopTestInternal()
    return true
  })

  ipcMain.handle(IPC.getGameFilter, async () => getGameFilterMode(getDataDir()))
  ipcMain.handle(IPC.setGameFilter, async (_e, mode: GameFilterMode) => {
    if (mode !== 'disabled' && mode !== 'all' && mode !== 'tcp' && mode !== 'udp') {
      throw new Error(`Invalid game filter mode: ${String(mode).slice(0, 50)}`)
    }
    setGameFilterMode(getDataDir(), mode)
    sendLog('app', 'info', `Game filter → ${mode}. Restart zapret to apply.`)
    return true
  })

  ipcMain.handle(IPC.getIPSetMode, async () => getIPSetMode(getListsDir()))
  ipcMain.handle(IPC.setIPSetMode, async (_e, mode: IPSetMode) => {
    if (mode !== 'none' && mode !== 'loaded' && mode !== 'any') {
      throw new Error(`Invalid IPSet mode: ${String(mode).slice(0, 50)}`)
    }
    setIPSetMode(getListsDir(), mode)
    sendLog('app', 'info', `IPSet mode → ${mode}. Restart zapret to apply.`)
    return true
  })

  ipcMain.handle(IPC.getAutoUpdateCheck, async () => getAutoUpdateCheck(getDataDir()))
  ipcMain.handle(IPC.setAutoUpdateCheck, async (_e, enabled: boolean) => {
    setAutoUpdateCheck(getDataDir(), enabled)
    return enabled
  })

  ipcMain.handle(IPC.listFakes, async () => listAvailableFakes())
  ipcMain.handle(IPC.replaceFake, async (_e, kind: 'discord' | 'game', fake: string) => {
    if (kind !== 'discord' && kind !== 'game') throw new Error(`Invalid fake kind: ${String(kind).slice(0, 20)}`)
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(fake)) throw new Error(`Invalid fake name: ${String(fake).slice(0, 64)}`)
    replaceActiveFake(kind, fake)
    sendLog('app', 'info', `Active ${kind} fake → ${fake}. Restart zapret to apply.`)
    saveSettings(kind === 'discord' ? { discordFake: fake } : { gameFake: fake })
    return true
  })

  ipcMain.handle(IPC.checkUpdates, async () => checkZapretUpdates())

  ipcMain.handle(IPC.getAppVersion, async () => getAppVersion())
  ipcMain.handle(IPC.checkAppUpdates, async () => checkAppUpdates())
  ipcMain.handle(IPC.getAppUpdateState, async () => getAppUpdateState())
  ipcMain.handle(IPC.downloadAppUpdate, async () => {
    await downloadAppUpdate()
    return true
  })
  ipcMain.handle(IPC.installAppUpdate, async () => {
    installAppUpdate()
    return true
  })

  ipcMain.handle(IPC.updateIPSet, async () => {
    sendLog('updater', 'info', 'Updating IPSet list...')
    const r = await updateIPSetList()
    sendLog('updater', 'info', `IPSet updated: ${r.lines} lines.`)
    return r
  })

  ipcMain.handle(IPC.updateHosts, async () => checkHosts())
  ipcMain.handle(IPC.applyHosts, async (_e, remoteContent: string) => {
    if (!(await isAdmin())) {
      throw new Error('Administrator rights are required to update the system hosts file. Click "Restart as administrator" and retry.')
    }
    await applyHosts(remoteContent)
    sendLog('app', 'info', 'System Hosts updated (backup: hosts.zapret-gui.bak).')
    return true
  })

  ipcMain.handle(
    IPC.removeHosts,
    async (_e, payload?: { firstLine?: string; lastLine?: string; remoteContent?: string }) => {
      if (!(await isAdmin())) {
        throw new Error('Administrator rights are required to update the system hosts file. Click "Restart as administrator" and retry.')
      }
      const p = (payload ?? {}) as { firstLine?: string; lastLine?: string; remoteContent?: string }
      const removed = await removeHosts({
        firstLine: typeof p.firstLine === 'string' ? p.firstLine.slice(0, 1024) : undefined,
        lastLine: typeof p.lastLine === 'string' ? p.lastLine.slice(0, 1024) : undefined,
        remoteContent: typeof p.remoteContent === 'string' ? p.remoteContent.slice(0, 1024 * 1024) : undefined
      })
      sendLog(
        'app',
        'info',
        removed ? 'Zapret entries removed from system Hosts (backup: hosts.zapret-gui.bak).' : 'No zapret entries found in system Hosts — nothing removed.'
      )
      return removed
    }
  )

  ipcMain.handle(IPC.updateStrategies, async () => {
    const r = await updateStrategiesFromGithub(
      getDataDir(),
      (p) => safeSend(IPC.onDownloadProgress, p),
      (t) => sendLog('updater', 'info', t)
    )
    return r
  })

  ipcMain.handle(IPC.listEngineReleases, async (_e, limit?: number) => {
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 20
    return listEngineReleases(n)
  })

  ipcMain.handle(IPC.checkEngineUpdates, async () => checkEngineUpdates())

  ipcMain.handle(IPC.updateEngine, async (_e, tag: string) => {
    const cleanTag = String(tag ?? '').slice(0, 64)
    sendLog('updater', 'info', `Updating zapret engine to ${cleanTag}...`)
    const r = await updateEngineToTag(
      getDataDir(),
      cleanTag,
      (p) => safeSend(IPC.onDownloadProgress, p),
      (t) => sendLog('updater', 'info', t)
    )
    sendLog('updater', 'info', `Engine updated to ${r.tag}: ${r.filesUpdated.length} files.`)
    return r
  })

  ipcMain.handle(IPC.runDiagnostics, async () => {
    sendLog('diag', 'info', 'Running diagnostics...')
    const checks = await runDiagnostics(getDataDir(), process.env.APPDATA ?? '')
    const fails = checks.filter((c) => c.level === 'fail').length
    const warns = checks.filter((c) => c.level === 'warn').length
    sendLog('diag', fails > 0 ? 'warn' : 'info', `Diagnostics done: ${fails} fail, ${warns} warn, ${checks.length} total.`)
    return checks
  })

  ipcMain.handle(IPC.checkBypass, async (_e, id: BypassTargetId) => checkBypassTarget(id))

  ipcMain.handle(IPC.clearDiscordCache, async () => {
    const lines = await clearDiscordCache(process.env.APPDATA ?? '', (t) => sendLog('app', 'info', t), loadSettings().locale)
    return lines
  })

  ipcMain.handle(IPC.removeConflicts, async () => {
    const removed = await removeConflictingServices((t) => sendLog('app', 'info', t), loadSettings().locale)
    return removed
  })

  ipcMain.handle(IPC.configTesterStart, async (_e, strategyIds: string[], mode: ConfigTestMode) => {
    if (configTesterAbort) throw new Error('Config tester is already running — stop it first')
    stopTestInternal()
    const all = listStrategies()
    const picked = Array.isArray(strategyIds) && strategyIds.length > 0
      ? all.filter((s) => strategyIds.includes(s.id))
      : all
    if (picked.length === 0) throw new Error('No strategies selected for testing')
    if (mode !== 'standard' && mode !== 'dpi') throw new Error(`Invalid test mode: ${String(mode).slice(0, 20)}`)
    const abort = new AbortController()
    configTesterAbort = abort
    sendLog('app', 'info', `Starting native config tests (${mode}, ${picked.length} configs)...`)
    // Run in background: progress streams via onConfigTesterEvent + onLog.
    void runConfigTests({
      strategies: picked,
      mode,
      binDir: getBinDir(),
      listsDir: getListsDir(),
      utilsDir: getUtilsDir(),
      dataDir: getDataDir(),
      signal: abort.signal,
      emit: (ev) => {
        safeSend(IPC.onConfigTesterEvent, ev)
        if (ev.kind === 'log') sendLog('app', ev.level, ev.text)
        else if (ev.kind === 'config-start') sendLog('app', 'info', `[${ev.index}/${ev.total}] ${ev.configName}`)
        else if (ev.kind === 'done') {
          sendLog('app', ev.cancelled ? 'warn' : 'info', ev.cancelled ? 'Config tests stopped.' : `Config tests done. Best: ${ev.best ?? 'n/a'}`)
          if (ev.filePath) sendLog('app', 'info', `Results saved to ${ev.filePath}`)
          configTesterAbort = null
        }
      }
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      sendLog('app', 'error', `Config tests failed: ${msg.slice(0, 500)}`)
      safeSend(IPC.onConfigTesterEvent, { kind: 'done', cancelled: false, best: null, filePath: null, rows: [] })
      configTesterAbort = null
    })
    return true
  })

  ipcMain.handle(IPC.configTesterStop, async () => {
    try {
      configTesterAbort?.abort()
    } catch {
      /* ignore */
    }
    configTesterAbort = null
    // PID-targeted via abortActiveChild — never a blanket `taskkill /IM
    // winws.exe`, which would also kill foreign/service winws processes.
    abortActiveChild()
    sendLog('app', 'warn', 'Config tests stop requested.')
    return true
  })

  ipcMain.handle(IPC.configTesterOpenFile, async (_e, filePath: string) => {
    // Reveal the saved results file in Explorer. Restricted to our own
    // `utils/test results` dir so a compromised renderer cannot pop
    // arbitrary paths.
    const raw = String(filePath ?? '').slice(0, 1024)
    if (!raw) throw new Error('Empty file path')
    const resultsDir = path.join(getUtilsDir(), 'test results')
    const resolved = path.resolve(resultsDir, path.basename(raw))
    if (path.dirname(resolved).toLowerCase() !== path.resolve(resultsDir).toLowerCase()) {
      throw new Error('File is outside the test results folder')
    }
    if (!fs.existsSync(resolved)) throw new Error('Results file not found (it may have been deleted)')
    shell.showItemInFolder(resolved)
    return true
  })

  ipcMain.handle(IPC.openBackupFolder, async (_e, backupDir: string) => {
    // Open a strategies-update backup in Explorer. Restricted to our own
    // `data/_backup` dir so a compromised renderer cannot pop arbitrary paths.
    const raw = String(backupDir ?? '').slice(0, 1024)
    if (!raw) throw new Error('Empty backup path')
    const root = path.resolve(path.join(getDataDir(), '_backup'))
    const resolved = path.resolve(root, path.basename(raw))
    if (path.dirname(resolved).toLowerCase() !== root.toLowerCase()) {
      throw new Error('Folder is outside the backups directory')
    }
    if (!fs.existsSync(resolved)) throw new Error('Backup folder not found (it may have been deleted)')
    await shell.openPath(resolved)
    return true
  })

  ipcMain.handle(IPC.getSettings, async () => loadSettings())
  ipcMain.handle(IPC.saveSettings, async (_e, patch: Partial<AppSettings>) => saveSettings(patch))

  // -- Built-in Telegram MTProto→WS proxy (src/main/tg-proxy.ts) --
  ipcMain.handle(IPC.tgProxyStart, async () => {
    const settings = ensureTgProxySecret()
    sendLog('tg-proxy', 'info', `Starting TG proxy on ${settings.tgProxy.host}:${settings.tgProxy.port}...`)
    const bound = await startTgProxy(tgStartOptsFromSettings(settings.tgProxy))
    saveSettings({ tgProxy: { ...settings.tgProxy, enabled: true, port: bound.port } })
    sendLog('tg-proxy', 'info', `TG proxy link: ${buildTgProxyLink(settings.tgProxy, bound)}`)
    safeSend(IPC.tgProxyStatusChanged)
    return true
  })

  ipcMain.handle(IPC.tgProxyStop, async () => {
    await stopTgProxy()
    const settings = loadSettings()
    saveSettings({ tgProxy: { ...settings.tgProxy, enabled: false } })
    sendLog('tg-proxy', 'info', 'TG proxy stopped.')
    safeSend(IPC.tgProxyStatusChanged)
    return true
  })

  ipcMain.handle(IPC.tgProxyRestart, async () => {
    const settings = ensureTgProxySecret()
    await stopTgProxy()
    const bound = await startTgProxy(tgStartOptsFromSettings(settings.tgProxy))
    saveSettings({ tgProxy: { ...settings.tgProxy, enabled: true, port: bound.port } })
    sendLog('tg-proxy', 'info', `TG proxy restarted on ${bound.host}:${bound.port}.`)
    safeSend(IPC.tgProxyStatusChanged)
    return true
  })

  ipcMain.handle(IPC.tgProxyGetStatus, async () => {
    const settings = loadSettings()
    return { ...getTgProxyStatusPayload(), settings: settings.tgProxy, link: buildTgProxyLink(settings.tgProxy, null) }
  })

  ipcMain.handle(IPC.tgProxyGetStats, async () => getTgProxyStats())

  ipcMain.handle(IPC.tgProxyUpdateSettings, async (_e, patch: Partial<TgProxySettings>) => {
    const current = loadSettings().tgProxy
    const next: TgProxySettings = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      port: patch.port !== undefined ? normalizeTgPort(patch.port) : current.port,
      autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : current.autoStart,
      secret: typeof patch.secret === 'string' && isValidTgSecret(patch.secret) ? patch.secret.trim().toLowerCase() : current.secret,
      cfProxyEnabled: typeof patch.cfProxyEnabled === 'boolean' ? patch.cfProxyEnabled : current.cfProxyEnabled,
      host: patch.host !== undefined ? validateTgHost(patch.host) : current.host,
      dcIps: patch.dcIps !== undefined ? validateDcIpEntries(patch.dcIps) : current.dcIps,
      poolSize: patch.poolSize !== undefined ? validatePoolSize(patch.poolSize) : current.poolSize,
      bufferKb: patch.bufferKb !== undefined ? validateBufferKb(patch.bufferKb) : current.bufferKb,
      cfDomains: patch.cfDomains !== undefined ? validateDomainEntries(patch.cfDomains, 'CF domains') : current.cfDomains,
      workerDomains: patch.workerDomains !== undefined ? validateDomainEntries(patch.workerDomains, 'Worker domains') : current.workerDomains,
      fakeTlsDomain: patch.fakeTlsDomain !== undefined ? validateFakeTlsDomain(patch.fakeTlsDomain) : current.fakeTlsDomain,
      forceTestDc: typeof patch.forceTestDc === 'boolean' ? patch.forceTestDc : current.forceTestDc,
      proxyProtocol: typeof patch.proxyProtocol === 'boolean' ? patch.proxyProtocol : current.proxyProtocol
    }
    const saved = saveSettings({ tgProxy: next })
    sendLog('tg-proxy', 'info', `TG proxy settings saved (port=${next.port}, host=${next.host}). Restart the proxy to apply.`)
    safeSend(IPC.tgProxyStatusChanged)
    return saved.tgProxy
  })

  ipcMain.handle(IPC.tgProxyResetSettings, async () => {
    // Defaults, but keep the stable secret (otherwise Telegram must be
    // reconfigured) and the running flag (a live proxy is not orphaned —
    // restart it to apply the defaults).
    const current = loadSettings().tgProxy
    const fresh = normalizeTgProxySettings(undefined)
    const next: TgProxySettings = {
      ...fresh,
      secret: isValidTgSecret(current.secret) ? current.secret : generateTgSecret(),
      enabled: current.enabled
    }
    const saved = saveSettings({ tgProxy: next })
    sendLog('tg-proxy', 'info', 'TG proxy settings reset to defaults. Restart the proxy to apply.')
    safeSend(IPC.tgProxyStatusChanged)
    return saved.tgProxy
  })

  ipcMain.handle(IPC.tgProxyOpenLink, async () => {    // The link is built here from our own settings — the renderer never
    // passes a URL, so a compromised renderer cannot open arbitrary schemes.
    const settings = ensureTgProxySecret()
    const link = buildTgProxyLink(settings.tgProxy, null)
    await shell.openExternal(link)
    sendLog('tg-proxy', 'info', 'TG proxy link opened in Telegram.')
    return true
  })

  ipcMain.handle(IPC.resetAppData, async () => {
    // A foreground winws test holds files in data/bin + lists open — kill it
    // first or the data-dir wipe below fails with EBUSY/EPERM.
    stopTestInternal()
    try {
      configTesterAbort?.abort()
    } catch {
      /* ignore */
    }
    configTesterAbort = null
    abortActiveChild()
    // The TG proxy keeps no data files open, but its `enabled` flag is reset
    // below — stop it first so state and settings stay consistent.
    await stopTgProxy()
    safeSend(IPC.tgProxyStatusChanged)
    sendLog('app', 'warn', 'Resetting app settings and data to defaults...')
    const r = await resetAppData((t) => sendLog('app', 'info', t))
    if (!r.servicesRemoved) {
      sendLog('app', 'warn', 'Services were not removed (admin rights may be required) — files and settings were still reset.')
    } else {
      sendLog('app', 'info', 'App data reset complete.')
    }
    return r
  })

  ipcMain.handle(IPC.listUserLists, async () => listUserLists(getListsDir()))
  ipcMain.handle(IPC.readUserList, async (_e, name: string) => readUserList(getListsDir(), name))
  ipcMain.handle(IPC.saveUserList, async (_e, name: string, content: string) => {
    const meta = writeUserList(getListsDir(), name, content)
    sendLog('app', 'info', `User list ${name} saved (${meta.lines} entries). Restart zapret to apply.`)
    return meta
  })

  ipcMain.handle(IPC.relaunchAsAdmin, async () => {
    const exe = process.execPath
    const ok = await relaunchAppAsAdmin(exe, process.argv.slice(1))
    if (ok && app.isPackaged) {
      // Elevated copy is starting — close this non-admin instance.
      // Delayed so the IPC response is delivered before teardown.
      // (In dev mode we stay alive: a raw elevated electron would lack the dev env.)
      sendLog('app', 'info', 'Restarting with administrator rights — closing this instance.')
      setTimeout(() => app.quit(), 500).unref?.()
    }
    return ok
  })

  ipcMain.handle(IPC.exportLogs, async () => {
    const w = win()
    const locale = loadSettings().locale
    const res = await dialog.showSaveDialog(w ?? undefined as unknown as BrowserWindow, {
      title: translate(locale, 'dialog.exportTitle'),
      defaultPath: `zapret-gui-logs-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: translate(locale, 'dialog.exportFilter'), extensions: ['log', 'txt'] }]
    })
    if (res.canceled || !res.filePath) return null
    try {
      const text = getBufferedLogs().map((l) => `[${l.ts}] [${l.source}/${l.level}] ${l.text}`).join('\n')
      fs.writeFileSync(res.filePath, text, 'utf8')
    } catch (e) {
      throw new Error(`Cannot write log file: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      await shell.openPath(path.dirname(res.filePath))
    } catch {
      /* best-effort: file is already written */
    }
    return res.filePath
  })
}

function stopTestInternal(): void {
  const proc = testProc
  testProc = null
  if (proc && !proc.killed) {
    try {
      proc.kill()
    } catch {
      /* already dead */
    }
    // winws.exe routinely ignores SIGTERM on Windows — finish it by PID
    // (never by image name: that would kill foreign winws processes).
    if (typeof proc.pid === 'number' && proc.pid > 0) {
      void killPidTree(proc.pid)
    }
    sendLog('winws', 'info', 'Test process stopped.')
  }
}

/**
 * Kill every in-flight test process (foreground test + config tester).
 * Called on app exit so no orphaned winws.exe survives a quit.
 */
export function stopAllTesting(): void {
  stopTestInternal()
  try {
    configTesterAbort?.abort()
  } catch {
    /* ignore */
  }
  configTesterAbort = null
  abortActiveChild()
}
