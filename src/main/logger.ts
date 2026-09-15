/**
 * Tiny file + in-memory ring-buffer logger. Renderer receives new lines
 * via the `zapret:on-log` webContents event.
 * @module main/logger
 */
import fs from 'node:fs'
import type { LogLine } from '../shared/types'

const MAX_BUFFER = 2000
const buffer: LogLine[] = []
const listeners = new Set<(line: LogLine) => void>()

/** Cap for app.log: config-tester runs emit hundreds of lines per minute. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Bytes appended since the last size check (stat on every line is wasteful). */
let bytesSinceStat = 0
const STAT_EVERY_BYTES = 256 * 1024

let filePath: string | null = null

export function initLogger(path: string): void {
  filePath = path
  // Force a size check on the first line (previous session may have left a huge file).
  bytesSinceStat = STAT_EVERY_BYTES
}

/** Rotate app.log → app.log.1 once it exceeds the cap. Best-effort. */
function maybeRotate(): void {
  if (!filePath || bytesSinceStat < STAT_EVERY_BYTES) return
  bytesSinceStat = 0
  try {
    if (fs.statSync(filePath).size < MAX_FILE_BYTES) return
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
}

export function onLog(listener: (line: LogLine) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getBufferedLogs(): LogLine[] {
  return [...buffer]
}

export function log(source: LogLine['source'], level: LogLine['level'], text: string): LogLine {
  const line: LogLine = { ts: new Date().toISOString(), source, level, text }
  buffer.push(line)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  for (const l of listeners) {
    try {
      l(line)
    } catch {
      /* listener must never break logging */
    }
  }
  if (filePath) {
    try {
      maybeRotate()
      const textLine = `[${line.ts}] [${source}/${level}] ${text}\n`
      fs.appendFileSync(filePath, textLine, 'utf8')
      bytesSinceStat += Buffer.byteLength(textLine, 'utf8')
    } catch {
      /* disk errors are non-fatal */
    }
  }
  if (level === 'error') console.error(`[${source}] ${text}`)
  return line
}

export const info = (source: LogLine['source'], text: string): LogLine => log(source, 'info', text)
export const warn = (source: LogLine['source'], text: string): LogLine => log(source, 'warn', text)
export const err = (source: LogLine['source'], text: string): LogLine => log(source, 'error', text)
