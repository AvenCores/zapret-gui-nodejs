/**
 * Process execution helpers: plain exec, admin detection and UAC elevation.
 *
 * Strategy: the app asks to run elevated once (button "relaunch as admin").
 * Service/hosts operations then run directly.
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

/** True when the current process runs elevated (admin). */
export async function isAdmin(): Promise<boolean> {
  // `net session` succeeds only for admins.
  const r = await runCmd('net session >nul 2>&1')
  return r.code === 0
}

/** Relaunch the whole Electron app elevated (used by the dashboard button). */
export async function relaunchAppAsAdmin(appPath: string, appArgs: string[]): Promise<boolean> {
  const ps =
    `Start-Process -FilePath '${appPath.replace(/'/g, "''")}'` +
    (appArgs.length > 0 ? ` -ArgumentList '${appArgs.map((a) => a.replace(/'/g, "''")).join("','")}'` : '') +
    ' -Verb RunAs'
  const r = await runPowershell(ps, 60000)
  return r.code === 0
}

/** Spawn a long-lived child (foreground winws test / test script). */
export function spawnLong(file: string, args: string[], cwd?: string) {
  return spawn(file, args, { windowsHide: false, cwd })
}
