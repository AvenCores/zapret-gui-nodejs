/** Root component: theme wiring + page router. */
import React, { useEffect, useState } from 'react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Strategies from './pages/Strategies'
import Settings from './pages/Settings'
import Lists from './pages/Lists'
import Diagnostics from './pages/Diagnostics'
import { useUi, syncThemeClass } from './store'

export default function App(): React.JSX.Element {
  const { page, init, theme, t, setPage, refreshStatus, refreshStrategies, refreshSettings } = useUi()
  const [ready, setReady] = useState<boolean>(false)

  useEffect(() => {
    void init().finally(() => setReady(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tray menu events: navigation requests and "something changed behind
  // our back" (service start/stop, strategy install, setting toggles).
  useEffect(() => {
    const offNav = window.zapret.onNavigate((p) => setPage(p))
    const offChanged = window.zapret.onStatusChanged(() => {
      void refreshStatus()
      void refreshStrategies()
      void refreshSettings()
    })
    return () => {
      offNav()
      offChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    syncThemeClass(theme)
  }, [theme])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
        <div className="text-sm">{t('app.loading')}</div>
      </div>
    )
  }

  // 'updates'/'logs' are legacy tray pages now embedded in Settings —
  // never render a blank screen if an old event still requests them.
  const effectivePage = page === 'updates' || page === 'logs' ? 'settings' : page

  return (
    <Layout>
      <div key={effectivePage} className="animate-page-in">
        {effectivePage === 'dashboard' && <Dashboard />}
        {effectivePage === 'strategies' && <Strategies />}
        {effectivePage === 'settings' && <Settings />}
        {effectivePage === 'lists' && <Lists />}
        {effectivePage === 'diagnostics' && <Diagnostics />}
      </div>
    </Layout>
  )
}
