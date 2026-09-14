/** Dashboard: service status, bypass test, quick actions. */
import React, { useEffect, useState } from 'react'
import { bypassStrategyKeyOf, useUi } from '../store'
import { Badge, Btn, Card, Dot, Row, Spinner } from '../components/ui'
import { BYPASS_TARGETS } from '../../shared/constants'
import type { BypassCheckResult, BypassTargetId, ServiceState } from '../../shared/types'

function stateTone(s: ServiceState): 'green' | 'red' | 'gray' | 'yellow' {
  if (s === 'RUNNING') return 'green'
  if (s === 'STOPPED' || s === 'NOT_INSTALLED') return 'red'
  if (s === 'START_PENDING' || s === 'STOP_PENDING') return 'yellow'
  return 'gray'
}

function stateKey(s: ServiceState): 'running' | 'stopped' | 'not-installed' | 'unknown' {
  if (s === 'RUNNING') return 'running'
  if (s === 'STOPPED') return 'stopped'
  if (s === 'NOT_INSTALLED') return 'not-installed'
  return 'unknown'
}

/** First token of a service ImagePath (`"C:\...\winws.exe" --args` → `"C:\...\winws.exe"`). */
function shortExePath(full: string): string {
  const s = full.trim()
  if (s === '' || s === '—') return s
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    if (end > 1) return s.slice(0, end + 1)
  }
  return s.split(/\s+/)[0] ?? s
}

type BypassUi =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; latencyMs: number; httpStatus: number | null }
  | { status: 'fail'; latencyMs?: number; httpStatus?: number | null; error?: string | null }

/** Map a cached check result to UI state (null = never checked). */
function toBypassUi(r: BypassCheckResult | null): BypassUi {
  if (!r) return { status: 'idle' }
  return r.ok
    ? { status: 'ok', latencyMs: r.latencyMs, httpStatus: r.httpStatus }
    : { status: 'fail', latencyMs: r.latencyMs, httpStatus: r.httpStatus, error: r.error }
}

function BypassTest(): React.JSX.Element {
  const { t, status, settings, bypass, bypassChecking, bypassCheckingAll, bypassStrategyKey, checkBypassOne, checkBypassAll } =
    useUi()
  const strategyKey = bypassStrategyKeyOf(status?.activeStrategy ?? null, settings?.activeStrategyId ?? null)

  // Results live in the global store, so tab switches remount this component
  // without losing them. Auto-check only on first ever visit or when the
  // active strategy changed since the last measurement.
  useEffect(() => {
    const hasAny = bypass.youtube !== null || bypass.cloudflare !== null || bypass.discord !== null
    if (!hasAny || bypassStrategyKey !== strategyKey) {
      void checkBypassAll(strategyKey)
    }
    // Intentionally not depending on `bypass`: results arriving must not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyKey])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
          {t('dashboard.bypassTitle')}
        </h2>
        <Btn variant="secondary" onClick={() => void checkBypassAll(strategyKey)} disabled={bypassCheckingAll}>
          {bypassCheckingAll ? <Spinner /> : t('dashboard.bypassCheckAll')}
        </Btn>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {BYPASS_TARGETS.map((target) => {
          const checking = bypassChecking[target.id] || bypassCheckingAll
          const state: BypassUi = checking ? { status: 'checking' } : toBypassUi(bypass[target.id])
          return (
            <Card key={target.id}>
              <div className="flex items-center gap-2">
                <BypassIcon id={target.id} />
                <div className="min-w-0 flex-1 truncate text-sm font-semibold">{target.name}</div>
                <BypassBadge state={state} />
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={target.host}>
                {target.host}
              </div>
              <div className="mt-2 min-h-[20px] break-all text-xs text-slate-500 dark:text-slate-400">
                <BypassDetail state={state} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Btn
                  variant="secondary"
                  onClick={() => void checkBypassOne(target.id)}
                  disabled={checking || bypassCheckingAll}
                >
                  {checking ? <Spinner /> : t('dashboard.bypassCheck')}
                </Btn>
                <a
                  href={target.openUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700/60"
                >
                  {t('dashboard.bypassOpen')} <span aria-hidden className="text-xs opacity-60">↗</span>
                </a>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function BypassBadge(props: { state: BypassUi }): React.JSX.Element {
  const { t } = useUi()
  const { state } = props
  if (state.status === 'checking') {
    return (
      <Badge tone="yellow">
        <Spinner />
        {t('dashboard.bypassChecking')}
      </Badge>
    )
  }
  if (state.status === 'ok') return <Badge tone="green">✓ {t('dashboard.bypassOk')}</Badge>
  if (state.status === 'fail') return <Badge tone="red">✕ {t('dashboard.bypassFail')}</Badge>
  return <Badge tone="gray">{t('dashboard.bypassIdle')}</Badge>
}

function BypassDetail(props: { state: BypassUi }): React.JSX.Element {
  const { state } = props
  if (state.status === 'ok') {
    return (
      <span>
        {state.httpStatus != null ? `HTTP ${state.httpStatus} · ` : ''}
        {state.latencyMs} ms
      </span>
    )
  }
  if (state.status === 'fail') {
    const parts: string[] = []
    if (state.httpStatus != null) parts.push(`HTTP ${state.httpStatus}`)
    if (state.latencyMs != null) parts.push(`${state.latencyMs} ms`)
    if (state.error) parts.push(state.error)
    return <span>{parts.join(' · ') || '—'}</span>
  }
  return <span>—</span>
}

function BypassIcon(props: { id: BypassTargetId }): React.JSX.Element {
  if (props.id === 'youtube') return <YoutubeIcon />
  if (props.id === 'discord') return <DiscordIcon />
  return <CloudIcon />
}

export default function Dashboard(): React.JSX.Element {
  const { t, status, refreshStatus, busy, setError, settings, setPage } = useUi()
  const [foreignExpanded, setForeignExpanded] = useState(false)

  useEffect(() => {
    const offStart = window.zapret.onTrayStart(() => void doAction('start'))
    const offStop = window.zapret.onTrayStop(() => void doAction('stop'))
    return () => {
      offStart()
      offStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const foreignPathKey = status?.serviceBinPath ?? status?.winwsPath ?? '—'
  useEffect(() => {
    setForeignExpanded(false)
  }, [foreignPathKey])

  async function doAction(kind: 'start' | 'stop' | 'restart' | 'refresh' | 'remove'): Promise<void> {
    try {
      const foreign = status?.ownership === 'foreign'
      if ((kind === 'start' || kind === 'stop' || kind === 'restart') && foreign) {
        setError(t('dashboard.foreignHint'))
        return
      }
      if (kind === 'start') await window.zapret.startService()
      if (kind === 'stop') await window.zapret.stopService()
      if (kind === 'restart') {
        await window.zapret.stopService().catch(() => undefined)
        await window.zapret.startService()
      }
      if (kind === 'remove') {
        const binPath = status?.serviceBinPath ?? '—'
        if (foreign) {
          const msg = t('dashboard.removeForeignConfirm').replace('{path}', binPath)
          if (!window.confirm(msg)) return
        } else if (!window.confirm(t('action.remove') + '?')) {
          return
        }
        await window.zapret.removeServices()
      }
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const running = status.zapret === 'RUNNING'
  const foreign = status.ownership === 'foreign'
  const portableForeign = status.zapret === 'NOT_INSTALLED' && status.winwsRunning
  const serviceTone = foreign ? 'yellow' : stateTone(status.zapret)
  const serviceLabel = foreign
    ? `${status.zapret === 'RUNNING' ? t('status.running') : t(`status.${stateKey(status.zapret)}`)} · ${t('status.foreign')}`
    : status.zapret === 'RUNNING'
      ? t('status.running')
      : t(`status.${stateKey(status.zapret)}`)
  const foreignPath = status.serviceBinPath ?? status.winwsPath ?? '—'
  const foreignExe = shortExePath(foreignPath)
  const foreignStrategy = status.activeStrategy ?? t('dashboard.none')
  const fill = (s: string): string =>
    s.replace('{path}', foreignExe).replace('{strategy}', foreignStrategy)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>

      {foreign ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-semibold text-amber-800 dark:text-amber-200">⚠ {t('dashboard.foreignTitle')}</div>
          <div className="mt-1 text-slate-700 dark:text-slate-200">{fill(t('dashboard.foreignDesc'))}</div>
          <div className={`mt-1 break-all font-mono text-[11px] text-slate-600 dark:text-slate-300 ${foreignExpanded ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}>
            {foreignPath}
          </div>
          <button
            type="button"
            onClick={() => setForeignExpanded((v) => !v)}
            className="mt-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
          >
            {foreignExpanded ? t('action.less') : t('action.more')}
          </button>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t('dashboard.foreignHint')}</div>
        </div>
      ) : null}
      {!foreign && portableForeign ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-semibold text-amber-800 dark:text-amber-200">⚠ {t('dashboard.portableTitle')}</div>
          <div className="mt-1 text-slate-700 dark:text-slate-200">{fill(t('dashboard.portableDesc'))}</div>
        </div>
      ) : null}

      <Card>
        <Row label={t('dashboard.service')}>
          <Badge tone={serviceTone}>
            <Dot tone={serviceTone} pulse={running} />
            {serviceLabel}
          </Badge>
        </Row>
        <Row label={t('dashboard.windivert')}>
          <Badge tone={stateTone(status.windivert)}>
            <Dot tone={stateTone(status.windivert)} pulse={status.windivert === 'RUNNING'} />
            {status.windivert === 'RUNNING' ? t('status.running') : t(`status.${stateKey(status.windivert)}`)}
          </Badge>
        </Row>
        <Row label={t('dashboard.winws')}>
          <Badge tone={status.winwsRunning ? 'green' : 'red'}>
            <Dot tone={status.winwsRunning ? 'green' : 'red'} pulse={status.winwsRunning} />
            {status.winwsRunning ? t('status.running') : t('status.stopped')}
          </Badge>
        </Row>
        <Row label={t('dashboard.strategy')}>
          <span className="text-sm text-slate-900 dark:text-slate-100">
            {status.activeStrategy ?? settings?.activeStrategyId ?? t('dashboard.none')}
            {foreign ? ` · ${t('status.foreign')}` : ''}
          </span>
        </Row>
        {status.serviceBinPath ? (
          <Row label={t('dashboard.servicePath')}>
            <span className="max-w-[320px] truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={status.serviceBinPath}>
              {status.serviceBinPath}
            </span>
          </Row>
        ) : null}
        <Row label={t('dashboard.admin')}>
          <Badge tone={status.isAdmin ? 'green' : 'yellow'}>{status.isAdmin ? t('dashboard.adminYes') : t('dashboard.adminNo')}</Badge>
        </Row>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700/60">
          {foreign ? (
            <Btn onClick={() => setPage('strategies')} disabled={busy['status']}>
              {t('action.takeover')}
            </Btn>
          ) : (
            <>
              <Btn onClick={() => void doAction('start')} disabled={busy['status'] || running || !status.isAdmin}>
                {t('action.start')}
              </Btn>
              <Btn onClick={() => void doAction('stop')} disabled={busy['status'] || !running || !status.isAdmin} variant="secondary">
                {t('action.stop')}
              </Btn>
              <Btn onClick={() => void doAction('restart')} disabled={busy['status'] || !status.isAdmin} variant="secondary">
                {t('action.restart')}
              </Btn>
            </>
          )}
          <Btn onClick={() => void doAction('refresh')} disabled={busy['status']} variant="ghost">
            {busy['status'] ? <Spinner /> : t('action.refresh')}
          </Btn>
          <span className="flex-1" />
          <Btn onClick={() => void doAction('remove')} disabled={!status.isAdmin} variant="danger">
            {foreign ? t('action.removeForeign') : t('action.remove')}
          </Btn>
        </div>
      </Card>

      <BypassTest />
    </div>
  )
}

function BrandIcon(props: { d: string }): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 shrink-0">
      <path d={props.d} />
    </svg>
  )
}

function StrokeIcon(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
    >
      {props.children}
    </svg>
  )
}

function YoutubeIcon(): React.JSX.Element {
  return (
    <BrandIcon d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  )
}

function DiscordIcon(): React.JSX.Element {
  return (
    <BrandIcon d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.319 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
  )
}

function CloudIcon(): React.JSX.Element {
  return (
    <StrokeIcon>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </StrokeIcon>
  )
}
