/**
 * Update logic: zapret version check, IPSet/hosts refresh and full
 * strategy-pack update from the upstream source tree (branch snapshot).
 * @module main/strategy-updater
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { app } from 'electron'
import { URLS, UPSTREAM_BRANCH } from '../shared/constants'
import type { DownloadProgress, UpdateInfo } from '../shared/types'
import { getListsDir, getStrategiesDir, getBinDir, getUtilsDir, getBundledAssetsDir, applyWin7Drivers, isWindows7 } from './paths'
import { parseBatContent } from './strategy-parser'

export type ProgressCb = (p: DownloadProgress) => void

const MAX_FETCH_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 5

function fetchText(url: string, timeoutMs = 15000, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'zapret-gui', 'Cache-Control': 'no-cache' }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects fetching ${url}`))
            return
          }
          fetchText(res.headers.location, timeoutMs, redirects + 1).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        let data = ''
        let bytes = 0
        res.setEncoding('utf8')
        res.on('data', (c) => {
          bytes += Buffer.byteLength(c, 'utf8')
          if (bytes > MAX_FETCH_BYTES) {
            req.destroy(new Error(`Response too large fetching ${url}`))
            return
          }
          data += c
        })
        res.on('error', reject)
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
        const onError = (e: Error): void => {
          try {
            out.destroy()
          } catch {
            /* ignore */
          }
          req.destroy()
          reject(e)
        }
        res.on('error', onError)
        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          onProgress?.({
            percent: total ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total
          })
        })
        res.pipe(out)
        // `finish` fires before the fd is flushed — wait for `close` so a
        // subsequent Expand-Archive never reads a partially-written ZIP.
        out.on('close', () => resolve())
        out.on('error', onError)
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
  // Guard against an HTML error page served with HTTP 200: it would poison
  // the ipset and silently break bypassing.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const looksLikeIpList = lines.length > 0 && lines.filter((l) => /^\s*[0-9a-fA-F.:/ ]/.test(l)).length >= lines.length / 2
  if (!looksLikeIpList) throw new Error('Downloaded IPSet data does not look like an IP list — aborting')
  const dest = path.join(getListsDir(), 'ipset-all.txt')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  // Atomic write: readers (getIPSetMode/winws) never see a half-written file.
  const tmp = `${dest}.tmp-${process.pid}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, dest)
  // Drop stale backup so "loaded" mode detection stays consistent.
  fs.rmSync(path.join(getListsDir(), 'ipset-all.txt.backup'), { force: true })
  return { lines: lines.length, bytes: Buffer.byteLength(text, 'utf8') }
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
  const hostsPath = getSystemHostsPath()
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

/** Absolute path of the Windows system hosts file. */
export function getSystemHostsPath(): string {
  if (process.platform === 'linux') return '/etc/hosts'
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
}

function isReadonlyFile(p: string): boolean {
  try {
    return (fs.statSync(p).mode & 0o200) === 0
  } catch {
    return false
  }
}

/** Best-effort removal of the read-only flag (hosts is often read-only). */
function clearReadonlyFlag(p: string): void {
  try {
    fs.chmodSync(p, 0o666)
  } catch {
    /* ignore — the write below will surface a proper error */
  }
}

function isAccessError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'EROFS'
}

function hostsWriteError(what: string, hostsPath: string, e: unknown): Error {
  const detail = e instanceof Error ? e.message : String(e)
  const priv =
    process.platform === 'linux'
      ? 'Run the app as root (or configure passwordless sudo) and retry.'
      : 'Run the app as administrator and allow hosts-file changes in your antivirus ' +
        '(Defender "Controlled folder access" / hosts protection), then retry.'
  return new Error(`Cannot ${what} the system hosts file (${hostsPath}): ${detail}. ${priv}`)
}

/**
 * Apply upstream hosts content into the system hosts file.
 * Existing zapret block (between first/last marker lines) is replaced;
 * otherwise the block is appended. A `.zapret-gui.bak` backup is kept.
 *
 * NOTE: a plain `rename(tmp, hosts)` fails with EPERM on Windows when
 * `hosts` is read-only or briefly locked by an antivirus/DNS client, so we
 * clear the read-only flag first and fall back to copy-overwrite when the
 * atomic rename is rejected. The staging tmp lives in the OS temp dir —
 * creating extra `*.tmp` files inside `drivers/etc` trips hosts protection
 * in some antiviruses.
 */
export async function applyHosts(remoteContent: string, opts?: { hostsPath?: string }): Promise<void> {
  if (typeof remoteContent !== 'string' || remoteContent.length === 0 || remoteContent.length > 1024 * 1024) {
    throw new Error('Invalid hosts content')
  }
  const hostsPath = opts?.hostsPath ?? getSystemHostsPath()
  let current: string
  try {
    current = fs.readFileSync(hostsPath, 'utf8')
  } catch (e) {
    throw hostsWriteError('read', hostsPath, e)
  }
  const remoteLines = remoteContent.split(/\r?\n/).filter((l) => l.length > 0)
  const first = remoteLines[0] ?? ''
  const last = remoteLines[remoteLines.length - 1] ?? ''
  // Keep the very first backup forever: overwriting it on every apply would
  // destroy the original hosts after the first run.
  const backupPath = `${hostsPath}.zapret-gui.bak`
  try {
    if (!fs.existsSync(backupPath)) fs.copyFileSync(hostsPath, backupPath)
  } catch (e) {
    throw hostsWriteError('back up', hostsPath, e)
  }
  let next: string
  if (first && last && current.includes(first) && current.includes(last)) {
    const start = current.indexOf(first)
    const end = current.indexOf(last, start) + last.length
    next = `${current.slice(0, start)}${remoteContent}\n${current.slice(end)}`
  } else {
    next = `${current.replace(/\s+$/, '')}\n\n${remoteContent}\n`
  }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-hosts-')), 'hosts')
  try {
    fs.writeFileSync(tmp, next, 'utf8')
  } catch (e) {
    throw hostsWriteError('stage', hostsPath, e)
  }
  const wasReadonly = isReadonlyFile(hostsPath)
  try {
    clearReadonlyFlag(hostsPath)
    try {
      // Atomic when the OS allows it (POSIX / unlocked Windows file).
      fs.renameSync(tmp, hostsPath)
    } catch (renameErr) {
      if (!isAccessError(renameErr)) throw renameErr
      // Windows fallback: rename into drivers/etc is rejected with EPERM
      // for read-only/locked hosts — overwrite the content in place instead.
      try {
        fs.copyFileSync(tmp, hostsPath)
      } catch (copyErr) {
        throw hostsWriteError('write', hostsPath, copyErr)
      }
    }
    // Restore the original read-only flag so we don't silently change the
    // file's semantics (next apply clears it again as needed).
    if (wasReadonly) {
      try {
        fs.chmodSync(hostsPath, 0o444)
      } catch {
        /* best-effort */
      }
    }
  } finally {
    try {
      fs.rmSync(tmp, { force: true })
      fs.rmdirSync(path.dirname(tmp))
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Source-tree snapshot URL for strategy/bin/lists updates.
 * Release assets (`releases/download/...`) are avoided on purpose: they
 * 504 far more often than codeload/raw, and the branch root already holds
 * everything needed (strategies as `*.bat` at the root + `bin/`, `lists/`).
 * Pure — covered by unit tests.
 */
export function upstreamSourceArchiveUrl(): string {
  return URLS.repoArchive(UPSTREAM_BRANCH)
}

/** Branch HEAD commit SHA (best-effort: null when the API is unreachable). */
export async function getBranchHeadSha(): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fetchText(URLS.branchHeadApi)) as { sha?: unknown }
    return typeof parsed.sha === 'string' && /^[0-9a-f]{4,40}$/i.test(parsed.sha) ? parsed.sha : null
  } catch {
    return null
  }
}

/**
 * Download the upstream branch snapshot, back up current bin/lists/utils/
 * strategies into `data/_backup/<timestamp>`, extract the archive via
 * PowerShell `Expand-Archive`, then refresh strategies + copy binaries/lists.
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
  say(`Requesting ${UPSTREAM_BRANCH} branch HEAD...`)
  const sha = await getBranchHeadSha()
  const tag = sha ? `${UPSTREAM_BRANCH}@${sha.slice(0, 7)}` : UPSTREAM_BRANCH
  const zipUrl = upstreamSourceArchiveUrl()
  say(`Downloading sources (${tag}) ...`)

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

  // 1b. upstream ships Win10-only drivers: on Win7 restore the
  // dual-signed variants so WinDivert keeps loading (error 577 otherwise).
  if (isWindows7()) {
    const fixed = applyWin7Drivers(getBundledAssetsDir(), path.join(dataDir, 'bin'))
    for (const name of fixed) {
      if (!filesUpdated.includes(`bin/${name}`)) filesUpdated.push(`bin/${name}`)
      say(`Win7 driver restored: bin/${name}`)
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
  if (process.platform === 'linux') return expandArchiveLinux(zipPath, dest)
  return new Promise((resolve, reject) => {
    // Paths come from %APPDATA% and may contain `'` (e.g. `O'Brien`).
    // PowerShell single-quoted strings escape `'` by doubling it (`''`).
    const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(zipPath)} -DestinationPath ${q(dest)} -Force`],
      { windowsHide: true, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`Expand-Archive failed: ${String(stderr || stdout).slice(0, 500)}`))
        else resolve()
      }
    )
  })
}

function expandArchiveLinux(zipPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Prefer `unzip` (present on most distros); fall back to python3 zipfile.
    execFile('unzip', ['-q', zipPath, '-d', dest], { timeout: 120000 }, (err, _stdout, stderr) => {
      if (!err) {
        resolve()
        return
      }
      execFile(
        'python3',
        ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, dest],
        { timeout: 120000 },
        (err2, _o2, stderr2) => {
          if (err2) reject(new Error(`unzip failed: ${String(stderr || err.message).slice(0, 300)}; python fallback: ${String(stderr2 || err2.message).slice(0, 300)}`))
          else resolve()
        }
      )
    })
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
  // Strict whitelist: renderer input must not traverse (`../../x`) or inject
  // extensions. Real fake names are `[A-Za-z0-9_-]+`.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fakeBaseName)) throw new Error(`Invalid fake name: ${fakeBaseName}`)
  if (kind !== 'discord' && kind !== 'game') throw new Error(`Invalid fake kind: ${kind}`)
  const bin = getBinDir()
  const src = path.join(bin, `${fakeBaseName}.bin`)
  if (!fs.existsSync(src)) throw new Error(`Fake not found: ${fakeBaseName}.bin`)
  const dest = path.join(bin, kind === 'discord' ? 'ACTIVE_DISCORD_UDP.bin' : 'ACTIVE_GAME_UDP.bin')
  fs.copyFileSync(src, dest)
}

// Re-exported for unit tests without pulling electron.
export { fetchText as fetchTextForTest }
