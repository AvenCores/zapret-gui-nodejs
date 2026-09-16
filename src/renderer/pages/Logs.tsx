/** Logs section (embedded in Diagnostics): category tabs + text filter + copy/export. */
import React, { useMemo, useState } from 'react'
import { useUi } from '../store'
import { Btn, Card } from '../components/ui'
import { logCategoryOf, type LogCategory } from '../../shared/types'

const levelColor: Record<string, string> = {
  info: 'text-slate-600 dark:text-slate-300',
  warn: 'text-amber-700 dark:text-amber-300',
  error: 'text-red-600 dark:text-red-300'
}

const TABS: LogCategory[] = ['all', 'zapret', 'tg-proxy', 'app']

function tabKey(cat: LogCategory): string {
  if (cat === 'all') return 'logs.all'
  if (cat === 'zapret') return 'logs.zapret'
  if (cat === 'tg-proxy') return 'logs.tgproxy'
  return 'logs.app'
}

export default function LogsSection(): React.JSX.Element {
  const { t, logs, settings, clearLogs, setError } = useUi()
  const [category, setCategory] = useState<LogCategory>('all')
  const [filter, setFilter] = useState<string>('')
  const [copied, setCopied] = useState<boolean>(false)

  const logsEnabled = settings?.logsEnabled !== false

  const counts = useMemo(() => {
    const c = { all: logs.length, zapret: 0, 'tg-proxy': 0, app: 0 } as Record<LogCategory, number>
    for (const l of logs) c[logCategoryOf(l.source)] += 1
    return c
  }, [logs])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      if (category !== 'all' && logCategoryOf(l.source) !== category) return false
      if (q === '') return true
      return l.text.toLowerCase().includes(q) || l.source.toLowerCase().includes(q)
    })
  }, [logs, category, filter])

  // Copy what is currently shown (category + text filter). Export writes the
  // whole buffered category from the main process (text search is view-only).
  async function copyShown(): Promise<void> {
    if (shown.length === 0) return
    const text = shown.map((l) => `[${l.ts}] [${l.source}/${l.level}] ${l.text}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      } catch {
        return
      }
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  async function exportCategory(): Promise<void> {
    try {
      await window.zapret.exportLogs(category)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">{t('nav.logs')}</h2>
        <div className="flex items-center gap-2">
          <Btn variant="secondary" onClick={() => void copyShown()} disabled={shown.length === 0}>
            {copied ? `✓ ${t('about.copied')}` : t('about.copy')}
          </Btn>
          <Btn variant="secondary" onClick={() => clearLogs(category)} disabled={shown.length === 0}>
            {t('logs.clear')}
          </Btn>
          <Btn variant="secondary" onClick={() => void exportCategory()} disabled={!logsEnabled || counts[category] === 0}>
            {t('action.export')}
          </Btn>
        </div>
      </div>
      <Card>
        <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label={t('nav.logs')}>
          {TABS.map((c) => {
            const active = category === c
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(c)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition active:scale-95 ${
                  active
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {t(tabKey(c) as never)}
                <span
                  className={`rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-500/10 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {counts[c]}
                </span>
              </button>
            )
          })}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('logs.filter')}
          disabled={!logsEnabled}
          className="mb-2 w-full rounded-lg bg-slate-100 px-3 py-1.5 text-sm outline-none ring-sky-600 focus:ring-1 disabled:opacity-40 dark:bg-slate-900"
        />
        {!logsEnabled ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('logs.disabled')}</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('logs.empty')}</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto font-mono text-[11px] leading-relaxed">
            {shown.map((l, i) => (
              <div key={`${l.ts}-${i}`} className="whitespace-pre-wrap break-all border-b border-slate-200 py-0.5 dark:border-slate-800">
                <span className="text-slate-500">{l.ts.slice(11, 19)}</span>{' '}
                <span className="text-sky-600 dark:text-sky-400">[{l.source}]</span>{' '}
                <span className={levelColor[l.level]}>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
