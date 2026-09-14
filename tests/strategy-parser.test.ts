/** Unit tests for the .bat strategy parser. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  tokenizeCommandLine,
  substitutePlaceholders,
  extractWinwsArgs,
  detectDesyncMethods,
  materializeArgs,
  materializeArgsForSpawn,
  parseBatContent,
  quoteArg
} from '../src/main/strategy-parser'

const SAMPLE_BAT = [
  '@echo off',
  'set "BIN=%~dp0bin\\"',
  'set "LISTS=%~dp0lists\\"',
  'start "zapret: %~n0" /min "%BIN%winws.exe" --wf-tcp=80,443,%GameFilterTCP% --wf-udp=443,%GameFilterUDP% ^',
  '--filter-udp=443 --hostlist="%LISTS%list-general.txt" --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic="%BIN%quic_initial_www_google_com.bin" --new ^',
  '--filter-tcp=80,443 --dpi-desync=multisplit --dpi-desync-split-seqovl=568 --new ^',
  '--filter-udp=%GameFilterUDP% --dpi-desync=fake --dpi-desync-fake-unknown-udp="%BIN%ACTIVE_GAME_UDP.bin"'
].join('\r\n')

describe('tokenizeCommandLine', () => {
  it('keeps quoted segments together', () => {
    const toks = tokenizeCommandLine('--hostlist="C:\\my dir\\list.txt" --new --repeats=6')
    expect(toks).toEqual(['--hostlist="C:\\my dir\\list.txt"', '--new', '--repeats=6'])
  })
})

describe('substitutePlaceholders', () => {
  it('replaces bat variables with placeholders', () => {
    expect(substitutePlaceholders('"%BIN%winws.exe"')).toBe('"<BIN>/winws.exe"')
    expect(substitutePlaceholders('"%LISTS%list-general.txt"')).toBe('"<LISTS>/list-general.txt"')
    expect(substitutePlaceholders('%GameFilterTCP%')).toBe('<GAME_TCP>')
    expect(substitutePlaceholders('%GameFilterUDP%')).toBe('<GAME_UDP>')
  })
})

describe('extractWinwsArgs', () => {
  it('parses the sample bat', () => {
    const { args, warnings } = extractWinwsArgs(SAMPLE_BAT)
    expect(warnings).toEqual([])
    expect(args[0]).toBe('--wf-tcp=80,443,<GAME_TCP>')
    expect(args).toContain('--new')
    expect(args).toContain('--hostlist="<LISTS>/list-general.txt"')
    expect(args).toContain('--dpi-desync-fake-quic="<BIN>/quic_initial_www_google_com.bin"')
    expect(args.some((a) => a.includes('winws.exe'))).toBe(false)
  })

  it('warns when winws.exe is missing', () => {
    const { args, warnings } = extractWinwsArgs('@echo off\necho hello\n')
    expect(args).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('detectDesyncMethods', () => {
  it('finds methods', () => {
    expect(detectDesyncMethods(['--dpi-desync=fake,fakedsplit', '--new'])).toEqual(['fake', 'fakedsplit'])
  })
})

describe('materializeArgs', () => {
  it('substitutes real paths', () => {
    const out = materializeArgs(['"<BIN>/a.bin"', '"<LISTS>/l.txt"', '<GAME_TCP>', '<GAME_UDP>'], {
      binDir: 'C:\\d\\bin',
      listsDir: 'C:\\d\\lists',
      gameTcp: '1024-65535',
      gameUdp: '12'
    })
    expect(out).toEqual(['"C:\\d\\bin/a.bin"', '"C:\\d\\lists/l.txt"', '1024-65535', '12'])
  })
})

describe('materializeArgsForSpawn', () => {
  it('strips .bat-era quotes so spawn argv has bare paths', () => {
    const out = materializeArgsForSpawn(['--ipset-exclude="<LISTS>/ipset-exclude.txt"', '--dpi-desync-fake-quic="<BIN>/quic.bin"', '--new'], {
      binDir: 'C:\\d\\bin',
      listsDir: 'C:\\d\\lists',
      gameTcp: '12',
      gameUdp: '12'
    })
    expect(out).toEqual(['--ipset-exclude=C:\\d\\lists/ipset-exclude.txt', '--dpi-desync-fake-quic=C:\\d\\bin/quic.bin', '--new'])
    expect(out.some((a) => a.includes('"'))).toBe(false)
  })
})

describe('quoteArg', () => {
  it('quotes only when needed', () => {
    expect(quoteArg('--new')).toBe('--new')
    expect(quoteArg('"already quoted"')).toBe('"already quoted"')
    expect(quoteArg('C:\\my dir\\f.bin')).toBe('"C:\\my dir\\f.bin"')
  })
})

describe('parseBatContent (real general.bat)', () => {
  it('parses the bundled general strategy', () => {
    const batDir = path.join(process.cwd(), 'bundled-assets', 'bat')
    const file = path.join(batDir, 'general.bat')
    if (!fs.existsSync(file)) return // assets not present (CI without LFS etc.)
    const { strategy, warnings } = parseBatContent(fs.readFileSync(file, 'utf8'), 'general.bat')
    expect(strategy.id).toBe('general')
    expect(strategy.args.length).toBeGreaterThan(20)
    expect(strategy.desyncMethods).toContain('multisplit')
    expect(strategy.rawArgs).toContain('<GAME_TCP>')
    expect(warnings).toEqual([])
  })
})
