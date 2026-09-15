/**
 * Init-system detection + unit-file builders — mirror of
 * `src/init-backends/init.sh` + `systemd.sh`/`openrc.sh`/`runit.sh`/`s6.sh`/`dinit.sh`.
 * @module main/linux/init-system
 */
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { LINUX_SERVICE_NAME, type InitSystem } from './constants'
import { runQuery, type BatchStep } from './elevate'
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
    // NOTE: `network.target` (stack up), NOT `network-online.target`:
    // on desktops without NetworkManager-wait-online the online target may
    // never activate and the start job hangs in "activating" forever.
    // nfqws/NFQUEUE needs no outbound connectivity, only the local stack.
    'After=network.target',
    'Wants=network.target',
    // Stop a crash-loop from churning forever (a broken strategy used to
    // restart every 2s indefinitely): after 3 quick failures the unit stays
    // failed until the next manual start instead of spamming the journal.
    'StartLimitIntervalSec=30',
    'StartLimitBurst=3',
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
  // Status polling must never pop an auth dialog — runQuery only.
  const r = await runQuery(cmd, args, timeoutMs).catch(() => ({ stdout: '', stderr: '', code: 1 }))
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

export interface SystemdDetails {
  activeState: string
  subState: string
  result: string
  execMainStatus: string
  nRestarts: number
  mainPid: number
}

/**
 * Parse `systemctl show` KEY=VALUE output. Pure — covered by unit tests.
 * Unknown/missing keys yield empty strings (0 for numbers).
 */
export function parseSystemdShow(text: string): SystemdDetails {
  const get = (key: string): string => {
    const m = String(text ?? '').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return (m?.[1] ?? '').trim()
  }
  const num = (key: string): number => {
    const n = Number(get(key))
    return Number.isFinite(n) ? n : 0
  }
  return {
    activeState: get('ActiveState'),
    subState: get('SubState'),
    result: get('Result'),
    execMainStatus: get('ExecMainStatus'),
    nRestarts: num('NRestarts'),
    mainPid: num('MainPID')
  }
}

/**
 * Read systemd unit details (state, substate, restart counter, main PID).
 * Unprivileged `systemctl show` read — never prompts, never throws
 * (null when unavailable). Used for start-failure forensics: it tells a
 * stuck start job (SubState=start, MainPID=0) apart from a restart loop
 * (SubState=auto-restart, NRestarts climbing) without root.
 */
export async function getSystemdDetails(serviceName = LINUX_SERVICE_NAME): Promise<SystemdDetails | null> {
  try {
    const r = await shOut('systemctl', [
      'show',
      serviceName,
      '-p',
      'ActiveState,SubState,Result,ExecMainStatus,NRestarts,MainPID'
    ])
    if (r.code !== 0 && r.out.trim() === '') return null
    const d = parseSystemdShow(r.out)
    if (!d.activeState && !d.subState) return null
    return d
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Install / start / stop / restart / remove — pure step builders +
// single-prompt executors (one `pkexec` per operation, zero with NOPASSWD)
// ---------------------------------------------------------------------------

export interface InstallStepOpts {
  runnerPath: string
  workDir: string
  serviceName?: string
}

/** Init-service install as batch steps. Pure — covered by unit tests. */
export function buildInstallSteps(init: InitSystem, opts: InstallStepOpts): BatchStep[] {
  const name = opts.serviceName ?? LINUX_SERVICE_NAME
  const write = (dest: string, content: string, mode = '0644'): BatchStep => ({
    kind: 'write',
    dest,
    content,
    mode,
    label: `write ${dest}`
  })
  switch (init) {
    case 'systemd':
      return [
        write(`/etc/systemd/system/${name}.service`, buildSystemdUnit({ runnerPath: opts.runnerPath, workDir: opts.workDir })),
        { kind: 'exec', file: 'systemctl', args: ['daemon-reload'], ignoreFailure: true },
        { kind: 'exec', file: 'systemctl', args: ['enable', name], ignoreFailure: true },
        { kind: 'exec', file: 'systemctl', args: ['restart', name] }
      ]
    case 'openrc':
      return [
        write(`/etc/init.d/${name}`, buildOpenrcScript({ runnerPath: opts.runnerPath, workDir: opts.workDir, serviceName: name }), '0755'),
        { kind: 'exec', file: 'rc-update', args: ['add', name, 'default'], ignoreFailure: true },
        { kind: 'exec', file: 'rc-service', args: [name, 'restart'] }
      ]
    case 'runit': {
      const dir = `/etc/sv/${name}`
      return [
        { kind: 'exec', file: 'mkdir', args: ['-p', dir], ignoreFailure: true },
        write(`${dir}/run`, buildRunitRun({ runnerPath: opts.runnerPath }), '0755'),
        write(`${dir}/finish`, buildRunitFinish({ runnerPath: opts.runnerPath }), '0755'),
        { kind: 'exec', file: 'sv', args: ['up', name], ignoreFailure: true }
      ]
    }
    case 's6': {
      const dir = `/etc/s6/sv/${name}`
      return [
        { kind: 'exec', file: 'mkdir', args: ['-p', `${dir}/log`], ignoreFailure: true },
        write(
          `${dir}/run`,
          `#!/bin/sh\nexec 2>&1\ncd "${opts.workDir}"\nexec "${opts.runnerPath}" daemon\n`,
          '0755'
        ),
        write(`${dir}/finish`, `#!/bin/sh\n"${opts.runnerPath}" kill\nexit 0\n`, '0755'),
        write(`${dir}/log/run`, `#!/bin/sh\nexec s6-log n20 s1000000 /var/log/${name}\n`, '0755')
      ]
    }
    case 'dinit':
      return [
        write(`/etc/dinit.d/${name}`, buildDinitConf({ runnerPath: opts.runnerPath })),
        { kind: 'exec', file: 'dinitctl', args: ['enable', name], ignoreFailure: true }
      ]
    default:
      throw new Error('Unknown init system — cannot install a system service (use foreground run instead)')
  }
}

/** Service-start command per init. Pure. */
export function buildStartSteps(init: InitSystem, serviceName = LINUX_SERVICE_NAME): BatchStep[] {
  switch (init) {
    case 'systemd':
      return [{ kind: 'exec', file: 'systemctl', args: ['start', serviceName] }]
    case 'openrc':
      return [{ kind: 'exec', file: 'rc-service', args: [serviceName, 'start'] }]
    case 'runit':
      return [{ kind: 'exec', file: 'sv', args: ['up', serviceName] }]
    case 's6':
      return [{ kind: 'exec', file: 's6-svc', args: ['-u', serviceLocation('s6', serviceName)] }]
    case 'dinit':
      return [{ kind: 'exec', file: 'dinitctl', args: ['start', serviceName] }]
    default:
      throw new Error('Unknown init system')
  }
}

/** Service-stop command per init. Pure. */
export function buildStopSteps(init: InitSystem, serviceName = LINUX_SERVICE_NAME): BatchStep[] {
  switch (init) {
    case 'systemd':
      return [{ kind: 'exec', file: 'systemctl', args: ['stop', serviceName] }]
    case 'openrc':
      return [{ kind: 'exec', file: 'rc-service', args: [serviceName, 'stop'] }]
    case 'runit':
      return [{ kind: 'exec', file: 'sv', args: ['down', serviceName] }]
    case 's6':
      return [{ kind: 'exec', file: 's6-svc', args: ['-d', serviceLocation('s6', serviceName)] }]
    case 'dinit':
      return [{ kind: 'exec', file: 'dinitctl', args: ['stop', serviceName] }]
    default:
      throw new Error('Unknown init system')
  }
}

/** Service removal as batch steps (stop/disable best-effort). Pure. */
export function buildRemoveSteps(init: InitSystem, serviceName = LINUX_SERVICE_NAME): BatchStep[] {
  const ign = (file: string, args: string[]): BatchStep => ({ kind: 'exec', file, args, ignoreFailure: true })
  switch (init) {
    case 'systemd':
      return [
        ign('systemctl', ['stop', serviceName]),
        ign('systemctl', ['disable', serviceName]),
        { kind: 'exec', file: 'rm', args: ['-f', `/etc/systemd/system/${serviceName}.service`] },
        ign('systemctl', ['daemon-reload'])
      ]
    case 'openrc':
      return [
        ign('rc-service', [serviceName, 'stop']),
        ign('rc-update', ['del', serviceName, 'default']),
        { kind: 'exec', file: 'rm', args: ['-f', `/etc/init.d/${serviceName}`] }
      ]
    case 'runit':
      return [
        ign('sv', ['down', serviceName]),
        { kind: 'exec', file: 'rm', args: ['-rf', `/etc/sv/${serviceName}`] }
      ]
    case 's6':
      return [
        ign('s6-svc', ['-d', serviceLocation('s6', serviceName)]),
        { kind: 'exec', file: 'rm', args: ['-rf', serviceLocation('s6', serviceName)] }
      ]
    case 'dinit':
      return [
        ign('dinitctl', ['stop', serviceName]),
        ign('dinitctl', ['disable', serviceName]),
        { kind: 'exec', file: 'rm', args: ['-f', `/etc/dinit.d/${serviceName}`] }
      ]
    default:
      throw new Error('Unknown init system')
  }
}
