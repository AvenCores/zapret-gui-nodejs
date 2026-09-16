/**
 * Preload: exposes a typed `window.zapret` API to the renderer.
 * @module preload/index
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  AppSettings,
  AppUpdateInfo,
  AppUpdateState,
  BypassCheckResult,
  BypassTargetId,
  ConfigTesterEvent,
  ConfigTestMode,
  DiagnosticCheck,
  DownloadProgress,
  EngineRelease,
  EngineVersionInfo,
  GameFilterMode,
  HostsCheckResult,
  IPSetMode,
  LogLine,
  StatusSnapshot,
  Strategy,
  TgProxySettings,
  TgProxyStats,
  TgProxyStatus,
  TrayPage,
  UpdateInfo,
  UserListMeta
} from '../shared/types'

export interface TestOutput {
  stream: 'stdout' | 'stderr' | 'exit'
  text: string
}

const api = {
  getStatus: (): Promise<StatusSnapshot> => ipcRenderer.invoke(IPC.getStatus),
  listStrategies: (): Promise<Strategy[]> => ipcRenderer.invoke(IPC.listStrategies),
  installStrategy: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.installStrategy, id),
  removeServices: (): Promise<boolean> => ipcRenderer.invoke(IPC.removeServices),
  startService: (): Promise<boolean> => ipcRenderer.invoke(IPC.startService),
  stopService: (): Promise<boolean> => ipcRenderer.invoke(IPC.stopService),
  importStrategy: (): Promise<Strategy | null> => ipcRenderer.invoke(IPC.importStrategy),
  deleteStrategy: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.deleteStrategy, id),
  testStrategy: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.testStrategy, id),
  stopTest: (): Promise<boolean> => ipcRenderer.invoke(IPC.stopTest),
  getGameFilter: (): Promise<GameFilterMode> => ipcRenderer.invoke(IPC.getGameFilter),
  setGameFilter: (mode: GameFilterMode): Promise<boolean> => ipcRenderer.invoke(IPC.setGameFilter, mode),
  getIPSetMode: (): Promise<IPSetMode> => ipcRenderer.invoke(IPC.getIPSetMode),
  setIPSetMode: (mode: IPSetMode): Promise<boolean> => ipcRenderer.invoke(IPC.setIPSetMode, mode),
  getAutoUpdateCheck: (): Promise<boolean> => ipcRenderer.invoke(IPC.getAutoUpdateCheck),
  setAutoUpdateCheck: (v: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.setAutoUpdateCheck, v),
  listFakes: (): Promise<{ discordActive: string | null; gameActive: string | null; all: string[] }> =>
    ipcRenderer.invoke(IPC.listFakes),
  replaceFake: (kind: 'discord' | 'game', fake: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.replaceFake, kind, fake),
  checkUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.checkUpdates),
  updateIPSet: (): Promise<{ lines: number; bytes: number }> => ipcRenderer.invoke(IPC.updateIPSet),
  updateHosts: (): Promise<HostsCheckResult> => ipcRenderer.invoke(IPC.updateHosts),
  applyHosts: (remoteContent: string): Promise<boolean> => ipcRenderer.invoke(IPC.applyHosts, remoteContent),
  removeHosts: (payload?: { firstLine?: string; lastLine?: string; remoteContent?: string }): Promise<boolean> =>
    ipcRenderer.invoke(IPC.removeHosts, payload ?? {}),
  updateStrategies: (): Promise<{ tag: string; filesUpdated: string[]; backupDir: string }> =>
    ipcRenderer.invoke(IPC.updateStrategies),
  listEngineReleases: (limit?: number): Promise<EngineRelease[]> =>
    ipcRenderer.invoke(IPC.listEngineReleases, limit),
  checkEngineUpdates: (): Promise<EngineVersionInfo> => ipcRenderer.invoke(IPC.checkEngineUpdates),
  updateEngine: (tag: string): Promise<{ tag: string; filesUpdated: string[]; backupDir: string }> =>
    ipcRenderer.invoke(IPC.updateEngine, tag),
  runDiagnostics: (): Promise<DiagnosticCheck[]> => ipcRenderer.invoke(IPC.runDiagnostics),
  checkBypass: (id: BypassTargetId): Promise<BypassCheckResult> => ipcRenderer.invoke(IPC.checkBypass, id),
  clearDiscordCache: (): Promise<string[]> => ipcRenderer.invoke(IPC.clearDiscordCache),
  removeConflicts: (): Promise<string[]> => ipcRenderer.invoke(IPC.removeConflicts),
  startConfigTester: (strategyIds: string[], mode: ConfigTestMode): Promise<boolean> =>
    ipcRenderer.invoke(IPC.configTesterStart, strategyIds, mode),
  stopConfigTester: (): Promise<boolean> => ipcRenderer.invoke(IPC.configTesterStop),
  openTestResult: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IPC.configTesterOpenFile, filePath),
  openBackupFolder: (backupDir: string): Promise<boolean> => ipcRenderer.invoke(IPC.openBackupFolder, backupDir),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.saveSettings, patch),
  resetAppData: (): Promise<{ settings: AppSettings; servicesRemoved: boolean }> =>
    ipcRenderer.invoke(IPC.resetAppData),
  listUserLists: (): Promise<UserListMeta[]> => ipcRenderer.invoke(IPC.listUserLists),
  readUserList: (name: string): Promise<string> => ipcRenderer.invoke(IPC.readUserList, name),
  saveUserList: (name: string, content: string): Promise<UserListMeta> =>
    ipcRenderer.invoke(IPC.saveUserList, name, content),
  relaunchAsAdmin: (): Promise<boolean> => ipcRenderer.invoke(IPC.relaunchAsAdmin),
  exportLogs: (): Promise<string | null> => ipcRenderer.invoke(IPC.exportLogs),
  onLog: (cb: (line: LogLine) => void): (() => void) => {
    const fn = (_e: unknown, line: LogLine): void => cb(line)
    ipcRenderer.on(IPC.onLog, fn)
    return () => ipcRenderer.removeListener(IPC.onLog, fn)
  },
  onTestOutput: (cb: (out: TestOutput) => void): (() => void) => {
    const fn = (_e: unknown, out: TestOutput): void => cb(out)
    ipcRenderer.on(IPC.onTestOutput, fn)
    return () => ipcRenderer.removeListener(IPC.onTestOutput, fn)
  },
  onConfigTesterEvent: (cb: (e: ConfigTesterEvent) => void): (() => void) => {
    const fn = (_e: unknown, e: ConfigTesterEvent): void => cb(e)
    ipcRenderer.on(IPC.onConfigTesterEvent, fn)
    return () => ipcRenderer.removeListener(IPC.onConfigTesterEvent, fn)
  },
  onDownloadProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
    const fn = (_e: unknown, p: DownloadProgress): void => cb(p)
    ipcRenderer.on(IPC.onDownloadProgress, fn)
    return () => ipcRenderer.removeListener(IPC.onDownloadProgress, fn)
  },
  onNavigate: (cb: (page: TrayPage) => void): (() => void) => {
    const fn = (_e: unknown, page: TrayPage): void => cb(page)
    ipcRenderer.on(IPC.navigate, fn)
    return () => ipcRenderer.removeListener(IPC.navigate, fn)
  },
  onStatusChanged: (cb: () => void): (() => void) => {
    const fn = (): void => cb()
    ipcRenderer.on(IPC.statusChanged, fn)
    return () => ipcRenderer.removeListener(IPC.statusChanged, fn)
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getAppVersion),
  startTgProxy: (): Promise<boolean> => ipcRenderer.invoke(IPC.tgProxyStart),
  stopTgProxy: (): Promise<boolean> => ipcRenderer.invoke(IPC.tgProxyStop),
  restartTgProxy: (): Promise<boolean> => ipcRenderer.invoke(IPC.tgProxyRestart),
  getTgProxyStatus: (): Promise<{ status: TgProxyStatus; stats: TgProxyStats; settings: TgProxySettings; link: string }> =>
    ipcRenderer.invoke(IPC.tgProxyGetStatus),
  getTgProxyStats: (): Promise<TgProxyStats> => ipcRenderer.invoke(IPC.tgProxyGetStats),
  updateTgProxySettings: (patch: Partial<TgProxySettings>): Promise<TgProxySettings> =>
    ipcRenderer.invoke(IPC.tgProxyUpdateSettings, patch),
  resetTgProxySettings: (): Promise<TgProxySettings> => ipcRenderer.invoke(IPC.tgProxyResetSettings),
  openTgProxyLink: (): Promise<boolean> => ipcRenderer.invoke(IPC.tgProxyOpenLink),
  onTgProxyStatusChanged: (cb: () => void): (() => void) => {
    const fn = (): void => cb()
    ipcRenderer.on(IPC.tgProxyStatusChanged, fn)
    return () => ipcRenderer.removeListener(IPC.tgProxyStatusChanged, fn)
  },
  checkAppUpdates: (): Promise<AppUpdateInfo> => ipcRenderer.invoke(IPC.checkAppUpdates),
  getAppUpdateState: (): Promise<AppUpdateState> => ipcRenderer.invoke(IPC.getAppUpdateState),
  downloadAppUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.downloadAppUpdate),
  installAppUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.installAppUpdate),
  onAppUpdateAvailable: (cb: (version: string) => void): (() => void) => {
    const fn = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on(IPC.onAppUpdateAvailable, fn)
    return () => ipcRenderer.removeListener(IPC.onAppUpdateAvailable, fn)
  },
  onAppUpdateDownloaded: (cb: (version: string) => void): (() => void) => {
    const fn = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on(IPC.onAppUpdateDownloaded, fn)
    return () => ipcRenderer.removeListener(IPC.onAppUpdateDownloaded, fn)
  },
  onAppUpdateDownloading: (cb: (version: string) => void): (() => void) => {
    const fn = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on(IPC.onAppUpdateDownloading, fn)
    return () => ipcRenderer.removeListener(IPC.onAppUpdateDownloading, fn)
  },
  onAppUpdateError: (cb: (message: string) => void): (() => void) => {
    const fn = (_e: unknown, message: string): void => cb(message)
    ipcRenderer.on(IPC.onAppUpdateError, fn)
    return () => ipcRenderer.removeListener(IPC.onAppUpdateError, fn)
  },
  onAppUpdateNotAvailable: (cb: (checkedAt: string) => void): (() => void) => {
    const fn = (_e: unknown, checkedAt: string): void => cb(checkedAt)
    ipcRenderer.on(IPC.onAppUpdateNotAvailable, fn)
    return () => ipcRenderer.removeListener(IPC.onAppUpdateNotAvailable, fn)
  }
}

export type ZapretApi = typeof api

contextBridge.exposeInMainWorld('zapret', api)

declare global {
  interface Window {
    zapret: ZapretApi
  }
}
