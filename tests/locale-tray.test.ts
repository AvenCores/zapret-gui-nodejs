/** Unit tests for system locale/theme defaults and tray labels. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSystemLocale } from '../src/main/settings'
import { getTrayLabels, trayIconFile } from '../src/main/tray'

describe('resolveSystemLocale', () => {
  it('maps ru tags to ru', () => {
    expect(resolveSystemLocale('ru-RU')).toBe('ru')
    expect(resolveSystemLocale('ru')).toBe('ru')
  })

  it('maps everything else to en', () => {
    expect(resolveSystemLocale('en-US')).toBe('en')
    expect(resolveSystemLocale('de-DE')).toBe('en')
    expect(resolveSystemLocale('')).toBe('en')
  })
})

describe('getTrayLabels', () => {
  it('translates to Russian', () => {
    const l = getTrayLabels('ru', 'running')
    expect(l).toEqual({
      status: 'Работает',
      start: 'Запустить',
      stop: 'Остановить',
      open: 'Открыть zapret-gui',
      quit: 'Выйти'
    })
  })

  it('translates to English', () => {
    const l = getTrayLabels('en', 'not-installed')
    expect(l).toEqual({
      status: 'Not installed',
      start: 'Start',
      stop: 'Stop',
      open: 'Open zapret-gui',
      quit: 'Quit'
    })
  })
})

describe('trayIconFile', () => {
  it('maps every status to a shipped asset', () => {
    for (const status of ['running', 'stopped', 'not-installed', 'unknown'] as const) {
      const file = path.join(process.cwd(), 'bundled-assets', 'tray', trayIconFile(status))
      expect(fs.existsSync(file)).toBe(true)
    }
  })
})
