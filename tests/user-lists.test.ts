/** Unit tests for user-editable *-user.txt lists. */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isValidUserListName,
  kindOfUserList,
  countUserListEntries,
  normalizeUserListContent,
  listUserLists,
  readUserList,
  writeUserList
} from '../src/main/user-lists'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-lists-'))
})

describe('isValidUserListName', () => {
  it('accepts known stubs', () => {
    expect(isValidUserListName('list-exclude-user.txt')).toBe(true)
    expect(isValidUserListName('ipset-exclude-user.txt')).toBe(true)
    expect(isValidUserListName('list-general-user.txt')).toBe(true)
  })

  it('rejects traversal and non-user files', () => {
    expect(isValidUserListName('../evil.txt')).toBe(false)
    expect(isValidUserListName('a/b-user.txt')).toBe(false)
    expect(isValidUserListName('list-general.txt')).toBe(false)
    expect(isValidUserListName('')).toBe(false)
    expect(isValidUserListName('..\\x-user.txt')).toBe(false)
  })
})

describe('kindOfUserList / countUserListEntries / normalize', () => {
  it('detects ipset kind', () => {
    expect(kindOfUserList('ipset-exclude-user.txt')).toBe('ipset')
    expect(kindOfUserList('list-exclude-user.txt')).toBe('domains')
  })

  it('counts only real entries', () => {
    expect(countUserListEntries('# comment\ndomain.example.abc\n\n  \n; skip\n1.2.3.0/24\n')).toBe(2)
  })

  it('normalizes CRLF and trailing newline', () => {
    expect(normalizeUserListContent('a.com  \r\nb.com')).toBe('a.com\nb.com\n')
    expect(normalizeUserListContent('')).toBe('')
  })
})

describe('list/read/write round-trip', () => {
  it('lists known stubs even when missing', () => {
    const list = listUserLists(dir)
    const names = list.map((m) => m.name)
    expect(names).toContain('list-exclude-user.txt')
    expect(names).toContain('ipset-exclude-user.txt')
    expect(names).toContain('list-general-user.txt')
    expect(list.find((m) => m.name === 'list-exclude-user.txt')?.exists).toBe(false)
  })

  it('writes and reads back', () => {
    const meta = writeUserList(dir, 'list-exclude-user.txt', 'example.com\nfoo.bar\n')
    expect(meta.lines).toBe(2)
    expect(meta.exists).toBe(true)
    expect(readUserList(dir, 'list-exclude-user.txt')).toBe('example.com\nfoo.bar\n')
    const list = listUserLists(dir)
    expect(list.find((m) => m.name === 'list-exclude-user.txt')?.lines).toBe(2)
  })

  it('missing file reads as empty string', () => {
    expect(readUserList(dir, 'list-exclude-user.txt')).toBe('')
  })

  it('rejects invalid names on read/write', () => {
    expect(() => readUserList(dir, '../x.txt')).toThrow()
    expect(() => writeUserList(dir, 'list-general.txt', 'x')).toThrow()
  })
})
