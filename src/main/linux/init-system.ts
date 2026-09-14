/**
 * Init-system detection + unit-file builders — mirror of
 * `src/init-backends/init.sh` + `systemd.sh`/`openrc.sh`/`runit.sh`/`s6.sh`/`dinit.sh`.
 * @module main/linux/init-system
 */
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { LINUX_SERVICE_NAME, type InitSystem } from './constants'
import { runElevatedArgs, runElevatedScript } from './elevate'
import type { ServiceState } from '../../shared/types'

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8').trim()
  } catch {
    return ''
  }
}

function hasPath(p: string): boolean {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function hasCommand(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('sh', ['-c', `command -v ${name} >/dev/null 2>&1`], (err) => resolve(!err))
  })
}

/**
 * Detect the init system (mirrors `detect_init_system` in init.sh).
 * Order: systemd → dinit → runit → s6 → openrc → unknown.
 */
export async function detectInitSystem(): Promise<InitSystem> {
  try {
    const comm = readFileSafe('/proc/1/comm')
    let exe = ''
    try {
      exe = fs.readlinkSync('/proc/1/exe')
    } catch {
      exe = ''
    }
    const exeName = exe.split('/').pop() ?? ''

    if (exeName === 'systemd' || hasPath('/run/systemd/system')) return 'systemd'
    if (exeName === 'dinit' || comm === 'dinit') return 'dinit'
    if (/^runit/.test(exeName)) return 'runit'
    if (/^s6-svscan/.test(exeName) || hasPath('/run/s6') || hasPath('/var/run/s6')) return 's6'
    if (hasPath('/run/openrc') || hasPath('/sbin/rc') || hasPath('/etc/init.d/rc') || (await hasCommand('rc-status'))) {
      return 'openrc'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Service file/dir for an init system. Pure. */
export function serviceLocation(init: InitSystem, serviceName = LINUX_SERVICE_NAME): string {
  switch (init) {
    case 'systemd':
      return `/etc/systemd/system/${serviceName}.service`
    case 'openrc':
      return `/etc/init.d/${serviceName}`
    case 'runit':
      return `/etc/sv/${serviceName}`
    case 's6':
      return `/etc/s6/sv/${serviceName}`
    case 'dinit':
      return `/etc/dinit.d/${serviceName}`
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Unit builders (pure — unit tested)
// ---------------------------------------------------------------------------

/** systemd unit calling the GUI-generated runner. Pure. */
export function buildSystemdUnit(opts: { runnerPath: string; workDir: string; description?: string }): string {
  return [
    '[Unit]',
    `Description=${opts.description ?? 'Zapret DPI bypass (nfqws + firewall)'}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${opts.workDir}`,
    'User=root',
    `ExecStart=/usr/bin/env bash ${opts.runnerPath} daemon`,
    `ExecStop=/usr/bin/env bash ${opts.runnerPath} kill`,
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    ''
  ].join('\n')
}

/** OpenRC service script. Pure. */
export function buildOpenrcScript(opts: { runnerPath: string; workDir: string; serviceName?: string }): string {
  const name = opts.serviceName ?? LINUX_SERVICE_NAME
  return [
    '#!/sbin/openrc-run',
    `# /etc/init.d/${name}`,
    '',
    'description="Zapret bypass (nfqws + firewall)"',
    `HOMEDIR="${opts.workDir}"`,
    `SERVICE_SCRIPT="${opts.runnerPath}"`,
    '',
    'command="/bin/bash"',
    'command_args="\\"${SERVICE_SCRIPT}\\" daemon"',
    'command_background="yes"',
    `pidfile="/run/${name}.pid"`,
    'directory="${HOMEDIR}"',
    'kill_mode="mixed"',
    '',
    'depend() {',
    '    need net',
    '    after firewall',
    '}',
    '',
    'stop_post() {',
    '    "${SERVICE_SCRIPT}" kill || true',
    '}',
    ''
  ].join('\n')
}

/** runit `run` script. Pure. */
export function buildRunitRun(opts: { runnerPath: string }): string {
  return ['#!/bin/sh', 'exec 2>&1', `exec "${opts.runnerPath}" daemon`, ''].join('\n')
}

/** runit `finish` script. Pure. */
export function buildRunitFinish(opts: { runnerPath: string }): string {
  return ['#!/bin/sh', 'exec 2>&1', `exec "${opts.runnerPath}" kill`, ''].join('\n')
}

/** dinit service definition. Pure. */
export function buildDinitConf(opts: { runnerPath: string }): string {
  return [
    'type = process',
    `command = /usr/bin/env bash "${opts.runnerPath}" daemon`,
    `stop-command = /usr/bin/env bash "${opts.runnerPath}" kill`,
    'waits-for = network.target',
    '',
    'restart = on-failure',
    'restart-delay = 1',
    'restart-limit-count = 5',
    ''
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Status queries (per init backend)
// ---------------------------------------------------------------------------

async function shOut(cmd: string, args: string[], timeoutMs = 10000): Promise<{ code: number; out: string }> {
  const r = await runElevatedArgs(cmd, args, timeoutMs).catch(() => ({ stdout: '', stderr: '', code: 1 }))
  return { code: (r as { code: number | null }).code ?? 1, out: `${(r as { stdout: string }).stdout ?? ''}\n${(r as { stderr: string }).stderr ?? ''}` }
}

/**
 * Query init-service state. Returns NOT_INSTALLED when the unit file is absent.
 * Never throws (UNKNOWN on unexpected failures).
 */
export async function queryLinuxServiceState(
  init: InitSystem,
  serviceName = LINUX_SERVICE_NAME
): Promise<ServiceState> {
  try {
    const loc = serviceLocation(init, serviceName)
    if (!loc) return 'UNKNOWN'
    if (!hasPath(loc)) return 'NOT_INSTALLED'
    switch (init) {
      case 'systemd': {
        const r = await shOut('systemctl', ['is-active', serviceName])
        const s = r.out.trim().toLowerCase()
        if (s.startsWith('active')) return 'RUNNING'
        if (s.startsWith('activating')) return 'START_PENDING'
        if (s.startsWith('deactivating')) return 'STOP_PENDING'
        if (s.startsWith('inactive') || s.startsWith('failed')) return 'STOPPED'
        return 'UNKNOWN'
      }
      case 'openrc': {
        const r = await shOut('rc-service', [serviceName, 'status'])
        return r.code === 0 ? 'RUNNING' : 'STOPPED'
      }
      case 'runit': {
        const r = await shOut('sv', ['status', serviceName])
        if (/^run:/m.test(r.out)) return 'RUNNING'
        if (/^down:/m.test(r.out)) return 'STOPPED'
        return r.code === 0 ? 'RUNNING' : 'STOPPED'
      }
      case 's6': {
        const r = await shOut('s6-svstat', [loc])
        if (/up\s*\(pid/i.test(r.out)) return 'RUNNING'
        return 'STOPPED'
      }
      case 'dinit': {
        const r = await shOut('dinitctl', ['is-started', serviceName])
        return r.code === 0 ? 'RUNNING' : 'STOPPED'
      }
      default:
        return 'UNKNOWN'
    }
  } catch {
    return 'UNKNOWN'
  }
}

// ---------------------------------------------------------------------------
// Install / start / stop / restart / remove
// ---------------------------------------------------------------------------

/** Write text to a root-owned path via elevate. */
async function writeRootFile(dest: string, content: string, mode = '0644'): Promise<void> {
  const b64 = Buffer.from(content, 'utf8').toString('base64')
  // base64 avoids every quoting pitfall (spaces, quotes, `$`) in unit files.
  const script = `base64 -d > ${dest} <<'ZAPRET_EOF'\n${b64}\nZAPRET_EOF\nchmod ${mode} ${dest}`
  const r = await runElevatedScript(script, 20000)
  if (r.code !== 0) throw new Error(`Cannot write ${dest}: ${(r.stdout + r.stderr).trim().slice(0, 300)}`)
}

export async function installInitService(
  init: InitSystem,
  opts: { runnerPath: string; workDir: string; serviceName?: string; onLog?: (t: string) => void }
): Promise<void> {
  const name = opts.serviceName ?? LINUX_SERVICE_NAME
  const say = (t: string): void => opts.onLog?.(t)
  switch (init) {
    case 'systemd': {
      const dest = `/etc/systemd/system/${name}.service`
      say(`Writing ${dest} ...`)
      await writeRootFile(dest, buildSystemdUnit({ runnerPath: opts.runnerPath, workDir: opts.workDir }))
      await runElevatedArgs('systemctl', ['daemon-reload'], 20000)
      await runElevatedArgs('systemctl', ['enable', name], 20000)
      say('Starting systemd service...')
      const r = await runElevatedArgs('systemctl', ['restart', name], 20000)
      if (r.code !== 0) throw new Error(`systemctl start failed: ${(r.stdout + r.stderr).trim().slice(0, 300)}`)
      return
    }
    case 'openrc': {
      const dest = `/etc/init.d/${name}`
      say(`Writing ${dest} ...`)
      await writeRootFile(dest, buildOpenrcScript({ runnerPath: opts.runnerPath, workDir: opts.workDir, serviceName: name }), '0755')
      await runElevatedArgs('rc-update', ['add', name, 'default'], 20000)
      const r = await runElevatedArgs('rc-service', [name, 'restart'], 20000)
      if (r.code !== 0) throw new Error(`rc-service start failed: ${(r.stdout + r.stderr).trim().slice(0, 300)}`)
      return
    }
    case 'runit': {
      const dir = `/etc/sv/${name}`
      await runElevatedArgs('mkdir', ['-p', dir], 10000)
      await writeRootFile(`${dir}/run`, buildRunitRun({ runnerPath: opts.runnerPath }), '0755')
      await writeRootFile(`${dir}/finish`, buildRunitFinish({ runnerPath: opts.runnerPath }), '0755')
      await runElevatedArgs('sv', ['up', name], 15000)
      return
    }
    case 's6': {
      const dir = `/etc/s6/sv/${name}`
      await runElevatedArgs('mkdir', ['-p', `${dir}/log`], 10000)
      await writeRootFile(
        `${dir}/run`,
        `#!/bin/sh\nexec 2>&1\ncd "${opts.workDir}"\nexec "${opts.runnerPath}" daemon\n`,
        '0755'
      )
      await writeRootFile(`${dir}/finish`, `#!/bin/sh\n"${opts.runnerPath}" kill\nexit 0\n`, '0755')
      await writeRootFile(`${dir}/log/run`, `#!/bin/sh\nexec s6-log n20 s1000000 /var/log/${name}\n`, '0755')
      return
    }
    case 'dinit': {
      const dest = `/etc/dinit.d/${name}`
      say(`Writing ${dest} ...`)
      await writeRootFile(dest, buildDinitConf({ runnerPath: opts.runnerPath }))
      await runElevatedArgs('dinitctl', ['enable', name], 20000)
      return
    }
    default:
      throw new Error('Unknown init system — cannot install a system service (use foreground run instead)')
  }
}

export async function startInitService(init: InitSystem, serviceName = LINUX_SERVICE_NAME): Promise<void> {
  const run = async (cmd: string, args: string[]): Promise<void> => {
    const r = await runElevatedArgs(cmd, args, 20000)
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stdout + r.stderr).trim().slice(0, 300)}`)
  }
  switch (init) {
    case 'systemd':
      return run('systemctl', ['start', serviceName])
    case 'openrc':
      return run('rc-service', [serviceName, 'start'])
    case 'runit':
      return run('sv', ['up', serviceName])
    case 's6':
      return run('s6-svc', ['-u', serviceLocation('s6', serviceName)])
    case 'dinit':
      return run('dinitctl', ['start', serviceName])
    default:
      throw new Error('Unknown init system')
  }
}

export async function stopInitService(init: InitSystem, serviceName = LINUX_SERVICE_NAME): Promise<void> {
  const run = async (cmd: string, args: string[]): Promise<void> => {
    const r = await runElevatedArgs(cmd, args, 20000)
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stdout + r.stderr).trim().slice(0, 300)}`)
  }
  switch (init) {
    case 'systemd':
      return run('systemctl', ['stop', serviceName])
    case 'openrc':
      return run('rc-service', [serviceName, 'stop'])
    case 'runit':
      return run('sv', ['down', serviceName])
    case 's6':
      return run('s6-svc', ['-d', serviceLocation('s6', serviceName)])
    case 'dinit':
      return run('dinitctl', ['stop', serviceName])
    default:
      throw new Error('Unknown init system')
  }
}

export async function removeInitService(
  init: InitSystem,
  serviceName = LINUX_SERVICE_NAME,
  onLog?: (t: string) => void
): Promise<void> {
  const say = (t: string): void => onLog?.(t)
  const bestEffort = async (cmd: string, args: string[]): Promise<void> => {
    try {
      await runElevatedArgs(cmd, args, 15000)
    } catch {
      /* ignore */
    }
  }
  switch (init) {
    case 'systemd':
      await bestEffort('systemctl', ['stop', serviceName])
      await bestEffort('systemctl', ['disable', serviceName])
      await runElevatedArgs('rm', ['-f', `/etc/systemd/system/${serviceName}.service`], 10000)
      await bestEffort('systemctl', ['daemon-reload'])
      say('systemd service removed.')
      return
    case 'openrc':
      await bestEffort('rc-service', [serviceName, 'stop'])
      await bestEffort('rc-update', ['del', serviceName, 'default'])
      await runElevatedArgs('rm', ['-f', `/etc/init.d/${serviceName}`], 10000)
      say('OpenRC service removed.')
      return
    case 'runit':
      await bestEffort('sv', ['down', serviceName])
      await runElevatedArgs('rm', ['-rf', `/etc/sv/${serviceName}`], 10000)
      say('runit service removed.')
      return
    case 's6':
      await bestEffort('s6-svc', ['-d', serviceLocation('s6', serviceName)])
      await runElevatedArgs('rm', ['-rf', serviceLocation('s6', serviceName)], 10000)
      say('s6 service removed.')
      return
    case 'dinit':
      await bestEffort('dinitctl', ['stop', serviceName])
      await bestEffort('dinitctl', ['disable', serviceName])
      await runElevatedArgs('rm', ['-f', `/etc/dinit.d/${serviceName}`], 10000)
      say('dinit service removed.')
      return
    default:
      throw new Error('Unknown init system')
  }
}
