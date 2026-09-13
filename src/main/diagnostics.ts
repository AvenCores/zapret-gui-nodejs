/**
 * Diagnostic checks mirroring `service.bat :service_diagnostics`.
 * Each check returns { level: ok|warn|fail, detail } — the renderer
 * maps `labelKey` through i18n and colors the level.
 * @module main/diagnostics
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runCmd, runPowershell } from './exec'
import { getBinDir } from './paths'
import { CONFLICTING_SERVICES } from '../shared/constants'
import type { DiagnosticCheck } from '../shared/types'
import type { I18nKey } from '../shared/i18n'
import { scQueryState } from './diagnostics-helpers'

export { scQueryState }

interface Ctx {
  installDir: string
  appData: string
}

async function checkBFE(): Promise<DiagnosticCheck> {
  const running = (await scQueryState('BFE')) === 'RUNNING'
  return {
    id: 'bfe',
    labelKey: 'diag.bfe',
    level: running ? 'ok' : 'fail',
    detail: running ? 'RUNNING' : 'Base Filtering Engine is not running — required for WinDivert/zapret',
    detailKey: running ? 'diag.detail.running' : 'diag.detail.bfeFail'
  }
}

async function checkProxy(): Promise<DiagnosticCheck> {
  const r = await runCmd('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable')
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(r.stdout)
  if (!enabled) {
    return { id: 'proxy', labelKey: 'diag.proxy', level: 'ok', detail: 'disabled', detailKey: 'diag.detail.disabled' }
  }
  const r2 = await runCmd('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer')
  const m = r2.stdout.match(/ProxyServer\s+REG_SZ\s+(.+)/)
  const server = (m?.[1] ?? '').trim() || 'unknown server'
  return {
    id: 'proxy',
    labelKey: 'diag.proxy',
    level: 'warn',
    detail: `enabled (${server}) — make sure it is valid or disable it`,
    detailKey: 'diag.detail.proxyOn',
    detailParams: { server }
  }
}

async function checkTimestamps(): Promise<DiagnosticCheck> {
  const r = await runCmd('netsh interface tcp show global')
  const enabled = /timestamps.*enabled/i.test(r.stdout)
  if (enabled) {
    return { id: 'timestamps', labelKey: 'diag.timestamps', level: 'ok', detail: 'enabled', detailKey: 'diag.detail.enabled' }
  }
  // Try to auto-enable (mirrors service.bat).
  const fix = await runCmd('netsh interface tcp set global timestamps=enabled')
  const autoFixed = fix.code === 0
  return {
    id: 'timestamps',
    labelKey: 'diag.timestamps',
    level: autoFixed ? 'warn' : 'fail',
    detail: autoFixed ? 'was disabled — enabled automatically' : 'disabled and could not enable automatically',
    detailKey: autoFixed ? 'diag.detail.tsAuto' : 'diag.detail.tsFail'
  }
}

async function checkProcess(
  image: string,
  id: string,
  labelKey: DiagnosticCheck['labelKey'],
  hint: string,
  failKey: I18nKey
): Promise<DiagnosticCheck> {
  const r = await runCmd(`tasklist /FI "IMAGENAME eq ${image}" /FO CSV /NH`)
  const found = r.stdout.toLowerCase().includes(image.toLowerCase())
  return {
    id,
    labelKey,
    level: found ? 'fail' : 'ok',
    detail: found ? `${image} detected — ${hint}` : 'not detected',
    detailKey: found ? failKey : 'diag.detail.notDetected'
  }
}

async function checkServicePattern(
  pattern: RegExp,
  id: string,
  labelKey: DiagnosticCheck['labelKey'],
  hint: string,
  failKey: I18nKey,
  excludeZapret = true
): Promise<DiagnosticCheck> {
  const r = await runCmd('sc query')
  const hits = r.stdout
    .split(/\r?\n/)
    .filter((l) => /^SERVICE_NAME/i.test(l))
    .map((l) => l.split(':')[1]?.trim() ?? '')
    .filter((n) => pattern.test(n) && (!excludeZapret || !/^zapret$/i.test(n)))
  const list = hits.join(', ')
  return {
    id,
    labelKey,
    level: hits.length > 0 ? 'fail' : 'ok',
    detail: hits.length > 0 ? `${list} — ${hint}` : 'not detected',
    detailKey: hits.length > 0 ? failKey : 'diag.detail.notDetected',
    ...(hits.length > 0 ? { detailParams: { list } } : {})
  }
}

export function checkCyrillic(ctx: Ctx): DiagnosticCheck {
  const bad = /[\u0400-\u04FF\u0500-\u052F]/.test(ctx.installDir)
  return {
    id: 'cyrillic',
    labelKey: 'diag.cyrillic',
    level: bad ? 'warn' : 'ok',
    detail: bad ? `install path contains Cyrillic: ${ctx.installDir}` : 'path OK',
    detailKey: bad ? 'diag.detail.cyrillicWarn' : 'diag.detail.pathOk',
    ...(bad ? { detailParams: { path: ctx.installDir } } : {})
  }
}

export function checkOneDrive(ctx: Ctx): DiagnosticCheck {
  const od = process.env.OneDrive ?? process.env.ONEDRIVE ?? ''
  const inside = od !== '' && ctx.installDir.toLowerCase().startsWith(od.toLowerCase())
  return {
    id: 'onedrive',
    labelKey: 'diag.onedrive',
    level: inside ? 'fail' : 'ok',
    detail: inside ? 'installed inside OneDrive folder — move to e.g. C:\\zapret' : 'OK',
    detailKey: inside ? 'diag.detail.onedriveFail' : 'diag.detail.ok'
  }
}

async function checkSecureDNS(): Promise<DiagnosticCheck> {
  // DoH configured per-interface (DohFlags > 0) — mirrors service.bat DNS check.
  const r = await runPowershell(
    `(Get-ChildItem -Recurse -Path 'HKLM:System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\' -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object { $_.DohFlags -gt 0 } | Measure-Object).Count`
  )
  const count = Number((r.stdout || '0').trim())
  const configured = count > 0
  return {
    id: 'dns',
    labelKey: 'diag.dns',
    level: configured ? 'ok' : 'warn',
    detail: configured ? 'encrypted DNS configured' : 'configure Secure DNS in browser / Windows 11 settings',
    detailKey: configured ? 'diag.detail.dnsOk' : 'diag.detail.dnsWarn'
  }
}

function checkSysFile(): DiagnosticCheck {
  const bin = getBinDir()
  let present = false
  try {
    present = fs.readdirSync(bin).some((f) => f.toLowerCase().endsWith('.sys'))
  } catch {
    present = false
  }
  return {
    id: 'sysfile',
    labelKey: 'diag.sysfile',
    level: present ? 'ok' : 'fail',
    detail: present ? 'WinDivert64.sys present' : 'WinDivert64.sys NOT found in bin/',
    detailKey: present ? 'diag.detail.sysOk' : 'diag.detail.sysFail'
  }
}

async function checkHostsYoutube(): Promise<DiagnosticCheck> {
  const hosts = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  try {
    const content = fs.readFileSync(hosts, 'utf8').toLowerCase()
    const hit = content.includes('youtube.com') || content.includes('youtu.be')
    return {
      id: 'hosts',
      labelKey: 'diag.hosts',
      level: hit ? 'warn' : 'ok',
      detail: hit ? 'hosts contains youtube entries — may break YouTube' : 'clean',
      detailKey: hit ? 'diag.detail.hostsWarn' : 'diag.detail.clean'
    }
  } catch {
    return { id: 'hosts', labelKey: 'diag.hosts', level: 'warn', detail: 'could not read hosts file', detailKey: 'diag.detail.hostsReadFail' }
  }
}

async function checkWinDivertStuck(): Promise<DiagnosticCheck> {
  const wd = await scQueryState('WinDivert')
  const r = await runCmd('tasklist /FI "IMAGENAME eq winws.exe" /FO CSV /NH')
  const winws = r.stdout.toLowerCase().includes('winws.exe')
  if (!winws && (wd === 'RUNNING' || wd === 'STOP_PENDING')) {
    await runCmd('net stop "WinDivert" >nul 2>&1')
    await runCmd('sc delete "WinDivert" >nul 2>&1')
    return { id: 'windivertStuck', labelKey: 'diag.windivertStuck', level: 'warn', detail: 'winws not running but WinDivert active — removed stale service', detailKey: 'diag.detail.stuckRemoved' }
  }
  return { id: 'windivertStuck', labelKey: 'diag.windivertStuck', level: 'ok', detail: 'no stale state', detailKey: 'diag.detail.noStale' }
}

async function checkConflicts(): Promise<DiagnosticCheck> {
  const found: string[] = []
  for (const svc of CONFLICTING_SERVICES) {
    if ((await scQueryState(svc)) !== 'NOT_INSTALLED') found.push(svc)
  }
  const list = found.join(', ')
  return {
    id: 'conflicts',
    labelKey: 'diag.conflicts',
    level: found.length > 0 ? 'fail' : 'ok',
    detail: found.length > 0 ? `found: ${list}` : 'none',
    detailKey: found.length > 0 ? 'diag.detail.conflictsFail' : 'diag.detail.none',
    ...(found.length > 0 ? { detailParams: { list } } : {})
  }
}

async function checkVpn(): Promise<DiagnosticCheck> {
  const r = await runCmd('sc query')
  const hits = r.stdout
    .split(/\r?\n/)
    .filter((l) => /^SERVICE_NAME/i.test(l))
    .map((l) => l.split(':')[1]?.trim() ?? '')
    .filter((n) => /vpn/i.test(n))
  const list = hits.join(', ')
  return {
    id: 'vpn',
    labelKey: 'diag.vpn',
    level: hits.length > 0 ? 'warn' : 'ok',
    detail: hits.length > 0 ? `VPN services: ${list} — disable VPNs` : 'none',
    detailKey: hits.length > 0 ? 'diag.detail.vpnWarn' : 'diag.detail.none',
    ...(hits.length > 0 ? { detailParams: { list } } : {})
  }
}

/** Run the full diagnostics suite. */
export async function runDiagnostics(installDir: string, appData: string): Promise<DiagnosticCheck[]> {
  const ctx: Ctx = { installDir, appData }
  void os.platform
  const results: DiagnosticCheck[] = []
  results.push(await checkBFE())
  results.push(await checkProxy())
  results.push(await checkTimestamps())
  results.push(await checkProcess('AdguardSvc.exe', 'adguard', 'diag.adguard', 'may break Discord voice', 'diag.detail.adguardFail'))
  results.push(await checkServicePattern(/killer/i, 'killer', 'diag.killer', 'conflicts with zapret', 'diag.detail.conflictFail'))
  results.push(await checkServicePattern(/intel.*connectivity|connectivity.*network/i, 'intel', 'diag.intel', 'conflicts with zapret', 'diag.detail.conflictFail'))
  const cp = await checkServicePattern(/TracSrvWrapper|EPWD/i, 'checkpoint', 'diag.checkpoint', 'uninstall Check Point', 'diag.detail.checkpointFail')
  results.push(cp)
  results.push(await checkServicePattern(/smartbyte/i, 'smartbyte', 'diag.smartbyte', 'disable via services.msc', 'diag.detail.smartbyteFail'))
  results.push(checkCyrillic(ctx))
  results.push(checkOneDrive(ctx))
  results.push(checkSysFile())
  results.push(await checkVpn())
  results.push(await checkSecureDNS())
  results.push(await checkHostsYoutube())
  results.push(await checkWinDivertStuck())
  results.push(await checkConflicts())
  return results
}
