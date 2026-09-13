/** Strategies: pick, apply, foreground-test, import custom .bat. */
import React, { useEffect, useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, Code, Spinner } from '../components/ui'

export default function Strategies(): React.JSX.Element {
  const { t, strategies, refreshStrategies, refreshStatus, busy, setError, status, settings } = useUi()
  const [selected, setSelected] = useState<string>('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testOut, setTestOut] = useState<string>('')
  const [query, setQuery] = useState<string>('')

  useEffect(() => {
    if (!selected) {
      const active = status?.activeStrategy ?? settings?.activeStrategyId
      const match = strategies.find((s) => s.name === active || s.id === active)
      setSelected(match?.id ?? strategies[0]?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies])

  useEffect(() => window.zapret.onTestOutput((o) => {
    if (o.stream === 'exit') {
      setTesting(null)
    } else {
      setTestOut((prev) => (prev + o.text).slice(-8000))
    }
  }), [])

  const current = strategies.find((s) => s.id === selected)
  const filtered = strategies.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
  const bundled = filtered.filter((s) => s.origin !== 'imported')
  const imported = filtered.filter((s) => s.origin === 'imported')
  const selectSize = Math.min(12, Math.max(4, filtered.length))

  async function apply(): Promise<void> {
    if (!current) return
    if (!window.confirm(`${t('action.apply')} "${current.name}"?\n${t('strategies.applyHint')}`)) return
    try {
      await window.zapret.installStrategy(current.id)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleTest(): Promise<void> {
    try {
      if (testing) {
        await window.zapret.stopTest()
        setTesting(null)
      } else if (current) {
        setTestOut('')
        await window.zapret.testStrategy(current.id)
        setTesting(current.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function importBat(): Promise<void> {
    try {
      const s = await window.zapret.importStrategy()
      if (s) {
        await refreshStrategies()
        setSelected(s.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeStrategy(): Promise<void> {
    if (!current || current.origin !== 'imported') return
    if (!window.confirm(`${t('strategies.delete')} "${current.name}"?`)) return
    try {
      if (testing === current.id) {
        await window.zapret.stopTest()
        setTesting(null)
      }
      await window.zapret.deleteStrategy(current.id)
      await refreshStrategies()
      setSelected('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('strategies.title')}</h1>
        <Btn variant="secondary" onClick={() => void importBat()}>
          {t('strategies.import')}
        </Btn>
      </div>

      <Card>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="general…"
          className="mb-2 w-full rounded-lg bg-slate-900 px-3 py-1.5 text-sm outline-none ring-sky-600 focus:ring-1"
        />
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          size={selectSize}
          className="w-full rounded-lg bg-slate-900 px-2 py-1.5 text-sm"
        >
          <optgroup label={t('strategies.bundled')}>
            {bundled.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
          {imported.length > 0 ? (
            <optgroup label={t('strategies.imported')}>
              {imported.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {busy['strategies'] ? (
          <div className="mt-2">
            <Spinner />
          </div>
        ) : null}
      </Card>

      {current ? (
        <Card title={current.name}>
          <p className="mb-2 text-sm text-slate-300">{current.description}</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {current.desyncMethods.map((m) => (
              <Badge key={m} tone="blue">
                {m}
              </Badge>
            ))}
            {(status?.activeStrategy === current.name || settings?.activeStrategyId === current.id) && (
              <Badge tone="green">active</Badge>
            )}
            {current.origin === 'imported' ? (
              <Badge tone="yellow">{t('strategies.imported')}</Badge>
            ) : null}
          </div>
          <Code>{current.rawArgs}</Code>
          <p className="mt-2 text-xs text-slate-400">{t('strategies.applyHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => void apply()} disabled={!status?.isAdmin}>
              {t('action.apply')}
            </Btn>
            <Btn variant="secondary" onClick={() => void toggleTest()} disabled={!status?.isAdmin}>
              {testing ? t('strategies.testStop') : t('action.test')}
            </Btn>
            {current.origin === 'imported' ? (
              <Btn variant="danger" onClick={() => void removeStrategy()}>
                {t('strategies.delete')}
              </Btn>
            ) : null}
          </div>
          {testing ? (
            <div className="mt-3">
              <p className="mb-1 text-xs text-amber-300">⚠ {t('strategies.testing')}</p>
              <Code>{testOut || '(waiting for winws output…)'}</Code>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
