/** Unit tests for service-manager pure helpers + updater version compare. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseScState, mapServiceStatus, queryServiceState, getIPSetMode, setIPSetMode, getGameFilterMode, setGameFilterMode } from '../src/main/service-manager'
import { compareVersions } from '../src/main/strategy-updater'

describe('parseScState', () => {
  it('parses RUNNING', () => {
    expect(parseScState('STATE              : 4  RUNNING')).toBe('RUNNING')
  })
  it('parses STOPPED', () => {
    expect(parseScState('STATE              : 1  STOPPED')).toBe('STOPPED')
  })
  it('maps missing service to NOT_INSTALLED', () => {
    expect(parseScState('[SC] OpenService FAILED 1060: The specified service does not exist.')).toBe('NOT_INSTALLED')
  })
})

describe('mapServiceStatus (Get-Service output, locale-independent)', () => {
  it('maps enum names regardless of case/whitespace', () => {
    expect(mapServiceStatus('Running')).toBe('RUNNING')
    expect(mapServiceStatus('  Stopped\r\n')).toBe('STOPPED')
    expect(mapServiceStatus('StartPending')).toBe('START_PENDING')
    expect(mapServiceStatus('StopPending')).toBe('STOP_PENDING')
  })
  it('maps empty/unknown to UNKNOWN', () => {
    expect(mapServiceStatus('')).toBe('UNKNOWN')
    expect(mapServiceStatus('Paused')).toBe('UNKNOWN')
  })
})

// Touches the real service database (read-only); Windows-only.
describe.runIf(process.platform === 'win32')('queryServiceState', () => {
  it('reports a missing service as NOT_INSTALLED', async () => {
    await expect(queryServiceState('zapret-gui-definitely-missing-12345')).resolves.toBe('NOT_INSTALLED')
  }, 30000)
})

describe('compareVersions', () => {
  it('compares semver', () => {
    expect(compareVersions('1.10.2', '1.10.2')).toBe(0)
    expect(compareVersions('1.10.3', '1.10.2')).toBe(1)
    expect(compareVersions('1.9.9', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0', '1.99.99')).toBe(1)
  })
})

describe('getIPSetMode / setIPSetMode', () => {
  it('round-trips none -> any -> loaded via backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-ipset-'))
    const list = path.join(dir, 'ipset-all.txt')
    const backup = path.join(dir, 'ipset-all.txt.backup')
    fs.writeFileSync(list, '1.1.1.0/24\n2.2.2.0/24\n', 'utf8')
    expect(getIPSetMode(dir)).toBe('loaded')

    setIPSetMode(dir, 'none')
    expect(getIPSetMode(dir)).toBe('none')
    expect(fs.existsSync(backup)).toBe(true)

    setIPSetMode(dir, 'any')
    expect(getIPSetMode(dir)).toBe('any')

    setIPSetMode(dir, 'loaded')
    expect(getIPSetMode(dir)).toBe('loaded')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('throws on loaded without backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-ipset-'))
    fs.writeFileSync(path.join(dir, 'ipset-all.txt'), '', 'utf8')
    expect(() => setIPSetMode(dir, 'loaded')).toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('getGameFilterMode / setGameFilterMode', () => {
  it('round-trips modes through the flag file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-game-'))
    expect(getGameFilterMode(dir)).toBe('disabled')
    setGameFilterMode(dir, 'all')
    expect(getGameFilterMode(dir)).toBe('all')
    setGameFilterMode(dir, 'tcp')
    expect(getGameFilterMode(dir)).toBe('tcp')
    setGameFilterMode(dir, 'udp')
    expect(getGameFilterMode(dir)).toBe('udp')
    setGameFilterMode(dir, 'disabled')
    expect(getGameFilterMode(dir)).toBe('disabled')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
