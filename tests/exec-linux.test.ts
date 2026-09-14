/** Unit tests for the Linux root-relaunch helpers (pure, cross-platform). */
import { describe, it, expect, afterEach } from 'vitest'
import {
  ensureNoSandbox,
  pickGuiEnv,
  findGuiTerminal,
  buildTerminalArgs
} from '../src/main/exec'

const savedTerminal = process.env.TERMINAL

afterEach(() => {
  if (savedTerminal === undefined) delete process.env.TERMINAL
  else process.env.TERMINAL = savedTerminal
})

describe('ensureNoSandbox', () => {
  it('appends --no-sandbox when missing (Chromium refuses root otherwise)', () => {
    expect(ensureNoSandbox(['/app/zap'])).toEqual(['/app/zap', '--no-sandbox'])
  })
  it('does not duplicate the flag', () => {
    expect(ensureNoSandbox(['/app/zap', '--no-sandbox'])).toEqual(['/app/zap', '--no-sandbox'])
  })
})

describe('pickGuiEnv', () => {
  it('forwards display-related vars for pkexec (Wayland included)', () => {
    expect(
      pickGuiEnv({
        DISPLAY: ':0',
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_RUNTIME_DIR: '/run/user/1000',
        XAUTHORITY: '/home/u/.Xauthority',
        XDG_SESSION_TYPE: 'wayland',
        HOME: '/home/u',
        SECRET: 'x'
      })
    ).toEqual([
      'DISPLAY=:0',
      'WAYLAND_DISPLAY=wayland-0',
      'XDG_RUNTIME_DIR=/run/user/1000',
      'XAUTHORITY=/home/u/.Xauthority',
      'XDG_SESSION_TYPE=wayland'
    ])
  })
  it('forwards the session bus so the root copy keeps its tray icon', () => {
    expect(pickGuiEnv({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' })).toEqual([
      'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus'
    ])
  })
  it('skips missing and empty values', () => {
    expect(pickGuiEnv({ DISPLAY: '', OTHER: 'y' })).toEqual([])
  })
})

describe('findGuiTerminal', () => {
  it('returns null when nothing is installed', () => {
    delete process.env.TERMINAL
    expect(findGuiTerminal(() => false)).toBeNull()
  })
  it('prefers the freedesktop dispatcher first', () => {
    delete process.env.TERMINAL
    const has = (n: string): boolean => n === 'xdg-terminal-exec' || n === 'gnome-terminal'
    expect(findGuiTerminal(has)).toEqual({ cmd: 'xdg-terminal-exec', mode: 'direct' })
  })
  it('falls through to GNOME/KDE/X11 terminals in order', () => {
    delete process.env.TERMINAL
    expect(findGuiTerminal((n) => n === 'konsole')).toEqual({ cmd: 'konsole', mode: 'e' })
    expect(findGuiTerminal((n) => n === 'gnome-terminal')).toEqual({ cmd: 'gnome-terminal', mode: 'dd' })
    expect(findGuiTerminal((n) => n === 'xterm')).toEqual({ cmd: 'xterm', mode: 'e' })
  })
  it('honours $TERMINAL override (first token)', () => {
    process.env.TERMINAL = 'myterm --flag'
    expect(findGuiTerminal((n) => n === 'myterm')).toEqual({ cmd: 'myterm', mode: 'e' })
  })
  it('ignores a $TERMINAL that is not installed', () => {
    process.env.TERMINAL = 'ghost-term'
    expect(findGuiTerminal((n) => n === 'xterm')).toEqual({ cmd: 'xterm', mode: 'e' })
  })
})

describe('buildTerminalArgs', () => {
  it('uses -- for dd terminals (gnome-terminal)', () => {
    expect(buildTerminalArgs({ cmd: 'gnome-terminal', mode: 'dd' }, 'sudo', ['/app/zap'])).toEqual([
      '--',
      'sudo',
      '/app/zap'
    ])
  })
  it('uses -e for classic terminals', () => {
    expect(buildTerminalArgs({ cmd: 'konsole', mode: 'e' }, 'sudo', ['/app/zap'])).toEqual([
      '-e',
      'sudo',
      '/app/zap'
    ])
  })
  it('appends directly for kitty/xdg-terminal-exec', () => {
    expect(buildTerminalArgs({ cmd: 'kitty', mode: 'direct' }, 'sudo', ['/app/zap'])).toEqual([
      'sudo',
      '/app/zap'
    ])
  })
})
