/**
 * Linux diagnostics — mirror of the Windows suite for
 * `nfqws` + nftables/iptables + init services.
 * @module main/diagnostics-linux
 */
import fs from 'node:fs'
import path from 'node:path'
import type { DiagnosticCheck } from '../shared/types'
import { getBinDir } from './paths'
import { loadLinuxConf } from './linux/config'
import { detectFirewallBackend, isFirewallActive, listAvailableBackends } from './linux/firewall'
import { detectInitSystem, queryLinuxServiceState } from './linux/init-system'
import { getLinuxNfqwsPath, isNfqwsRunning, checkNfqwsDeps, distroInstallHint } from './linux/service'
import { canElevateWithoutPassword, isRoot } from './linux/elevate'
import { LINUX_SERVICE_NAME } from './linux/constants'

async function checkElevate(): Promise<DiagnosticCheck> {
  const root = isRoot()
  const nopass = root || (await canElevateWithoutPassword())
  return {
    id: 'root',
    labelKey: 'diag.root',
    level: root || nopass ? 'ok' : 'warn',
    detail: root ? 'running as root' : nopass ? 'passwordless sudo available' : 'no root — service actions will prompt for password',
    detailKey: root ? 'diag.detail.rootOk' : nopass ? 'diag.detail.sudoNopass' : 'diag.detail.rootWarn'
  }
}

async function checkFirewallBackend(): Promise<DiagnosticCheck> {
  const avail = await listAvailableBackends().catch(() => [])
  if (avail.length === 0) {
    return {
      id: 'firewall',
      labelKey: 'diag.firewall',
      level: 'fail',
      detail: 'neither nftables nor iptables is installed',
      detailKey: 'diag.detail.firewallFail'
    }
  }
  return {
    id: 'firewall',
    labelKey: 'diag.firewall',
    level: 'ok',
    detail: `available: ${avail.join(', ')}`,
    detailKey: 'diag.detail.firewallOk',
    detailParams: { list: avail.join(', ') }
  }
}

async function checkNfqws(dataDir: string): Promise<DiagnosticCheck> {
  const p = getLinuxNfqwsPath(dataDir)
  let present = false
  try {
    present = fs.existsSync(p)
  } catch {
    present = false
  }
  if (!present) {
    try {
      const bin = getBinDir()
      present = fs.existsSync(path.join(bin, 'nfqws'))
    } catch {
      present = false
    }
  }
  return {
    id: 'nfqws',
    labelKey: 'diag.nfqws',
    level: present ? 'ok' : 'fail',
    detail: present ? `nfqws present (${p})` : `nfqws NOT found in ${p} — download Linux deps first`,
    detailKey: present ? 'diag.detail.nfqwsOk' : 'diag.detail.nfqwsFail',
    ...(present ? {} : { detailParams: { path: p } })
  }
}

async function checkNfqwsDepsRow(dataDir: string): Promise<DiagnosticCheck | null> {
  // Skipped when the binary itself is missing (the nfqws row already fails).
  const p = getLinuxNfqwsPath(dataDir)
  try {
    if (!fs.existsSync(p)) return null
  } catch {
    return null
  }
  const deps = await checkNfqwsDeps(p).catch(() => ({ ok: true, missing: [] as string[] }))
  if (deps.ok) {
    return {
      id: 'nfqwsDeps',
      labelKey: 'diag.nfqwsDeps',
      level: 'ok',
      detail: 'all shared libraries resolve',
      detailKey: 'diag.detail.nfqwsDepsOk'
    }
  }
  const list = deps.missing.join(', ')
  const hint = distroInstallHint()
  return {
    id: 'nfqwsDeps',
    labelKey: 'diag.nfqwsDeps',
    level: 'fail',
    detail: `missing shared libraries: ${list} — install them: ${hint}`,
    detailKey: 'diag.detail.nfqwsDepsFail',
    detailParams: { list, hint }
  }
}

async function checkInitService(): Promise<DiagnosticCheck> {
  const init = await detectInitSystem().catch(() => 'unknown' as const)
  if (init === 'unknown') {
    return {
      id: 'init',
      labelKey: 'diag.init',
      level: 'warn',
      detail: 'unknown init system — autostart unavailable, foreground runs still work',
      detailKey: 'diag.detail.initUnknown'
    }
  }
  const state = await queryLinuxServiceState(init, LINUX_SERVICE_NAME).catch(() => 'UNKNOWN' as const)
  return {
    id: 'init',
    labelKey: 'diag.init',
    level: state === 'RUNNING' ? 'ok' : state === 'STOPPED' ? 'warn' : 'ok',
    detail: `${init}: ${state}`,
    detailKey: 'diag.detail.initState',
    detailParams: { init, state }
  }
}

async function checkFirewallActive(dataDir: string): Promise<DiagnosticCheck> {
  try {
    const conf = loadLinuxConf(dataDir)
    const backend = await detectFirewallBackend(conf?.firewall_backend ?? 'auto')
    const active = await isFirewallActive(backend)
    const running = await isNfqwsRunning()
    if (running && !active) {
      return {
        id: 'firewallActive',
        labelKey: 'diag.firewallActive',
        level: 'warn',
        detail: `nfqws running but no ${backend} rules detected`,
        detailKey: 'diag.detail.fwRulesMissing',
        detailParams: { backend }
      }
    }
    return {
      id: 'firewallActive',
      labelKey: 'diag.firewallActive',
      level: 'ok',
      detail: active ? `${backend} rules active` : 'no firewall rules (service stopped)',
      detailKey: active ? 'diag.detail.fwRulesOk' : 'diag.detail.fwRulesIdle',
      detailParams: { backend }
    }
  } catch (e) {
    return {
      id: 'firewallActive',
      labelKey: 'diag.firewallActive',
      level: 'warn',
      detail: `could not check firewall: ${(e as Error).message.slice(0, 120)}`,
      detailKey: 'diag.detail.fwCheckFail'
    }
  }
}

function checkConf(dataDir: string): DiagnosticCheck {
  const conf = loadLinuxConf(dataDir)
  if (!conf) {
    return {
      id: 'conf',
      labelKey: 'diag.conf',
      level: 'warn',
      detail: 'conf.env missing — apply a strategy first',
      detailKey: 'diag.detail.confMissing'
    }
  }
  return {
    id: 'conf',
    labelKey: 'diag.conf',
    level: 'ok',
    detail: `strategy=${conf.strategy} iface=${conf.interface} fw=${conf.firewall_backend}`,
    detailKey: 'diag.detail.confOk',
    detailParams: { strategy: conf.strategy, iface: conf.interface, fw: conf.firewall_backend }
  }
}

async function checkHostsYoutube(): Promise<DiagnosticCheck> {
  try {
    const content = fs.readFileSync('/etc/hosts', 'utf8').toLowerCase()
    const hit = content.includes('youtube.com') || content.includes('youtu.be')
    return {
      id: 'hosts',
      labelKey: 'diag.hosts',
      level: hit ? 'warn' : 'ok',
      detail: hit ? 'hosts contains youtube entries — may break YouTube' : 'clean',
      detailKey: hit ? 'diag.detail.hostsWarn' : 'diag.detail.clean'
    }
  } catch {
    return { id: 'hosts', labelKey: 'diag.hosts', level: 'warn', detail: 'could not read /etc/hosts', detailKey: 'diag.detail.hostsReadFail' }
  }
}

function checkLists(dataDir: string): DiagnosticCheck {
  const listsDir = path.join(dataDir, 'lists')
  let files = 0
  try {
    files = fs.readdirSync(listsDir).filter((f) => f.endsWith('.txt')).length
  } catch {
    files = 0
  }
  return {
    id: 'lists',
    labelKey: 'diag.lists',
    level: files > 0 ? 'ok' : 'warn',
    detail: files > 0 ? `${files} list files` : 'no lists found — update strategies first',
    detailKey: files > 0 ? 'diag.detail.listsOk' : 'diag.detail.listsMissing',
    detailParams: { count: String(files) }
  }
}

/** Run the Linux diagnostics suite. */
export async function runLinuxDiagnostics(dataDir: string): Promise<DiagnosticCheck[]> {
  const out: DiagnosticCheck[] = [
    await checkElevate(),
    await checkFirewallBackend(),
    await checkNfqws(dataDir)
  ]
  const deps = await checkNfqwsDepsRow(dataDir).catch(() => null)
  if (deps) out.push(deps)
  out.push(
    checkConf(dataDir),
    await checkInitService(),
    await checkFirewallActive(dataDir),
    checkLists(dataDir),
    await checkHostsYoutube()
  )
  return out
}
