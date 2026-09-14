/** Unit tests for the native config tester (replaces test zapret.ps1). */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseTargetsContent,
  convertRawTarget,
  hostOf,
  classifyHttpError,
  summarizeStandard,
  summarizeDpi,
  pickBestConfig,
  loadTargets,
  writeResultsFile,
  planWindivertRestore
} from '../src/main/config-tester'

describe('convertRawTarget', () => {
  it('splits PING targets as ping-only', () => {
    expect(convertRawTarget('DNS', 'PING:1.1.1.1')).toEqual({ name: 'DNS', url: null, pingHost: '1.1.1.1' })
  })
  it('keeps https urls with derived ping host', () => {
    expect(convertRawTarget('YouTube', 'https://www.youtube.com/watch?v=1')).toEqual({
      name: 'YouTube',
      url: 'https://www.youtube.com/watch?v=1',
      pingHost: 'www.youtube.com'
    })
  })
})

describe('hostOf', () => {
  it('extracts hostname', () => {
    expect(hostOf('https://cdn.discordapp.com/attachments/1')).toBe('cdn.discordapp.com')
    expect(hostOf('https://youtu.be/abc')).toBe('youtu.be')
  })
})

describe('parseTargetsContent', () => {
  it('parses targets.txt format, skips comments and garbage', () => {
    const content = [
      '# comment',
      'DiscordMain = "https://discord.com"',
      '  ',
      'DNS = "PING:8.8.8.8"',
      'broken line without quotes'
    ].join('\n')
    const parsed = parseTargetsContent(content)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ name: 'DiscordMain', pingHost: 'discord.com' })
    expect(parsed[1]).toEqual({ name: 'DNS', url: null, pingHost: '8.8.8.8' })
  })
})

describe('loadTargets', () => {
  it('falls back to built-in defaults when file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-targets-'))
    const targets = loadTargets(dir)
    expect(targets.length).toBeGreaterThan(10)
    expect(targets.some((t) => t.url === 'https://discord.com')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('reads custom targets.txt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-targets-'))
    fs.writeFileSync(path.join(dir, 'targets.txt'), 'MySite = "https://example.com"\n', 'utf8')
    expect(loadTargets(dir)).toEqual([{ name: 'MySite', url: 'https://example.com', pingHost: 'example.com' }])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('classifyHttpError', () => {
  it('maps cert/dns failures to SSL', () => {
    expect(classifyHttpError('unable to verify the first certificate')).toBe('SSL')
    expect(classifyHttpError('getaddrinfo ENOTFOUND example.com')).toBe('SSL')
  })
  it('maps protocol mismatch to UNSUP', () => {
    expect(classifyHttpError('error:0A0000B9:SSL routines::unsupported protocol')).toBe('UNSUP')
  })
  it('maps the rest to ERROR', () => {
    expect(classifyHttpError('socket hang up')).toBe('ERROR')
  })
})

describe('summarizeStandard / summarizeDpi / pickBestConfig', () => {
  it('counts OK/ERR/UNSUP and ping', () => {
    const sum = summarizeStandard([
      { name: 'a', probes: [{ variant: 'HTTP', kind: 'OK', httpStatus: 200 }, { variant: 'TLS1.2', kind: 'UNSUP', httpStatus: null }], ping: '12 ms', pingOk: true },
      { name: 'b', probes: [{ variant: 'HTTP', kind: 'ERROR', httpStatus: null }], ping: 'Timeout', pingOk: false }
    ])
    expect(sum).toEqual({ ok: 1, err: 1, unsup: 1, pingOk: 1, pingFail: 1 })
  })
  it('counts dpi statuses', () => {
    const sum = summarizeDpi([
      { id: 't', provider: 'p', country: 'c', host: 'h', warned: true, lines: [{ label: 'HTTP', code: '200', upBytes: 1, upKB: 0, downBytes: 1, downKB: 0, time: 1, status: 'OK' }, { label: 'TLS1.2', code: 'ERR', upBytes: 1, upKB: 0, downBytes: 0, downKB: 0, time: 5, status: 'LIKELY_BLOCKED' }] }
    ])
    expect(sum).toEqual({ ok: 1, fail: 0, unsup: 0, blocked: 1 })
  })
  it('picks max OK with ping tie-break', () => {
    const rows = [
      { configId: 'a', configName: 'a.bat', ok: 5, err: 1, unsup: 0, pingOk: 1, pingFail: 1, blocked: 0 },
      { configId: 'b', configName: 'b.bat', ok: 5, err: 1, unsup: 0, pingOk: 3, pingFail: 0, blocked: 0 },
      { configId: 'c', configName: 'c.bat', ok: 2, err: 5, unsup: 0, pingOk: 9, pingFail: 0, blocked: 0 }
    ]
    expect(pickBestConfig(rows)).toBe('b.bat')
    expect(pickBestConfig([])).toBeNull()
  })
})

describe('planWindivertRestore', () => {
  it('removes a driver service that tests pulled in', () => {
    expect(planWindivertRestore('NOT_INSTALLED', 'RUNNING')).toBe('stop-delete')
    expect(planWindivertRestore('NOT_INSTALLED', 'STOPPED')).toBe('stop-delete')
  })
  it('stops back a service that was stopped before', () => {
    expect(planWindivertRestore('STOPPED', 'RUNNING')).toBe('stop')
  })
  it('leaves a previously running driver alone', () => {
    expect(planWindivertRestore('RUNNING', 'RUNNING')).toBeNull()
    expect(planWindivertRestore('RUNNING', 'STOPPED')).toBeNull()
  })
  it('does nothing when nothing changed or state unknown', () => {
    expect(planWindivertRestore('NOT_INSTALLED', 'NOT_INSTALLED')).toBeNull()
    expect(planWindivertRestore('UNKNOWN', 'RUNNING')).toBeNull()
    expect(planWindivertRestore('STOPPED', 'STOPPED')).toBeNull()
  })
})

describe('writeResultsFile', () => {
  it('writes analytics + best, mirroring the PS1 layout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-results-'))
    const file = writeResultsFile(
      dir,
      'standard',
      [{ configId: 'a', configName: 'a.bat', targets: [{ name: 'Site', probes: [{ variant: 'HTTP', kind: 'OK', httpStatus: 200 }], ping: '5 ms', pingOk: true }] }],
      [],
      [{ configId: 'a', configName: 'a.bat', ok: 1, err: 0, unsup: 0, pingOk: 1, pingFail: 0, blocked: 0 }],
      'a.bat'
    )
    expect(file).not.toBeNull()
    const text = fs.readFileSync(file as string, 'utf8')
    expect(text).toContain('Config: a.bat')
    expect(text).toContain('Best strategy: a.bat')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
