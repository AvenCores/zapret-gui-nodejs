/**
 * Electron main entry: window, tray, auto-updater, first-run wizard flag.
 * @module main/index
 */
import { app, BrowserWindow, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { ensureDataDirSeeded, getDataDir, getAppLogPath, getBundledAssetsDir, getListsDir } from './paths'
import { initLogger, info, err, onLog, getBufferedLogs } from './logger'
import { registerIpcHandlers, listStrategies } from './ipc-handlers'
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
import { IPC } from '../shared/types'
import { translate } from '../shared/i18n'
import type { GameFilterMode, IPSetMode, TrayPage, ZapretStatus } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
// `onLog` subscription is global (not per-window): createWindow() runs on
// every second-instance/activate, and a per-window subscribe would duplicate
// log delivery N times.
let logForwardingArmed = false
function armLogForwarding(): void {
  if (logForwardingArmed) return
  logForwardingArmed = true
  onLog((line) => {
    try {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC.onLog, line)
      }
    } catch {
      /* renderer gone */
    }
  })
}
app.on('before-quit', () => {
  isQuitting = true
  destroyTray()
})

// Any settings save (GUI toggles included) rebuilds the tray menu at once
// instead of waiting for the 15s timer tick.
onSettingsChanged(() => {
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
      version: app.getVersion(),
      trayStrategyMenu: settings.trayStrategyMenu,
      trayTuningMenu: settings.trayTuningMenu,
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
  try {
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
    notifyRenderer()
    await refreshTray()
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
        const ok = await relaunchAppAsAdmin(process.execPath, process.argv.slice(1))
        if (ok && app.isPackaged) {
          info('app', 'Restarting with administrator rights — closing this instance.')
          setTimeout(() => app.quit(), 500).unref?.()
        }
      })()
    },
    onOpenData: () => {
      void shell.openPath(getDataDir())
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
    if (settings.startMinimizedToTray) {
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

function setupAutoUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.on('update-available', (infoUpdate) => {
    info('updater', `App update available: ${infoUpdate.version}`)
    try {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC.onAppUpdateAvailable, infoUpdate.version)
      }
    } catch {
      /* renderer gone */
    }
  })
  autoUpdater.on('error', (e) => {
    err('updater', `autoUpdater error: ${String(e).slice(0, 300)}`)
  })
  void autoUpdater.checkForUpdates().catch(() => undefined)
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }, 6 * 60 * 60 * 1000).unref?.()
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
      initLogger(getAppLogPath())
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
