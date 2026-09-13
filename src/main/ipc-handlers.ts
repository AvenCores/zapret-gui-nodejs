/**
 * All IPC handlers between the renderer and main processes.
 * Long-running outputs (test run, downloads) stream back via
 * `zapret:on-test-output` / `zapret:on-download-progress` events.
 * @module main/ipc-handlers
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
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
  clearDiscordCache
} from './service-manager'
import { parseBatContent, materializeArgs, quoteArg } from './strategy-parser'
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
import { loadSettings, saveSettings } from './settings'
import { getBufferedLogs, info, warn, err } from './logger'
import { isAdmin, relaunchAppAsAdmin, spawnLong } from './exec'
import { WINWS_EXE } from '../shared/constants'

let testProc: ChildProcess | null = null

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function sendLog(source: 'app' | 'winws' | 'updater' | 'diag', level: 'info' | 'warn' | 'error', text: string): void {
  const line =
    level === 'error' ? err(source, text) : level === 'warn' ? warn(source, text) : info(source, text)
  win()?.webContents.send(IPC.onLog, line)
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
          out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Strategy)
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
    const res = await dialog.showOpenDialog(w ?? undefined as unknown as BrowserWindow, {
      title: 'Import .bat strategy',
      filters: [{ name: 'BAT strategy', extensions: ['bat'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    const content = fs.readFileSync(file, 'utf8')
    const { strategy, warnings } = parseBatContent(content, path.basename(file))
    for (const warnText of warnings) sendLog('app', 'warn', `Import warnings: ${warnText}`)
    fs.mkdirSync(getStrategiesDir(), { recursive: true })
    fs.writeFileSync(path.join(getStrategiesDir(), `${strategy.id}.json`), JSON.stringify(strategy, null, 2), 'utf8')
    // Keep the original .bat next to it for reference.
    fs.copyFileSync(file, path.join(getStrategiesDir(), strategy.fileName))
    sendLog('app', 'info', `Imported strategy "${strategy.name}".`)
    return strategy
  })

  ipcMain.handle(IPC.testStrategy, async (_e, strategyId: string) => {
    stopTestInternal()
    const s = findStrategy(strategyId)
    if (!s) throw new Error(`Strategy not found: ${strategyId}`)
    const { tcp, udp } = resolveGameFilterPorts(getDataDir())
    const args = materializeArgs(s.args, { binDir: getBinDir(), listsDir: getListsDir(), gameTcp: tcp, gameUdp: udp })
    const exe = path.join(getBinDir(), WINWS_EXE)
    if (!fs.existsSync(exe)) throw new Error(`winws.exe not found in ${getBinDir()}`)
    sendLog('winws', 'info', `Starting foreground test: winws.exe ${args.map(quoteArg).join(' ')}`)
    testProc = spawnLong(exe, args, getBinDir())
    testProc.stdout?.on('data', (d: Buffer) => win()?.webContents.send(IPC.onTestOutput, { stream: 'stdout', text: String(d) }))
    testProc.stderr?.on('data', (d: Buffer) => win()?.webContents.send(IPC.onTestOutput, { stream: 'stderr', text: String(d) }))
    testProc.on('exit', (code) => {
      sendLog('winws', 'info', `Test process exited with code ${code}`)
      testProc = null
      win()?.webContents.send(IPC.onTestOutput, { stream: 'exit', text: String(code ?? '') })
    })
    return true
  })

  ipcMain.handle(IPC.stopTest, async () => {
    stopTestInternal()
    return true
  })

  ipcMain.handle(IPC.getGameFilter, async () => getGameFilterMode(getDataDir()))
  ipcMain.handle(IPC.setGameFilter, async (_e, mode: GameFilterMode) => {
    setGameFilterMode(getDataDir(), mode)
    sendLog('app', 'info', `Game filter → ${mode}. Restart zapret to apply.`)
    return true
  })

  ipcMain.handle(IPC.getIPSetMode, async () => getIPSetMode(getListsDir()))
  ipcMain.handle(IPC.setIPSetMode, async (_e, mode: IPSetMode) => {
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
    await applyHosts(remoteContent)
    sendLog('app', 'info', 'System hosts updated (backup: hosts.zapret-gui.bak).')
    return true
  })

  ipcMain.handle(IPC.updateStrategies, async () => {
    const w = win()
    const r = await updateStrategiesFromGithub(
      getDataDir(),
      (p) => w?.webContents.send(IPC.onDownloadProgress, p),
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

  ipcMain.handle(IPC.clearDiscordCache, async () => {
    const lines = await clearDiscordCache(process.env.APPDATA ?? '', (t) => sendLog('app', 'info', t))
    return lines
  })

  ipcMain.handle(IPC.removeConflicts, async () => {
    const removed = await removeConflictingServices((t) => sendLog('app', 'info', t))
    return removed
  })

  ipcMain.handle(IPC.runTests, async () => {
    const script = path.join(getUtilsDir(), 'test zapret.ps1')
    if (!fs.existsSync(script)) throw new Error('Test script not found (utils/test zapret.ps1)')
    // Open in its own PowerShell window like service.bat does.
    const { spawn } = await import('node:child_process')
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      cwd: getDataDir(),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    }).unref()
    sendLog('app', 'info', 'Test script launched in a separate PowerShell window.')
    return true
  })

  ipcMain.handle(IPC.getSettings, async () => loadSettings())
  ipcMain.handle(IPC.saveSettings, async (_e, patch: Partial<AppSettings>) => saveSettings(patch))

  ipcMain.handle(IPC.relaunchAsAdmin, async () => {
    const exe = process.execPath
    return relaunchAppAsAdmin(exe, process.argv.slice(1))
  })

  ipcMain.handle(IPC.exportLogs, async () => {
    const w = win()
    const res = await dialog.showSaveDialog(w ?? undefined as unknown as BrowserWindow, {
      title: 'Export logs',
      defaultPath: `zapret-gui-logs-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }]
    })
    if (res.canceled || !res.filePath) return null
    const text = getBufferedLogs().map((l) => `[${l.ts}] [${l.source}/${l.level}] ${l.text}`).join('\n')
    fs.writeFileSync(res.filePath, text, 'utf8')
    await shell.openPath(path.dirname(res.filePath))
    return res.filePath
  })
}

function stopTestInternal(): void {
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
