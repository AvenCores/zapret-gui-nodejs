/** Unit tests for imported-strategy deletion. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deleteImportedStrategy } from '../src/main/service-manager'
import { parseBatContent } from '../src/main/strategy-parser'

function seed(dir: string, id: string, origin: 'bundled' | 'imported'): void {
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({ id, name: id, fileName: `${id}.bat`, origin, args: [], rawArgs: '', desyncMethods: [] }),
    'utf8'
  )
  fs.writeFileSync(path.join(dir, `${id}.bat`), '@echo off\n', 'utf8')
}

describe('deleteImportedStrategy', () => {
  it('deletes imported json + sidecar bat', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-del-'))
    seed(dir, 'my-mod', 'imported')
    expect(deleteImportedStrategy(dir, 'my-mod')).toBe('my-mod')
    expect(fs.existsSync(path.join(dir, 'my-mod.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'my-mod.bat'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses bundled strategies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-del-'))
    seed(dir, 'general', 'bundled')
    expect(() => deleteImportedStrategy(dir, 'general')).toThrow(/bundled/)
    expect(fs.existsSync(path.join(dir, 'general.json'))).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('treats legacy configs without origin as bundled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-del-'))
    fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify({ id: 'legacy', name: 'legacy' }), 'utf8')
    expect(() => deleteImportedStrategy(dir, 'legacy')).toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('throws on unknown id and path traversal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-del-'))
    expect(() => deleteImportedStrategy(dir, 'nope')).toThrow(/not found/)
    expect(() => deleteImportedStrategy(dir, '../evil')).toThrow(/Invalid/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('parseBatContent origin', () => {
  it('defaults to bundled (import flow overrides)', () => {
    const { strategy } = parseBatContent('@echo off\n"%BIN%winws.exe" --new\n', 'x.bat')
    expect(strategy.origin).toBe('bundled')
  })
})
