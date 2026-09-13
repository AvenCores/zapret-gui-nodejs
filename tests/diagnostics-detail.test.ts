/** Unit tests for localized diagnostic details. */
import { describe, it, expect, afterEach } from 'vitest'
import { formatDetail } from '../src/shared/i18n'
import { checkCyrillic, checkOneDrive } from '../src/main/diagnostics'

describe('formatDetail', () => {
  it('substitutes params into the localized template', () => {
    expect(
      formatDetail('ru', {
        detail: 'fallback',
        detailKey: 'diag.detail.proxyOn',
        detailParams: { server: 'proxy.example:8080' }
      })
    ).toBe('Включён (proxy.example:8080) — проверьте, что он корректен, или отключите')
  })

  it('falls back to detail when the key is missing', () => {
    expect(formatDetail('en', { detail: 'raw english', detailKey: 'diag.detail.nope' as never })).toBe('raw english')
  })

  it('keeps unknown placeholders intact', () => {
    expect(
      formatDetail('en', { detail: 'x', detailKey: 'diag.detail.proxyOn', detailParams: {} })
    ).toBe('Enabled ({server}) — make sure it is valid or disable it')
  })
})

describe('detail wiring', () => {
  it('checkCyrillic carries key + path param', () => {
    const c = checkCyrillic({ installDir: 'C:\\запрет-test', appData: '' })
    expect(c.level).toBe('warn')
    expect(c.detailKey).toBe('diag.detail.cyrillicWarn')
    expect(formatDetail('ru', c)).toContain('C:\\запрет-test')
  })

  it('checkCyrillic ok path', () => {
    const c = checkCyrillic({ installDir: 'C:\\zapret', appData: '' })
    expect(c.level).toBe('ok')
    expect(formatDetail('ru', c)).toBe('Путь в порядке')
  })

  const OLD = process.env.OneDrive
  afterEach(() => {
    if (OLD === undefined) delete process.env.OneDrive
    else process.env.OneDrive = OLD
  })

  it('checkOneDrive detects installs inside OneDrive', () => {
    process.env.OneDrive = 'C:\\Users\\x\\OneDrive'
    const c = checkOneDrive({ installDir: 'C:\\Users\\x\\OneDrive\\zapret', appData: '' })
    expect(c.level).toBe('fail')
    expect(formatDetail('en', c)).toContain('OneDrive')
  })

  it('checkOneDrive ok path', () => {
    delete process.env.OneDrive
    const c = checkOneDrive({ installDir: 'C:\\zapret', appData: '' })
    expect(c.level).toBe('ok')
    expect(c.detailKey).toBe('diag.detail.ok')
  })
})
