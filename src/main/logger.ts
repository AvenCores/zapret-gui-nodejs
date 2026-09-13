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

let filePath: string | null = null

export function initLogger(path: string): void {
  filePath = path
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
      fs.appendFileSync(filePath, `[${line.ts}] [${source}/${level}] ${text}\n`, 'utf8')
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
