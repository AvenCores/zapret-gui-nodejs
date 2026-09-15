/** Logs section (embedded in Diagnostics): live stream + filter + copy/export. */
import React, { useState } from 'react'
import { useUi } from '../store'
import { Btn, Card } from '../components/ui'

const levelColor: Record<string, string> = {
  info: 'text-slate-600 dark:text-slate-300',
  warn: 'text-amber-700 dark:text-amber-300',
  error: 'text-red-600 dark:text-red-300'
}

export default function LogsSection(): React.JSX.Element {
  const { t, logs, clearLogs } = useUi()
  const [filter, setFilter] = useState<string>('')
  const [copied, setCopied] = useState<boolean>(false)

  const shown = logs.filter(
    (l) =>
      filter === '' ||
      l.text.toLowerCase().includes(filter.toLowerCase()) ||
      l.source.toLowerCase().includes(filter.toLowerCase())
  )

  // Copy ALL buffered logs (same format as Export), ignoring the view filter.
  async function copyAll(): Promise<void> {
    if (logs.length === 0) return
    const text = logs.map((l) => `[${l.ts}] [${l.source}/${l.level}] ${l.text}`).join('\n')
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">{t('nav.logs')}</h2>
        <div className="flex items-center gap-2">
          <Btn variant="secondary" onClick={() => void copyAll()} disabled={logs.length === 0}>
            {copied ? `✓ ${t('about.copied')}` : t('about.copy')}
          </Btn>
          <Btn variant="secondary" onClick={clearLogs} disabled={logs.length === 0}>
            {t('logs.clear')}
          </Btn>
          <Btn variant="secondary" onClick={() => void window.zapret.exportLogs()}>
            {t('action.export')}
          </Btn>
        </div>
      </div>
      <Card>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('logs.filter')}
          className="mb-2 w-full rounded-lg bg-slate-100 px-3 py-1.5 text-sm outline-none ring-sky-600 focus:ring-1 dark:bg-slate-900"
        />
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('logs.empty')}</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto font-mono text-[11px] leading-relaxed">
            {shown.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all border-b border-slate-200 py-0.5 dark:border-slate-800">
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
