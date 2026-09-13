/** Dashboard: service status, quick actions, links. */
import React, { useEffect } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, Dot, Row, Spinner } from '../components/ui'
import { URLS } from '../../shared/constants'
import type { ServiceState } from '../../shared/types'

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

export default function Dashboard(): React.JSX.Element {
  const { t, status, refreshStatus, busy, setError, settings } = useUi()

  useEffect(() => {
    const offStart = window.zapret.onTrayStart(() => void doAction('start'))
    const offStop = window.zapret.onTrayStop(() => void doAction('stop'))
    return () => {
      offStart()
      offStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doAction(kind: 'start' | 'stop' | 'restart' | 'refresh' | 'remove'): Promise<void> {
    try {
      if (kind === 'start') await window.zapret.startService()
      if (kind === 'stop') await window.zapret.stopService()
      if (kind === 'restart') {
        await window.zapret.stopService().catch(() => undefined)
        await window.zapret.startService()
      }
      if (kind === 'remove') {
        if (!window.confirm(t('action.remove') + '?')) return
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>

      <Card>
        <Row label={t('dashboard.service')}>
          <Badge tone={stateTone(status.zapret)}>
            <Dot tone={stateTone(status.zapret)} />
            {status.zapret === 'RUNNING' ? t('status.running') : t(`status.${stateKey(status.zapret)}`)}
          </Badge>
        </Row>
        <Row label={t('dashboard.windivert')}>
          <Badge tone={stateTone(status.windivert)}>
            <Dot tone={stateTone(status.windivert)} />
            {status.windivert}
          </Badge>
        </Row>
        <Row label={t('dashboard.winws')}>
          <Badge tone={status.winwsRunning ? 'green' : 'red'}>
            <Dot tone={status.winwsRunning ? 'green' : 'red'} />
            {status.winwsRunning ? t('status.running') : t('status.stopped')}
          </Badge>
        </Row>
        <Row label={t('dashboard.strategy')}>
          <span className="text-sm text-slate-100">{status.activeStrategy ?? settings?.activeStrategyId ?? t('dashboard.none')}</span>
        </Row>
        <Row label={t('dashboard.admin')}>
          <Badge tone={status.isAdmin ? 'green' : 'yellow'}>{status.isAdmin ? 'admin ✓' : 'user'}</Badge>
        </Row>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-700/60 pt-3">
          <Btn onClick={() => void doAction('start')} disabled={busy['status'] || running || !status.isAdmin}>
            {t('action.start')}
          </Btn>
          <Btn onClick={() => void doAction('stop')} disabled={busy['status'] || !running || !status.isAdmin} variant="secondary">
            {t('action.stop')}
          </Btn>
          <Btn onClick={() => void doAction('restart')} disabled={busy['status'] || !status.isAdmin} variant="secondary">
            {t('action.restart')}
          </Btn>
          <Btn onClick={() => void doAction('refresh')} disabled={busy['status']} variant="ghost">
            {busy['status'] ? <Spinner /> : t('action.refresh')}
          </Btn>
          <span className="flex-1" />
          <Btn onClick={() => void doAction('remove')} disabled={!status.isAdmin} variant="danger">
            {t('action.remove')}
          </Btn>
        </div>
      </Card>

      <Card title="Links">
        <div className="flex flex-wrap gap-2 text-sm">
          <LinkBtn href={URLS.discordInvite}>Discord</LinkBtn>
          <LinkBtn href={URLS.issues}>GitHub Issues</LinkBtn>
          <LinkBtn href={URLS.releasesPage}>Releases</LinkBtn>
        </div>
      </Card>
    </div>
  )
}

function LinkBtn(props: { href: string; children: React.ReactNode }): React.JSX.Element {
  // setWindowOpenHandler in main opens these externally via shell.
  return (
    <a href={props.href} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-700 px-3 py-1.5 hover:bg-slate-600">
      {props.children} ↗
    </a>
  )
}
