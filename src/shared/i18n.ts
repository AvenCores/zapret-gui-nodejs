/**
 * Built-in localization (28 languages) shared by main and renderer.
 * Dictionaries live in `./locales/*` (one file per language).
 * The renderer keeps the active locale in the zustand store; the main
 * process always returns raw data + label keys so the UI can translate.
 * @module shared/i18n
 */
import { ru } from './locales/ru'
import { en } from './locales/en'
import { uk } from './locales/uk'
import { be } from './locales/be'
import { kk } from './locales/kk'
import { de } from './locales/de'
import { fr } from './locales/fr'
import { es } from './locales/es'
import { it } from './locales/it'
import { pt } from './locales/pt'
import { nl } from './locales/nl'
import { pl } from './locales/pl'
import { cs } from './locales/cs'
import { sk } from './locales/sk'
import { hu } from './locales/hu'
import { ro } from './locales/ro'
import { bg } from './locales/bg'
import { sr } from './locales/sr'
import { hr } from './locales/hr'
import { el } from './locales/el'
import { tr } from './locales/tr'
import { ar } from './locales/ar'
import { fa } from './locales/fa'
import { zh } from './locales/zh'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { hi } from './locales/hi'
import { id } from './locales/id'

export const SUPPORTED_LOCALES = [
  { code: 'ru', nativeName: 'Русский' },
  { code: 'en', nativeName: 'English' },
  { code: 'uk', nativeName: 'Українська' },
  { code: 'be', nativeName: 'Беларуская' },
  { code: 'kk', nativeName: 'Қазақша' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'es', nativeName: 'Español' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'nl', nativeName: 'Nederlands' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'cs', nativeName: 'Čeština' },
  { code: 'sk', nativeName: 'Slovenčina' },
  { code: 'hu', nativeName: 'Magyar' },
  { code: 'ro', nativeName: 'Română' },
  { code: 'bg', nativeName: 'Български' },
  { code: 'sr', nativeName: 'Srpski' },
  { code: 'hr', nativeName: 'Hrvatski' },
  { code: 'el', nativeName: 'Ελληνικά' },
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'ar', nativeName: 'العربية' },
  { code: 'fa', nativeName: 'فارسی' },
  { code: 'zh', nativeName: '中文' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'hi', nativeName: 'हिन्दी' },
  { code: 'id', nativeName: 'Indonesia' }
] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]['code']

/** Alias map for OS tags whose primary subtag is not directly supported. */
const LOCALE_ALIASES: Record<string, Locale> = {
  bs: 'sr',
  mk: 'bg',
  sl: 'hr',
  ca: 'es',
  gl: 'es',
  eu: 'es',
  gsw: 'de',
  lb: 'de',
  frp: 'fr',
  pt_br: 'pt',
  zh_tw: 'zh',
  zh_hk: 'zh',
  ckb: 'ar',
  ur: 'hi',
  ms: 'id'
}

function supportedSet(): Set<string> {
  return new Set(SUPPORTED_LOCALES.map((l) => l.code))
}

/** Type guard for persisted / external locale values. */
export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && supportedSet().has(value)
}

/** Normalize any external value to a supported locale (fallback `en`). */
export function normalizeLocale(value: unknown): Locale {
  return isSupportedLocale(value) ? value : 'en'
}

/**
 * Map an OS locale tag (e.g. `ru-RU`, `en_US`, `pt-BR`) to a supported app locale.
 * Pure — covered by unit tests.
 */
export function resolveSystemLocale(tag: string): Locale {
  const norm = String(tag ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  if (norm === '') return 'en'
  const primary = norm.split('-')[0].split(':')[0]
  if (primary === '') return 'en'
  if (isSupportedLocale(primary)) return primary
  const alias = LOCALE_ALIASES[primary] ?? LOCALE_ALIASES[norm.replace(/-/g, '_')]
  if (alias != null) return alias
  // e.g. `zh-Hant-HK` → try second subtag as well before falling back.
  const parts = norm.split('-')
  for (const p of parts.slice(1)) {
    if (isSupportedLocale(p)) return p
  }
  return 'en'
}

export type I18nKey = keyof typeof ru

// Every supported locale must export a full `Record<I18nKey, string>`
// from its `./locales/*` file. `translate()` additionally falls back
// to English at runtime, so a missing key never crashes the UI.
export const dictionaries: Record<Locale, Record<I18nKey, string>> = {
  ru,
  en,
  uk,
  be,
  kk,
  de,
  fr,
  es,
  it,
  pt,
  nl,
  pl,
  cs,
  sk,
  hu,
  ro,
  bg,
  sr,
  hr,
  el,
  tr,
  ar,
  fa,
  zh,
  ja,
  ko,
  hi,
  id
}

/** Tiny `t()` helper usable outside React (with en → ru → key fallback). */
export function translate(locale: Locale, key: I18nKey): string {
  const dict = dictionaries[locale] as Record<string, string> | undefined
  return dict?.[key] ?? dictionaries.en[key] ?? dictionaries.ru[key] ?? key
}

/** Render a diagnostic `detailKey` template with `{param}` substitution. */
export function formatDetail(
  locale: Locale,
  check: { detailKey?: string; detailParams?: Record<string, string>; detail: string }
): string {
  const dict = (dictionaries[locale] ?? dictionaries.en) as Record<string, string>
  const enDict = dictionaries.en as Record<string, string>
  const template =
    (check.detailKey != null && (dict[check.detailKey] ?? enDict[check.detailKey])) || check.detail
  return template.replace(/\{(\w+)\}/g, (m, name: string) => check.detailParams?.[name] ?? m)
}
