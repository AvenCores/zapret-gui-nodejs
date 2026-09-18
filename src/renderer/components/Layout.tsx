/** App shell: sidebar navigation, header, global banners. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useUi, type Page } from '../store'
import { Btn, Dot, Spinner } from './ui'
import { SUPPORTED_LOCALES, type Locale } from '../../shared/i18n'
import { URLS } from '../../shared/constants'
import appIconUrl from '../assets/app-icon.png'

const SIDEBAR_KEY = 'zapret:sidebar-collapsed'

const MAIN_NAV: Array<{ id: Page; shortcut: string }> = [
  { id: 'dashboard', shortcut: 'Alt+1' },
  { id: 'strategies', shortcut: 'Alt+2' },
  { id: 'lists', shortcut: 'Alt+3' },
  { id: 'diagnostics', shortcut: 'Alt+4' }
]
const UPDATES_NAV: { id: Page; shortcut: string } = { id: 'updates', shortcut: 'Alt+5' }
const SETTINGS_NAV: { id: Page; shortcut: string } = { id: 'settings', shortcut: 'Alt+6' }

function initialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {
    // private mode / no storage — fall through to auto default
  }
  // Narrow windows (like on the bug screenshot) start icon-only so the
  // content area stays usable. The user choice wins once stored.
  if (typeof window !== 'undefined' && window.innerWidth < 820) return true
  return false
}

type ServiceDot = 'green' | 'red' | 'yellow' | 'gray'

function serviceDot(state: string | undefined): ServiceDot {
  if (state === 'RUNNING') return 'green'
  if (state === 'START_PENDING' || state === 'STOP_PENDING') return 'yellow'
  if (state === 'STOPPED' || state === 'NOT_INSTALLED') return 'red'
  return 'gray'
}

export default function Layout(props: { children: React.ReactNode }): React.JSX.Element {
  const { page, setPage, t, status, settings, applySettings, locale } = useUi()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [collapsed])

  // Ctrl/Cmd+B — свернуть/развернуть, Alt+1..6 — навигация. Игнорируем ввод в полях.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setCollapsed((v) => !v)
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault()
        const order: Page[] = ['dashboard', 'strategies', 'lists', 'diagnostics', 'updates', 'settings']
        setPage(order[Number(e.key) - 1] as Page)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleLabel = collapsed ? t('action.more') : t('action.less')
  const running = status?.zapret === 'RUNNING'
  const dotTone = serviceDot(status?.zapret)

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <aside
        aria-label="Sidebar"
        className={`flex shrink-0 select-none flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ease-out dark:border-slate-700/60 dark:bg-slate-800/80 ${
          // Expanded: clip fixed-width content instead of reflowing it every
          // animation frame. Collapsed: keep visible so icon-only dropdowns
          // (positioned left-full) are not cut off.
          collapsed ? 'w-[68px]' : 'w-60 overflow-hidden'
        }`}
      >
        {/* ── Header: logo (→ dashboard) + collapse toggle ─────────── */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 px-2 pb-1 pt-3">
            <button
              type="button"
              onClick={() => setPage('dashboard')}
              title={`Zapret GUI — ${t('nav.dashboard')}`}
              aria-label="Zapret GUI"
              aria-current={page === 'dashboard' ? 'page' : undefined}
              className="relative rounded-xl transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
            >
              <img
                src={appIconUrl}
                alt="Zapret GUI logo"
                className="h-9 w-9 rounded-xl bg-slate-900 p-0.5 dark:bg-transparent dark:p-0"
              />
              <span className="absolute -bottom-0.5 -right-0.5">
                <Dot tone={dotTone} pulse={running} outline />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title={`Ctrl+B · ${toggleLabel}`}
              aria-label={toggleLabel}
              aria-expanded={false}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-95 dark:text-slate-500 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex w-60 items-center gap-1 px-3 pb-1 pt-3">
            {/* Fixed w-60: the panel clips this block during the expand
                animation instead of reflowing buttons/text every frame. */}
            <button
              type="button"
              onClick={() => setPage('dashboard')}
              title={`Zapret GUI — ${t('nav.dashboard')}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
            >
              <span className="relative shrink-0">
                <img
                  src={appIconUrl}
                  alt="Zapret GUI logo"
                  className="h-9 w-9 rounded-xl bg-slate-900 p-0.5 dark:bg-transparent dark:p-0"
                />
                <span className="absolute -bottom-0.5 -right-0.5">
                  <Dot tone={dotTone} pulse={running} outline />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[17px] font-bold leading-tight tracking-tight">Zapret GUI</span>
                <span className="block truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                  {t('app.tagline')}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title={`Ctrl+B · ${toggleLabel}`}
              aria-label={toggleLabel}
              aria-expanded={true}
              className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-95 dark:text-slate-500 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          </div>
        )}

        {/* ── Main navigation ──────────────────────────────────────── */}
        <nav
          aria-label="Main"
          className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto p-2 ${
            collapsed ? '' : 'w-60'
          }`}
        >
          {MAIN_NAV.map((n) => (
            <NavButton
              key={n.id}
              id={n.id}
              label={t(`nav.${n.id}` as never)}
              shortcut={n.shortcut}
              active={page === n.id}
              collapsed={collapsed}
              onClick={() => setPage(n.id)}
            />
          ))}

          <div role="separator" aria-hidden className={`my-1.5 h-px shrink-0 bg-slate-200 dark:bg-slate-700/60 ${collapsed ? 'mx-2' : 'mx-1'}`} />

          <NavButton
            id={UPDATES_NAV.id}
            label={t('nav.updates')}
            shortcut={UPDATES_NAV.shortcut}
            active={page === 'updates'}
            collapsed={collapsed}
            onClick={() => setPage('updates')}
          />

          <div role="separator" aria-hidden className={`my-1.5 h-px shrink-0 bg-slate-200 dark:bg-slate-700/60 ${collapsed ? 'mx-2' : 'mx-1'}`} />

          <NavButton
            id={SETTINGS_NAV.id}
            label={t('nav.settings')}
            shortcut={SETTINGS_NAV.shortcut}
            active={page === 'settings'}
            collapsed={collapsed}
            onClick={() => setPage('settings')}
          />
        </nav>

        {/* ── Footer: language / theme / about ─────────────────────── */}
        {collapsed ? (
          <div key="sidebar-footer-collapsed" className="flex flex-col items-center gap-1 border-t border-slate-200 p-2 dark:border-slate-700/60">
            {/* Distinct key: an open dropdown must not survive the toggle. */}
            <Picker<Locale>
              label={t('settings.language')}
              value={locale}
              onChange={(v) => void applySettings({ locale: v })}
              iconOnly
              placement="right"
              searchPlaceholder={t('logs.filter')}
              options={SUPPORTED_LOCALES.map((l) => ({
                value: l.code,
                label: l.nativeName,
                icon: <Flag code={l.code} />
              }))}
            />
            <Picker
              label={t('settings.theme')}
              value={settings?.theme ?? 'dark'}
              onChange={(v) => void applySettings({ theme: v })}
              iconOnly
              placement="right"
              options={[
                { value: 'auto', label: t('settings.themeAuto'), icon: <ContrastIcon /> },
                { value: 'dark', label: t('settings.themeDark'), icon: <MoonIcon /> },
                { value: 'light', label: t('settings.themeLight'), icon: <SunIcon /> }
              ]}
            />
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              title={t('about.title')}
              aria-label={t('about.title')}
              className="rounded-lg p-2.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-95 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100"
            >
              <InfoIcon />
            </button>
          </div>
        ) : (
          <div key="sidebar-footer-expanded" className="w-60 space-y-1.5 border-t border-slate-200 p-2.5 dark:border-slate-700/60">
            <Picker<Locale>
              label={t('settings.language')}
              value={locale}
              onChange={(v) => void applySettings({ locale: v })}
              fullWidth
              placement="up"
              searchPlaceholder={t('logs.filter')}
              options={SUPPORTED_LOCALES.map((l) => ({
                value: l.code,
                label: l.nativeName,
                icon: <Flag code={l.code} />
              }))}
            />
            <Picker
              label={t('settings.theme')}
              value={settings?.theme ?? 'dark'}
              onChange={(v) => void applySettings({ theme: v })}
              fullWidth
              placement="up"
              options={[
                { value: 'auto', label: t('settings.themeAuto'), icon: <ContrastIcon /> },
                { value: 'dark', label: t('settings.themeDark'), icon: <MoonIcon /> },
                { value: 'light', label: t('settings.themeLight'), icon: <SunIcon /> }
              ]}
            />
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-[0.98] dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100"
            >
              <InfoIcon />
              {t('about.title')}
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppUpdateBanner />
        <AdminBanner />
        <ErrorBanner />
        <main className="min-h-0 flex-1 overflow-y-auto p-5">{props.children}</main>
      </div>
      {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}
    </div>
  )
}

function NavButton(props: {
  id: Page
  label: string
  shortcut: string
  active: boolean
  collapsed: boolean
  onClick: () => void
}): React.JSX.Element {
  const { id, label, shortcut, active, collapsed, onClick } = props
  const title = collapsed ? `${label} · ${shortcut}` : `${label} (${shortcut})`
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-[0.98] ${
        collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2 text-left'
      } ${
        active
          ? 'bg-sky-600 font-medium text-white shadow-sm shadow-sky-950/30'
          : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white'
      }`}
    >
      {active && !collapsed ? (
        <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-white/90" />
      ) : null}
      <span className={`shrink-0 ${active ? '' : 'opacity-80 group-hover:opacity-100'}`}>
        <NavIcon id={id} />
      </span>
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
    </button>
  )
}

/** SBER card from README ("Поддержать автора"). Display grouped, copy plain digits. */
const SBER_CARD_DISPLAY = '2202 2050 1464 4675'
const SBER_CARD_RAW = '2202205014644675'

function AboutModal(props: { onClose: () => void }): React.JSX.Element {
  const { onClose } = props
  const { t } = useUi()
  const [copied, setCopied] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)

  // Animated close: play fade/zoom-out first, unmount after.
  const beginClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, 180)
  }, [closing, onClose])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    []
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') beginClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [beginClose])

  async function copyCard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(SBER_CARD_RAW)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = SBER_CARD_RAW
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      } catch {
        return
      }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 ${
        closing ? 'animate-fade-out' : 'animate-fade-in'
      }`}
      onClick={beginClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('about.title')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800 ${
          closing ? 'animate-zoom-out' : 'animate-zoom-in'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img src={appIconUrl} alt="Zapret GUI logo" className="h-10 w-10 shrink-0 rounded-lg bg-slate-900 p-0.5 dark:bg-transparent dark:p-0" />
            <div>
              <div className="text-lg font-bold leading-tight">Zapret GUI</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('app.tagline')}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={beginClose}
            aria-label={t('action.close')}
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t('about.description')}</p>

        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('about.links')}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AboutLink href={URLS.appRepo} icon={<GithubIcon />}>
            {t('dashboard.repo')}
          </AboutLink>
          <AboutLink href={URLS.appIssues} icon={<IssueIcon />}>
            {t('dashboard.issues')}
          </AboutLink>
          <AboutLink href={URLS.appReleases} icon={<TagIcon />}>
            {t('dashboard.releases')}
          </AboutLink>
          <AboutLink href={URLS.youtube} icon={<YoutubeGlyph />}>
            YouTube
          </AboutLink>
          <AboutLink href={URLS.telegram} icon={<TelegramGlyph />}>
            Telegram
          </AboutLink>
          <AboutLink href={URLS.vk} icon={<VkChip />}>
            VK
          </AboutLink>
          <AboutLink href={URLS.dzen} icon={<DzenChip />}>
            Dzen
          </AboutLink>
        </div>

        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t('about.license')}: GPL-3.0 · by avencores
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-sky-500/40 bg-gradient-to-br from-sky-500/25 via-sky-500/10 to-transparent shadow-[0_0_28px_-8px_rgba(14,165,233,0.45)]">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-sm shadow-md">
                💰
              </span>
              <div className="text-sm font-bold text-sky-900 dark:text-sky-100">{t('about.donate')}</div>
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t('about.donateHint')}</div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-sky-500/50 bg-white/60 px-3 py-2 dark:bg-black/40">
              <span className="shrink-0 rounded bg-[#21A038] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Sber
              </span>
              <span className="flex-1 break-all font-mono text-[13px] font-semibold tracking-[0.1em] text-slate-800 dark:text-slate-100">
                {SBER_CARD_DISPLAY}
              </span>
              <button
                type="button"
                onClick={() => void copyCard()}
                className="shrink-0 rounded-md bg-gradient-to-r from-sky-600 to-sky-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-95"
              >
                {copied ? `✓ ${t('about.copied')}` : t('about.copy')}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Btn variant="secondary" onClick={beginClose}>
            {t('action.close')}
          </Btn>
        </div>
      </div>
    </div>
  )
}

function AboutLink(props: { href: string; icon: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  // setWindowOpenHandler in main opens these externally via shell.
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-200 px-2.5 py-1 text-xs hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
    >
      <span aria-hidden className="flex shrink-0 items-center">
        {props.icon}
      </span>
      <span>{props.children}</span>
    </a>
  )
}

function GithubIcon(): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0 opacity-80">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function IssueIcon(): React.JSX.Element {
  return (
    <StrokeIcon className="h-3.5 w-3.5 shrink-0 opacity-80">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  )
}

function TagIcon(): React.JSX.Element {
  return (
    <StrokeIcon className="h-3.5 w-3.5 shrink-0 opacity-80">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </StrokeIcon>
  )
}

function YoutubeGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-[#FF0000]">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function TelegramGlyph(): React.JSX.Element {
  return (
    <StrokeIcon className="h-3.5 w-3.5 shrink-0 text-[#229ED9]">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </StrokeIcon>
  )
}

function VkChip(): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="flex h-3.5 min-w-5 shrink-0 items-center justify-center rounded bg-[#0077FF] px-1 text-[8px] font-black leading-none text-white"
    >
      VK
    </span>
  )
}

function DzenChip(): React.JSX.Element {
  return (
    <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-slate-900 dark:bg-white">
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-2.5 w-2.5 text-white dark:text-slate-900">
        <path d="M12 2c1 5.5 4.5 9 10 10-5.5 1-9 4.5-10 10-1-5.5-4.5-9-10-10 5.5-1 9-4.5 10-10Z" />
      </svg>
    </span>
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
    case 'lists':
      return (
        <StrokeIcon className={cls}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </StrokeIcon>
      )
  }
}

function Picker<T extends string>(props: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon: React.ReactNode }>
  onChange: (v: T) => void
  fullWidth?: boolean
  iconOnly?: boolean
  placement?: 'up' | 'right'
  /** When set, the dropdown gets a filter field with this placeholder. */
  searchPlaceholder?: string
}): React.JSX.Element {
  const { t } = useUi()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const searchable = props.searchPlaceholder != null

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

  // Fresh filter on every open; focus it and reveal the current option.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const id = window.requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus()
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, searchable])

  const current = props.options.find((o) => o.value === props.value)
  const placement = props.placement ?? 'up'

  const q = query.trim().toLowerCase()
  const visible =
    !searchable || q === ''
      ? props.options
      : props.options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().startsWith(q))

  // Arrow/Home/End across visible options (bubbles up from input + buttons).
  function onMenuKeyDown(e: React.KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const buttons = Array.from(listRef.current?.querySelectorAll('button') ?? [])
    if (buttons.length === 0) return
    e.preventDefault()
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % buttons.length
    else if (e.key === 'ArrowUp') next = idx < 0 ? buttons.length - 1 : (idx - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else next = buttons.length - 1
    const btn = buttons[next]
    if (btn) btn.focus()
  }

  // Plain function call (not <Menu />) so the filter input keeps focus
  // across keystrokes instead of remounting on every render.
  function renderMenu(containerClass: string): React.JSX.Element {
    return (
      <div onKeyDown={onMenuKeyDown} className={containerClass}>
        {searchable ? (
          <div className="border-b border-slate-200 p-1.5 dark:border-slate-600/60">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={props.searchPlaceholder}
              aria-label={props.searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-800 outline-none ring-sky-600 placeholder:text-slate-400 focus:ring-1 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        ) : null}
        <ul ref={listRef} role="listbox" aria-label={props.label} className="strategy-scroll max-h-72 overflow-y-auto py-1">
          {visible.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === props.value}>
              <button
                type="button"
                onClick={() => {
                  props.onChange(o.value)
                  setOpen(false)
                }}
                title={o.label}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/70 hover:bg-slate-200 dark:hover:bg-slate-600 ${
                  o.value === props.value ? 'bg-sky-500/10 font-medium text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-200'
                }`}
              >
                <span className="shrink-0">{o.icon}</span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.value === props.value ? (
                  <span aria-hidden className="shrink-0 text-sky-600 dark:text-sky-400">
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {visible.length === 0 ? (
            <li aria-hidden className="px-2.5 py-2 text-center text-xs text-slate-400 dark:text-slate-500">
              {t('dashboard.none')}
            </li>
          ) : null}
        </ul>
      </div>
    )
  }

  const rightMenuClass =
    'absolute bottom-0 left-full z-20 ml-2 w-52 origin-bottom-left animate-menu-in rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-700'
  const upMenuClass =
    'absolute bottom-full left-0 right-0 z-20 mb-1 origin-bottom animate-menu-in rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-700'

  if (props.iconOnly) {
    return (
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          aria-label={props.label}
          title={current ? `${props.label} — ${current.label}` : props.label}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-95 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100"
        >
          <span className="block h-4 w-4 [&>svg]:h-4 [&>svg]:w-4">{current?.icon}</span>
        </button>
        {open ? renderMenu(rightMenuClass) : null}
      </div>
    )
  }

  return (
    <div ref={ref} className={`relative shrink-0 ${props.fullWidth ? 'w-full' : ''}`}>
      <button
        type="button"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg bg-slate-200/70 px-2.5 py-1.5 text-xs text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-[0.99] dark:bg-slate-700/70 dark:text-slate-100 dark:hover:bg-slate-700"
      >
        <span className="shrink-0 opacity-80">{current?.icon}</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium">{current?.label}</span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? renderMenu(placement === 'right' ? rightMenuClass : upMenuClass) : null}
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

function InfoIcon(): React.JSX.Element {
  return (
    <StrokeIcon className="h-3.5 w-3.5 shrink-0">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
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

function Flag(props: { code: Locale }): React.JSX.Element {
  let body: React.ReactNode = null
  switch (props.code) {
    case 'ru':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ffffff" />
          <rect width="18" height="4" y="4" fill="#0039a6" />
          <rect width="18" height="4" y="8" fill="#d52b1e" />
        </>
      )
      break
    case 'en':
      body = (
        <>
          <rect width="18" height="12" fill="#012169" />
          <path d="M0 0l18 12M18 0L0 12" stroke="#ffffff" strokeWidth="2.4" />
          <path d="M0 0l18 12M18 0L0 12" stroke="#c8102e" strokeWidth="0.8" />
          <path d="M9 0v12M0 6h18" stroke="#ffffff" strokeWidth="4" />
          <path d="M9 0v12M0 6h18" stroke="#c8102e" strokeWidth="2.4" />
        </>
      )
      break
    case 'uk':
      body = (
        <>
          <rect width="18" height="6" y="0" fill="#005bbb" />
          <rect width="18" height="6" y="6" fill="#ffd500" />
        </>
      )
      break
    case 'be':
      body = (
        <>
          <rect width="18" height="12" fill="#ce1720" />
          <rect width="18" height="4" y="8" fill="#007c30" />
          <rect width="2.5" height="12" x="0" fill="#ffffff" />
          <rect width="2.5" height="1.5" x="0" fill="#ce1720" />
          <rect width="2.5" height="1.5" x="0" y="3" fill="#ce1720" />
          <rect width="2.5" height="1.5" x="0" y="6" fill="#ce1720" />
        </>
      )
      break
    case 'kk':
      body = (
        <>
          <rect width="18" height="12" fill="#00afca" />
          <circle cx="9" cy="6" r="2.6" fill="none" stroke="#fec50c" strokeWidth="0.9" />
          <circle cx="9" cy="6" r="0.9" fill="#fec50c" />
        </>
      )
      break
    case 'de':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#000000" />
          <rect width="18" height="4" y="4" fill="#dd0000" />
          <rect width="18" height="4" y="8" fill="#ffce00" />
        </>
      )
      break
    case 'fr':
      body = (
        <>
          <rect width="6" height="12" x="0" fill="#0055a4" />
          <rect width="6" height="12" x="6" fill="#ffffff" />
          <rect width="6" height="12" x="12" fill="#ef4135" />
        </>
      )
      break
    case 'es':
      body = (
        <>
          <rect width="18" height="12" fill="#aa151b" />
          <rect width="18" height="6" y="3" fill="#f1bf00" />
        </>
      )
      break
    case 'it':
      body = (
        <>
          <rect width="6" height="12" x="0" fill="#009246" />
          <rect width="6" height="12" x="6" fill="#ffffff" />
          <rect width="6" height="12" x="12" fill="#ce2b37" />
        </>
      )
      break
    case 'pt':
      body = (
        <>
          <rect width="7" height="12" x="0" fill="#046a38" />
          <rect width="11" height="12" x="7" fill="#da291c" />
        </>
      )
      break
    case 'nl':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ae1c28" />
          <rect width="18" height="4" y="4" fill="#ffffff" />
          <rect width="18" height="4" y="8" fill="#21468b" />
        </>
      )
      break
    case 'pl':
      body = (
        <>
          <rect width="18" height="6" y="0" fill="#ffffff" />
          <rect width="18" height="6" y="6" fill="#dc143c" />
        </>
      )
      break
    case 'cs':
      body = (
        <>
          <rect width="18" height="6" y="0" fill="#ffffff" />
          <rect width="18" height="6" y="6" fill="#d7141a" />
          <polygon points="0,0 9,6 0,12" fill="#11457e" />
        </>
      )
      break
    case 'sk':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ffffff" />
          <rect width="18" height="4" y="4" fill="#0b4ea2" />
          <rect width="18" height="4" y="8" fill="#ee1c25" />
        </>
      )
      break
    case 'hu':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ce2939" />
          <rect width="18" height="4" y="4" fill="#ffffff" />
          <rect width="18" height="4" y="8" fill="#477050" />
        </>
      )
      break
    case 'ro':
      body = (
        <>
          <rect width="6" height="12" x="0" fill="#002b7f" />
          <rect width="6" height="12" x="6" fill="#fcd116" />
          <rect width="6" height="12" x="12" fill="#ce1126" />
        </>
      )
      break
    case 'bg':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ffffff" />
          <rect width="18" height="4" y="4" fill="#00966e" />
          <rect width="18" height="4" y="8" fill="#d62612" />
        </>
      )
      break
    case 'sr':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#c6363c" />
          <rect width="18" height="4" y="4" fill="#0c4076" />
          <rect width="18" height="4" y="8" fill="#ffffff" />
        </>
      )
      break
    case 'hr':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ff0000" />
          <rect width="18" height="4" y="4" fill="#ffffff" />
          <rect width="18" height="4" y="8" fill="#171796" />
        </>
      )
      break
    case 'el':
      body = (
        <>
          <rect width="18" height="12" fill="#ffffff" />
          <rect width="18" height="1.35" y="0" fill="#0d5eaf" />
          <rect width="18" height="1.35" y="2.7" fill="#0d5eaf" />
          <rect width="18" height="1.35" y="5.4" fill="#0d5eaf" />
          <rect width="18" height="1.35" y="8.1" fill="#0d5eaf" />
          <rect width="11" height="1.35" y="10.65" x="7" fill="#0d5eaf" />
          <rect width="7" height="6.75" x="0" y="0" fill="#0d5eaf" />
          <rect width="7" height="1.35" x="0" y="2.7" fill="#ffffff" />
          <rect width="1.4" height="6.75" x="2.8" y="0" fill="#ffffff" />
        </>
      )
      break
    case 'tr':
      body = (
        <>
          <rect width="18" height="12" fill="#e30a17" />
          <circle cx="7" cy="6" r="3" fill="#ffffff" />
          <circle cx="7.7" cy="6" r="2.4" fill="#e30a17" />
          <circle cx="10.6" cy="6" r="0.9" fill="#ffffff" />
        </>
      )
      break
    case 'ar':
      body = (
        <>
          <rect width="18" height="12" fill="#006c35" />
          <rect width="10" height="1" x="4" y="4" fill="#ffffff" />
          <rect width="10" height="0.8" x="4" y="8" fill="#ffffff" />
        </>
      )
      break
    case 'fa':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#239f40" />
          <rect width="18" height="4" y="4" fill="#ffffff" />
          <rect width="18" height="4" y="8" fill="#da0000" />
        </>
      )
      break
    case 'zh':
      body = (
        <>
          <rect width="18" height="12" fill="#ee1c25" />
          <polygon
            points="3.5,1.5 4.1,3.3 6,3.3 4.5,4.5 5,6.3 3.5,5.2 2,6.3 2.5,4.5 1,3.3 2.9,3.3"
            fill="#ffde00"
          />
          <circle cx="8" cy="2" r="0.6" fill="#ffde00" />
          <circle cx="9.5" cy="3.5" r="0.6" fill="#ffde00" />
          <circle cx="9.5" cy="5.8" r="0.6" fill="#ffde00" />
          <circle cx="8" cy="7.3" r="0.6" fill="#ffde00" />
        </>
      )
      break
    case 'ja':
      body = (
        <>
          <rect width="18" height="12" fill="#ffffff" />
          <circle cx="9" cy="6" r="3" fill="#bc002d" />
        </>
      )
      break
    case 'ko':
      body = (
        <>
          <rect width="18" height="12" fill="#ffffff" />
          <path d="M6 6a3 3 0 0 1 6 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 0-3 0" fill="#cd2e3a" />
          <path d="M6 6a1.5 1.5 0 0 0 3 0a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0" fill="#0047a0" />
          <rect width="2.4" height="0.7" x="2" y="2" fill="#000000" />
          <rect width="2.4" height="0.7" x="13.6" y="2" fill="#000000" />
          <rect width="2.4" height="0.7" x="2" y="9.3" fill="#000000" />
          <rect width="2.4" height="0.7" x="13.6" y="9.3" fill="#000000" />
        </>
      )
      break
    case 'hi':
      body = (
        <>
          <rect width="18" height="4" y="0" fill="#ff9933" />
          <rect width="18" height="4" y="4" fill="#ffffff" />
          <rect width="18" height="4" y="8" fill="#138808" />
          <circle cx="9" cy="6" r="1.4" fill="none" stroke="#000080" strokeWidth="0.5" />
        </>
      )
      break
    case 'id':
      body = (
        <>
          <rect width="18" height="6" y="0" fill="#ff0000" />
          <rect width="18" height="6" y="6" fill="#ffffff" />
        </>
      )
      break
  }
  return (
    <svg aria-hidden viewBox="0 0 18 12" className="h-3 w-[18px] shrink-0 overflow-hidden rounded-[2px]">
      {body}
    </svg>
  )
}

/**
 * Global offer to update the app itself. Fires when electron-updater finds
 * a new release (background auto-check + manual "Check" on Updates page):
 * shows "Download / Install and restart" instead of a silent log line.
 */
function AppUpdateBanner(): React.JSX.Element | null {
  const { t, setPage, setError } = useUi()
  const [available, setAvailable] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    // Late mount / reload mid-download: restore the cached snapshot so the
    // banner matches the Updates page and the native dialog state.
    void window.zapret
      .getAppUpdateState()
      .then((s) => {
        if (!s.availableVersion) return
        setAvailable(s.availableVersion)
        if (s.downloaded) {
          setDownloaded(s.availableVersion)
          setDownloading(false)
          setPercent(null)
        } else if (s.downloading) {
          setDownloading(true)
          setPercent(0)
          setDismissed(null)
        }
      })
      .catch(() => undefined)
    const offAvailable = window.zapret.onAppUpdateAvailable((v) => {
      setAvailable((prev) => (prev === v ? prev : v))
      setDownloaded(null)
      setDownloading(false)
      setPercent(null)
      // A new version (or an explicit re-check) re-opens a dismissed banner.
      setDismissed(null)
    })
    const offDownloading = window.zapret.onAppUpdateDownloading((v) => {
      // The download can be started from the native dialog — the banner never
      // called `download()` itself, so enter the loading state here. Otherwise
      // the user sees a plain "Download" button with no indication anything
      // is happening.
      setAvailable((prev) => prev ?? v)
      setDownloading(true)
      setPercent(0)
      setDismissed(null)
    })
    const offDownloaded = window.zapret.onAppUpdateDownloaded((v) => {
      setDownloaded(v)
      setAvailable((prev) => prev ?? v)
      setDownloading(false)
      setPercent(null)
      setDismissed(null)
    })
    const offError = window.zapret.onAppUpdateError((msg) => {
      setDownloading(false)
      setPercent(null)
      setError(msg)
    })
    const offProgress = window.zapret.onDownloadProgress((p) => {
      // Shared channel (strategies/engine too) — only reflect it while an
      // app download is in flight to avoid чужой progress. The in-flight flag
      // is set either by this banner's own `download()` or by the
      // `onAppUpdateDownloading` event (native dialog path).
      const next = Math.max(0, Math.min(100, p.percent))
      setPercent((prev) => (prev === null ? prev : next))
    })
    return () => {
      offAvailable()
      offDownloading()
      offDownloaded()
      offError()
      offProgress()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = downloaded ?? available
  if (!shown || dismissed === shown) return null

  async function download(): Promise<void> {
    setDownloading(true)
    setPercent(0)
    try {
      await window.zapret.downloadAppUpdate()
    } catch {
      setDownloading(false)
      setPercent(null)
    }
  }

  function install(): void {
    void window.zapret
      .installAppUpdate()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const isDownloaded = downloaded !== null

  return (
    <div
      role="alert"
      className="flex animate-slide-down flex-wrap items-center gap-x-3 gap-y-2 border-b border-sky-500/30 bg-gradient-to-r from-sky-500/20 via-sky-500/10 to-transparent px-4 py-2.5 text-sm"
    >
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-600 dark:text-sky-400"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      </span>
      <span className="min-w-0 flex-1 basis-48 font-medium text-sky-900 dark:text-sky-100">
        {isDownloaded
          ? t('updates.appDownloaded').replace('{version}', downloaded as string)
          : t('updates.appAvailable').replace('{version}', available as string)}
        {downloading && percent !== null ? ` — ${percent}%` : null}
      </span>
      {downloading && percent !== null ? (
        <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-sky-500/20">
          <span className="block h-full rounded-full bg-sky-500 transition-all" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
      <span className="flex shrink-0 items-center gap-1.5">
        {isDownloaded ? (
          <button
            type="button"
            onClick={install}
            className="inline-flex min-h-[32px] items-center gap-2 rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-[0.97]"
          >
            {t('updates.appInstall')}
          </button>
        ) : downloading ? (
          <span className="inline-flex min-h-[32px] items-center gap-2 px-2 text-sm text-sky-700 dark:text-sky-300">
            <Spinner /> {t('updates.appDownloading')}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void download()}
            className="inline-flex min-h-[32px] items-center gap-2 rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-[0.97]"
          >
            {t('updates.appDownload')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPage('updates')}
          className="inline-flex min-h-[32px] items-center rounded-lg border border-sky-500/40 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-[0.97] dark:text-sky-300"
        >
          {t('nav.updates')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(shown)}
          disabled={downloading}
          title={t('action.close')}
          aria-label={t('action.close')}
          className="rounded-lg p-2 text-sky-700/70 transition hover:bg-sky-500/20 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 active:scale-95 disabled:cursor-wait disabled:opacity-40 disabled:hover:bg-transparent dark:text-sky-300/70 dark:hover:bg-sky-500/10 dark:hover:text-sky-100"
        >
          ✕
        </button>
      </span>
    </div>
  )
}

const ADMIN_BANNER_KEY = 'zapret:admin-banner-minimized'

function readAdminBannerMinimized(): boolean {
  try {
    return localStorage.getItem(ADMIN_BANNER_KEY) === '1'
  } catch {
    return false
  }
}

function AdminBanner(): React.JSX.Element | null {
  const { status, t, setError } = useUi()
  const [pending, setPending] = useState(false)
  const [minimized, setMinimized] = useState<boolean>(() => readAdminBannerMinimized())

  function minimize(): void {
    setMinimized(true)
    try {
      localStorage.setItem(ADMIN_BANNER_KEY, '1')
    } catch {
      // private mode — stay minimized for this session only
    }
  }

  function expand(): void {
    setMinimized(false)
    try {
      localStorage.removeItem(ADMIN_BANNER_KEY)
    } catch {
      // ignore storage errors
    }
  }

  if (!status || status.isAdmin) return null

  async function relaunch(): Promise<void> {
    if (pending) return
    setPending(true)
    try {
      const ok = await window.zapret.relaunchAsAdmin()
      if (!ok) {
        // UAC denied / launch failed: main keeps running, re-enable button.
        // Success quits the app, so pending stays true on ok === true.
        setPending(false)
      }
    } catch (e) {
      // A failure re-enables the button and surfaces
      // the reason instead of failing silently.
      setPending(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    // Banner height animates via grid rows (1fr <-> 0fr); the shield is a
    // floating button, so when minimized no bar remains — only the icon.
    // z-10 is required: the page wrapper (animate-page-in, fill both) stays a
    // stacking context painted later in DOM order, otherwise it would cover
    // the shield's lower half and swallow part of its clicks.
    <div role="alert" className="relative z-10 animate-slide-down">
      <div
        aria-hidden={minimized}
        className={`grid transition-all duration-300 ease-in-out ${
          minimized ? 'invisible grid-rows-[0fr] opacity-0' : 'visible grid-rows-[1fr] opacity-100'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`flex origin-top-right flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/30 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent px-4 py-2.5 text-sm transition-all duration-300 ease-in-out ${
              minimized ? '-translate-y-2 scale-[0.96] opacity-0' : 'translate-y-0 scale-100 opacity-100'
            }`}
          >
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 basis-48 font-medium text-amber-900 dark:text-amber-100">
              {t('dashboard.adminMissing')}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void relaunch()}
                disabled={pending}
                className="inline-flex min-h-[32px] items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-1.5 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <Spinner />
                ) : (
                  <StrokeIcon className="h-4 w-4 shrink-0">
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                    <path d="m9 12 2 2 4-4" />
                  </StrokeIcon>
                )}
                {t('dashboard.relaunchAdmin')}
              </button>
              <button
                type="button"
                onClick={minimize}
                title={t('action.close')}
                aria-label={t('action.close')}
                aria-expanded={!minimized}
                className="rounded-lg p-2 text-amber-700/70 transition hover:bg-amber-500/20 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 active:scale-95 dark:text-amber-300/70 dark:hover:bg-amber-500/10 dark:hover:text-amber-100"
              >
                ✕
              </button>
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={expand}
        title={t('dashboard.adminMissing')}
        aria-label={t('dashboard.adminMissing')}
        aria-expanded={!minimized}
        aria-hidden={!minimized}
        tabIndex={minimized ? undefined : -1}
        className={`absolute right-5 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-600 shadow-md backdrop-blur-sm transition-all duration-300 ease-in-out hover:scale-105 hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 active:scale-95 dark:text-amber-400 ${
          minimized ? 'visible scale-100 opacity-100' : 'invisible scale-50 opacity-0'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4"
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="M12 8v4" />
          <path d="M12 12h.01" />
        </svg>
        <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500 dark:border-slate-900" />
        </span>
      </button>
    </div>
  )
}

function ErrorBanner(): React.JSX.Element | null {
  const { error, setError } = useUi()
  if (!error) return null
  return (
    <div className="flex animate-slide-down items-center justify-between gap-3 border-b border-red-500/40 bg-red-500/10 px-5 py-2 text-sm text-red-700 dark:text-red-200">
      <span className="break-all">❌ {error}</span>
      <button onClick={() => setError(null)} className="shrink-0 rounded px-2 py-0.5 hover:bg-red-500/20">
        ✕
      </button>
    </div>
  )
}
