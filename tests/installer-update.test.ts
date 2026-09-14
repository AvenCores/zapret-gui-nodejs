/**
 * Update-from-exe safety contract with zapret services installed.
 *
 * The `zapret` service runs winws.exe from %APPDATA%\zapret-gui\data (never
 * from $INSTDIR), so installer file ops cannot collide with it — but the
 * installer must still (a) quiesce the service around file replacement and
 * (b) start it back afterwards, while (c) never disturbing services during
 * the old-version uninstall that runs as part of an update.
 *
 * These tests lock that contract into `build/installer.nsh` so a future
 * edit cannot silently drop the stop/restart hooks.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const NSH_PATH = path.join(process.cwd(), 'build', 'installer.nsh')

function readNsh(): string {
  return fs.readFileSync(NSH_PATH, 'utf8')
}

/** Extract a `!macro NAME ... !macroend` body (empty string when absent). */
function macroBody(nsh: string, name: string): string {
  const m = nsh.match(new RegExp(`!macro\\s+${name}\\b([\\s\\S]*?)!macroend`))
  return m?.[1] ?? ''
}

describe('installer update contract (zapret services installed)', () => {
  it('stops a RUNNING zapret service before file replacement', () => {
    const nsh = readNsh()
    const body = macroBody(nsh, 'customCheckAppRunning')
    expect(body, 'customCheckAppRunning override must exist').not.toBe('')
    // Default "close the running app" behavior is preserved first, with the
    // PowerShell probe ($CmdPath/$PowerShellPath come from the template's
    // CHECK_APP_RUNNING wrapper; IS_POWERSHELL_AVAILABLE must be replicated
    // or makensis fails on unknown $IsPowerShellAvailable).
    expect(body).toContain('_CHECK_APP_RUNNING')
    expect(body).toContain('IS_POWERSHELL_AVAILABLE')
    // Only a RUNNING service is touched (missing/1060 and STOPPED skip).
    expect(body).toContain('sc query zapret')
    expect(body).toContain('RUNNING')
    // Synchronous stop; the was-running flag is set only on success.
    expect(body).toContain('net.exe" stop zapret')
    expect(body).toContain('ZguiZapretWasRunning')
  })

  it('restarts the service after install only when this install stopped it', () => {
    const nsh = readNsh()
    const body = macroBody(nsh, 'customInstall')
    expect(body).toContain('net.exe" start zapret')
    // Gated by the flag — a service the user stopped stays stopped.
    expect(body).toMatch(/ZguiZapretWasRunning.*==.*"1"/s)
  })

  it('leaves the WinDivert driver service loaded (fast reconnect)', () => {
    const nsh = readNsh()
    expect(nsh).not.toMatch(/net\.exe"\s+stop\s+WinDivert/i)
    expect(nsh).not.toMatch(/sc\s+stop\s+WinDivert/i)
  })

  it('old-version uninstall (runs during update) never removes services', () => {
    const nsh = readNsh()
    const body = macroBody(nsh, 'customUnInstall')
    expect(body, 'customUnInstall must exist').not.toBe('')
    expect(body).not.toMatch(/sc\s+delete/i)
    expect(body).not.toMatch(/net\s+stop/i)
  })
})
