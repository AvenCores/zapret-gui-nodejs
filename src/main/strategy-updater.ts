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
import { URLS, UPSTREAM_BRANCH, ENGINE_WIN64_DIR, ENGINE_FAKES_DIR, ENGINE_BIN_FILES, ENGINE_VERSION_FILE } from '../shared/constants'
import type { DownloadProgress, EngineRelease, EngineVersionInfo, UpdateInfo } from '../shared/types'
import { getListsDir, getStrategiesDir, getBinDir, getUtilsDir, getBundledAssetsDir } from './paths'
import { parseBatContent } from './strategy-parser'
import { getIPSetMode, setIPSetMode } from './service-manager'

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
          let next: string
          try {
            next = new URL(res.headers.location, url).href
          } catch {
            reject(new Error(`Bad redirect location fetching ${url}`))
            return
          }
          fetchText(next, timeoutMs, redirects + 1).then(resolve, reject)
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

/** Download a file with progress events. Follows redirects (capped). */
export function downloadFile(url: string, dest: string, onProgress?: ProgressCb, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string, redirects: number): void => {
      const req = https.get(u, { headers: { 'User-Agent': 'zapret-gui' }, timeout: timeoutMs }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects downloading ${u}`))
            return
          }
          // Upstream may answer with a relative Location — resolve it.
          let next: string
          try {
            next = new URL(res.headers.location, u).href
          } catch {
            reject(new Error(`Bad redirect location downloading ${u}`))
            return
          }
          doGet(next, redirects + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          return
        }
        const total = res.headers['content-length'] ? Number(res.headers['content-length']) : null
        let transferred = 0
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
        } catch (e) {
          // Thrown from an event-emitter callback this would escape the
          // Promise as an uncaught exception and crash main — route to reject.
          res.resume()
          reject(e instanceof Error ? e : new Error(String(e)))
          return
        }
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
    doGet(url, 0)
  })
}

/** Compare `X.Y.Z` versions (leading `v` tolerated). Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  // GitHub tags sometimes arrive as `v1.10.2`: without stripping, `Number('v1')`
  // is NaN and every comparison silently returns 0.
  const pa = a.trim().replace(/^[vV]/, '').split('.').map(Number)
  const pb = b.trim().replace(/^[vV]/, '').split('.').map(Number)
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
  const listsDir = getListsDir()
  const dest = path.join(listsDir, 'ipset-all.txt')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  // Remember the user's mode: a refresh replaces the underlying data, not
  // the mode choice — `none`/`any` must survive the update instead of being
  // silently reset to `loaded`. A missing file means "never configured"
  // (not `any`), so leave it loaded.
  const hadFile = fs.existsSync(dest)
  const prevMode = hadFile ? getIPSetMode(listsDir) : 'loaded'
  // Atomic write: readers (getIPSetMode/winws) never see a half-written file.
  // Unique temp name — two concurrent updates must not share `.tmp-<pid>`
  // and truncate each other's file.
  const tmp = `${dest}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, dest)
  // Drop stale backup so "loaded" mode detection stays consistent.
  fs.rmSync(path.join(listsDir, 'ipset-all.txt.backup'), { force: true })
  if (prevMode === 'none' || prevMode === 'any') {
    // Re-apply the user's mode on top of the fresh list (fresh backup for `none`).
    setIPSetMode(listsDir, prevMode)
  }
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
  // EXDEV (cross-device rename, e.g. TMP on another drive) is handled by the
  // same copy-overwrite fallback as permission errors.
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'EROFS' || code === 'EXDEV'
}

function hostsWriteError(what: string, hostsPath: string, e: unknown): Error {
  const detail = e instanceof Error ? e.message : String(e)
  return new Error(
    `Cannot ${what} the system hosts file (${hostsPath}): ${detail}. ` +
      'Run the app as administrator and allow hosts-file changes in your antivirus ' +
      '(Defender "Controlled folder access" / hosts protection), then retry.'
  )
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
  await writeHostsFile(hostsPath, next)
}

/** Shared writer for the system hosts file (read-only flag + AV-lock fallback). */
async function writeHostsFile(hostsPath: string, next: string): Promise<void> {
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

export interface RemoveHostsOptions {
  hostsPath?: string
  firstLine?: string
  lastLine?: string
  remoteContent?: string
}

/**
 * Remove the zapret block from the system hosts file.
 * Returns `true` when something was removed, `false` when no zapret
 * entries were found (file left untouched, no backup created).
 *
 * Works offline: the renderer passes `firstLine`/`lastLine`/`remoteContent`
 * from the last check, so no network fetch is needed. When both markers are
 * present the whole slice is cut; otherwise any lines matching the known
 * upstream content are filtered out (handles partial installs and outdated
 * upstreams).
 */
export async function removeHosts(opts?: RemoveHostsOptions): Promise<boolean> {
  const hostsPath = opts?.hostsPath ?? getSystemHostsPath()
  let current: string
  try {
    current = fs.readFileSync(hostsPath, 'utf8')
  } catch (e) {
    throw hostsWriteError('read', hostsPath, e)
  }
  let first = (opts?.firstLine ?? '').trim()
  let last = (opts?.lastLine ?? '').trim()
  const remote = typeof opts?.remoteContent === 'string' ? opts.remoteContent : ''
  const remoteLines = remote.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (!first && remoteLines.length > 0) first = remoteLines[0] ?? ''
  if (!last && remoteLines.length > 0) last = remoteLines[remoteLines.length - 1] ?? ''
  // Fall back to the bundled upstream copy so removal also works when the
  // renderer never checked (offline, changed upstream, etc.).
  let reference = new Set(remoteLines)
  if (reference.size === 0 || (!first && !last)) {
    try {
      const bundled = fs.readFileSync(path.join(getBundledAssetsDir(), 'service', 'hosts'), 'utf8')
      for (const l of bundled.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)) {
        reference.add(l)
      }
      const arr = [...reference]
      if (!first && arr.length > 0) first = arr[0] ?? ''
      if (!last && arr.length > 0) last = arr[arr.length - 1] ?? ''
    } catch {
      /* bundled copy unavailable — marker-only removal below */
    }
  }

  let next = current
  let removed = false

  if (first && last && current.includes(first) && current.includes(last)) {
    const start = current.indexOf(first)
    const end = current.indexOf(last, start) + last.length
    const lineStart = current.lastIndexOf('\n', start) + 1
    let lineEnd = current.indexOf('\n', end)
    lineEnd = lineEnd === -1 ? current.length : lineEnd + 1
    next = current.slice(0, lineStart) + current.slice(lineEnd)
    removed = true
  }

  if (reference.size > 0) {
    const lines = next.split(/\r?\n/)
    const kept = lines.filter((l) => !reference.has(l.trim()))
    if (kept.length !== lines.length) {
      removed = true
      next = kept.join('\n')
    }
  }

  if (!removed) {
    // Single-marker partial install with no reference match: drop the marker line itself.
    const markers = [first, last].filter((m) => m.length > 0)
    if (markers.length > 0) {
      const lines = next.split(/\r?\n/)
      const kept = lines.filter((l) => !markers.some((m) => l.includes(m)))
      if (kept.length !== lines.length) {
        removed = true
        next = kept.join('\n')
      }
    }
  }

  if (!removed) return false

  // Collapse the gap left by the removed block, keep a trailing newline.
  next = next.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n')
  if (next.length > 0 && !next.endsWith('\n')) next += '\n'

  // Keep the very first backup forever (same policy as applyHosts).
  const backupPath = `${hostsPath}.zapret-gui.bak`
  try {
    if (!fs.existsSync(backupPath)) fs.copyFileSync(hostsPath, backupPath)
  } catch (e) {
    throw hostsWriteError('back up', hostsPath, e)
  }
  await writeHostsFile(hostsPath, next)
  return true
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
  pruneOldBackups(dataDir)
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
  let batFiles: string[]
  try {
    batFiles = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.bat') && !/^service/i.test(f))
  } catch (e) {
    throw new Error(`Strategy snapshot is empty or unreadable: ${e instanceof Error ? e.message : String(e)}`)
  }
  const stratDir = getStrategiesDir()
  fs.mkdirSync(stratDir, { recursive: true })
  for (const bat of batFiles) {
    const content = fs.readFileSync(path.join(root, bat), 'utf8')
    const { strategy } = parseBatContent(content, bat)
    strategy.origin = 'bundled'
    const dest = path.join(stratDir, `${strategy.id}.json`)
    // Never clobber a user-imported strategy that happens to share the id —
    // it would be silently lost on every update.
    try {
      const existing = JSON.parse(fs.readFileSync(dest, 'utf8')) as { origin?: unknown }
      if (existing?.origin === 'imported') {
        say(`Keeping imported strategy "${strategy.id}" (bundled refresh skipped).`)
        continue
      }
    } catch {
      /* missing or broken — write the bundled file */
    }
    fs.writeFileSync(dest, JSON.stringify(strategy, null, 2), 'utf8')
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

/**
 * Keep only the newest `keep` entries under `data/_backup`.
 * Every strategies/engine update snapshots all of bin/lists/utils/
 * strategies — without pruning this grows without bound (disk leak).
 * Backup names are ISO timestamps, so lexicographic order is chronological.
 * Best-effort: pruning must never fail the update itself.
 */
function pruneOldBackups(dataDir: string, keep = 5): void {
  try {
    const root = path.join(dataDir, '_backup')
    if (!fs.existsSync(root)) return
    const entries = fs.readdirSync(root).sort()
    const stale = entries.slice(0, Math.max(0, entries.length - keep))
    for (const name of stale) {
      try {
        fs.rmSync(path.join(root, name), { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
}

function expandArchive(zipPath: string, dest: string): Promise<void> {
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

function singleChildDir(dir: string): string | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
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

/**
 * DPI engine (bol-van/zapret) releases: versioned assets with Windows
 * `winws.exe` binaries (`binaries/windows-x86_64/` inside
 * `zapret-<tag>.zip`). Unlike the Flowseal data snapshot above, engine
 * releases are version-pinned so the user can manually install any tag.
 */

/** True for a plausible engine tag (`v72.13`). Pure — covered by unit tests. */
export function isValidEngineTag(tag: string): boolean {
  return /^v\d[\w.\-]{0,31}$/.test(tag.trim())
}

/** Direct download URL of the release asset for a tag. Pure — covered by unit tests. */
export function engineAssetUrl(tag: string): string {
  const t = tag.trim()
  if (!isValidEngineTag(t)) throw new Error(`Invalid engine tag: ${tag.slice(0, 32)}`)
  return URLS.engineAsset(t)
}

/** Compare engine tags (`v72.13` > `v72.9`): 1 if a > b, -1 if a < b, 0 if equal. Pure. */
export function compareEngineVersions(a: string, b: string): number {
  const norm = (s: string): number[] =>
    s
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((p) => {
        const n = parseInt(p, 10)
        return Number.isFinite(n) && n >= 0 ? n : 0
      })
  const pa = norm(a)
  const pb = norm(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

interface GithubReleaseJson {
  tag_name?: unknown
  name?: unknown
  published_at?: unknown
  created_at?: unknown
  html_url?: unknown
  assets?: unknown
}

/**
 * Map raw GitHub releases API JSON to {@link EngineRelease} list.
 * Skips drafts/invalid entries, keeps API order (newest first).
 * Pure — covered by unit tests.
 */
export function parseEngineReleases(json: unknown, limit = 20): EngineRelease[] {
  if (!Array.isArray(json)) return []
  const out: EngineRelease[] = []
  for (const item of json as GithubReleaseJson[]) {
    if (out.length >= limit) break
    if (typeof item !== 'object' || item === null) continue
    const tag = typeof item.tag_name === 'string' ? item.tag_name.trim() : ''
    if (!isValidEngineTag(tag)) continue
    const expectedAsset = `zapret-${tag}.zip`
    let zipUrl: string | null = null
    if (Array.isArray(item.assets)) {
      for (const a of item.assets as Array<{ name?: unknown; browser_download_url?: unknown }>) {
        if (
          typeof a === 'object' &&
          a !== null &&
          a.name === expectedAsset &&
          typeof a.browser_download_url === 'string' &&
          a.browser_download_url.startsWith('https://')
        ) {
          zipUrl = a.browser_download_url
          break
        }
      }
    }
    out.push({
      tag,
      name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, 64) : tag,
      publishedAt:
        typeof item.published_at === 'string'
          ? item.published_at
          : typeof item.created_at === 'string'
            ? item.created_at
            : '',
      htmlUrl:
        typeof item.html_url === 'string' && item.html_url.startsWith('https://')
          ? item.html_url
          : URLS.engineReleaseTag(tag),
      zipUrl: zipUrl ?? URLS.engineAsset(tag)
    })
  }
  return out
}

/** List bol-van/zapret releases (newest first). Throws on network errors. */
export async function listEngineReleases(limit = 20): Promise<EngineRelease[]> {
  const raw = await fetchText(URLS.engineReleasesApi, 20000)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Cannot parse engine releases response')
  }
  return parseEngineReleases(parsed, Math.min(Math.max(limit, 1), 50))
}

/** Local engine version: data `bin/` first, then bundled assets. Never throws. */
export function getLocalEngineVersion(): string {
  const candidates = [
    path.join(getBinDir(), ENGINE_VERSION_FILE),
    path.join(getBundledAssetsDir(), 'bin', ENGINE_VERSION_FILE),
    path.join(getBundledAssetsDir(), 'service', ENGINE_VERSION_FILE)
  ]
  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim()
      if (v) return v
    } catch {
      /* try next */
    }
  }
  return 'v0'
}

/** Compare local engine version with the latest upstream tag (best-effort). */
export async function checkEngineUpdates(): Promise<EngineVersionInfo> {
  const local = getLocalEngineVersion()
  let remote: string | null = null
  try {
    remote = (await listEngineReleases(5))[0]?.tag ?? null
  } catch {
    remote = null
  }
  return {
    local,
    remote,
    updateAvailable: remote !== null && compareEngineVersions(remote, local) > 0,
    releasesUrl: URLS.engineReleasesPage,
    checkedAt: new Date().toISOString()
  }
}

function runBestEffort(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, () => resolve())
    } catch {
      resolve()
    }
  })
}

/**
 * Install engine binaries for a pinned release tag into `data/bin/`:
 * downloads `zapret-<tag>.zip`, backs up current `bin/` into
 * `data/_backup/<timestamp>/bin`, then copies the allowlisted Windows
 * x64 binaries + refreshes overlapping `.bin` fakes (never deletes
 * Flowseal-specific files, never touches `ACTIVE_*`).
 * Emits 0..100 progress through `onProgress`.
 */
export async function updateEngineToTag(
  dataDir: string,
  tag: string,
  onProgress?: ProgressCb,
  onLog?: (text: string) => void
): Promise<{ tag: string; filesUpdated: string[]; backupDir: string }> {
  const cleanTag = tag.trim()
  if (!isValidEngineTag(cleanTag)) throw new Error(`Invalid engine tag: ${tag.slice(0, 32)}`)
  const say = (t: string): void => {
    onLog?.(t)
  }
  // winws.exe is locked while the service runs — quiesce best-effort so the
  // copy below does not fail with EBUSY/EPERM (user restarts it afterwards).
  say(`Stopping zapret service before engine update (if running)...`)
  await runBestEffort('net.exe', ['stop', 'zapret'], 20000)
  await runBestEffort('taskkill.exe', ['/IM', 'winws.exe', '/F'], 10000)

  const zipUrl = engineAssetUrl(cleanTag)
  say(`Downloading zapret engine ${cleanTag} ...`)
  const safeTag = cleanTag.replace(/[\\/:"*?<>|]/g, '_')
  const tmp = path.join(dataDir, '_tmp')
  fs.mkdirSync(tmp, { recursive: true })
  const zipPath = path.join(tmp, `zapret-engine-${safeTag}.zip`)
  await downloadFile(zipUrl, zipPath, (p) => onProgress?.({ ...p, percent: Math.round(p.percent * 0.7) }))

  const backupDir = path.join(dataDir, '_backup', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(backupDir, { recursive: true })
  const dataBin = path.join(dataDir, 'bin')
  if (fs.existsSync(dataBin)) {
    await copyRecursive(dataBin, path.join(backupDir, 'bin'))
    pruneOldBackups(dataDir)
    say(`Backup saved to ${backupDir}`)
  }

  const extractDir = path.join(tmp, `engine-${safeTag}`)
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  await expandArchive(zipPath, extractDir)
  onProgress?.({ percent: 75, transferred: 0, total: null })

  const root = singleChildDir(extractDir) ?? extractDir
  const srcWin = path.join(root, ...ENGINE_WIN64_DIR.split('/'))
  if (!fs.existsSync(srcWin)) throw new Error(`Windows binaries not found in ${cleanTag} release asset`)
  const filesUpdated: string[] = []
  fs.mkdirSync(dataBin, { recursive: true })
  for (const name of ENGINE_BIN_FILES) {
    const src = path.join(srcWin, name)
    if (!fs.existsSync(src)) continue
    const dest = path.join(dataBin, name)
    try {
      if (!fs.existsSync(dest) || !filesEqual(src, dest)) {
        fs.copyFileSync(src, dest)
        filesUpdated.push(`bin/${name}`)
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new Error(
          `Cannot replace ${name}: file is locked. Stop the zapret service (Dashboard → Stop) and retry.`
        )
      }
      throw e
    }
  }
  // Refresh overlapping fake payloads from the release (`files/fake/`);
  // Flowseal-specific names stay untouched, ACTIVE_* are user selection.
  const srcFake = path.join(root, ...ENGINE_FAKES_DIR.split('/'))
  if (fs.existsSync(srcFake)) {
    let destFiles: string[] = []
    try {
      destFiles = fs.readdirSync(dataBin).filter((f) => f.toLowerCase().endsWith('.bin'))
    } catch {
      destFiles = []
    }
    for (const f of destFiles) {
      if (/^ACTIVE_/i.test(f)) continue
      const src = path.join(srcFake, f)
      if (!fs.existsSync(src)) continue
      const dest = path.join(dataBin, f)
      if (!filesEqual(src, dest)) {
        try {
          fs.copyFileSync(src, dest)
          filesUpdated.push(`bin/${f}`)
        } catch {
          /* best-effort: a locked fake must not fail the whole update */
        }
      }
    }
  }
  fs.writeFileSync(path.join(dataBin, ENGINE_VERSION_FILE), `${cleanTag}\n`, 'utf8')

  onProgress?.({ percent: 100, transferred: 0, total: null })
  fs.rmSync(zipPath, { force: true })
  fs.rmSync(extractDir, { recursive: true, force: true })
  say(`Engine updated to ${cleanTag}: ${filesUpdated.length} files.`)
  return { tag: cleanTag, filesUpdated, backupDir }
}

/** Local .bin fake names available in bin/ (excluding ACTIVE_*). */
export function listAvailableFakes(): { discordActive: string | null; gameActive: string | null; all: string[] } {  const bin = getBinDir()
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
