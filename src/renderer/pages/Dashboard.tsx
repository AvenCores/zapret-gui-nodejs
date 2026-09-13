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
          <span className="text-sm text-slate-900 dark:text-slate-100">{status.activeStrategy ?? settings?.activeStrategyId ?? t('dashboard.none')}</span>
        </Row>
        <Row label={t('dashboard.admin')}>
          <Badge tone={status.isAdmin ? 'green' : 'yellow'}>{status.isAdmin ? 'admin ✓' : 'user'}</Badge>
        </Row>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700/60">
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

      <Card title="zapret-gui">
        <div className="flex flex-wrap gap-2 text-sm">
          <LinkBtn href={URLS.appRepo} icon={<GithubIcon />}>Repository</LinkBtn>
          <LinkBtn href={URLS.appIssues} icon={<IssuesIcon />}>Issues</LinkBtn>
          <LinkBtn href={URLS.appReleases} icon={<ReleasesIcon />}>Releases</LinkBtn>
          <LinkBtn href={URLS.youtube} icon={<YoutubeIcon />}>YouTube</LinkBtn>
          <LinkBtn href={URLS.telegram} icon={<TelegramIcon />}>Telegram</LinkBtn>
          <LinkBtn href={URLS.vk} icon={<VkIcon />}>VK</LinkBtn>
          <LinkBtn href={URLS.dzen} icon={<DzenIcon />}>Dzen</LinkBtn>
        </div>
      </Card>
    </div>
  )
}

function LinkBtn(props: { href: string; icon?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  // setWindowOpenHandler in main opens these externally via shell.
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-1.5 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
    >
      {props.icon}
      <span>{props.children}</span>
      <span aria-hidden className="text-xs opacity-60">↗</span>
    </a>
  )
}

function BrandIcon(props: { d: string }): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
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
      className="h-3.5 w-3.5 shrink-0"
    >
      {props.children}
    </svg>
  )
}

function GithubIcon(): React.JSX.Element {
  return (
    <BrandIcon d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  )
}

function IssuesIcon(): React.JSX.Element {
  return (
    <StrokeIcon>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </StrokeIcon>
  )
}

function ReleasesIcon(): React.JSX.Element {
  return (
    <StrokeIcon>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </StrokeIcon>
  )
}

function YoutubeIcon(): React.JSX.Element {
  return (
    <BrandIcon d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  )
}

function TelegramIcon(): React.JSX.Element {
  return (
    <BrandIcon d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  )
}

function VkIcon(): React.JSX.Element {
  return (
    <BrandIcon d="M6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z" />
  )
}

function DzenIcon(): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 169 169" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
      <path d="M148.369 82.7304C148.369 82.0906 147.849 81.5608 147.209 81.5308C124.246 80.661 110.271 77.732 100.494 67.955C90.6967 58.1581 87.7776 44.1724 86.9079 21.1596C86.8879 20.5198 86.358 20 85.7082 20H83.0291C82.3893 20 81.8594 20.5198 81.8295 21.1596C80.9597 44.1624 78.0406 58.1581 68.2437 67.955C58.4568 77.742 44.4911 80.661 21.5283 81.5308C20.8885 81.5508 20.3687 82.0806 20.3687 82.7304V85.4096C20.3687 86.0494 20.8885 86.5792 21.5283 86.6092C44.4911 87.4789 58.4667 90.408 68.2437 100.185C78.0206 109.962 80.9397 123.908 81.8195 146.83C81.8394 147.47 82.3693 147.99 83.0191 147.99H85.7082C86.348 147.99 86.8779 147.47 86.9079 146.83C87.7876 123.908 90.7067 109.962 100.484 100.185C110.271 90.398 124.236 87.4789 147.199 86.6092C147.839 86.5892 148.359 86.0594 148.359 85.4096V82.7304H148.369Z" />
    </svg>
  )
}
