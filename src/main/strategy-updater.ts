/**
 * Update logic: zapret version check, IPSet/hosts refresh and full
 * strategy-pack update from the upstream GitHub release ZIP.
 * @module main/strategy-updater
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { app } from 'electron'
import { URLS } from '../shared/constants'
import type { DownloadProgress, UpdateInfo } from '../shared/types'
import { getListsDir, getStrategiesDir, getBinDir, getUtilsDir, getBundledAssetsDir } from './paths'
import { parseBatContent } from './strategy-parser'

export type ProgressCb = (p: DownloadProgress) => void

function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'zapret-gui', 'Cache-Control': 'no-cache' }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          fetchText(res.headers.location, timeoutMs).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => resolve(data))
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`timeout fetching ${url}`))
    })
    req.on('error', reject)
  })
}

/** Download a file with progress events. Follows one redirect. */
export function downloadFile(url: string, dest: string, onProgress?: ProgressCb, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string): void => {
      const req = https.get(u, { headers: { 'User-Agent': 'zapret-gui' }, timeout: timeoutMs }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          doGet(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          return
        }
        const total = res.headers['content-length'] ? Number(res.headers['content-length']) : null
        let transferred = 0
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        const out = fs.createWriteStream(dest)
        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          onProgress?.({
            percent: total ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total
          })
        })
        res.pipe(out)
        out.on('finish', () => {
          out.close()
          resolve()
        })
        out.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new Error('download timeout')))
      req.on('error', reject)
    }
    doGet(url)
  })
}

/** Compare `X.Y.Z` versions. Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().split('.').map(Number)
  const pb = b.trim().split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/**
 * Local zapret *data* version shipped with the app
 * (`bundled-assets/service/version.txt`, mirrors upstream `.service/version.txt`).
 * NOTE: this is intentionally not the app version from package.json —
 * the two evolve independently.
 */
export function getBundledZapretVersion(): string {
  try {
    const v = fs.readFileSync(path.join(getBundledAssetsDir(), 'service', 'version.txt'), 'utf8').trim()
    if (v) return v
  } catch {
    /* ignore */
  }
  return '0.0.0'
}

/** Fetch upstream version.txt and compare with the bundled zapret data version. */
export async function checkZapretUpdates(): Promise<UpdateInfo> {
  const localVersion = getBundledZapretVersion()
  let remoteVersion: string | null = null
  try {
    remoteVersion = (await fetchText(URLS.versionTxt)).trim()
  } catch {
    remoteVersion = null
  }
  const updateAvailable =
    remoteVersion !== null && remoteVersion.length > 0 && compareVersions(remoteVersion, localVersion) > 0
  return {
    localVersion,
    remoteVersion,
    updateAvailable,
    releaseUrl: remoteVersion ? URLS.releaseTag(remoteVersion) : URLS.releasesPage,
    checkedAt: new Date().toISOString(),
    appVersion: app.getVersion()
  }
}

/** Refresh `lists/ipset-all.txt` from upstream `.service/ipset-service.txt`. */
export async function updateIPSetList(): Promise<{ lines: number; bytes: number }> {
  const text = await fetchText(URLS.ipsetTxt, 60000)
  const dest = path.join(getListsDir(), 'ipset-all.txt')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, text, 'utf8')
  // Drop stale backup so "loaded" mode detection stays consistent.
  fs.rmSync(path.join(getListsDir(), 'ipset-all.txt.backup'), { force: true })
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length
  return { lines, bytes: Buffer.byteLength(text, 'utf8') }
}

export interface HostsCheck {
  needsUpdate: boolean
  firstLine: string
  lastLine: string
  remoteContent: string
  currentHasFirst: boolean
  currentHasLast: boolean
}

/** Download upstream hosts and compare first/last lines (like service.bat). */
export async function checkHosts(): Promise<HostsCheck> {
  const remote = await fetchText(`${URLS.hostsTxt}?t=${Date.now()}`, 15000)
  const remoteLines = remote.split(/\r?\n/).filter((l) => l.length > 0)
  const firstLine = remoteLines[0] ?? ''
  const lastLine = remoteLines[remoteLines.length - 1] ?? ''
  const hostsPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  let current = ''
  try {
    current = fs.readFileSync(hostsPath, 'utf8')
  } catch {
    current = ''
  }
  const currentHasFirst = firstLine !== '' && current.includes(firstLine)
  const currentHasLast = lastLine !== '' && current.includes(lastLine)
  return { needsUpdate: !currentHasFirst || !currentHasLast, firstLine, lastLine, remoteContent: remote, currentHasFirst, currentHasLast }
}

/**
 * Apply upstream hosts content into the system hosts file.
 * Existing zapret block (between first/last marker lines) is replaced;
 * otherwise the block is appended. A `.zapret-gui.bak` backup is kept.
 */
export async function applyHosts(remoteContent: string): Promise<void> {
  const hostsPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  const current = fs.readFileSync(hostsPath, 'utf8')
  const remoteLines = remoteContent.split(/\r?\n/).filter((l) => l.length > 0)
  const first = remoteLines[0] ?? ''
  const last = remoteLines[remoteLines.length - 1] ?? ''
  fs.copyFileSync(hostsPath, `${hostsPath}.zapret-gui.bak`)
  let next: string
  if (first && last && current.includes(first) && current.includes(last)) {
    const start = current.indexOf(first)
    const end = current.indexOf(last) + last.length
    next = `${current.slice(0, start)}${remoteContent}\n${current.slice(end)}`
  } else {
    next = `${current.replace(/\s+$/, '')}\n\n${remoteContent}\n`
  }
  fs.writeFileSync(hostsPath, next, 'utf8')
}

interface GithubRelease {
  tag_name: string
  zipball_url: string
  assets: Array<{ name: string; browser_download_url: string }>
}

/** Latest upstream release metadata via GitHub API. */
export async function getLatestRelease(): Promise<GithubRelease> {
  const text = await fetchText(URLS.releasesLatestApi)
  return JSON.parse(text) as GithubRelease
}

/**
 * Download the latest release ZIP, back up current bin/lists/utils/*.bat
 * into `data/_backup/<timestamp>`, extract the archive via PowerShell
 * `Expand-Archive`, then refresh strategies + copy new binaries/lists.
 * Emits 0..100 progress through `onProgress`.
 */
export async function updateStrategiesFromGithub(
  dataDir: string,
  onProgress?: ProgressCb,
  onLog?: (text: string) => void
): Promise<{ tag: string; filesUpdated: string[]; backupDir: string }> {
  const say = (t: string): void => {
    onLog?.(t)
  }
  say('Requesting latest release info...')
  const rel = await getLatestRelease()
  const tag = rel.tag_name
  // Prefer an attached .zip asset, fall back to zipball.
  const zipAsset = rel.assets.find((a) => a.name.toLowerCase().endsWith('.zip'))
  const zipUrl = zipAsset?.browser_download_url ?? rel.zipball_url
  say(`Downloading ${tag} ...`)

  const tmp = path.join(dataDir, '_tmp')
  fs.mkdirSync(tmp, { recursive: true })
  const zipPath = path.join(tmp, `zapret-${tag}.zip`.replace(/[\\/:"*?<>|]/g, '_'))
  await downloadFile(zipUrl, zipPath, (p) => onProgress?.({ ...p, percent: Math.round(p.percent * 0.8) }))

  const backupDir = path.join(dataDir, '_backup', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(backupDir, { recursive: true })
  for (const sub of ['bin', 'lists', 'utils', 'strategies']) {
    const src = path.join(dataDir, sub)
    if (fs.existsSync(src)) {
      await copyRecursive(src, path.join(backupDir, sub))
    }
  }
  say(`Backup saved to ${backupDir}`)

  const extractDir = path.join(tmp, 'extracted')
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  await expandArchive(zipPath, extractDir)
  onProgress?.({ percent: 85, transferred: 0, total: null })

  // GitHub zips nest everything under one top-level folder.
  const root = singleChildDir(extractDir) ?? extractDir
  const filesUpdated: string[] = []

  // 1. copy binaries + lists + utils (only changed files, by size+mtime heuristic → hash compare)
  for (const sub of ['bin', 'lists', 'utils']) {
    const srcDir = path.join(root, sub)
    if (!fs.existsSync(srcDir)) continue
    const destDir = path.join(dataDir, sub)
    for (const f of walkFiles(srcDir)) {
      const relP = path.relative(srcDir, f)
      // Never clobber user lists.
      if (sub === 'lists' && /-user\.txt$/i.test(relP)) continue
      const dest = path.join(destDir, relP)
      if (!fs.existsSync(dest) || !filesEqual(f, dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(f, dest)
        filesUpdated.push(`${sub}/${relP}`)
      }
    }
  }

  // 2. refresh strategies/*.json from *.bat at archive root
  const batFiles = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.bat') && !/^service/i.test(f))
  const stratDir = getStrategiesDir()
  fs.mkdirSync(stratDir, { recursive: true })
  for (const bat of batFiles) {
    const content = fs.readFileSync(path.join(root, bat), 'utf8')
    const { strategy } = parseBatContent(content, bat)
    strategy.origin = 'bundled'
    fs.writeFileSync(path.join(stratDir, `${strategy.id}.json`), JSON.stringify(strategy, null, 2), 'utf8')
    if (!filesUpdated.includes(`strategies/${strategy.id}.json`)) filesUpdated.push(`strategies/${strategy.id}.json`)
  }

  onProgress?.({ percent: 100, transferred: 0, total: null })
  fs.rmSync(zipPath, { force: true })
  say(`Updated ${filesUpdated.length} files from ${tag}.`)
  return { tag, filesUpdated, backupDir }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) await copyRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

function expandArchive(zipPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`],
      { windowsHide: true, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`Expand-Archive failed: ${String(stderr || stdout).slice(0, 500)}`))
        else resolve()
      }
    )
  })
}

function singleChildDir(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) return path.join(dir, entries[0].name)
  return null
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

function filesEqual(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    if (sa.size !== sb.size) return false
    const ba = fs.readFileSync(a)
    const bb = fs.readFileSync(b)
    return ba.equals(bb)
  } catch {
    return false
  }
}

/** Local .bin fake names available in bin/ (excluding ACTIVE_*). */
export function listAvailableFakes(): { discordActive: string | null; gameActive: string | null; all: string[] } {
  const bin = getBinDir()
  let files: string[] = []
  try {
    files = fs.readdirSync(bin).filter((f) => f.toLowerCase().endsWith('.bin'))
  } catch {
    files = []
  }
  const matchActive = (active: string): string | null => {
    const ap = path.join(bin, active)
    if (!fs.existsSync(ap)) return null
    try {
      const ah = fs.readFileSync(ap)
      for (const f of files) {
        if (/^ACTIVE_/i.test(f)) continue
        try {
          if (fs.readFileSync(path.join(bin, f)).equals(ah)) return f.replace(/\.bin$/i, '')
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return null
  }
  return {
    discordActive: matchActive('ACTIVE_DISCORD_UDP.bin'),
    gameActive: matchActive('ACTIVE_GAME_UDP.bin'),
    all: files.filter((f) => !/^ACTIVE_/i.test(f)).map((f) => f.replace(/\.bin$/i, ''))
  }
}

/** Replace an ACTIVE_*.bin with a copy of another .bin fake. */
export function replaceActiveFake(kind: 'discord' | 'game', fakeBaseName: string): void {
  const bin = getBinDir()
  const src = path.join(bin, `${fakeBaseName}.bin`)
  if (!fs.existsSync(src)) throw new Error(`Fake not found: ${fakeBaseName}.bin`)
  const dest = path.join(bin, kind === 'discord' ? 'ACTIVE_DISCORD_UDP.bin' : 'ACTIVE_GAME_UDP.bin')
  fs.copyFileSync(src, dest)
}

// Re-exported for unit tests without pulling electron.
export { fetchText as fetchTextForTest }
