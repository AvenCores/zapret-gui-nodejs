/** Unit tests for the built-in Telegram MTProto→WS proxy (pure helpers + lifecycle). */
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import net from 'node:net'
import {
  AesCtr,
  MsgSplitter,
  buildCryptoCtx,
  buildTgLink,
  decodeCfDomain,
  defaultCfProxyDomains,
  generateRelayInit,
  generateTgSecret,
  getTgProxyStats,
  getTgProxyStatus,
  isTgProxyRunning,
  isValidTgSecret,
  normalizeTgPort,
  parseDcIpList,
  readTcpExactly,
  startTgProxy,
  stopTgProxy,
  tryHandshake,
  wsDomains
} from '../src/main/tg-proxy'
import { getTrayLabels, tgProxyActionsState, tgStatusLabel, trayTooltip } from '../src/main/tray'

describe('normalizeTgPort', () => {
  it('accepts valid ports', () => {
    expect(normalizeTgPort(1443)).toBe(1443)
    expect(normalizeTgPort('8080')).toBe(8080)
    expect(normalizeTgPort(1)).toBe(1)
    expect(normalizeTgPort(65535)).toBe(65535)
  })

  it('falls back to 1443 for garbage', () => {
    expect(normalizeTgPort(0)).toBe(1443)
    expect(normalizeTgPort(70000)).toBe(1443)
    expect(normalizeTgPort('abc')).toBe(1443)
    expect(normalizeTgPort(undefined)).toBe(1443)
    expect(normalizeTgPort(-5)).toBe(1443)
  })
})

describe('tg secret helpers', () => {
  it('generates valid 32-hex secrets', () => {
    const s = generateTgSecret()
    expect(s).toMatch(/^[0-9a-f]{32}$/)
    expect(isValidTgSecret(s)).toBe(true)
    expect(isValidTgSecret('  ' + s.toUpperCase() + '  ')).toBe(true)
  })

  it('rejects malformed secrets', () => {
    expect(isValidTgSecret('')).toBe(false)
    expect(isValidTgSecret('zz'.repeat(16))).toBe(false)
    expect(isValidTgSecret('abcd')).toBe(false)
  })

  it('builds tg://proxy links', () => {
    expect(buildTgLink('127.0.0.1', 1443, 'a'.repeat(32))).toBe(
      `tg://proxy?server=127.0.0.1&port=1443&secret=dd${'a'.repeat(32)}`
    )
  })
})

describe('wsDomains', () => {
  it('orders plain relays first for normal DCs', () => {
    expect(wsDomains(2, false)).toEqual(['kws2.web.telegram.org', 'kws2-1.web.telegram.org'])
  })

  it('orders -1 first for media DCs', () => {
    expect(wsDomains(4, true)).toEqual(['kws4-1.web.telegram.org', 'kws4.web.telegram.org'])
  })

  it('maps DC203 onto DC2 relays', () => {
    expect(wsDomains(203, false)).toEqual(['kws2.web.telegram.org', 'kws2-1.web.telegram.org'])
  })
})

describe('parseDcIpList', () => {
  it('parses DC:IP entries', () => {
    expect(parseDcIpList(['2:149.154.167.220', '4:149.154.167.220'])).toEqual({
      2: '149.154.167.220',
      4: '149.154.167.220'
    })
  })

  it('throws on malformed entries', () => {
    expect(() => parseDcIpList(['nope'])).toThrow()
    expect(() => parseDcIpList(['2:not-an-ip'])).toThrow()
  })
})

describe('CF domain pool', () => {
  it('decodes the built-in obfuscated list', () => {
    const domains = defaultCfProxyDomains()
    expect(domains.length).toBe(20)
    for (const d of domains) {
      expect(d.endsWith('.co.uk')).toBe(true)
    }
    expect(new Set(domains).size).toBe(domains.length)
  })

  it('passes plain domains through', () => {
    expect(decodeCfDomain('example.org')).toBe('example.org')
  })
})

describe('AesCtr', () => {
  it('round-trips and keeps keystream position across updates', () => {
    const key = crypto.randomBytes(32)
    const iv = crypto.randomBytes(16)
    const msg = crypto.randomBytes(100)
    const enc = new AesCtr(key, iv)
    const c1 = enc.update(msg.subarray(0, 40))
    const c2 = enc.update(msg.subarray(40))
    const dec = new AesCtr(key, iv)
    expect(Buffer.concat([dec.update(c1), dec.update(c2)])).toEqual(msg)
  })
})

/**
 * Craft a client obfuscated init packet like Telegram Desktop does
 * (obfuscated2): the first 56 bytes stay plaintext-random, the key is
 * sha256(packet[8:40] + secret), and only the 8-byte tail carries the
 * encrypted proto tag + DC index.
 */
function craftClientHandshake(secret: Buffer, dcIdx: number, tag: Buffer): { packet: Buffer; prekeyIv: Buffer } {
  const rnd = crypto.randomBytes(64)
  const prekey = Buffer.from(rnd.subarray(SKIP_OFF, SKIP_OFF + PREKEY_OFF))
  const iv = Buffer.from(rnd.subarray(SKIP_OFF + PREKEY_OFF, SKIP_OFF + PREKEY_OFF + IV_OFF))
  const key = crypto.createHash('sha256').update(Buffer.concat([prekey, secret])).digest()
  const enc = new AesCtr(key, iv)
  const encryptedFull = enc.update(Buffer.from(rnd))
  const tailPlain = Buffer.concat([Buffer.from(tag), Buffer.alloc(2), crypto.randomBytes(2)])
  tailPlain.writeInt16LE(dcIdx, 4)
  const out = Buffer.from(rnd)
  for (let i = 0; i < 8; i++) {
    out[56 + i] = tailPlain[i] ^ (encryptedFull[56 + i] ^ rnd[56 + i])
  }
  return { packet: out, prekeyIv: Buffer.concat([prekey, iv]) }
}

const SKIP_OFF = 8
const PREKEY_OFF = 32
const IV_OFF = 16

describe('tryHandshake', () => {
  it('extracts DC id and media flag', () => {
    const secret = crypto.randomBytes(16)
    const tag = Buffer.from([0xef, 0xef, 0xef, 0xef])
    const { packet, prekeyIv } = craftClientHandshake(secret, -4, tag)
    const parsed = tryHandshake(packet, secret)
    expect(parsed).not.toBeNull()
    expect(parsed?.dcId).toBe(4)
    expect(parsed?.isMedia).toBe(true)
    expect(parsed?.protoTag).toEqual(tag)
    expect(parsed?.prekeyIv).toEqual(prekeyIv)
  })

  it('rejects wrong secrets and unknown tags', () => {
    const secret = crypto.randomBytes(16)
    const { packet } = craftClientHandshake(secret, 2, Buffer.from([0xee, 0xee, 0xee, 0xee]))
    expect(tryHandshake(packet, crypto.randomBytes(16))).toBeNull()
    expect(tryHandshake(Buffer.alloc(64, 1), secret)).toBeNull()
    expect(tryHandshake(Buffer.alloc(10), secret)).toBeNull()
  })
})

describe('generateRelayInit + buildCryptoCtx', () => {
  it('produces a verifiable upstream init and crypto context', () => {
    const tag = Buffer.from([0xdd, 0xdd, 0xdd, 0xdd])
    const relay = generateRelayInit(tag, 2)
    expect(relay.length).toBe(64)
    // Decrypt with the raw relay key (no keystream fast-forward: the init
    // itself is encrypted from position 0). Tail must carry proto + DC.
    const dec = new AesCtr(relay.subarray(8, 40), relay.subarray(40, 56))
    const plain = dec.update(Buffer.from(relay))
    expect(plain.subarray(56, 60)).toEqual(tag)
    expect(plain.readInt16LE(60)).toBe(2)
    // Context derives without throwing.
    const secret = crypto.randomBytes(16)
    const { prekeyIv } = craftClientHandshake(secret, 2, Buffer.from([0xef, 0xef, 0xef, 0xef]))
    expect(() => buildCryptoCtx(prekeyIv, secret, relay)).not.toThrow()
  })
})

describe('MsgSplitter', () => {
  function relayCipher(relay: Buffer): AesCtr {
    const c = new AesCtr(relay.subarray(8, 40), relay.subarray(40, 56))
    c.update(Buffer.alloc(64, 0))
    return c
  }

  it('splits abridged packets, even across chunk boundaries', () => {
    const relay = generateRelayInit(Buffer.from([0xef, 0xef, 0xef, 0xef]), 2)
    const cipher = relayCipher(relay)
    // Abridged packet: length byte 0x02 → 8 payload bytes.
    const plain = Buffer.concat([Buffer.from([0x02]), crypto.randomBytes(8)])
    const wire = cipher.update(plain)
    expect(wire.length).toBe(9)
    const s1 = new MsgSplitter(relay, 0xefefefef)
    expect(s1.split(wire)).toEqual([wire])
    // Same packet delivered in two TCP chunks.
    const s2 = new MsgSplitter(relay, 0xefefefef)
    expect(s2.split(wire.subarray(0, 5))).toEqual([])
    expect(s2.split(wire.subarray(5))).toEqual([wire])
  })

  it('splits intermediate packets with a 4-byte length prefix', () => {
    const relay = generateRelayInit(Buffer.from([0xee, 0xee, 0xee, 0xee]), 2)
    const cipher = relayCipher(relay)
    const plain = Buffer.concat([Buffer.from([0x08, 0x00, 0x00, 0x00]), crypto.randomBytes(8)])
    const wire = cipher.update(plain)
    const s = new MsgSplitter(relay, 0xeeeeeeee)
    expect(s.split(wire)).toEqual([wire])
  })

  it('flushes incomplete tails', () => {
    const relay = generateRelayInit(Buffer.from([0xef, 0xef, 0xef, 0xef]), 2)
    const s = new MsgSplitter(relay, 0xefefefef)
    const tail = Buffer.from([1, 2, 3])
    // 0x01 claims a 4-byte payload but only 3 bytes arrive → buffered.
    expect(s.split(tail)).toEqual([])
    expect(s.flush()).toEqual([tail])
  })
})

describe('readTcpExactly pipelining (dial-gap regression)', () => {
  it('keeps client bytes that arrive while upstream is being dialed', async () => {
    // Telegram Desktop pipelines its first request right after the 64-byte
    // init. The server reads the init, then spends ~300ms dialing upstream
    // with no `data` listener attached. A socket left flowing there DROPS
    // arriving bytes in Node.js → both sides idle forever (^0.0B v0.0B).
    // readTcpExactly must leave the socket paused so nothing is lost.
    const srv = net.createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as net.AddressInfo).port
    const serverSide = new Promise<Buffer>((resolve, reject) => {
      srv.once('connection', (sock) => {
        readTcpExactly(sock, 64, 5000).then((init) => {
          expect(init.length).toBe(64)
          // Simulate the WS-dial gap: no `data` listener for 300ms.
          setTimeout(() => {
            sock.resume()
            const chunks: Buffer[] = []
            sock.on('data', (d: Buffer) => chunks.push(d))
            setTimeout(() => {
              sock.destroy()
              srv.close()
              resolve(Buffer.concat(chunks))
            }, 500)
          }, 300)
        }).catch(reject)
      })
    })
    const payload = crypto.randomBytes(200)
    const c = net.connect({ host: '127.0.0.1', port })
    await new Promise<void>((r) => c.once('connect', r))
    c.write(crypto.randomBytes(64))
    // Lands mid-gap (after the init read resolved, before resume).
    await new Promise((r) => setTimeout(r, 100))
    c.write(payload)
    const got = await serverSide
    c.destroy()
    expect(got).toEqual(payload)
  }, 15000)
})

describe('tg-proxy lifecycle (localhost, no upstream)', () => {  it('starts on an ephemeral port, counts bad handshakes, stops cleanly', async () => {
    const secret = generateTgSecret()
    expect(isTgProxyRunning()).toBe(false)
    const bound = await startTgProxy({ port: 0, secret, cfProxyEnabled: false })
    expect(isTgProxyRunning()).toBe(true)
    expect(bound.port).toBeGreaterThan(0)
    expect(getTgProxyStatus().status).toBe('running')

    const badBefore = getTgProxyStats().connectionsBad
    await new Promise<void>((resolve, reject) => {
      const s = net.connect({ host: '127.0.0.1', port: bound.port }, () => {
        s.write(Buffer.alloc(64, 7))
      })
      s.on('error', reject)
      setTimeout(() => {
        s.destroy()
        resolve()
      }, 800)
    })
    // Give the handler a moment to process the bad init packet.
    await new Promise((r) => setTimeout(r, 800))
    expect(getTgProxyStats().connectionsBad).toBeGreaterThanOrEqual(badBefore + 1)

    await stopTgProxy()
    expect(isTgProxyRunning()).toBe(false)
    expect(getTgProxyStatus().status).toBe('stopped')
    await stopTgProxy()
  }, 20000)

  it('rejects invalid secrets and busy ports', async () => {
    await expect(startTgProxy({ port: 1443, secret: 'short' })).rejects.toThrow()
    const secret = generateTgSecret()
    const first = await startTgProxy({ port: 0, secret, cfProxyEnabled: false })
    // Same host+port → idempotent.
    await expect(startTgProxy({ port: first.port, secret, cfProxyEnabled: false })).resolves.toEqual({
      host: '127.0.0.1',
      port: first.port
    })
    await stopTgProxy()
  }, 20000)
})

describe('tray tg-proxy helpers', () => {
  it('enables Start only when stopped', () => {
    expect(tgProxyActionsState('stopped')).toEqual({ start: true, stop: false, restart: false })
    expect(tgProxyActionsState('running')).toEqual({ start: false, stop: true, restart: true })
    expect(tgProxyActionsState('error')).toEqual({ start: false, stop: true, restart: true })
  })

  it('translates tg status words', () => {
    const ru = getTrayLabels('ru', 'running')
    expect(tgStatusLabel(ru, 'running')).toBe('Запущен')
    expect(tgStatusLabel(ru, 'error')).toBe('Ошибка')
    const en = getTrayLabels('en', 'running')
    expect(en.tgProxy).toBe('TG proxy')
  })

  it('appends TG state to the tooltip', () => {
    expect(trayTooltip('Running', null)).toBe('Zapret GUI — Running')
    expect(trayTooltip('Running', 'general')).toBe('Zapret GUI — Running · general')
    expect(trayTooltip('Running', 'general', 'Running')).toBe('Zapret GUI — Running · general | TG: Running')
    expect(trayTooltip('Running', null, 'Stopped')).toBe('Zapret GUI — Running | TG: Stopped')
  })
})
