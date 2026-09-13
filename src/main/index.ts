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
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'zapret-gui',
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
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
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
  void dialog
    .showMessageBox({
      type: 'info',
      title: 'zapret-gui — first run',
      message: 'Welcome! Pick a strategy on the Strategies tab and press Apply.',
      detail: `If unsure, keep "general". Available: ${names}… Also configure Secure DNS in your browser.`,
      buttons: ['OK']
    })
    .catch(() => undefined)
  saveSettings({})
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.zapret.gui')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initLogger(getAppLogPath())
  ensureDataDirSeeded()
  info('app', `zapret-gui starting. Data dir: ${getDataDir()}`)

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
