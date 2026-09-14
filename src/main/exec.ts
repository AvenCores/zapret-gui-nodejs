/**
 * Process execution helpers: plain exec, admin detection and UAC elevation.
 *
 * Strategy: the app asks to run elevated once (button "relaunch as admin").
 * Service/hosts operations then run directly. For single-shot elevation
 * without restart, {@link runElevated} re-launches a command via
 * `powershell Start-Process -Verb RunAs`.
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

/** True when the current process runs elevated (admin / root). */
export async function isAdmin(): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      if (typeof process.geteuid === 'function' && process.geteuid() === 0) return true
    } catch {
      /* fall through */
    }
    // Passwordless sudo also counts as "can manage the service".
    try {
      const { isRoot, detectElevateCmd } = await import('./linux/elevate')
      if (isRoot()) return true
      const cmd = detectElevateCmd()
      if (cmd === 'sudo') {
        const r = await run('sudo', ['-n', 'true'], { timeoutMs: 8000 })
        return r.code === 0
      }
      return false
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

/** Relaunch the whole Electron app elevated (used by the dashboard button). */
export async function relaunchAppAsAdmin(appPath: string, appArgs: string[]): Promise<boolean> {
  if (process.platform === 'linux') {
    return relaunchAppAsRootLinux(appPath, appArgs)
  }
  const ps =
    `Start-Process -FilePath '${appPath.replace(/'/g, "''")}'` +
    (appArgs.length > 0 ? ` -ArgumentList '${appArgs.map((a) => a.replace(/'/g, "''")).join("','")}'` : '') +
    ' -Verb RunAs'
  const r = await runPowershell(ps, 60000)
  return r.code === 0
}

/**
 * Chromium refuses to run as root with the sandbox on — the elevated copy
 * would crash instantly without this flag. Pure.
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

/**
 * Linux relaunch chain (GUI-first):
 * 1. `pkexec` graphical dialog (with display env forwarded for Wayland),
 * 2. a terminal emulator running `sudo/doas` (detached — the emulator owns
 *    the elevated app, so our timeouts can never kill it),
 * 3. direct `sudo/doas` (last resort, works only with NOPASSWD or a tty).
 * Returns false instead of prompting nowhere — the UI surfaces that.
 */
async function relaunchAppAsRootLinux(appPath: string, appArgs: string[]): Promise<boolean> {
  try {
    const { detectElevateCmd, isRoot, commandExists } = await import('./linux/elevate')
    if (isRoot()) return true
    let elev: string
    try {
      elev = detectElevateCmd()
    } catch {
      return false
    }
    if (elev === '') return true
    const target = [appPath, ...ensureNoSandbox(appArgs)]

    // 1. Graphical polkit prompt (GNOME/KDE agents, no terminal needed).
    if (commandExists('pkexec')) {
      const r = await run(
        'pkexec',
        ['/usr/bin/env', ...pickGuiEnv(process.env), ...target],
        { timeoutMs: 300000 }
      )
      if (r.code === 0) return true
      // Dismissed / no agent / Wayland env issue — keep trying below.
    }

    // sudo/doas for the terminal and direct fallbacks.
    const sudoish = elev === 'sudo' || elev === 'doas' ? elev : commandExists('sudo') ? 'sudo' : commandExists('doas') ? 'doas' : null

    // 2. Terminal emulator (detached: we only check it *started*).
    if (sudoish) {
      const term = findGuiTerminal(commandExists)
      if (term) {
        const started = await new Promise<boolean>((resolve) => {
          let child: ReturnType<typeof spawn>
          try {
            child = spawn(term.cmd, buildTerminalArgs(term, sudoish, target), {
              detached: true,
              stdio: 'ignore'
            })
          } catch {
            resolve(false)
            return
          }
          child.on('error', () => resolve(false))
          // Emulators that daemonize exit fast; blocking ones (xterm -e)
          // stay alive while the user types the password — either way a
          // quick quiet window means "launched".
          setTimeout(() => resolve(true), 2500).unref?.()
          child.unref?.()
        })
        if (started) return true
      }
    }

    // 3. Last resort: piped sudo (succeeds only with NOPASSWD).
    if (sudoish) {
      const r = await run(sudoish, target, { timeoutMs: 60000 })
      return r.code === 0
    }
    return false
  } catch {
    return false
  }
}

/** Spawn a long-lived child (foreground winws/nfqws test / test script). */
export function spawnLong(file: string, args: string[], cwd?: string) {
  if (process.platform === 'linux') {
    return spawn(file, args, { cwd })
  }
  return spawn(file, args, { windowsHide: false, cwd })
}
