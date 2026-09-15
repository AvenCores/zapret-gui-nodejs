/** Unit tests for strategy-updater version helpers (offline-safe). */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getBundledZapretVersion,
  getSystemHostsPath,
  applyHosts,
  upstreamSourceArchiveUrl,
  isValidEngineTag,
  engineAssetUrl,
  compareEngineVersions,
  parseEngineReleases,
  getLocalEngineVersion
} from '../src/main/strategy-updater'

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
  it('points at the Windows system hosts file', () => {
    expect(getSystemHostsPath().toLowerCase().replace(/\//g, '\\')).toContain('system32\\drivers\\etc\\hosts')
  })
})

describe('engine tags (bol-van/zapret releases)', () => {
  it('validates tags', () => {
    expect(isValidEngineTag('v72.13')).toBe(true)
    expect(isValidEngineTag('v72.9')).toBe(true)
    expect(isValidEngineTag('72.13')).toBe(false)
    expect(isValidEngineTag('')).toBe(false)
    expect(isValidEngineTag('v72.13; rm -rf /')).toBe(false)
    expect(isValidEngineTag('../../etc')).toBe(false)
  })

  it('builds the release asset URL, never a raw/path-traversal URL', () => {
    expect(engineAssetUrl('v72.13')).toBe('https://github.com/bol-van/zapret/releases/download/v72.13/zapret-v72.13.zip')
    expect(() => engineAssetUrl('../evil')).toThrow('Invalid engine tag')
  })

  it('compares versions numerically (v72.13 > v72.9)', () => {
    expect(compareEngineVersions('v72.13', 'v72.9')).toBe(1)
    expect(compareEngineVersions('v72.9', 'v72.13')).toBe(-1)
    expect(compareEngineVersions('v72.13', 'v72.13')).toBe(0)
    expect(compareEngineVersions('v73', 'v72.13')).toBe(1)
  })

  it('parses the GitHub releases API payload, skipping invalid entries', () => {
    const payload = [
      {
        tag_name: 'v72.13',
        name: 'v72.13',
        published_at: '2026-07-21T06:25:03Z',
        html_url: 'https://github.com/bol-van/zapret/releases/tag/v72.13',
        assets: [{ name: 'zapret-v72.13.zip', browser_download_url: 'https://github.com/bol-van/zapret/releases/download/v72.13/zapret-v72.13.zip' }]
      },
      { tag_name: 'not-a-version', name: 'x' },
      'garbage',
      { tag_name: 'v72.12', published_at: '2026-03-12T11:43:00Z', assets: [] }
    ]
    const list = parseEngineReleases(payload)
    expect(list.map((r) => r.tag)).toEqual(['v72.13', 'v72.12'])
    expect(list[0].zipUrl).toContain('zapret-v72.13.zip')
    // Missing asset entry falls back to the conventional URL.
    expect(list[1].zipUrl).toBe('https://github.com/bol-van/zapret/releases/download/v72.12/zapret-v72.12.zip')
    expect(parseEngineReleases({})).toEqual([])
  })

  it('reads the bundled engine version (bol-van tag)', () => {
    expect(getLocalEngineVersion()).toMatch(/^v\d+/)
    const file = path.join(process.cwd(), 'bundled-assets', 'bin', 'engine-version.txt')
    if (fs.existsSync(file)) {
      expect(getLocalEngineVersion()).toBe(fs.readFileSync(file, 'utf8').trim())
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
