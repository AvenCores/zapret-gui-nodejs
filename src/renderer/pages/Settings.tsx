/** Settings: autostart and tray behavior. */
import React, { useEffect, useState } from 'react'
import { useUi } from '../store'
import { Btn, Card, Row, Spinner } from '../components/ui'

export default function Settings(): React.JSX.Element {
  const { t, settings, status, applySettings, busy, resetAll, refreshStatus, tgProxySettings, updateTgProxySettings, resetTgProxySettings, settingsHighlight, setSettingsHighlight } =
    useUi()
  const [resetDone, setResetDone] = useState<string | null>(null)
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const resetting = busy.reset === true
  const tgBusy = busy.tgproxy === true || busy['tgproxy-settings'] === true
  const tgCardRef = React.useRef<HTMLDivElement | null>(null)
  const highlightTg = settingsHighlight === 'tgproxy'

  // Fresh service state on open: the button below is gated on it, and the
  // user may have stopped/started zapret on another tab just before.
  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arrived via the Dashboard gear: scroll the TG proxy section into view,
  // flash-highlight it, then drop the flag so it does not retrigger.
  useEffect(() => {
    if (!highlightTg) return
    tgCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setSettingsHighlight(null), 2500)
    return () => clearTimeout(timer)
  }, [highlightTg, setSettingsHighlight])

  // A running zapret (service or stray winws.exe) locks the data files —
  // wiping then fails with EPERM, so the reset stays disabled until stopped.
  const zapretActive =
    status?.zapret === 'RUNNING' ||
    status?.zapret === 'START_PENDING' ||
    status?.zapret === 'STOP_PENDING' ||
    status?.winwsRunning === true
  const resetDisabled = resetting || zapretActive

  async function onReset(): Promise<void> {
    setResetDone(null)
    if (!window.confirm(t('settings.resetConfirm'))) return
    const r = await resetAll()
    if (r) setResetDone(t(r.servicesRemoved ? 'settings.resetDone' : 'settings.resetNoAdmin'))
  }

  async function onResetTgProxy(): Promise<void> {
    if (!window.confirm(t('tgProxy.resetConfirm'))) return
    await resetTgProxySettings()
    // Drop uncommitted input drafts so the fields show the defaults at once.
    setDrafts({})
    setPortDraft(null)
  }

  const tgPort = tgProxySettings?.port ?? settings?.tgProxy.port ?? 1443
  const tg = tgProxySettings ?? settings?.tgProxy ?? null
  // Text/number drafts committed on blur/Enter (invalid values surface as an
  // error banner from main instead of silently corrupting settings).
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function draftFor(key: string, current: string): string {
    return drafts[key] ?? current
  }

  function commitDraft(key: string, current: string, commit: (raw: string) => void): void {
    const raw = drafts[key]
    if (raw === undefined) return
    setDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    if (raw === current) return
    commit(raw)
  }

  function commitPort(): void {
    if (portDraft === null) return
    const n = Number.parseInt(portDraft, 10)
    setPortDraft(null)
    if (!Number.isFinite(n) || n < 1 || n > 65535 || n === tgPort) return
    void updateTgProxySettings({ port: n })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.settings')}</h1>

      <Card>
        <Row label={t('settings.autoLaunch')}>
          <Toggle value={settings?.autoLaunch ?? false} onChange={(v) => void applySettings({ autoLaunch: v })} />
        </Row>
        <Row label={t('settings.startMinimized')}>
          <Toggle
            value={settings?.startMinimizedToTray ?? false}
            onChange={(v) => void applySettings({ startMinimizedToTray: v })}
          />
        </Row>
      </Card>

      <Card title={t('settings.trayTitle')}>
        <Row label={t('settings.showTrayIcon')}>
          <Toggle value={settings?.showTrayIcon ?? true} onChange={(v) => void applySettings({ showTrayIcon: v })} />
        </Row>
        <Row label={t('settings.tray')}>
          <Toggle
            value={settings?.minimizeToTrayOnClose ?? true}
            onChange={(v) => void applySettings({ minimizeToTrayOnClose: v })}
          />
        </Row>
        <Row label={t('settings.trayServiceMenu')}>
          <Toggle
            value={settings?.trayServiceMenu ?? true}
            onChange={(v) => void applySettings({ trayServiceMenu: v })}
          />
        </Row>
        <Row label={t('settings.trayStrategyMenu')}>
          <Toggle
            value={settings?.trayStrategyMenu ?? true}
            onChange={(v) => void applySettings({ trayStrategyMenu: v })}
          />
        </Row>
        <Row label={t('settings.trayNavigateMenu')}>
          <Toggle
            value={settings?.trayNavigateMenu ?? true}
            onChange={(v) => void applySettings({ trayNavigateMenu: v })}
          />
        </Row>
        <Row label={t('settings.trayGameFilterMenu')}>
          <Toggle
            value={settings?.trayGameFilterMenu ?? true}
            onChange={(v) => void applySettings({ trayGameFilterMenu: v })}
          />
        </Row>
        <Row label={t('settings.trayIPSetMenu')}>
          <Toggle
            value={settings?.trayIPSetMenu ?? true}
            onChange={(v) => void applySettings({ trayIPSetMenu: v })}
          />
        </Row>
        <Row label={t('settings.trayToolsMenu')}>
          <Toggle
            value={settings?.trayToolsMenu ?? true}
            onChange={(v) => void applySettings({ trayToolsMenu: v })}
          />
        </Row>
          <Row label={t('settings.trayQuickSettings')}>
            <Toggle
              value={settings?.trayQuickSettings ?? true}
              onChange={(v) => void applySettings({ trayQuickSettings: v })}
            />
          </Row>
        </Card>

      <Card title={t('settings.logsTitle')}>
        <Row label={t('settings.logsEnabled')}>
          <Toggle value={settings?.logsEnabled !== false} onChange={(v) => void applySettings({ logsEnabled: v })} />
        </Row>
        <p className="py-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.logsHint')}</p>
      </Card>

      <div ref={tgCardRef} className={highlightTg ? 'rounded-xl ring-2 ring-sky-500 ring-offset-2 ring-offset-slate-100 transition dark:ring-offset-slate-900' : ''}>
      <Card title={t('tgProxy.title')}>
        <p className="py-1 text-sm text-slate-600 dark:text-slate-300">{t('tgProxy.desc')}</p>
        <Row label={t('tgProxy.autoStart')}>
          <Toggle
            value={tgProxySettings?.autoStart ?? settings?.tgProxy.autoStart ?? false}
            onChange={(v) => void updateTgProxySettings({ autoStart: v })}
          />
        </Row>
        <Row label={t('tgProxy.cfFallback')}>
          <Toggle
            value={tgProxySettings?.cfProxyEnabled ?? settings?.tgProxy.cfProxyEnabled ?? true}
            onChange={(v) => void updateTgProxySettings({ cfProxyEnabled: v })}
          />
        </Row>
        <Row label={t('tgProxy.port')}>
          <input
            type="number"
            min={1}
            max={65535}
            disabled={tgBusy}
            value={portDraft ?? String(tgPort)}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={commitPort}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm tabular-nums text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </Row>
        <Row label={t('tgProxy.host')}>
          <CommitInput
            value={draftFor('host', tg?.host ?? '127.0.0.1')}
            onChange={(v) => setDrafts((d) => ({ ...d, host: v }))}
            onCommit={(raw) => commitDraft('host', tg?.host ?? '127.0.0.1', (r) => void updateTgProxySettings({ host: r.trim() || '127.0.0.1' }))}
            disabled={tgBusy}
            className="w-36"
          />
        </Row>
        <Row label={t('tgProxy.dcIps')}>
          <CommitInput
            value={draftFor('dcIps', (tg?.dcIps ?? []).join(', '))}
            onChange={(v) => setDrafts((d) => ({ ...d, dcIps: v }))}
            onCommit={(raw) => commitDraft('dcIps', (tg?.dcIps ?? []).join(', '), (r) => void updateTgProxySettings({ dcIps: splitEntries(r) }))}
            disabled={tgBusy}
            placeholder="2:149.154.167.220, 4:149.154.167.220"
            className="w-64"
          />
        </Row>
        <Row label={t('tgProxy.poolSize')}>
          <CommitInput
            type="number"
            min={0}
            max={32}
            value={draftFor('poolSize', String(tg?.poolSize ?? 4))}
            onChange={(v) => setDrafts((d) => ({ ...d, poolSize: v }))}
            onCommit={(raw) => commitDraft('poolSize', String(tg?.poolSize ?? 4), (r) => void updateTgProxySettings({ poolSize: Number.parseInt(r, 10) }))}
            disabled={tgBusy}
            className="w-28"
          />
        </Row>
        <Row label={t('tgProxy.bufferKb')}>
          <CommitInput
            type="number"
            min={4}
            max={4096}
            value={draftFor('bufferKb', String(tg?.bufferKb ?? 256))}
            onChange={(v) => setDrafts((d) => ({ ...d, bufferKb: v }))}
            onCommit={(raw) => commitDraft('bufferKb', String(tg?.bufferKb ?? 256), (r) => void updateTgProxySettings({ bufferKb: Number.parseInt(r, 10) }))}
            disabled={tgBusy}
            className="w-28"
          />
        </Row>
        <Row label={t('tgProxy.cfDomains')}>
          <CommitInput
            value={draftFor('cfDomains', (tg?.cfDomains ?? []).join(', '))}
            onChange={(v) => setDrafts((d) => ({ ...d, cfDomains: v }))}
            onCommit={(raw) => commitDraft('cfDomains', (tg?.cfDomains ?? []).join(', '), (r) => void updateTgProxySettings({ cfDomains: splitEntries(r) }))}
            disabled={tgBusy}
            placeholder="example.com, example.org"
            className="w-64"
          />
        </Row>
        <Row label={t('tgProxy.workerDomains')}>
          <CommitInput
            value={draftFor('workerDomains', (tg?.workerDomains ?? []).join(', '))}
            onChange={(v) => setDrafts((d) => ({ ...d, workerDomains: v }))}
            onCommit={(raw) => commitDraft('workerDomains', (tg?.workerDomains ?? []).join(', '), (r) => void updateTgProxySettings({ workerDomains: splitEntries(r) }))}
            disabled={tgBusy}
            placeholder="worker.example.workers.dev"
            className="w-64"
          />
        </Row>
        <Row label={t('tgProxy.fakeTlsDomain')}>
          <CommitInput
            value={draftFor('fakeTlsDomain', tg?.fakeTlsDomain ?? '')}
            onChange={(v) => setDrafts((d) => ({ ...d, fakeTlsDomain: v }))}
            onCommit={(raw) => commitDraft('fakeTlsDomain', tg?.fakeTlsDomain ?? '', (r) => void updateTgProxySettings({ fakeTlsDomain: r.trim().toLowerCase() }))}
            disabled={tgBusy}
            placeholder="example.com"
            className="w-64"
          />
        </Row>
        <Row label={t('tgProxy.forceTestDc')}>
          <Toggle value={tg?.forceTestDc ?? false} onChange={(v) => void updateTgProxySettings({ forceTestDc: v })} />
        </Row>
        <Row label={t('tgProxy.proxyProtocol')}>
          <Toggle value={tg?.proxyProtocol ?? false} onChange={(v) => void updateTgProxySettings({ proxyProtocol: v })} />
        </Row>
        <p className="py-1 text-xs text-slate-500 dark:text-slate-400">{t('tgProxy.restartHint')}</p>
        <div className="mt-2">
          <Btn variant="danger" disabled={tgBusy} onClick={() => void onResetTgProxy()}>
            {t('tgProxy.resetSettings')}
          </Btn>
        </div>
      </Card>
      </div>

      <Card title={t('settings.resetTitle')}>
        <p className="py-1 text-sm text-slate-600 dark:text-slate-300">{t('settings.resetDesc')}</p>
        {zapretActive ? (
          <p className="py-1 text-sm text-amber-700 dark:text-amber-300">⚠ {t('settings.resetBlocked')}</p>
        ) : null}
        {resetDone ? (
          <p className="py-1 text-sm text-emerald-700 dark:text-emerald-300">✓ {resetDone}</p>
        ) : null}
        <div className="mt-2">
          <Btn variant="danger" disabled={resetDisabled} onClick={() => void onReset()}>
            {resetting ? <Spinner /> : null} {resetting ? t('settings.resetBusy') : t('settings.resetButton')}
          </Btn>
        </div>
      </Card>
      </div>
    )
  }

/** Split free-form list input (commas/semicolons/spaces/newlines) into entries. */
function splitEntries(raw: string): string[] {
  return raw
    .replace(/[,;\n\r\t]+/g, ' ')
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** Text/number input committed on blur/Enter (draft lives in the parent). */
function CommitInput(props: {
  value: string
  onChange: (v: string) => void
  onCommit: (raw: string) => void
  disabled?: boolean
  type?: string
  min?: number
  max?: number
  placeholder?: string
  className?: string
}): React.JSX.Element {
  return (
    <input
      type={props.type ?? 'text'}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={(e) => props.onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={`rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm tabular-nums text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${props.className ?? 'w-36'}`}
    />
  )
}

function Toggle(props: { value: boolean; onChange: (v: boolean) => void }): React.JSX.Element {  return (
    <button
      onClick={() => props.onChange(!props.value)}
      className={`relative h-6 w-11 rounded-full transition ${props.value ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}
      aria-pressed={props.value}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${props.value ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}
