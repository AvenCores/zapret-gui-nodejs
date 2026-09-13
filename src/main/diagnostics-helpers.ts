/**
 * Small helper split out for unit-testing: numeric `sc query` STATE parsing.
 * @module main/diagnostics-helpers
 */
import { runCmd } from './exec'
import type { ServiceState } from '../shared/types'

/** Query a single Windows service state (NOT_INSTALLED when missing). */
export async function scQueryState(name: string): Promise<ServiceState> {
  const r = await runCmd(`sc query "${name}"`)
  const combined = r.stdout + '\n' + r.stderr
  if (r.code !== 0 && /FAILED 1060|does not exist/i.test(combined)) return 'NOT_INSTALLED'
  const numeric = combined.match(/STATE\s*:\s*(\d+)/i)
  if (numeric) {
    const code = Number(numeric[1])
    if (code === 4) return 'RUNNING'
    if (code === 1) return 'STOPPED'
    if (code === 2) return 'START_PENDING'
    if (code === 3) return 'STOP_PENDING'
  }
  return 'UNKNOWN'
}
