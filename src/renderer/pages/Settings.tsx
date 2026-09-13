/** Settings: game filter, ipset, auto-update check, autostart, tray, fakes. */
import React, { useEffect, useState } from 'react'
import { useUi } from '../store'
import { Btn, Card, Row, Spinner } from '../components/ui'
import type { GameFilterMode, IPSetMode } from '../../shared/types'
import type { I18nKey } from '../../shared/i18n'

const GAME_VALUES: GameFilterMode[] = ['disabled', 'all', 'tcp', 'udp']

const IPSET_VALUES: IPSetMode[] = ['none', 'loaded', 'any']

function gameLabel(t: (k: I18nKey) => string, v: GameFilterMode): string {
  switch (v) {
    case 'disabled':
      return t('settings.gameDisabled')
    case 'all':
      return t('settings.gameAll')
    case 'tcp':
      return t('settings.gameTcp')
    case 'udp':
      return t('settings.gameUdp')
  }
}

function ipsetLabel(t: (k: I18nKey) => string, v: IPSetMode): string {
  switch (v) {
    case 'none':
      return t('settings.ipsetNone')
    case 'loaded':
      return t('settings.ipsetLoaded')
    case 'any':
      return t('settings.ipsetAny')
  }
}

export default function Settings(): React.JSX.Element {
  const { t, settings, applySettings, setError, status } = useUi()
  const [game, setGame] = useState<GameFilterMode>('disabled')
  const [ipset, setIpset] = useState<IPSetMode>('none')
  const [autoCheck, setAutoCheck] = useState<boolean>(true)
  const [fakes, setFakes] = useState<{ discordActive: string | null; gameActive: string | null; all: string[] }>({
    discordActive: null,
    gameActive: null,
    all: []
  })
  const [discordFake, setDiscordFake] = useState<string>('')
  const [gameFake, setGameFake] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    void (async () => {
      try {
        const [g, i, a, f] = await Promise.all([
          window.zapret.getGameFilter(),
          window.zapret.getIPSetMode(),
          window.zapret.getAutoUpdateCheck(),
          window.zapret.listFakes()
        ])
        setGame(g)
        setIpset(i)
        setAutoCheck(a)
        setFakes(f)
        setDiscordFake(f.discordActive ?? f.all[0] ?? '')
        setGameFake(f.gameActive ?? f.all[0] ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function wrap(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const disabled = !status?.isAdmin

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.settings')}</h1>

      <Card title={t('settings.gameFilter')}>
        <div className="flex flex-wrap gap-2">
          {GAME_VALUES.map((v) => (
            <Btn
              key={v}
              variant={game === v ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => void wrap(async () => {
                await window.zapret.setGameFilter(v)
                setGame(v)
              })}
            >
              {gameLabel(t, v)}
            </Btn>
          ))}
        </div>
      </Card>

      <Card title={t('settings.ipset')}>
        <div className="flex flex-wrap gap-2">
          {IPSET_VALUES.map((v) => (
            <Btn
              key={v}
              variant={ipset === v ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => void wrap(async () => {
                await window.zapret.setIPSetMode(v)
                setIpset(v)
              })}
            >
              {ipsetLabel(t, v)}
            </Btn>
          ))}
        </div>
      </Card>

      <Card>
        <Row label={t('settings.autoUpdateCheck')}>
          <Toggle value={autoCheck} onChange={(v) => void wrap(async () => {
            await window.zapret.setAutoUpdateCheck(v)
            setAutoCheck(v)
          })} />
        </Row>
        <Row label={t('settings.autoLaunch')}>
          <Toggle value={settings?.autoLaunch ?? false} onChange={(v) => void applySettings({ autoLaunch: v })} />
        </Row>
        <Row label={t('settings.tray')}>
          <Toggle
            value={settings?.minimizeToTrayOnClose ?? true}
            onChange={(v) => void applySettings({ minimizeToTrayOnClose: v })}
          />
        </Row>
        <Row label={t('settings.startMinimized')}>
          <Toggle
            value={settings?.startMinimizedToTray ?? false}
            onChange={(v) => void applySettings({ startMinimizedToTray: v })}
          />
        </Row>
      </Card>

      <Card title={t('settings.fakes')}>
        <Row label={`${t('settings.discordFake')} (${fakes.discordActive ?? '?'})`}>
          <select
            value={discordFake}
            onChange={(e) => setDiscordFake(e.target.value)}
            className="rounded-md bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700"
          >
            {fakes.all.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <Btn
            variant="secondary"
            disabled={disabled || !discordFake}
            onClick={() => void wrap(async () => {
              await window.zapret.replaceFake('discord', discordFake)
              setFakes({ ...fakes, discordActive: discordFake })
            })}
          >
            {t('action.apply')}
          </Btn>
        </Row>
        <Row label={`${t('settings.gameFake')} (${fakes.gameActive ?? '?'})`}>
          <select value={gameFake} onChange={(e) => setGameFake(e.target.value)} className="rounded-md bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700">
            {fakes.all.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <Btn
            variant="secondary"
            disabled={disabled || !gameFake}
            onClick={() => void wrap(async () => {
              await window.zapret.replaceFake('game', gameFake)
              setFakes({ ...fakes, gameActive: gameFake })
            })}
          >
            {t('action.apply')}
          </Btn>
        </Row>
      </Card>
    </div>
  )
}

function Toggle(props: { value: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      onClick={() => props.onChange(!props.value)}
      className={`relative h-6 w-11 rounded-full transition ${props.value ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}
      aria-pressed={props.value}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${props.value ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}
