/** Unit tests for exec quoting behavior (Windows-only integration). */
import { describe, it, expect } from 'vitest'
import { runCmd } from '../src/main/exec'

// Regression test: commands with embedded double quotes (tasklist /FI "...",
// reg query "HKLM\\...") must reach cmd.exe intact. Without
// windowsVerbatimArguments Node backslash-escapes the quotes and cmd fails.
describe.runIf(process.platform === 'win32')('runCmd quoting', () => {
  it('passes inner double quotes through to cmd', async () => {
    const r = await runCmd('echo "hello world"')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('hello world')
  }, 15000)

  it('tasklist /FI filter works', async () => {
    // PID of the current test runner always exists.
    const r = await runCmd(`tasklist /FI "PID eq ${process.pid}" /FO CSV /NH`)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain(String(process.pid))
  }, 15000)
})
