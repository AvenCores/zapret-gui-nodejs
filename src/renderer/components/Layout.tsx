/** App shell: sidebar navigation, header, global banners. */
import React, { useEffect, useRef, useState } from 'react'
import { useUi, type Page } from '../store'
import { Btn } from './ui'
import appIconUrl from '../assets/app-icon.png'

const NAV: Array<{ id: Page }> = [
  { id: 'dashboard' },
  { id: 'strategies' },
  { id: 'settings' },
  { id: 'updates' },
  { id: 'diagnostics' },
  { id: 'logs' }
]

export default function Layout(props: { children: React.ReactNode }): React.JSX.Element {
  const { page, setPage, t, status, settings, applySettings, locale } = useUi()

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-800/80">
        <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
          <img src={appIconUrl} alt="zapret-gui logo" className="h-9 w-9 shrink-0 rounded-lg bg-slate-900 p-0.5 dark:bg-transparent dark:p-0" />
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight tracking-tight">zapret-gui</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">DPI bypass manager</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">by avencores</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                page === n.id ? 'bg-sky-600/90 font-medium text-white' : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700/60'
              }`}
            >
              <span className="opacity-80">
                <NavIcon id={n.id} />
              </span>
              {t(`nav.${n.id}` as never)}
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-slate-200 p-3 text-xs dark:border-slate-700/60">
          <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <GlobeIcon />
              {t('settings.language')}
            </span>
            <Picker
              label={t('settings.language')}
              value={locale}
              onChange={(v) => void applySettings({ locale: v })}
              options={[
                { value: 'ru', label: 'Русский', icon: <FlagRu /> },
                { value: 'en', label: 'English', icon: <FlagGb /> }
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <ContrastIcon />
              {t('settings.theme')}
            </span>
            <Picker
              label={t('settings.theme')}
              value={settings?.theme ?? 'dark'}
              onChange={(v) => void applySettings({ theme: v })}
              options={[
                { value: 'dark', label: t('settings.themeDark'), icon: <MoonIcon /> },
                { value: 'light', label: t('settings.themeLight'), icon: <SunIcon /> }
              ]}
            />
          </div>
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

function NavIcon({ id }: { id: Page }): React.JSX.Element {
  const cls = 'h-4 w-4 shrink-0'
  switch (id) {
    case 'dashboard':
      return (
        <StrokeIcon className={cls}>
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </StrokeIcon>
      )
    case 'strategies':
      return (
        <StrokeIcon className={cls}>
          <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
          <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
          <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
        </StrokeIcon>
      )
    case 'settings':
      return (
        <StrokeIcon className={cls}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </StrokeIcon>
      )
    case 'updates':
      return (
        <StrokeIcon className={cls}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </StrokeIcon>
      )
    case 'diagnostics':
      return (
        <StrokeIcon className={cls}>
          <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
        </StrokeIcon>
      )
    case 'logs':
      return (
        <StrokeIcon className={cls}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </StrokeIcon>
      )
  }
}

function Picker<T extends string>(props: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon: React.ReactNode }>
  onChange: (v: T) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = props.options.find((o) => o.value === props.value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
      >
        {current?.icon}
        <span>{current?.label}</span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3 w-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label={props.label}
          className="absolute bottom-full right-0 z-20 mb-1 w-max min-w-full overflow-hidden rounded-md border border-slate-300 bg-white py-0.5 shadow-lg dark:border-slate-600 dark:bg-slate-700"
        >
          {props.options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === props.value}>
              <button
                type="button"
                onClick={() => {
                  props.onChange(o.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-slate-200 dark:hover:bg-slate-600 ${
                  o.value === props.value ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-200'
                }`}
              >
                {o.icon}
                <span className="flex-1">{o.label}</span>
                {o.value === props.value ? (
                  <span aria-hidden className="text-sky-600 dark:text-sky-400">
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function StrokeIcon(props: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className ?? 'h-3.5 w-3.5 shrink-0'}
    >
      {props.children}
    </svg>
  )
}

function GlobeIcon(): React.JSX.Element {
  return (
    <StrokeIcon>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </StrokeIcon>
  )
}

function ContrastIcon(): React.JSX.Element {
  return (
    <StrokeIcon>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 18a6 6 0 0 0 0-12v12z" />
    </StrokeIcon>
  )
}

function MoonIcon(): React.JSX.Element {
  return (
    <StrokeIcon className="h-3 w-3 shrink-0">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </StrokeIcon>
  )
}

function SunIcon(): React.JSX.Element {
  return (
    <StrokeIcon className="h-3 w-3 shrink-0">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </StrokeIcon>
  )
}

function FlagRu(): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 18 12" className="h-3 w-[18px] shrink-0 overflow-hidden rounded-[2px]">
      <rect width="18" height="4" y="0" fill="#ffffff" />
      <rect width="18" height="4" y="4" fill="#0039a6" />
      <rect width="18" height="4" y="8" fill="#d52b1e" />
    </svg>
  )
}

function FlagGb(): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 60 30" className="h-3 w-6 shrink-0 overflow-hidden rounded-[2px]">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0 0l60 30M60 0L0 30" stroke="#ffffff" strokeWidth="6" />
      <path d="M0 0l60 30M60 0L0 30" stroke="#c8102e" strokeWidth="2" />
      <path d="M30 0v30M0 15h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30 0v30M0 15h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  )
}

function AdminBanner(): React.JSX.Element | null {
  const { status, t, busy } = useUi()
  if (!status || status.isAdmin) return null
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-5 py-2 text-sm text-amber-800 dark:text-amber-200">
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
    <div className="flex items-center justify-between gap-3 border-b border-red-500/40 bg-red-500/10 px-5 py-2 text-sm text-red-700 dark:text-red-200">
      <span className="break-all">❌ {error}</span>
      <button onClick={() => setError(null)} className="shrink-0 rounded px-2 py-0.5 hover:bg-red-500/20">
        ✕
      </button>
    </div>
  )
}
