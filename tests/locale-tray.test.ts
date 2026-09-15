/** Unit tests for system locale/theme defaults and tray labels. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSystemLocale } from '../src/main/settings'
import {
  getTrayLabels,
  trayIconFile,
  canControlServices,
  trayActionsState,
  visibleStrategies,
  truncateLabel,
  trayTooltip
} from '../src/main/tray'

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
      restart: 'Перезапустить',
      open: 'Открыть Zapret GUI',
      quit: 'Выйти',
      strategy: 'Активная стратегия',
      none: '—',
      gotoMenu: 'Открыть раздел',
      allStrategies: 'Все стратегии…',
      dashboard: 'Дашборд',
      strategies: 'Стратегии',
      settings: 'Настройки',
      lists: 'Списки',
      updates: 'Обновления',
      diagnostics: 'Диагностика',
      logs: 'Логи',
      gameFilter: 'Game Filter (порты 1024–65535)',
      gameDisabled: 'Отключён',
      gameAll: 'TCP+UDP',
      gameTcp: 'Только TCP',
      gameUdp: 'Только UDP',
      ipset: 'IPSet Filter',
      ipsetNone: 'Нет',
      ipsetLoaded: 'Загружен',
      ipsetAny: 'Любой',
      autoLaunch: 'Автозапуск с Windows',
      minimizeToTray: 'Сворачивать в трей при закрытии',
      startMinimized: 'Запускаться свёрнутым в трей',
      relaunchAdmin: 'Перезапустить с правами администратора',
      openData: 'Открыть папку данных',
      exportLogs: 'Экспорт логов',
      version: 'Версия приложения',
      tgProxy: 'TG-прокси',
      tgRunning: 'Запущен',
      tgStopped: 'Остановлен',
      tgError: 'Ошибка'
    })
  })

  it('translates to English', () => {
    const l = getTrayLabels('en', 'not-installed')
    expect(l).toEqual({
      status: 'Not installed',
      start: 'Start',
      stop: 'Stop',
      restart: 'Restart',
      open: 'Open Zapret GUI',
      quit: 'Quit',
      strategy: 'Active strategy',
      none: '—',
      gotoMenu: 'Go to',
      allStrategies: 'All strategies…',
      dashboard: 'Dashboard',
      strategies: 'Strategies',
      settings: 'Settings',
      lists: 'Lists',
      updates: 'Updates',
      diagnostics: 'Diagnostics',
      logs: 'Logs',
      gameFilter: 'Game Filter (ports 1024–65535)',
      gameDisabled: 'Disabled',
      gameAll: 'TCP+UDP',
      gameTcp: 'TCP only',
      gameUdp: 'UDP only',
      ipset: 'IPSet Filter',
      ipsetNone: 'none',
      ipsetLoaded: 'loaded',
      ipsetAny: 'any',
      autoLaunch: 'Launch with Windows',
      minimizeToTray: 'Minimize to tray on close',
      startMinimized: 'Start minimized to tray',
      relaunchAdmin: 'Relaunch as administrator',
      openData: 'Open data folder',
      exportLogs: 'Export logs',
      version: 'App version',
      tgProxy: 'TG proxy',
      tgRunning: 'Running',
      tgStopped: 'Stopped',
      tgError: 'Error'
    })
  })
})

describe('canControlServices', () => {
  it('requires admin and non-foreign ownership', () => {
    expect(canControlServices(true, 'ours')).toBe(true)
    expect(canControlServices(true, 'none')).toBe(true)
    expect(canControlServices(true, 'unknown')).toBe(true)
    expect(canControlServices(true, 'foreign')).toBe(false)
    expect(canControlServices(false, 'ours')).toBe(false)
    expect(canControlServices(false, 'foreign')).toBe(false)
  })
})

describe('trayActionsState', () => {
  it('enables Stop/Restart only when running', () => {
    expect(trayActionsState('running', true, 'ours')).toEqual({ start: false, stop: true, restart: true })
  })

  it('enables Start (+Restart as Start) when stopped', () => {
    expect(trayActionsState('stopped', true, 'ours')).toEqual({ start: true, stop: false, restart: true })
  })

  it('allows a best-effort Start when unknown', () => {
    expect(trayActionsState('unknown', true, 'ours')).toEqual({ start: true, stop: false, restart: false })
  })

  it('disables everything when not installed', () => {
    expect(trayActionsState('not-installed', true, 'ours')).toEqual({ start: false, stop: false, restart: false })
  })

  it('disables everything without admin or with a foreign service', () => {
    expect(trayActionsState('running', false, 'ours')).toEqual({ start: false, stop: false, restart: false })
    expect(trayActionsState('running', true, 'foreign')).toEqual({ start: false, stop: false, restart: false })
    expect(trayActionsState('stopped', false, 'ours')).toEqual({ start: false, stop: false, restart: false })
  })
})

describe('visibleStrategies', () => {
  const all = Array.from({ length: 22 }, (_, i) => ({ id: `s${i}`, name: `strategy ${i}` }))

  it('shows the first page when the active strategy is inside it', () => {
    expect(visibleStrategies(all, 's1', 'strategy 1')).toHaveLength(8)
    expect(visibleStrategies(all, 's1', 'strategy 1')[0]).toEqual({ id: 's0', name: 'strategy 0' })
  })

  it('appends the active strategy when it falls outside the window', () => {
    const vis = visibleStrategies(all, 's20', 'strategy 20')
    expect(vis).toHaveLength(9)
    expect(vis[vis.length - 1]).toEqual({ id: 's20', name: 'strategy 20' })
  })

  it('finds the active strategy by name when no id is stored yet', () => {
    const vis = visibleStrategies(all, null, 'strategy 21')
    expect(vis[vis.length - 1]).toEqual({ id: 's21', name: 'strategy 21' })
  })

  it('returns everything when there are fewer strategies than the limit', () => {
    expect(visibleStrategies(all.slice(0, 3), 's0', 'strategy 0')).toHaveLength(3)
  })
})

describe('truncateLabel / trayTooltip', () => {
  it('truncates long labels with an ellipsis', () => {
    expect(truncateLabel('abc', 10)).toBe('abc')
    expect(truncateLabel('abcdefghij', 5)).toBe('abcd…')
  })

  it('shows only the status when no strategy is known', () => {
    expect(trayTooltip('Running', null)).toBe('Zapret GUI — Running')
    expect(trayTooltip('Running', '  ')).toBe('Zapret GUI — Running')
  })

  it('appends the strategy name and caps tooltip length', () => {
    expect(trayTooltip('Running', 'general (ALT)')).toBe('Zapret GUI — Running · general (ALT)')
    expect(trayTooltip('Running', 'x'.repeat(200)).length).toBeLessThanOrEqual(127)
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
