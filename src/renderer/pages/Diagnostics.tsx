/** Diagnostics page: checks table + tools + native config tester. */
import React, { useEffect, useMemo, useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, ProgressBar, Spinner } from '../components/ui'
import { formatDetail } from '../../shared/i18n'
import type { ConfigTesterAnalyticsRow, ConfigTesterEvent, ConfigTestMode, DiagnosticCheck } from '../../shared/types'

function tone(level: DiagnosticCheck['level']): 'green' | 'yellow' | 'red' {
  return level === 'ok' ? 'green' : level === 'warn' ? 'yellow' : 'red'
}

function icon(level: DiagnosticCheck['level']): string {
  return level === 'ok' ? '✅' : level === 'warn' ? '⚠️' : '❌'
}

export default function Diagnostics(): React.JSX.Element {
  const { t, setError, status, locale } = useUi()
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null)
  const [running, setRunning] = useState<boolean>(false)
  const [toolOut, setToolOut] = useState<string | null>(null)

  async function run(): Promise<void> {
    setRunning(true)
    setToolOut(null)
    try {
      setChecks(await window.zapret.runDiagnostics())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function tool(key: 'cache' | 'conflicts', fn: () => Promise<unknown>): Promise<void> {
    try {
      const r = await fn()
      if (key === 'conflicts' && Array.isArray(r)) {
        const names = (r as unknown[]).map(String)
        setToolOut(names.length > 0 ? t('tool.conflictsRemoved').replace('{list}', names.join(', ')) : t('tool.conflictsNone'))
      } else {
        setToolOut(Array.isArray(r) ? (r as unknown[]).map(String).join('\n') : String(r ?? t('level.ok')))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const disabled = !status?.isAdmin

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.diagnostics')}</h1>
        {checks ? (
          <Btn onClick={() => void run()} disabled={running}>
            {running ? <Spinner /> : t('diag.run')}
          </Btn>
        ) : null}
      </div>

      {checks ? (
        <Card>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700/60">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="text-sm font-medium">
                    {icon(c.level)} {t(c.labelKey as never)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{formatDetail(locale, c)}</div>
                </div>
                <Badge tone={tone(c.level)}>{t(`level.${c.level}` as never)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
              </svg>
            </span>
            <div className="text-sm font-semibold">{t('diag.emptyTitle')}</div>
            <p className="max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('diag.emptyHint')}</p>
            <div className="mt-1">
              <Btn onClick={() => void run()} disabled={running}>
                {running ? <Spinner /> : t('diag.run')}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card title={t('diag.tools')}>
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" disabled={disabled} onClick={() => void tool('cache', () => window.zapret.clearDiscordCache())}>
            {t('diag.clearDiscord')}
          </Btn>
          <Btn
            variant="danger"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(t('diag.removeConflicts') + '?')) void tool('conflicts', () => window.zapret.removeConflicts())
            }}
          >
            {t('diag.removeConflicts')}
          </Btn>
        </div>
        {toolOut ? (
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[11px] text-slate-800 dark:bg-black/50 dark:text-slate-200">
            {toolOut}
          </pre>
        ) : null}
      </Card>

      <ConfigTesterCard />
    </div>
  )
}

function splitStrategyName(name: string): { base: string; tag: string | null } {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!m) return { base: name, tag: null }
  const base = m[1].trim()
  if (!base) return { base: name, tag: null }
  return { base, tag: m[2].trim() }
}

/** Colored count pill for the results table (zeros muted). */
function Num(props: { value: number; tone: 'green' | 'red' | 'amber' | 'slate' }): React.JSX.Element {
  const muted = props.value === 0
  const cls =
    props.tone === 'green'
      ? muted
        ? 'bg-slate-500/10 text-slate-400 dark:text-slate-500'
        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : props.tone === 'red'
        ? muted
          ? 'bg-slate-500/10 text-slate-400 dark:text-slate-500'
          : 'bg-red-500/15 text-red-600 dark:text-red-300'
        : props.tone === 'amber'
          ? muted
            ? 'bg-slate-500/10 text-slate-400 dark:text-slate-500'
            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : 'bg-slate-500/10 text-slate-500 dark:text-slate-400'
  return <span className={`inline-block min-w-[28px] rounded-md px-1.5 py-0.5 text-center font-semibold ${cls}`}>{props.value}</span>
}

function ConfigTesterCard(): React.JSX.Element {
  const { t, setError, status, strategies, refreshStatus, platform } = useUi()
  const isLinux = (platform ?? status?.platform) === 'linux'
  const [mode, setMode] = useState<ConfigTestMode>('standard')
  const [query, setQuery] = useState<string>('')
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [running, setRunning] = useState<boolean>(false)
  const [progress, setProgress] = useState<{ completed: number; total: number; current: string } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [rows, setRows] = useState<ConfigTesterAnalyticsRow[]>([])
  const [best, setBest] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState<boolean>(false)

  useEffect(
    () =>
      window.zapret.onConfigTesterEvent((e: ConfigTesterEvent) => {
        if (e.kind === 'log') {
          setLogs((prev) => [...prev.slice(-400), e.text])
        } else if (e.kind === 'config-start') {
          setProgress({ completed: e.index - 1, total: e.total, current: e.configName })
          setLogs((prev) => [...prev.slice(-400), `[${e.index}/${e.total}] ${e.configName}`])
        } else if (e.kind === 'progress') {
          setProgress({ completed: e.completed, total: e.total, current: e.current })
        } else if (e.kind === 'config-done') {
          setProgress({ completed: e.index, total: e.total, current: e.configName })
        } else if (e.kind === 'done') {
          setRunning(false)
          setRows(e.rows)
          setBest(e.best)
          setFilePath(e.filePath)
          setCancelled(e.cancelled)
          setProgress((p) => (p ? { ...p, completed: p.total } : p))
        }
      }),
    []
  )

  const filtered = useMemo(
    () => strategies.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())),
    [strategies, query]
  )
  // Default: all selected once strategies load.
  const sel: Set<string> = selected ?? new Set(strategies.map((s) => s.id))

  function toggle(id: string): void {
    setSelected((prev) => {
      const base = prev ?? new Set(strategies.map((s) => s.id))
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function start(): Promise<void> {
    const ids = [...sel]
    if (ids.length === 0) {
      setError(t('diag.noTestResults'))
      return
    }
    setLogs([])
    setRows([])
    setBest(null)
    setFilePath(null)
    setCancelled(false)
    setProgress({ completed: 0, total: ids.length, current: '' })
    setRunning(true)
    try {
      await window.zapret.startConfigTester(ids, mode)
    } catch (e) {
      setRunning(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function stop(): Promise<void> {
    try {
      await window.zapret.stopConfigTester()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function applyBest(): Promise<void> {
    if (!best) return
    const target = strategies.find((s) => s.name === best)
    if (!target) {
      setError(best)
      return
    }
    if (!window.confirm(`${t('action.apply')} "${target.name}"?`)) return
    try {
      await window.zapret.installStrategy(target.id)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function openResults(): Promise<void> {
    if (!filePath) return
    try {
      await window.zapret.openTestResult(filePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const isAdmin = !!status?.isAdmin
  const serviceConflict = status?.zapret !== 'NOT_INSTALLED'
  const canRun = isAdmin && !serviceConflict && !running && sel.size > 0
  const percent = progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0

  return (
    <Card title={t('diag.configTests')}>
      {!isAdmin ? <p className="mb-2 text-xs font-medium text-red-600 dark:text-red-400">⚠ {t(isLinux ? 'diag.requiresRoot' : 'diag.requiresAdmin')}</p> : null}
      {serviceConflict ? (
        <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">⚠ {t('diag.removeServiceFirst')}</p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <Btn variant={mode === 'standard' ? 'primary' : 'secondary'} onClick={() => setMode('standard')} disabled={running}>
          {t('diag.modeStandard')}
        </Btn>
        <Btn variant={mode === 'dpi' ? 'primary' : 'secondary'} onClick={() => setMode('dpi')} disabled={running}>
          {t('diag.modeDpi')}
        </Btn>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {t('diag.selectConfigs')} ({sel.size}/{strategies.length})
        </span>
        <span className="flex items-center gap-1.5">
          <button
            disabled={running}
            onClick={() => setSelected(new Set(strategies.map((s) => s.id)))}
            title={t('diag.selectAll')}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600/60 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:border-sky-400/40 dark:hover:bg-sky-400/10 dark:hover:text-sky-300"
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current stroke-2" aria-hidden="true">
              <path d="M2.5 8.5 6 12 13.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('diag.selectAll')}
          </button>
          <button
            disabled={running}
            onClick={() => setSelected(new Set())}
            title={t('diag.selectNone')}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600/60 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:border-red-400/40 dark:hover:bg-red-400/10 dark:hover:text-red-300"
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current stroke-2" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
            {t('diag.selectNone')}
          </button>
        </span>
      </div>

      <div className="relative mb-2">
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
          placeholder={t('diag.searchConfigs')}
          disabled={running}
          className="w-full rounded-xl border border-transparent bg-slate-100 py-2 pl-9 pr-8 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-500/50 focus:bg-white focus:ring-2 focus:ring-sky-500/20 disabled:opacity-50 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:bg-slate-900"
        />
        {query ? (
          <button
            onClick={() => setQuery('')}
            disabled={running}
            title="×"
            className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-slate-300/70 text-xs leading-none text-slate-600 transition hover:bg-slate-400/70 hover:text-slate-800 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-white"
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="strategy-scroll mb-3 max-h-[380px] space-y-0.5 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/60 p-1.5 dark:border-slate-700/60 dark:bg-slate-900/40">
        {filtered.map((s) => {
          const checked = sel.has(s.id)
          const { base, tag } = splitStrategyName(s.name)
          return (
            <label
              key={s.id}
              title={s.name}
              className={[
                'group flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-[7px] text-left text-[13px] leading-tight outline-none transition-all duration-100',
                running ? 'cursor-not-allowed opacity-60' : '',
                checked
                  ? 'border-sky-500/30 bg-sky-500/10 shadow-sm shadow-sky-500/10 dark:border-sky-400/25 dark:bg-sky-400/10'
                  : 'border-transparent hover:border-slate-200 hover:bg-white dark:hover:border-slate-700/60 dark:hover:bg-slate-800/70'
              ].join(' ')}
            >
              <input type="checkbox" checked={checked} disabled={running} onChange={() => toggle(s.id)} className="sr-only" />
              <span
                className={[
                  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-all duration-100',
                  checked
                    ? 'border-sky-600 bg-sky-600 text-white shadow-sm shadow-sky-600/30 dark:border-sky-500 dark:bg-sky-500'
                    : 'border-slate-300 bg-white text-transparent group-hover:border-sky-500/60 dark:border-slate-600 dark:bg-slate-800'
                ].join(' ')}
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current stroke-[2.5]" aria-hidden="true">
                  <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-slate-700 dark:text-slate-200">{base}</span>
                {tag ? (
                  <span className="ml-1.5 inline-block rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-px align-middle font-mono text-[10.5px] font-semibold tracking-wide text-sky-700 dark:border-sky-400/25 dark:text-sky-300">
                    {tag}
                  </span>
                ) : null}
              </span>
              <span
                className={[
                  'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                  checked ? 'bg-sky-500 dark:bg-sky-400' : 'bg-slate-300/60 group-hover:bg-slate-400/70 dark:bg-slate-600/60'
                ].join(' ')}
              />
            </label>
          )
        })}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200/70 dark:bg-slate-700/50">
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-slate-400 stroke-2" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" />
                <path d="m13.5 13.5 3 3" strokeLinecap="round" />
              </svg>
            </span>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('logs.empty')}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Btn onClick={() => void start()} disabled={!canRun}>
            {t('diag.startTests')}
          </Btn>
        ) : (
          <Btn variant="danger" onClick={() => void stop()}>
            {t('diag.stopTests')}
          </Btn>
        )}
        {running && progress ? (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {t('diag.testingProgress').replace('{done}', String(progress.completed)).replace('{total}', String(progress.total)).replace('{current}', progress.current)}
          </span>
        ) : null}
      </div>
      {progress ? (
        <div className="mt-2">
          <ProgressBar percent={percent} />
        </div>
      ) : null}

      {best || cancelled || rows.length > 0 ? (
        <div className="mx-1 mt-4 h-px bg-slate-200/80 dark:bg-slate-700/60" />
      ) : null}

      {best ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            ✅ {t('diag.bestConfig').replace('{name}', best)}
          </span>
          <Btn variant="secondary" onClick={() => void applyBest()} disabled={!isAdmin}>
            {t('diag.applyBest')}
          </Btn>
        </div>
      ) : null}
      {cancelled ? (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current" aria-hidden="true">
              <rect x="3" y="3" width="4" height="10" rx="1" />
              <rect x="9" y="3" width="4" height="10" rx="1" />
            </svg>
            {t('diag.cancelled')}
          </span>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/80 shadow-sm dark:border-slate-700/60">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-900/60">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('diag.results')} · {rows.length}
            </span>
            {best ? (
              <span className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 fill-none stroke-current stroke-2" aria-hidden="true">
                  <path d="M2.5 8.5 6 12 13.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate">{best}</span>
              </span>
            ) : null}
          </div>
          <div className="strategy-scroll max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-100/95 backdrop-blur dark:bg-slate-800/95">
                <tr className="text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2 font-semibold">config</th>
                  <th className="px-2 py-2 text-right font-semibold">OK</th>
                  <th className="px-2 py-2 text-right font-semibold">ERR</th>
                  <th className="px-2 py-2 text-right font-semibold">UNSUP</th>
                  {mode === 'standard' ? (
                    <>
                      <th className="px-2 py-2 text-right font-semibold">ping✓</th>
                      <th className="px-2 py-2 text-right font-semibold">ping✗</th>
                    </>
                  ) : (
                    <th className="px-2 py-2 text-right font-semibold">BLOCK</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/40">
                {rows.map((r) => {
                  const isBest = r.configName === best
                  const { base, tag } = splitStrategyName(r.configName)
                  return (
                    <tr
                      key={r.configId}
                      title={r.configName}
                      className={
                        isBest
                          ? 'bg-emerald-500/10 font-medium text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/15'
                          : 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-700/30'
                      }
                    >
                      <td className="max-w-[220px] truncate px-3 py-1.5">
                        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                          {isBest ? (
                            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-2 text-emerald-500" aria-hidden="true">
                              <path d="M2.5 8.5 6 12 13.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                          <span className="truncate font-medium">{base}</span>
                          {tag ? (
                            <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-1 py-px font-mono text-[10px] font-semibold text-sky-700 dark:border-sky-400/25 dark:text-sky-300">
                              {tag}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Num value={r.ok} tone="green" />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Num value={r.err} tone="red" />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Num value={r.unsup} tone="amber" />
                      </td>
                      {mode === 'standard' ? (
                        <>
                          <td className="px-2 py-1.5 text-right">
                            <Num value={r.pingOk} tone="slate" />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <Num value={r.pingFail} tone={r.pingFail > 0 ? 'red' : 'slate'} />
                          </td>
                        </>
                      ) : (
                        <td className="px-2 py-1.5 text-right">
                          <Num value={r.blocked} tone={r.blocked > 0 ? 'amber' : 'slate'} />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : !running ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('diag.noTestResults')}</p>
      ) : null}

      {filePath ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-100 py-1.5 pl-2.5 pr-1.5 dark:border-slate-700/60 dark:bg-black/40">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-none stroke-slate-400 stroke-[1.8]" aria-hidden="true">
            <path d="M2.5 6.5a2 2 0 0 1 2-2h4l2 2.5h5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" strokeLinejoin="round" />
          </svg>
          <span title={filePath} className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {filePath}
          </span>
          <button
            onClick={() => void openResults()}
            title={t('diag.openFolder')}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-300/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-sky-500/40 hover:text-sky-700 active:scale-95 dark:border-slate-600/60 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:border-sky-400/40 dark:hover:text-sky-300"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.8]" aria-hidden="true">
              <path d="M2.5 6.5a2 2 0 0 1 2-2h4l2 2.5h5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" strokeLinejoin="round" />
              <path d="M10 10.5v4m0-4-1.5 1.5M10 10.5l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('diag.openFolder')}
          </button>
        </div>
      ) : null}

      {logs.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/80 shadow-sm dark:border-slate-700/60">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-900/60">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('diag.testLog')}
            </span>
            <span className="rounded-full bg-slate-500/10 px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
              {logs.length}
            </span>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-slate-100 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-black/50 dark:text-slate-200">
            {logs.join('\n')}
          </pre>
        </div>
      ) : null}
    </Card>
  )
}
