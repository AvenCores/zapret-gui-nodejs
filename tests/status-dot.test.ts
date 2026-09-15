/**
 * Tray badge ↔ in-app Dot color contract.
 *
 * The tray icons (`scripts/make-icon.mjs` → `bundled-assets/tray/*.png`)
 * and the in-app `Dot` (`src/renderer/components/ui.tsx`) must render the
 * same status colors, and the logo badge in `Layout.tsx` must sit on a
 * solid disc (a transparent ring wrapper reads as a black blob at
 * taskbar-thumbnail scale). Single source of truth: STATUS_DOT_COLORS.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { STATUS_DOT_COLORS } from '../src/shared/constants'

const HEX_RE = /^#[0-9a-f]{6}$/i

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), ...rel.split('/')), 'utf8')
}

describe('status dot color contract (tray == app)', () => {
  it('STATUS_DOT_COLORS has all states as valid hexes', () => {
    for (const key of ['running', 'stopped', 'pending', 'idle'] as const) {
      expect(STATUS_DOT_COLORS[key], key).toMatch(HEX_RE)
    }
  })

  it('make-icon.mjs tray badge uses the shared hexes', () => {
    const script = readRepo('scripts/make-icon.mjs')
    expect(script).toContain('STATUS_DOT_COLORS')
    expect(script).toContain(STATUS_DOT_COLORS.running)
    expect(script).toContain(STATUS_DOT_COLORS.stopped)
    expect(script).toContain(STATUS_DOT_COLORS.idle)
  })

  it('not-installed renders red in tray and app (no gray/red split)', () => {
    // Bypass is down when the service is missing — same severity as stopped,
    // so the tray must not show gray while the app shows red.
    const script = readRepo('scripts/make-icon.mjs')
    expect(script).toMatch(/'not-installed':\s*'#ef4444'/)
    const tray = readRepo('src/main/tray.ts')
    expect(tray).toContain('STATUS_DOT_COLORS.stopped')
    expect(tray).toMatch(/not-installed[\s\S]{0,40}STATUS_DOT_COLORS\.stopped/)
  })

  it('in-app Dot renders the shared hexes (no drifted Tailwind shades)', () => {
    const ui = readRepo('src/renderer/components/ui.tsx')
    expect(ui).toContain('STATUS_DOT_COLORS')
    // Old 400-shade classes made the app dot visibly lighter than the tray.
    expect(ui).not.toContain('bg-emerald-400')
    expect(ui).not.toContain('bg-red-400')
    expect(ui).not.toContain('bg-amber-400')
    expect(ui).not.toContain('bg-slate-400')
  })

  it('logo badge is a single outlined dot (no transparent ring gap)', () => {
    const ui = readRepo('src/renderer/components/ui.tsx')
    // Tray-like badge: filled dot + contrasting stroke on one element, so no
    // transparent gap can read as a dark blob at taskbar-thumbnail scale.
    expect(ui).toContain('dark:ring-slate-950')
    const layout = readRepo('src/renderer/components/Layout.tsx')
    // Both sidebar states (collapsed + expanded) use the outlined badge.
    const badges = layout.match(/<Dot tone=\{dotTone\} pulse=\{running\}[^/]*\/>/g) ?? []
    expect(badges.length).toBeGreaterThanOrEqual(2)
    for (const b of badges) {
      expect(b).toContain('outline')
    }
    // Positioning wrapper must not paint its own disc/ring around the dot.
    const wrappers = layout.match(/-bottom-0\.5 -right-0\.5[^"]*/g) ?? []
    expect(wrappers.length).toBeGreaterThanOrEqual(2)
    for (const w of wrappers) {
      expect(w).not.toContain('rounded-full')
    }
  })
})
