/**
 * Discord cache cleanup on Linux (`~/.config/discord*`).
 * Mirrors the Windows `clearDiscordCache` behavior (kill + rm Cache dirs).
 * @module main/discord-cache-linux
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { translate, type Locale } from '../shared/i18n'

function execOut(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000 }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, out: `${stdout ?? ''}\n${stderr ?? ''}` })
    })
  })
}

async function isProcRunning(pattern: string): Promise<boolean> {
  const r = await execOut('pgrep', ['-f', pattern])
  return r.code === 0 && r.out.trim().length > 0
}

/** Clear Discord caches on Linux. Returns human log lines. */
export async function clearDiscordCacheLinux(
  onLog?: (text: string) => void,
  locale: Locale = 'en'
): Promise<string[]> {
  const lines: string[] = []
  const home = os.homedir()
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  const variants: Array<{ proc: string; dir: string }> = [
    { proc: 'Discord', dir: 'discord' },
    { proc: 'DiscordPTB', dir: 'discordptb' },
    { proc: 'DiscordCanary', dir: 'discordcanary' },
    { proc: 'DiscordDevelopment', dir: 'discorddevelopment' }
  ]
  let found = false
  for (const { proc, dir } of variants) {
    const cacheDir = path.join(configHome, dir)
    if (!fs.existsSync(cacheDir)) continue
    found = true
    if (await isProcRunning(proc)) {
      await execOut('pkill', ['-f', proc])
      lines.push(translate(locale, 'tool.cacheClosed').replace('{dir}', dir))
    }
    for (const sub of ['Cache', 'Code Cache', 'GPUCache', 'Crashpad']) {
      const p = path.join(cacheDir, sub)
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { recursive: true, force: true })
          lines.push(translate(locale, 'tool.cacheCleared').replace('{dir}', dir).replace('{sub}', sub))
        } catch (e) {
          lines.push(
            translate(locale, 'tool.cacheFailed')
              .replace('{dir}', dir)
              .replace('{sub}', sub)
              .replace('{error}', String(e).slice(0, 120))
          )
        }
      }
    }
  }
  if (!found) lines.push(translate(locale, 'tool.cacheNotFound'))
  for (const l of lines) onLog?.(l)
  return lines
}
