/**
 * Resolves filesystem locations for bundled assets and the writable data dir.
 *
 * Layout:
 * - dev:      `<repo>/bundled-assets`, `<repo>/.data` (writable clone)
 * - packaged: `<resources>/bundled-assets` (read-only), `%APPDATA%/zapret-gui/data`
 * @module main/paths
 */
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Driver files with a Win7-compatible (dual SHA1+SHA256) signature.
 * Shipped in `bundled-assets/bin-win7/`, applied over `data/bin/` on Win7.
 * Mirrors upstream `zapret-win-bundle/win7/install_win7.cmd`.
 */
export const WIN7_DIVERT_FILES = ['WinDivert.dll', 'WinDivert64.sys'] as const

/**
 * True for a Windows 7 kernel release (`6.1.xxxx`).
 * Pure — covered by unit tests.
 */
export function isWin7Release(release: string, platform: string): boolean {
  return platform === 'win32' && release.split('.')[0] === '6' && release.split('.')[1] === '1'
}

/** True when the current OS is Windows 7. */
export function isWindows7(): boolean {
  try {
    return isWin7Release(os.release(), os.platform())
  } catch {
    return false
  }
}

/** Read-only directory shipped inside the installer. */
export function getBundledAssetsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bundled-assets')
  }
  return path.join(app.getAppPath(), 'bundled-assets')
}

/** Writable per-user data directory: `%APPDATA%/zapret-gui/data`. */
export function getDataDir(): string {
  return path.join(app.getPath('appData'), 'zapret-gui', 'data')
}

export function getBinDir(): string {
  return path.join(getDataDir(), 'bin')
}

export function getListsDir(): string {
  return path.join(getDataDir(), 'lists')
}

export function getUtilsDir(): string {
  return path.join(getDataDir(), 'utils')
}

export function getStrategiesDir(): string {
  return path.join(getDataDir(), 'strategies')
}

export function getSettingsPath(): string {
  return path.join(app.getPath('appData'), 'zapret-gui', 'settings.json')
}

export function getAppLogPath(): string {
  return path.join(app.getPath('appData'), 'zapret-gui', 'app.log')
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else if (entry.isFile() && !fs.existsSync(d)) fs.copyFileSync(s, d)
  }
}

/**
 * Overwrite the WinDivert driver files in a data `bin/` dir with the
 * Win7-compatible variants from `bundled-assets/bin-win7/`.
 * No-op when the win7 bundle is missing. Always overwrites (unlike the
 * first-run seeding): driver files are not user config, and upstream
 * strategy updates may have restored the Win10-only variants.
 * @returns names of the files that were replaced
 */
export function applyWin7Drivers(bundledDir: string, dataBinDir: string): string[] {
  const srcDir = path.join(bundledDir, 'bin-win7')
  if (!fs.existsSync(srcDir)) return []
  const replaced: string[] = []
  for (const name of WIN7_DIVERT_FILES) {
    const src = path.join(srcDir, name)
    if (!fs.existsSync(src)) continue
    fs.mkdirSync(dataBinDir, { recursive: true })
    fs.copyFileSync(src, path.join(dataBinDir, name))
    replaced.push(name)
  }
  return replaced
}

/**
 * First-run seeding: copy bundled `bin/`, `lists/`, `utils/`, `strategies/`
 * into the writable data dir (never overwrites user-modified files,
 * except that missing files are restored). Also creates `*-user.txt`
 * stubs exactly like `service.bat :load_user_lists`.
 */
export function ensureDataDirSeeded(): void {
  const bundled = getBundledAssetsDir()
  const data = getDataDir()
  fs.mkdirSync(data, { recursive: true })
  if (fs.existsSync(bundled)) {
    for (const sub of ['bin', 'lists', 'utils', 'strategies']) {
      const src = path.join(bundled, sub)
      if (fs.existsSync(src)) copyDirRecursive(src, path.join(data, sub))
    }
  }
  const lists = getListsDir()
  fs.mkdirSync(lists, { recursive: true })
  const stubs: Array<[string, string]> = [
    ['ipset-exclude-user.txt', '203.0.113.113/32\n'],
    ['list-general-user.txt', '# Never leave this file empty\ndomain.example.abc\n'],
    ['list-exclude-user.txt', 'domain.example.abc\n']
  ]
  for (const [name, content] of stubs) {
    const p = path.join(lists, name)
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf8')
  }
  // ipset-all.txt must exist for mode detection (mirrors ipset_switch "none" state).
  const ipsetAll = path.join(lists, 'ipset-all.txt')
  if (!fs.existsSync(ipsetAll)) {
    fs.writeFileSync(ipsetAll, '203.0.113.113/32\n', 'utf8')
  }
  // On Windows 7 the stock drivers fail with 577 (bad signature):
  // overlay the dual-signed variants (upstream install_win7.cmd).
  if (isWindows7()) {
    applyWin7Drivers(bundled, getBinDir())
  }
}
