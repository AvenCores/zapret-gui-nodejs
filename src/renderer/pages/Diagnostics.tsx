/** Diagnostics page: checks table + tools. */
import React, { useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, Spinner } from '../components/ui'
import type { DiagnosticCheck } from '../../shared/types'

function tone(level: DiagnosticCheck['level']): 'green' | 'yellow' | 'red' {
  return level === 'ok' ? 'green' : level === 'warn' ? 'yellow' : 'red'
}

function icon(level: DiagnosticCheck['level']): string {
  return level === 'ok' ? '✅' : level === 'warn' ? '⚠️' : '❌'
}

export default function Diagnostics(): React.JSX.Element {
  const { t, setError, status } = useUi()
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null)
  const [running, setRunning] = useState<boolean>(false)
  const [toolOut, setToolOut] = useState<string | null>(null)

  async function run(): Promise<void> {
    setRunning(true)
    setToolOut(null)
    try {
      setChecks(await window.zapret.runDiagnostics())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function tool(key: 'cache' | 'conflicts' | 'tests', fn: () => Promise<unknown>): Promise<void> {
    try {
      const r = await fn()
      setToolOut(Array.isArray(r) ? r.join('\n') : String(r ?? 'OK'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const disabled = !status?.isAdmin

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.diagnostics')}</h1>
        <Btn onClick={() => void run()} disabled={running}>
          {running ? <Spinner /> : t('diag.run')}
        </Btn>
      </div>

      {checks ? (
        <Card>
          <ul className="divide-y divide-slate-700/60">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="text-sm font-medium">
                    {icon(c.level)} {t(c.labelKey as never)}
                  </div>
                  <div className="text-xs text-slate-400">{c.detail}</div>
                </div>
                <Badge tone={tone(c.level)}>{c.level}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-slate-400">—</p>
        </Card>
      )}

      <Card title="Tools">
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" disabled={disabled} onClick={() => void tool('cache', () => window.zapret.clearDiscordCache())}>
            {t('diag.clearDiscord')}
          </Btn>
          <Btn
            variant="danger"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(t('diag.removeConflicts') + '?')) void tool('conflicts', () => window.zapret.removeConflicts())
            }}
          >
            {t('diag.removeConflicts')}
          </Btn>
          <Btn variant="secondary" onClick={() => void tool('tests', () => window.zapret.runTests())}>
            {t('diag.runTests')}
          </Btn>
        </div>
        {toolOut ? (
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/50 p-3 font-mono text-[11px] text-slate-200">
            {toolOut}
          </pre>
        ) : null}
      </Card>
    </div>
  )
}
