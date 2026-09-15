/**
 * Linux strategy parsing — TypeScript port of `parse_bat_file()` from
 * `zapret-discord-youtube-linux-master/src/lib/common.sh`.
 *
 * Windows flow (`strategy-parser.ts`) keeps `--wf-*` inside `args` for
 * `winws.exe`. On Linux `--wf-tcp/--wf-udp` feed the firewall (nft/iptables)
 * while `--filter-tcp/--filter-udp ... --new` blocks feed `nfqws`.
 * @module main/linux/strategy-linux
 */
import { GAME_FILTER_PORTS, GAME_FILTER_OFF_PORTS } from './constants'
import { tokenizeCommandLine } from '../strategy-parser'

export interface LinuxStrategyOptions {
  useGameFilterTcp: boolean
  useGameFilterUdp: boolean
}

export interface LinuxParsedStrategy {
  tcpPorts: string
  udpPorts: string
  /** One entry per `--filter-* ... --new` block (quotes preserved). */
  nfqwsParams: string[]
  warnings: string[]
}

/**
 * Substitute GameFilter placeholders exactly like `common.sh`:
 * - both off → strip `[, ]%GameFilter*%[, ]` occurrences
 * - otherwise TCP/UDP → 1024-65535 or 12, generic %GameFilter% → full range.
 * Pure.
 */
export function applyGameFilterSubstitution(content: string, opts: LinuxStrategyOptions): string {
  let out = content
  const { useGameFilterTcp, useGameFilterUdp } = opts
  const useGameFilter = useGameFilterTcp || useGameFilterUdp
  if (useGameFilter) {
    out = out.split('%GameFilter%').join(GAME_FILTER_PORTS)
    out = out
      .split('%GameFilterTCP%').join(useGameFilterTcp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
      .split('%gamefiltertcp%').join(useGameFilterTcp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
      .split('%GameFilterUDP%').join(useGameFilterUdp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
      .split('%gamefilterudp%').join(useGameFilterUdp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
    // Case-insensitive leftovers (bash `${var//pattern/}` is case-sensitive,
    // but .bat files sometimes use lowercase).
    out = out.replace(/%gamefilter%/gi, GAME_FILTER_PORTS)
    out = out.replace(/%gamefiltertcp%/gi, useGameFilterTcp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
    out = out.replace(/%gamefilterudp%/gi, useGameFilterUdp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
    return out
  }
  // USE_GAME_FILTER=false: drop the placeholder plus one adjacent comma.
  out = out.replace(/,%GameFilter%/gi, '')
  out = out.replace(/%GameFilter%,/gi, '')
  out = out.replace(/,%GameFilterTCP%/gi, '')
  out = out.replace(/%GameFilterTCP%,/gi, '')
  out = out.replace(/,%GameFilterUDP%/gi, '')
  out = out.replace(/%GameFilterUDP%,/gi, '')
  // Bare leftovers (no comma around, e.g. `--filter-udp=%GameFilterUDP%`).
  out = out.replace(/%GameFilterTCP%/gi, GAME_FILTER_OFF_PORTS)
  out = out.replace(/%GameFilterUDP%/gi, GAME_FILTER_OFF_PORTS)
  out = out.replace(/%GameFilter%/gi, '')
  return out
}

/**
 * Join caret (`^`) continuations like the .bat parser does.
 * Pure.
 */
export function joinCaretContinuations(content: string): string[] {
  const normalized = content.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const joined: string[] = []
  let acc = ''
  for (const raw of lines) {
    const trimmedEnd = raw.replace(/\s+$/, '')
    if (trimmedEnd.endsWith('^')) acc += `${trimmedEnd.slice(0, -1)} `
    else {
      acc += raw
      joined.push(acc)
      acc = ''
    }
  }
  if (acc.trim()) joined.push(acc)
  return joined
}

/**
 * Parse a `.bat` file into firewall ports + nfqws filter blocks.
 * Mirrors `common.sh parse_bat_file` (errors on 0 or 2+ `--wf-*`).
 * Pure except for no I/O (takes content directly).
 */
export function parseBatForLinux(rawContent: string, opts: LinuxStrategyOptions): LinuxParsedStrategy {
  const warnings: string[] = []
  let content = rawContent.replace(/\r/g, '')
  content = content.split('%BIN%').join('bin/').split('%bin%').join('bin/')
  content = content.split('%LISTS%').join('lists/').split('%lists%').join('lists/')

  content = applyGameFilterSubstitution(content, opts)

  const wfTcpMatches = content.match(/--wf-tcp=/gi) ?? []
  const wfUdpMatches = content.match(/--wf-udp=/gi) ?? []
  if (wfTcpMatches.length === 0 || wfUdpMatches.length === 0) {
    throw new Error('--wf-tcp or --wf-udp not found in strategy file')
  }
  if (wfTcpMatches.length > 1) {
    throw new Error(`Multiple --wf-tcp entries found (${wfTcpMatches.length})`)
  }
  if (wfUdpMatches.length > 1) {
    throw new Error(`Multiple --wf-udp entries found (${wfUdpMatches.length})`)
  }

  const tcpM = content.match(/--wf-tcp=([0-9,-]+)/)
  const udpM = content.match(/--wf-udp=([0-9,-]+)/)
  const tcpPorts = tcpM?.[1] ?? ''
  const udpPorts = udpM?.[1] ?? ''
  if (!tcpPorts || !udpPorts) throw new Error('Could not extract --wf-tcp/--wf-udp ports')

  // `--filter-(tcp|udp)=ports <args...>` blocks: split the winws tail by
  // `--new` (the strategy separator), keep blocks that start with --filter.
  const joined = joinCaretContinuations(content)
  const idx = joined.findIndex((l) => l.toLowerCase().includes('winws.exe') || l.toLowerCase().includes('nfqws'))
  if (idx === -1) {
    warnings.push('winws.exe/nfqws invocation not found — trying whole file')
  }
  const tail = (idx === -1 ? joined : joined.slice(idx)).join(' ')
  // Cut everything before the first --filter (drops the exe + --wf-* part).
  const firstFilter = tail.search(/--filter-(tcp|udp)=/i)
  const filterTail = firstFilter === -1 ? '' : tail.slice(firstFilter)
  const blocks = filterTail
    .split(/--new\b/i)
    .map((b) => b.trim())
    .filter((b) => /--filter-(tcp|udp)=/i.test(b))
    .map((b) => b.replace(/=\^!/g, '=!').trim())
    .filter(Boolean)

  if (blocks.length === 0) warnings.push('No --filter-* blocks found')

  return { tcpPorts, udpPorts, nfqwsParams: blocks, warnings }
}

/**
 * Parse from already-materialized GUI `Strategy.args` (placeholder form).
 * Resolves `<GAME_TCP>/<GAME_UDP>/<GAME>` then extracts ports + blocks.
 * This keeps ONE source of truth for strategies (the JSON configs) instead
 * of re-reading `.bat` files from disk. Pure.
 */
export function parseStrategyArgsForLinux(
  args: string[],
  opts: LinuxStrategyOptions & { binDir?: string; listsDir?: string }
): LinuxParsedStrategy {
  const { useGameFilterTcp, useGameFilterUdp } = opts
  const useGameFilter = useGameFilterTcp || useGameFilterUdp
  let joined = args.join(' ')
  const sub = (token: string, value: string): string => token.split(value).join(value)
  void sub
  if (useGameFilter) {
    joined = joined
      .split('<GAME_TCP>').join(useGameFilterTcp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
      .split('<GAME_UDP>').join(useGameFilterUdp ? GAME_FILTER_PORTS : GAME_FILTER_OFF_PORTS)
      .split('<GAME>').join(GAME_FILTER_PORTS)
  } else {
    // Strip placeholder + one adjacent comma (mirror bash).
    joined = joined.replace(/,<GAME_TCP>/g, '').replace(/<GAME_TCP>,/g, '')
    joined = joined.replace(/,<GAME_UDP>/g, '').replace(/<GAME_UDP>,/g, '')
    joined = joined.replace(/,<GAME>/g, '').replace(/<GAME>,/g, '')
    joined = joined.split('<GAME_TCP>').join(GAME_FILTER_OFF_PORTS)
    joined = joined.split('<GAME_UDP>').join(GAME_FILTER_OFF_PORTS)
    joined = joined.split('<GAME>').join('')
  }
  // Also handle raw %GameFilter% forms surviving in imported strategies.
  joined = applyGameFilterSubstitution(joined, opts)

  const wfTcp = joined.match(/--wf-tcp=([0-9,{}-]+)/)
  const wfUdp = joined.match(/--wf-udp=([0-9,{}-]+)/)
  // Braces come from nft set syntax `{80,443}` — normalize for firewall use.
  const norm = (s: string): string => s.replace(/[{}]/g, '')
  const tcpPorts = wfTcp?.[1] ? norm(wfTcp[1]) : ''
  const udpPorts = wfUdp?.[1] ? norm(wfUdp[1]) : ''
  if (!tcpPorts || !udpPorts) {
    throw new Error('--wf-tcp/--wf-udp ports not found in strategy args')
  }
  const blocks = joined
    .split(/--new\b/i)
    .map((b) => b.trim())
    .filter((b) => /--filter-(tcp|udp)=/i.test(b))
    .map((b) => {
      // Drop the leading --wf-* part that lives in the first block.
      const fi = b.search(/--filter-(tcp|udp)=/i)
      return (fi > 0 ? b.slice(fi) : b).replace(/=\^!/g, '=!').trim()
    })
    .filter(Boolean)
  return { tcpPorts, udpPorts, nfqwsParams: blocks, warnings: [] }
}

/**
 * Materialize `<BIN>/<LISTS>/<ROOT>` placeholders inside nfqws blocks to
 * real absolute paths, then tokenize into argv entries.
 *
 * Two traps handled here (both hit production as
 * `cannot access ipset file '"/root/.../data/root/.../lists/..."'`):
 * - spawn() delivers each array element verbatim (no shell), so `.bat`
 *   quoting must go *entirely* — a surviving `"` becomes part of the
 *   filename (like Windows `materializeArgsForSpawn` does).
 * - bare relative `bin/`/`lists/` (from raw `.bat` `%BIN%`/`%LISTS%` forms)
 *   are prefixed only outside absolute paths (lookbehind): after
 *   `<LISTS>` → `/data/lists`, the `lists/` inside that substitution must
 *   NOT be replaced again, or the dir doubles (`/data/data/lists/...`).
 * Pure.
 */
export function materializeNfqwsArgv(
  blocks: string[],
  opts: { binDir: string; listsDir: string }
): string[] {
  const out: string[] = []
  for (const block of blocks) {
    for (const raw of tokenizeCommandLine(block)) {
      let t = raw.trim().replace(/"/g, '')
      if (!t) continue
      t = t
        .split('<BIN>').join(opts.binDir)
        .split('<LISTS>').join(opts.listsDir)
        .split('<ROOT>').join(opts.binDir)
      t = t
        .replace(/(?<![\w/])bin\//g, `${opts.binDir}/`)
        .replace(/(?<![\w/])lists\//g, `${opts.listsDir}/`)
      // Collapse accidental double slashes (except after `scheme:`).
      t = t.replace(/([^:])\/\/+/g, '$1/')
      out.push(t)
    }
    out.push('--new')
  }
  // Trailing --new is harmless for nfqws, but drop it for cleanliness.
  if (out[out.length - 1] === '--new') out.pop()
  return out
}

/**
 * Full nfqws argv for a strategy (without the binary itself).
 * `daemon=true` adds `--daemon` (service mode); foreground tests omit it.
 *
 * Stay-root trap: when started as root *with* CAP_SETUID/CAP_SETGID (our
 * runner/systemd unit always are), nfqws defaults to
 * `uid:gid = 0x7FFFFFFF:0x7FFFFFFF` (see `can_drop_root()` /
 * `params.uid = params.gid[0] = 0x7FFFFFFF` in upstream `nfqws.c`) and then
 * fails its post-drop `file_open_test()` on every list under
 * `~/.config/zapret-gui/data/` (`Running as UID=2147483647 ... Permission
 * denied ... cannot access hostlist file ...`, exit 1, restart loop).
 * Upstream `/opt/zapret` works around it with `--user=<world-readable>`,
 * but `$HOME` is not traversable by other users — so we pin
 * `--uid=<data-owner>` (see `resolveDataOwnerUid`). Note plain `--uid=0:0`
 * does NOT work either: `dropcaps()` strips `CAP_DAC_OVERRIDE`, so even
 * uid 0 gets `EACCES` on a `700` home dir. An explicit `--user`/`--uid`
 * from a custom strategy is respected and wins.
 * Pure (the owner uid is an input, resolved by the caller).
 */
export function buildNfqwsArgv(
  parsed: LinuxParsedStrategy,
  opts: { binDir: string; listsDir: string; fwMark?: string; qnum?: number; daemon?: boolean; runUid?: string }
): string[] {
  const argv: string[] = []
  if (opts.daemon) argv.push('--daemon')
  argv.push(`--dpi-desync-fwmark=${opts.fwMark ?? '0x40000000'}`)
  argv.push(`--qnum=${opts.qnum ?? 220}`)
  const materialized = materializeNfqwsArgv(parsed.nfqwsParams, opts)
  const hasUserPin = materialized.some((a) => /^--(user|uid)(=|$)/.test(a))
  if (!hasUserPin) argv.push(`--uid=${opts.runUid ?? '0:0'}`)
  argv.push(...materialized)
  return argv
}
