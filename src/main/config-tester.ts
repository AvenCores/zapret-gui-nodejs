/**
 * Native config tester — in-app replacement for `utils/test zapret.ps1`.
 *
 * Flow (mirrors the PS1 script):
 * - prechecks: admin rights, no installed `zapret` service (would conflict)
 * - load targets from `data/utils/targets.txt` (fallback to built-in defaults)
 * - snapshot running winws.exe instances + ipset content, restore afterwards
 * - for each strategy: kill winws, spawn winws with materialized args,
 *   wait until ready, run checks, kill winws
 * - standard mode: HEAD probes (HTTP / TLS1.2 / TLS1.3) + ICMP ping per target
 * - dpi mode: POST 64KB with Range (TCP 16-20 freeze detection, hyperion-cs suite)
 * - analytics + best-config pick + results file under `utils/test results/`
 * @module main/config-tester
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import os from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Strategy, ConfigTestMode, ConfigTesterAnalyticsRow, ConfigTesterEvent, ServiceState } from '../shared/types'
import type { BatchStep } from './linux/elevate'
import { run, runCmd, runPowershell, isAdmin } from './exec'
import { queryServiceState, isProcessRunning, resolveGameFilterPorts } from './service-manager'
import { materializeArgsForSpawn } from './strategy-parser'
import { WINWS_EXE, WINDIVERT_SERVICE } from '../shared/constants'

export type { ConfigTestMode } from '../shared/types'
export type AnalyticsRow = ConfigTesterAnalyticsRow

export interface ConfigTestTarget {
  name: string
  /** HTTPS URL to probe (null for ping-only targets). */
  url: string | null
  /** Host/IP for ICMP ping. */
  pingHost: string
}

export type HttpTokenKind = 'OK' | 'ERROR' | 'UNSUP' | 'SSL'
export type TlsVariant = 'HTTP' | 'TLS1.2' | 'TLS1.3'

export interface HttpProbe {
  variant: TlsVariant
  kind: HttpTokenKind
  httpStatus: number | null
}

export interface StandardTargetResult {
  name: string
  probes: HttpProbe[]
  ping: string
  pingOk: boolean
}

export interface DpiProbeLine {
  label: TlsVariant
  code: string
  upBytes: number
  upKB: number
  downBytes: number
  downKB: number
  time: number
  status: 'OK' | 'FAIL' | 'UNSUPPORTED' | 'LIKELY_BLOCKED'
}

export interface DpiTargetResult {
  id: string
  provider: string
  country: string
  host: string
  lines: DpiProbeLine[]
  warned: boolean
}

export interface ConfigStandardResult {
  configId: string
  configName: string
  targets: StandardTargetResult[]
}

export interface ConfigDpiResult {
  configId: string
  configName: string
  targets: DpiTargetResult[]
}

export interface RunConfigTestsOptions {
  strategies: Strategy[]
  mode: ConfigTestMode
  binDir: string
  listsDir: string
  utilsDir: string
  dataDir: string
  signal: AbortSignal
  emit: (e: ConfigTesterEvent) => void
  curlTimeoutSec?: number
  dpiTimeoutSec?: number
  dpiRangeBytes?: number
  maxParallel?: number
}

const DEFAULT_TARGETS_TXT = [
  'DiscordMain = "https://discord.com"',
  'DiscordGateway = "https://gateway.discord.gg"',
  'DiscordCDN = "https://cdn.discordapp.com"',
  'DiscordUpdates = "https://updates.discord.com"',
  'YouTubeWeb = "https://www.youtube.com"',
  'YouTubeShort = "https://youtu.be"',
  'YouTubeImage = "https://i.ytimg.com"',
  'YouTubeVideoRedirect = "https://redirector.googlevideo.com"',
  'GoogleMain = "https://www.google.com"',
  'GoogleGstatic = "https://www.gstatic.com"',
  'CloudflareWeb = "https://www.cloudflare.com"',
  'CloudflareCDN = "https://cdnjs.cloudflare.com"',
  'CloudflareDNS1111 = "PING:1.1.1.1"',
  'CloudflareDNS1001 = "PING:1.0.0.1"',
  'GoogleDNS8888 = "PING:8.8.8.8"',
  'GoogleDNS8844 = "PING:8.8.4.4"'
].join('\n')

/** Parse `targets.txt` content into structured targets. Pure — unit tested. */
export function parseTargetsContent(content: string): ConfigTestTarget[] {
  const out: ConfigTestTarget[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\w+)\s*=\s*"(.+)"\s*$/)
    if (!m) continue
    out.push(convertRawTarget(m[1], m[2]))
  }
  return out
}

/** Convert one `Name = "value"` pair. `PING:x` values are ping-only. Pure. */
export function convertRawTarget(name: string, value: string): ConfigTestTarget {
  if (/^PING:/i.test(value.trim())) {
    return { name, url: null, pingHost: value.trim().replace(/^PING:\s*/i, '') }
  }
  const url = value.trim()
  const pingHost = hostOf(url)
  return { name, url, pingHost }
}

/** `https://host/path` → `host`. Pure. */
export function hostOf(urlStr: string): string {
  try {
    return new URL(urlStr).hostname
  } catch {
    return urlStr.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  }
}

/** Load targets from `utils/targets.txt` with built-in fallback. */
export function loadTargets(utilsDir: string): ConfigTestTarget[] {
  try {
    const p = path.join(utilsDir, 'targets.txt')
    if (fs.existsSync(p)) {
      const parsed = parseTargetsContent(fs.readFileSync(p, 'utf8'))
      if (parsed.length > 0) return parsed
    }
  } catch {
    /* fall through to defaults */
  }
  return parseTargetsContent(DEFAULT_TARGETS_TXT)
}

/** Classify a Node request error into a PS1-compatible token. Pure. */
export function classifyHttpError(msg: string): HttpTokenKind {
  const s = msg.toLowerCase()
  if (/could not resolve|enotfound|eai_again|certificate|self.signed|unable to verify|unable to get local issuer|cert/.test(s)) {
    return 'SSL'
  }
  if (/does not support|not supported|unsupported protocol|alert protocol|wrong version|tls.*not supported|unrecognized|unknown option|unsupported option|schannel|ssl3|handshake failure|protocol version/.test(s)) {
    return 'UNSUP'
  }
  return 'ERROR'
}

/** Summarize standard results for one config. Pure — unit tested. */
export function summarizeStandard(targets: StandardTargetResult[]): { ok: number; err: number; unsup: number; pingOk: number; pingFail: number } {
  let ok = 0
  let err = 0
  let unsup = 0
  let pingOk = 0
  let pingFail = 0
  for (const t of targets) {
    for (const p of t.probes) {
      if (p.kind === 'OK') ok++
      else if (p.kind === 'UNSUP') unsup++
      else err++
    }
    if (t.pingOk) pingOk++
    else pingFail++
  }
  return { ok, err, unsup, pingOk, pingFail }
}

/** Summarize DPI results for one config. Pure — unit tested. */
export function summarizeDpi(targets: DpiTargetResult[]): { ok: number; fail: number; unsup: number; blocked: number } {
  let ok = 0
  let fail = 0
  let unsup = 0
  let blocked = 0
  for (const t of targets) {
    for (const l of t.lines) {
      if (l.status === 'OK') ok++
      else if (l.status === 'FAIL') fail++
      else if (l.status === 'UNSUPPORTED') unsup++
      else blocked++
    }
  }
  return { ok, fail, unsup, blocked }
}

/** Pick the best config: max OK, tie-break by ping OK. Pure — unit tested. */
export function pickBestConfig(rows: AnalyticsRow[]): string | null {
  let best: string | null = null
  let maxScore = -1
  let maxPing = -1
  for (const r of rows) {
    if (r.ok > maxScore || (r.ok === maxScore && r.pingOk > maxPing)) {
      maxScore = r.ok
      maxPing = r.pingOk
      best = r.configName
    }
  }
  return best
}

function tlsOptions(variant: TlsVariant): { minVersion?: 'TLSv1.2' | 'TLSv1.3'; maxVersion?: 'TLSv1.2' | 'TLSv1.3' } {
  if (variant === 'TLS1.2') return { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }
  if (variant === 'TLS1.3') return { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }
  return {}
}

/**
 * HEAD probe mirroring `curl -I -s -m <timeout> <url>` (+ TLS flags).
 * OK = headers received (any status); network/TLS failures classified
 * into SSL / UNSUP / ERROR like the PS1 script.
 */
export function headProbe(urlStr: string, timeoutMs: number, variant: TlsVariant): Promise<HttpProbe> {
  return new Promise((resolve) => {
    let url: URL
    try {
      url = new URL(urlStr)
    } catch (e) {
      resolve({ variant, kind: 'ERROR', httpStatus: null })
      void e
      return
    }
    const lib = url.protocol === 'http:' ? http : https
    const opts: Record<string, unknown> = {
      method: 'HEAD',
      headers: { 'User-Agent': 'zapret-gui', Accept: '*/*' },
      timeout: timeoutMs,
      ...tlsOptions(variant)
    }
    let settled = false
    const done = (p: HttpProbe): void => {
      if (settled) return
      settled = true
      resolve(p)
    }
    let req: ReturnType<typeof lib.request>
    try {
      req = lib.request(url, opts as http.RequestOptions, (res) => {
        const status = res.statusCode ?? null
        res.resume()
        done({ variant, kind: 'OK', httpStatus: status })
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
      })
    } catch (e) {
      done({ variant, kind: classifyHttpError(e instanceof Error ? e.message : String(e)), httpStatus: null })
      return
    }
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`))
    })
    req.on('error', (e: Error) => {
      done({ variant, kind: classifyHttpError(e.message), httpStatus: null })
    })
    setTimeout(() => {
      done({ variant, kind: 'ERROR', httpStatus: null })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
    }, timeoutMs + 2000).unref?.()
    try {
      req.end()
    } catch (e) {
      done({ variant, kind: classifyHttpError(e instanceof Error ? e.message : String(e)), httpStatus: null })
    }
  })
}

/** ICMP ping. Windows: `ping.exe -n 1 -w`; Linux: `ping -c 1 -W 1`. */
export async function pingOnce(host: string, timeoutMs = 1000): Promise<{ text: string; ok: boolean }> {
  const safe = String(host).replace(/[^A-Za-z0-9.:_-]/g, '').slice(0, 253) || '127.0.0.1'
  if (process.platform === 'linux') {
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000))
    const r = await run('ping', ['-c', '1', '-W', String(secs), safe], { timeoutMs: timeoutMs + 3000 })
    const out = `${r.stdout}\n${r.stderr}`
    const m = out.match(/time=\s*([\d.]+)\s*ms/i)
    if (r.code === 0 && m) {
      const ms = Number(m[1])
      return { text: ms < 1 ? '<1 ms' : `${Math.round(ms)} ms`, ok: true }
    }
    if (r.code === 0 && /1 received|1 packets received/i.test(out)) return { text: '<1 ms', ok: true }
    return { text: 'Timeout', ok: false }
  }
  const r = await run('ping.exe', ['-n', '1', '-w', String(timeoutMs), safe], { timeoutMs: timeoutMs + 3000 })
  const out = `${r.stdout}\n${r.stderr}`
  const m = out.match(/time[=<]\s*(\d+)\s*ms/i) ?? out.match(/время[=<]\s*(\d+)\s*мс/i)
  if (r.code === 0 && m) {
    const ms = Number(m[1])
    return { text: ms < 1 ? '<1 ms' : `${ms} ms`, ok: true }
  }
  // `Reply ... time<1ms` without `=` spacing on some locales.
  if (r.code === 0 && /TTL=/i.test(out)) return { text: '<1 ms', ok: true }
  return { text: 'Timeout', ok: false }
}

interface DpiSuiteEntry {
  id: string
  provider: string
  country: string
  host: string
}

/** Fetch hyperion-cs DPI suite (TCP 16-20). Empty array on any failure. */
export function fetchDpiSuite(timeoutMs = 5000): Promise<DpiSuiteEntry[]> {
  const url = 'https://hyperion-cs.github.io/dpi-checkers/ru/tcp-16-20/suite.v2.json'
  return new Promise((resolve) => {
    let settled = false
    const done = (v: DpiSuiteEntry[]): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    let req: ReturnType<typeof https.get>
    try {
      req = https.get(url, { headers: { 'User-Agent': 'zapret-gui', Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          res.resume()
          done([])
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => {
          body += c
          if (body.length > 2_000_000) {
            try {
              req.destroy()
            } catch {
              /* ignore */
            }
            done([])
          }
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as Array<{ id?: string; provider?: string; country?: string; host?: string }>
            done(
              parsed
                .filter((e) => typeof e?.host === 'string' && e.host.length > 0)
                .map((e) => ({ id: String(e.id ?? e.host), provider: String(e.provider ?? ''), country: String(e.country ?? ''), host: String(e.host) }))
            )
          } catch {
            done([])
          }
        })
      })
    } catch {
      done([])
      return
    }
    req.on('timeout', () => {
      try {
        req.destroy(new Error('timeout'))
      } catch {
        /* ignore */
      }
      done([])
    })
    req.on('error', () => done([]))
    setTimeout(() => done([]), timeoutMs + 2000).unref?.()
  })
}

const DPI_VARIANTS: TlsVariant[] = ['HTTP', 'TLS1.2', 'TLS1.3']

/**
 * Single DPI probe: POST random 64KB with `Range: bytes=0-...`.
 * Detects the 16-20KB freeze (upload OK, download stalls until timeout).
 */
export function dpiProbe(host: string, payload: Buffer, rangeBytes: number, timeoutSec: number, variant: TlsVariant): Promise<DpiProbeLine> {
  return new Promise((resolve) => {
    const started = Date.now()
    const rangeSpec = `bytes=0-${rangeBytes - 1}`
    let settled = false
    const finish = (partial: Omit<DpiProbeLine, 'label' | 'upKB' | 'downKB'>): void => {
      if (settled) return
      settled = true
      resolve({ ...partial, label: variant, upKB: Math.round((partial.upBytes / 1024) * 10) / 10, downKB: Math.round((partial.downBytes / 1024) * 10) / 10 })
    }
    const upBytes = payload.length
    let req: ReturnType<typeof https.request>
    try {
      req = https.request(
        {
          hostname: host,
          port: 443,
          path: '/',
          method: 'POST',
          headers: {
            'User-Agent': 'zapret-gui',
            Range: rangeSpec,
            'Content-Type': 'application/octet-stream',
            'Content-Length': payload.length,
            Accept: '*/*'
          },
          timeout: timeoutSec * 1000,
          ...tlsOptions(variant)
        },
        (res) => {
          const code = String(res.statusCode ?? 'NA')
          let downBytes = 0
          res.on('data', (c: Buffer) => {
            downBytes += c.length
          })
          res.on('end', () => {
            const time = (Date.now() - started) / 1000
            finish({ code, upBytes, downBytes, time, status: 'OK' })
          })
        }
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/not supported|unsupported protocol|alert protocol|wrong version|schannel/i.test(msg)) {
        finish({ code: 'UNSUP', upBytes: 0, downBytes: 0, time: -1, status: 'UNSUPPORTED' })
      } else {
        finish({ code: 'ERR', upBytes: 0, downBytes: 0, time: -1, status: 'FAIL' })
      }
      return
    }
    req.on('timeout', () => {
      const time = (Date.now() - started) / 1000
      // Upload went out, nothing came back before the timeout → freeze pattern.
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      if (upBytes > 0) finish({ code: 'NA', upBytes, downBytes: 0, time, status: 'LIKELY_BLOCKED' })
      else finish({ code: 'ERR', upBytes, downBytes: 0, time, status: 'FAIL' })
    })
    req.on('error', (e: Error) => {
      const msg = e.message ?? ''
      const time = (Date.now() - started) / 1000
      if (/not supported|unsupported protocol|alert protocol|wrong version|schannel|EPROTO|ERR_SSL/i.test(msg)) {
        finish({ code: 'UNSUP', upBytes, downBytes: 0, time, status: 'UNSUPPORTED' })
        return
      }
      if (upBytes > 0 && time >= timeoutSec) {
        finish({ code: 'ERR', upBytes, downBytes: 0, time, status: 'LIKELY_BLOCKED' })
        return
      }
      finish({ code: 'ERR', upBytes, downBytes: 0, time, status: 'FAIL' })
    })
    setTimeout(() => {
      finish({ code: 'ERR', upBytes, downBytes: 0, time: (Date.now() - started) / 1000, status: 'FAIL' })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
    }, timeoutSec * 3000 + 5000).unref?.()
    try {
      req.write(payload)
      req.end()
    } catch (e) {
      finish({ code: 'ERR', upBytes: 0, downBytes: 0, time: -1, status: 'FAIL' })
      void e
    }
  })
}

interface WinwsSnapshotEntry {
  pid: number
  exe: string
  args: string
}

async function getWinwsSnapshot(): Promise<WinwsSnapshotEntry[]> {
  if (process.platform === 'linux') {
    // Linux tester requires a stopped service (precheck below), so there is
    // nothing to snapshot/restore — keep it a no-op (no sudo pgrep needed).
    return []
  }  try {
    const r = await runPowershell(
      `(Get-CimInstance Win32_Process -Filter "Name='winws.exe'" -ErrorAction SilentlyContinue | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress -ErrorAction SilentlyContinue)`,
      10000
    )
    const raw = (r.stdout ?? '').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw) as WinwsSnapshotEntry[] | Record<string, unknown>
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    const out: WinwsSnapshotEntry[] = []
    for (const e of arr as Array<{ ProcessId?: number; CommandLine?: string; ExecutablePath?: string }>) {
      if (!e?.ExecutablePath) continue
      let args = ''
      const cmd: string = String(e.CommandLine ?? '')
      const exe: string = String(e.ExecutablePath)
      const quoted = `"${exe}"`
      if (cmd.startsWith(quoted)) args = cmd.slice(quoted.length).trim()
      else if (cmd.startsWith(exe)) args = cmd.slice(exe.length).trim()
      out.push({ pid: Number(e.ProcessId ?? 0), exe, args })
    }
    return out
  } catch {
    return []
  }
}

async function restoreWinwsSnapshot(snapshot: WinwsSnapshotEntry[], emit: (e: ConfigTesterEvent) => void): Promise<void> {
  if (process.platform === 'linux') return
  if (snapshot.length === 0) return
  emit({ kind: 'log', level: 'info', text: 'Restoring previously running winws instances...' })
  let current = ''
  try {
    current = (await runPowershell(`(Get-CimInstance Win32_Process -Filter "Name='winws.exe'" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CommandLine) -join "\n"`, 8000)).stdout
  } catch {
    current = ''
  }
  for (const p of snapshot) {
    try {
      if (current.includes(p.exe) && p.args && current.includes(p.args.slice(0, 40))) continue
      const args = p.args ? splitArgs(p.args) : []
      spawn(p.exe, args, { cwd: path.dirname(p.exe), windowsHide: true, stdio: 'ignore', detached: true }).unref?.()
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Build foreground `nfqws` argv for the config tester (Linux): parse the
 * strategy's `--wf-*`/filter blocks with the current game-filter ports and
 * materialize paths. Falls back to a best-effort arg mapping when the
 * strategy has no `--wf-*` ports (older/custom strategies).
 */
async function buildLinuxTesterArgs(
  s: Strategy,
  opts: { binDir: string; listsDir: string; gameTcp: string; gameUdp: string }
): Promise<string[]> {
  const { parseStrategyArgsForLinux, buildNfqwsArgv } = await import('./linux/strategy-linux')
  try {
    const parsed = parseStrategyArgsForLinux(s.args, {
      useGameFilterTcp: opts.gameTcp === '1024-65535',
      useGameFilterUdp: opts.gameUdp === '1024-65535',
      binDir: opts.binDir,
      listsDir: opts.listsDir
    })
    return buildNfqwsArgv(parsed, { binDir: opts.binDir, listsDir: opts.listsDir, daemon: false })
  } catch {
    // Fallback: reuse the Windows arg mapping, swap the binary-specific
    // bits (drop --wf-*, add fwmark/qnum) so custom strategies still run.
    const mapped = materializeArgsForSpawn(s.args, opts)
      .filter((a) => !/^--wf-(tcp|udp)=/i.test(a))
      .map((a) => a.replace(/"/g, ''))
    return ['--dpi-desync-fwmark=0x40000000', '--qnum=220', ...mapped]
  }
}

function splitArgs(cmdline: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < cmdline.length; i++) {
    const ch = cmdline[i]
    if (ch === '"') {
      inQ = !inQ
      cur += ch
      continue
    }
    if (!inQ && (ch === ' ' || ch === '\t')) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

let activeChild: ChildProcess | null = null

/** Kill the tracked child only (no privilege needed — own wrapper process). */
function killActiveChild(): void {
  try {
    activeChild?.kill()
  } catch {
    /* ignore */
  }
  activeChild = null
}

async function killWinws(): Promise<void> {
  killActiveChild()
  if (process.platform === 'linux') {
    await run('pkill', ['-x', 'nfqws'], { timeoutMs: 8000 }).catch(() => ({ stdout: '', stderr: '', code: 1 }))
    try {
      // Single batched pkill (one prompt at most, silent with NOPASSWD).
      const { runBatch } = await import('./linux/elevate')
      await runBatch([{ kind: 'exec', file: 'pkill', args: ['-x', 'nfqws'], ignoreFailure: true }], {
        timeoutMs: 15000
      }).catch(() => undefined)
    } catch {
      /* best-effort */
    }
    return
  }
  await runCmd('taskkill /IM winws.exe /F >nul 2>&1', 8000)
}

async function waitWinwsReady(
  child: ChildProcess,
  getErrTail: () => string,
  timeoutMs = 6000
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const start = Date.now()
  const state: { spawnError: string | null; exit: { code: number | null; signal: string | null } | null } = {
    spawnError: null,
    exit: null
  }
  child.on('error', (e: Error) => {
    state.spawnError = e.message
  })
  child.on('exit', (code, signal) => {
    state.exit = { code, signal: String(signal ?? '') || null }
  })
  // Give the process a grace period to fail fast (bad args, driver load
  // error) before trusting tasklist output.
  while (Date.now() - start < timeoutMs) {
    if (state.spawnError) return { ok: false, detail: `spawn error: ${state.spawnError.slice(0, 300)}` }
    if (state.exit || child.exitCode !== null || child.signalCode !== null) {
      const code = state.exit?.code ?? child.exitCode
      const sig = state.exit?.signal ?? child.signalCode
      const tail = getErrTail().trim().slice(-500)
      const tailPart = tail ? ` — ${tail}` : ''
      const engine = process.platform === 'linux' ? 'nfqws' : 'winws'
      return { ok: false, detail: `${engine} exited immediately (code=${code ?? '?'}, signal=${sig ?? '?'})${tailPart}` }
    }
    const elapsed = Date.now() - start
    if (elapsed >= 1200) {
      try {
        if (process.platform === 'linux') {
          const running = await run('pgrep', ['-x', 'nfqws'], { timeoutMs: 5000 }).then(
            (r) => r.code === 0 && r.stdout.trim().length > 0
          ).catch(() => false)
          if (running) {
            await new Promise((r) => setTimeout(r, 300))
            return { ok: true }
          }
        } else if (await isProcessRunning(WINWS_EXE)) {
          await new Promise((r) => setTimeout(r, 300))
          return { ok: true }
        }
      } catch {
        /* retry */
      }
      // Spawn handle is authoritative: tasklist can lag or fail, but our
      // child being alive for 3s+ means the strategy is up.
      if (elapsed >= 3000) return { ok: true }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const tail = getErrTail().trim().slice(-500)
  const engine = process.platform === 'linux' ? 'nfqws' : 'winws'
  return { ok: false, detail: tail ? `${engine} not detected within timeout — ${tail}` : `${engine} process not found within timeout` }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal: AbortSignal): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (!signal.aborted) {
      const i = cursor++
      if (i >= items.length) break
      results[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return results
}

/** WinDivert driver services touched by winws (current + legacy name). */
const WINDIVERT_SERVICES = [WINDIVERT_SERVICE, 'WinDivert14'] as const

/** States of the WinDivert services captured before a test run. */
export type WindivertSnapshot = Record<string, ServiceState>

async function queryWindivertState(svc: string): Promise<ServiceState> {
  try {
    return await queryServiceState(svc)
  } catch {
    return 'UNKNOWN'
  }
}

/** Snapshot WinDivert presence before tests (best-effort, never throws). */
export async function snapshotWindivert(): Promise<WindivertSnapshot> {
  if (process.platform === 'linux') return {}
  const snap: WindivertSnapshot = {}
  for (const svc of WINDIVERT_SERVICES) {
    snap[svc] = await queryWindivertState(svc)
  }
  return snap
}

function isRunningState(s: ServiceState): boolean {
  return s === 'RUNNING' || s === 'START_PENDING'
}

/**
 * Decide how to undo what the test run did to a WinDivert service.
 * - absent before, present after → winws loaded it: stop + delete.
 * - stopped before, running after → return it to stopped (keep installed).
 * - anything else (was running, still absent, unknown) → leave alone.
 * Pure — covered by unit tests.
 */
export function planWindivertRestore(before: ServiceState, after: ServiceState): 'stop-delete' | 'stop' | null {
  if (before === 'NOT_INSTALLED' && after !== 'NOT_INSTALLED' && after !== 'UNKNOWN') return 'stop-delete'
  if (!isRunningState(before) && before !== 'NOT_INSTALLED' && before !== 'UNKNOWN' && isRunningState(after)) return 'stop'
  return null
}

/**
 * Unload WinDivert driver leftovers after tests — but only what the tests
 * pulled in: services that did not exist before are removed, services that
 * were stopped are stopped again. A previously running WinDivert is kept.
 */
export async function restoreWindivert(
  before: WindivertSnapshot,
  emit: (e: ConfigTesterEvent) => void
): Promise<void> {
  if (process.platform === 'linux') return
  for (const svc of WINDIVERT_SERVICES) {
    const prev = before[svc] ?? 'UNKNOWN'
    const after = await queryWindivertState(svc)
    const plan = planWindivertRestore(prev, after)
    if (!plan) continue
    try {
      if (plan === 'stop-delete') {
        emit({ kind: 'log', level: 'info', text: `Unloading ${svc} (was not loaded before tests)...` })
        await runCmd(`net stop "${svc}" >nul 2>&1`, 8000)
        await runCmd(`sc delete "${svc}" >nul 2>&1`, 8000)
      } else {
        emit({ kind: 'log', level: 'info', text: `Stopping ${svc} (restoring pre-test state)...` })
        await runCmd(`net stop "${svc}" >nul 2>&1`, 8000)
      }
    } catch {
      /* best-effort */
    }
  }
}

/** Migrate leftover `ipset_switched.flag` from interrupted PS1 runs. */
function healLeftoverFlag(dataDir: string, listsDir: string): string | null {
  try {
    const candidates = [path.join(dataDir, 'ipset_switched.flag'), path.join(listsDir, '..', 'ipset_switched.flag')]
    for (const flag of candidates) {
      if (fs.existsSync(flag)) {
        try {
          fs.rmSync(flag, { force: true })
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Main runner. Throws on precheck failures; emits `done` (cancelled or not)
 * on every completed run. Always restores winws + ipset in `finally`.
 */
export async function runConfigTests(opts: RunConfigTestsOptions): Promise<{ best: string | null; filePath: string | null; rows: AnalyticsRow[] }> {
  const { strategies, mode, binDir, listsDir, utilsDir, dataDir, signal, emit } = opts
  const curlTimeoutSec = opts.curlTimeoutSec ?? 4
  const dpiTimeoutSec = opts.dpiTimeoutSec ?? 5
  const dpiRangeBytes = opts.dpiRangeBytes ?? 65536
  const maxParallel = opts.maxParallel ?? Math.min(16, Math.max(8, (osCpuCount() * 2) | 0))

  if (strategies.length === 0) throw new Error('No strategies selected for testing')
  if (!(await isAdmin())) {
    throw new Error(
      process.platform === 'linux'
        ? 'Cannot elevate privileges for tests (nfqws + firewall): install sudo/doas or polkit (pkexec), or run Strategies → "Set up passwordless operation" first'
        : 'Administrator rights are required to run tests'
    )
  }
  const isLinux = process.platform === 'linux'
  if (isLinux) {
    const { getLinuxStatus } = await import('./linux/service')
    // getLinuxStatus needs the data dir; binDir/listsDir live under it.
    const dataDirGuess = path.dirname(binDir)
    try {
      const { snapshot } = await getLinuxStatus(dataDirGuess)
      if (snapshot.zapret === 'RUNNING' || snapshot.winwsRunning) {
        throw new Error("zapret service is running — remove/stop it before running tests")
      }
    } catch (e) {
      if (e instanceof Error && /remove\/stop/.test(e.message)) throw e
      /* status check is best-effort */
    }
  } else if ((await queryServiceState('zapret')) !== 'NOT_INSTALLED') {
    throw new Error("Windows service 'zapret' is installed — remove the service before running tests")
  }
  const exe = isLinux ? path.join(binDir, 'nfqws') : path.join(binDir, WINWS_EXE)
  if (!fs.existsSync(exe)) {
    throw new Error(isLinux ? `nfqws not found in ${binDir} — download Linux deps first` : `winws.exe not found in ${binDir}`)
  }

  healLeftoverFlag(dataDir, listsDir)

  const targets = mode === 'standard' ? loadTargets(utilsDir) : []
  emit({ kind: 'log', level: 'info', text: `Targets loaded: ${targets.length}` })

  let dpiSuite: DpiSuiteEntry[] = []
  if (mode === 'dpi') {
    const customHost = (process.env.MONITOR_HOST ?? '').trim()
    if (customHost) {
      dpiSuite = [{ id: 'CUSTOM', provider: 'Custom', country: '', host: customHost }]
    } else {
      emit({ kind: 'log', level: 'info', text: 'Fetching DPI suite...' })
      dpiSuite = await fetchDpiSuite(dpiTimeoutSec * 1000)
      if (dpiSuite.length === 0) throw new Error('DPI suite is empty (network blocked?) — cannot run DPI tests')
    }
    emit({ kind: 'log', level: 'info', text: `DPI targets: ${dpiSuite.length}, range 0-${dpiRangeBytes - 1}, timeout ${dpiTimeoutSec}s` })
  }

  const snapshot = await getWinwsSnapshot()
  const windivertBefore = await snapshotWindivert()
  const listFile = path.join(listsDir, 'ipset-all.txt')
  const backupFile = path.join(listsDir, 'ipset-all.config-tester-backup.txt')
  let originalIpset: string | null = null
  let ipsetSwitched = false
  try {
    if (fs.existsSync(listFile)) originalIpset = fs.readFileSync(listFile, 'utf8')
    else originalIpset = null
  } catch {
    originalIpset = null
  }

  const standardResults: ConfigStandardResult[] = []
  const dpiResults: ConfigDpiResult[] = []
  const rows: AnalyticsRow[] = []
  const payload = mode === 'dpi' ? crypto.randomBytes(dpiRangeBytes) : Buffer.alloc(0)

  const resultsDir = path.join(utilsDir, 'test results')
  fs.mkdirSync(resultsDir, { recursive: true })

  let tcp = '12'
  let udp = '12'
  try {
    const ports = resolveGameFilterPorts(dataDir)
    tcp = ports.tcp
    udp = ports.udp
  } catch {
    /* defaults */
  }

  try {
    if (mode === 'dpi' && originalIpset !== null && originalIpset.trim() !== '') {
      emit({ kind: 'log', level: 'warn', text: "Switching ipset to 'any' for accurate DPI tests..." })
      try {
        fs.writeFileSync(backupFile, originalIpset, 'utf8')
        fs.writeFileSync(listFile, '', 'utf8')
        ipsetSwitched = true
      } catch (e) {
        emit({ kind: 'log', level: 'warn', text: `Could not switch ipset: ${e instanceof Error ? e.message : String(e)}` })
      }
    }

    let completed = 0
    // Linux firewall backend for the whole run (resolved once; conf.env may
    // be absent when the service was never installed → auto).
    let linuxBackend: 'nftables' | 'iptables' | null = null
    let linuxIface = 'any'
    if (isLinux) {
      const { detectFirewallBackend } = await import('./linux/firewall')
      const { loadLinuxConf } = await import('./linux/config')
      const conf = loadLinuxConf(dataDir)
      linuxIface = conf?.interface ?? 'any'
      linuxBackend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto')
      emit({ kind: 'log', level: 'info', text: `Firewall backend: ${linuxBackend} (iface ${linuxIface})` })
    }
    for (let idx = 0; idx < strategies.length; idx++) {
      if (signal.aborted) break
      const s = strategies[idx] as Strategy
      emit({ kind: 'config-start', index: idx + 1, total: strategies.length, configName: s.name, mode })
      emit({ kind: 'progress', completed, total: strategies.length, current: s.name })
      if (!isLinux) await killWinws()

      const args = isLinux
        ? await buildLinuxTesterArgs(s, { binDir, listsDir, gameTcp: tcp, gameUdp: udp })
        : materializeArgsForSpawn(s.args, { binDir, listsDir, gameTcp: tcp, gameUdp: udp })
      if (isLinux && linuxBackend) {
        // One batch (single prompt at most): drop the previous strategy's
        // daemon, clear stale rules, set up this strategy's rules.
        try {
          const { buildFirewallClearSteps, buildFirewallSetupSteps } = await import('./linux/firewall')
          const { parseStrategyArgsForLinux } = await import('./linux/strategy-linux')
          const { runBatch } = await import('./linux/elevate')
          const parsed = parseStrategyArgsForLinux(s.args, {
            useGameFilterTcp: tcp === '1024-65535',
            useGameFilterUdp: udp === '1024-65535',
            binDir,
            listsDir
          })
          killActiveChild()
          const preSteps: BatchStep[] = [
            { kind: 'exec', file: 'pkill', args: ['-x', 'nfqws'], ignoreFailure: true },
            ...buildFirewallClearSteps(linuxBackend),
            ...buildFirewallSetupSteps(linuxBackend, { tcp: parsed.tcpPorts, udp: parsed.udpPorts, interface: linuxIface })
          ]
          const pre = await runBatch(preSteps, { timeoutMs: 120000 })
          if (pre.code !== 0) {
            throw new Error(`firewall batch failed${pre.failedStep !== null ? ` (step ${pre.failedStep + 1}/${preSteps.length})` : ''}: ${(pre.stdout + pre.stderr).trim().slice(0, 200)}`)
          }
        } catch (e) {
          emit({ kind: 'log', level: 'error', text: `Firewall setup failed for ${s.name}: ${(e as Error).message.slice(0, 200)}. Skipping...` })
          continue
        }
      }
      let child: ChildProcess | null = null
      let errTail = ''
      const getErrTail = (): string => errTail
      try {
        // Pipe (not ignore) stderr: if winws dies on startup (driver load,
        // bad args) the tail explains WHY instead of a generic "not found".
        // Streams are drained so a chatty winws can never block on a full pipe.
        // On Linux nfqws needs root: elevate per call (passwordless sudo when
        // configured, else one pkexec prompt) while the app stays as the user.
        if (isLinux) {
          const { spawnElevated } = await import('./linux/elevate')
          child = await spawnElevated(exe, args, { cwd: binDir, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
        } else {
          child = spawn(exe, args, { cwd: binDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
        }
        activeChild = child
        child.stdout?.resume()
        child.stderr?.on('data', (d: Buffer) => {
          errTail = (errTail + String(d)).slice(-2000)
        })
        child.stderr?.resume()
      } catch (e) {
        emit({ kind: 'log', level: 'error', text: `Failed to start ${s.name}: ${e instanceof Error ? e.message : String(e)}` })
        continue
      }

      const ready = await waitWinwsReady(child, getErrTail)
      if (!ready.ok) {
        emit({ kind: 'log', level: 'error', text: `Strategy failed to start: ${s.name} (${ready.detail}). Skipping...` })
        await killWinws()
        continue
      }

      if (mode === 'standard') {
        const perTarget = await mapWithConcurrency(
          targets,
          maxParallel,
          async (t) => {
            if (signal.aborted) return { name: t.name, probes: [], ping: 'Timeout', pingOk: false }
            const probes: HttpProbe[] = []
            if (t.url) {
              for (const v of DPI_VARIANTS) {
                if (signal.aborted) break
                probes.push(await headProbe(t.url, curlTimeoutSec * 1000, v))
              }
            }
            let ping = { text: 'n/a', ok: true }
            if (t.pingHost) {
              ping = t.pingHost ? await pingOnce(t.pingHost, 1000) : ping
              if (!t.url && !ping.ok) ping = { text: 'Timeout', ok: false }
            }
            return { name: t.name, probes, ping: ping.text, pingOk: ping.ok }
          },
          signal
        )
        standardResults.push({ configId: s.id, configName: s.name, targets: perTarget })
        const sum = summarizeStandard(perTarget)
        rows.push({ configId: s.id, configName: s.name, ok: sum.ok, err: sum.err, unsup: sum.unsup, pingOk: sum.pingOk, pingFail: sum.pingFail, blocked: 0 })
        for (const r of perTarget) {
          const tokens = r.probes.map((p) => `${p.variant}:${p.kind}`).join(' ')
          emit({ kind: 'log', level: 'info', text: `  ${r.name}  ${tokens} | Ping: ${r.ping}` })
        }
      } else {
        const perTarget = await mapWithConcurrency(
          dpiSuite,
          maxParallel,
          async (target) => {
            if (signal.aborted) return { id: target.id, provider: target.provider, country: target.country, host: target.host, lines: [], warned: false }
            const lines: DpiProbeLine[] = []
            let warned = false
            for (const v of DPI_VARIANTS) {
              if (signal.aborted) break
              const line = await dpiProbe(target.host, payload, dpiRangeBytes, dpiTimeoutSec, v)
              lines.push(line)
              if (line.status === 'LIKELY_BLOCKED') warned = true
            }
            return { id: target.id, provider: target.provider, country: target.country, host: target.host, lines, warned }
          },
          signal
        )
        dpiResults.push({ configId: s.id, configName: s.name, targets: perTarget })
        const sum = summarizeDpi(perTarget)
        rows.push({ configId: s.id, configName: s.name, ok: sum.ok, err: sum.fail, unsup: sum.unsup, pingOk: 0, pingFail: 0, blocked: sum.blocked })
        for (const t of perTarget) {
          emit({ kind: 'log', level: 'info', text: `  [${t.country}][${t.provider}] ${t.id}` })
          for (const l of t.lines) {
            emit({ kind: 'log', level: l.status === 'OK' ? 'info' : l.status === 'UNSUPPORTED' ? 'warn' : 'error', text: `    [${l.label}] code=${l.code} up=${l.upKB}KB down=${l.downKB}KB time=${l.time}s status=${l.status}` })
          }
        }
      }

      killActiveChild()
      if (isLinux && linuxBackend) {
        // Single batched cleanup (one prompt at most) per strategy.
        try {
          const { buildFirewallClearSteps } = await import('./linux/firewall')
          const { runBatch } = await import('./linux/elevate')
          const postSteps: BatchStep[] = [
            { kind: 'exec', file: 'pkill', args: ['-x', 'nfqws'], ignoreFailure: true },
            ...buildFirewallClearSteps(linuxBackend)
          ]
          await runBatch(postSteps, { timeoutMs: 60000 }).catch(() => undefined)
        } catch {
          /* ignore */
        }
      } else {
        await killWinws()
      }
      completed++
      emit({ kind: 'config-done', index: idx + 1, total: strategies.length, configName: s.name })
      emit({ kind: 'progress', completed, total: strategies.length, current: s.name })
    }

    const cancelled = signal.aborted
    const best = rows.length > 0 ? pickBestConfig(rows) : null
    const filePath = writeResultsFile(resultsDir, mode, standardResults, dpiResults, rows, best)

    emit({ kind: 'done', cancelled, best, filePath, rows })
    return { best, filePath, rows }
  } finally {
    killActiveChild()
    if (isLinux) {
      try {
        const { buildFirewallClearSteps, listAvailableBackends } = await import('./linux/firewall')
        const { runBatch } = await import('./linux/elevate')
        const finalSteps: BatchStep[] = [{ kind: 'exec', file: 'pkill', args: ['-x', 'nfqws'], ignoreFailure: true }]
        for (const b of await listAvailableBackends().catch(() => [] as Array<'nftables' | 'iptables'>)) {
          finalSteps.push(...buildFirewallClearSteps(b))
        }
        await runBatch(finalSteps, { timeoutMs: 60000 }).catch(() => undefined)
      } catch {
        /* ignore */
      }
    } else {
      await killWinws()
    }
    await restoreWindivert(windivertBefore, emit).catch(() => undefined)
    await restoreWinwsSnapshot(snapshot, emit).catch(() => undefined)
    if (ipsetSwitched) {
      try {
        if (originalIpset !== null) fs.writeFileSync(listFile, originalIpset, 'utf8')
        fs.rmSync(backupFile, { force: true })
        emit({ kind: 'log', level: 'info', text: 'Restored original ipset mode.' })
      } catch {
        /* best-effort */
      }
    }
  }
}

function osCpuCount(): number {
  try {
    return os.cpus()?.length ?? 8
  } catch {
    return 8
  }
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

/** Write `test_results_YYYY-MM-DD_HH-mm-ss.txt` mirroring the PS1 layout. */
export function writeResultsFile(
  resultsDir: string,
  mode: ConfigTestMode,
  standard: ConfigStandardResult[],
  dpi: ConfigDpiResult[],
  rows: AnalyticsRow[],
  best: string | null
): string | null {
  try {
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
    const file = path.join(resultsDir, `test_results_${stamp}.txt`)
    const lines: string[] = []
    if (mode === 'standard') {
      for (const r of standard) {
        lines.push(`Config: ${r.configName} (Type: standard)`)
        for (const t of r.targets) {
          lines.push(`  ${t.name} : ${t.probes.map((q) => `${q.variant}:${q.kind}${q.httpStatus != null ? `(${q.httpStatus})` : ''}`).join(' ')} | Ping: ${t.ping}`)
        }
        lines.push('')
      }
    } else {
      for (const r of dpi) {
        lines.push(`Config: ${r.configName} (Type: dpi)`)
        for (const t of r.targets) {
          lines.push(`  Target: [${t.country}] ${t.id} (${t.provider}) @ ${t.host}`)
          for (const l of t.lines) {
            lines.push(`    ${l.label}: code=${l.code} up=${l.upKB}KB down=${l.downKB}KB time=${l.time}s status=${l.status}`)
          }
        }
        lines.push('')
      }
    }
    lines.push('=== ANALYTICS ===')
    const width = rows.reduce((m, r) => Math.max(m, r.configName.length), 10)
    for (const r of rows) {
      if (mode === 'standard') {
        lines.push(`${padRight(r.configName, width)} : HTTP OK: ${String(r.ok).padStart(3)}, ERR: ${String(r.err).padStart(3)}, UNSUP: ${String(r.unsup).padStart(3)}, Ping OK: ${String(r.pingOk).padStart(3)}, Fail: ${String(r.pingFail).padStart(3)}`)
      } else {
        lines.push(`${padRight(r.configName, width)} : OK: ${String(r.ok).padStart(3)}, FAIL: ${String(r.err).padStart(3)}, UNSUP: ${String(r.unsup).padStart(3)}, BLOCKED: ${String(r.blocked).padStart(3)}`)
      }
    }
    lines.push(`Best strategy: ${best ?? 'n/a'}`)
    fs.mkdirSync(resultsDir, { recursive: true })
    fs.writeFileSync(file, lines.join('\n'), 'utf8')
    return file
  } catch {
    return null
  }
}

/** Abort the currently running winws child (best-effort). Exported for IPC stop. */
export function abortActiveChild(): void {
  try {
    activeChild?.kill()
  } catch {
    /* ignore */
  }
  activeChild = null
}
