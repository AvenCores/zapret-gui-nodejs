/**
 * Shared service-state query (single implementation lives in
 * `service-manager`; this re-export keeps diagnostics imports stable).
 * @module main/diagnostics-helpers
 */
import { queryServiceState } from './service-manager'
import type { ServiceState } from '../shared/types'

/** Query a single Windows service state (NOT_INSTALLED when missing). */
export async function scQueryState(name: string): Promise<ServiceState> {
  return queryServiceState(name)
}
