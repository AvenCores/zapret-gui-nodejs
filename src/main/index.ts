/**
 * Electron main entry: window, tray, auto-updater, first-run wizard flag.
 * @module main/index
 */
import { app, BrowserWindow, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { ensureDataDirSeeded, getDataDir, getAppLogPath, getTgProxyLogPath, getBundledAssetsDir, getListsDir } from './paths'
import { initLogger, setLogsEnabled, isLogsEnabled, clearBufferedLogs, info, warn, err, onLog, getBufferedLogs } from './logger'
import type { LogLine } from '../shared/types'
import { setupAutoUpdater } from './app-updater'
import { registerIpcHandlers, listStrategies, stopAllTesting } from './ipc-handlers'
import { setupTray, getTrayLabels, destroyTray, type TrayContext } from './tray'
import { loadSettings, saveSettings, onSettingsChanged } from './settings'
import {
  getStatus,
  startService,
  stopService,
  installStrategy,
  getGameFilterMode,
  setGameFilterMode,
  getIPSetMode,
  setIPSetMode
} from './service-manager'
import { isAdmin, relaunchAppAsAdmin } from './exec'
import { TG_PROXY_RESTART_ARG, ADMIN_RELAUNCH_ARG } from '../shared/constants'
import { IPC } from '../shared/types'
import { translate } from '../shared/i18n'
import type { GameFilterMode, IPSetMode, TrayPage, ZapretStatus } from '../shared/types'
import { ensureTgProxySecret } from './ipc-handlers'
import { getTgProxyStats, getTgProxyStatus, startTgProxy, stopTgProxy, tgStartOptsFromSettings } from './tg-proxy'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
// `onLog` subscription is global (not per-window): createWindow() runs on
// every second-instance/activate, and a per-window subscribe would duplicate
// log delivery N times.
//
// Delivery is batched: tg-proxy emits hundreds of session lines per minute
// and one IPC + one React setState per line kept the renderer (and the
// main process via sync file writes) needlessly hot. Lines are queued and
// flushed as a single `on-logs` array every 400ms (or 100 lines).
let logForwardingArmed = false
let logQueue: LogLine[] = []
let logFlushTimer: NodeJS.Timeout | null = null
function flushLogQueue(): void {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer)
    logFlushTimer = null
  }
  if (logQueue.length === 0) return
  const batch = logQueue
  logQueue = []
  try {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC.onLogs, batch)
    }
  } catch {
    /* renderer gone */
  }
}
function scheduleLogFlush(): void {
  if (logFlushTimer) return
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null
    flushLogQueue()
  }, 400)
  logFlushTimer.unref?.()
}
/** Drop queued (not yet delivered) lines — used when logs are switched off. */
export function dropQueuedLogs(): void {
  logQueue = []
  if (logFlushTimer) {
    clearTimeout(logFlushTimer)
    logFlushTimer = null
  }
}
function armLogForwarding(): void {
  if (logForwardingArmed) return
  logForwardingArmed = true
  onLog((line) => {
    if (!isLogsEnabled()) return
    logQueue.push(line)
    if (logQueue.length >= 100) flushLogQueue()
    else scheduleLogFlush()
  })
}
app.on('before-quit', () => {
  isQuitting = true
  try {
    // A foreground/config test spawns winws.exe directly (no service) —
    // without this it keeps running as an orphan after the app exits.
    stopAllTesting()
  } catch {
    /* best-effort */
  }
  try {
    // The TG proxy is an in-process listener — close it synchronously-ish
    // so the port is released before quit.
    void stopTgProxy().catch(() => undefined)
  } catch {
    /* best-effort */
  }
  destroyTray()
})

// Any settings save (GUI toggles included) rebuilds the tray menu at once
// instead of waiting for the 15s timer tick. The log switch is applied to
// the logger here so `logsEnabled: false` stops all log work instantly and
// drops everything buffered so far (stale tab counters must go to zero).
onSettingsChanged((next) => {
  try {
    setLogsEnabled(next.logsEnabled !== false)
    if (next.logsEnabled === false) {
      dropQueuedLogs()
      clearBufferedLogs()
    }
  } catch {
    /* best-effort */
  }
  void refreshTray()
})

function toTrayStatus(s: string): ZapretStatus {
  if (s === 'RUNNING') return 'running'
  if (s === 'STOPPED') return 'stopped'
  if (s === 'NOT_INSTALLED') return 'not-installed'
  return 'unknown'
}

let refreshTrayRunning = false
let refreshTrayQueued = false
let serviceBusy = false

async function refreshTray(): Promise<void> {
  if (refreshTrayRunning) {
    refreshTrayQueued = true
    return
  }
  refreshTrayRunning = true
  try {
    const settings = loadSettings()
    if (!settings.showTrayIcon) {
      destroyTray()
      return
    }
    const admin = await isAdmin()
    const st = await getStatus(admin)
    const zs = toTrayStatus(st.zapret)
    let strategies: Array<{ id: string; name: string }> = []
    try {
      strategies = listStrategies().map((s) => ({ id: s.id, name: s.name }))
    } catch {
      strategies = []
    }
    let gameFilter: GameFilterMode = 'disabled'
    try {
      gameFilter = getGameFilterMode(getDataDir())
    } catch {
      /* best-effort */
    }
    let ipset: IPSetMode = 'none'
    try {
      ipset = getIPSetMode(getListsDir())
    } catch {
      /* best-effort */
    }
    let tgProxy: 'running' | 'stopped' | 'error' = 'stopped'
    let tgProxyPort = settings.tgProxy.port
    try {
      tgProxy = getTgProxyStatus().status
      tgProxyPort = getTgProxyStats().port
    } catch {
      /* best-effort */
    }
    const ctx: TrayContext = {
      isAdmin: admin,
      ownership: st.ownership,
      activeStrategy: st.activeStrategy,
      activeStrategyId: settings.activeStrategyId,
      strategies,
      totalStrategies: strategies.length,
      gameFilter,
      ipset,
      autoLaunch: settings.autoLaunch,
      minimizeToTray: settings.minimizeToTrayOnClose,
      startMinimized: settings.startMinimizedToTray,
      tgProxy,
      tgProxyPort,
      version: app.getVersion(),
      trayStrategyMenu: settings.trayStrategyMenu,
      trayServiceMenu: settings.trayServiceMenu,
      trayNavigateMenu: settings.trayNavigateMenu,
      trayGameFilterMenu: settings.trayGameFilterMenu,
      trayIPSetMenu: settings.trayIPSetMenu,
      trayToolsMenu: settings.trayToolsMenu,
      trayQuickSettings: settings.trayQuickSettings
    }
    // Labels follow the app language (also refreshed by the 15s timer,
    // so a language switch applies to the tray shortly after).
    setupTray(zs, getTrayLabels(settings.locale, zs), ctx, trayCallbacks())
  } catch {
    /* tray refresh is best-effort */
  } finally {
    refreshTrayRunning = false
    if (refreshTrayQueued) {
      refreshTrayQueued = false
      void refreshTray()
    }
  }
}

function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

function toggleMainWindow(): void {
  const w = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!w) {
    createWindow()
    return
  }
  if (w.isVisible() && w.isFocused()) {
    w.hide()
  } else {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
}

/** Tell the renderer its cached status/strategies/settings may be stale. */
function notifyRenderer(): void {
  try {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC.statusChanged)
      mainWindow.webContents.send(IPC.tgProxyStatusChanged)
    }
  } catch {
    /* renderer gone */
  }
}

function navigateTo(page: TrayPage): void {
  showMainWindow()
  try {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC.navigate, page)
    }
  } catch {
    /* renderer gone */
  }
}

/**
 * Service control straight from the tray (no renderer round-trip: the old
 * `webContents.send('zapret:tray-start')` only worked while the Dashboard
 * page was mounted and subscribed).
 */
async function serviceAction(kind: 'start' | 'stop' | 'restart'): Promise<void> {
  if (serviceBusy) return
  serviceBusy = true
  try {
    const st = await getStatus(await isAdmin())
    if (st.ownership === 'foreign') {
      // A third-party service must not be touched — explain in the app.
      navigateTo('dashboard')
      return
    }
    if (kind === 'start') await startService()
    else if (kind === 'stop') await stopService()
    else {
      await stopService().catch(() => undefined)
      await startService()
    }
    info('app', `Service ${kind} from tray: OK.`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    err('app', `Tray ${kind} failed: ${msg.slice(0, 300)}`)
    dialog.showErrorBox('Zapret GUI', msg.slice(0, 500))
  } finally {
    serviceBusy = false
    notifyRenderer()
    await refreshTray()
  }
}

/** Apply a strategy straight from the tray submenu. */
async function applyStrategyFromTray(id: string): Promise<void> {
  // Same guard as serviceAction: double-clicking two strategies must not
  // run concurrent `sc delete/create` cycles.
  if (serviceBusy) return
  serviceBusy = true
  try {
    const st = await getStatus(await isAdmin())
    if (st.ownership === 'foreign') {
      // A third-party service must not be touched — explain in the app.
      navigateTo('strategies')
      return
    }
    const s = listStrategies().find((x) => x.id === id) ?? null
    if (!s) {
      navigateTo('strategies')
      return
    }
    info('app', `Installing strategy "${s.name}" from tray...`)
    await installStrategy(s, getDataDir(), (t) => info('app', t))
    saveSettings({ activeStrategyId: s.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    err('app', `Tray strategy install failed: ${msg.slice(0, 300)}`)
    dialog.showErrorBox('Zapret GUI', msg.slice(0, 500))
  } finally {
    serviceBusy = false
    notifyRenderer()
    await refreshTray()
  }
}

/** Start/stop/restart the built-in TG proxy straight from the tray. */
async function tgProxyAction(kind: 'start' | 'stop' | 'restart'): Promise<void> {
  if (serviceBusy) return
  serviceBusy = true
  try {
    if (kind === 'stop') {
      await stopTgProxy()
      const s = loadSettings()
      saveSettings({ tgProxy: { ...s.tgProxy, enabled: false } })
      info('tg-proxy', 'TG proxy stopped from tray.')
    } else {
      const s = ensureTgProxySecret()
      if (kind === 'restart') await stopTgProxy().catch(() => undefined)
      const bound = await startTgProxy(tgStartOptsFromSettings(s.tgProxy))
      saveSettings({ tgProxy: { ...s.tgProxy, enabled: true, port: bound.port } })
      info('tg-proxy', `TG proxy ${kind} from tray: ${bound.host}:${bound.port}.`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    err('tg-proxy', `Tray TG proxy ${kind} failed: ${msg.slice(0, 300)}`)
    dialog.showErrorBox('Zapret GUI', msg.slice(0, 500))
  } finally {
    serviceBusy = false
    notifyRenderer()
    await refreshTray()
  }
}

/**
 * Start the TG proxy with retries. Needed after admin handover: the old
 * non-admin instance quits with a delay, so the first bind attempt can hit
 * EADDRINUSE while the old listener is still releasing the port. Without
 * retries the proxy stays in "Ошибка" until the user presses Start manually.
 */
async function startTgProxyWithRetry(tag: string, maxAttempts = 6, delayMs = 1000): Promise<void> {
  const withSecret = ensureTgProxySecret()
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const bound = await startTgProxy(tgStartOptsFromSettings(withSecret.tgProxy))
      info('tg-proxy', `Autostarted on ${bound.host}:${bound.port} (${tag}).`)
      saveSettings({ tgProxy: { ...withSecret.tgProxy, enabled: true, port: bound.port } })
      notifyRenderer()
      void refreshTray()
      return
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      if (attempt < maxAttempts) {
        warn('tg-proxy', `Autostart attempt ${attempt}/${maxAttempts} failed (${tag}): ${msg} — retrying.`)
        await new Promise((r) => setTimeout(r, delayMs))
      } else {
        err('tg-proxy', `Autostart failed (${tag}): ${msg}`)
        notifyRenderer()
        void refreshTray()
      }
    }
  }
}

function trayCallbacks() {
  return {
    onShow: () => {
      showMainWindow()
    },
    onToggleWindow: () => {
      toggleMainWindow()
    },
    onStart: () => {
      void serviceAction('start')
    },
    onStop: () => {
      void serviceAction('stop')
    },
    onRestart: () => {
      void serviceAction('restart')
    },
    onTgProxyStart: () => {
      void tgProxyAction('start')
    },
    onTgProxyStop: () => {
      void tgProxyAction('stop')
    },
    onTgProxyRestart: () => {
      void tgProxyAction('restart')
    },
    onNavigate: (page: TrayPage) => {
      navigateTo(page)
    },
    onPickStrategy: (id: string) => {
      void applyStrategyFromTray(id)
    },
    onGameFilter: (mode: GameFilterMode) => {
      try {
        setGameFilterMode(getDataDir(), mode)
        info('app', `Game filter → ${mode} (from tray). Restart zapret to apply.`)
      } catch (e) {
        dialog.showErrorBox('Zapret GUI', e instanceof Error ? e.message : String(e))
      } finally {
        notifyRenderer()
        void refreshTray()
      }
    },
    onIPSet: (mode: IPSetMode) => {
      try {
        setIPSetMode(getListsDir(), mode)
        info('app', `IPSet mode → ${mode} (from tray). Restart zapret to apply.`)
      } catch (e) {
        dialog.showErrorBox('Zapret GUI', e instanceof Error ? e.message : String(e))
      } finally {
        notifyRenderer()
        void refreshTray()
      }
    },
    onToggleSetting: (key: 'autoLaunch' | 'minimizeToTrayOnClose' | 'startMinimizedToTray' | 'showTrayIcon') => {
      try {
        const cur = loadSettings()
        saveSettings({ [key]: !cur[key] } as Partial<Parameters<typeof saveSettings>[0]>)
        info('app', `Setting ${key} → ${String(!cur[key])} (from tray).`)
      } catch (e) {
        dialog.showErrorBox('Zapret GUI', e instanceof Error ? e.message : String(e))
      } finally {
        notifyRenderer()
        void refreshTray()
      }
    },
    onRelaunchAdmin: () => {
      void (async () => {
        // Same TG-proxy handover as the IPC handler: free the listen port
        // before the elevated copy starts, or it fails with EADDRINUSE.
        let tgHandover = false
        if (app.isPackaged) {
          try {
            if (getTgProxyStatus().status === 'running') {
              tgHandover = true
              info('tg-proxy', 'Stopping TG proxy listener for admin handover (elevated copy will restart it).')
              await stopTgProxy().catch(() => undefined)
            }
          } catch {
            /* best-effort */
          }
        }
        const args = [...process.argv.slice(1)]
        if (tgHandover && !args.includes(TG_PROXY_RESTART_ARG)) args.push(TG_PROXY_RESTART_ARG)
        if (!args.includes(ADMIN_RELAUNCH_ARG)) args.push(ADMIN_RELAUNCH_ARG)
        try {
          app.releaseSingleInstanceLock()
        } catch {
          /* best-effort */
        }
        const ok = await relaunchAppAsAdmin(process.execPath, args)
        if (ok && app.isPackaged) {
          info('app', 'Restarting with administrator rights — closing this instance.')
          setTimeout(() => app.quit(), 1000).unref?.()
        } else {
          try {
            app.requestSingleInstanceLock()
          } catch {
            /* best-effort */
          }
          if (tgHandover) {
            try {
              const s = ensureTgProxySecret()
              const bound = await startTgProxy(tgStartOptsFromSettings(s.tgProxy))
              saveSettings({ tgProxy: { ...s.tgProxy, enabled: true, port: bound.port } })
              info('tg-proxy', `TG proxy restored locally on ${bound.host}:${bound.port} (admin relaunch cancelled).`)
            } catch (e) {
              err('tg-proxy', `TG proxy restore failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`)
            }
            notifyRenderer()
            void refreshTray()
          }
        }
      })()
    },
    onOpenData: () => {
      try {
        void shell.openPath(getDataDir()).catch(() => undefined)
      } catch {
        /* getDataDir failed — nothing to open */
      }
    },
    onExportLogs: () => {
      void (async () => {
        try {
          const locale = loadSettings().locale
          const res = await dialog.showSaveDialog(mainWindow ?? undefined as unknown as BrowserWindow, {
            title: translate(locale, 'dialog.exportTitle'),
            defaultPath: `zapret-gui-logs-${new Date().toISOString().slice(0, 10)}.log`,
            filters: [{ name: translate(locale, 'dialog.exportFilter'), extensions: ['log', 'txt'] }]
          })
          if (res.canceled || !res.filePath) return
          const text = getBufferedLogs()
            .map((l) => `[${l.ts}] [${l.source}/${l.level}] ${l.text}`)
            .join('\n')
          fs.writeFileSync(res.filePath, text, 'utf8')
          await shell.openPath(path.dirname(res.filePath))
        } catch (e) {
          err('app', `Export logs failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      })()
    },
    onQuit: () => {
      destroyTray()
      app.quit()
    }
  }
}

function createWindow(): void {
  const settings = loadSettings()
  mainWindow = new BrowserWindow({
    width: 1625,
    height: 935,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'Zapret GUI',
    icon: path.join(getBundledAssetsDir(), 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    // After "relaunch as admin" the window always shows: the user clicked a
    // button and expects to see the elevated app, even with startMinimizedToTray.
    if (settings.startMinimizedToTray && !process.argv.includes(ADMIN_RELAUNCH_ARG)) {
      // Start hidden in tray; user opens via tray icon.
    } else {
      mainWindow?.show()
    }
    void refreshTray()
  })

  mainWindow.on('close', (e) => {
    const s = loadSettings()
    // Without a tray icon there is nowhere to minimize to — let it quit.
    if (s.minimizeToTrayOnClose && s.showTrayIcon && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Keep checkbox/menu state fresh when the window (and settings) reappears.
  mainWindow.on('show', () => {
    void refreshTray()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Stream buffered + future logs to the renderer (subscribed once globally).
  armLogForwarding()

  if (process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    // Vite may need a second to start; Electron otherwise shows a white
    // screen with ERR_CONNECTION_REFUSED and never retries.
    const loadWithRetry = (attempt = 0): void => {
      mainWindow
        ?.loadURL(devUrl)
        .catch(() => {
          if (attempt < 20) setTimeout(() => loadWithRetry(attempt + 1), 500)
        })
    }
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      err('app', `did-fail-load ${code} ${desc} ${url}`)
      if (url === devUrl) loadWithRetry()
    })
    loadWithRetry()
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}



async function firstRunCheck(): Promise<void> {
  // Master-setup hint: no strategy ever installed + no settings choice yet.
  const settings = loadSettings()
  if (settings.activeStrategyId) return
  try {
    const st = await getStatus(await isAdmin())
    if (st.activeStrategy || st.zapret !== 'NOT_INSTALLED') return
  } catch {
    return
  }
  const strategies = listStrategies()
  const names = strategies.slice(0, 5).map((s) => s.name).join(', ')
  const locale = settings.locale
  void dialog
    .showMessageBox({
      type: 'info',
      title: `Zapret GUI — ${translate(locale, 'wizard.title')}`,
      message: translate(locale, 'wizard.step1'),
      detail: `${translate(locale, 'wizard.step2')} ${translate(locale, 'wizard.available').replace('{names}', names)}`,
      buttons: ['OK']
    })
    .catch(() => undefined)
  saveSettings({})
}

// Dev mode: keep Chromium caches out of the installed app's userData dir.
// A dev instance and the installed app running side by side lock each
// other's disk caches ("Unable to create cache (0x5)"). Must run before ready.
if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
  app.setPath('userData', path.join(app.getPath('appData'), 'zapret-gui-dev'))
  // Reduce disk-cache locking on Windows (access denied 0x5 when a stale
  // Electron process still holds the Cache folder).
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-http-cache')
}

// Single instance: a second launch only focuses the running app instead of
// spawning a duplicate tray icon that would fight over the same service.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.zapret.gui')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    try {
      initLogger(getAppLogPath(), getTgProxyLogPath())
      try {
        setLogsEnabled(loadSettings().logsEnabled !== false)
      } catch {
        /* defaults to on */
      }
      ensureDataDirSeeded()
    } catch (e) {
      // A broken %APPDATA% / AV lock must not silently kill startup.
      console.error(`Startup seeding failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      info('app', `Zapret GUI starting. Data dir: ${getDataDir()}`)
    } catch {
      /* logging is best-effort */
    }

    registerIpcHandlers()
    createWindow()
    setupAutoUpdater()
    // Autostart the built-in TG proxy when enabled (best effort — a busy
    // port must never break app startup). After "relaunch as admin" the old
    // instance may still hold the port for ~1s, so start with retries.
    // With the handover marker the proxy restarts even if autoStart is off:
    // it was running before the relaunch and the old instance freed the port
    // specifically for us.
    try {
      const s = loadSettings()
      const handover = process.argv.includes(TG_PROXY_RESTART_ARG)
      if (handover) {
        info('tg-proxy', 'Admin handover detected — restarting TG proxy.')
        void startTgProxyWithRetry('admin-handover')
      } else if (s.tgProxy.autoStart) {
        void startTgProxyWithRetry('autoStart')
      }
    } catch {
      /* best-effort */
    }
    void firstRunCheck().catch(() => undefined)
    void refreshTray()
    setInterval(() => {
      void refreshTray()
    }, 15000).unref?.()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((e) => {
    console.error(`app.whenReady failed: ${e instanceof Error ? e.message : String(e)}`)
  })
}

app.on('window-all-closed', () => {
  // Keep running in tray on Windows.
  if (process.platform !== 'win32') app.quit()
})
