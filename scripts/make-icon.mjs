/**
 * Regenerate Windows art from the committed source (`build/app-icon.png`):
 * - `bundled-assets/icon.ico` (multi-size, exe/installer/window icon)
 * - `bundled-assets/tray/tray-<status>.png` (app art + status dot for the tray,
 *   pre-rendered so the runtime needs no image dependencies)
 *
 * Usage: `npm run icon`
 *
 * Requires devDependencies: sharp (resize) + png-to-ico (ICO container).
 * Plain ESM Node.js script.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'build', 'app-icon.png')
const dest = path.join(root, 'bundled-assets', 'icon.ico')
// Standard Windows icon sizes, largest last.
const SIZES = [16, 24, 32, 48, 64, 128, 256]

if (!fs.existsSync(src)) {
  console.error(`Source art not found: ${src}`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-icon-'))
try {
  const files = []
  for (const s of SIZES) {
    const f = path.join(tmp, `icon-${s}.png`)
    await sharp(src)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(f)
    files.push(f)
  }
  const ico = await pngToIco(files)
  fs.writeFileSync(dest, ico)
  console.log(`wrote ${dest} (${ico.length} bytes, ${SIZES.length} sizes)`)

  // Tray icons: app art with a status-colored badge (bottom-right dot).
  const TRAY_SIZE = 32
  const STATUS_COLORS = {
    running: '#22c55e',
    stopped: '#ef4444',
    'not-installed': '#9ca3af',
    unknown: '#9ca3af'
  }
  const trayDir = path.join(root, 'bundled-assets', 'tray')
  fs.mkdirSync(trayDir, { recursive: true })
  const trayBase = await sharp(src)
    .resize(TRAY_SIZE, TRAY_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  for (const [name, color] of Object.entries(STATUS_COLORS)) {
    const d = Math.round(TRAY_SIZE * 0.44)
    const cx = TRAY_SIZE - d / 2 - 1
    const cy = TRAY_SIZE - d / 2 - 1
    const badge =
      `<svg width="${TRAY_SIZE}" height="${TRAY_SIZE}">` +
      `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${color}" stroke="#0f172a" stroke-width="2"/>` +
      `</svg>`
    const out = path.join(trayDir, `tray-${name}.png`)
    await sharp(trayBase)
      .composite([{ input: Buffer.from(badge), width: TRAY_SIZE, height: TRAY_SIZE }])
      .png()
      .toFile(out)
    console.log(`wrote ${out}`)
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
