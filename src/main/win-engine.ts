/**
 * Windows engine (`winws.exe`) updater — downloads the binary for the
 * current arch from `bol-van/zapret` releases into `data/bin/`.
 * Only `winws.exe` is refreshed; `cygwin1.dll` / `WinDivert.*` stay pinned
 * by the Flowseal bundle (see `scripts/download-engine-bins.mjs`).
 * @module main/win-engine
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { downloadToFile, execAsync, findFileRecursive, resolveZapretVersion } from './linux/download'
import { LINUX_ZAPRET_REPO, LINUX_ZAPRET_RECOMMENDED_VERSION } from './linux/constants'

export const WINWS_BIN = 'winws.exe'

/** Map Node arch to a zapret `binaries/<platform>` dir. Pure. */
export function mapWindowsPlatformDir(arch: string): string {
  switch (arch) {
    case 'x64':
    case 'x86_64':
      return 'windows-x86_64'
    case 'ia32':
    case 'x86':
      return 'windows-x86'
    default:
      throw new Error(`Unsupported Windows architecture: ${arch}`)
  }
}

/** Current platform dir (`windows-x86_64` on normal installs). */
export function currentWindowsPlatformDir(): string {
  return mapWindowsPlatformDir(os.arch())
}

/**
 * Download + extract `winws.exe` for the current platform.
 * Returns the absolute binary path.
 */
export async function downloadWinws(
  version: string,
  binDir: string,
  opts: { platformDir?: string; onLog?: (t: string) => void; onProgress?: (p: { percent: number }) => void } = {}
): Promise<string> {
  const say = (t: string): void => opts.onLog?.(t)
  const platformDir = opts.platformDir ?? currentWindowsPlatformDir()
  const tag = await resolveZapretVersion(version || LINUX_ZAPRET_RECOMMENDED_VERSION)
  say(`Using zapret release ${tag} (${platformDir}) ...`)
  const archive = `zapret-${tag}.tar.gz`
  const url = `https://github.com/${LINUX_ZAPRET_REPO}/releases/download/${tag}/${archive}`
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-winws-')), archive)
  say(`Downloading ${url} ...`)
  await downloadToFile(url, tmp, (transferred, total) => {
    if (total) opts.onProgress?.({ percent: Math.round((transferred / total) * 100) })
  })
  const extractDir = path.join(path.dirname(tmp), 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })
  say('Extracting winws.exe...')
  // `tar` ships with Windows 10+; fall back to python when missing.
  let tar = await execAsync('tar', ['-xzf', tmp, '-C', extractDir])
  if (tar.code !== 0) {
    tar = await execAsync('python', ['-c', 'import sys,tarfile;tarfile.open(sys.argv[1]).extractall(sys.argv[2])', tmp, extractDir])
  }
  if (tar.code !== 0) throw new Error(`extract failed: ${tar.out.slice(0, 300)}`)
  const found = findFileRecursive(extractDir, `binaries/${platformDir}/winws.exe`)
  if (!found) throw new Error(`winws.exe not found for platform ${platformDir} in ${tag}`)
  fs.mkdirSync(binDir, { recursive: true })
  const dest = path.join(binDir, WINWS_BIN)
  fs.copyFileSync(found, dest)
  // Never leave a half-extracted temp dir behind.
  try {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  say(`winws.exe saved to ${dest}`)
  return dest
}
