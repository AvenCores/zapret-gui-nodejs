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
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['out', 'dist']

/**
 * Clear read-only flags recursively. Files unpacked from zips
 * (e.g. dist/win-unpacked/* from the Electron zip) often carry the
 * read-only attribute, and deleting them fails with EPERM on Windows.
 */
function makeWritableRecursive(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) makeWritableRecursive(p)
      else fs.chmodSync(p, 0o666)
    } catch {
      /* per-file errors are retried/handled by rmSync below */
    }
  }
}

/** Tell the user if a running app instance locks the build output. */
function runningAppHint() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq zapret-gui.exe', '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8'
    })
    if (out.toLowerCase().includes('zapret-gui.exe')) {
      console.error('HINT: zapret-gui.exe is currently running — close the app and retry.')
    }
  } catch {
    /* tasklist itself failed; nothing more to say */
  }
}

let removed = 0
let failed = false
for (const dir of TARGETS) {
  const p = path.join(root, dir)
  if (!fs.existsSync(p)) {
    console.log(`skip ${dir}/ (not present)`)
    continue
  }
  try {
    makeWritableRecursive(p)
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    console.log(`removed ${dir}/`)
    removed++
  } catch (e) {
    failed = true
    console.error(`FAILED to remove ${dir}/: ${e.code ?? e.message}`)
    runningAppHint()
    console.error('HINT: an antivirus holding file handles or an open Explorer window can also lock it.')
  }
}

if (failed) process.exit(1)
console.log(removed > 0 ? 'Clean done.' : 'Nothing to clean.')
