/** Win7 driver handling: detection + overlay of dual-signed WinDivert files. */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyWin7Drivers, isWin7Release, WIN7_DIVERT_FILES } from '../src/main/paths'

describe('isWin7Release', () => {
  it('detects Windows 7 kernel releases', () => {
    expect(isWin7Release('6.1.7601', 'win32')).toBe(true)
    expect(isWin7Release('6.1.7600', 'win32')).toBe(true)
  })

  it('rejects other Windows releases and platforms', () => {
    expect(isWin7Release('10.0.22631', 'win32')).toBe(false)
    expect(isWin7Release('6.3.9600', 'win32')).toBe(false) // Win 8.1
    expect(isWin7Release('6.1.7601', 'linux')).toBe(false)
    expect(isWin7Release('', 'win32')).toBe(false)
  })
})

describe('applyWin7Drivers', () => {
  it('copies both driver files and reports them', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-win7-'))
    try {
      const bundled = path.join(tmp, 'bundled')
      const binWin7 = path.join(bundled, 'bin-win7')
      fs.mkdirSync(binWin7, { recursive: true })
      for (const name of WIN7_DIVERT_FILES) {
        fs.writeFileSync(path.join(binWin7, name), `win7-${name}`)
      }
      const dataBin = path.join(tmp, 'data', 'bin')
      fs.mkdirSync(dataBin, { recursive: true })
      fs.writeFileSync(path.join(dataBin, 'WinDivert64.sys'), 'win10-driver')

      const replaced = applyWin7Drivers(bundled, dataBin)
      expect([...replaced].sort()).toEqual([...WIN7_DIVERT_FILES].sort())
      for (const name of WIN7_DIVERT_FILES) {
        expect(fs.readFileSync(path.join(dataBin, name), 'utf8')).toBe(`win7-${name}`)
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('is a no-op when bin-win7 is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-win7-'))
    try {
      const dataBin = path.join(tmp, 'data', 'bin')
      expect(applyWin7Drivers(path.join(tmp, 'bundled'), dataBin)).toEqual([])
      expect(fs.existsSync(dataBin)).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
