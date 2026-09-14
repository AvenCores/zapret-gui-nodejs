/** Unit tests for strategy-updater version helpers (offline-safe). */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getBundledZapretVersion, getSystemHostsPath, applyHosts, upstreamSourceArchiveUrl } from '../src/main/strategy-updater'

describe('upstreamSourceArchiveUrl', () => {
  it('points at the source-tree snapshot, not release assets', () => {
    const url = upstreamSourceArchiveUrl()
    expect(url).toContain('codeload.github.com/Flowseal/zapret-discord-youtube/zip/refs/heads/main')
    expect(url).not.toContain('releases/download')
  })
})

describe('getBundledZapretVersion', () => {
  it('matches bundled-assets/service/version.txt', () => {
    const file = path.join(process.cwd(), 'bundled-assets', 'service', 'version.txt')
    if (!fs.existsSync(file)) return // assets not present
    expect(getBundledZapretVersion()).toBe(fs.readFileSync(file, 'utf8').trim())
  })

  it('returns a non-empty version string', () => {
    expect(getBundledZapretVersion()).toMatch(/^\d+\.\d+/)
  })
})

describe('getSystemHostsPath', () => {
  it('points at the OS hosts file', () => {
    const p = getSystemHostsPath()
    if (process.platform === 'linux') {
      expect(p).toBe('/etc/hosts')
    } else {
      expect(p.toLowerCase().replace(/\//g, '\\')).toContain('system32\\drivers\\etc\\hosts')
    }
  })
})

describe('applyHosts', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        for (const f of fs.readdirSync(d)) {
          try {
            fs.chmodSync(path.join(d, f), 0o666)
          } catch {
            /* ignore */
          }
        }
        fs.rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  function makeHosts(initial: string, readonly = false): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-hosts-test-'))
    dirs.push(dir)
    const p = path.join(dir, 'hosts')
    fs.writeFileSync(p, initial, 'utf8')
    if (readonly) fs.chmodSync(p, 0o444)
    return p
  }

  const BLOCK_V1 = '# zapret-block-start\n1.2.3.4 example.com\n# zapret-block-end'
  const BLOCK_V2 = '# zapret-block-start\n5.6.7.8 example.com\n# zapret-block-end'

  it('appends a missing block and keeps a backup of the original', async () => {
    const hostsPath = makeHosts('# original\n127.0.0.1 localhost\n')
    await applyHosts(BLOCK_V1, { hostsPath })
    const next = fs.readFileSync(hostsPath, 'utf8')
    expect(next).toContain('127.0.0.1 localhost')
    expect(next).toContain('1.2.3.4 example.com')
    expect(fs.readFileSync(`${hostsPath}.zapret-gui.bak`, 'utf8')).toBe('# original\n127.0.0.1 localhost\n')
  })

  it('writes into a read-only hosts file (Windows EPERM case)', async () => {
    const hostsPath = makeHosts('# original\n127.0.0.1 localhost\n', true)
    await applyHosts(BLOCK_V1, { hostsPath })
    // Writable again so afterEach cleanup works even on Windows.
    try {
      fs.chmodSync(hostsPath, 0o666)
    } catch {
      /* ignore */
    }
    expect(fs.readFileSync(hostsPath, 'utf8')).toContain('1.2.3.4 example.com')
  })

  it('replaces the existing block instead of duplicating it', async () => {
    const hostsPath = makeHosts(`# original\n${BLOCK_V1}\n`)
    await applyHosts(BLOCK_V2, { hostsPath })
    const next = fs.readFileSync(hostsPath, 'utf8')
    expect(next).toContain('5.6.7.8 example.com')
    expect(next).not.toContain('1.2.3.4')
    expect(next.match(/# zapret-block-start/g)?.length).toBe(1)
  })

  it('rejects empty/oversized content', async () => {
    const hostsPath = makeHosts('# original\n')
    await expect(applyHosts('', { hostsPath })).rejects.toThrow('Invalid hosts content')
  })

  it('throws a helpful error for a missing hosts file', async () => {
    const missing = path.join(os.tmpdir(), `zapret-no-such-hosts-${Date.now()}`)
    await expect(applyHosts(BLOCK_V1, { hostsPath: missing })).rejects.toThrow(/system hosts file/)
  })
})
