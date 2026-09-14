/** Settings save notifications (instant tray rebuild) + tray flag defaults. */
import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { loadSettings, saveSettings, onSettingsChanged } from '../src/main/settings'
import type { AppSettings } from '../src/shared/types'

// Isolate fs writes: point appData at a fresh tmp dir (setup.ts maps it to cwd).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-settings-'))
vi.spyOn(app, 'getPath').mockImplementation((name: string) => {
  if (name === 'exe') return process.cwd()
  return tmp
})

describe('tray settings defaults', () => {
  it('fresh settings enable the icon and all tray menu sections', () => {
    const s = loadSettings()
    expect(s.showTrayIcon).toBe(true)
    expect(s.trayStrategyMenu).toBe(true)
    expect(s.trayTuningMenu).toBe(true)
    expect(s.trayQuickSettings).toBe(true)
  })
})

describe('onSettingsChanged', () => {
  it('fires synchronously on every saveSettings with the merged result', () => {
    const seen: AppSettings[] = []
    const off = onSettingsChanged((next) => {
      seen.push(next)
    })
    try {
      const next = saveSettings({ trayStrategyMenu: false })
      expect(next.trayStrategyMenu).toBe(false)
      expect(seen).toHaveLength(1)
      expect(seen[0].trayStrategyMenu).toBe(false)
      // Untouched flags survive the patch.
      expect(seen[0].trayTuningMenu).toBe(true)

      saveSettings({ trayStrategyMenu: true })
      expect(seen).toHaveLength(2)
      expect(seen[1].trayStrategyMenu).toBe(true)
    } finally {
      off()
    }
  })

  it('stops firing after unsubscribe', () => {
    const seen: AppSettings[] = []
    const off = onSettingsChanged((next) => {
      seen.push(next)
    })
    off()
    saveSettings({ trayTuningMenu: false })
    saveSettings({ trayTuningMenu: true })
    expect(seen).toHaveLength(0)
  })
})
