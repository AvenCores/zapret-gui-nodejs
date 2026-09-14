/**
 * Process execution helpers: plain exec, admin detection and UAC elevation.
 *
 * Privilege model: on Windows the app asks to run elevated once (button
 * "relaunch as admin") and service/hosts operations then run directly.
 * On Linux the app always stays under the user — only root-dependent parts
 * elevate per call via `sudo -n`/`doas -n` (after the one-time NOPASSWD
 * setup) or a single `pkexec` prompt (see `linux/elevate`).
 * For single-shot elevation without restart on Windows, {@link runElevated}
 * re-launches a command via `powershell Start-Process -Verb RunAs`.
 * @module main/exec
 */
import { spawn, execFile } from 'node:child_process'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

/** Run a binary and capture output. Never rejects — always resolves. */
export function run(file: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    // windowsVerbatimArguments is REQUIRED: without it Node backslash-escapes
    // embedded double quotes (`"..."` -> `\"...\"`), which cmd.exe does not
    // understand. Every command with inner quotes (tasklist /FI "...",
    // reg query "HKLM\\...", sc create binPath= "...") silently broke —
    // e.g. tasklist failed with "invalid filter" and winws.exe was never seen.
    execFile(
      file,
      args,
      { windowsHide: true, windowsVerbatimArguments: true, cwd: opts.cwd, timeout: opts.timeoutMs ?? 30000 },
      (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: error && 'code' in error ? ((error as { code?: number | null }).code ?? 1) : 0
        })
      }
    )
  })
}

/** `cmd.exe /c <command>` wrapper (needed for sc/net/tasklist pipelines). */
export function runCmd(command: string, timeoutMs = 30000): Promise<ExecResult> {
  // cmd.exe emits text in the OEM codepage (CP866 on Russian Windows) while
  // Node decodes it as UTF-8 → Cyrillic turns into mojibake in surfaced
  // errors. Switching this (per-process) session to UTF-8 fixes decoding;
  // parsing only relies on ASCII keywords/digits, so nothing else changes.
  return run('cmd.exe', ['/d', '/s', '/c', `chcp 65001 >nul & ${command}`], { timeoutMs })
}

/** PowerShell `-NoProfile -Command ...` wrapper. */
export function runPowershell(script: string, timeoutMs = 30000): Promise<ExecResult> {
  // Same OEM-decoding problem as cmd (e.g. Cyrillic paths from
  // Get-Process/registry): force UTF-8 console output for this session.
  // `new($false)` = no BOM preamble, and every caller trims anyway.
  const utf8 = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${utf8}${script}`], { timeoutMs })
}

/**
 * True when service/hosts operations are available: elevated on Windows,
 * root or able to elevate per call (sudo/doas/pkexec) on Linux. On Linux
 * this does NOT mean the app itself runs as root — the app always stays
 * under the user and only privileged calls elevate.
 */
export async function isAdmin(): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      const { isRoot, checkElevateAvailable } = await import('./linux/elevate')
      return isRoot() || checkElevateAvailable()
    } catch {
      return false
    }
  }
  // `net session` succeeds only for admins.
  const r = await runCmd('net session >nul 2>&1')
  return r.code === 0
}

/**
 * Relaunch an arbitrary command elevated via UAC prompt.
 * Shows a UAC dialog; resolves true if the user accepted (process started).
 */
export async function runElevated(command: string, args: string[], cwd?: string): Promise<boolean> {
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const ps = `Start-Process -FilePath '${command.replace(/'/g, "''")}' -ArgumentList ${argList} -Verb RunAs` +
    (cwd ? ` -WorkingDirectory '${cwd.replace(/'/g, "''")}'` : '')
  const r = await runPowershell(ps, 60000)
  return r.code === 0
}

/** Relaunch the whole Electron app elevated (Windows UAC flow only). */
export async function relaunchAppAsAdmin(appPath: string, appArgs: string[]): Promise<boolean> {
  if (process.platform === 'linux') {
    // By design the Linux app never relaunches as a whole under root:
    // privileged calls elevate individually (pkexec prompt or passwordless
    // sudo) while the app keeps running as the user.
    throw new Error(
      'Restarting the whole app as root is not used on Linux — privileged actions ask for elevation individually (a single system prompt), and "Set up passwordless operation" on the Strategies tab removes even that.'
    )
  }
  const ps =
    `Start-Process -FilePath '${appPath.replace(/'/g, "''")}'` +
    (appArgs.length > 0 ? ` -ArgumentList '${appArgs.map((a) => a.replace(/'/g, "''")).join("','")}'` : '') +
    ' -Verb RunAs'
  const r = await runPowershell(ps, 60000)
  return r.code === 0
}

/**
 * Append `--no-sandbox` for a process that runs as root (Chromium refuses
 * to run as root with the sandbox on). Kept as a tested helper; the Linux
 * app itself no longer relaunches as a whole under root.
 * Pure.
 */
export function ensureNoSandbox(args: string[]): string[] {
  return args.includes('--no-sandbox') ? [...args] : [...args, '--no-sandbox']
}

/**
 * GUI/session env to forward through `pkexec env ...` (pkexec scrubs
 * everything else). Display vars for X11/Wayland plus the session bus:
 * without `DBUS_SESSION_BUS_ADDRESS` the elevated copy cannot register its
 * tray icon with the user's StatusNotifierWatcher and the icon silently
 * never appears. Pure — covered by unit tests.
 */
export function pickGuiEnv(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const k of [
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'XAUTHORITY',
    'XDG_SESSION_TYPE',
    'DBUS_SESSION_BUS_ADDRESS'
  ]) {
    const v = env[k]
    if (typeof v === 'string' && v !== '') out.push(`${k}=${v}`)
  }
  return out
}

export type GuiTerminalMode = 'dd' | 'e' | 'direct'

export interface GuiTerminal {
  cmd: string
  mode: GuiTerminalMode
}

/**
 * Find a GUI terminal for a password prompt. Order: $TERMINAL override,
 * freedesktop dispatcher, GNOME (Terminal/Console/Ptyxis-era), KDE,
 * Xfce/MATE/LXDE, GPU terminals, then X11 fallbacks. Pure (injectable
 * lookup) — covered by unit tests.
 */
export function findGuiTerminal(has: (name: string) => boolean): GuiTerminal | null {
  const custom = (process.env.TERMINAL ?? '').trim().split(/\s+/)[0] ?? ''
  if (custom !== '' && has(custom)) return { cmd: custom, mode: 'e' }
  const list: Array<[string, GuiTerminalMode]> = [
    ['xdg-terminal-exec', 'direct'],
    ['gnome-terminal', 'dd'],
    ['ptyxis', 'dd'],
    ['kgx', 'e'],
    ['konsole', 'e'],
    ['xfce4-terminal', 'e'],
    ['mate-terminal', 'e'],
    ['lxterminal', 'e'],
    ['alacritty', 'e'],
    ['kitty', 'direct'],
    ['xterm', 'e'],
    ['uxterm', 'e']
  ]
  for (const [name, mode] of list) {
    if (has(name)) return { cmd: name, mode }
  }
  return null
}

/**
 * Build the terminal argv that runs `elevCmd <target...>` inside it.
 * `dd` terminals take `-- cmd...`, `e` terminals take `-e cmd...`,
 * `direct` ones (kitty, xdg-terminal-exec) take the command as-is. Pure.
 */
export function buildTerminalArgs(spec: GuiTerminal, elevCmd: string, target: string[]): string[] {
  if (spec.mode === 'dd') return ['--', elevCmd, ...target]
  if (spec.mode === 'e') return ['-e', elevCmd, ...target]
  return [elevCmd, ...target]
}

/** Spawn a long-lived child (foreground winws/nfqws test / test script). */
export function spawnLong(file: string, args: string[], cwd?: string) {
  if (process.platform === 'linux') {
    return spawn(file, args, { cwd })
  }
  return spawn(file, args, { windowsHide: false, cwd })
}
