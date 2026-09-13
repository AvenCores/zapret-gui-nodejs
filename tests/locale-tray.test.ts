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

  it('maps supported tags to their locale', () => {
    expect(resolveSystemLocale('en-US')).toBe('en')
    expect(resolveSystemLocale('de-DE')).toBe('de')
    expect(resolveSystemLocale('fr-FR')).toBe('fr')
    expect(resolveSystemLocale('uk-UA')).toBe('uk')
    expect(resolveSystemLocale('pt-BR')).toBe('pt')
    expect(resolveSystemLocale('zh-CN')).toBe('zh')
    expect(resolveSystemLocale('ja-JP')).toBe('ja')
    expect(resolveSystemLocale('ar-SA')).toBe('ar')
  })

  it('handles underscore / case variants and aliases', () => {
    expect(resolveSystemLocale('en_US')).toBe('en')
    expect(resolveSystemLocale('DE-de')).toBe('de')
    expect(resolveSystemLocale('bs-BA')).toBe('sr')
    expect(resolveSystemLocale('')).toBe('en')
    expect(resolveSystemLocale('xx-YY')).toBe('en')
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
