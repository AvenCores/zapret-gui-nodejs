/**
 * Shared main-window messaging: first app window + best-effort IPC send.
 * Single implementation used by `ipc-handlers` and `app-updater`
 * (previously duplicated in both files).
 * @module main/window
 */
import { BrowserWindow } from 'electron'

/** First app window (null when closed / not created yet). */
export function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

/** Best-effort send to the renderer (no-throw when the window is gone). */
export function safeSend(channel: string, ...args: unknown[]): void {
  try {
    const w = win()
    if (!w || w.webContents.isDestroyed()) return
    w.webContents.send(channel, ...args)
  } catch {
    /* renderer gone — best effort */
  }
}
