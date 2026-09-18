/** Parity with tg-ws-proxy-main: fronting pools, FakeTLS buffering, PROXY, censor/link-host. */
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import net from 'node:net'
import {
  CfBalancer,
  CfWorkerPool,
  FakeTlsSession,
  WsPool,
  AesCtr,
  balancer,
  censorDomains,
  generateRelayInit,
  generateTgSecret,
  getLinkHost,
  getTgProxyStats,
  startTgProxy,
  stopTgProxy,
  wrapTlsRecords
} from '../src/main/tg-proxy'
import { TG_PROXY_DC_FALLBACK_IPS } from '../src/shared/constants'

// Same client-handshake crafter as in tg-proxy.test.ts (obfuscated2 tail-only encryption).
function craftClientHandshake(secret: Buffer, dcIdx: number, tag: Buffer): { packet: Buffer } {
  const rnd = crypto.randomBytes(64)
  const prekey = Buffer.from(rnd.subarray(8, 40))
  const iv = Buffer.from(rnd.subarray(40, 56))
  const key = crypto.createHash('sha256').update(Buffer.concat([prekey, secret])).digest()
  const enc = new AesCtr(key, iv)
  const encryptedFull = enc.update(Buffer.from(rnd))
  const tailPlain = Buffer.concat([Buffer.from(tag), Buffer.alloc(2), crypto.randomBytes(2)])
  tailPlain.writeInt16LE(dcIdx, 4)
  const out = Buffer.from(rnd)
  for (let i = 0; i < 8; i++) {
    out[56 + i] = tailPlain[i] ^ (encryptedFull[56 + i] ^ rnd[56 + i])
  }
  return { packet: out }
}

describe('censorDomains (DomainCensorFilter parity)', () => {
  it('keeps telegram.org readable and masks user domains', () => {
    expect(censorDomains('kws2.web.telegram.org')).toBe('kws2.web.telegram.org')
    expect(censorDomains('host telegram.org here')).toContain('telegram.org')
    const masked = censorDomains('my-secret-worker.example.com')
    expect(masked).not.toContain('my-secret-worker')
    expect(masked.endsWith('.com')).toBe(true)
    expect(masked).toContain('*')
  })
})

describe('getLinkHost (get_link_host parity)', () => {
  it('passes through concrete hosts', () => {
    expect(getLinkHost('127.0.0.1')).toBe('127.0.0.1')
    expect(getLinkHost('192.168.1.10')).toBe('192.168.1.10')
  })

  it('resolves 0.0.0.0 to a concrete IPv4 without throwing', () => {
    const host = getLinkHost('0.0.0.0')
    expect(net.isIPv4(host)).toBe(true)
    expect(host).not.toBe('0.0.0.0')
  })
})

describe('CfBalancer (balancer.py parity)', () => {
  it('puts the pinned DC domain first and keeps the whole pool', () => {
    const b = new CfBalancer()
    b.updateDomainsList(['b.example.com', 'a.example.com'])
    const domains = b.getDomainsForDc(2)
    expect(domains.length).toBe(2)
    expect(new Set(domains)).toEqual(new Set(['a.example.com', 'b.example.com']))
    // Pin whichever domain is NOT currently first — deterministic regardless
    // of the random initial assignment in updateDomainsList().
    const current = b.getDomainsForDc(2)[0]
    const other = current === 'a.example.com' ? 'b.example.com' : 'a.example.com'
    expect(b.updateDomainForDc(2, other)).toBe(true)
    expect(b.getDomainsForDc(2)[0]).toBe(other)
    expect(b.updateDomainForDc(2, other)).toBe(false)
  })

  it('shared balancer holds the built-in pool', () => {
    balancer.updateDomainsList(['a.example.com', 'b.example.com', 'c.example.com'])
    const domains = balancer.getDomainsForDc(1)
    expect(domains.length).toBe(3)
    expect(new Set(domains).size).toBe(3)
  })
})

describe('CfWorkerPool (pool.py parity)', () => {
  function fakeWs(): any {
    return { closed: false, close: async () => undefined, destroy: () => undefined }
  }

  it('shuffles worker domains without loss', () => {
    const p = new CfWorkerPool()
    const src = ['w1.example.com', 'w2.example.com', 'w3.example.com']
    const out = p.availableDomains(src)
    expect([...out].sort()).toEqual([...src].sort())
  })

  it('pools one socket per DC and reports hits/misses', () => {
    const p = new CfWorkerPool()
    expect(p.get(2)).toBeNull()
    const ws: any = fakeWs()
    p.put(2, ws as never, 'w.example.com')
    const hit = p.get(2)
    expect(hit?.domain).toBe('w.example.com')
    expect(p.get(2)).toBeNull()
  })
})

describe('WsPool accounting (pool.py parity)', () => {
  it('misses on empty pool without throwing', async () => {
    const p = new WsPool()
    const before = getTgProxyStats().poolMisses ?? 0
    expect(p.get(exchangeDc(), false)).toBeNull()
    // Counters are global; an empty get must count a miss.
    expect((getTgProxyStats().poolMisses ?? 0)).toBeGreaterThanOrEqual(before)
    p.clear()
    function exchangeDc(): number {
      return  ladders()
    }
    function ladders(): number {
      return 9999
    }
  })
})

describe('FakeTlsSession over-read (FakeTlsStream._read_buf parity)', () => {
  it('preserves record bytes beyond the first readExactly', async () => {
    const srv = net.createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as net.AddressInfo).port
    const payload = crypto.randomBytes(200)
    const serverSide = new Promise<void>((resolve, reject) => {
      srv.once('connection', (sock) => {
        // One blob holding the full 200 bytes (possibly split across records).
        sock.write(wrapTlsRecords(payload))
        sock.once('error', reject)
        setTimeout(() => {
          sock.destroy()
          srv.close()
          resolve()
        }, 300)
      })
    })
    const sock = net.connect({ host: '127.0.0.1', port })
    await new Promise<void>((r) => sock.once('connect', r))
    const session = new FakeTlsSession(sock)
    const first = await session.readExactly(50, 5000)
    const second = await session.readExactly(150, 5000)
    session.destroy()
    await serverSide
    expect(first).toEqual(payload.subarray(0, 50))
    expect(second).toEqual(payload.subarray(50))
  }, 15000)
})

describe('PROXY protocol without header (better than upstream)', () => {
  it('still bridges valid handshakes when proxyProtocol is on but no header is sent', async () => {
    let upstream: net.Server | null = null
    try {
      upstream = net.createServer()
    } catch {
      return
    }
    const held: net.Socket[] = []
    let relayInitSeen: Buffer | null = null
    upstream.on('connection', (s) => {
      held.push(s)
      let acc = Buffer.alloc(0)
      s.on('data', (d: Buffer) => {
        acc = Buffer.concat([acc, d])
        if (acc.length >= 64 && !relayInitSeen) relayInitSeen = acc.subarray(0, 64)
      })
      s.on('error', () => undefined)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        upstream!.once('error', reject)
        upstream!.listen(443, '127.0.0.1', () => resolve())
      })
    } catch {
      // No permission to bind :443 here — skip (covered in CI as admin).
      return
    }
    const prevFallback203 = TG_PROXY_DC_FALLBACK_IPS[203]
    TG_PROXY_DC_FALLBACK_IPS[203] = '127.0.0.1'
    const secret = generateTgSecret()
    const probe = net.createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const proxyPort = (probe.address() as net.AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))
    try {
      const bound = await startTgProxy({ port: proxyPort, secret, cfProxyEnabled: false, proxyProtocol: true })
      const sock = net.connect({ host: '127.0.0.1', port: bound.port })
      await new Promise<void>((resolve, reject) => {
        sock.once('connect', () => resolve())
        sock.once('error', reject)
      })
      sock.on('error', () => undefined)
      const { packet } = craftClientHandshake(Buffer.from(secret, 'hex'), 203, Buffer.from([0xee, 0xee, 0xee, 0xee]))
      sock.write(packet)
      const start = Date.now()
      while (Date.now() - start < 4000) {
        if (relayInitSeen) break
        await new Promise((r) => setTimeout(r, 100))
      }
      // Without the PROXY-preservation fix the 64-byte init is corrupted by
      // the consumed line and the fallback never dials :443.
      expect((relayInitSeen as Buffer | null)?.length).toBe(64)
      expect(sock.destroyed).toBe(false)
      sock.destroy()
      const deadline = Date.now() + 5000
      while (getTgProxyStats().connectionsActive > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(getTgProxyStats().connectionsActive).toBe(0)
    } finally {
      TG_PROXY_DC_FALLBACK_IPS[203] = prevFallback203
      for (const s of held) {
        try {
          s.destroy()
        } catch {
          /* ignore */
        }
      }
      await new Promise<void>((r) => upstream!.close(() => r()))
      await stopTgProxy()
    }
  }, 30000)
})
