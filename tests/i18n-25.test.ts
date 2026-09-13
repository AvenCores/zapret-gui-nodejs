/** Coverage for 25+ language support: completeness, fallback, mapping. */
import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_LOCALES,
  dictionaries,
  translate,
  formatDetail,
  isSupportedLocale,
  normalizeLocale,
  resolveSystemLocale,
  type Locale
} from '../src/shared/i18n'
import { getTrayLabels } from '../src/main/tray'

const PLACEHOLDER_RE = /\{(\w+)\}/g

function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort()
}

describe('25+ language support', () => {
  it('ships at least 25 locales', () => {
    expect(SUPPORTED_LOCALES.length).toBeGreaterThanOrEqual(25)
    // codes unique
    const codes = SUPPORTED_LOCALES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    // ru + en still present (backward compat)
    expect(codes).toContain('ru')
    expect(codes).toContain('en')
  })

  it('every locale has a full dictionary with identical keys', () => {
    const enKeys = Object.keys(dictionaries.en).sort()
    expect(enKeys.length).toBeGreaterThan(100)
    for (const { code } of SUPPORTED_LOCALES) {
      const dict = dictionaries[code as Locale]
      expect(dict, `missing dictionary for ${code}`).toBeDefined()
      expect(Object.keys(dict).sort()).toEqual(enKeys)
    }
  })

  it('no empty translations', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      const dict = dictionaries[code as Locale] as Record<string, string>
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim().length, `${code}:${k}`).toBeGreaterThan(0)
      }
    }
  })

  it('placeholders match English reference in every locale', () => {
    const en = dictionaries.en as Record<string, string>
    for (const { code } of SUPPORTED_LOCALES) {
      if (code === 'en') continue
      const dict = dictionaries[code as Locale] as Record<string, string>
      for (const key of Object.keys(en)) {
        expect(placeholders(dict[key]), `${code}:${key}`).toEqual(placeholders(en[key]))
      }
    }
  })

  it('translate() falls back to en for unknown keys/locales', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      expect(translate(code, 'nav.dashboard').length).toBeGreaterThan(0)
    }
    // unknown key returns the key itself (typed as never to bypass I18nKey)
    expect(translate('en', 'nope.missing' as never)).toBe('nope.missing')
  })

  it('formatDetail() substitutes params in every locale', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      const out = formatDetail(code, {
        detail: 'fallback',
        detailKey: 'diag.detail.proxyOn',
        detailParams: { server: 'proxy.example:8080' }
      })
      expect(out).toContain('proxy.example:8080')
      expect(out).not.toContain('{server}')
    }
  })

  it('normalizeLocale() accepts supported codes and rejects junk', () => {
    expect(normalizeLocale('ru')).toBe('ru')
    expect(normalizeLocale('ja')).toBe('ja')
    expect(normalizeLocale('xx')).toBe('en')
    expect(normalizeLocale(undefined)).toBe('en')
    expect(normalizeLocale(null)).toBe('en')
    expect(isSupportedLocale('de')).toBe(true)
    expect(isSupportedLocale('xx')).toBe(false)
  })

  it('resolveSystemLocale() covers all supported primary tags', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      expect(resolveSystemLocale(code)).toBe(code)
      expect(resolveSystemLocale(`${code}-${code.toUpperCase()}`)).toBe(code)
    }
  })

  it('tray labels resolve for every locale without fallback crash', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      const l = getTrayLabels(code, 'running')
      expect(l.status.length).toBeGreaterThan(0)
      expect(l.start.length).toBeGreaterThan(0)
      expect(l.stop.length).toBeGreaterThan(0)
      expect(l.open).toContain('Zapret GUI')
      expect(l.quit.length).toBeGreaterThan(0)
    }
  })
})
