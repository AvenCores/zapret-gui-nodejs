/**
 * Platform abstraction: Windows vs Linux runtime detection.
 * The GUI ships Windows-first (`winws.exe` + WinDivert + `sc.exe`);
 * Linux support (`nfqws` + nftables/iptables + systemd/OpenRC/runit/s6/dinit)
 * mirrors `zapret-discord-youtube-linux-master/service.sh`.
 * @module main/linux/platform
 */

export type AppPlatform = 'win32' | 'linux' | 'darwin' | string

/** Current Node platform (`process.platform`). */
export function currentPlatform(): AppPlatform {
  try {
    return process.platform
  } catch {
    return 'win32'
  }
}

/** True when running on Linux (any distro/arch). Pure. */
export function isLinuxPlatform(platform: string = currentPlatform()): boolean {
  return platform === 'linux'
}

/** True when running on Windows. Pure. */
export function isWindowsPlatform(platform: string = currentPlatform()): boolean {
  return platform === 'win32'
}

/** DPI engine binary name for the current OS. Pure. */
export function dpiEngineBinary(platform: string = currentPlatform()): 'winws.exe' | 'nfqws' {
  return isLinuxPlatform(platform) ? 'nfqws' : 'winws.exe'
}

/** Whether the platform supports Linux-style firewall backends. Pure. */
export function supportsLinuxFirewall(platform: string = currentPlatform()): boolean {
  return isLinuxPlatform(platform)
}
