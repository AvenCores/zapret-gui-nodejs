/**
 * Bypass connectivity check: lightweight HTTPS GET to a target URL.
 * Runs in the main process (no Chromium CORS/cache involved) so the
 * result reflects real TCP+TLS reachability through zapret/WinDivert.
 * @module main/bypass-check
 */
import http from 'node:http'
import https from 'node:https'
import { BYPASS_TARGETS, BYPASS_CHECK_TIMEOUT_MS } from '../shared/constants'
import type { BypassCheckResult, BypassTargetId } from '../shared/types'

export function getBypassTarget(id: BypassTargetId): (typeof BYPASS_TARGETS)[number] {
  const found = BYPASS_TARGETS.find((t) => t.id === id)
  if (!found) throw new Error(`Unknown bypass target: ${id}`)
  return found
}

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Keep the badge tooltip readable: first line, max ~120 chars.
  return msg.split('\n')[0].slice(0, 120)
}

/**
 * GET `url` and resolve on response headers (body is discarded).
 * `ok` is true for any 2xx–3xx status — headers received means
 * the TLS handshake + DPI desync succeeded.
 * Pure network I/O — covered indirectly via timeout/error paths.
 */
export function checkBypassUrl(urlStr: string, timeoutMs = BYPASS_CHECK_TIMEOUT_MS): Promise<{ ok: boolean; latencyMs: number; httpStatus: number | null; error: string | null }> {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (r: { ok: boolean; latencyMs: number; httpStatus: number | null; error: string | null }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let url: URL
    try {
      url = new URL(urlStr)
    } catch (e) {
      done({ ok: false, latencyMs: Date.now() - started, httpStatus: null, error: shortError(e) })
      return
    }
    const lib = url.protocol === 'http:' ? http : https
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': 'zapret-gui', Accept: '*/*' },
        timeout: timeoutMs
      },
      (res) => {
        const latencyMs = Date.now() - started
        const httpStatus = res.statusCode ?? null
        // Body not needed — drain and resolve on headers.
        res.resume()
        res.on('end', () => {
          done({ ok: httpStatus != null && httpStatus >= 200 && httpStatus < 400, latencyMs, httpStatus, error: null })
        })
        // Safety: if the server never ends the body, still succeed on headers.
        setTimeout(() => {
          try {
            res.destroy()
          } catch {
            /* ignore */
          }
          done({ ok: httpStatus != null && httpStatus >= 200 && httpStatus < 400, latencyMs, httpStatus, error: null })
        }, 3000).unref?.()
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`))
    })
    req.on('error', (e) => {
      done({ ok: false, latencyMs: Date.now() - started, httpStatus: null, error: shortError(e) })
    })
    // Hard fallback in case neither response nor error fires.
    setTimeout(() => {
      try {
        req.destroy(new Error(`timeout after ${timeoutMs}ms`))
      } catch {
        /* ignore */
      }
      done({ ok: false, latencyMs: Date.now() - started, httpStatus: null, error: `timeout after ${timeoutMs}ms` })
    }, timeoutMs + 1000).unref?.()
  })
}

export async function checkBypassTarget(id: BypassTargetId, timeoutMs = BYPASS_CHECK_TIMEOUT_MS): Promise<BypassCheckResult> {
  const target = getBypassTarget(id)
  const r = await checkBypassUrl(target.url, timeoutMs)
  return { id, ...r, checkedAt: new Date().toISOString() }
}
