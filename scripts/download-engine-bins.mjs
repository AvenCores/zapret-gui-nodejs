/**
 * Refresh the offline engine binaries shipped with the app from an
 * extracted zapret release (`binaries/` directory from
 * `zapret-vX.Y.tar.gz`, github.com/bol-van/zapret/releases):
 *
 * - Linux (desktop 32/64-bit only): `linux-x86_64/nfqws`, `linux-x86/nfqws`
 *   → `bundled-assets/bin-linux/<platform>/nfqws`
 * - Windows: `windows-x86_64/winws.exe` → `bundled-assets/bin/winws.exe`
 *   (cygwin1.dll / WinDivert.* are version-pinned by the Flowseal bundle
 *   and are intentionally left untouched)
 *
 * Usage:
 *   node scripts/download-engine-bins.mjs <path-to-extracted-binaries> [version] [--all] [--no-windows]
 *
 * Example (PowerShell):
 *   # 1. download zapret-v72.13.tar.gz from the releases page
 *   #    (may require a Defender exclusion for the archive)
 *   # 2. extract it, then run:
 *   node scripts/download-engine-bins.mjs C:\Users\me\Downloads\zapret-v72.13\binaries v72.13
 *
 * After running, keep the exec bit (`git update-index --chmod=+x
 * bundled-assets/bin-linux/<plat>/nfqws`) and bump
 * `LINUX_ZAPRET_RECOMMENDED_VERSION` in `src/main/linux/constants.ts`
 * to the given version.
 *
 * Plain Node.js, no dependencies.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LINUX_DEST = path.join(root, 'bundled-assets', 'bin-linux')
const WIN_DEST = path.join(root, 'bundled-assets', 'bin', 'winws.exe')

/** Desktop 32/64-bit Linux platforms shipped offline (see README). */
const LINUX_ALLOWLIST = ['linux-x86_64', 'linux-x86']

const args = process.argv.slice(2)
const srcDir = args.find((a) => !a.startsWith('--'))
const version = args.filter((a) => !a.startsWith('--'))[1] ?? ''
const syncAll = args.includes('--all')
const skipWindows = args.includes('--no-windows')

if (!srcDir || !fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error('Usage: node scripts/download-engine-bins.mjs <path-to-extracted-binaries> [version] [--all] [--no-windows]')
  process.exit(1)
}

let linuxCount = 0
const plats = fs
  .readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('linux-'))
  .map((e) => e.name)
for (const plat of plats) {
  if (!syncAll && !LINUX_ALLOWLIST.includes(plat)) {
    console.log(`  skip ${plat}: not a bundled desktop platform (use --all to force)`)
    continue
  }
  const from = path.join(srcDir, plat, 'nfqws')
  if (!fs.existsSync(from)) {
    console.warn(`  skip ${plat}: nfqws not found`)
    continue
  }
  const toDir = path.join(LINUX_DEST, plat)
  fs.mkdirSync(toDir, { recursive: true })
  fs.copyFileSync(from, path.join(toDir, 'nfqws'))
  console.log(`  ${plat}: nfqws (${fs.statSync(from).size} bytes)${version ? ` [${version}]` : ''}`)
  linuxCount++
}

let winDone = false
if (!skipWindows) {
  const from = path.join(srcDir, 'windows-x86_64', 'winws.exe')
  if (!fs.existsSync(from)) {
    console.warn('  skip windows: windows-x86_64/winws.exe not found')
  } else {
    fs.copyFileSync(from, WIN_DEST)
    console.log(`  windows-x86_64: winws.exe (${fs.statSync(from).size} bytes)${version ? ` [${version}]` : ''}`)
    winDone = true
  }
}

console.log(`Done: ${linuxCount} nfqws + ${winDone ? 'winws.exe' : 'no winws.exe'}.`);
console.log('Next: git update-index --chmod=+x on new nfqws files, then bump LINUX_ZAPRET_RECOMMENDED_VERSION.');
