/** Scheduled app update checks obey the Updates toggle; manual checks don't. */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const { checkForUpdates } = vi.hoisted(() => ({ checkForUpdates: vi.fn() }))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: () => undefined,
    checkForUpdates
  }
}))

import { setupAutoUpdater, __resetAppUpdaterForTest } from '../src/main/app-updater'

// Isolate fs reads: point appData at a fresh tmp dir (setup.ts maps it to cwd).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-autocheck-'))
const appData = path.join(tmp, 'appdata')
const flagPath = path.join(appData, 'zapret-gui', 'data', 'utils', 'check_updates.enabled')
vi.spyOn(app, 'getPath').mockImplementation((name: string) => {
  if (name === 'appData') return appData
  return tmp
})

// setupAutoUpdater is a no-op outside packaged builds (the mock is a plain
// object, so the readonly-typed flag can be flipped for this test file).
const realIsPackaged = app.isPackaged
;(app as { isPackaged: boolean }).isPackaged = true

beforeEach(() => {
  __resetAppUpdaterForTest()
  checkForUpdates.mockClear()
  checkForUpdates.mockResolvedValue({ updateInfo: { version: '9.9.9-test' } })
})

afterAll(() => {
  ;(app as { isPackaged: boolean }).isPackaged = realIsPackaged
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('setupAutoUpdater scheduled checks', () => {
  it('runs the startup check when the toggle is on', () => {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true })
    fs.writeFileSync(flagPath, 'ENABLED\n')

    setupAutoUpdater()

    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('skips the startup check when the toggle is off', () => {
    fs.rmSync(flagPath, { force: true })

    setupAutoUpdater()

    expect(checkForUpdates).not.toHaveBeenCalled()
  })
})
