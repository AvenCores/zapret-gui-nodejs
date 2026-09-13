/** Vitest setup: mock the `electron` module for main-process unit tests. */
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '1.0.0-test',
    getPath: (name: string) => {
      if (name === 'appData') return process.cwd()
      if (name === 'userData') return process.cwd()
      return process.cwd()
    }
  }
}))
