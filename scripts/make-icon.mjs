/**
 * Regenerate the Windows app icon (`bundled-assets/icon.ico`, multi-size)
 * from the committed source art (`build/app-icon.png`).
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
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
