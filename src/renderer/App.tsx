/** Root component: theme wiring + page router. */
import React, { useEffect, useState } from 'react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Strategies from './pages/Strategies'
import Settings from './pages/Settings'
import Updates from './pages/Updates'
import Diagnostics from './pages/Diagnostics'
import Logs from './pages/Logs'
import { useUi, syncThemeClass } from './store'

export default function App(): React.JSX.Element {
  const { page, init, theme, t } = useUi()
  const [ready, setReady] = useState<boolean>(false)

  useEffect(() => {
    void init().finally(() => setReady(true))
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

  return (
    <Layout>
      <div key={page} className="animate-page-in">
        {page === 'dashboard' && <Dashboard />}
        {page === 'strategies' && <Strategies />}
        {page === 'settings' && <Settings />}
        {page === 'updates' && <Updates />}
        {page === 'diagnostics' && <Diagnostics />}
        {page === 'logs' && <Logs />}
      </div>
    </Layout>
  )
}
