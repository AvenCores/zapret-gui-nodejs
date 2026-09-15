/** Updates section (embedded in Settings): version check, ipset/strategies refresh. */
import React, { useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, ProgressBar, Row, Spinner } from '../components/ui'
import type { DownloadProgress, EngineRelease, EngineVersionInfo, UpdateInfo } from '../../shared/types'

export default function UpdatesSection(): React.JSX.Element {
  const { t, setError, status } = useUi()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState<boolean>(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [backupDir, setBackupDir] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineVersionInfo | null>(null)
  const [checkingEngine, setCheckingEngine] = useState<boolean>(false)
  const [releases, setReleases] = useState<EngineRelease[]>([])
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [releasesLoading, setReleasesLoading] = useState<boolean>(false)
  const [engineResult, setEngineResult] = useState<string | null>(null)
  const [engineBackupDir, setEngineBackupDir] = useState<string | null>(null)

  async function wrap(key: string, fn: () => Promise<void>): Promise<void> {
    setBusyKey(key)
    setResult(null)
    setBackupDir(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  const disabled = !status?.isAdmin
  const spin = (key: string): React.JSX.Element | null => (busyKey === key ? <Spinner /> : null)

  function formatReleaseDate(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString()
  }

  function loadEngineReleases(): void {
    setReleasesLoading(true)
    window.zapret
      .listEngineReleases(20)
      .then((list) => {
        setReleases(list)
        if (list.length > 0) {
          setSelectedTag((prev) => prev !== '' ? prev : (engine?.remote ?? list[0].tag))
        }
      })
      .catch(() => setError(t('updates.engineReleasesFailed')))
      .finally(() => setReleasesLoading(false))
  }

  function checkEngine(): void {
    setCheckingEngine(true)
    window.zapret
      .checkEngineUpdates()
      .then((v) => {
        setEngine(v)
        if (v.remote) setSelectedTag((prev) => prev !== '' ? prev : v.remote as string)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCheckingEngine(false))
  }

  function updateEngine(): void {
    if (selectedTag === '') return
    setBusyKey('engine')
    setEngineResult(null)
    setEngineBackupDir(null)
    setProgress({ percent: 0, transferred: 0, total: null })
    const off = window.zapret.onDownloadProgress(setProgress)
    window.zapret
      .updateEngine(selectedTag)
      .then((r) => {
        setEngineBackupDir(r.backupDir)
        setEngineResult(
          t('updates.engineResult')
            .replace('{tag}', r.tag)
            .replace('{count}', String(r.filesUpdated.length))
            .replace('{dir}', r.backupDir)
        )
        return window.zapret.checkEngineUpdates().then(setEngine).catch(() => undefined)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusyKey(null)
        off()
        setProgress(null)
      })
  }

  return (
    <div className="space-y-4">
      <Card title={`${t('updates.current')} / ${t('updates.remote')}`}>
        <Row label={t('updates.current')}>
          <Badge tone="gray">{info?.localVersion ?? '…'}</Badge>
        </Row>
        <Row label={t('updates.remote')}>
          <Badge tone={info?.updateAvailable ? 'yellow' : 'gray'}>{info?.remoteVersion ?? '…'}</Badge>
        </Row>
        <Row label={t('updates.app')}>
          <Badge tone="gray">{info?.appVersion ?? '…'}</Badge>
        </Row>
        {info ? (
          <p className="py-1 text-sm">
            {info.updateAvailable ? (
              <span className="text-amber-700 dark:text-amber-300">
                ⚠ {t('updates.available')}{' '}
                <a href={info.releaseUrl} target="_blank" rel="noreferrer" className="underline">
                  {info.releaseUrl}
                </a>
              </span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-300">✓ {t('updates.upToDate')}</span>
            )}
          </p>
        ) : null}
        <div className="mt-2">
          <Btn
            disabled={checking}
            onClick={() => {
              setChecking(true)
              window.zapret
                .checkUpdates()
                .then(setInfo)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setChecking(false))
            }}
          >
            {checking ? <Spinner /> : t('action.check')}
          </Btn>
        </div>
      </Card>

      <Card title={t('updates.engineTitle')}>
        <Row label={t('updates.engineLocal')}>
          <Badge tone="gray">{engine?.local ?? '…'}</Badge>
        </Row>
        <Row label={t('updates.engineRemote')}>
          <Badge tone={engine?.updateAvailable ? 'yellow' : 'gray'}>{engine?.remote ?? '…'}</Badge>
        </Row>
        {engine ? (
          <p className="py-1 text-sm">
            {engine.updateAvailable ? (
              <span className="text-amber-700 dark:text-amber-300">
                ⚠ {t('updates.engineAvailable')}{' '}
                <a href={engine.releasesUrl} target="_blank" rel="noreferrer" className="underline">
                  {engine.releasesUrl}
                </a>
              </span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-300">✓ {t('updates.engineUpToDate')}</span>
            )}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn disabled={checkingEngine} onClick={checkEngine}>
            {checkingEngine ? <Spinner /> : t('action.check')}
          </Btn>
          <Btn variant="secondary" disabled={releasesLoading || busyKey !== null} onClick={loadEngineReleases}>
            {releasesLoading ? <Spinner /> : null} {t('updates.loadReleases')}
          </Btn>
        </div>
        {releases.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              disabled={busyKey !== null}
              className="min-h-[32px] max-w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              {selectedTag === '' ? <option value="">…</option> : null}
              {releases.map((r) => (
                <option key={r.tag} value={r.tag}>
                  {r.tag}{formatReleaseDate(r.publishedAt) !== '' ? ` — ${formatReleaseDate(r.publishedAt)}` : ''}
                </option>
              ))}
            </select>
            <Btn variant="secondary" disabled={disabled || busyKey !== null || selectedTag === ''} onClick={updateEngine}>
              {spin('engine')} {t('updates.updateEngine')}
            </Btn>
          </div>
        ) : null}
        {busyKey === 'engine' && progress ? (
          <div className="mt-3">
            <ProgressBar percent={progress.percent} />
          </div>
        ) : null}
        {engineResult ? (
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
            ✓ {engineResult} {t('updates.engineRestartHint')}
          </p>
        ) : null}
        {engineBackupDir ? (
          <div className="mt-2">
            <button
              onClick={() => void window.zapret.openBackupFolder(engineBackupDir).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
              title={engineBackupDir}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-sky-500/40 hover:text-sky-700 active:scale-95 dark:border-slate-600/60 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:border-sky-400/40 dark:hover:text-sky-300"
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.8]" aria-hidden="true">
                <path d="M2.5 6.5a2 2 0 0 1 2-2h4l2 2.5h5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" strokeLinejoin="round" />
                <path d="M10 10.5v4m0-4-1.5 1.5M10 10.5l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('updates.openBackup')}
            </button>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          <Btn
            variant="secondary"
            disabled={disabled || busyKey !== null}
            onClick={() => void wrap('ipset', async () => {
              const r = await window.zapret.updateIPSet()
              setResult(t('updates.ipsetResult').replace('{lines}', String(r.lines)).replace('{bytes}', String(r.bytes)))
            })}
          >
            {spin('ipset')} {t('updates.updateIpSet')}
          </Btn>
          <Btn
            variant="secondary"
            disabled={disabled || busyKey !== null}
            onClick={() => {
              setProgress({ percent: 0, transferred: 0, total: null })
              const off = window.zapret.onDownloadProgress(setProgress)
              void wrap('strategies', async () => {
                const r = await window.zapret.updateStrategies()
                setBackupDir(r.backupDir)
                setResult(
                  t('updates.strategiesResult')
                    .replace('{count}', String(r.filesUpdated.length))
                    .replace('{tag}', r.tag)
                    .replace('{dir}', r.backupDir)
                )
              }).finally(() => {
                off()
                setProgress(null)
              })
            }}
          >
            {spin('strategies')} {t('updates.updateStrategies')}
          </Btn>
        </div>
        {busyKey === 'strategies' && progress ? (
          <div className="mt-3">
            <ProgressBar percent={progress.percent} />
          </div>
        ) : null}
        {result ? <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">✓ {result}</p> : null}
        {backupDir ? (
          <div className="mt-2">
            <button
              onClick={() => void window.zapret.openBackupFolder(backupDir).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
              title={backupDir}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-sky-500/40 hover:text-sky-700 active:scale-95 dark:border-slate-600/60 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:border-sky-400/40 dark:hover:text-sky-300"
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.8]" aria-hidden="true">
                <path d="M2.5 6.5a2 2 0 0 1 2-2h4l2 2.5h5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" strokeLinejoin="round" />
                <path d="M10 10.5v4m0-4-1.5 1.5M10 10.5l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('updates.openBackup')}
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
