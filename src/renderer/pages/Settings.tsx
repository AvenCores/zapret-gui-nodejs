/** Settings: updates, autostart and tray behavior. */
import React, { useEffect, useState } from 'react'
import { useUi } from '../store'
import { Card, Row, Spinner } from '../components/ui'

export default function Settings(): React.JSX.Element {
  const { t, settings, applySettings, setError } = useUi()
  const [autoCheck, setAutoCheck] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    void (async () => {
      try {
        setAutoCheck(await window.zapret.getAutoUpdateCheck())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.settings')}</h1>

      <Card>
        <Row label={t('settings.autoUpdateCheck')}>
          <Toggle value={autoCheck} onChange={(v) => void wrap(async () => {
            await window.zapret.setAutoUpdateCheck(v)
            setAutoCheck(v)
          })} />
        </Row>
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
