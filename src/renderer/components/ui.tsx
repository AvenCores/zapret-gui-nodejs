/** Tiny presentational primitives (no external component library). */
import React from 'react'

export function Card(props: { title?: string; children: React.ReactNode; className?: string; onClose?: () => void; closeLabel?: string }): React.JSX.Element {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow dark:border-slate-700/60 dark:bg-slate-800/60 ${props.className ?? ''}`}>
      {props.title || props.onClose ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {props.title ? <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">{props.title}</h2> : <span />}
          {props.onClose ? (
            <button
              type="button"
              onClick={props.onClose}
              title={props.closeLabel ?? '×'}
              aria-label={props.closeLabel ?? 'Close'}
              className="rounded-md px-2 py-0.5 text-sm leading-none text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}
      {props.children}
    </section>
  )
}

type Tone = 'green' | 'red' | 'yellow' | 'gray' | 'blue'

const toneClass: Record<Tone, string> = {
  green: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300',
  red: 'bg-red-500/15 text-red-700 border-red-500/40 dark:text-red-300',
  yellow: 'bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300',
  gray: 'bg-slate-500/15 text-slate-600 border-slate-500/40 dark:text-slate-300',
  blue: 'bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300'
}

export function Badge(props: { tone: Tone; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClass[props.tone]}`}>
      {props.children}
    </span>
  )
}

export function Dot(props: { tone: Tone; pulse?: boolean }): React.JSX.Element {
  const bg = props.tone === 'green' ? 'bg-emerald-400' : props.tone === 'red' ? 'bg-red-400' : props.tone === 'yellow' ? 'bg-amber-400' : props.tone === 'blue' ? 'bg-sky-400' : 'bg-slate-400'
  if (!props.pulse) return <span className={`inline-block h-2.5 w-2.5 rounded-full ${bg}`} />
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${bg}`} />
      <span className={`relative inline-block h-2.5 w-2.5 rounded-full ${bg}`} />
    </span>
  )
}

export function Btn(props: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
}): React.JSX.Element {
  const base =
    'inline-flex min-h-[32px] items-center justify-center gap-2 rounded-lg px-3.5 py-1.5 align-middle text-sm font-medium leading-5 transition active:scale-[0.97] disabled:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40'
  const v =
    props.variant === 'danger'
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : props.variant === 'ghost'
        ? 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700/60'
        : props.variant === 'secondary'
          ? 'bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100'
          : 'bg-sky-600 hover:bg-sky-500 text-white'
  return (
    <button type={props.type ?? 'button'} disabled={props.disabled} onClick={props.onClick} className={`${base} ${v}`}>
      {props.children}
    </button>
  )
}

export function Row(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-slate-600 dark:text-slate-300">{props.label}</span>
      <span className="flex items-center gap-2">{props.children}</span>
    </div>
  )
}

export function Spinner(): React.JSX.Element {
  return <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-90" />
}

export function ProgressBar(props: { percent: number }): React.JSX.Element {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, props.percent))}%` }} />
    </div>
  )
}

export function Code(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-black/50 dark:text-slate-200">
      {props.children}
    </pre>
  )
}
