/**
 * User-editable `*-user.txt` lists in the writable data `lists/` dir.
 *
 * After install `%APPDATA%/zapret-gui/data/lists` contains:
 * - `list-general-user.txt`  (extra domains to bypass, `--hostlist`)
 * - `list-exclude-user.txt`  (domains to skip, `--hostlist-exclude`)
 * - `ipset-exclude-user.txt` (IPs/CIDRs to skip, `--ipset-exclude`)
 *
 * The editor works with any `*-user.txt` file so future lists are
 * picked up automatically. Pure filesystem helpers — covered by unit tests.
 * @module main/user-lists
 */
import fs from 'node:fs'
import path from 'node:path'
import type { UserListMeta } from '../shared/types'

/** Files seeded on first run (see `paths.ensureDataDirSeeded`). */
export const KNOWN_USER_LISTS = [
  'list-general-user.txt',
  'list-exclude-user.txt',
  'ipset-exclude-user.txt'
] as const

/** Hard cap for a single user list (protects against accidental pastes). */
export const MAX_USER_LIST_BYTES = 2 * 1024 * 1024

/**
 * A file is user-editable when it is a plain `*-user.txt` name without
 * directories or traversal segments.
 * Pure — covered by unit tests.
 */
export function isValidUserListName(name: string): boolean {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 64) return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]*-user\.txt$/.test(name)
}

/** `ipset-*` files hold IPs/CIDRs, everything else holds domains. */
export function kindOfUserList(name: string): UserListMeta['kind'] {
  return name.toLowerCase().startsWith('ipset-') ? 'ipset' : 'domains'
}

/**
 * Count meaningful entries: non-empty lines that are not `#` comments.
 * Pure — covered by unit tests.
 */
export function countUserListEntries(content: string): number {
  let n = 0
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (t === '' || t.startsWith('#') || t.startsWith(';')) continue
    n++
  }
  return n
}

/** Normalize content: LF endings, no trailing spaces, single trailing newline. */
export function normalizeUserListContent(content: string): string {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n')
  const trimmed = lines.map((l) => l.replace(/[ \t]+$/g, ''))
  // Drop trailing empty lines, then keep exactly one trailing newline (if any content).
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
  if (trimmed.length === 0) return ''
  return trimmed.join('\n') + '\n'
}

/** Metadata for one file (missing file → `exists: false`, zero counters). */
function statOne(listsDir: string, name: string): UserListMeta {
  const p = path.join(listsDir, name)
  try {
    if (!fs.existsSync(p)) return { name, kind: kindOfUserList(name), lines: 0, bytes: 0, exists: false }
    const buf = fs.readFileSync(p)
    const text = buf.toString('utf8')
    return {
      name,
      kind: kindOfUserList(name),
      lines: countUserListEntries(text),
      bytes: buf.length,
      exists: true
    }
  } catch {
    return { name, kind: kindOfUserList(name), lines: 0, bytes: 0, exists: false }
  }
}

/** List all `*-user.txt` files (known stubs first, then any extra found on disk). */
export function listUserLists(listsDir: string): UserListMeta[] {
  fs.mkdirSync(listsDir, { recursive: true })
  let found: string[] = []
  try {
    found = fs
      .readdirSync(listsDir)
      .filter((f) => isValidUserListName(f))
  } catch {
    found = []
  }
  const names = [...KNOWN_USER_LISTS.filter((n) => !found.includes(n)), ...found]
  // Known stubs come first in seed order, discovered extras alphabetically.
  const knownFirst = names.sort((a, b) => {
    const ai = (KNOWN_USER_LISTS as readonly string[]).indexOf(a)
    const bi = (KNOWN_USER_LISTS as readonly string[]).indexOf(b)
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.localeCompare(b)
  })
  return knownFirst.map((n) => statOne(listsDir, n))
}

/** Read a user list (missing file → empty string). Throws on invalid name. */
export function readUserList(listsDir: string, name: string): string {
  if (!isValidUserListName(name)) throw new Error(`Invalid user list name: ${name}`)
  const p = path.join(listsDir, name)
  try {
    if (!fs.existsSync(p)) return ''
    return fs.readFileSync(p, 'utf8')
  } catch (e) {
    throw new Error(`Cannot read ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Overwrite a user list (creates parent dir). Returns fresh metadata. */
export function writeUserList(listsDir: string, name: string, content: string): UserListMeta {
  if (!isValidUserListName(name)) throw new Error(`Invalid user list name: ${name}`)
  const raw = String(content ?? '')
  // Pre-check before normalize(): normalization fans one string out into a
  // line array plus a joined copy (~3x memory), so reject absurd payloads
  // before allocating. The post-normalize check below stays authoritative.
  if (Buffer.byteLength(raw, 'utf8') > MAX_USER_LIST_BYTES * 4) {
    throw new Error(`List too large (max ${MAX_USER_LIST_BYTES} bytes)`)
  }
  const normalized = normalizeUserListContent(raw)
  const bytes = Buffer.byteLength(normalized, 'utf8')
  if (bytes > MAX_USER_LIST_BYTES) {
    throw new Error(`List too large (${bytes} bytes, max ${MAX_USER_LIST_BYTES})`)
  }
  fs.mkdirSync(listsDir, { recursive: true })
  // Atomic write: readers never see a half-written list.
  const dest = path.join(listsDir, name)
  const tmp = `${dest}.tmp-${process.pid}-${Date.now().toString(36)}`
  fs.writeFileSync(tmp, normalized, 'utf8')
  try {
    fs.renameSync(tmp, dest)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw e
  }
  return {
    name,
    kind: kindOfUserList(name),
    lines: countUserListEntries(normalized),
    bytes,
    exists: true
  }
}
