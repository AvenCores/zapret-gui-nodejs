/** Factory reset: settings return to first-run defaults and notify listeners. */
import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { loadSettings, saveSettings, resetSettings, onSettingsChanged } from '../src/main/settings'
import type { AppSettings } from '../src/shared/types'

// Isolate fs writes: point appData at a fresh tmp dir (setup.ts maps it to cwd).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-reset-'))
vi.spyOn(app, 'getPath').mockImplementation((name: string) => {
  if (name === 'exe') return process.cwd()
  return tmp
})

describe('resetSettings', () => {
  it('restores first-run defaults after custom saves', () => {
    saveSettings({ autoLaunch: true, showTrayIcon: false, activeStrategyId: 'some-id' })
    expect(loadSettings().autoLaunch).toBe(true)

    const next = resetSettings()
    expect(next.autoLaunch).toBe(false)
    expect(next.showTrayIcon).toBe(true)
    expect(next.activeStrategyId).toBeNull()
    expect(next.minimizeToTrayOnClose).toBe(true)

    // Persisted: a fresh load sees the same defaults.
    const reloaded = loadSettings()
    expect(reloaded.autoLaunch).toBe(false)
    expect(reloaded.activeStrategyId).toBeNull()
  })

  it('notifies listeners exactly once', () => {
    saveSettings({ autoLaunch: true })
    const seen: AppSettings[] = []
    const off = onSettingsChanged((next) => {
      seen.push(next)
    })
    try {
      resetSettings()
      expect(seen).toHaveLength(1)
      expect(seen[0].autoLaunch).toBe(false)
    } finally {
      off()
    }
  })
})
