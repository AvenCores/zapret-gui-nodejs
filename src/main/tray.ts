/**
 * System tray: status-colored icon, Start/Stop/Show/Quit menu.
 * Icons are simple generated PNGs written to the user-data dir so we
 * don't need binary assets in the repo (build/ may provide real icons).
 * @module main/tray
 */
import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getBundledAssetsDir } from './paths'
import type {
  GameFilterMode,
  IPSetMode,
  ServiceOwnership,
  TrayPage,
  ZapretStatus
} from '../shared/types'
import { translate, type I18nKey, type Locale } from '../shared/i18n'

let tray: Tray | null = null

/** File name of the pre-rendered tray icon for a status (pure — unit-tested). */
export function trayIconFile(status: ZapretStatus): string {
  return `tray-${status}.png`
}

function iconPath(status: ZapretStatus): string {
  // Prefer the pre-rendered app-icon + status dot shipped in bundled assets.
  try {
    const bundled = path.join(getBundledAssetsDir(), 'tray', trayIconFile(status))
    if (fs.existsSync(bundled)) return bundled
  } catch {
    /* fall through to the generated dot below */
  }
  const dir = path.join(app.getPath('userData'), 'tray-icons')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `tray-${status}.png`)
  if (!fs.existsSync(file)) {
    // 16x16 PNG with a single status-colored circle, generated once.
    const color = status === 'running' ? '#22c55e' : status === 'stopped' ? '#ef4444' : '#9ca3af'
    const png = renderCirclePng(color)
    fs.writeFileSync(file, png)
  }
  return file
}

// Minimal PNG encoder: 16x16 RGBA with a filled circle. No dependencies.
function renderCirclePng(hex: string): Buffer {
  const S = 16
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const raw: number[] = []
  for (let y = 0; y < S; y++) {
    raw.push(0) // filter byte
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5
      const dy = y - 7.5
      const inside = dx * dx + dy * dy <= 42
      raw.push(r, g, b, inside ? 255 : 0)
    }
  }
  const zlib = require('node:zlib') as typeof import('node:zlib')
  const data = zlib.deflateSync(Buffer.from(raw))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const png: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]
  const chunk = (type: string, payload: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(payload.length, 0)
    const td = Buffer.from(type, 'ascii')
    const crc = crc32Fallback(Buffer.concat([td, payload]))
    const cb = Buffer.alloc(4)
    cb.writeUInt32BE(crc >>> 0, 0)
    return Buffer.concat([len, td, payload, cb])
  }
  png.push(chunk('IHDR', ihdr))
  png.push(chunk('IDAT', data))
  png.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(png)
}

function crc32Fallback(buf: Buffer): number {
  let table = (crc32Fallback as unknown as { t?: Int32Array }).t
  if (!table) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    ;(crc32Fallback as unknown as { t: Int32Array }).t = table
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface TrayCallbacks {
  onShow: () => void
  /** Left-click: toggle the main window (show when hidden, hide when visible). */
  onToggleWindow: () => void
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onNavigate: (page: TrayPage) => void
  onPickStrategy: (id: string) => void
  onGameFilter: (mode: GameFilterMode) => void
  onIPSet: (mode: IPSetMode) => void
  onToggleSetting: (key: 'autoLaunch' | 'minimizeToTrayOnClose' | 'startMinimizedToTray') => void
  onRelaunchAdmin: () => void
  onOpenData: () => void
  onExportLogs: () => void
  onQuit: () => void
}

/** One strategy row in the tray `Strategy` submenu (already sorted). */
export interface TrayStrategyItem {
  id: string
  name: string
}

/** Everything the tray menu needs beyond status + labels. */
export interface TrayContext {
  isAdmin: boolean
  ownership: ServiceOwnership
  /** Strategy display name from the service registry (null when unknown). */
  activeStrategy: string | null
  /** Strategy id selected in settings (null when never chosen). */
  activeStrategyId: string | null
  /** All known strategies, sorted by name. */
  strategies: TrayStrategyItem[]
  totalStrategies: number
  gameFilter: GameFilterMode
  ipset: IPSetMode
  autoLaunch: boolean
  minimizeToTray: boolean
  startMinimized: boolean
  /** App version for the footer row (`app.getVersion()`). */
  version: string
}

/** Pre-translated tray strings for the app's active locale. */
export interface TrayLabels {
  status: string
  start: string
  stop: string
  restart: string
  open: string
  quit: string
  strategy: string
  none: string
  gotoMenu: string
  allStrategies: string
  dashboard: string
  strategies: string
  settings: string
  lists: string
  updates: string
  diagnostics: string
  logs: string
  gameFilter: string
  gameDisabled: string
  gameAll: string
  gameTcp: string
  gameUdp: string
  ipset: string
  ipsetNone: string
  ipsetLoaded: string
  ipsetAny: string
  autoLaunch: string
  minimizeToTray: string
  startMinimized: string
  relaunchAdmin: string
  openData: string
  exportLogs: string
  version: string
}

/** Build tray labels for a locale (pure — covered by unit tests). */
export function getTrayLabels(locale: Locale, status: ZapretStatus): TrayLabels {
  const t = (key: I18nKey): string => translate(locale, key)
  return {
    status: t(`status.${status}` as I18nKey),
    start: t('action.start'),
    stop: t('action.stop'),
    restart: t('action.restart'),
    open: t('tray.open'),
    quit: t('tray.quit'),
    strategy: t('dashboard.strategy'),
    none: t('dashboard.none'),
    gotoMenu: t('tray.goto'),
    allStrategies: t('tray.allStrategies'),
    dashboard: t('nav.dashboard'),
    strategies: t('nav.strategies'),
    settings: t('nav.settings'),
    lists: t('nav.lists'),
    updates: t('nav.updates'),
    diagnostics: t('nav.diagnostics'),
    logs: t('nav.logs'),
    gameFilter: t('settings.gameFilter'),
    gameDisabled: t('settings.gameDisabled'),
    gameAll: t('settings.gameAll'),
    gameTcp: t('settings.gameTcp'),
    gameUdp: t('settings.gameUdp'),
    ipset: t('settings.ipset'),
    ipsetNone: t('settings.ipsetNone'),
    ipsetLoaded: t('settings.ipsetLoaded'),
    ipsetAny: t('settings.ipsetAny'),
    autoLaunch: t('settings.autoLaunch'),
    minimizeToTray: t('settings.tray'),
    startMinimized: t('settings.startMinimized'),
    relaunchAdmin: t('dashboard.relaunchAdmin'),
    openData: t('tray.openData'),
    exportLogs: t('tray.exportLogs'),
    version: t('updates.app')
  }
}

/**
 * Whether the tray may control the service at all: admin rights are required
 * and a foreign (third-party) service must not be touched — it is managed
 * from the dashboard instead. Pure — covered by unit tests.
 */
export function canControlServices(isAdmin: boolean, ownership: ServiceOwnership): boolean {
  return isAdmin && ownership !== 'foreign'
}

/**
 * Which service actions are enabled in the tray menu. `not-installed`
 * disables everything (start would only fail with `sc` 1060); `unknown`
 * still allows Start as a best-effort attempt. Pure — unit-tested.
 */
export function trayActionsState(
  status: ZapretStatus,
  isAdmin: boolean,
  ownership: ServiceOwnership
): { start: boolean; stop: boolean; restart: boolean } {
  if (!canControlServices(isAdmin, ownership)) return { start: false, stop: false, restart: false }
  switch (status) {
    case 'running':
      return { start: false, stop: true, restart: true }
    case 'stopped':
      // Restart on a stopped service acts as Start (mirrors the dashboard).
      return { start: true, stop: false, restart: true }
    case 'unknown':
      return { start: true, stop: false, restart: false }
    default:
      return { start: false, stop: false, restart: false }
  }
}

/** Max strategy rows shown directly in the tray submenu (rest via app). */
export const TRAY_STRATEGY_LIMIT = 8

/**
 * Pick the strategy rows for the tray submenu: first `limit` entries, plus
 * the active one when it falls outside the window so the radio state never
 * loses the current selection. Pure — covered by unit tests.
 */
export function visibleStrategies(
  strategies: TrayStrategyItem[],
  activeId: string | null,
  activeName: string | null,
  limit: number = TRAY_STRATEGY_LIMIT
): TrayStrategyItem[] {
  const slice = strategies.slice(0, Math.max(0, limit))
  const hasActive =
    activeId != null
      ? slice.some((s) => s.id === activeId)
      : activeName != null
        ? slice.some((s) => s.name === activeName)
        : true
  if (!hasActive) {
    const found =
      (activeId != null ? strategies.find((s) => s.id === activeId) : undefined) ??
      (activeName != null ? strategies.find((s) => s.name === activeName) : undefined)
    if (found) slice.push(found)
  }
  return slice
}

/** Truncate a label for menu/tooltip use (pure — unit-tested). */
export function truncateLabel(s: string, max = 48): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Tooltip text: status plus the active strategy when known.
 * Windows caps tooltips (~128 chars), so the strategy name is shortened.
 * Pure — covered by unit tests.
 */
export function trayTooltip(statusLabel: string, strategyName: string | null): string {
  const base = `Zapret GUI — ${statusLabel}`
  if (strategyName == null || strategyName.trim() === '') return base
  return truncateLabel(`${base} · ${strategyName.trim()}`, 127)
}

/** Create the tray icon (idempotent — recreates menu on status change). */
export function setupTray(status: ZapretStatus, labels: TrayLabels, ctx: TrayContext, cb: TrayCallbacks): Tray {
  const img = nativeImage.createFromPath(iconPath(status))
  const tooltip = trayTooltip(labels.status, ctx.activeStrategy)
  if (tray) {
    tray.setImage(img)
    tray.setToolTip(tooltip)
    tray.setContextMenu(buildMenu(status, labels, ctx, cb))
    return tray
  }
  tray = new Tray(img)
  tray.setToolTip(tooltip)
  tray.setContextMenu(buildMenu(status, labels, ctx, cb))
  tray.on('double-click', cb.onShow)
  tray.on('click', cb.onToggleWindow)
  return tray
}

const NAV_PAGES: TrayPage[] = ['dashboard', 'strategies', 'settings', 'lists', 'updates', 'diagnostics', 'logs']

const GAME_MODES: GameFilterMode[] = ['disabled', 'all', 'tcp', 'udp']

const IPSET_MODES: IPSetMode[] = ['none', 'loaded', 'any']

function buildMenu(status: ZapretStatus, labels: TrayLabels, ctx: TrayContext, cb: TrayCallbacks): Menu {
  const actions = trayActionsState(status, ctx.isAdmin, ctx.ownership)
  const strategyName = ctx.activeStrategy ?? labels.none
  const visible = visibleStrategies(ctx.strategies, ctx.activeStrategyId, ctx.activeStrategy)
  const gameLabel = (m: GameFilterMode): string =>
    m === 'disabled' ? labels.gameDisabled : m === 'all' ? labels.gameAll : m === 'tcp' ? labels.gameTcp : labels.gameUdp
  const ipsetLabel = (m: IPSetMode): string =>
    m === 'none' ? labels.ipsetNone : m === 'loaded' ? labels.ipsetLoaded : labels.ipsetAny

  return Menu.buildFromTemplate([
    { label: `zapret: ${labels.status}`, enabled: false },
    { label: `${labels.strategy}: ${truncateLabel(strategyName)}`, enabled: false },
    { type: 'separator' },
    { label: labels.start, click: cb.onStart, enabled: actions.start },
    { label: labels.stop, click: cb.onStop, enabled: actions.stop },
    { label: labels.restart, click: cb.onRestart, enabled: actions.restart },
    { type: 'separator' },
    {
      label: labels.strategies,
      submenu: [
        ...(visible.length > 0
          ? visible.map((s) => ({
              label: truncateLabel(s.name),
              type: 'radio' as const,
              checked:
                ctx.activeStrategyId != null ? s.id === ctx.activeStrategyId : s.name === ctx.activeStrategy,
              click: (): void => cb.onPickStrategy(s.id)
            }))
          : [{ label: labels.none, enabled: false }]),
        { type: 'separator' as const },
        {
          label: `${labels.allStrategies} (${ctx.totalStrategies})`,
          click: (): void => cb.onNavigate('strategies')
        }
      ]
    },
    {
      label: labels.gotoMenu,
      submenu: NAV_PAGES.map((page) => ({
        label: labels[page],
        click: (): void => cb.onNavigate(page)
      }))
    },
    {
      label: truncateLabel(labels.gameFilter, 40),
      submenu: GAME_MODES.map((m) => ({
        label: gameLabel(m),
        type: 'radio' as const,
        checked: ctx.gameFilter === m,
        enabled: ctx.isAdmin,
        click: (): void => cb.onGameFilter(m)
      }))
    },
    {
      label: labels.ipset,
      submenu: IPSET_MODES.map((m) => ({
        label: ipsetLabel(m),
        type: 'radio' as const,
        checked: ctx.ipset === m,
        enabled: ctx.isAdmin,
        click: (): void => cb.onIPSet(m)
      }))
    },
    { type: 'separator' },
    ...(!ctx.isAdmin ? [{ label: labels.relaunchAdmin, click: cb.onRelaunchAdmin }] : []),
    { label: labels.openData, click: cb.onOpenData },
    { label: labels.exportLogs, click: cb.onExportLogs },
    { type: 'separator' },
    {
      label: labels.autoLaunch,
      type: 'checkbox',
      checked: ctx.autoLaunch,
      click: (): void => cb.onToggleSetting('autoLaunch')
    },
    {
      label: labels.minimizeToTray,
      type: 'checkbox',
      checked: ctx.minimizeToTray,
      click: (): void => cb.onToggleSetting('minimizeToTrayOnClose')
    },
    {
      label: labels.startMinimized,
      type: 'checkbox',
      checked: ctx.startMinimized,
      click: (): void => cb.onToggleSetting('startMinimizedToTray')
    },
    { type: 'separator' },
    { label: labels.open, click: cb.onShow },
    { label: `${labels.version}: ${ctx.version}`, enabled: false },
    { label: labels.quit, click: cb.onQuit }
  ])
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export function focusOrCreateMain(create: () => BrowserWindow, existing: () => BrowserWindow | null): void {
  const w = existing()
  if (w) {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  } else {
    create()
  }
}
