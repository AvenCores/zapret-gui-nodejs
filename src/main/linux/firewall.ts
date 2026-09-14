/**
 * Firewall backends — TypeScript port of
 * `src/firewall-backends/00-nftables.sh` and `01-iptables.sh`.
 * Auto-detect prefers nftables (mirrors `00-` < `01-` file order).
 * @module main/linux/firewall
 */
import { execFile } from 'node:child_process'
import {
  IPT_CHAIN,
  IPT_CHAIN_REPLY,
  IPT_TABLE,
  NFT_CHAIN,
  NFT_CHAIN_PRE,
  NFT_MARK,
  NFT_QUEUE_NUM,
  NFT_RULE_COMMENT,
  NFT_TABLE,
  type FirewallBackend,
  type FirewallBackendResolved
} from './constants'
import { runElevatedArgs } from './elevate'

export interface FirewallPorts {
  tcp: string
  udp: string
  interface: string
}

function hasBinary(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('sh', ['-c', `command -v ${name} >/dev/null 2>&1`], (err) => resolve(!err))
  })
}

/** Whether `nft` is available. */
export async function hasNft(): Promise<boolean> {
  return hasBinary('nft')
}

/** Whether `iptables`+`ip6tables` are available. */
export async function hasIptables(): Promise<boolean> {
  return (await hasBinary('iptables')) && (await hasBinary('ip6tables'))
}

/**
 * Detect the firewall backend to use (`auto` → nftables first, then iptables).
 * Throws when neither is available (mirrors `detect_firewall_backend`).
 */
export async function detectFirewallBackend(requested: FirewallBackend = 'auto'): Promise<FirewallBackendResolved> {
  if (requested === 'nftables') return 'nftables'
  if (requested === 'iptables') return 'iptables'
  if (await hasNft()) return 'nftables'
  if (await hasIptables()) return 'iptables'
  throw new Error('No firewall backend available — install nftables or iptables')
}

/** List installed backends (canonical names). */
export async function listAvailableBackends(): Promise<FirewallBackendResolved[]> {
  const out: FirewallBackendResolved[] = []
  if (await hasNft()) out.push('nftables')
  if (await hasIptables()) out.push('iptables')
  return out
}

function oifClauses(iface: string): { oif: string[]; iif: string[] } {
  if (!iface || iface === 'any') return { oif: [], iif: [] }
  const safe = iface.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32)
  if (!safe) return { oif: [], iif: [] }
  return { oif: ['oifname', `"${safe}"`], iif: ['iifname', `"${safe}"`] }
}

// ---------------------------------------------------------------------------
// nftables (00-nftables.sh backend_setup / backend_clear)
// ---------------------------------------------------------------------------

/** Build `nft` invocations for `backend_setup`. Pure. */
export function buildNftSetupCommands(ports: FirewallPorts): string[][] {
  const { tcp, udp, interface: iface } = ports
  const [tableProto, tableName] = NFT_TABLE.split(' ')
  const { oif, iif } = oifClauses(iface)
  const cmds: string[][] = [
    ['add', 'table', tableProto, tableName],
    ['add', 'chain', tableProto, tableName, NFT_CHAIN, '{', 'type', 'filter', 'hook', 'postrouting', 'priority', 'mangle;', '}'],
    ['add', 'chain', tableProto, tableName, NFT_CHAIN_PRE, '{', 'type', 'filter', 'hook', 'prerouting', 'priority', 'filter;', '}']
  ]
  if (tcp) {
    cmds.push([
      'add', 'rule', tableProto, tableName, NFT_CHAIN,
      ...oif,
      'meta', 'mark', 'and', NFT_MARK, '==', '0',
      'tcp', 'dport', `{${tcp}}`,
      'ct', 'original', 'packets', '1-6',
      'queue', 'num', String(NFT_QUEUE_NUM), 'bypass',
      'comment', `"${NFT_RULE_COMMENT}"`
    ])
  }
  if (udp) {
    cmds.push([
      'add', 'rule', tableProto, tableName, NFT_CHAIN,
      ...oif,
      'meta', 'mark', 'and', NFT_MARK, '==', '0',
      'udp', 'dport', `{${udp}}`,
      'ct', 'original', 'packets', '1-6',
      'queue', 'num', String(NFT_QUEUE_NUM), 'bypass',
      'comment', `"${NFT_RULE_COMMENT}"`
    ])
  }
  if (tcp) {
    cmds.push([
      'add', 'rule', tableProto, tableName, NFT_CHAIN_PRE,
      ...iif,
      'tcp', 'sport', `{${tcp}}`,
      'ct', 'reply', 'packets', '1-3',
      'queue', 'num', String(NFT_QUEUE_NUM), 'bypass',
      'comment', `"${NFT_RULE_COMMENT}"`
    ])
  }
  return cmds
}

/** Build `nft` cleanup invocations. Pure. */
export function buildNftClearCommands(): { listTables: string[]; flushChain: (chain: string) => string[]; deleteChain: (chain: string) => string[]; deleteTable: string[] } {
  const [tableProto, tableName] = NFT_TABLE.split(' ')
  return {
    listTables: ['list', 'tables'],
    flushChain: (chain: string) => ['flush', 'chain', tableProto, tableName, chain],
    deleteChain: (chain: string) => ['delete', 'chain', tableProto, tableName, chain],
    deleteTable: ['delete', 'table', tableProto, tableName]
  }
}

// ---------------------------------------------------------------------------
// iptables (01-iptables.sh backend_setup / backend_clear)
// ---------------------------------------------------------------------------

/** Convert nft port syntax to iptables multiport syntax. Pure. */
export function toIptablesPorts(ports: string): string {
  return ports.replace(/[{}]/g, '').replace(/-/g, ':')
}

export interface IptablesSetupStep {
  cmd: 'iptables' | 'ip6tables'
  args: string[]
}

/** Build iptables/ip6tables invocations for `backend_setup`. Pure. */
export function buildIptablesSetupCommands(ports: FirewallPorts, queueNum = NFT_QUEUE_NUM, mark = NFT_MARK): IptablesSetupStep[] {
  const oif: string[] = ports.interface && ports.interface !== 'any' ? ['-o', ports.interface.replace(/[^A-Za-z0-9._-]/g, '')] : []
  const tcp = toIptablesPorts(ports.tcp)
  const udp = toIptablesPorts(ports.udp)
  const steps: IptablesSetupStep[] = []
  for (const cmd of ['iptables', 'ip6tables'] as const) {
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-D', 'POSTROUTING', '-j', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-F', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-X', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-D', 'PREROUTING', '-j', IPT_CHAIN_REPLY] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-F', IPT_CHAIN_REPLY] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-X', IPT_CHAIN_REPLY] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-N', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-A', 'POSTROUTING', '-j', IPT_CHAIN] })
    if (tcp) {
      steps.push({
        cmd,
        args: ['-t', IPT_TABLE, '-A', IPT_CHAIN, ...oif, '-p', 'tcp', '-m', 'multiport', '--dports', tcp,
          '-m', 'connbytes', '--connbytes-dir=original', '--connbytes-mode=packets', '--connbytes', '1:6',
          '-m', 'mark', '!', '--mark', mark, '-j', 'NFQUEUE', '--queue-num', String(queueNum), '--queue-bypass']
      })
    }
    if (udp) {
      steps.push({
        cmd,
        args: ['-t', IPT_TABLE, '-A', IPT_CHAIN, ...oif, '-p', 'udp', '-m', 'multiport', '--dports', udp,
          '-m', 'connbytes', '--connbytes-dir=original', '--connbytes-mode=packets', '--connbytes', '1:6',
          '-m', 'mark', '!', '--mark', mark, '-j', 'NFQUEUE', '--queue-num', String(queueNum), '--queue-bypass']
      })
    }
    if (tcp) {
      steps.push({ cmd, args: ['-t', IPT_TABLE, '-N', IPT_CHAIN_REPLY] })
      steps.push({ cmd, args: ['-t', IPT_TABLE, '-A', 'PREROUTING', '-j', IPT_CHAIN_REPLY] })
      steps.push({
        cmd,
        args: ['-t', IPT_TABLE, '-A', IPT_CHAIN_REPLY, ...oif, '-p', 'tcp', '-m', 'multiport', '--sports', tcp,
          '-m', 'connbytes', '--connbytes-dir=reply', '--connbytes-mode=packets', '--connbytes', '1:3',
          '-m', 'mark', '!', '--mark', mark, '-j', 'NFQUEUE', '--queue-num', String(queueNum), '--queue-bypass']
      })
    }
  }
  return steps
}

/** Build iptables cleanup steps. Pure. */
export function buildIptablesClearCommands(): IptablesSetupStep[] {
  const steps: IptablesSetupStep[] = []
  for (const cmd of ['iptables', 'ip6tables'] as const) {
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-D', 'POSTROUTING', '-j', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-F', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-X', IPT_CHAIN] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-D', 'PREROUTING', '-j', IPT_CHAIN_REPLY] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-F', IPT_CHAIN_REPLY] })
    steps.push({ cmd, args: ['-t', IPT_TABLE, '-X', IPT_CHAIN_REPLY] })
  }
  return steps
}

// ---------------------------------------------------------------------------
// Execution (elevated, best-effort cleanup never throws fatally)
// ---------------------------------------------------------------------------

/** Create nft table/chains/rules (clears the old table first). */
export async function firewallSetupNft(ports: FirewallPorts, onLog?: (t: string) => void): Promise<void> {
  const [tableProto, tableName] = NFT_TABLE.split(' ')
  // Best-effort clear of a previous table (mirrors backend_setup).
  const existing = await runElevatedArgs('nft', ['list', 'tables'], 10000)
  if ((existing.stdout ?? '').includes(NFT_TABLE) || (existing.stdout ?? '').includes(tableName)) {
    for (const args of [
      ['flush', 'chain', tableProto, tableName, NFT_CHAIN],
      ['delete', 'chain', tableProto, tableName, NFT_CHAIN],
      ['flush', 'chain', tableProto, tableName, NFT_CHAIN_PRE],
      ['delete', 'chain', tableProto, tableName, NFT_CHAIN_PRE],
      ['delete', 'table', tableProto, tableName]
    ]) {
      await runElevatedArgs('nft', args, 10000)
    }
  }
  for (const args of buildNftSetupCommands(ports)) {
    onLog?.(`nft ${args.join(' ')}`)
    const r = await runElevatedArgs('nft', args, 15000)
    if (r.code !== 0) {
      throw new Error(`nft failed: ${(r.stdout + r.stderr).trim().slice(0, 400)}`)
    }
  }
}

/** Remove the nft table/chains. Best-effort (never throws). */
export async function firewallClearNft(onLog?: (t: string) => void): Promise<void> {
  const [tableProto, tableName] = NFT_TABLE.split(' ')
  const existing = await runElevatedArgs('nft', ['list', 'tables'], 10000).catch(() => ({ stdout: '', stderr: '', code: 1 }))
  if (!((existing as { stdout: string }).stdout ?? '').includes(tableName)) return
  for (const args of [
    ['flush', 'chain', tableProto, tableName, NFT_CHAIN],
    ['delete', 'chain', tableProto, tableName, NFT_CHAIN],
    ['flush', 'chain', tableProto, tableName, NFT_CHAIN_PRE],
    ['delete', 'chain', tableProto, tableName, NFT_CHAIN_PRE],
    ['delete', 'table', tableProto, tableName]
  ]) {
    try {
      onLog?.(`nft ${args.join(' ')}`)
      await runElevatedArgs('nft', args, 10000)
    } catch {
      /* best-effort */
    }
  }
}

/** Create iptables chains/rules. Cleanup steps ignore failures (idempotent). */
export async function firewallSetupIptables(ports: FirewallPorts, onLog?: (t: string) => void): Promise<void> {
  for (const step of buildIptablesSetupCommands(ports)) {
    const isCleanup = step.args.includes('-D') || step.args.includes('-F') || step.args.includes('-X')
    onLog?.(`${step.cmd} ${step.args.join(' ')}`)
    const r = await runElevatedArgs(step.cmd, step.args, 15000)
    if (r.code !== 0 && !isCleanup) {
      throw new Error(`${step.cmd} failed: ${(r.stdout + r.stderr).trim().slice(0, 400)}`)
    }
  }
}

/** Remove iptables chains. Best-effort (never throws). */
export async function firewallClearIptables(onLog?: (t: string) => void): Promise<void> {
  for (const step of buildIptablesClearCommands()) {
    try {
      onLog?.(`${step.cmd} ${step.args.join(' ')}`)
      await runElevatedArgs(step.cmd, step.args, 10000)
    } catch {
      /* best-effort */
    }
  }
}

/** Dispatch setup by backend name. */
export async function firewallSetup(
  backend: FirewallBackendResolved,
  ports: FirewallPorts,
  onLog?: (t: string) => void
): Promise<void> {
  if (backend === 'nftables') return firewallSetupNft(ports, onLog)
  return firewallSetupIptables(ports, onLog)
}

/** Dispatch cleanup by backend name (never throws). */
export async function firewallClear(backend: FirewallBackendResolved, onLog?: (t: string) => void): Promise<void> {
  try {
    if (backend === 'nftables') await firewallClearNft(onLog)
    else await firewallClearIptables(onLog)
  } catch {
    /* best-effort */
  }
}

/** Whether firewall rules for zapret are currently present. */
export async function isFirewallActive(backend: FirewallBackendResolved): Promise<boolean> {
  try {
    if (backend === 'nftables') {
      const r = await runElevatedArgs('nft', ['list', 'tables'], 10000)
      return (r.stdout ?? '').includes('zapretunix')
    }
    const r = await runElevatedArgs('iptables', ['-t', IPT_TABLE, '-L', IPT_CHAIN, '-n'], 10000)
    return r.code === 0
  } catch {
    return false
  }
}
