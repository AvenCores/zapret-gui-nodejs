/** Seeding must not resurrect a user-disabled `check_updates.enabled` flag. */
import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { ensureDataDirSeeded } from '../src/main/paths'

// Isolate fs writes: dev mode resolves bundled via getAppPath() and the
// data dir via getPath('appData') (setup.ts maps both to cwd otherwise).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-seed-'))
const appData = path.join(tmp, 'appdata')
const dataUtils = path.join(appData, 'zapret-gui', 'data', 'utils')
const flagName = 'check_updates.enabled'
vi.spyOn(app, 'getAppPath').mockImplementation(() => tmp)
vi.spyOn(app, 'getPath').mockImplementation((name: string) => {
  if (name === 'appData') return appData
  return tmp
})

function arrangeBundled(): void {
  for (const sub of ['bin', 'lists', 'utils', 'strategies']) {
    fs.mkdirSync(path.join(tmp, 'bundled-assets', sub), { recursive: true })
  }
  fs.writeFileSync(path.join(tmp, 'bundled-assets', 'utils', flagName), 'ENABLED\n')
  fs.writeFileSync(path.join(tmp, 'bundled-assets', 'utils', 'targets.txt'), 'targets\n')
}

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('ensureDataDirSeeded check_updates.enabled', () => {
  it('seeds the flag on fresh install (default ON)', () => {
    arrangeBundled()
    expect(fs.existsSync(path.join(appData, 'zapret-gui', 'data'))).toBe(false)

    ensureDataDirSeeded()

    expect(fs.readFileSync(path.join(dataUtils, flagName), 'utf8')).toBe('ENABLED\n')
  })

  it('does not restore the flag after the user turned it off', () => {
    // Toggle off = delete the flag; another bundled file goes missing too
    // as a control (it must still be restored).
    fs.rmSync(path.join(dataUtils, flagName), { force: true })
    fs.rmSync(path.join(dataUtils, 'targets.txt'), { force: true })

    ensureDataDirSeeded() // simulates the next app restart

    expect(fs.existsSync(path.join(dataUtils, flagName))).toBe(false)
    expect(fs.readFileSync(path.join(dataUtils, 'targets.txt'), 'utf8')).toBe('targets\n')
  })

  it('keeps the flag untouched when enabled', () => {
    fs.writeFileSync(path.join(dataUtils, flagName), 'ENABLED\n')

    ensureDataDirSeeded()

    expect(fs.readFileSync(path.join(dataUtils, flagName), 'utf8')).toBe('ENABLED\n')
  })
})
