/** Strategies: pick, apply, foreground-test, import custom .bat. */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, Code, Row, Spinner } from '../components/ui'
import type { GameFilterMode, IPSetMode, Strategy } from '../../shared/types'
import type { I18nKey } from '../../shared/i18n'

function splitName(name: string): { base: string; tag: string | null } {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!m) return { base: name, tag: null }
  const base = m[1].trim()
  if (!base) return { base: name, tag: null }
  return { base, tag: m[2].trim() }
}

export default function Strategies(): React.JSX.Element {
  const { t, strategies, refreshStrategies, refreshStatus, busy, setError, status, settings, applySettings, platform } = useUi()
  const [selected, setSelected] = useState<string>('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testOut, setTestOut] = useState<string>('')
  const [query, setQuery] = useState<string>('')

  useEffect(() => {
    if (!selected) {
      const active = status?.activeStrategy ?? settings?.activeStrategyId
      const match = strategies.find((s) => s.name === active || s.id === active)
      setSelected(match?.id ?? strategies[0]?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies])

  useEffect(() => window.zapret.onTestOutput((o) => {
    if (o.stream === 'exit') {
      setTesting(null)
    } else {
      setTestOut((prev) => (prev + o.text).slice(-8000))
    }
  }), [])

  const current = strategies.find((s) => s.id === selected)
  const filtered = strategies.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
  const bundled = filtered.filter((s) => s.origin !== 'imported')
  const imported = filtered.filter((s) => s.origin === 'imported')

  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const listRef = useRef<HTMLDivElement>(null)

  const flatIds = useMemo(() => filtered.map((s) => s.id), [filtered])
  /** Strategy installed as the Windows service (registry name). */
  const installedId = strategies.find((s) => s.name === (status?.activeStrategy ?? ''))?.id ?? null
  /** Strategy picked via "Select" (persisted, does not touch the service). */
  const chosenId = settings?.activeStrategyId ?? null
  const chosen = strategies.find((s) => s.id === chosenId) ?? null
  const installed = strategies.find((s) => s.id === installedId) ?? null
  const pending = chosen !== null && chosen.id !== installedId
  const isInstalled = (s: Strategy): boolean => s.id === installedId
  const isChosen = (s: Strategy): boolean => s.id === chosenId

  useEffect(() => {
    if (flatIds.length === 0) {
      setHighlightedId(null)
      return
    }
    if (!highlightedId || !flatIds.includes(highlightedId)) {
      setHighlightedId(selected && flatIds.includes(selected) ? selected : flatIds[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, strategies.length, flatIds.join('|')])

  useEffect(() => {
    if (selected) setHighlightedId(selected)
  }, [selected])

  useEffect(() => {
    if (!highlightedId) return
    itemRefs.current.get(highlightedId)?.scrollIntoView({ block: 'nearest' })
  }, [highlightedId])

  function moveHighlight(dir: 1 | -1): void {
    if (flatIds.length === 0) return
    const idx = flatIds.indexOf(highlightedId ?? selected)
    const next = idx === -1 ? (dir === 1 ? 0 : flatIds.length - 1) : (idx + dir + flatIds.length) % flatIds.length
    setHighlightedId(flatIds[next])
  }

  function handleListKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight(-1)
    } else if (e.key === 'Enter') {
      if (highlightedId) {
        e.preventDefault()
        setSelected(highlightedId)
      }
    }
  }

  function renderRow(s: Strategy): React.JSX.Element {
    const sel = s.id === selected
    const hl = s.id === highlightedId
    const installed = isInstalled(s)
    const chosen = isChosen(s) && !installed
    const { base, tag } = splitName(s.name)
    return (
      <button
        key={s.id}
        ref={(el) => {
          if (el) itemRefs.current.set(s.id, el)
          else itemRefs.current.delete(s.id)
        }}
        role="option"
        aria-selected={sel}
        title={s.name}
        onClick={() => setSelected(s.id)}
        onDoubleClick={() => void select(s.id)}
        onMouseEnter={() => setHighlightedId(s.id)}
        onFocus={() => setHighlightedId(s.id)}
        className={[
          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] leading-tight outline-none transition-all duration-100',
          sel
            ? 'bg-sky-600 text-white shadow-md shadow-sky-600/25'
            : hl
              ? 'bg-slate-200/90 text-slate-900 dark:bg-slate-700/70 dark:text-white'
              : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-200 dark:hover:bg-slate-700/40'
        ].join(' ')}
      >
        <span
          className={[
            'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
            sel
              ? 'bg-white'
              : installed
                ? 'bg-emerald-400'
                : chosen
                  ? 'bg-sky-400'
                  : 'bg-slate-400/60 group-hover:bg-slate-400'
          ].join(' ')}
        />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{base}</span>
          {tag ? (
            <span
              className={[
                'ml-1.5 inline-block rounded-md border px-1.5 py-px align-middle font-mono text-[10.5px] font-semibold tracking-wide',
                sel
                  ? 'border-white/30 bg-white/15 text-white'
                  : 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:border-sky-400/25 dark:text-sky-300'
              ].join(' ')}
            >
              {tag}
            </span>
          ) : null}
        </span>
        {installed ? (
          <span
            className={[
              'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
              sel ? 'bg-white/20 text-white' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
            ].join(' ')}
          >
            {t('strategies.active')}
          </span>
        ) : chosen ? (
          <span
            className={[
              'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
              sel ? 'bg-white/20 text-white' : 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
            ].join(' ')}
          >
            {t('strategies.selected')}
          </span>
        ) : null}
        {sel ? (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-2" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
    )
  }

  function renderGroup(label: string, items: Strategy[], icon: React.JSX.Element): React.JSX.Element | null {
    if (items.length === 0) return null
    return (
      <div key={label}>
        <div className="sticky top-0 z-10 -mx-2 flex items-center gap-2 bg-white px-3 pb-1.5 pt-2.5 dark:bg-slate-800">
          <span className="text-slate-400 dark:text-slate-500">{icon}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {label}
          </span>
          <span className="rounded-full bg-slate-200/80 px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-600 dark:bg-slate-700/80 dark:text-slate-300">
            {items.length}
          </span>
          <span className="h-px flex-1 bg-slate-200/70 dark:bg-slate-700/50" />
        </div>
        <div className="space-y-px pb-1">{items.map(renderRow)}</div>
      </div>
    )
  }

  async function apply(id?: string): Promise<void> {
    const target = strategies.find((s) => s.id === (id ?? selected)) ?? current
    if (!target) return
    if (status?.ownership === 'foreign') {
      const binPath = status?.serviceBinPath ?? '—'
      const msg = t('dashboard.takeoverConfirm').replace('{path}', binPath)
      if (!window.confirm(`${t('action.apply')} "${target.name}"?\n${msg}`)) return
    } else if (!window.confirm(`${t('action.apply')} "${target.name}"?\n${t('strategies.applyHint')}`)) {
      return
    }
    try {
      await window.zapret.installStrategy(target.id)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Pick a strategy without touching the Windows service. */
  async function select(id?: string): Promise<void> {
    const target = strategies.find((s) => s.id === (id ?? selected)) ?? current
    if (!target || target.id === chosenId) return
    try {
      await applySettings({ activeStrategyId: target.id })
      setSelected(target.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Drop the pending pick and return to the installed strategy. */
  async function cancelSelection(): Promise<void> {
    try {
      await applySettings({ activeStrategyId: installedId })
      if (installedId) setSelected(installedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleTest(): Promise<void> {
    try {
      if (testing) {
        // Don't clear `testing` here: the main process emits an 'exit' event
        // when the child actually dies. Clearing early lets the user start a
        // new test whose indicator would then be killed by the stale exit.
        await window.zapret.stopTest()
      } else if (current) {
        setTestOut('')
        await window.zapret.testStrategy(current.id)
        setTesting(current.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function importBat(): Promise<void> {
    try {
      const s = await window.zapret.importStrategy()
      if (s) {
        await refreshStrategies()
        setSelected(s.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeStrategy(): Promise<void> {
    if (!current || current.origin !== 'imported') return
    if (!window.confirm(`${t('strategies.delete')} "${current.name}"?`)) return
    try {
      if (testing === current.id) {
        await window.zapret.stopTest()
      }
      await window.zapret.deleteStrategy(current.id)
      await refreshStrategies()
      setSelected('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('strategies.title')}</h1>
        <Btn variant="secondary" onClick={() => void importBat()}>
          {t('strategies.import')}
        </Btn>
      </div>
      {(platform ?? status?.platform) === 'linux' ? <LinuxTuning /> : null}
      {status?.ownership === 'foreign' ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-slate-700 dark:text-slate-200">
          <span className="font-semibold">⚠ {t('dashboard.foreignTitle')}: </span>
          {t('dashboard.foreignHint')}
        </div>
      ) : null}

      <Card className="overflow-hidden !p-0 dark:!bg-slate-800">
        <div className="border-b border-slate-200/80 p-2.5 dark:border-slate-700/60">
          <div className="relative">
            <svg
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-slate-400 stroke-2"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="5.5" />
              <path d="m13.5 13.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleListKey}
              placeholder={t('strategies.search')}
              className="w-full rounded-xl border border-transparent bg-slate-100 py-2 pl-9 pr-16 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-500/50 focus:bg-white focus:ring-2 focus:ring-sky-500/20 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:bg-slate-900"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                title="×"
                className="absolute right-12 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-slate-300/70 text-xs leading-none text-slate-600 transition hover:bg-slate-400/70 hover:text-slate-800 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-white"
              >
                ×
              </button>
            ) : null}
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-slate-200/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 dark:bg-slate-700/90 dark:text-slate-300">
              {filtered.length}
            </span>
          </div>
        </div>

        {filtered.length > 0 ? (
          <div
            ref={listRef}
            role="listbox"
            aria-label={t('strategies.title')}
            tabIndex={0}
            onKeyDown={handleListKey}
            className="strategy-scroll max-h-[340px] overflow-y-auto px-2 pb-2 pt-0 outline-none"
          >
            {renderGroup(
              t('strategies.bundled'),
              bundled,
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current stroke-1.5" aria-hidden="true">
                <path d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5v-5Z" strokeLinejoin="round" />
                <path d="M2 5.5 8 9l6-3.5M8 9v5" strokeLinejoin="round" />
              </svg>
            )}
            {renderGroup(
              t('strategies.imported'),
              imported,
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current stroke-1.5" aria-hidden="true">
                <path d="M8 2v8m0 0L5 7m3 3 3-3M2.5 12.5h11" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700/60">
              <svg viewBox="0 0 20 20" className="h-5 w-5 fill-none stroke-slate-400 stroke-2" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" />
                <path d="m13.5 13.5 3 3" strokeLinecap="round" />
              </svg>
            </span>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('logs.empty')}</p>
            <button
              onClick={() => setQuery('')}
              className="text-xs font-medium text-sky-600 hover:text-sky-500 hover:underline dark:text-sky-400"
            >
              × {query}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
          <span className="tabular-nums">
            {bundled.length + imported.length > 0 ? (
              <>
                {filtered.length} / {strategies.length}
              </>
            ) : null}
            {busy['strategies'] ? (
              <span className="ml-2 inline-block align-middle">
                <Spinner />
              </span>
            ) : null}
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="rounded border border-slate-300/80 bg-slate-100 px-1 font-mono text-[10px] dark:border-slate-600 dark:bg-slate-700/60">↑↓</kbd>
            <kbd className="rounded border border-slate-300/80 bg-slate-100 px-1 font-mono text-[10px] dark:border-slate-600 dark:bg-slate-700/60">Enter</kbd>
          </span>
        </div>
      </Card>

      {current ? (
        <Card title={current.name}>
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{current.description}</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {current.desyncMethods.map((m) => (
              <Badge key={m} tone="blue">
                {m}
              </Badge>
            ))}
            {isInstalled(current) ? (
              <Badge tone="green">{t('strategies.active')}</Badge>
            ) : isChosen(current) ? (
              <Badge tone="blue">{t('strategies.selected')}</Badge>
            ) : null}
            {current.origin === 'imported' ? (
              <Badge tone="yellow">{t('strategies.imported')}</Badge>
            ) : null}
          </div>
          <Code>{current.rawArgs}</Code>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('strategies.applyHint')}</p>
          {pending && chosen ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <span className="flex-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                ⚠{' '}
                {t('strategies.pendingText')
                  .replace('{chosen}', chosen.name)
                  .replace('{active}', installed?.name ?? t('dashboard.none'))}
              </span>
              <Btn variant="secondary" onClick={() => void apply(chosen.id)} disabled={!status?.isAdmin}>
                {t('action.apply')}
              </Btn>
              <Btn variant="ghost" onClick={() => void cancelSelection()}>
                {t('strategies.cancelSelection')}
              </Btn>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => void select()} disabled={isChosen(current)}>
              {t('action.select')}
            </Btn>
            <Btn variant="secondary" onClick={() => void toggleTest()} disabled={!status?.isAdmin}>
              {testing ? t('strategies.testStop') : t('action.test')}
            </Btn>
            {current.origin === 'imported' ? (
              <Btn variant="danger" onClick={() => void removeStrategy()}>
                {t('strategies.delete')}
              </Btn>
            ) : null}
          </div>
          {testing ? (
            <div className="mt-3">
              <p className="mb-1 text-xs text-amber-700 dark:text-amber-300">⚠ {t('strategies.testing')}</p>
              <Code>{testOut || t('strategies.waitingOutput')}</Code>
            </div>
          ) : null}
        </Card>
      ) : null}

      <TuningCards />
    </div>
  )
}

/**
 * Linux tuning: network interface + firewall backend + NOPASSWD status.
 * Mirrors `service.sh config` / `setup-permissions` (conf.env).
 */
function LinuxTuning(): React.JSX.Element {
  const { t, setError, status, refreshStatus } = useUi()
  const [interfaces, setInterfaces] = useState<string[]>(['any'])
  const [iface, setIface] = useState<string>(status?.linuxInterface ?? 'any')
  const [backend, setBackend] = useState<string>('auto')
  const [available, setAvailable] = useState<string[]>([])
  const [perms, setPerms] = useState<{ sudoers: boolean; doas: boolean; elevateCmd: string; nopass: boolean } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    setIface(status?.linuxInterface ?? 'any')
  }, [status?.linuxInterface])

  useEffect(() => {
    void (async () => {
      try {
        const [ifs, be, avail] = await Promise.all([
          window.zapret.listInterfaces(),
          window.zapret.getFirewallBackend(),
          window.zapret.listFirewallBackends()
        ])
        setInterfaces(ifs.length > 0 ? ifs : ['any'])
        setBackend(be)
        setAvailable(avail)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      try {
        setPerms(await window.zapret.getPermissionsStatus())
      } catch {
        setPerms(null)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function wrap(key: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyKey(key)
    try {
      await fn()
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  const disabled = !status?.isAdmin || busyKey !== null
  const permsOk = perms !== null && (perms.nopass || perms.sudoers || perms.doas)

  return (
    <Card title={`${t('linux.interface')} / ${t('linux.firewallBackend')}`}>
      <Row label={t('linux.interface')}>
        <select
          value={iface}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value
            setIface(v)
            void wrap('iface', () => window.zapret.setInterface(v))
          }}
          className="rounded-md bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700"
        >
          {interfaces.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('linux.firewallBackend')}>
        <span className="flex flex-wrap gap-2">
          {(['auto', 'nftables', 'iptables'] as const).map((b) => {
            const installed = b === 'auto' || available.includes(b)
            return (
              <Btn
                key={b}
                variant={backend === b ? 'primary' : 'secondary'}
                disabled={disabled || !installed}
                onClick={() => {
                  setBackend(b)
                  void wrap('fw', () => window.zapret.setFirewallBackend(b))
                }}
              >
                {b === 'auto' ? t('linux.firewallAuto') : b}
              </Btn>
            )
          })}
        </span>
      </Row>
      <Row label={t('linux.permissions')}>
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={permsOk ? 'green' : 'yellow'}>
            {perms === null ? '…' : permsOk ? t('linux.permissionsOk') : t('linux.permissionsMissing')}
          </Badge>
          <Btn
            variant="secondary"
            disabled={busyKey !== null}
            onClick={() =>
              void wrap('perms', async () => {
                await window.zapret.setupPermissions()
                setPerms(await window.zapret.getPermissionsStatus())
              })
            }
          >
            {busyKey === 'perms' ? <Spinner /> : t('linux.setupPermissions')}
          </Btn>
        </span>
      </Row>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('linux.permissionsHint')}</p>
    </Card>
  )
}

const GAME_VALUES: GameFilterMode[] = ['disabled', 'all', 'tcp', 'udp']

const IPSET_VALUES: IPSetMode[] = ['none', 'loaded', 'any']

function gameLabel(t: (k: I18nKey) => string, v: GameFilterMode): string {
  switch (v) {
    case 'disabled':
      return t('settings.gameDisabled')
    case 'all':
      return t('settings.gameAll')
    case 'tcp':
      return t('settings.gameTcp')
    case 'udp':
      return t('settings.gameUdp')
  }
}

function ipsetLabel(t: (k: I18nKey) => string, v: IPSetMode): string {
  switch (v) {
    case 'none':
      return t('settings.ipsetNone')
    case 'loaded':
      return t('settings.ipsetLoaded')
    case 'any':
      return t('settings.ipsetAny')
  }
}

/**
 * Bypass tuning that lives with the strategies: game filter, IPSet mode and
 * active fakes. Applied on top of the installed strategy (service restart
 * needed to take effect).
 */
function TuningCards(): React.JSX.Element {
  const { t, setError, status } = useUi()
  const [game, setGame] = useState<GameFilterMode>('disabled')
  const [ipset, setIpset] = useState<IPSetMode>('none')
  const [fakes, setFakes] = useState<{ discordActive: string | null; gameActive: string | null; all: string[] }>({
    discordActive: null,
    gameActive: null,
    all: []
  })
  const [discordFake, setDiscordFake] = useState<string>('')
  const [gameFake, setGameFake] = useState<string>('')

  useEffect(() => {
    void (async () => {
      try {
        const [g, i, f] = await Promise.all([
          window.zapret.getGameFilter(),
          window.zapret.getIPSetMode(),
          window.zapret.listFakes()
        ])
        setGame(g)
        setIpset(i)
        setFakes(f)
        setDiscordFake(f.discordActive ?? f.all[0] ?? '')
        setGameFake(f.gameActive ?? f.all[0] ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function wrap(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const disabled = !status?.isAdmin

  return (
    <>
      <Card title={t('settings.gameFilter')}>
        <div className="flex flex-wrap gap-2">
          {GAME_VALUES.map((v) => (
            <Btn
              key={v}
              variant={game === v ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => void wrap(async () => {
                await window.zapret.setGameFilter(v)
                setGame(v)
              })}
            >
              {gameLabel(t, v)}
            </Btn>
          ))}
        </div>
      </Card>

      <Card title={t('settings.ipset')}>
        <div className="flex flex-wrap gap-2">
          {IPSET_VALUES.map((v) => (
            <Btn
              key={v}
              variant={ipset === v ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => void wrap(async () => {
                await window.zapret.setIPSetMode(v)
                setIpset(v)
              })}
            >
              {ipsetLabel(t, v)}
            </Btn>
          ))}
        </div>
      </Card>

      <Card title={t('settings.fakes')}>
        <Row label={`${t('settings.discordFake')} (${fakes.discordActive ?? '?'})`}>
          <select
            value={discordFake}
            onChange={(e) => setDiscordFake(e.target.value)}
            className="rounded-md bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700"
          >
            {fakes.all.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <Btn
            variant="secondary"
            disabled={disabled || !discordFake}
            onClick={() => void wrap(async () => {
              await window.zapret.replaceFake('discord', discordFake)
              const v = discordFake
              setFakes((prev) => ({ ...prev, discordActive: v }))
            })}
          >
            {t('action.apply')}
          </Btn>
        </Row>
        <Row label={`${t('settings.gameFake')} (${fakes.gameActive ?? '?'})`}>
          <select value={gameFake} onChange={(e) => setGameFake(e.target.value)} className="rounded-md bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700">
            {fakes.all.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <Btn
            variant="secondary"
            disabled={disabled || !gameFake}
            onClick={() => void wrap(async () => {
              await window.zapret.replaceFake('game', gameFake)
              const v = gameFake
              setFakes((prev) => ({ ...prev, gameActive: v }))
            })}
          >
            {t('action.apply')}
          </Btn>
        </Row>
      </Card>
    </>
  )
}
