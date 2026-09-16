/** Updates page: app / zapret-data / engine version checks with update offers. */
import React, { useEffect, useRef, useState } from 'react'
import { useUi } from '../store'
import { Badge, Btn, Card, ProgressBar, Row, Spinner } from '../components/ui'
import type { AppUpdateInfo, DownloadProgress, EngineRelease, EngineVersionInfo, UpdateInfo } from '../../shared/types'

export default function Updates(): React.JSX.Element {
  const { t, setError, status } = useUi()
  const [autoCheck, setAutoCheck] = useState<boolean>(true)
  const [autoCheckLoading, setAutoCheckLoading] = useState<boolean>(true)
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
  const [appCurrent, setAppCurrent] = useState<string>('…')
  const [appInfo, setAppInfo] = useState<AppUpdateInfo | null>(null)
  const [appChecking, setAppChecking] = useState<boolean>(false)
  const [appDownloading, setAppDownloading] = useState<boolean>(false)
  const [appProgress, setAppProgress] = useState<DownloadProgress | null>(null)
  // Mirror of appCurrent for IPC callbacks: the mount effect closure would
  // otherwise capture the initial '…' forever (stale closure).
  const appCurrentRef = useRef<string>('…')
  function setAppCurrentTracked(v: string): void {
    appCurrentRef.current = v
    setAppCurrent(v)
  }
  // Unsubscribe fns of an in-flight app download (cleanup on unmount).
  const appDlOff = useRef<Array<() => void> | null>(null)
  // Mirror of `appDownloading` for IPC callbacks (avoids stale closures and
  // lets the shared `onDownloadProgress` channel update only while an app
  // download is actually in flight).
  const appDownloadingRef = useRef<boolean>(false)
  function setAppDownloadingTracked(v: boolean): void {
    appDownloadingRef.current = v
    setAppDownloading(v)
  }

  useEffect(() => {
    return () => {
      // Unmount mid-download: drop listeners so they never setState on an
      // unmounted component (progress resumes via fresh subscribe on return).
      if (appDlOff.current) {
        for (const off of appDlOff.current) {
          try {
            off()
          } catch {
            /* ignore */
          }
        }
        appDlOff.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        setAutoCheck(await window.zapret.getAutoUpdateCheck())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setAutoCheckLoading(false)
      }
    })()
    void window.zapret.getAppVersion().then(setAppCurrentTracked).catch(() => undefined)
    // Late mount (user opened Updates while the banner already downloads):
    // pick up the cached snapshot so the card shows the same state.
    void window.zapret
      .getAppUpdateState()
      .then((s) => {
        setAppCurrentTracked(s.currentVersion)
        if (!s.availableVersion) return
        setAppInfo({
          currentVersion: s.currentVersion,
          availableVersion: s.availableVersion,
          updateAvailable: s.updateAvailable,
          downloaded: s.downloaded,
          releasesUrl: s.releasesUrl,
          checkedAt: s.checkedAt
        })
        if (s.downloading && !s.downloaded) {
          setAppDownloadingTracked(true)
          setAppProgress({ percent: 0, transferred: 0, total: null })
        }
      })
      .catch(() => undefined)
    // Background auto-check (main process) must be reflected here too:
    // a new release always re-opens the offer, even without manual check.
    const offAvailable = window.zapret.onAppUpdateAvailable((v) => {
      setAppInfo((prev) => ({
        currentVersion: prev?.currentVersion ?? appCurrentRef.current,
        availableVersion: v,
        updateAvailable: true,
        downloaded: false,
        releasesUrl: prev?.releasesUrl ?? 'https://github.com/AvenCores/zapret-gui-nodejs/releases',
        checkedAt: new Date().toISOString()
      }))
    })
    const offDownloading = window.zapret.onAppUpdateDownloading((v) => {
      // Download started from the native dialog (or another view): reflect it
      // here so the user sees the spinner + progress instead of a stale
      // "Download update" button.
      setAppDownloadingTracked(true)
      setAppProgress({ percent: 0, transferred: 0, total: null })
      setAppInfo((prev) => ({
        currentVersion: prev?.currentVersion ?? appCurrentRef.current,
        availableVersion: prev?.availableVersion ?? v,
        updateAvailable: true,
        downloaded: false,
        releasesUrl: prev?.releasesUrl ?? 'https://github.com/AvenCores/zapret-gui-nodejs/releases',
        checkedAt: new Date().toISOString()
      }))
    })
    const offDownloaded = window.zapret.onAppUpdateDownloaded((v) => {
      setAppDownloadingTracked(false)
      setAppProgress(null)
      setAppInfo((prev) => ({
        currentVersion: prev?.currentVersion ?? appCurrentRef.current,
        availableVersion: v,
        updateAvailable: true,
        downloaded: true,
        releasesUrl: prev?.releasesUrl ?? 'https://github.com/AvenCores/zapret-gui-nodejs/releases',
        checkedAt: new Date().toISOString()
      }))
    })
    const offAppError = window.zapret.onAppUpdateError((msg) => {
      // Only touch app state when an app download is (or was) in flight —
      // the shared error channel must not reset engine/strategies UI.
      if (!appDownloadingRef.current && appDlOff.current === null) return
      setAppDownloadingTracked(false)
      setAppProgress(null)
      setError(msg)
    })
    const offAppProgress = window.zapret.onDownloadProgress((p) => {
      // Shared channel (engine/strategies too): reflect only while an app
      // download is in flight, otherwise we'd show чужой progress.
      if (appDownloadingRef.current) setAppProgress(p)
    })
    return () => {
      offAvailable()
      offDownloading()
      offDownloaded()
      offAppError()
      offAppProgress()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function checkEngine(): void {
    setCheckingEngine(true)
    window.zapret
      .checkEngineUpdates()
      .then((v) => {
        setEngine(v)
        if (v.remote) setSelectedTag((prev) => prev !== '' ? prev : v.remote as string)
        // A new engine release must immediately offer a one-click update:
        // preselect the remote tag and preload the version list.
        if (v.updateAvailable && v.remote) {
          setSelectedTag(v.remote)
          if (releases.length === 0) loadEngineReleases(v.remote)
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCheckingEngine(false))
  }

  function loadEngineReleases(presetTag?: string): void {
    setReleasesLoading(true)
    window.zapret
      .listEngineReleases(20)
      .then((list) => {
        setReleases(list)
        if (list.length > 0) {
          const want = presetTag ?? engine?.remote ?? list[0].tag
          setSelectedTag((prev) => prev !== '' && !presetTag ? prev : want)
        }
      })
      .catch(() => setError(t('updates.engineReleasesFailed')))
      .finally(() => setReleasesLoading(false))
  }

  function updateEngineTo(tag: string): void {
    if (tag === '' || busyKey !== null) return
    setSelectedTag(tag)
    setBusyKey('engine')
    setEngineResult(null)
    setEngineBackupDir(null)
    setProgress({ percent: 0, transferred: 0, total: null })
    const off = window.zapret.onDownloadProgress(setProgress)
    window.zapret
      .updateEngine(tag)
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

  function updateEngine(): void {
    updateEngineTo(selectedTag)
  }

  function updateStrategiesNow(): void {
    // The global onDownloadProgress channel is shared with engine updates —
    // don't run both at once or the bars show each other's percents.
    if (busyKey !== null) return
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
  }

  function checkApp(): void {
    setAppChecking(true)
    window.zapret
      .checkAppUpdates()
      .then((v) => {
        setAppInfo(v)
        setAppCurrentTracked(v.currentVersion)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAppChecking(false))
  }

  function downloadApp(): void {
    if (appDownloadingRef.current) return
    setAppDownloadingTracked(true)
    setAppProgress({ percent: 0, transferred: 0, total: null })
    const offProgress = window.zapret.onDownloadProgress((p) => {
      if (appDownloadingRef.current) setAppProgress(p)
    })
    const finishDownloadListeners = (): void => {
      offProgress()
      offDone()
      appDlOff.current = null
    }
    const offDone = window.zapret.onAppUpdateDownloaded(() => {
      setAppDownloadingTracked(false)
      setAppProgress(null)
      finishDownloadListeners()
    })
    appDlOff.current = [offProgress, offDone]
    window.zapret
      .downloadAppUpdate()
      .catch((e: unknown) => {
        // The global `onAppUpdateError` handler already surfaces the message;
        // keep this as a fallback for a direct IPC rejection.
        setAppDownloadingTracked(false)
        setAppProgress(null)
        finishDownloadListeners()
      })
  }

  function installApp(): void {
    void window.zapret.installAppUpdate().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.updates')}</h1>

      <Card>
        <Row label={t('settings.autoUpdateCheck')}>
          <Toggle
            value={autoCheck}
            disabled={autoCheckLoading}
            onChange={(v) => {
              void (async () => {
                try {
                  await window.zapret.setAutoUpdateCheck(v)
                  setAutoCheck(v)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          />
        </Row>
      </Card>

      <Card title={t('updates.appTitle')}>
        <Row label={t('updates.appCurrent')}>
          <Badge tone="gray">{appInfo?.currentVersion ?? appCurrent}</Badge>
        </Row>
        <Row label={t('updates.appRemote')}>
          <Badge tone={appInfo?.updateAvailable ? 'yellow' : 'gray'}>{appInfo?.availableVersion ?? '…'}</Badge>
        </Row>
        {appInfo ? (
          <p className="py-1 text-sm">
            {appInfo.downloaded && appInfo.availableVersion ? (
              <span className="text-amber-700 dark:text-amber-300">
                ⚠ {t('updates.appDownloaded').replace('{version}', appInfo.availableVersion)}{' '}
                <a href={appInfo.releasesUrl} target="_blank" rel="noreferrer" className="underline">
                  {appInfo.releasesUrl}
                </a>
              </span>
            ) : appInfo.updateAvailable && appInfo.availableVersion ? (
              <span className="text-amber-700 dark:text-amber-300">
                ⚠ {t('updates.appAvailable').replace('{version}', appInfo.availableVersion)}{' '}
                <a href={appInfo.releasesUrl} target="_blank" rel="noreferrer" className="underline">
                  {appInfo.releasesUrl}
                </a>
              </span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-300">✓ {t('updates.appUpToDate')}</span>
            )}
          </p>
        ) : null}
        {appDownloading && appProgress ? (
          <div className="mt-2">
            <ProgressBar percent={appProgress.percent} />
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn disabled={appChecking || appDownloading} onClick={checkApp}>
            {appChecking ? <Spinner /> : t('action.check')}
          </Btn>
          {appInfo?.downloaded ? (
            <Btn disabled={false} onClick={installApp}>
              {t('updates.appInstall')}
            </Btn>
          ) : appInfo?.updateAvailable ? (
            <Btn disabled={appDownloading} onClick={downloadApp}>
              {appDownloading ? <Spinner /> : null} {appDownloading ? t('updates.appDownloading') : t('updates.appDownload')}
            </Btn>
          ) : null}
        </div>
      </Card>

      <Card title={`${t('updates.current')} / ${t('updates.remote')}`}>
        <Row label={t('updates.current')}>
          <Badge tone="gray">{info?.localVersion ?? '…'}</Badge>
        </Row>
        <Row label={t('updates.remote')}>
          <Badge tone={info?.updateAvailable ? 'yellow' : 'gray'}>{info?.remoteVersion ?? '…'}</Badge>
        </Row>
        <Row label={t('updates.app')}>
          <Badge tone="gray">{info?.appVersion ?? appCurrent}</Badge>
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
        <div className="mt-2 flex flex-wrap gap-2">
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
          {info?.updateAvailable ? (
            <Btn variant="secondary" disabled={disabled || busyKey !== null} onClick={updateStrategiesNow}>
              {spin('strategies')} {t('updates.updateNow')}
            </Btn>
          ) : null}
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
          <Btn variant="secondary" disabled={releasesLoading || busyKey !== null} onClick={() => loadEngineReleases()}>
            {releasesLoading ? <Spinner /> : null} {t('updates.loadReleases')}
          </Btn>
          {engine?.updateAvailable && engine.remote ? (
            <Btn variant="secondary" disabled={disabled || busyKey !== null} onClick={() => updateEngineTo(engine.remote as string)}>
              {spin('engine')} {t('updates.updateTo').replace('{tag}', engine.remote)}
            </Btn>
          ) : null}
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

function Toggle(props: { value: boolean; disabled?: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      onClick={() => props.onChange(!props.value)}
      disabled={props.disabled}
      className={`relative h-6 w-11 rounded-full transition ${props.value ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} ${props.disabled ? 'cursor-wait opacity-60' : ''}`}
      aria-pressed={props.value}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${props.value ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}
