/** Diagnostics page: checks table + tools. */
import React, { useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, Spinner } from '../components/ui'
import { formatDetail } from '../../shared/i18n'
import type { DiagnosticCheck } from '../../shared/types'

function tone(level: DiagnosticCheck['level']): 'green' | 'yellow' | 'red' {
  return level === 'ok' ? 'green' : level === 'warn' ? 'yellow' : 'red'
}

function icon(level: DiagnosticCheck['level']): string {
  return level === 'ok' ? '✅' : level === 'warn' ? '⚠️' : '❌'
}

export default function Diagnostics(): React.JSX.Element {
  const { t, setError, status, locale } = useUi()
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
      // The test script runs detached in its own PowerShell window, so the
      // IPC call only acknowledges the launch (boolean) — show a hint instead.
      if (key === 'tests') {
        setToolOut(t('diag.testsLaunched'))
      } else {
        setToolOut(Array.isArray(r) ? r.join('\n') : String(r ?? t('level.ok')))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const disabled = !status?.isAdmin

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.diagnostics')}</h1>
        {checks ? (
          <Btn onClick={() => void run()} disabled={running}>
            {running ? <Spinner /> : t('diag.run')}
          </Btn>
        ) : null}
      </div>

      {checks ? (
        <Card>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700/60">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="text-sm font-medium">
                    {icon(c.level)} {t(c.labelKey as never)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{formatDetail(locale, c)}</div>
                </div>
                <Badge tone={tone(c.level)}>{t(`level.${c.level}` as never)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
              </svg>
            </span>
            <div className="text-sm font-semibold">{t('diag.emptyTitle')}</div>
            <p className="max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('diag.emptyHint')}</p>
            <div className="mt-1">
              <Btn onClick={() => void run()} disabled={running}>
                {running ? <Spinner /> : t('diag.run')}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card title={t('diag.tools')}>
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
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[11px] text-slate-800 dark:bg-black/50 dark:text-slate-200">
            {toolOut}
          </pre>
        ) : null}
      </Card>
    </div>
  )
}
