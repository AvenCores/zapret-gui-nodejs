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

/** tg-proxy has its own file so session spam never rotates away app logs. */
export function getTgProxyLogPath(): string {
  return path.join(app.getPath('appData'), 'zapret-gui', 'tg-proxy.log')
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
 * First-run seeding: copy bundled `bin/`, `lists/`, `utils/`, `strategies/`
 * into the writable data dir (never overwrites user-modified files,
 * except that missing files are restored). Also creates `*-user.txt`
 * stubs exactly like `service.bat :load_user_lists`.
 *
 * Exception: `utils/check_updates.enabled` is user config behind the
 * Updates toggle (deleting it means "auto-check off"), not a plain
 * bundled asset — it is seeded only on fresh installs and never
 * restored for existing installs, otherwise "off" would flip back
 * on at every restart.
 */
export function ensureDataDirSeeded(): void {
  const bundled = getBundledAssetsDir()
  const data = getDataDir()
  const flagPath = path.join(data, 'utils', 'check_updates.enabled')
  const keepFlagOff = fs.existsSync(data) && !fs.existsSync(flagPath)
  fs.mkdirSync(data, { recursive: true })
  if (fs.existsSync(bundled)) {
    for (const sub of ['bin', 'lists', 'utils', 'strategies']) {
      const src = path.join(bundled, sub)
      if (fs.existsSync(src)) copyDirRecursive(src, path.join(data, sub))
    }
  }
  if (keepFlagOff) fs.rmSync(flagPath, { force: true })
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
}
