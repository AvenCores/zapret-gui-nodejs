/**
 * Dependency downloads on Linux — port of `src/lib/download.sh`:
 * `nfqws` from `bol-van/zapret` releases (per-arch) + strategies via git.
 * @module main/linux/download
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { LINUX_ZAPRET_REPO, LINUX_ZAPRET_RECOMMENDED_VERSION } from './constants'

export { LINUX_ZAPRET_RECOMMENDED_VERSION }

/** Map `uname -s/-m` to a zapret `binaries/<platform>` dir. Pure. */
export function mapPlatformDir(osName: string, arch: string): string {
  if (osName === 'Linux') {
    switch (arch) {
      case 'x64':
      case 'x86_64':
        return 'linux-x86_64'
      case 'ia32':
      case 'i686':
      case 'i386':
        return 'linux-x86'
      case 'arm':
        return 'linux-arm'
      case 'arm64':
      case 'aarch64':
        return 'linux-arm64'
      case 'mips64':
        return 'linux-mips64'
      case 'mips64el':
        return 'linux-mips64el'
      case 'mipsel':
        return 'linux-mipsel'
      case 'mips':
        return 'linux-mips'
      case 'ppc':
      case 'ppc64':
        return 'linux-ppc'
      default:
        throw new Error(`Unsupported Linux architecture: ${arch}`)
    }
  }
  if (osName === 'Darwin') return 'mac64'
  throw new Error(`Unsupported OS for nfqws download: ${osName}`)
}

/** Current platform dir (`linux-x86_64`, `linux-arm64`, ...). */
export function currentPlatformDir(): string {
  const osName = os.platform() === 'darwin' ? 'Darwin' : os.platform() === 'linux' ? 'Linux' : os.platform()
  return mapPlatformDir(osName, os.arch())
}

function fetchJson(url: string, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'zapret-gui' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        fetchJson(res.headers.location, timeoutMs).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => {
        body += c
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/** Resolve `latest` to a concrete tag via the GitHub releases API. */
export async function resolveZapretVersion(version: string): Promise<string> {
  if (version && version !== 'latest') return version
  const data = (await fetchJson(`https://api.github.com/repos/${LINUX_ZAPRET_REPO}/releases/latest`)) as {
    tag_name?: string
  }
  if (!data?.tag_name) throw new Error('Could not determine the latest zapret release')
  return data.tag_name
}

/** List zapret release tags (newest first, best-effort). */
export async function listZapretVersions(limit = 30): Promise<string[]> {
  try {
    const data = (await fetchJson(
      `https://api.github.com/repos/${LINUX_ZAPRET_REPO}/releases?per_page=${limit}`
    )) as Array<{ tag_name?: string }>
    return data.map((r) => String(r.tag_name ?? '')).filter(Boolean)
  } catch {
    return [LINUX_ZAPRET_RECOMMENDED_VERSION, 'latest']
  }
}

/** Shared tarball downloader (also used by the Windows engine updater). */
export function downloadToFile(url: string, dest: string, onProgress?: (t: number, total: number | null) => void): Promise<void> {  return new Promise((resolve, reject) => {
    const doGet = (u: string): void => {
      const req = https.get(u, { headers: { 'User-Agent': 'zapret-gui' } }, (res) => {
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
        const out = fs.createWriteStream(dest, { mode: 0o755 })
        res.on('data', (c: Buffer) => {
          transferred += c.length
          onProgress?.(transferred, total)
        })
        res.on('error', reject)
        res.pipe(out)
        out.on('close', () => resolve())
        out.on('error', reject)
      })
      req.on('error', reject)
    }
    doGet(url)
  })
}

/** Shared exec helper (also used by the Windows engine updater). */
export function execAsync(file: string, args: string[], timeoutMs = 120000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, out: `${stdout ?? ''}\n${stderr ?? ''}` })
    })
  })
}

/**
 * Download + extract the `nfqws` binary for the current platform.
 * Returns the absolute binary path.
 */
export async function downloadNfqws(
  version: string,
  outDir: string,
  opts: { platformDir?: string; onLog?: (t: string) => void; onProgress?: (p: { percent: number }) => void } = {}
): Promise<string> {
  const say = (t: string): void => opts.onLog?.(t)
  const platformDir = opts.platformDir ?? currentPlatformDir()
  const tag = await resolveZapretVersion(version || LINUX_ZAPRET_RECOMMENDED_VERSION)
  say(`Using zapret release ${tag} (${platformDir}) ...`)
  const archive = `zapret-${tag}.tar.gz`
  const url = `https://github.com/${LINUX_ZAPRET_REPO}/releases/download/${tag}/${archive}`
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-nfqws-')), archive)
  say(`Downloading ${url} ...`)
  await downloadToFile(url, tmp, (transferred, total) => {
    if (total) opts.onProgress?.({ percent: Math.round((transferred / total) * 100) })
  })
  const extractDir = path.join(path.dirname(tmp), 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })
  say('Extracting nfqws...')
  const tar = await execAsync('tar', ['-xzf', tmp, '-C', extractDir])
  if (tar.code !== 0) throw new Error(`tar extract failed: ${tar.out.slice(0, 300)}`)
  const found = findFileRecursive(extractDir, `binaries/${platformDir}/nfqws`)
  if (!found) throw new Error(`nfqws binary not found for platform ${platformDir} in ${tag}`)
  fs.mkdirSync(outDir, { recursive: true })
  const dest = path.join(outDir, 'nfqws')
  fs.copyFileSync(found, dest)
  try {
    fs.chmodSync(dest, 0o755)
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  say(`nfqws saved to ${dest}`)
  return dest
}

/** Shared recursive finder (also used by the Windows engine updater). */
export function findFileRecursive(root: string, suffix: string): string | null {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir) as string[]
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e)
      if (full.endsWith(suffix)) return full
      try {
        if (fs.statSync(full).isDirectory()) stack.push(full)
      } catch {
        /* ignore */
      }
    }
  }
  return null
}
