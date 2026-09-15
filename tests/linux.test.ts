/** Unit tests for the Linux support modules (pure helpers, no root needed). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServiceState } from '../src/shared/types'
import type { InitSystem } from '../src/main/linux/constants'
import { parseConfEnv, serializeConfEnv, normalizeStrategyFileName, isValidInterfaceName } from '../src/main/linux/config'
import {
  applyGameFilterSubstitution,
  parseBatForLinux,
  parseStrategyArgsForLinux,
  buildNfqwsArgv,
  materializeNfqwsArgv
} from '../src/main/linux/strategy-linux'
import {
  buildNftSetupCommands,
  buildIptablesSetupCommands,
  toIptablesPorts,
  buildNftSetupSteps,
  buildIptablesSetupSteps,
  buildFirewallClearSteps,
  buildFirewallSetupSteps
} from '../src/main/linux/firewall'
import {
  buildSystemdUnit,
  buildDinitConf,
  serviceLocation,
  buildInstallSteps,
  buildStartSteps,
  buildStopSteps,
  buildRemoveSteps,
  parseSystemdShow
} from '../src/main/linux/init-system'
import { buildSudoersContent, buildDoasRules, isAuthFailure, noAuthMessage, withPathVariants } from '../src/main/linux/elevate'
import {
  BatchMarkerFilter,
  batchStepLabel,
  buildBatchScript,
  createPrivLock,
  type BatchStep
} from '../src/main/linux/elevate'
import { mapPlatformDir } from '../src/main/linux/download'
import { detectLinuxOwnership } from '../src/main/linux/service'
import { buildRunnerScript } from '../src/main/linux/service'
import { isLinuxPlatform, isWindowsPlatform, dpiEngineBinary } from '../src/main/linux/platform'

const EXAMPLE_BAT = path.join(process.cwd(), 'bundled-assets', 'bat', 'general_nix1.bat')
const GENERATED_JSON = path.join(process.cwd(), 'bundled-assets', 'strategies', 'general_nix1.json')

// init-system is mocked for the startLinuxService self-heal tests below
// (no root, no real systemctl); pure builders keep working via spread.
const startMocks = vi.hoisted(() => ({
  unitState: 'NOT_INSTALLED' as ServiceState
}))

vi.mock('../src/main/linux/init-system', async (importOriginal: () => Promise<typeof import('../src/main/linux/init-system')>) => {
  const orig = await importOriginal()
  return {
    ...orig,
    detectInitSystem: async (): Promise<InitSystem> => 'systemd',
    queryLinuxServiceState: async (): Promise<ServiceState> => startMocks.unitState
  }
})

// runBatch is mocked for composition tests (assert the assembled steps);
// pure elevate helpers keep working via spread.
const batchMocks = vi.hoisted(() => ({
  runBatch: vi.fn(async (..._args: unknown[]) => ({ stdout: '', stderr: '', code: 0, failedStep: null }))
}))

vi.mock('../src/main/linux/elevate', async (importOriginal: () => Promise<typeof import('../src/main/linux/elevate')>) => {
  const orig = await importOriginal()
  return {
    ...orig,
    runBatch: batchMocks.runBatch,
    // Deterministic verify path on any CI (otherwise a NOPASSWD Linux
    // runner would take the journal-context branch = extra runBatch call).
    canElevateWithoutPassword: async (): Promise<boolean> => false
  }
})

// `pgrep` is faked so `isNfqwsRunning()` answers instantly (found) without
// root; everything else passes through to the real execFile.
vi.mock('node:child_process', async (importOriginal: () => Promise<typeof import('node:child_process')>) => {
  const orig = await importOriginal()
  type Cb = (error: unknown, stdout: unknown, stderr: unknown) => void
  const fakeExecFile = (file: unknown, args: unknown, opts?: unknown, callback?: Cb): unknown => {
    const cb = (typeof opts === 'function' ? (opts as Cb) : callback) as Cb | undefined
    if (String(file) === 'pgrep') {
      queueMicrotask(() => cb?.(null, '4242\n', ''))
      return { on: () => undefined, kill: () => false, unref: () => undefined }
    }
    const realOpts = typeof opts === 'function' ? undefined : opts
    return (orig.execFile as (...a: unknown[]) => unknown)(file, args, realOpts, cb)
  }
  return {
    ...orig,
    execFile: fakeExecFile as unknown as typeof orig.execFile
  }
})

// Firewall reads are faked as present (deterministic post-start verify);
// pure step builders keep working via spread.
vi.mock('../src/main/linux/firewall', async (importOriginal: () => Promise<typeof import('../src/main/linux/firewall')>) => {
  const orig = await importOriginal()
  return {
    ...orig,
    detectFirewallBackend: async (): Promise<'nftables'> => 'nftables',
    isFirewallActive: async (): Promise<boolean> => true,
    listAvailableBackends: async (): Promise<Array<'nftables' | 'iptables'>> => []
  }
})

describe('platform helpers', () => {
  it('detects linux vs windows', () => {
    expect(isLinuxPlatform('linux')).toBe(true)
    expect(isLinuxPlatform('win32')).toBe(false)
    expect(isWindowsPlatform('win32')).toBe(true)
    expect(isWindowsPlatform('linux')).toBe(false)
  })
  it('picks the engine binary per OS', () => {
    expect(dpiEngineBinary('linux')).toBe('nfqws')
    expect(dpiEngineBinary('win32')).toBe('winws.exe')
  })
})

describe('conf.env', () => {
  it('round-trips through serialize/parse', () => {
    const conf = { interface: 'eth0', gamefiltertcp: true, gamefilterudp: false, strategy: 'general.bat', firewall_backend: 'nftables' as const }
    expect(parseConfEnv(serializeConfEnv(conf))).toEqual(conf)
  })
  it('defaults a missing firewall_backend to auto', () => {
    const conf = parseConfEnv('interface=any\ngamefiltertcp=false\ngamefilterudp=false\nstrategy=general.bat\n')
    expect(conf.firewall_backend).toBe('auto')
  })
  it('allows an empty strategy (preferences saved before the first Apply)', () => {
    const conf = parseConfEnv('interface=eth0\ngamefiltertcp=false\ngamefilterudp=false\nstrategy=\nfirewall_backend=nftables\n')
    expect(conf.strategy).toBe('')
    expect(conf.interface).toBe('eth0')
    expect(conf.firewall_backend).toBe('nftables')
    // Missing strategy line entirely behaves the same.
    const conf2 = parseConfEnv('interface=any\ngamefiltertcp=true\ngamefilterudp=false\n')
    expect(conf2.strategy).toBe('')
    // Partial conf round-trips (interface/backend pickers work pre-Apply).
    const partial = { interface: 'any', gamefiltertcp: false, gamefilterudp: false, strategy: '', firewall_backend: 'iptables' as const }
    expect(parseConfEnv(serializeConfEnv(partial))).toEqual(partial)
  })
  it('throws on missing required fields', () => {
    expect(() => parseConfEnv('interface=any\n')).toThrow()
  })
  it('normalizes strategy file names', () => {
    expect(normalizeStrategyFileName('general')).toBe('general.bat')
    expect(normalizeStrategyFileName('general.bat')).toBe('general.bat')
  })
  it('validates interface names', () => {
    expect(isValidInterfaceName('any')).toBe(true)
    expect(isValidInterfaceName('eth0')).toBe(true)
    expect(isValidInterfaceName('eth0;rm')).toBe(false)
  })
  it('resolves the data dir owner for the nfqws --uid pin', async () => {
    const { resolveDataOwnerUid } = await import('../src/main/linux/config')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-owner-'))
    try {
      const st = fs.statSync(dir)
      expect(resolveDataOwnerUid(dir)).toBe(`${st.uid}:${st.gid}`)
      // Missing dir falls back to the process owner, never throws.
      expect(resolveDataOwnerUid(path.join(dir, 'nope'))).toMatch(/^\d+:\d+$/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('game filter substitution (common.sh parity)', () => {
  it('substitutes full range when enabled', () => {
    const out = applyGameFilterSubstitution('--wf-tcp=80,%GameFilterTCP% --wf-udp=443,%GameFilterUDP%', {
      useGameFilterTcp: true,
      useGameFilterUdp: true
    })
    expect(out).toContain('1024-65535')
  })
  it('uses the OFF ports for the disabled side', () => {
    const out = applyGameFilterSubstitution('--wf-tcp=80,%GameFilterTCP% --wf-udp=443,%GameFilterUDP%', {
      useGameFilterTcp: true,
      useGameFilterUdp: false
    })
    expect(out).toContain('1024-65535')
    expect(out).toContain(',12')
  })
  it('strips placeholders when fully disabled', () => {
    const out = applyGameFilterSubstitution('--wf-tcp=80,%GameFilterTCP% --wf-udp=443,%GameFilterUDP%', {
      useGameFilterTcp: false,
      useGameFilterUdp: false
    })
    expect(out).toBe('--wf-tcp=80 --wf-udp=443')
  })
})

describe('parseBatForLinux (bundled general_nix1.bat)', () => {
  it('extracts wf ports and filter blocks', () => {
    const content = fs.readFileSync(EXAMPLE_BAT, 'utf8')
    const parsed = parseBatForLinux(content, { useGameFilterTcp: false, useGameFilterUdp: false })
    expect(parsed.tcpPorts).toContain('80')
    expect(parsed.tcpPorts).toContain('443')
    expect(parsed.udpPorts).toContain('443')
    expect(parsed.nfqwsParams.length).toBeGreaterThan(3)
    expect(parsed.nfqwsParams[0]).toMatch(/--filter-(tcp|udp)=/)
  })
  it('throws when wf ports are missing', () => {
    expect(() => parseBatForLinux('start winws.exe --filter-tcp=80 --dpi-desync=fake', { useGameFilterTcp: false, useGameFilterUdp: false })).toThrow()
  })
})

describe('parseStrategyArgsForLinux (bundled JSON configs)', () => {
  it('parses the generated general_nix1 config', () => {
    const strategy = JSON.parse(fs.readFileSync(GENERATED_JSON, 'utf8')) as { args: string[] }
    const parsed = parseStrategyArgsForLinux(strategy.args, { useGameFilterTcp: false, useGameFilterUdp: false })
    expect(parsed.tcpPorts).toContain('80')
    expect(parsed.udpPorts).toContain('443')
    expect(parsed.nfqwsParams.length).toBeGreaterThan(0)
  })
  it('builds nfqws argv with fwmark + qnum', () => {
    const strategy = JSON.parse(fs.readFileSync(GENERATED_JSON, 'utf8')) as { args: string[] }
    const parsed = parseStrategyArgsForLinux(strategy.args, { useGameFilterTcp: true, useGameFilterUdp: true })
    const argv = buildNfqwsArgv(parsed, { binDir: '/data/bin', listsDir: '/data/lists', daemon: true })
    expect(argv[0]).toBe('--daemon')
    expect(argv).toContain('--dpi-desync-fwmark=0x40000000')
    expect(argv).toContain('--qnum=220')
    // Stay-root pin: without it nfqws drops to UID 2147483647 and cannot
    // read lists under $HOME (Permission denied → exit 1 → restart loop).
    expect(argv).toContain('--uid=0:0')
    // No placeholders survive materialization.
    expect(argv.join(' ')).not.toContain('<BIN>')
    expect(argv.join(' ')).not.toContain('<LISTS>')
  })
  it('pins nfqws to stay root unless the strategy already sets --user/--uid', () => {
    const base = { tcpPorts: '80', udpPorts: '443', nfqwsParams: ['--filter-tcp=80 --dpi-desync=fake'], warnings: [] }
    // Last-resort default without an owner (callers pass runUid).
    expect(buildNfqwsArgv(base, { binDir: '/d/bin', listsDir: '/d/lists' })).toContain('--uid=0:0')
    // Production path: run as the data dir owner (root loses CAP_DAC_OVERRIDE
    // after dropcaps and cannot read a 700 $HOME either).
    expect(
      buildNfqwsArgv(base, { binDir: '/d/bin', listsDir: '/d/lists', runUid: '1000:1000' })
    ).toContain('--uid=1000:1000')
    const withUser = {
      ...base,
      nfqwsParams: ['--filter-tcp=80 --user=nobody --dpi-desync=fake']
    }
    const argvUser = buildNfqwsArgv(withUser, { binDir: '/d/bin', listsDir: '/d/lists', runUid: '1000:1000' })
    expect(argvUser).toContain('--user=nobody')
    expect(argvUser).not.toContain('--uid=')
    const withUid = {
      ...base,
      nfqwsParams: ['--filter-tcp=80 --uid=1000:1000 --dpi-desync=fake']
    }
    const argvUid = buildNfqwsArgv(withUid, { binDir: '/d/bin', listsDir: '/d/lists', runUid: '1000:1000' })
    expect(argvUid).toContain('--uid=1000:1000')
    expect(argvUid.filter((a) => a.startsWith('--uid='))).toHaveLength(1)
  })
  it('materializes placeholders to real dirs (exact, no doubling/quotes)', () => {
    const argv = materializeNfqwsArgv(['--filter-tcp=80 --hostlist="<LISTS>/list-general.txt"'], {
      binDir: '/d/bin',
      listsDir: '/d/lists'
    })
    expect(argv).toEqual(['--filter-tcp=80', '--hostlist=/d/lists/list-general.txt'])
  })
  it('regression: no doubled segments or literal quotes (issue: /data/root/.../lists/...)', () => {
    const binDir = '/root/.config/zapret-gui/data/bin'
    const listsDir = '/root/.config/zapret-gui/data/lists'
    const argv = materializeNfqwsArgv(
      [
        '--filter-udp=443 --hostlist="<LISTS>/list-general.txt" --ipset-exclude="<LISTS>/ipset-exclude.txt" --dpi-desync=fake'
      ],
      { binDir, listsDir }
    )
    expect(argv).toEqual([
      '--filter-udp=443',
      '--hostlist=/root/.config/zapret-gui/data/lists/list-general.txt',
      '--ipset-exclude=/root/.config/zapret-gui/data/lists/ipset-exclude.txt',
      '--dpi-desync=fake'
    ])
    for (const a of argv) {
      expect(a).not.toContain('"')
      expect(a).not.toContain('data/root')
    }
  })
  it('prefixes bare relative bin/lists (raw .bat %BIN%/%LISTS% forms) exactly once', () => {
    const argv = materializeNfqwsArgv(
      ['--filter-tcp=80 --hostlist-exclude="lists/list-exclude.txt" --dpi-desync-fake-tls="bin/tls_clienthello_www_google_com.bin"'],
      { binDir: '/d/bin', listsDir: '/d/lists' }
    )
    expect(argv).toEqual([
      '--filter-tcp=80',
      '--hostlist-exclude=/d/lists/list-exclude.txt',
      '--dpi-desync-fake-tls=/d/bin/tls_clienthello_www_google_com.bin'
    ])
  })
})

describe('firewall builders', () => {
  it('builds nft rules with mark + queue + bypass', () => {
    const cmds = buildNftSetupCommands({ tcp: '80,443', udp: '443', interface: 'eth0' })
    const flat = cmds.map((c) => c.join(' ')).join('\n')
    expect(flat).toContain('0x40000000')
    expect(flat).toContain('220')
    expect(flat).toContain('bypass')
    expect(flat).toContain('oifname')
  })
  it('omits interface clauses for "any"', () => {
    const cmds = buildNftSetupCommands({ tcp: '80', udp: '443', interface: 'any' })
    expect(cmds.map((c) => c.join(' ')).join('\n')).not.toContain('oifname')
  })
  it('builds iptables NFQUEUE rules', () => {
    const steps = buildIptablesSetupCommands({ tcp: '80,443', udp: '443', interface: 'any' })
    const flat = steps.map((s) => `${s.cmd} ${s.args.join(' ')}`).join('\n')
    expect(flat).toContain('NFQUEUE')
    expect(flat).toContain('--queue-num 220')
    expect(flat).toContain('iptables')
    expect(flat).toContain('ip6tables')
  })
  it('converts nft ranges to iptables syntax', () => {
    expect(toIptablesPorts('{80,443,1024-65535}')).toBe('80,443,1024:65535')
  })
})

describe('init-system builders', () => {
  it('builds a systemd unit around the runner', () => {
    const unit = buildSystemdUnit({ runnerPath: '/data/zapret-linux-run.sh', workDir: '/data' })
    expect(unit).toContain('ExecStart=/usr/bin/env bash /data/zapret-linux-run.sh daemon')
    expect(unit).toContain('WantedBy=multi-user.target')
    // A broken strategy must not churn restarts forever (counter hit 550+).
    expect(unit).toContain('StartLimitBurst=')
  })
  it('waits on network.target, not network-online.target (hangs desktops)', () => {
    const unit = buildSystemdUnit({ runnerPath: '/data/run.sh', workDir: '/data' })
    expect(unit).toContain('After=network.target')
    expect(unit).not.toContain('network-online')
  })
  it('parses systemctl show details (start-failure forensics)', () => {
    expect(
      parseSystemdShow(
        'ActiveState=activating\nSubState=start\nResult=success\nExecMainStatus=0\nNRestarts=3\nMainPID=0\n'
      )
    ).toEqual({
      activeState: 'activating',
      subState: 'start',
      result: 'success',
      execMainStatus: '0',
      nRestarts: 3,
      mainPid: 0
    })
    expect(parseSystemdShow('')).toEqual({
      activeState: '',
      subState: '',
      result: '',
      execMainStatus: '',
      nRestarts: 0,
      mainPid: 0
    })
  })
  it('builds a dinit service', () => {
    expect(buildDinitConf({ runnerPath: '/data/run.sh' })).toContain('type = process')
  })
  it('maps service locations per init', () => {
    expect(serviceLocation('systemd')).toBe('/etc/systemd/system/zapret_discord_youtube.service')
    expect(serviceLocation('openrc')).toBe('/etc/init.d/zapret_discord_youtube')
    expect(serviceLocation('unknown')).toBe('')
  })
})

describe('permissions content', () => {
  it('generates sudoers NOPASSWD for nft/iptables/nfqws/pkill', () => {
    const content = buildSudoersContent('alice', '/data/bin/nfqws')
    expect(content).toContain('alice ALL=(root) NOPASSWD:')
    expect(content).toContain('/data/bin/nfqws')
    // `-x` (exact process name): `-f` would also match our own
    // `pkexec bash -c '...nfqws...'` wrapper and suicide the batch.
    expect(content).toContain('pkill -x nfqws')
    expect(content).not.toContain('pkill -f nfqws')
  })
  it('generates doas rules', () => {
    const rules = buildDoasRules('bob', '/data/bin/nfqws')
    expect(rules).toContain('permit nopass bob as root cmd /data/bin/nfqws')
    expect(rules).toContain('pkill args -x nfqws')
  })
  it('covers service management for silent per-call elevation (no whole-app root)', () => {
    const content = buildSudoersContent('alice', '/data/bin/nfqws', {
      systemctlPath: '/usr/bin/systemctl',
      teePath: '/usr/bin/tee',
      chmodPath: '/usr/bin/chmod',
      mkdirPath: '/usr/bin/mkdir',
      rmPath: '/usr/bin/rm',
      visudoPath: '/usr/sbin/visudo',
      bashPath: '/usr/bin/bash',
      runnerPath: '/home/alice/.config/zapret-gui/data/zapret-linux-run.sh',
      extraTeePaths: ['/etc/hosts', '/etc/hosts.zapret-gui.bak']
    })
    // init service control
    expect(content).toContain('/usr/bin/systemctl daemon-reload')
    expect(content).toContain('/usr/bin/systemctl restart zapret_discord_youtube')
    expect(content).toContain('/usr/bin/systemctl start zapret_discord_youtube')
    // service-file installs via tee + chmod (no shell quoting pitfalls)
    expect(content).toContain('/usr/bin/tee /etc/systemd/system/zapret_discord_youtube.service')
    expect(content).toContain('/usr/bin/chmod 0644 /etc/systemd/system/zapret_discord_youtube.service')
    expect(content).toContain('/usr/bin/chmod 0755 /etc/systemd/system/zapret_discord_youtube.service')
    expect(content).toContain('/usr/bin/mkdir -p /etc/sv/zapret_discord_youtube')
    expect(content).toContain('/usr/bin/rm -f /etc/systemd/system/zapret_discord_youtube.service')
    // self-check + no-init runner + hosts
    expect(content).toContain('/usr/sbin/visudo -c -f /etc/sudoers.d/zapret')
    expect(content).toContain('/usr/bin/bash /home/alice/.config/zapret-gui/data/zapret-linux-run.sh daemon')
    expect(content).toContain('/usr/bin/tee /etc/hosts')
    expect(content).toContain('/usr/bin/tee /etc/hosts.zapret-gui.bak')
  })
  it('covers its own rules file and read-only failure diagnostics', () => {
    const content = buildSudoersContent('alice', '/data/bin/nfqws', {
      journalctlPath: '/usr/bin/journalctl'
    })
    expect(content).toContain('/usr/bin/tee /etc/sudoers.d/zapret')
    expect(content).toContain('/usr/bin/chmod 0440 /etc/sudoers.d/zapret')
    expect(content).toContain('/usr/bin/rm -f /etc/sudoers.d/zapret')
    expect(content).toContain('/usr/bin/systemctl status zapret_discord_youtube --no-pager')
    expect(content).toContain('/usr/bin/journalctl --no-pager -n 40 -u zapret_discord_youtube')
  })
  it('emits /usr-merged path variants so sudo string-matching succeeds', () => {
    const content = buildSudoersContent('alice', '/data/bin/nfqws', { systemctlPath: '/usr/bin/systemctl' })
    expect(content).toContain('/usr/bin/systemctl daemon-reload')
    expect(content).toContain('/bin/systemctl daemon-reload')
  })
  it('extends doas rules with service binaries', () => {
    const rules = buildDoasRules('bob', '/data/bin/nfqws', { extraBins: ['/usr/bin/systemctl', '/usr/bin/tee'] })
    expect(rules).toContain('permit nopass bob as root cmd /usr/bin/systemctl')
    expect(rules).toContain('permit nopass bob as root cmd /usr/bin/tee')
  })
})

describe('per-call elevation helpers (pure parts)', () => {
  it('classifies sudo/doas auth failures (pkexec fallback) vs command errors', () => {
    expect(isAuthFailure('sudo: a password is required')).toBe(true)
    expect(isAuthFailure('sudo: no tty present and no askpass program specified')).toBe(true)
    expect(isAuthFailure('sudo: a terminal is required to read the password')).toBe(true)
    expect(isAuthFailure('alice is not in the sudoers file. This incident will be reported')).toBe(true)
    expect(isAuthFailure('doas: operation not permitted')).toBe(true)
    // Localized sudo (seen on ru Fedora: `sudo: требуется указать пароль`).
    expect(isAuthFailure('sudo: требуется указать пароль')).toBe(true)
    expect(isAuthFailure('sudo: нужно ввести пароль')).toBe(true)
    expect(isAuthFailure('bob отсутствует в файле sudoers')).toBe(true)
    expect(isAuthFailure('sudo: для чтения пароля требуется терминал')).toBe(true)
    // Genuine command failures must NOT trigger a password prompt.
    expect(isAuthFailure('nft: syntax error at line 1')).toBe(false)
    expect(isAuthFailure('')).toBe(false)
    expect(isAuthFailure('systemctl: Unit zapret_discord_youtube.service not found')).toBe(false)
  })
  it('builds merged-/usr path variants', () => {
    expect(withPathVariants('/usr/bin/systemctl')).toEqual(['/usr/bin/systemctl', '/bin/systemctl'])
    expect(withPathVariants('/usr/sbin/nft')).toEqual(['/usr/sbin/nft', '/sbin/nft'])
    expect(withPathVariants('/bin/ls')).toEqual(['/bin/ls', '/usr/bin/ls'])
    expect(withPathVariants('/opt/custom/bin')).toEqual(['/opt/custom/bin'])
  })
  it('explains missing elevation tools', () => {
    expect(noAuthMessage()).toContain('pkexec')
  })
})

describe('download platform mapping', () => {
  it('maps node arch names to zapret binary dirs', () => {
    expect(mapPlatformDir('Linux', 'x64')).toBe('linux-x86_64')
    expect(mapPlatformDir('Linux', 'arm64')).toBe('linux-arm64')
    expect(mapPlatformDir('Linux', 'arm')).toBe('linux-arm')
  })
  it('rejects unknown arches', () => {
    expect(() => mapPlatformDir('Linux', 'sparc')).toThrow()
  })
})

describe('windows engine platform mapping', () => {
  it('maps x64/ia32 to zapret windows dirs', async () => {
    const { mapWindowsPlatformDir } = await import('../src/main/win-engine')
    expect(mapWindowsPlatformDir('x64')).toBe('windows-x86_64')
    expect(mapWindowsPlatformDir('ia32')).toBe('windows-x86')
    expect(() => mapWindowsPlatformDir('arm64')).toThrow()
  })
})

describe('linux ownership', () => {
  it('reports none when nothing is installed', () => {
    expect(detectLinuxOwnership('NOT_INSTALLED', false, null, '/data/bin')).toBe('none')
  })
  it('reports ours for our own bin dir', () => {
    expect(detectLinuxOwnership('RUNNING', true, '/data/bin/nfqws', '/data/bin')).toBe('ours')
  })
  it('reports foreign for other paths', () => {
    expect(detectLinuxOwnership('RUNNING', true, '/opt/other/nfqws', '/data/bin')).toBe('foreign')
  })
})

describe('runner script', () => {  it('embeds daemon/kill modes, firewall setup and nfqws argv', () => {
    const script = buildRunnerScript({
      nfqwsPath: '/data/bin/nfqws',
      binDir: '/data/bin',
      listsDir: '/data/lists',
      tcpPorts: '80,443',
      udpPorts: '443',
      interface: 'eth0',
      firewallBackend: 'nftables',
      nfqwsArgv: ['--dpi-desync-fwmark=0x40000000', '--qnum=220', '--uid=1000:1000', '--filter-tcp=80'],
      logPath: '/data/zapret-linux-run.log'
    })
    expect(script).toContain('daemon)')
    expect(script).toContain('kill)')
    expect(script).toContain('/data/bin/nfqws')
    expect(script).toContain('nft_setup')
    expect(script).toContain('--filter-tcp=80')
    expect(script).toContain('queue num 220')
    // Failures are echoed to stderr (captured by the systemd journal).
    expect(script).toContain('zapret-linux-run: firewall setup FAILED')
    // Foreground by design: the runner is the supervised main process
    // (Type=simple) — a --daemon double-fork could never stay active.
    expect(script).toContain('NFQWS_ARGV=(')
    expect(script).toContain('exec "$NFQWS" "${NFQWS_ARGV[@]}"')
    expect(script).not.toContain(`elevate "$NFQWS"`)
    expect(script).not.toContain(`'--daemon'`)
    // Exact-name pkill: `-f` would match our own wrapper cmdline.
    expect(script).toContain('pkill -x nfqws')
    expect(script).not.toContain('pkill -f nfqws')
    // Runner-owned log: mirrored stdout/stderr, readable without root.
    expect(script).toContain(`RUN_LOG='/data/zapret-linux-run.log'`)
    expect(script).toContain('log_start truncate')
    expect(script).toContain('exec >>"$RUN_LOG" 2>&1')
  })

  it('reads the runner log tail without privileges (null when absent)', async () => {
    const { readRunnerLogTail, getLinuxRunnerLogPath } = await import('../src/main/linux/service')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-runlog-'))
    try {
      expect(readRunnerLogTail(dir)).toBeNull()
      expect(getLinuxRunnerLogPath(dir)).toBe(path.join(dir, 'zapret-linux-run.log'))
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
      fs.writeFileSync(getLinuxRunnerLogPath(dir), lines, 'utf8')
      const tail = readRunnerLogTail(dir)
      expect(tail).not.toBeNull()
      expect(tail).toContain('line 99')
      expect(tail).not.toContain('line 0\n')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('bundled offline nfqws (bundled-assets/bin-linux)', () => {
  const bundled = path.join(process.cwd(), 'bundled-assets', 'bin-linux')
  // Desktop 32/64-bit platforms shipped offline (see README + download-engine-bins.mjs).
  const selectable = ['linux-x86_64', 'linux-x86']
  it.each(selectable)('ships nfqws for %s', (plat) => {
    const p = path.join(bundled, plat, 'nfqws')
    const st = fs.statSync(p)
    expect(st.size).toBeGreaterThan(10000)
  })
  it('ships the v72.13 winws.exe for Windows', () => {
    const st = fs.statSync(path.join(process.cwd(), 'bundled-assets', 'bin', 'winws.exe'))
    expect(st.size).toBeGreaterThan(100000)
  })
})

describe('seedLinuxNfqws', () => {
  it('copies the bundled engine for an explicit platform and keeps the exec bit', async () => {
    const { seedLinuxNfqws } = await import('../src/main/paths')
    const bundled = path.join(process.cwd(), 'bundled-assets')
    const dataBin = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-seed-'))
    const dest = seedLinuxNfqws(bundled, dataBin, 'linux-x86_64')
    expect(dest).toBe(path.join(dataBin, 'nfqws'))
    expect(fs.statSync(dest as string).size).toBeGreaterThan(10000)
    fs.rmSync(dataBin, { recursive: true, force: true })
  })
  it('never overwrites an existing (e.g. newer, user-fetched) binary', async () => {
    const { seedLinuxNfqws } = await import('../src/main/paths')
    const bundled = path.join(process.cwd(), 'bundled-assets')
    const dataBin = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-seed-'))
    const dest = path.join(dataBin, 'nfqws')
    fs.writeFileSync(dest, 'SENTINEL')
    seedLinuxNfqws(bundled, dataBin, 'linux-x86_64')
    expect(fs.readFileSync(dest, 'utf8')).toBe('SENTINEL')
    fs.rmSync(dataBin, { recursive: true, force: true })
  })
  it('returns null for an unknown platform dir', async () => {
    const { seedLinuxNfqws } = await import('../src/main/paths')
    const dataBin = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-seed-'))
    expect(seedLinuxNfqws(path.join(process.cwd(), 'bundled-assets'), dataBin, 'linux-nope')).toBeNull()
    fs.rmSync(dataBin, { recursive: true, force: true })
  })
})

describe('startLinuxService self-heal (missing unit, no root)', () => {
  beforeEach(() => {
    startMocks.unitState = 'NOT_INSTALLED'
    batchMocks.runBatch.mockClear()
  })

  function makeDataDir(withRunner: boolean, freshRunner = false): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-start-'))
    if (withRunner) {
      fs.writeFileSync(
        path.join(dir, 'zapret-linux-run.sh'),
        freshRunner
          ? '#!/usr/bin/env bash\n# Generated by Zapret GUI\nRUN_LOG=/tmp/x.log\nelevate "$NFQWS" --uid=1000:1000 --filter-tcp=80\n'
          : '#!/usr/bin/env bash\n',
        'utf8'
      )
    }
    // startLinuxService now fail-fasts on a missing/unloadable binary:
    // an empty file passes existence; ldd (or its absence) reports no
    // missing libs, so the dep check stays green deterministically.
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'bin', 'nfqws'), '', 'utf8')
    return dir
  }

  /**
   * `pgrep` is faked file-wide (see the `node:child_process` mock above),
   * so `isNfqwsRunning()` answers instantly without root.
   */
  function batchSteps(): BatchStep[] {
    const call = batchMocks.runBatch.mock.calls[0] as unknown[] | undefined
    return (call?.[0] ?? []) as BatchStep[]
  }

  it('reinstalls the unit from the stored runner in ONE batch instead of failing `Unit not found`', async () => {
    const { startLinuxService, getLinuxRunnerPath } = await import('../src/main/linux/service')
    const dir = makeDataDir(true)
    try {
      const logs: string[] = []
      // The mocked unit stays NOT_INSTALLED, so post-start verification
      // reports it — while proving reinstall composition happened first.
      await expect(startLinuxService(dir, (t) => logs.push(t))).rejects.toThrow('service state is NOT_INSTALLED')
      // Exactly one elevated batch (i.e. a single auth prompt).
      expect(batchMocks.runBatch).toHaveBeenCalledTimes(1)
      const steps = batchSteps()
      const writes = steps.filter((s) => s.kind === 'write')
      expect(writes.map((s) => (s.kind === 'write' ? s.dest : ''))).toContain(
        '/etc/systemd/system/zapret_discord_youtube.service'
      )
      const last = steps[steps.length - 1]
      expect(last).toMatchObject({ kind: 'exec', file: 'systemctl', args: ['start', 'zapret_discord_youtube'] })
      expect(getLinuxRunnerPath(dir)).toBe(path.join(dir, 'zapret-linux-run.sh'))
      expect(logs.join('\n')).toContain('reinstalling')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts with a single-step batch when the unit exists (no reinstall)', async () => {
    startMocks.unitState = 'RUNNING'
    const { startLinuxService } = await import('../src/main/linux/service')
    const { buildSystemdUnit } = await import('../src/main/linux/init-system')
    const dir = makeDataDir(true, true)
    // Hermetic unit check: the real /etc/systemd/system/*.service may exist
    // on dev machines (with unrelated content) and would otherwise force a
    // reinstall. Pretend the on-disk unit already matches.
    const origRead = fs.readFileSync
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (typeof p === 'string' && p.startsWith('/etc/systemd/system/')) {
        const runner = path.join(dir, 'zapret-linux-run.sh')
        return buildSystemdUnit({ runnerPath: runner, workDir: dir })
      }
      return (origRead as (...a: unknown[]) => unknown)(p, ...(rest as []))
    }) as typeof fs.readFileSync)
    try {
      const logs: string[] = []
      await startLinuxService(dir, (t) => logs.push(t))
      expect(batchMocks.runBatch).toHaveBeenCalledTimes(1)
      const steps = batchSteps()
      expect(steps).toHaveLength(1)
      expect(steps[0]).toMatchObject({ kind: 'exec', file: 'systemctl', args: ['start', 'zapret_discord_youtube'] })
      expect(logs.join('\n')).toContain('Service started.')
    } finally {
      readSpy.mockRestore()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('asks to apply a strategy when neither unit nor runner exist', async () => {
    const { startLinuxService } = await import('../src/main/linux/service')
    const dir = makeDataDir(false)
    try {
      await expect(startLinuxService(dir)).rejects.toThrow('apply a strategy')
      expect(batchMocks.runBatch).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('start fails fast when the binary is missing (no prompts, no loop)', async () => {
    const { startLinuxService } = await import('../src/main/linux/service')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-start-'))
    try {
      await expect(startLinuxService(dir)).rejects.toThrow('nfqws not found')
      expect(batchMocks.runBatch).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('privilege batching (one auth prompt per operation)', () => {
  it('serializes batches through the priv lock (never two prompts at once)', async () => {
    const lock = createPrivLock()
    const order: string[] = []
    const gate = (): Promise<void> => new Promise((res) => setTimeout(res, 20))
    const a = lock(async () => {
      order.push('a-start')
      await gate()
      order.push('a-end')
      return 'a'
    })
    const b = lock(async () => {
      order.push('b-start')
      await gate()
      order.push('b-end')
      return 'b'
    })
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b'])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('releases the priv lock when the holder throws', async () => {
    const lock = createPrivLock()
    await expect(
      lock(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await expect(lock(async () => 'next')).resolves.toBe('next')
  })

  it('notifies waiters via onLog without breaking the lock when it throws', async () => {
    const lock = createPrivLock()
    const lines: string[] = []
    const gate = (): Promise<void> => new Promise((res) => setTimeout(res, 20))
    const a = lock(async () => {
      await gate()
      return 'a'
    })
    const b = lock(
      async () => 'b',
      (l) => {
        lines.push(l)
        throw new Error('log boom')
      }
    )
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b'])
    expect(lines).toHaveLength(1)
  })

  it('labels steps for logs by default', () => {
    expect(batchStepLabel({ kind: 'exec', file: 'nft', args: ['list', 'tables'] })).toBe('nft list tables')
    expect(batchStepLabel({ kind: 'write', dest: '/etc/hosts', content: 'x', mode: '0644' })).toBe('write /etc/hosts')
    expect(batchStepLabel({ kind: 'write', dest: '/etc/doas.conf', content: 'x', append: true })).toBe('append /etc/doas.conf')
    expect(batchStepLabel({ kind: 'exec', file: 'x', args: [], label: 'custom' })).toBe('custom')
  })

  it('renders fatal steps with FAIL markers and best-effort steps with `|| true`', () => {
    const script = buildBatchScript([
      { kind: 'exec', file: 'nft', args: ['add', 'table', 'inet', 'zapretunix'] },
      { kind: 'exec', file: 'pkill', args: ['-f', 'nfqws'], ignoreFailure: true }
    ])
    expect(script).toContain('ZAPRET_BATCH_STEP 0')
    expect(script).toContain('ZAPRET_BATCH_STEP 1')
    expect(script).toContain('ZAPRET_BATCH_FAIL 0')
    expect(script).not.toContain('ZAPRET_BATCH_FAIL 1')
    expect(script).toContain('|| true')
    expect(script).toContain('exit 42')
    expect(script).toContain('nft add table inet zapretunix')
    // Unsafe argv entries are shell-quoted (nft chain specs use braces).
    const braced = buildBatchScript([{ kind: 'exec', file: 'nft', args: ['add', 'chain', 'inet', 'x', 'post', '{', 'type', 'filter', '}'] }])
    expect(braced).toContain(`'{'`)
  })

  it('renders file writes as base64 pipe + chmod (no quoting pitfalls)', () => {
    const script = buildBatchScript([{ kind: 'write', dest: '/etc/sudoers.d/zapret', content: "a'b\n$c", mode: '0440' }])
    expect(script).toContain(`| base64 -d > /etc/sudoers.d/zapret`)
    expect(script).toContain(`chmod 0440 /etc/sudoers.d/zapret`)
    // No raw quotes from the content leak into the script.
    expect(script).not.toContain(`a'b`)
  })

  it('renders appends without chmod (existing file keeps its mode)', () => {
    const script = buildBatchScript([{ kind: 'write', dest: '/etc/doas.conf', content: 'x', append: true }])
    expect(script).toContain('>>')
    expect(script).not.toContain('chmod')
  })

  it('filters protocol lines out of streamed output (incl. split chunks)', () => {
    const seen: Array<{ kind: string; index: number }> = []
    const f = new BatchMarkerFilter((m) => seen.push({ kind: m.kind, index: m.index }))
    expect(f.push('nft ok\nZAPRET_BATCH_STEP 3\nmore\n')).toBe('nft ok\nmore\n')
    // A marker split across two chunks still parses once complete.
    expect(f.push('ZAPRET_BATCH_ST')).toBe('')
    expect(f.push('EP 4\ntail\n')).toBe('tail\n')
    expect(f.flush()).toBe('')
    expect(seen).toEqual([
      { kind: 'step', index: 3 },
      { kind: 'step', index: 4 }
    ])
    const f2 = new BatchMarkerFilter()
    expect(f2.push('err\nZAPRET_BATCH_FAIL 2\n')).toBe('err\n')
    expect(f2.flush()).toBe('')
  })

  it('builds nft setup steps: best-effort clear first, fatal rules after', () => {
    const steps = buildNftSetupSteps({ tcp: '80,443', udp: '443', interface: 'any' })
    expect(steps.length).toBeGreaterThan(5)
    expect(steps.slice(0, 5).every((s) => s.ignoreFailure === true)).toBe(true)
    expect(steps.slice(5).every((s) => s.ignoreFailure !== true)).toBe(true)
    expect(steps[5]).toMatchObject({ kind: 'exec', file: 'nft' })
  })

  it('builds firewall clear steps for both backends (all best-effort)', () => {
    for (const b of ['nftables', 'iptables'] as const) {
      const steps = buildFirewallClearSteps(b)
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.every((s) => s.ignoreFailure === true)).toBe(true)
    }
    expect(buildFirewallSetupSteps('iptables', { tcp: '80', udp: '443', interface: 'any' })[0]).toMatchObject({
      kind: 'exec',
      file: 'iptables'
    })
  })

  it('builds iptables setup steps with cleanup best-effort and rules fatal', () => {
    const steps = buildIptablesSetupSteps({ tcp: '80', udp: '443', interface: 'any' })
    const first = steps[0]
    expect(first?.ignoreFailure).toBe(true)
    const rule = steps.find((s) => s.kind === 'exec' && s.args.includes('NFQUEUE'))
    expect(rule?.ignoreFailure).not.toBe(true)
  })

  it('builds systemd install steps ending with restart, with unit write first', () => {
    const steps = buildInstallSteps('systemd', { runnerPath: '/data/run.sh', workDir: '/data' })
    expect(steps[0]).toMatchObject({ kind: 'write', dest: '/etc/systemd/system/zapret_discord_youtube.service' })
    const last = steps[steps.length - 1]
    expect(last).toMatchObject({ kind: 'exec', file: 'systemctl', args: ['restart', 'zapret_discord_youtube'] })
  })

  it('builds start/stop/remove steps per init (unknown throws)', () => {
    expect(buildStartSteps('systemd')).toEqual([{ kind: 'exec', file: 'systemctl', args: ['start', 'zapret_discord_youtube'] }])
    expect(buildStopSteps('openrc')).toEqual([{ kind: 'exec', file: 'rc-service', args: ['zapret_discord_youtube', 'stop'] }])
    const rm = buildRemoveSteps('systemd')
    expect(rm[0]).toMatchObject({ ignoreFailure: true })
    expect(rm[2]).toMatchObject({ kind: 'exec', file: 'rm', args: ['-f', '/etc/systemd/system/zapret_discord_youtube.service'] })
    expect(() => buildStartSteps('unknown')).toThrow()
    expect(() => buildInstallSteps('unknown', { runnerPath: '/x', workDir: '/y' })).toThrow()
  })
})

describe('nfqws shared-library deps (Fedora root cause)', () => {
  it('keeps short output intact but preserves the failure tail', async () => {
    const { tailText } = await import('../src/main/linux/elevate')
    expect(tailText('  short output  ')).toBe('short output')
    const long = `${'banner\n'.repeat(200)}real error: cannot open /x\n`
    const cut = tailText(long, 1200, 200)
    expect(cut).toContain('real error: cannot open /x')
    expect(cut).toContain('chars skipped')
    expect(cut.length).toBeLessThan(long.length)
  })
  it('extracts absolute file refs from nfqws argv (skips numbers/keywords)', async () => {
    const { extractNfqwsFileRefs, missingFiles } = await import('../src/main/linux/service')
    expect(
      extractNfqwsFileRefs([
        '--daemon',
        '--filter-tcp=80',
        '--hostlist=/d/lists/list-general.txt',
        '--dpi-desync-fake-tls=/d/bin/fake.bin',
        '--qnum',
        '220',
        '--hostlist-exclude',
        '/d/lists/list-exclude.txt',
        '--dpi-desync=fake,multisplit'
      ])
    ).toEqual(['/d/lists/list-general.txt', '/d/bin/fake.bin', '/d/lists/list-exclude.txt'])
    expect(extractNfqwsFileRefs(['--hostlist=C:\\lists\\a.txt', '--filter-udp=443'])).toEqual([])
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-missing-'))
    try {
      const present = path.join(dir, 'a.txt')
      fs.writeFileSync(present, 'x', 'utf8')
      expect(missingFiles([present, path.join(dir, 'nope.txt')])).toEqual([path.join(dir, 'nope.txt')])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses ldd missing libraries', async () => {
    const { parseLddMissing, distroInstallHintFor } = await import('../src/main/linux/service')
    expect(
      parseLddMissing(
        '\tlinux-vdso.so.1 (0x00007fff)\n' +
          '\tlibnetfilter_queue.so.1 => not found\n' +
          '\tlibmnl.so.0 => /lib/x86_64-linux-gnu/libmnl.so.0 (0x123)\n' +
          '\tlibnetfilter_queue.so.1 => not found\n'
      )
    ).toEqual(['libnetfilter_queue.so.1'])
    expect(parseLddMissing('statically linked')).toEqual([])
    expect(parseLddMissing('')).toEqual([])
    expect(distroInstallHintFor).toBeDefined()
  })

  it('suggests the package manager per distro family', async () => {
    const { distroInstallHintFor } = await import('../src/main/linux/service')
    expect(distroInstallHintFor('fedora', '')).toContain('dnf')
    expect(distroInstallHintFor('ubuntu', 'debian')).toContain('apt')
    expect(distroInstallHintFor('', 'rhel centos')).toContain('dnf')
    expect(distroInstallHintFor('arch', '')).toContain('pacman')
    expect(distroInstallHintFor('alpine', '')).toContain('apk')
    expect(distroInstallHintFor('nixos', '')).toContain('libnetfilter_queue')
  })

  it('describes the binary identity (mode/owner/setuid)', async () => {
    const { describeNfqwsBinary, checkNfqwsLaunchable } = await import('../src/main/linux/service')
    expect(describeNfqwsBinary('/no/such/file')).toBeNull()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-bininfo-'))
    try {
      const p = path.join(dir, 'nfqws')
      fs.writeFileSync(p, 'x', 'utf8')
      const info = describeNfqwsBinary(p)
      expect(info).not.toBeNull()
      expect(info?.setuid).toBe(false)
      expect(info?.setgid).toBe(false)
      expect(info?.modeText).toMatch(/^-r/)
      // A plain file with no missing libs is launchable (ldd absent → optimistic).
      await expect(checkNfqwsLaunchable(p)).resolves.toMatchObject({ ok: true })
      await expect(checkNfqwsLaunchable(path.join(dir, 'missing'))).resolves.toMatchObject({ ok: true })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flags a setuid binary as not launchable (Fedora restart-loop trap)', async () => {
    if (process.platform === 'win32') return
    const { describeNfqwsBinary, checkNfqwsLaunchable } = await import('../src/main/linux/service')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-setuid-'))
    try {
      const p = path.join(dir, 'nfqws')
      fs.writeFileSync(p, 'x', 'utf8')
      fs.chmodSync(p, 0o4755)
      expect(describeNfqwsBinary(p)?.setuid).toBe(true)
      expect(describeNfqwsBinary(p)?.modeText).toBe('-rwsr-xr-x')
      const check = await checkNfqwsLaunchable(p)
      expect(check.ok).toBe(false)
      expect(check.list).toContain('setuid')
      expect(check.hint).toContain('chmod')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects stale runners missing the stay-root pin (UID 2147483647 regression)', async () => {
    const { isRunnerFresh } = await import('../src/main/linux/service')
    expect(isRunnerFresh('#!/usr/bin/env bash\n')).toBe(false)
    // Pre-logging template.
    expect(isRunnerFresh('# Generated by Zapret GUI\npkill -x nfqws\n')).toBe(false)
    // Logging but pre-droproot-fix: no --uid/--user → stale.
    expect(isRunnerFresh('RUN_LOG=/tmp/x.log\nelevate "$NFQWS" --daemon --qnum=220\n')).toBe(false)
    // A --daemon launch is stale too: the double-fork exits immediately, so
    // a Type=simple unit can never stay active (foreground exec required).
    expect(isRunnerFresh(`RUN_LOG=/tmp/x.log\nelevate "$NFQWS" '--daemon' '--uid=1000:1000'\n`)).toBe(false)
    // A root pin is stale too: dropcaps() strips CAP_DAC_OVERRIDE, so even
    // uid 0 gets EACCES on lists under a 700 $HOME.
    expect(isRunnerFresh('RUN_LOG=/tmp/x.log\nelevate "$NFQWS" --uid=0:0 --daemon\n')).toBe(false)
    expect(isRunnerFresh('RUN_LOG=/tmp/x.log\nelevate "$NFQWS" --user=root --daemon\n')).toBe(false)
    // Owner pin (what the app generates now) is fresh.
    expect(isRunnerFresh('RUN_LOG=/tmp/x.log\nexec "$NFQWS" \'--uid=1000:1000\' \'--filter-tcp=80\'\n')).toBe(true)
    expect(isRunnerFresh('RUN_LOG=/tmp/x.log\nexec "$NFQWS" \'--user=avencores\'\n')).toBe(true)
  })

  it('migrates a stale runner pkill -f → -x without privileges', async () => {
    const { migrateStaleRunner, getLinuxRunnerPath } = await import('../src/main/linux/service')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-migrate-'))
    try {
      expect(migrateStaleRunner(dir)).toBe(false)
      fs.writeFileSync(
        path.join(dir, 'zapret-linux-run.sh'),
        '#!/usr/bin/env bash\n# Generated by Zapret GUI\npkill -f nfqws || true\npkill -f nfqws || true\n',
        'utf8'
      )
      expect(migrateStaleRunner(dir)).toBe(true)
      const content = fs.readFileSync(getLinuxRunnerPath(dir), 'utf8')
      expect(content).toContain('pkill -x nfqws')
      expect(content).not.toContain('pkill -f nfqws')
      expect(migrateStaleRunner(dir)).toBe(false)
      // Foreign files are never touched.
      fs.writeFileSync(path.join(dir, 'zapret-linux-run.sh'), '#!/bin/sh\npkill -f nfqws\n', 'utf8')
      expect(migrateStaleRunner(dir)).toBe(false)
      expect(fs.readFileSync(getLinuxRunnerPath(dir), 'utf8')).toContain('pkill -f nfqws')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rebuilds a fresh runner from conf.env + strategy JSON', async () => {
    const { rebuildRunnerFromConf, getLinuxRunnerPath } = await import('../src/main/linux/service')
    const { saveLinuxConf } = await import('../src/main/linux/config')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-rebuild-'))
    try {
      expect(await rebuildRunnerFromConf(dir)).toBeNull()
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'lists'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'strategies'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'bin', 'nfqws'), '', 'utf8')
      const strat = JSON.parse(fs.readFileSync(GENERATED_JSON, 'utf8')) as { fileName: string }
      saveLinuxConf(dir, {
        interface: 'any',
        gamefiltertcp: false,
        gamefilterudp: false,
        strategy: strat.fileName,
        firewall_backend: 'auto'
      })
      fs.copyFileSync(GENERATED_JSON, path.join(dir, 'strategies', 'general_nix1.json'))
      // Stale runner without RUN_LOG gets rebuilt.
      fs.writeFileSync(path.join(dir, 'zapret-linux-run.sh'), '#!/usr/bin/env bash\n# Generated by Zapret GUI\n', 'utf8')
      const out = await rebuildRunnerFromConf(dir)
      expect(out).toBe(getLinuxRunnerPath(dir))
      const content = fs.readFileSync(out as string, 'utf8')
      expect(content).toContain('RUN_LOG=')
      expect(content).toContain('nft_setup')
      // Owner-uid pin survives the rebuild (droproot regression: neither
      // UID 2147483647 nor cap-stripped root can read a 700 $HOME).
      const { resolveDataOwnerUid } = await import('../src/main/linux/config')
      const { isRunnerFresh } = await import('../src/main/linux/service')
      const owner = resolveDataOwnerUid(dir)
      expect(content).toContain(`--uid=${owner}`)
      // Runner launches foreground (no --daemon double-fork under supervision).
      expect(content).toContain('exec "$NFQWS" "${NFQWS_ARGV[@]}"')
      expect(content).not.toContain(`'--daemon'`)
      // A non-root-owned data dir rebuilds into a fresh (startable) runner.
      if (owner !== '0:0') expect(isRunnerFresh(content)).toBe(true)
      // Unknown strategy → null (Apply required).
      saveLinuxConf(dir, {
        interface: 'any',
        gamefiltertcp: false,
        gamefilterudp: false,
        strategy: 'no-such-strategy.bat',
        firewall_backend: 'auto'
      })
      expect(await rebuildRunnerFromConf(dir)).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
