/**
 * Tiny file + in-memory ring-buffer logger. Renderer receives new lines
 * via the `zapret:on-log` / `zapret:on-logs` webContents events.
 *
 * Buffers are split per storage category (`app` / `zapret` / `tg-proxy`),
 * each with its own cap (see `LOG_BUFFER_LIMITS`), so the spammy tg-proxy
 * session lines can never evict zapret/app lines. Files are split the same
 * way: `app.log` vs `tg-proxy.log`, each rotated independently.
 *
 * A master switch (`setLogsEnabled(false)`) drops every line at the entry
 * point — no buffer push, no file write, no IPC — so a background app with
 * logs off costs ~0 CPU.
 * @module main/logger
 */
import fs from 'node:fs'
import type { LogLine, LogSource, LogStoreCategory } from '../shared/types'
import { logCategoryOf } from '../shared/types'
import { LOG_BUFFER_LIMITS } from '../shared/constants'

const buffers: Record<LogStoreCategory, LogLine[]> = { app: [], zapret: [], 'tg-proxy': [] }
const listeners = new Set<(line: LogLine) => void>()

/** Cap for app.log: config-tester runs emit hundreds of lines per minute. */
const MAX_FILE_BYTES_APP = 2 * 1024 * 1024
/** tg-proxy sessions spam far more — keep its file smaller. */
const MAX_FILE_BYTES_TG = 1 * 1024 * 1024
/** Bytes appended since the last size check (stat on every line is wasteful). */
let bytesSinceStatApp = 0
let bytesSinceStatTg = 0
const STAT_EVERY_BYTES = 256 * 1024

let appFilePath: string | null = null
let tgFilePath: string | null = null

/** Master log switch (settings → `logsEnabled`). Defaults to on. */
let logsEnabled = true

export function setLogsEnabled(v: boolean): void {
  logsEnabled = v === true
}

export function isLogsEnabled(): boolean {
  return logsEnabled
}

/**
 * Point the logger at its files. The second arg is optional for backward
 * compat: when omitted, `tg-proxy.log` is derived next to `app.log`.
 */
export function initLogger(appPath: string, tgProxyPath?: string): void {
  appFilePath = appPath
  if (tgProxyPath !== undefined) {
    tgFilePath = tgProxyPath
  } else if (appPath.endsWith('app.log')) {
    tgFilePath = `${appPath.slice(0, -'app.log'.length)}tg-proxy.log`
  } else {
    tgFilePath = `${appPath}.tg-proxy.log`
  }
  // Force a size check on the first line (previous session may have left huge files).
  bytesSinceStatApp = STAT_EVERY_BYTES
  bytesSinceStatTg = STAT_EVERY_BYTES
}

/** Rotate a log file → `<file>.1` once it exceeds the cap. Best-effort. */
function maybeRotateFile(filePath: string | null, cap: number, bytesSinceStat: number): number {
  if (!filePath || bytesSinceStat < STAT_EVERY_BYTES) return bytesSinceStat
  try {
    if (fs.statSync(filePath).size < cap) return 0
    const prev = `${filePath}.1`
    try {
      fs.rmSync(prev, { force: true })
    } catch {
      /* ignore */
    }
    try {
      fs.renameSync(filePath, prev)
    } catch {
      /* ignore */
    }
  } catch {
    /* missing file — nothing to rotate */
  }
  return 0
}

export function onLog(listener: (line: LogLine) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Buffered lines for one category, or everything merged in time order. */
export function getBufferedLogs(category?: 'all' | LogStoreCategory): LogLine[] {
  if (category === undefined || category === 'all') {
    const merged = [...buffers.app, ...buffers.zapret, ...buffers['tg-proxy']]
    merged.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
    return merged
  }
  return [...buffers[category]]
}

/** Per-category buffered counts (for the Logs filter badges). */
export function getBufferedLogCounts(): Record<LogStoreCategory, number> {
  return { app: buffers.app.length, zapret: buffers.zapret.length, 'tg-proxy': buffers['tg-proxy'].length }
}

/** Drop buffered lines for one category, or everything when omitted/`all`. */
export function clearBufferedLogs(category?: 'all' | LogStoreCategory): void {
  if (category === undefined || category === 'all') {
    buffers.app.length = 0
    buffers.zapret.length = 0
    buffers['tg-proxy'].length = 0
    return
  }
  buffers[category].length = 0
}

function appendToFile(filePath: string | null, textLine: string): number {
  if (!filePath) return 0
  try {
    fs.appendFileSync(filePath, textLine, 'utf8')
    return Buffer.byteLength(textLine, 'utf8')
  } catch {
    /* disk errors are non-fatal */
    return 0
  }
}

export function log(source: LogSource, level: LogLine['level'], text: string): LogLine | null {
  if (!logsEnabled) return null
  const line: LogLine = { ts: new Date().toISOString(), source, level, text }
  const category = logCategoryOf(source)
  const buf = buffers[category]
  buf.push(line)
  const cap = LOG_BUFFER_LIMITS[category]
  if (buf.length > cap) buf.splice(0, buf.length - cap)
  for (const l of listeners) {
    try {
      l(line)
    } catch {
      /* listener must never break logging */
    }
  }
  const textLine = `[${line.ts}] [${source}/${level}] ${text}\n`
  if (category === 'tg-proxy') {
    bytesSinceStatTg = maybeRotateFile(tgFilePath, MAX_FILE_BYTES_TG, bytesSinceStatTg)
    bytesSinceStatTg += appendToFile(tgFilePath, textLine)
  } else {
    bytesSinceStatApp = maybeRotateFile(appFilePath, MAX_FILE_BYTES_APP, bytesSinceStatApp)
    bytesSinceStatApp += appendToFile(appFilePath, textLine)
  }
  if (level === 'error') console.error(`[${source}] ${text}`)
  return line
}

export const info = (source: LogSource, text: string): LogLine | null => log(source, 'info', text)
export const warn = (source: LogSource, text: string): LogLine | null => log(source, 'warn', text)
export const err = (source: LogSource, text: string): LogLine | null => log(source, 'error', text)
