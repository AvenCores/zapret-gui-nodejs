/**
 * Full factory reset: wipe writable app data and recreate first-run state.
 *
 * Removes (best-effort, in order):
 * 1. `zapret` + `WinDivert` Windows services (orphaned otherwise — the stored
 *    `activeStrategyId` is cleared below while the service would keep running)
 * 2. `%APPDATA%/zapret-gui/data` (bin/lists/utils/strategies, imported
 *    strategies, user lists, flags, backups, tmp, test results) + reseeds it
 *    from `bundled-assets` via `ensureDataDirSeeded()`
 * 3. `%APPDATA%/zapret-gui/app.log` (+ rotated `.1`)
 * 4. `%APPDATA%/zapret-gui/settings.json` via `resetSettings()` (system
 *    locale, `auto` theme, auto-launch off)
 *
 * The system hosts file and third-party services are intentionally left
 * untouched — this resets *our* data, not the OS.
 * @module main/app-reset
 */
import fs from 'node:fs'
import { getAppLogPath, getTgProxyLogPath, getDataDir, ensureDataDirSeeded } from './paths'
import { resetSettings } from './settings'
import { removeServices } from './service-manager'
import type { AppSettings } from '../shared/types'

export interface ResetAppDataResult {
  settings: AppSettings
  /** False when service removal failed (e.g. no admin rights) — files still reset. */
  servicesRemoved: boolean
}

/**
 * Run the full reset. Stopping foreground/config-tester winws processes is
 * the caller's job (see `stopAllTesting` in ipc-handlers) — this only deals
 * with services + files + settings.
 */
export async function resetAppData(onLog?: (text: string) => void): Promise<ResetAppDataResult> {
  const say = (t: string): void => {
    onLog?.(t)
  }

  let servicesRemoved = true
  try {
    say('Removing zapret services...')
    await removeServices((t) => say(t))
  } catch (e) {
    // No admin / locked SCM: files below still reset, the stale service (if
    // any) is reported to the user via the return flag.
    servicesRemoved = false
    say(`Service removal failed (continuing): ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
  }

  const dataDir = getDataDir()
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const code = (e as NodeJS.ErrnoException)?.code ?? ''
    // Locked files (running winws.exe / loaded WinDivert driver) surface as
    // EPERM/EACCES/EBUSY: tell the user to stop zapret instead of deleting
    // the folder by hand (the UI disables reset while active, but the state
    // may have changed mid-flight).
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || /EPERM|EACCES|EBUSY/i.test(raw)) {
      throw new Error(
        `Cannot wipe data dir: files are locked. Stop the zapret service (Dashboard → Stop) and retry. (${code || raw.slice(0, 120)})`
      )
    }
    throw new Error(
      `Cannot wipe data dir (${dataDir}): ${raw}. Close the app and delete it manually.`
    )
  }
  try {
    ensureDataDirSeeded()
    say('Data dir reseeded from bundled assets.')
  } catch (e) {
    throw new Error(`Cannot reseed data dir: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const logPath = getAppLogPath()
    fs.rmSync(logPath, { force: true })
    fs.rmSync(`${logPath}.1`, { force: true })
    const tgLogPath = getTgProxyLogPath()
    fs.rmSync(tgLogPath, { force: true })
    fs.rmSync(`${tgLogPath}.1`, { force: true })
  } catch {
    /* logs are best-effort */
  }

  const settings = resetSettings()
  say('Settings reset to defaults.')

  return { settings, servicesRemoved }
}
