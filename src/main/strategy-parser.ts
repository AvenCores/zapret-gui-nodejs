/**
 * Parser for zapret `.bat` strategy files.
 *
 * Mirrors the parsing logic of `service.bat :service_install`:
 * - finds the line containing `winws.exe`,
 * - joins `^` continuations,
 * - tokenizes respecting double quotes,
 * - rewrites `%BIN%`/`%~dp0bin\` → `<BIN>`, `%LISTS%` → `<LISTS>`,
 *   `%GameFilterTCP%` → `<GAME_TCP>`, `%GameFilterUDP%` → `<GAME_UDP>`
 *   placeholders (the GUI substitutes real paths / filter values at apply time).
 * @module main/strategy-parser
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ParsedStrategy, Strategy } from '../shared/types'

/** Known `--dpi-desync=` method names (for descriptions / UI badges). */
const KNOWN_METHODS = [
  'fake',
  'fakedsplit',
  'multisplit',
  'multidisorder',
  'multisplit_ovl',
  'hostfakesplit',
  'syndata',
  'split',
  'split2',
  'disorder',
  'disorder2',
  'fake_unknown',
  'udplen',
  'ipfrag',
  'tcpfrag'
]

/**
 * Split a command line into tokens, honouring double quotes.
 * Quotes are kept on tokens that need them (paths with spaces/colon).
 */
export function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      cur += ch
      continue
    }
    if (!inQuotes && (ch === ' ' || ch === '\t')) {
      if (cur.length > 0) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur.length > 0) tokens.push(cur)
  return tokens
}

/** Replace bat variables with portable placeholders. */
export function substitutePlaceholders(token: string): string {
  let t = token
  // Strip stray batch caret escapes used for `!` in FAKE TLS AUTO (`^!`).
  t = t.replace(/\^!/g, '!')
  // %BIN%winws.exe prefix itself is dropped by the caller; handle remaining refs.
  t = t
    .replace(/%BIN%/gi, '<BIN>/')
    .replace(/%~dp0bin\\/gi, '<BIN>/')
    .replace(/%LISTS%/gi, '<LISTS>/')
    .replace(/%~dp0lists\\/gi, '<LISTS>/')
    .replace(/%~dp0/gi, '<ROOT>/')
    .replace(/%GameFilterTCP%/gi, '<GAME_TCP>')
    .replace(/%GameFilterUDP%/gi, '<GAME_UDP>')
    .replace(/%GameFilter%/gi, '<GAME>')
  // "%BIN%foo.bin" style quoted absolute paths referencing the install dir.
  t = t.replace(/"<ROOT>\//g, '"<ROOT>/')
  return t
}

/**
 * Extract winws.exe arguments from raw `.bat` content.
 * Returns tokens (with placeholders) and warnings.
 */
export function extractWinwsArgs(content: string): { args: string[]; warnings: string[] } {
  const warnings: string[] = []
  const lines = content.split(/\r?\n/)

  // 1. join caret continuations
  const joined: string[] = []
  let acc = ''
  for (const raw of lines) {
    const trimmedEnd = raw.replace(/\s+$/, '')
    if (trimmedEnd.endsWith('^')) {
      acc += trimmedEnd.slice(0, -1) + ' '
    } else {
      acc += raw
      joined.push(acc)
      acc = ''
    }
  }
  if (acc.trim()) joined.push(acc)

  // 2. find first line mentioning winws.exe
  const idx = joined.findIndex((l) => l.toLowerCase().includes('winws.exe'))
  if (idx === -1) {
    return { args: [], warnings: ['winws.exe invocation not found in .bat file'] }
  }

  // 3. take everything after `winws.exe"` (or winws.exe) on that line + following joined lines
  const first = joined[idx]
  const m = first.match(/winws\.exe"?\s*/i)
  let tail = m ? first.slice(first.indexOf(m[0]) + m[0].length) : ''
  for (let i = idx + 1; i < joined.length; i++) {
    const l = joined[i].trim()
    if (!l || l.startsWith('::') || l.toLowerCase().startsWith('@echo') || l.toLowerCase().startsWith('rem ')) continue
    // stop at batch control flow
    if (/^(if |for |call |goto |exit|pause|set |cd |start |chcp)/i.test(l) && !l.includes('--')) break
    tail += ' ' + l
  }

  const rawTokens = tokenizeCommandLine(tail)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== '^' && t !== '^^')

  if (rawTokens.length === 0) warnings.push('No arguments found after winws.exe')

  const args = rawTokens.map(substitutePlaceholders)
  return { args, warnings }
}

/** Detect `--dpi-desync=` methods referenced by the strategy. */
export function detectDesyncMethods(args: string[]): string[] {
  const found = new Set<string>()
  for (const a of args) {
    const mm = a.match(/--dpi-desync=([^ "']+)/)
    if (mm) {
      for (const part of mm[1].split(',')) {
        const name = part.trim().toLowerCase()
        if (KNOWN_METHODS.includes(name)) found.add(name)
        else if (name) found.add(name)
      }
    }
  }
  return [...found]
}

/** Build a short human description from detected methods (RU). */
export function describeStrategy(name: string, methods: string[], args: string[]): string {
  const parts: string[] = []
  const has = (...m: string[]): boolean => m.some((x) => methods.includes(x))
  if (has('multisplit')) parts.push('multisplit (фрагментация TLS)')
  if (has('multidisorder')) parts.push('multidisorder')
  if (has('fakedsplit')) parts.push('fakedsplit')
  if (has('hostfakesplit')) parts.push('hostfakesplit (Google)')
  if (has('syndata')) parts.push('syndata')
  if (/--dpi-desync-fake-quic=/.test(args.join(' '))) parts.push('fake QUIC')
  if (/fake-tls-mod=rnd/.test(args.join(' '))) parts.push('auto fake TLS (SNI www.google.com)')
  else if (/--dpi-desync-fake-tls=/.test(args.join(' '))) parts.push('fake TLS')
  if (/filter-l7=discord/.test(args.join(' '))) parts.push('фильтр Discord voice/STUN')
  if (/--filter-tcp=%?<GAME_TCP>/.test(args.join(' ').replace('<GAME_TCP>', '%<GAME_TCP>'))) parts.push('game-фильтр')
  if (name.toUpperCase().includes('EXP')) parts.push('экспериментальная')
  if (parts.length === 0) return 'Пользовательская стратегия'
  return parts.join(' + ')
}

/** Parse a `.bat` file into a {@link Strategy}. */
export function parseBatFile(filePath: string): ParsedStrategy {
  const content = fs.readFileSync(filePath, 'utf8')
  return parseBatContent(content, path.basename(filePath))
}

/** Parse raw `.bat` content (pure — covered by unit tests). */
export function parseBatContent(content: string, fileName: string): ParsedStrategy {
  const id = fileName.replace(/\.bat$/i, '')
  const { args, warnings } = extractWinwsArgs(content)
  const methods = detectDesyncMethods(args)
  const strategy: Strategy = {
    id,
    name: id,
    fileName,
    description: describeStrategy(id, methods, args),
    args,
    rawArgs: args.join(' '),
    desyncMethods: methods
  }
  return { strategy, warnings }
}

/**
 * Materialize placeholders into real CLI args for the current machine.
 * @param gameTcp e.g. `1024-65535` or `12`
 */
export function materializeArgs(
  args: string[],
  opts: { binDir: string; listsDir: string; gameTcp: string; gameUdp: string }
): string[] {
  return args.map((a) =>
    a
      .split('<BIN>').join(opts.binDir)
      .split('<LISTS>').join(opts.listsDir)
      .split('<GAME_TCP>').join(opts.gameTcp)
      .split('<GAME_UDP>').join(opts.gameUdp)
      .split('<GAME>').join(opts.gameTcp)
      .split('<ROOT>').join(opts.binDir)
  )
}

/** Quote an argument if it contains spaces and is not already quoted. */
export function quoteArg(arg: string): string {
  if (/^".*"$/.test(arg)) return arg
  return /[\s]/.test(arg) ? `"${arg}"` : arg
}
