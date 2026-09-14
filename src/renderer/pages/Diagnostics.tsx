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
      setToolOut(Array.isArray(r) ? r.join('\n') : String(r ?? t('level.ok')))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const disabled = !status?.isAdmin

  return (
    <div className="mx-auto max-w-3xl space-y-4">
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

function ConfigTesterCard(): React.JSX.Element {
  const { t, setError, status, strategies, refreshStatus } = useUi()
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

  const isAdmin = !!status?.isAdmin
  const serviceConflict = status?.zapret !== 'NOT_INSTALLED'
  const canRun = isAdmin && !serviceConflict && !running && sel.size > 0
  const percent = progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0

  return (
    <Card title={t('diag.configTests')}>
      <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('diag.configTestsHint')}</p>

      {!isAdmin ? <p className="mb-2 text-xs font-medium text-red-600 dark:text-red-400">⚠ {t('diag.requiresAdmin')}</p> : null}
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
        <span className="flex gap-1">
          <button
            disabled={running}
            onClick={() => setSelected(new Set(strategies.map((s) => s.id)))}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-sky-600 hover:underline disabled:opacity-40 dark:text-sky-400"
          >
            {t('diag.selectAll')}
          </button>
          <button
            disabled={running}
            onClick={() => setSelected(new Set())}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-sky-600 hover:underline disabled:opacity-40 dark:text-sky-400"
          >
            {t('diag.selectNone')}
          </button>
        </span>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('diag.searchConfigs')}
        disabled={running}
        className="mb-2 w-full rounded-lg border border-transparent bg-slate-100 px-3 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-sky-500/50 focus:bg-white dark:bg-slate-900/80 dark:text-slate-100 dark:focus:bg-slate-900"
      />
      <div className="mb-3 max-h-44 overflow-y-auto rounded-lg border border-slate-200/80 p-1.5 dark:border-slate-700/60">
        {filtered.map((s) => (
          <label
            key={s.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-700/40"
          >
            <input type="checkbox" checked={sel.has(s.id)} disabled={running} onChange={() => toggle(s.id)} className="accent-sky-600" />
            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{s.name}</span>
          </label>
        ))}
        {filtered.length === 0 ? <p className="px-2 py-3 text-center text-xs text-slate-400">{t('logs.empty')}</p> : null}
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
      {cancelled ? <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-300">⚠ {t('diag.cancelled')}</p> : null}

      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="px-2 py-1 font-sans font-semibold">config</th>
                <th className="px-2 py-1">OK</th>
                <th className="px-2 py-1">ERR</th>
                <th className="px-2 py-1">UNSUP</th>
                {mode === 'standard' ? (
                  <>
                    <th className="px-2 py-1">ping✓</th>
                    <th className="px-2 py-1">ping✗</th>
                  </>
                ) : (
                  <th className="px-2 py-1">BLOCK</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.configId}
                  className={
                    r.configName === best
                      ? 'bg-emerald-500/10 font-bold text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }
                >
                  <td className="max-w-[220px] truncate px-2 py-1 font-sans">{r.configName}</td>
                  <td className="px-2 py-1 text-emerald-600 dark:text-emerald-400">{r.ok}</td>
                  <td className="px-2 py-1 text-red-500">{r.err}</td>
                  <td className="px-2 py-1 text-amber-500">{r.unsup}</td>
                  {mode === 'standard' ? (
                    <>
                      <td className="px-2 py-1">{r.pingOk}</td>
                      <td className="px-2 py-1">{r.pingFail}</td>
                    </>
                  ) : (
                    <td className="px-2 py-1 text-amber-500">{r.blocked}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !running ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('diag.noTestResults')}</p>
      ) : null}

      {filePath ? (
        <p className="mt-2 break-all text-[11px] text-slate-500 dark:text-slate-400">
          {t('diag.resultsSaved').replace('{path}', filePath)}
        </p>
      ) : null}

      {logs.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('diag.testLog')}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-black/50 dark:text-slate-200">
            {logs.join('\n')}
          </pre>
        </div>
      ) : null}
    </Card>
  )
}
