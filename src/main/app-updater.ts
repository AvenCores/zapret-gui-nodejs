/**
 * Application self-update (electron-updater, GitHub releases).
 * Single responsibility: check / download / install the app itself and —
 * most importantly — always OFFER the update to the user when a new
 * version is found (native dialog + renderer banner event).
 * @module main/app-updater
 */
import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type AppUpdateInfo, type AppUpdateState } from '../shared/types'
import { URLS } from '../shared/constants'
import { translate } from '../shared/i18n'
import { loadSettings } from './settings'
import { info, err } from './logger'
import { win, safeSend } from './window'

let wired = false
/** Version we already offered in this session (no dialog spam every 6h). */
let offeredVersion: string | null = null
/** Version whose installer is downloaded and waits for restart. */
let downloadedVersion: string | null = null
let downloading = false
/** Version currently being downloaded (for the `downloading` event payload). */
let downloadingVersion: string | null = null

/** Installed version. Never throws (unit-test / dev safe). */
export function getAppVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return '0.0.0'
  }
}

function buildInfo(availableVersion: string | null): AppUpdateInfo {
  return {
    currentVersion: getAppVersion(),
    availableVersion,
    updateAvailable: availableVersion !== null && availableVersion !== getAppVersion(),
    downloaded: downloadedVersion !== null && downloadedVersion === availableVersion,
    releasesUrl: URLS.appReleases,
    checkedAt: new Date().toISOString()
  }
}

/**
 * Offer a newly found version: renderer banner event + one native dialog
 * per version per session ("Download / Later"). Pure side-effect wrapper —
 * safe to call repeatedly, dialogs are deduplicated by version.
 */
export function offerAppUpdate(version: string): void {
  info('updater', `App update available: ${version}`)
  try {
    safeSend(IPC.onAppUpdateAvailable, version)
  } catch {
    /* best-effort */
  }
  if (offeredVersion === version) return
  offeredVersion = version
  void (async () => {
    try {
      const locale = loadSettings().locale
      const w = win()
      const res = await dialog.showMessageBox(w ?? undefined as unknown as BrowserWindow, {
        type: 'info',
        buttons: [
          translate(locale, 'updates.appDownload'),
          translate(locale, 'action.cancel')
        ],
        defaultId: 0,
        cancelId: 1,
        title: 'Zapret GUI',
        message: translate(locale, 'updates.appAvailable').replace('{version}', version),
        detail: `${translate(locale, 'updates.appCurrent')}: ${getAppVersion()}\n${translate(locale, 'updates.appRemote')}: ${version}`
      })
      if (res.response === 0) {
        await downloadAppUpdate().catch((e: unknown) => {
          err('updater', `App update download failed: ${e instanceof Error ? e.message : String(e)}`)
        })
      }
    } catch (e) {
      err('updater', `App update offer failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  })()
}

function offerAppRestart(version: string): void {
  info('updater', `App update downloaded: ${version}`)
  try {
    safeSend(IPC.onAppUpdateDownloaded, version)
  } catch {
    /* best-effort */
  }
  void (async () => {
    try {
      const locale = loadSettings().locale
      const w = win()
      const res = await dialog.showMessageBox(w ?? undefined as unknown as BrowserWindow, {
        type: 'info',
        buttons: [
          translate(locale, 'updates.appInstall'),
          translate(locale, 'action.cancel')
        ],
        defaultId: 0,
        cancelId: 1,
        title: 'Zapret GUI',
        message: translate(locale, 'updates.appDownloaded').replace('{version}', version)
      })
      if (res.response === 0) installAppUpdate()
    } catch (e) {
      err('updater', `App restart offer failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  })()
}

/**
 * Cached snapshot of the app self-update state (no network).
 * Lets late-mounted views (Updates page opened after the banner, window
 * reloaded mid-download) synchronize without waiting for the next event.
 */
export function getAppUpdateState(): AppUpdateState {
  return { ...buildInfo(offeredVersion), downloading }
}

/** Manual check from the Updates page. Returns structured info for the UI. */
export async function checkAppUpdates(): Promise<AppUpdateInfo> {
  if (!app.isPackaged) {
    return buildInfo(null)
  }
  try {
    const res = await autoUpdater.checkForUpdates()
    const v = res?.updateInfo?.version?.trim() || null
    const current = getAppVersion()
    // electron-updater already compares versions, but stay defensive:
    // empty / same version → no offer.
    if (!v || v === current) return buildInfo(null)
    offerAppUpdate(v)
    return buildInfo(v)
  } catch (e) {
    err('updater', `checkAppUpdates failed: ${e instanceof Error ? e.message : String(e)}`)
    return buildInfo(null)
  }
}

/** Start downloading the pending update (no-op when nothing pending). */
export async function downloadAppUpdate(): Promise<void> {
  if (!app.isPackaged || downloading) return
  downloading = true
  downloadingVersion = offeredVersion
  // Notify the renderer immediately (before the first `download-progress`):
  // the download can be triggered from the native dialog, in which case the
  // banner / Updates page would otherwise keep showing "Download" with no
  // indication that anything is happening.
  if (downloadingVersion) {
    try {
      safeSend(IPC.onAppUpdateDownloading, downloadingVersion)
    } catch {
      /* best-effort */
    }
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    err('updater', `App update download failed: ${msg}`)
    try {
      safeSend(IPC.onAppUpdateError, msg)
    } catch {
      /* best-effort */
    }
    throw e
  } finally {
    downloading = false
  }
}

/** Restart the app and install the downloaded update (no-op when none). */
export function installAppUpdate(): void {
  if (!app.isPackaged || !downloadedVersion) return
  try {
    autoUpdater.quitAndInstall(false, true)
  } catch (e) {
    err('updater', `quitAndInstall failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Wire electron-updater events once: background check on start + every 6h.
 * Every `update-available` ends in {@link offerAppUpdate} so a new release
 * always produces a visible "update?" prompt (dialog + renderer banner),
 * never a silent log line.
 */
export function setupAutoUpdater(): void {
  if (wired) return
  wired = true
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (updateInfo) => {
    try {
      const v = String(updateInfo?.version ?? '').trim()
      if (v) offerAppUpdate(v)
    } catch (e) {
      err('updater', `update-available handler failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  autoUpdater.on('update-not-available', () => {
    info('updater', 'App is up to date.')
  })
  autoUpdater.on('download-progress', (p) => {
    try {
      safeSend(IPC.onDownloadProgress, {
        percent: Math.round(p?.percent ?? 0),
        transferred: p?.transferred ?? 0,
        total: typeof p?.total === 'number' ? p.total : null
      })
    } catch {
      /* best-effort */
    }
  })
  autoUpdater.on('update-downloaded', (updateInfo) => {
    downloading = false
    downloadingVersion = null
    try {
      const v = String(updateInfo?.version ?? '').trim() || offeredVersion || getAppVersion()
      downloadedVersion = v
      offerAppRestart(v)
    } catch (e) {
      err('updater', `update-downloaded handler failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  autoUpdater.on('error', (e) => {
    downloading = false
    downloadingVersion = null
    const msg = String((e as Error)?.message ?? e).slice(0, 300)
    err('updater', `autoUpdater error: ${msg}`)
    // Reset the banner / Updates page spinner when the download was started
    // from the native dialog (no awaiting renderer to catch the rejection).
    try {
      safeSend(IPC.onAppUpdateError, msg)
    } catch {
      /* best-effort */
    }
  })

  void autoUpdater.checkForUpdates().catch(() => undefined)
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }, 6 * 60 * 60 * 1000).unref?.()
}

/** Reset module state (unit tests). */
export function __resetAppUpdaterForTest(): void {
  wired = false
  offeredVersion = null
  downloadedVersion = null
  downloading = false
  downloadingVersion = null
}
