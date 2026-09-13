/** Unit tests for strategy-updater version helpers (offline-safe). */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getBundledZapretVersion } from '../src/main/strategy-updater'

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
