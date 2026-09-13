/**
 * Electron main entry: window, tray, auto-updater, first-run wizard flag.
 * @module main/index
 */
import { app, BrowserWindow, shell, dialog } from 'electron'
import path from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { ensureDataDirSeeded, getDataDir, getAppLogPath, getBundledAssetsDir } from './paths'
import { initLogger, info, err, onLog } from './logger'
import { registerIpcHandlers, listStrategies } from './ipc-handlers'
import { setupTray, getTrayLabels } from './tray'
import { loadSettings, saveSettings } from './settings'
import { getStatus } from './service-manager'
import { isAdmin } from './exec'
import { IPC } from '../shared/types'
import { translate } from '../shared/i18n'
import type { ZapretStatus } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
app.on('before-quit', () => {
  isQuitting = true
})

function toTrayStatus(s: string): ZapretStatus {
  if (s === 'RUNNING') return 'running'
  if (s === 'STOPPED') return 'stopped'
  if (s === 'NOT_INSTALLED') return 'not-installed'
  return 'unknown'
}

async function refreshTray(): Promise<void> {
  try {
    const st = await getStatus(await isAdmin())
    const zs = toTrayStatus(st.zapret)
    // Labels follow the app language (also refreshed by the 15s timer,
    // so a language switch applies to the tray shortly after).
    setupTray(zs, getTrayLabels(loadSettings().locale, zs), trayCallbacks())
  } catch {
    /* tray refresh is best-effort */
  }
}

function trayCallbacks() {
  return {
    onShow: () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    },
    onStart: () => {
      mainWindow?.webContents.send('zapret:tray-start')
    },
    onStop: () => {
      mainWindow?.webContents.send('zapret:tray-stop')
    },
    onQuit: () => {
      app.quit()
    }
  }
}

function createWindow(): void {
  const settings = loadSettings()
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 875,
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
    if (s.minimizeToTrayOnClose && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Stream buffered + future logs to the renderer.
  onLog((line) => {
    mainWindow?.webContents.send(IPC.onLog, line)
  })

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
    mainWindow?.webContents.send('zapret:app-update-available', infoUpdate.version)
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.zapret.gui')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initLogger(getAppLogPath())
  ensureDataDirSeeded()
  info('app', `Zapret GUI starting. Data dir: ${getDataDir()}`)

  registerIpcHandlers()
  createWindow()
  setupAutoUpdater()
  void firstRunCheck()
  void refreshTray()
  setInterval(() => {
    void refreshTray()
  }, 15000).unref?.()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Keep running in tray on Windows.
  if (process.platform !== 'win32') app.quit()
})
