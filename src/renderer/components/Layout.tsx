/** App shell: sidebar navigation, header, global banners. */
import React from 'react'
import { useUi, type Page } from '../store'
import { Btn } from './ui'

const NAV: Array<{ id: Page; icon: string }> = [
  { id: 'dashboard', icon: '●' },
  { id: 'strategies', icon: '⚙' },
  { id: 'settings', icon: '☰' },
  { id: 'updates', icon: '↓' },
  { id: 'diagnostics', icon: '✚' },
  { id: 'logs', icon: '≡' }
]

export default function Layout(props: { children: React.ReactNode }): React.JSX.Element {
  const { page, setPage, t, status, settings, applySettings, locale } = useUi()

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-700/60 bg-slate-850 bg-slate-800/80">
        <div className="px-4 pb-2 pt-4">
          <div className="text-lg font-bold tracking-tight">zapret-gui</div>
          <div className="text-xs text-slate-400">DPI bypass manager</div>
          <div className="text-[11px] text-slate-500">by avencores</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                page === n.id ? 'bg-sky-600/90 font-medium text-white' : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              <span className="w-4 text-center opacity-80">{n.icon}</span>
              {t(`nav.${n.id}` as never)}
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-slate-700/60 p-3 text-xs">
          <label className="flex items-center justify-between gap-2 text-slate-300">
            {t('settings.language')}
            <select
              value={locale}
              onChange={(e) => void applySettings({ locale: e.target.value as 'ru' | 'en' })}
              className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-100"
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-slate-300">
            {t('settings.theme')}
            <select
              value={settings?.theme ?? 'dark'}
              onChange={(e) => void applySettings({ theme: e.target.value as 'dark' | 'light' })}
              className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-100"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminBanner />
        <ErrorBanner />
        <main className="min-h-0 flex-1 overflow-y-auto p-5">{props.children}</main>
      </div>
    </div>
  )
}

function AdminBanner(): React.JSX.Element | null {
  const { status, t, busy } = useUi()
  if (!status || status.isAdmin) return null
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-5 py-2 text-sm text-amber-200">
      <span>⚠ {t('dashboard.adminMissing')}</span>
      <Btn
        variant="secondary"
        disabled={busy['admin']}
        onClick={() => void window.zapret.relaunchAsAdmin().catch(() => undefined)}
      >
        {t('dashboard.relaunchAdmin')}
      </Btn>
    </div>
  )
}

function ErrorBanner(): React.JSX.Element | null {
  const { error, setError } = useUi()
  if (!error) return null
  return (
    <div className="flex items-center justify-between gap-3 border-b border-red-500/40 bg-red-500/10 px-5 py-2 text-sm text-red-200">
      <span className="break-all">❌ {error}</span>
      <button onClick={() => setError(null)} className="shrink-0 rounded px-2 py-0.5 hover:bg-red-500/20">
        ✕
      </button>
    </div>
  )
}
