/**
 * Clean build outputs: `out/` (electron-vite) and `dist/` (electron-builder).
 *
 * Usage:
 *   node scripts/clean.mjs
 *   npm run clean     — clean only
 *   npm run rebuild   — clean + full rebuild from sources (installer + portable zip)
 *
 * Plain Node.js, no dependencies. Never fails on missing dirs and never
 * touches anything outside the project root (bundled-assets, src, etc.).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['out', 'dist']

let removed = 0
for (const dir of TARGETS) {
  const p = path.join(root, dir)
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true })
    console.log(`removed ${dir}/`)
    removed++
  } else {
    console.log(`skip ${dir}/ (not present)`)
  }
}
console.log(removed > 0 ? 'Clean done.' : 'Nothing to clean.')
