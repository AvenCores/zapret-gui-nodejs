/** Logs page: live stream + filter + export. */
import React, { useState } from 'react'
import { useUi } from '../store'
import { Btn, Card } from '../components/ui'

const levelColor: Record<string, string> = {
  info: 'text-slate-300',
  warn: 'text-amber-300',
  error: 'text-red-300'
}

export default function Logs(): React.JSX.Element {
  const { t, logs } = useUi()
  const [filter, setFilter] = useState<string>('')

  const shown = logs.filter(
    (l) =>
      filter === '' ||
      l.text.toLowerCase().includes(filter.toLowerCase()) ||
      l.source.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('logs.title')}</h1>
        <Btn variant="secondary" onClick={() => void window.zapret.exportLogs()}>
          {t('action.export')}
        </Btn>
      </div>
      <Card>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('logs.filter')}
          className="mb-2 w-full rounded-lg bg-slate-900 px-3 py-1.5 text-sm outline-none ring-sky-600 focus:ring-1"
        />
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('logs.empty')}</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto font-mono text-[11px] leading-relaxed">
            {shown.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all border-b border-slate-800 py-0.5">
                <span className="text-slate-500">{l.ts.slice(11, 19)}</span>{' '}
                <span className="text-sky-400">[{l.source}]</span>{' '}
                <span className={levelColor[l.level]}>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
