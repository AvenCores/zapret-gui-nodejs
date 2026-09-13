/** Tiny presentational primitives (no external component library). */
import React from 'react'

export function Card(props: { title?: string; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={`rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 shadow ${props.className ?? ''}`}>
      {props.title ? <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">{props.title}</h2> : null}
      {props.children}
    </section>
  )
}

type Tone = 'green' | 'red' | 'yellow' | 'gray' | 'blue'

const toneClass: Record<Tone, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  red: 'bg-red-500/15 text-red-300 border-red-500/40',
  yellow: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  gray: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  blue: 'bg-sky-500/15 text-sky-300 border-sky-500/40'
}

export function Badge(props: { tone: Tone; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClass[props.tone]}`}>
      {props.children}
    </span>
  )
}

export function Dot(props: { tone: Tone }): React.JSX.Element {
  const bg = props.tone === 'green' ? 'bg-emerald-400' : props.tone === 'red' ? 'bg-red-400' : props.tone === 'yellow' ? 'bg-amber-400' : props.tone === 'blue' ? 'bg-sky-400' : 'bg-slate-400'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${bg}`} />
}

export function Btn(props: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
}): React.JSX.Element {
  const base = 'rounded-lg px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
  const v =
    props.variant === 'danger'
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : props.variant === 'ghost'
        ? 'text-slate-300 hover:bg-slate-700/60'
        : props.variant === 'secondary'
          ? 'bg-slate-700 hover:bg-slate-600 text-slate-100'
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
      <span className="text-sm text-slate-300">{props.label}</span>
      <span className="flex items-center gap-2">{props.children}</span>
    </div>
  )
}

export function Spinner(): React.JSX.Element {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
}

export function ProgressBar(props: { percent: number }): React.JSX.Element {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
      <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, props.percent))}%` }} />
    </div>
  )
}

export function Code(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
      {props.children}
    </pre>
  )
}
