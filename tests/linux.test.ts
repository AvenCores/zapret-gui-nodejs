/** Unit tests for the Linux support modules (pure helpers, no root needed). */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  toIptablesPorts
} from '../src/main/linux/firewall'
import { buildSystemdUnit, buildDinitConf, serviceLocation } from '../src/main/linux/init-system'
import { buildSudoersContent, buildDoasRules } from '../src/main/linux/elevate'
import { mapPlatformDir } from '../src/main/linux/download'
import { detectLinuxOwnership } from '../src/main/linux/service'
import { buildRunnerScript } from '../src/main/linux/service'
import { isLinuxPlatform, isWindowsPlatform, dpiEngineBinary } from '../src/main/linux/platform'

const EXAMPLE_BAT = path.join(process.cwd(), 'bundled-assets', 'bat', 'general_nix1.bat')
const GENERATED_JSON = path.join(process.cwd(), 'bundled-assets', 'strategies', 'general_nix1.json')

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
    // No placeholders survive materialization.
    expect(argv.join(' ')).not.toContain('<BIN>')
    expect(argv.join(' ')).not.toContain('<LISTS>')
  })
  it('materializes placeholders to real dirs', () => {
    const argv = materializeNfqwsArgv(['--filter-tcp=80 --hostlist="<LISTS>/list-general.txt" --new'], {
      binDir: '/d/bin',
      listsDir: '/d/lists'
    })
    expect(argv.join(' ')).toContain('/d/lists/list-general.txt')
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
    expect(content).toContain('pkill -f nfqws')
  })
  it('generates doas rules', () => {
    const rules = buildDoasRules('bob', '/data/bin/nfqws')
    expect(rules).toContain('permit nopass bob as root cmd /data/bin/nfqws')
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
      nfqwsArgv: ['--daemon', '--dpi-desync-fwmark=0x40000000', '--qnum=220', '--filter-tcp=80']
    })
    expect(script).toContain('daemon)')
    expect(script).toContain('kill)')
    expect(script).toContain('/data/bin/nfqws')
    expect(script).toContain('nft_setup')
    expect(script).toContain('--filter-tcp=80')
    expect(script).toContain('queue num 220')
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
