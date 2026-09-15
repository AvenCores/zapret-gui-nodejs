/** Settings: autostart and tray behavior. */
import React, { useEffect, useState } from 'react'
import { useUi } from '../store'
import { Btn, Card, Row, Spinner } from '../components/ui'

export default function Settings(): React.JSX.Element {
  const { t, settings, status, applySettings, busy, resetAll, refreshStatus } = useUi()
  const [resetDone, setResetDone] = useState<string | null>(null)
  const resetting = busy.reset === true

  // Fresh service state on open: the button below is gated on it, and the
  // user may have stopped/started zapret on another tab just before.
  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.settings')}</h1>

      <Card>
        <Row label={t('settings.autoLaunch')}>
          <Toggle value={settings?.autoLaunch ?? false} onChange={(v) => void applySettings({ autoLaunch: v })} />
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
        <Row label={t('settings.startMinimized')}>
          <Toggle
            value={settings?.startMinimizedToTray ?? false}
            onChange={(v) => void applySettings({ startMinimizedToTray: v })}
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

function Toggle(props: { value: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
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
