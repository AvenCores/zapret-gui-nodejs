/**
 * System tray: status-colored icon, Start/Stop/Show/Quit menu.
 * Icons are simple generated PNGs written to the user-data dir so we
 * don't need binary assets in the repo (build/ may provide real icons).
 * @module main/tray
 */
import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { ZapretStatus } from '../shared/types'

let tray: Tray | null = null

function iconPath(status: ZapretStatus): string {
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
  onStart: () => void
  onStop: () => void
  onQuit: () => void
}

/** Create the tray icon (idempotent — recreates menu on status change). */
export function setupTray(status: ZapretStatus, cb: TrayCallbacks): Tray {
  const img = nativeImage.createFromPath(iconPath(status))
  if (tray) {
    tray.setImage(img)
    tray.setToolTip(`zapret-gui — ${status}`)
    tray.setContextMenu(buildMenu(status, cb))
    return tray
  }
  tray = new Tray(img)
  tray.setToolTip(`zapret-gui — ${status}`)
  tray.setContextMenu(buildMenu(status, cb))
  tray.on('double-click', cb.onShow)
  tray.on('click', cb.onShow)
  return tray
}

function buildMenu(status: ZapretStatus, cb: TrayCallbacks): Menu {
  return Menu.buildFromTemplate([
    { label: `zapret: ${status}`, enabled: false },
    { type: 'separator' },
    { label: 'Start', click: cb.onStart, enabled: status !== 'running' },
    { label: 'Stop', click: cb.onStop, enabled: status === 'running' },
    { type: 'separator' },
    { label: 'Open zapret-gui', click: cb.onShow },
    { label: 'Quit', click: cb.onQuit }
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
