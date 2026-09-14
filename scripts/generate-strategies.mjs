/**
 * One-time/dev script: materialize `bundled-assets/` from the upstream
 * `zapret-discord-youtube-main/` checkout (if present), then (re)generate
 * `bundled-assets/strategies/*.json` by parsing every `general*.bat`.
 *
 * - `npm run generate:strategies` runs on every `npm run build`.
 * - In CI the `bundled-assets/` dir is already committed, so the script
 *   only re-syncs the JSON configs (idempotent).
 *
 * Plain Node.js, no dependencies.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(root, 'zapret-discord-youtube-main')
const LINUX_EXAMPLE = path.join(root, 'zapret-discord-youtube-linux-master')
const LINUX_CUSTOM = path.join(LINUX_EXAMPLE, 'custom-strategies')
const BUNDLED = path.join(root, 'bundled-assets')

const KNOWN_METHODS = [
  'fake', 'fakedsplit', 'multisplit', 'multidisorder', 'hostfakesplit',
  'syndata', 'split', 'split2', 'disorder', 'disorder2', 'udplen', 'ipfrag', 'tcpfrag'
]

function tokenize(line) {
  const tokens = []
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

function substitute(t) {
  return t
    .replace(/\^!/g, '!')
    .replace(/%BIN%/gi, '<BIN>/')
    .replace(/%~dp0bin\\/gi, '<BIN>/')
    .replace(/%LISTS%/gi, '<LISTS>/')
    .replace(/%~dp0lists\\/gi, '<LISTS>/')
    .replace(/%~dp0/gi, '<ROOT>/')
    .replace(/%GameFilterTCP%/gi, '<GAME_TCP>')
    .replace(/%GameFilterUDP%/gi, '<GAME_UDP>')
    .replace(/%GameFilter%/gi, '<GAME>')
}

function extractArgs(content) {
  const lines = content.split(/\r?\n/)
  const joined = []
  let acc = ''
  for (const raw of lines) {
    const trimmed = raw.replace(/\s+$/, '')
    if (trimmed.endsWith('^')) acc += trimmed.slice(0, -1) + ' '
    else {
      acc += raw
      joined.push(acc)
      acc = ''
    }
  }
  if (acc.trim()) joined.push(acc)
  const idx = joined.findIndex((l) => l.toLowerCase().includes('winws.exe'))
  if (idx === -1) return { args: [], warnings: ['winws.exe not found'] }
  const first = joined[idx]
  const m = first.match(/winws\.exe"?\s*/i)
  let tail = m ? first.slice(first.indexOf(m[0]) + m[0].length) : ''
  for (let i = idx + 1; i < joined.length; i++) {
    const l = joined[i].trim()
    if (!l || l.startsWith('::') || /^@echo/i.test(l) || /^rem /i.test(l)) continue
    if (/^(if |for |call |goto |exit|pause|set |cd |start |chcp)/i.test(l) && !l.includes('--')) break
    tail += ' ' + l
  }
  const args = tokenize(tail)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== '^' && t !== '^^')
    .map(substitute)
  return { args, warnings: args.length === 0 ? ['empty args'] : [] }
}

function detectMethods(args) {
  const found = new Set()
  for (const a of args) {
    const mm = a.match(/--dpi-desync=([^ "']+)/)
    if (mm) for (const part of mm[1].split(',')) {
      const n = part.trim().toLowerCase()
      if (n) found.add(n)
    }
  }
  return [...found]
}

function describe(name, methods, joined) {
  const parts = []
  const has = (...ms) => ms.some((x) => methods.includes(x))
  if (has('multisplit')) parts.push('multisplit (фрагментация TLS)')
  if (has('multidisorder')) parts.push('multidisorder')
  if (has('fakedsplit')) parts.push('fakedsplit')
  if (has('hostfakesplit')) parts.push('hostfakesplit (Google)')
  if (has('syndata')) parts.push('syndata')
  if (/--dpi-desync-fake-quic=/.test(joined)) parts.push('fake QUIC')
  if (/fake-tls-mod=rnd/.test(joined)) parts.push('auto fake TLS (SNI www.google.com)')
  else if (/--dpi-desync-fake-tls=/.test(joined)) parts.push('fake TLS')
  if (/filter-l7=discord/.test(joined)) parts.push('фильтр Discord voice/STUN')
  if (name.toUpperCase().includes('EXP')) parts.push('экспериментальная')
  void KNOWN_METHODS
  return parts.length === 0 ? 'Пользовательская стратегия' : parts.join(' + ')
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(e.name)) continue
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDir(s, d, filter)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

// 1. Seed bundled-assets from upstream checkout when available.
if (fs.existsSync(SRC)) {
  console.log(`Seeding bundled-assets/ from ${SRC} ...`)
  copyDir(path.join(SRC, 'bin'), path.join(BUNDLED, 'bin'))
  copyDir(path.join(SRC, 'lists'), path.join(BUNDLED, 'lists'), (n) => n === 'ipset-all.txt.backup' || !n.endsWith('.backup'))
  copyDir(path.join(SRC, 'utils'), path.join(BUNDLED, 'utils'))
  const svc = path.join(SRC, '.service')
  if (fs.existsSync(svc)) {
    fs.mkdirSync(path.join(BUNDLED, 'service'), { recursive: true })
    for (const f of ['version.txt', 'hosts']) {
      const s = path.join(svc, f)
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(BUNDLED, 'service', f))
    }
  }
  // Keep .bat sources for reference + CI regeneration.
  fs.mkdirSync(path.join(BUNDLED, 'bat'), { recursive: true })
  for (const f of fs.readdirSync(SRC)) {
    if (f.toLowerCase().endsWith('.bat')) fs.copyFileSync(path.join(SRC, f), path.join(BUNDLED, 'bat', f))
  }
  // Linux example custom strategies (tested with nfqws, e.g. general_nix1):
  // copy them into the .bat pool so they ship as GUI strategies too.
  if (fs.existsSync(LINUX_CUSTOM)) {
    for (const f of fs.readdirSync(LINUX_CUSTOM)) {
      if (!f.toLowerCase().endsWith('.bat')) continue
      const dest = path.join(BUNDLED, 'bat', f)
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(LINUX_CUSTOM, f), dest)
        console.log(`  + linux custom strategy: ${f}`)
      }
    }
  }
} else {
  console.log('No upstream checkout found — using committed bundled-assets/.')
}

// 2. (Re)generate strategies/*.json from .bat sources.
// Without an upstream checkout the pool is `bundled-assets/bat/`; the Linux
// example's custom strategies are merged in when present.
if (fs.existsSync(LINUX_CUSTOM)) {
  fs.mkdirSync(path.join(BUNDLED, 'bat'), { recursive: true })
  for (const f of fs.readdirSync(LINUX_CUSTOM)) {
    if (!f.toLowerCase().endsWith('.bat')) continue
    const dest = path.join(BUNDLED, 'bat', f)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(LINUX_CUSTOM, f), dest)
      console.log(`  + linux custom strategy: ${f}`)
    }
  }
}
const batDir = fs.existsSync(SRC) ? SRC : path.join(BUNDLED, 'bat')
const stratDir = path.join(BUNDLED, 'strategies')
fs.mkdirSync(stratDir, { recursive: true })
let bats = fs.existsSync(batDir)
  ? fs.readdirSync(batDir).filter((f) => f.toLowerCase().endsWith('.bat') && !/^service/i.test(f))
  : []
// Merge Linux custom strategies into the pool (read from their own dir).
let linuxBatDir = null
if (fs.existsSync(SRC) && fs.existsSync(LINUX_CUSTOM)) {
  linuxBatDir = LINUX_CUSTOM
  for (const f of fs.readdirSync(LINUX_CUSTOM)) {
    if (f.toLowerCase().endsWith('.bat') && !bats.includes(f)) bats.push(f)
  }
}
function readBatSource(bat) {
  if (linuxBatDir && fs.existsSync(path.join(linuxBatDir, bat)) && !fs.existsSync(path.join(batDir, bat))) {
    return fs.readFileSync(path.join(linuxBatDir, bat), 'utf8')
  }
  return fs.readFileSync(path.join(batDir, bat), 'utf8')
}
if (bats.length === 0) {
  console.log('No .bat sources found — keeping existing strategies/*.json.')
} else {
  let n = 0
  for (const bat of bats) {
    const content = readBatSource(bat)
    const id = bat.replace(/\.bat$/i, '')
    const { args, warnings } = extractArgs(content)
    const methods = detectMethods(args)
    const strategy = {
      id,
      name: id,
      fileName: bat,
      description: describe(id, methods, args.join(' ')),
      args,
      rawArgs: args.join(' '),
      desyncMethods: methods,
      origin: 'bundled'
    }
    fs.writeFileSync(path.join(stratDir, `${id}.json`), JSON.stringify(strategy, null, 2), 'utf8')
    if (warnings.length > 0) console.warn(`  ${bat}: ${warnings.join('; ')}`)
    n++
  }
  console.log(`Generated ${n} strategies into bundled-assets/strategies/.`)
}
