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
import type { AppSettings, GameFilterMode, IPSetMode, Strategy } from '../shared/types'
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
  updateStrategiesFromGithub,
  listAvailableFakes,
  replaceActiveFake
} from './strategy-updater'
import { getDataDir, getBinDir, getListsDir, getStrategiesDir, getUtilsDir, getBundledAssetsDir } from './paths'
import { listUserLists, readUserList, writeUserList } from './user-lists'
import { checkBypassTarget } from './bypass-check'
import type { BypassTargetId } from '../shared/types'
import { loadSettings, saveSettings } from './settings'
import { translate } from '../shared/i18n'
import { getBufferedLogs, info, warn, err } from './logger'
import { isAdmin, relaunchAppAsAdmin, spawnLong } from './exec'
import { WINWS_EXE } from '../shared/constants'
import { abortActiveChild, runConfigTests } from './config-tester'
import type { ConfigTestMode } from '../shared/types'

let testProc: ChildProcess | null = null
let configTesterAbort: AbortController | null = null

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function safeSend(channel: string, ...args: unknown[]): void {
  try {
    const w = win()
    if (!w || w.webContents.isDestroyed()) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    w.webContents.send(channel, ...(args as any[]))
  } catch {
    /* renderer gone — best effort */
  }
}

function sendLog(source: 'app' | 'winws' | 'updater' | 'diag', level: 'info' | 'warn' | 'error', text: string): void {
  const line =
    level === 'error' ? err(source, text) : level === 'warn' ? warn(source, text) : info(source, text)
  safeSend(IPC.onLog, line)
}

/** Read strategies from data dir (seeded from bundled assets on first run). */
export function listStrategies(): Strategy[] {
  const dirs = [getStrategiesDir(), path.join(getBundledAssetsDir(), 'strategies')]
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue
      const out: Strategy[] = []
      for (const f of fs.readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.json')) continue
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Strategy
          // Configs generated before `origin` existed count as bundled.
          if (parsed.origin !== 'imported') parsed.origin = 'bundled'
          out.push(parsed)
        } catch {
          /* skip broken file */
        }
      }
      if (out.length > 0) return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    } catch {
      /* try next dir */
    }
  }
  return []
}

function findStrategy(id: string): Strategy | null {
  return listStrategies().find((s) => s.id === id) ?? null
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.getStatus, async () => getStatus(await isAdmin()))
  ipcMain.handle(IPC.getPlatform, async () => process.platform)

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
    stopTestInternal()
    const s = findStrategy(strategyId)
    if (!s) throw new Error(`Strategy not found: ${strategyId}`)
    if (process.platform === 'linux') {
      const { testLinuxStrategy } = await import('./linux/service')
      const proc = await testLinuxStrategy(
        s,
        getDataDir(),
        (t) => sendLog('winws', 'info', t),
        (stream, text) => safeSend(IPC.onTestOutput, { stream, text })
      )
      testProc = proc as unknown as ChildProcess
      proc.on('error', (e: Error) => {
        sendLog('winws', 'error', `Test process failed to start: ${String(e).slice(0, 300)}`)
        if (testProc === (proc as unknown as ChildProcess)) testProc = null
        safeSend(IPC.onTestOutput, { stream: 'exit', text: '1' })
      })
      proc.on('exit', (code: number | null) => {
        sendLog('winws', 'info', `Test process exited with code ${code}`)
        if (testProc === (proc as unknown as ChildProcess)) testProc = null
        safeSend(IPC.onTestOutput, { stream: 'exit', text: String(code ?? '') })
      })
      return true
    }
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
    if (process.platform === 'linux') {
      const { stopLinuxTest } = await import('./linux/service')
      stopLinuxTest()
      testProc = null
      return true
    }
    stopTestInternal()
    return true
  })

  ipcMain.handle(IPC.getGameFilter, async () => {
    const mode = getGameFilterMode(getDataDir())
    if (process.platform === 'linux') {
      // conf.env is authoritative for the service; adopt it when present so
      // the Strategies page never shows a stale flag-file value.
      const { loadLinuxConf } = await import('./linux/config')
      const conf = loadLinuxConf(getDataDir())
      if (conf) {
        if (conf.gamefiltertcp && conf.gamefilterudp) return 'all' as const
        if (conf.gamefiltertcp) return 'tcp' as const
        if (conf.gamefilterudp) return 'udp' as const
        return 'disabled' as const
      }
    }
    return mode
  })
  ipcMain.handle(IPC.setGameFilter, async (_e, mode: GameFilterMode) => {
    if (mode !== 'disabled' && mode !== 'all' && mode !== 'tcp' && mode !== 'udp') {
      throw new Error(`Invalid game filter mode: ${String(mode).slice(0, 50)}`)
    }
    setGameFilterMode(getDataDir(), mode)
    if (process.platform === 'linux') {
      // Keep conf.env in sync (the Linux service reads gamefiltertcp/udp
      // from there, not from the flag file).
      const { loadLinuxConf, saveLinuxConf } = await import('./linux/config')
      const prev = loadLinuxConf(getDataDir())
      if (prev) {
        saveLinuxConf(getDataDir(), {
          ...prev,
          gamefiltertcp: mode === 'all' || mode === 'tcp',
          gamefilterudp: mode === 'all' || mode === 'udp'
        })
      }
    }
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

  ipcMain.handle(IPC.updateIPSet, async () => {
    sendLog('updater', 'info', 'Updating IPSet list...')
    const r = await updateIPSetList()
    sendLog('updater', 'info', `IPSet updated: ${r.lines} lines.`)
    return r
  })

  ipcMain.handle(IPC.updateHosts, async () => checkHosts())
  ipcMain.handle(IPC.applyHosts, async (_e, remoteContent: string) => {
    if (!(await isAdmin())) {
      throw new Error(
        process.platform === 'linux'
          ? 'Root rights are required to update /etc/hosts. Run the app as root (or set up passwordless sudo) and retry.'
          : 'Administrator rights are required to update the system hosts file. Click "Restart as administrator" and retry.'
      )
    }
    await applyHosts(remoteContent)
    sendLog('app', 'info', 'System Hosts updated (backup: hosts.zapret-gui.bak).')
    return true
  })

  ipcMain.handle(IPC.updateStrategies, async () => {
    const r = await updateStrategiesFromGithub(
      getDataDir(),
      (p) => safeSend(IPC.onDownloadProgress, p),
      (t) => sendLog('updater', 'info', t)
    )
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
    if (process.platform === 'linux') {
      const { clearDiscordCacheLinux } = await import('./discord-cache-linux')
      return clearDiscordCacheLinux((t) => sendLog('app', 'info', t), loadSettings().locale)
    }
    const lines = await clearDiscordCache(process.env.APPDATA ?? '', (t) => sendLog('app', 'info', t), loadSettings().locale)
    return lines
  })

  ipcMain.handle(IPC.removeConflicts, async () => {
    if (process.platform === 'linux') {
      // No GoodbyeDPI-style services on Linux; report none (keeps UI working).
      sendLog('app', 'info', 'No conflicting services on Linux.')
      return []
    }    const removed = await removeConflictingServices((t) => sendLog('app', 'info', t), loadSettings().locale)
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
    abortActiveChild()
    try {
      const { runCmd } = await import('./exec')
      await runCmd('taskkill /IM winws.exe /F >nul 2>&1', 8000)
    } catch {
      /* best-effort */
    }
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

  // ---- Linux: interfaces / firewall / init / permissions / deps ----
  ipcMain.handle(IPC.listInterfaces, async () => {
    if (process.platform !== 'linux') return []
    const { listNetworkInterfaces } = await import('./linux/service')
    return listNetworkInterfaces()
  })

  ipcMain.handle(IPC.setInterface, async (_e, iface: string) => {
    if (process.platform !== 'linux') throw new Error('Network interface is Linux-only')
    const name = String(iface ?? '').slice(0, 32)
    if (!/^[A-Za-z0-9._-]+$/.test(name) && name !== 'any') throw new Error(`Invalid interface: ${name.slice(0, 32)}`)
    const { loadLinuxConf, saveLinuxConf } = await import('./linux/config')
    const prev = loadLinuxConf(getDataDir()) ?? {
      interface: 'any',
      gamefiltertcp: false,
      gamefilterudp: false,
      strategy: '',
      firewall_backend: 'auto' as const
    }
    if (!prev.strategy) throw new Error('Apply a strategy first — conf.env does not exist yet')
    saveLinuxConf(getDataDir(), { ...prev, interface: name })
    sendLog('app', 'info', `Network interface → ${name}. Restart zapret to apply.`)
    return name
  })

  ipcMain.handle(IPC.getFirewallBackend, async () => {
    if (process.platform !== 'linux') return 'auto'
    const { loadLinuxConf } = await import('./linux/config')
    return loadLinuxConf(getDataDir())?.firewall_backend ?? 'auto'
  })

  ipcMain.handle(IPC.setFirewallBackend, async (_e, backend: string) => {
    if (process.platform !== 'linux') throw new Error('Firewall backend is Linux-only')
    if (backend !== 'auto' && backend !== 'nftables' && backend !== 'iptables') {
      throw new Error(`Invalid firewall backend: ${String(backend).slice(0, 30)}`)
    }
    const { loadLinuxConf, saveLinuxConf } = await import('./linux/config')
    const prev = loadLinuxConf(getDataDir()) ?? {
      interface: 'any',
      gamefiltertcp: false,
      gamefilterudp: false,
      strategy: '',
      firewall_backend: 'auto' as const
    }
    if (!prev.strategy) throw new Error('Apply a strategy first — conf.env does not exist yet')
    saveLinuxConf(getDataDir(), { ...prev, firewall_backend: backend as 'auto' | 'nftables' | 'iptables' })
    sendLog('app', 'info', `Firewall backend → ${backend}. Restart zapret to apply.`)
    return backend
  })

  ipcMain.handle(IPC.listFirewallBackends, async () => {
    if (process.platform !== 'linux') return []
    const { listAvailableBackends } = await import('./linux/firewall')
    return listAvailableBackends()
  })

  ipcMain.handle(IPC.getInitSystem, async () => {
    if (process.platform !== 'linux') return 'unknown'
    const { detectInitSystem } = await import('./linux/init-system')
    return detectInitSystem()
  })

  ipcMain.handle(IPC.getPermissionsStatus, async () => {
    if (process.platform !== 'linux') throw new Error('Permissions setup is Linux-only')
    const { getLinuxPermissionsStatus } = await import('./linux/service')
    return getLinuxPermissionsStatus(getDataDir())
  })

  ipcMain.handle(IPC.setupPermissions, async () => {
    if (process.platform !== 'linux') throw new Error('Permissions setup is Linux-only')
    const { setupLinuxPermissions } = await import('./linux/service')
    sendLog('app', 'info', 'Configuring passwordless sudo/doas (NOPASSWD)...')
    await setupLinuxPermissions(getDataDir(), (t) => sendLog('app', 'info', t))
    return true
  })

  ipcMain.handle(IPC.downloadEngineDeps, async (_e, version?: string) => {
    const { LINUX_ZAPRET_RECOMMENDED_VERSION } = await import('./linux/constants')
    const want = String(version ?? LINUX_ZAPRET_RECOMMENDED_VERSION).slice(0, 64) || LINUX_ZAPRET_RECOMMENDED_VERSION
    const binDir = getBinDir()
    if (process.platform === 'linux') {
      const { downloadNfqws, currentPlatformDir } = await import('./linux/download')
      sendLog('updater', 'info', `Downloading nfqws ${want} ...`)
      const nfqwsPath = await downloadNfqws(want, binDir, {
        onLog: (t) => sendLog('updater', 'info', t),
        onProgress: (p) => safeSend(IPC.onDownloadProgress, { percent: p.percent, transferred: 0, total: null })
      })
      return { enginePath: nfqwsPath, engineVersion: want, platformDir: currentPlatformDir() }
    }
    const { downloadWinws, currentWindowsPlatformDir } = await import('./win-engine')
    sendLog('updater', 'info', `Downloading winws.exe ${want} ...`)
    const enginePath = await downloadWinws(want, binDir, {
      onLog: (t) => sendLog('updater', 'info', t),
      onProgress: (p) => safeSend(IPC.onDownloadProgress, { percent: p.percent, transferred: 0, total: null })
    })
    return { enginePath, engineVersion: want, platformDir: currentWindowsPlatformDir() }
  })

  ipcMain.handle(IPC.listZapretVersions, async () => {
    const { listZapretVersions } = await import('./linux/download')
    return listZapretVersions()
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
  if (process.platform === 'linux') {
    // Elevated nfqws tests need pkill + firewall cleanup, not just child.kill().
    void import('./linux/service').then(({ stopLinuxTest }) => stopLinuxTest()).catch(() => undefined)
  }
  if (testProc && !testProc.killed) {
    try {
      testProc.kill()
    } catch {
      /* already dead */
    }
    sendLog('winws', 'info', 'Test process stopped.')
  }
  testProc = null
}
