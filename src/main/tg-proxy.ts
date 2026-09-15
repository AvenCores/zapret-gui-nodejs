/**
 * Built-in Telegram MTProto → WebSocket bridge proxy.
 *
 * TypeScript port of Flowseal/tg-ws-proxy (MIT) running in-process:
 * listens on `127.0.0.1:1443`, intercepts the 64-byte MTProto obfuscation
 * init packet, extracts the DC id and bridges the session over a TLS
 * WebSocket to the Telegram DC (`kws{dc}.web.telegram.org/apiws`),
 * with Cloudflare-proxy / direct-TCP fallback.
 *
 * Zero external dependencies — only `node:net`, `node:tls` and
 * `node:crypto` (mirrors upstream `RawWebSocket`, which is also a
 * hand-rolled TLS+WS client).
 *
 * FakeTLS (`ee`-secrets), PROXY-protocol and CF-Worker fallbacks from the
 * Python version are intentionally out of scope for v1: the GUI only
 * provisions plain `dd`-secrets.
 *
 * @module main/tg-proxy
 */
import crypto from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'
import { info, warn, err } from './logger'
import {
  TG_PROXY_DC_FALLBACK_IPS,
  TG_PROXY_DC_IPS,
  TG_PROXY_DC_TEST_IPS,
  TG_PROXY_DEFAULT_HOST,
  TG_PROXY_DEFAULT_PORT,
  TG_PROXY_WS_PATH,
  TG_PROXY_WS_PATH_TEST
} from '../shared/constants'
import type { TgProxyStats, TgProxyStatus } from '../shared/types'

// ---------------------------------------------------------------------------
// MTProto obfuscation constants (mirrors proxy/utils.py)
// ---------------------------------------------------------------------------

const HANDSHAKE_LEN = 64
const SKIP_LEN = 8
const PREKEY_LEN = 32
const IV_LEN = 16
const PROTO_TAG_POS = 56
const DC_IDX_POS = 60

const PROTO_TAG_ABRIDGED = Buffer.from([0xef, 0xef, 0xef, 0xef])
const PROTO_TAG_INTERMEDIATE = Buffer.from([0xee, 0xee, 0xee, 0xee])
const PROTO_TAG_SECURE = Buffer.from([0xdd, 0xdd, 0xdd, 0xdd])

const PROTO_ABRIDGED_INT = 0xefefefef
const PROTO_INTERMEDIATE_INT = 0xeeeeeeee
const PROTO_PADDED_INTERMEDIATE_INT = 0xdddddddd

const RESERVED_FIRST_BYTE = 0xef
const RESERVED_STARTS = new Set(['48454144', '504f5354', '47455420', 'eeeeeeee', 'dddddddd', '16030102'])
const RESERVED_CONTINUE = Buffer.from([0x00, 0x00, 0x00, 0x00])

const ZERO_64 = Buffer.alloc(64, 0)

const WS_FAIL_TIMEOUT_MS = 2000
const WS_CONNECT_TIMEOUT_MS = 5000
const CF_CONNECT_TIMEOUT_MS = 10000
const TCP_FALLBACK_TIMEOUT_MS = 10000
const CLIENT_INIT_TIMEOUT_MS = 10000
const IP_FAIL_COOLDOWN_MS = 3600 * 1000
const DC_FAIL_COOLDOWN_MS = 60 * 1000
const WS_POOL_MAX_AGE_MS = 120 * 1000
const WS_POOL_SIZE = 4
const WS_MAX_MESSAGE = 16 * 1024 * 1024

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Coerce an unknown value to a valid listen port (fallback 1443). Pure. */
export function normalizeTgPort(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : TG_PROXY_DEFAULT_PORT
}

/** Generate a fresh 32-hex MTProto proxy secret. Pure (random). */
export function generateTgSecret(): string {
  return crypto.randomBytes(16).toString('hex')
}

/** Validate a `tg://proxy` secret (32 hex chars). Pure. */
export function isValidTgSecret(secret: string): boolean {
  return /^[0-9a-f]{32}$/.test(secret.trim().toLowerCase())
}

/**
 * Validate a DNS hostname for proxy settings (letters/digits/hyphens/dots).
 * Pure.
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253 || domain.startsWith('.') || domain.endsWith('.')) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  for (const label of labels) {
    if (!label || label.length > 63 || label.startsWith('-') || label.endsWith('-')) return false
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false
  }
  const tld = labels[labels.length - 1]
  return tld.length >= 2 && /[A-Za-z]/.test(tld)
}

/** Coerce a listen-address value (`--host`). Pure. */
export function normalizeTgHost(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length === 0 || s.length > 253 || /[\s\x00-\x1f\x7f]/.test(s)) return fallback
  return s
}

/** Split free-form domain input (spaces/commas/semicolons/newlines). Pure. */
export function parseDomainList(value: unknown): string[] {
  const parts: string[] = []
  const push = (s: string): void => {
    for (const item of s.replace(/[,;\n\r\t]+/g, ' ').split(' ')) {
      const t = item.trim()
      if (t !== '') parts.push(t)
    }
  }
  if (typeof value === 'string') push(value)
  else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') push(entry)
    }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of parts) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Keep only valid, deduplicated `DC:IP` entries (last wins per DC). Pure. */
export function normalizeDcIpEntries(value: unknown): string[] {
  const merged: Record<number, string> = {}
  const order: number[] = []
  for (const entry of parseDomainList(value)) {
    try {
      const parsed = parseDcIpList([entry])
      for (const [dcStr, ip] of Object.entries(parsed)) {
        const dc = Number(dcStr)
        if (!order.includes(dc)) order.push(dc)
        merged[dc] = ip
      }
    } catch {
      /* drop malformed entries */
    }
  }
  return order.map((dc) => `${dc}:${merged[dc]}`)
}

/** Keep only valid domains from free-form input. Pure. */
export function normalizeDomainEntries(value: unknown): string[] {
  return parseDomainList(value).filter(isValidDomain)
}

/** Optional domain setting: '' or a valid domain (lowercased). Pure. */
export function normalizeOptionalDomain(value: unknown): string {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return s !== '' && isValidDomain(s) ? s : ''
}

/** `tg://proxy` connect link for the tray/dashboard. Pure. */
export function buildTgLink(host: string, port: number, secret: string, fakeTlsDomain = ''): string {
  const domain = fakeTlsDomain.trim().toLowerCase()
  if (domain !== '') {
    // FakeTLS (`ee`) secret: base secret + hex-encoded masking domain.
    return `tg://proxy?server=${host}&port=${port}&secret=ee${secret}${Buffer.from(domain, 'ascii').toString('hex')}`
  }
  return `tg://proxy?server=${host}&port=${port}&secret=dd${secret}`
}

/**
 * Parse a PROXY protocol v1 header line (`PROXY TCP4 1.2.3.4 5.6.7.8 123 456`).
 * Returns a `ip:port` label for logs, or null when the line is not a valid
 * header (caller then treats the bytes as a regular handshake). Pure.
 */
export function parseProxyV1Line(line: string): string | null {
  const text = line.trim()
  if (!text.startsWith('PROXY ')) return null
  const parts = text.split(/\s+/)
  if (parts.length < 6) return null
  const proto = parts[1].toUpperCase()
  if (proto !== 'TCP4' && proto !== 'TCP6') return null
  const srcIp = parts[2]
  const srcPort = Number.parseInt(parts[4], 10)
  if (srcIp.length === 0 || srcIp.length > 64 || !Number.isFinite(srcPort)) return null
  return `${srcIp}:${srcPort}`
}

/** CF-Worker upstream path (`/apiws?dst=<ip>&dc=<n>`). Pure. */
export function buildCfWorkerPath(dst: string, dc: number): string {
  return `/apiws?${new URLSearchParams({ dst, dc: String(dc) }).toString()}`
}

/** Fisher–Yates shuffle (copy) for worker-domain rotation. Pure. */
export function shuffled<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * WebSocket relay domains for a DC, media connections prefer the `-1`
 * host first (mirrors `ws_domains()`). Pure.
 */
export function wsDomains(dc: number, isMedia: boolean): string[] {
  const d = dc === 203 ? 2 : dc
  return isMedia
    ? [`kws${d}-1.web.telegram.org`, `kws${d}.web.telegram.org`]
    : [`kws${d}.web.telegram.org`, `kws${d}-1.web.telegram.org`]
}

/**
 * Parse `--dc-ip`-style `DC:IP` entries into a redirect table.
 * @throws on the first malformed entry. Pure.
 */
export function parseDcIpList(entries: string[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (const entry of entries) {
    const sep = entry.indexOf(':')
    if (sep < 0) throw new Error(`Invalid DC:IP format ${JSON.stringify(entry)}, expected DC:IP`)
    const dc = Number.parseInt(entry.slice(0, sep), 10)
    const ip = entry.slice(sep + 1)
    if (!Number.isInteger(dc) || !net.isIPv4(ip)) {
      throw new Error(`Invalid DC:IP ${JSON.stringify(entry)}`)
    }
    out[dc] = ip
  }
  return out
}

/** Human-readable byte counter (`1.5MB`). Pure. */
export function humanBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let v = n
  for (const u of units) {
    if (Math.abs(v) < 1024 || u === 'TB') return `${v.toFixed(1)}${u}`
    v /= 1024
  }
  return `${v.toFixed(1)}TB`
}

// ---------------------------------------------------------------------------
// AES-CTR (mirrors proxy/_aes.py — Node has it built in)
// ---------------------------------------------------------------------------

/** Stateful AES-256-CTR keystream (CTR encrypt == decrypt). */
export class AesCtr {
  private cipher: crypto.Cipher

  constructor(key: Buffer, iv: Buffer) {
    if (key.length !== 32) throw new Error(`AES-CTR key must be 32 bytes, got ${key.length}`)
    if (iv.length !== 16) throw new Error(`AES-CTR IV must be 16 bytes, got ${iv.length}`)
    this.cipher = crypto.createCipheriv('aes-256-ctr', key, iv)
  }

  update(data: Buffer): Buffer {
    if (data.length === 0) return Buffer.alloc(0)
    return this.cipher.update(data)
  }
}

// ---------------------------------------------------------------------------
// MTProto handshake (mirrors _try_handshake / _generate_relay_init)
// ---------------------------------------------------------------------------

export interface MtHandshake {
  dcId: number
  isMedia: boolean
  protoTag: Buffer
  /** handshake[8:56] — feeds the client crypto context. */
  prekeyIv: Buffer
}

/**
 * Decrypt a 64-byte obfuscated init packet and extract DC/proto.
 * Returns null on wrong secret or unknown protocol tag. Pure.
 */
export function tryHandshake(handshake: Buffer, secret: Buffer): MtHandshake | null {
  if (handshake.length !== HANDSHAKE_LEN || secret.length !== 16) return null
  const prekeyIv = Buffer.from(handshake.subarray(SKIP_LEN, SKIP_LEN + PREKEY_LEN + IV_LEN))
  const decKey = crypto.createHash('sha256').update(Buffer.concat([prekeyIv.subarray(0, PREKEY_LEN), secret])).digest()
  const dec = new AesCtr(decKey, Buffer.from(prekeyIv.subarray(PREKEY_LEN)))
  const decrypted = dec.update(Buffer.from(handshake))
  const protoTag = Buffer.from(decrypted.subarray(PROTO_TAG_POS, PROTO_TAG_POS + 4))
  if (!protoTag.equals(PROTO_TAG_ABRIDGED) && !protoTag.equals(PROTO_TAG_INTERMEDIATE) && !protoTag.equals(PROTO_TAG_SECURE)) {
    return null
  }
  const dcIdx = decrypted.readInt16LE(DC_IDX_POS)
  return { dcId: Math.abs(dcIdx), isMedia: dcIdx < 0, protoTag, prekeyIv }
}

/**
 * Forge a fresh upstream obfuscation init for the same proto/DC
 * (standard obfuscation, no secret hash). Pure (random).
 */
export function generateRelayInit(protoTag: Buffer, dcIdx: number): Buffer {
  let rnd: Buffer
  for (;;) {
    rnd = crypto.randomBytes(HANDSHAKE_LEN)
    if (rnd[0] === RESERVED_FIRST_BYTE) continue
    if (RESERVED_STARTS.has(rnd.subarray(0, 4).toString('hex'))) continue
    if (Buffer.from(rnd.subarray(4, 8)).equals(RESERVED_CONTINUE)) continue
    break
  }
  const enc = new AesCtr(Buffer.from(rnd.subarray(SKIP_LEN, SKIP_LEN + PREKEY_LEN)), Buffer.from(rnd.subarray(SKIP_LEN + PREKEY_LEN, SKIP_LEN + PREKEY_LEN + IV_LEN)))
  const encryptedFull = enc.update(Buffer.from(rnd))
  const tailPlain = Buffer.concat([Buffer.from(protoTag), Buffer.alloc(2), crypto.randomBytes(2)])
  tailPlain.writeInt16LE(dcIdx, 4)
  const out = Buffer.from(rnd)
  for (let i = 0; i < 8; i++) {
    const keystream = encryptedFull[PROTO_TAG_POS + i] ^ rnd[PROTO_TAG_POS + i]
    out[PROTO_TAG_POS + i] = tailPlain[i] ^ keystream
  }
  return out
}

/** Four re-encryption streams client↔proxy↔telegram (mirrors CryptoCtx). */
export class CryptoCtx {
  constructor(
    public readonly cltDec: AesCtr,
    public readonly cltEnc: AesCtr,
    public readonly tgEnc: AesCtr,
    public readonly tgDec: AesCtr
  ) {}
}

/** Derive the four crypto streams from the client init + relay init. Pure. */
export function buildCryptoCtx(clientPrekeyIv: Buffer, secret: Buffer, relayInit: Buffer): CryptoCtx {
  const cltDecPrekey = Buffer.from(clientPrekeyIv.subarray(0, PREKEY_LEN))
  const cltDecIv = Buffer.from(clientPrekeyIv.subarray(PREKEY_LEN))
  const cltDecKey = crypto.createHash('sha256').update(Buffer.concat([cltDecPrekey, secret])).digest()
  const cltEncPrekeyIv = Buffer.from(clientPrekeyIv).reverse()
  const cltEncKey = crypto.createHash('sha256').update(Buffer.concat([cltEncPrekeyIv.subarray(0, PREKEY_LEN), secret])).digest()
  const cltEncIv = Buffer.from(cltEncPrekeyIv.subarray(PREKEY_LEN))
  const cltDec = new AesCtr(cltDecKey, cltDecIv)
  const cltEnc = new AesCtr(cltEncKey, cltEncIv)
  // Fast-forward the client decryptor past the 64-byte init packet.
  cltDec.update(Buffer.from(ZERO_64))

  const relayEncKey = Buffer.from(relayInit.subarray(SKIP_LEN, SKIP_LEN + PREKEY_LEN))
  const relayEncIv = Buffer.from(relayInit.subarray(SKIP_LEN + PREKEY_LEN, SKIP_LEN + PREKEY_LEN + IV_LEN))
  const relayDecPrekeyIv = Buffer.from(relayInit.subarray(SKIP_LEN, SKIP_LEN + PREKEY_LEN + IV_LEN)).reverse()
  const tgEnc = new AesCtr(relayEncKey, relayEncIv)
  const tgDec = new AesCtr(Buffer.from(relayDecPrekeyIv.subarray(0, 32)), Buffer.from(relayDecPrekeyIv.subarray(32)))
  tgEnc.update(Buffer.from(ZERO_64))
  return new CryptoCtx(cltDec, cltEnc, tgEnc, tgDec)
}

// ---------------------------------------------------------------------------
// MsgSplitter — split the TCP stream into MTProto packets → one WS frame each
// ---------------------------------------------------------------------------

/**
 * Splits relay-side ciphertext into transport packets by decrypting the
 * keystream on the fly (mirrors `MsgSplitter`; buffered across chunk
 * boundaries so packets split across TCP segments survive).
 */
export class MsgSplitter {
  private dec: AesCtr
  private proto: number
  private cipherBuf: Buffer = Buffer.alloc(0)
  private plainBuf: Buffer = Buffer.alloc(0)
  private disabled = false

  constructor(relayInit: Buffer, protoInt: number) {
    this.dec = new AesCtr(Buffer.from(relayInit.subarray(8, 40)), Buffer.from(relayInit.subarray(40, 56)))
    this.dec.update(Buffer.from(ZERO_64))
    this.proto = protoInt
  }

  split(chunk: Buffer): Buffer[] {
    if (chunk.length === 0) return []
    if (this.disabled) return [Buffer.from(chunk)]
    this.cipherBuf = Buffer.concat([this.cipherBuf, chunk])
    this.plainBuf = Buffer.concat([this.plainBuf, this.dec.update(Buffer.from(chunk))])
    const parts: Buffer[] = []
    let offset = 0
    const total = this.cipherBuf.length
    for (;;) {
      const packetLen = this.nextPacketLen(offset, total - offset)
      if (packetLen === null) break
      if (packetLen <= 0) {
        parts.push(Buffer.from(this.cipherBuf.subarray(offset)))
        offset = total
        this.disabled = true
        break
      }
      parts.push(Buffer.from(this.cipherBuf.subarray(offset, offset + packetLen)))
      offset += packetLen
    }
    if (offset > 0) {
      this.cipherBuf = Buffer.from(this.cipherBuf.subarray(offset))
      this.plainBuf = Buffer.from(this.plainBuf.subarray(offset))
    }
    return parts
  }

  flush(): Buffer[] {
    if (this.cipherBuf.length === 0) return []
    const tail = Buffer.from(this.cipherBuf)
    this.cipherBuf = Buffer.alloc(0)
    this.plainBuf = Buffer.alloc(0)
    return [tail]
  }

  private nextPacketLen(offset: number, avail: number): number | null {
    if (avail <= 0) return null
    if (this.proto === PROTO_ABRIDGED_INT) return this.nextAbridgedLen(offset, avail)
    if (this.proto === PROTO_INTERMEDIATE_INT || this.proto === PROTO_PADDED_INTERMEDIATE_INT) {
      return this.nextIntermediateLen(offset, avail)
    }
    return 0
  }

  private nextAbridgedLen(offset: number, avail: number): number | null {
    const first = this.plainBuf[offset]
    let payloadLen: number
    let headerLen: number
    if (first === 0x7f || first === 0xff) {
      if (avail < 4) return null
      payloadLen = this.plainBuf.readUIntLE(offset + 1, 3) * 4
      headerLen = 4
    } else {
      payloadLen = (first & 0x7f) * 4
      headerLen = 1
    }
    if (payloadLen <= 0) return 0
    const packetLen = headerLen + payloadLen
    if (avail < packetLen) return null
    return packetLen
  }

  private nextIntermediateLen(offset: number, avail: number): number | null {
    if (avail < 4) return null
    const payloadLen = this.plainBuf.readUInt32LE(offset) & 0x7fffffff
    if (payloadLen <= 0) return 0
    const packetLen = 4 + payloadLen
    if (avail < packetLen) return null
    return packetLen
  }
}

// ---------------------------------------------------------------------------
// Raw TLS WebSocket client (mirrors proxy/raw_websocket.py)
// ---------------------------------------------------------------------------

export class WsHandshakeError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusLine: string,
    public readonly headers: Record<string, string> = {},
    public readonly location?: string
  ) {
    super(`HTTP ${statusCode}: ${statusLine}`)
    this.name = 'WsHandshakeError'
  }

  get isRedirect(): boolean {
    return this.statusCode === 301 || this.statusCode === 302 || this.statusCode === 303 || this.statusCode === 307 || this.statusCode === 308
  }
}

export class WsConnectTimeout extends Error {
  constructor(msg = 'WS connect timed out') {
    super(msg)
    this.name = 'WsConnectTimeout'
  }
}

function xorMask(data: Buffer, mask: Buffer): Buffer {
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ mask[i & 3]
  return out
}

function buildWsFrame(opcode: number, data: Buffer, mask: boolean): Buffer {
  const len = data.length
  const first = 0x80 | opcode
  let header: Buffer
  if (len < 126) header = Buffer.from([first, (mask ? 0x80 : 0) | len])
  else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = first
    header[1] = (mask ? 0x80 : 0) | 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = first
    header[1] = (mask ? 0x80 : 0) | 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  if (!mask) return Buffer.concat([header, data])
  const maskKey = crypto.randomBytes(4)
  return Buffer.concat([header, maskKey, xorMask(data, maskKey)])
}

interface PendingRead {
  n: number
  resolve: (data: Buffer) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Minimal TLS WebSocket (binary) client speaking to Telegram DCs.
 * Certificate verification is disabled like upstream (`CERT_NONE`) —
 * MTProto payloads are end-to-end encrypted regardless of transport TLS.
 */
export class RawWebSocket {
  static readonly OP_CONT = 0x0
  static readonly OP_BINARY = 0x2
  static readonly OP_CLOSE = 0x8
  static readonly OP_PING = 0x9
  static readonly OP_PONG = 0xa

  private buf: Buffer = Buffer.alloc(0)
  private waiters: PendingRead[] = []
  private frag: Buffer[] = []
  private fragLen = 0
  closed = false

  private constructor(private readonly socket: tls.TLSSocket, extra: Buffer) {
    if (extra.length > 0) this.buf = Buffer.from(extra)
    socket.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d])
      this.pump()
    })
    socket.on('close', () => this.failAll(new Error('socket closed')))
    socket.on('error', () => {
      /* surfaced via pending reads / recv returning null */
    })
  }

  static async connect(
    host: string,
    domain: string,
    timeoutMs = WS_CONNECT_TIMEOUT_MS,
    wsPath = TG_PROXY_WS_PATH,
    sni?: string,
    highWaterMark?: number
  ): Promise<RawWebSocket> {
    const hwm = highWaterMark !== undefined && Number.isFinite(highWaterMark) && highWaterMark > 0 ? Math.floor(highWaterMark) : 0
    let socket: tls.TLSSocket
    if (hwm > 0) {
      // `--buf-kb`: backing TCP socket with explicit water marks, then TLS
      // over it (Node has no SO_RCVBUF/SO_SNDBUF API — this is the closest
      // equivalent controlling kernel↔userspace chunking; the cast is needed
      // because @types/node omits HWM in SocketConstructorOpts, but the
      // options reach stream.Duplex at runtime).
      const hwmOpts = {
        readableHighWaterMark: hwm,
        writableHighWaterMark: hwm
      } as net.SocketConstructorOpts
      const plain = new net.Socket(hwmOpts)
      plain.setNoDelay(true)
      try {
        await connectPlainSocket(plain, host, 443, Math.min(timeoutMs, 10000))
        socket = await wrapTlsOverSocket(plain, sni ?? domain, Math.min(timeoutMs, 10000))
      } catch (e) {
        try {
          plain.destroy()
        } catch {
          /* ignore */
        }
        throw e
      }
    } else {
      socket = tls.connect({
        host,
        port: 443,
        servername: sni ?? domain,
        rejectUnauthorized: false
      })
      socket.setNoDelay(true)
      try {
        await waitForSocketConnect(socket, Math.min(timeoutMs, 10000))
      } catch (e) {
        socket.destroy()
        throw e
      }
    }
    const wsKey = crypto.randomBytes(16).toString('base64')
    const req =
      `GET ${wsPath} HTTP/1.1\r\n` +
      `Host: ${domain}\r\n` +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${wsKey}\r\n` +
      'Sec-WebSocket-Version: 13\r\n' +
      'Sec-WebSocket-Protocol: binary\r\n' +
      '\r\n'
    socket.write(req)
    const { head, extra } = await readHttpHead(socket, timeoutMs)
    const lines = head.split('\r\n').filter((l) => l.length > 0)
    if (lines.length === 0) {
      socket.destroy()
      throw new WsHandshakeError(0, 'empty response')
    }
    const first = lines[0]
    const parts = first.split(' ')
    const statusCode = parts.length >= 2 ? Number.parseInt(parts[1], 10) : 0
    if (statusCode === 101) return new RawWebSocket(socket, extra)
    const headers: Record<string, string> = {}
    for (const line of lines.slice(1)) {
      const sep = line.indexOf(':')
      if (sep > 0) headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim()
    }
    socket.destroy()
    throw new WsHandshakeError(Number.isFinite(statusCode) ? statusCode : 0, first, headers, headers['location'])
  }

  async send(data: Buffer): Promise<void> {
    if (this.closed) throw new Error('WebSocket closed')
    await this.writeBuf(buildWsFrame(RawWebSocket.OP_BINARY, data, true))
  }

  async sendBatch(parts: Buffer[]): Promise<void> {
    if (this.closed) throw new Error('WebSocket closed')
    await this.writeBuf(Buffer.concat(parts.map((p) => buildWsFrame(RawWebSocket.OP_BINARY, p, true))))
  }

  /** Next binary message, or null on upstream close. */
  async recv(): Promise<Buffer | null> {
    while (!this.closed) {
      const hdr = await this.readExactly(2)
      const fin = (hdr[0] & 0x80) !== 0
      const opcode = hdr[0] & 0x0f
      let length = hdr[1] & 0x7f
      const masked = (hdr[1] & 0x80) !== 0
      if (length === 126) length = this.readU16(await this.readExactly(2))
      else if (length === 127) {
        const big = (await this.readExactly(8)).readBigUInt64BE(0)
        if (big > BigInt(WS_MAX_MESSAGE)) throw new Error(`WS frame too large: ${big}`)
        length = Number(big)
      }
      if (length > WS_MAX_MESSAGE) throw new Error(`WS frame too large: ${length} bytes`)
      const maskKey = masked ? await this.readExactly(4) : null
      let payload = length > 0 ? await this.readExactly(length) : Buffer.alloc(0)
      if (maskKey) payload = xorMask(payload, maskKey)

      if (opcode === RawWebSocket.OP_CLOSE) {
        this.closed = true
        try {
          await this.writeBuf(buildWsFrame(RawWebSocket.OP_CLOSE, payload.subarray(0, 2), true))
        } catch {
          /* best effort */
        }
        return null
      }
      if (opcode === RawWebSocket.OP_PING) {
        try {
          await this.writeBuf(buildWsFrame(RawWebSocket.OP_PONG, payload, true))
        } catch {
          /* ignore */
        }
        continue
      }
      if (opcode === RawWebSocket.OP_PONG) continue
      if (opcode === RawWebSocket.OP_CONT || opcode === 0x1 || opcode === RawWebSocket.OP_BINARY) {
        if (fin && this.frag.length === 0) return payload
        this.frag.push(payload)
        this.fragLen += payload.length
        if (this.fragLen > WS_MAX_MESSAGE) throw new Error(`WS message too large: ${this.fragLen} bytes`)
        if (!fin) continue
        const message = Buffer.concat(this.frag)
        this.frag = []
        this.fragLen = 0
        return message
      }
      // Unknown opcode — skip.
    }
    return null
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.writeBuf(buildWsFrame(RawWebSocket.OP_CLOSE, Buffer.alloc(0), true))
    } catch {
      /* ignore */
    }
    this.socket.destroy()
  }

  destroy(): void {
    this.closed = true
    try {
      this.socket.destroy()
    } catch {
      /* ignore */
    }
  }

  private readU16(b: Buffer): number {
    return b.readUInt16BE(0)
  }

  private writeBuf(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('WebSocket closed'))
        return
      }
      this.socket.write(data, (e) => {
        if (e) reject(e)
        else resolve()
      })
    })
  }

  private readExactly(n: number): Promise<Buffer> {
    if (this.buf.length >= n) {
      const out = Buffer.from(this.buf.subarray(0, n))
      this.buf = Buffer.from(this.buf.subarray(n))
      return Promise.resolve(out)
    }
    if (this.closed || this.socket.destroyed) {
      return Promise.reject(new Error('socket closed'))
    }
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve)
        reject(new Error('socket read timed out'))
      }, 120000)
      timer.unref?.()
      this.waiters.push({ n, resolve, reject, timer })
    })
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const w = this.waiters[0]
      if (this.buf.length < w.n) break
      this.waiters.shift()
      clearTimeout(w.timer)
      const out = Buffer.from(this.buf.subarray(0, w.n))
      this.buf = Buffer.from(this.buf.subarray(w.n))
      w.resolve(out)
    }
  }

  private failAll(e: Error): void {
    this.closed = true
    const pending = this.waiters
    this.waiters = []
    for (const w of pending) {
      clearTimeout(w.timer)
      w.reject(e)
    }
  }
}

function waitForSocketConnect(socket: tls.TLSSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connecting === false && !socket.destroyed) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new WsConnectTimeout())
    }, timeoutMs)
    timer.unref?.()
    const onConnect = (): void => {
      cleanup()
      resolve()
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('secureConnect', onConnect)
      socket.removeListener('connect', onConnect)
      socket.removeListener('error', onError)
    }
    socket.once('secureConnect', onConnect)
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

/** Connect a plain TCP socket with timeout (for the `--buf-kb` HWM path). */
function connectPlainSocket(socket: net.Socket, host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      reject(new WsConnectTimeout())
    }, timeoutMs)
    timer.unref?.()
    const onConnect = (): void => {
      cleanup()
      resolve()
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('connect', onConnect)
      socket.removeListener('error', onError)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
    socket.connect({ host, port })
  })
}

/** TLS-wrap an already-connected plain socket (SNI preserved). */
function wrapTlsOverSocket(plain: net.Socket, servername: string, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    let tlsSock: tls.TLSSocket
    try {
      tlsSock = tls.connect({ socket: plain, servername, rejectUnauthorized: false })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      try {
        tlsSock.destroy()
      } catch {
        /* ignore */
      }
      reject(new WsConnectTimeout())
    }, timeoutMs)
    timer.unref?.()
    const onSecure = (): void => {
      cleanup()
      resolve(tlsSock)
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      tlsSock.removeListener('secureConnect', onSecure)
      tlsSock.removeListener('error', onError)
    }
    tlsSock.once('secureConnect', onSecure)
    tlsSock.once('error', onError)
  })
}

function readHttpHead(socket: tls.TLSSocket, timeoutMs: number): Promise<{ head: string; extra: Buffer }> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0)
    const timer = setTimeout(() => {
      cleanup()
      reject(new WsConnectTimeout('WS handshake timed out'))
    }, timeoutMs)
    timer.unref?.()
    const onData = (d: Buffer): void => {
      acc = Buffer.concat([acc, d])
      const idx = acc.indexOf('\r\n\r\n')
      if (idx >= 0) {
        cleanup()
        resolve({ head: acc.subarray(0, idx).toString('utf8'), extra: Buffer.from(acc.subarray(idx + 4)) })
      } else if (acc.length > 65536) {
        cleanup()
        reject(new WsHandshakeError(0, 'header too large'))
      }
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const onClose = (): void => {
      cleanup()
      reject(new WsHandshakeError(0, 'connection closed during handshake'))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

// ---------------------------------------------------------------------------
// CF-proxy domain balancer (mirrors proxy/balancer.py + proxy/config.py)
// ---------------------------------------------------------------------------

/** Obfuscated fallback domains (Caesar-shifted, decoded at runtime). */
const CFPROXY_ENC = [
  'virkgj.com',
  'vmmzovy.com',
  'mkuosckvso.com',
  'zaewayzmplad.com',
  'twdmbzcm.com',
  'awzwsldi.com',
  'clngqrflngqin.com',
  'tjacxbqtj.com',
  'bxaxtxmrw.com',
  'dmohrsgmohcrwb.com',
  'vwbmtmoi.com',
  'khgrre.com',
  'ulihssf.com',
  'tmhqsdqmfpmk.com',
  'xwuwoqbm.com',
  'orgcnunpj.com',
  'zhkuldz.com',
  'zypoljnslxa.com',
  'efabnxaowuzs.com',
  'zaftuzsftqdq.com'
]

const CF_TLD_SUFFIX = '.co.uk'

/** Decode one obfuscated CF-proxy domain entry. Pure. */
export function decodeCfDomain(s: string): string {
  if (!s.endsWith('.com')) return s
  const p = s.slice(0, -4)
  const n = [...p].filter((c) => /[A-Za-z]/.test(c)).length
  const dec = [...p]
    .map((c) => {
      if (!/[A-Za-z]/.test(c)) return c
      const base = c <= 'Z' ? 65 : 97
      return String.fromCharCode(((c.charCodeAt(0) - base - n) % 26 + 26) % 26 + base)
    })
    .join('')
  return dec + CF_TLD_SUFFIX
}

/** Built-in CF-proxy domain pool (decoded). Pure. */
export function defaultCfProxyDomains(): string[] {
  return CFPROXY_ENC.map(decodeCfDomain)
}

class CfBalancer {
  private domains: string[] = []
  private dcToDomain = new Map<number, string>()

  updateDomainsList(list: string[]): void {
    const norm = [...new Set(list.map((d) => d.trim().toLowerCase()).filter(isValidDomain))]
    if (norm.length === 0) return
    const same = this.domains.length === norm.length && this.domains.every((d) => norm.includes(d))
    if (same) return
    this.domains = norm
    for (const dc of [1, 2, 3, 4, 5, 203]) {
      this.dcToDomain.set(dc, norm[Math.floor(Math.random() * norm.length)])
    }
  }

  updateDomainForDc(dc: number, domain: string): boolean {
    if (this.dcToDomain.get(dc) === domain) return false
    this.dcToDomain.set(dc, domain)
    return true
  }

  getDomainsForDc(dc: number): string[] {
    const current = this.dcToDomain.get(dc)
    const rest = [...this.domains].sort(() => Math.random() - 0.5).filter((d) => d !== current)
    return current ? [current, ...rest] : rest
  }

  reset(): void {
    this.domains = []
    this.dcToDomain.clear()
  }
}

const balancer = new CfBalancer()

const CFPROXY_DOMAINS_URL = 'https://raw.githubusercontent.com/Flowseal/tg-ws-proxy/main/.github/cfproxy-domains.txt'

/** Best-effort hourly refresh of the CF domain pool (never throws). */
async function refreshCfProxyDomains(): Promise<void> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    timer.unref?.()
    const res = await fetch(`${CFPROXY_DOMAINS_URL}?${Math.random().toString(36).slice(2)}`, {
      headers: { 'User-Agent': 'zapret-gui-tg-proxy' },
      signal: ctrl.signal
    })
    clearTimeout(timer)
    if (!res.ok) return
    const text = await res.text()
    const decoded = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .map(decodeCfDomain)
    const valid = [...new Set(decoded.filter(isValidDomain))]
    if (valid.length >= 3) balancer.updateDomainsList(valid)
  } catch {
    /* offline — keep the built-in pool */
  }
}

// ---------------------------------------------------------------------------
// Idle WS connection pool (mirrors proxy/pool.py, on-demand variant)
// ---------------------------------------------------------------------------

interface PooledWs {
  ws: RawWebSocket
  created: number
}

class WsPool {
  private idle = new Map<string, PooledWs[]>()
  private refilling = new Set<string>()

  private key(dc: number, isMedia: boolean): string {
    return `${dc}:${isMedia ? 'm' : ''}`
  }

  get(dc: number, isMedia: boolean): RawWebSocket | null {
    const k = this.key(dc, isMedia)
    const bucket = this.idle.get(k)
    if (!bucket) return null
    const now = Date.now()
    while (bucket.length > 0) {
      const item = bucket.shift()
      if (!item) break
      if (now - item.created > WS_POOL_MAX_AGE_MS || item.ws.closed) {
        void item.ws.close().catch(() => undefined)
        continue
      }
      return item.ws
    }
    return null
  }

  put(dc: number, isMedia: boolean, ws: RawWebSocket): void {
    const k = this.key(dc, isMedia)
    const bucket = this.idle.get(k) ?? []
    if (activePoolSize <= 0 || bucket.length >= activePoolSize || ws.closed) {
      if (!ws.closed) void ws.close().catch(() => undefined)
      else this.idle.set(k, bucket)
      return
    }
    bucket.push({ ws, created: Date.now() })
    this.idle.set(k, bucket)
  }

  /** Fire-and-forget refill of one idle socket for the DC. */
  scheduleRefill(dc: number, isMedia: boolean, targetIp: string, domains: string[]): void {
    const k = this.key(dc, isMedia)
    if (this.refilling.has(k)) return
    const bucket = this.idle.get(k)
    if (activePoolSize <= 0 || (bucket && bucket.length >= activePoolSize)) return
    this.refilling.add(k)
    void (async () => {
      try {
        const ws = await connectFirstWs(targetIp, domains, TG_PROXY_WS_PATH, WS_CONNECT_TIMEOUT_MS)
        if (ws) this.put(dc, isMedia, ws)
      } catch {
        /* best effort */
      } finally {
        this.refilling.delete(k)
      }
    })()
  }

  /** Pre-connect idle sockets for all known DCs (best effort). */
  warmup(dcRedirects: Record<number, string>): void {
    for (const [dcStr, targetIp] of Object.entries(dcRedirects)) {
      const dc = Number(dcStr)
      for (const isMedia of [false, true]) {
        this.scheduleRefill(dc, isMedia, targetIp, wsDomains(dc, isMedia))
      }
    }
  }

  clear(): void {
    for (const bucket of this.idle.values()) {
      for (const item of bucket) {
        try {
          item.ws.destroy()
        } catch {
          /* ignore */
        }
      }
    }
    this.idle.clear()
    this.refilling.clear()
  }
}

const wsPool = new WsPool()

async function connectFirstWs(targetIp: string, domains: string[], wsPath: string, timeoutMs: number): Promise<RawWebSocket | null> {
  for (const domain of domains) {
    try {
      return await RawWebSocket.connect(targetIp, domain, timeoutMs, wsPath, undefined, activeHwm > 0 ? activeHwm : undefined)
    } catch (e) {
      if (e instanceof WsHandshakeError && e.isRedirect) continue
      return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// FakeTLS (`ee`-secrets) — mirrors proxy/fake_tls.py
//
// With a masking domain configured, Telegram clients derive an `ee`-secret
// and open with a camouflaged TLS ClientHello. We verify its HMAC +
// timestamp, answer with a fake ServerHello, then speak obfuscated2 inside
// TLS application-data records. Probes with a wrong secret (or plain HTTP)
// are relayed to the masking domain / answered with a 301 redirect, so the
// listener is indistinguishable from the real site.
// ---------------------------------------------------------------------------

const TLS_RECORD_HANDSHAKE = 0x16
const TLS_RECORD_CCS = 0x14
const TLS_RECORD_APPDATA = 0x17
const TLS_APPDATA_MAX = 16384
const FAKE_TLS_TS_TOLERANCE_S = 120

const FAKE_TLS_CCS_FRAME = Buffer.from([0x14, 0x03, 0x03, 0x00, 0x01, 0x01])

/** ServerHello template (offsets mirror `_SH_*_OFF` in fake_tls.py). */
const FAKE_TLS_SERVER_HELLO_HEX =
  '160303007a' + // record: handshake, TLS1.2, 122 bytes
  '02000076' + // hello: server_hello, 118 bytes
  '0303' + // server version TLS1.2
  '00'.repeat(32) + // server_random (filled in)
  '20' + // session id length 32
  '00'.repeat(32) + // session id (echoed)
  '1301' + // cipher TLS_AES_128_GCM_SHA256
  '00' + // compression null
  '002e' + // extensions length 46
  '00330024001d0020' + // key_share (x25519) header
  '00'.repeat(32) + // ephemeral pubkey (random)
  '002b00020304' // supported_versions (TLS1.3)

export interface FakeTlsHello {
  clientRandom: Buffer
  sessionId: Buffer
  timestamp: number
}

/**
 * Verify a camouflaged ClientHello: HMAC-SHA256(secret, zeroed-random hello)
 * must match the first 28 random bytes, and the xor-embedded timestamp must
 * be within tolerance. Returns null for foreign probes. Pure.
 */
export function verifyClientHello(data: Buffer, secret: Buffer): FakeTlsHello | null {
  if (data.length < 43 || data[0] !== TLS_RECORD_HANDSHAKE || data[5] !== 0x01) return null
  const clientRandom = Buffer.from(data.subarray(11, 11 + 32))
  const zeroed = Buffer.from(data)
  zeroed.fill(0, 11, 11 + 32)
  const expected = crypto.createHmac('sha256', secret).update(zeroed).digest()
  const a = expected.subarray(0, 28)
  const b = clientRandom.subarray(0, 28)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const tsXor = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) tsXor[i] = clientRandom[28 + i] ^ expected[28 + i]
  const timestamp = tsXor.readUInt32LE(0)
  if (Math.abs(Date.now() / 1000 - timestamp) > FAKE_TLS_TS_TOLERANCE_S) return null
  let sessionId = Buffer.alloc(32, 0)
  if (data.length >= 44 + 32 && data[43] === 0x20) {
    sessionId = Buffer.from(data.subarray(44, 44 + 32))
  }
  return { clientRandom, sessionId, timestamp }
}

/** Forge the fake ServerHello + CCS + junk appdata blob. Pure (random). */
export function buildServerHello(secret: Buffer, clientRandom: Buffer, sessionId: Buffer): Buffer {
  const sh = Buffer.from(FAKE_TLS_SERVER_HELLO_HEX, 'hex')
  sessionId.copy(sh, 44, 0, 32)
  crypto.randomBytes(32).copy(sh, 89, 0, 32)
  const blobLen = 1900 + Math.floor(Math.random() * 201)
  const appRecord = Buffer.concat([
    Buffer.from([TLS_RECORD_APPDATA, 0x03, 0x03]),
    Buffer.alloc(2),
    crypto.randomBytes(blobLen)
  ])
  appRecord.writeUInt16BE(blobLen, 3)
  const response = Buffer.concat([sh, FAKE_TLS_CCS_FRAME, appRecord])
  const serverRandom = crypto.createHmac('sha256', secret).update(Buffer.concat([clientRandom, response])).digest()
  serverRandom.copy(sh, 11, 0, 32)
  return Buffer.concat([sh, FAKE_TLS_CCS_FRAME, appRecord])
}

/** Split payload into TLS application-data records (≤16KB each). Pure. */
export function wrapTlsRecords(data: Buffer): Buffer {
  const parts: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += TLS_APPDATA_MAX) {
    const chunk = data.subarray(offset, offset + TLS_APPDATA_MAX)
    const head = Buffer.from([TLS_RECORD_APPDATA, 0x03, 0x03, 0, 0])
    head.writeUInt16BE(chunk.length, 3)
    parts.push(head, Buffer.from(chunk))
  }
  return Buffer.concat(parts)
}

/** Drain helper: resolve once the socket flushes. */
function waitDrain(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.once('drain', () => resolve())
    } catch {
      resolve()
    }
  })
}

/**
 * Totally-ordered byte reader over a socket (buffered, pause-aware).
 * Unlike `readTcpExactly`, it never detaches: safe for the record loop.
 */
class SocketReader {
  private buf: Buffer = Buffer.alloc(0)
  private waiters: Array<{ n: number; resolve: (d: Buffer) => void; reject: (e: Error) => void }> = []
  private failed: Error | null = null

  constructor(private readonly socket: net.Socket) {
    socket.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d])
      this.pump()
    })
    socket.once('close', () => this.fail(new Error('socket closed')))
    socket.once('error', (e: Error) => this.fail(e))
  }

  readExactly(n: number): Promise<Buffer> {
    if (this.failed) return Promise.reject(this.failed)
    if (this.buf.length >= n) {
      const out = Buffer.from(this.buf.subarray(0, n))
      this.buf = Buffer.from(this.buf.subarray(n))
      return Promise.resolve(out)
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.waiters.push({ n, resolve, reject })
    })
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const w = this.waiters[0]
      if (this.buf.length < w.n) break
      this.waiters.shift()
      const out = Buffer.from(this.buf.subarray(0, w.n))
      this.buf = Buffer.from(this.buf.subarray(w.n))
      w.resolve(out)
    }
  }

  private fail(e: Error): void {
    if (this.failed) return
    this.failed = e
    const pending = this.waiters
    this.waiters = []
    for (const w of pending) w.reject(e)
  }
}

/**
 * TLS-record session over a plain socket (mirrors `FakeTlsStream`).
 * Presents the same surface the bridge pumps need (`on`/`once`/
 * `removeListener`/`write`/`destroy`/`destroyed`/`resume`/`pause`), emitting
 * decrypted application-data payloads as `data`.
 */
export class FakeTlsSession {
  private readonly reader: SocketReader
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>()
  destroyed = false

  constructor(private readonly socket: net.Socket) {
    this.reader = new SocketReader(socket)
    socket.once('close', () => this.emitLocal('close'))
    socket.once('error', (e: Error) => this.emitLocal('error', e))
    socket.once('end', () => this.emitLocal('end'))
  }

  /** Start the record-read loop (call once, after the handshake). */
  start(): void {
    void this.recordLoop().catch(() => undefined)
  }

  /**
   * Read exactly n decrypted bytes (handshake phase, before `start()`).
   * Overall timeout → throws.
   */
  async readExactly(n: number, timeoutMs: number): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs
    let acc = Buffer.alloc(0)
    while (acc.length < n) {
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('fake-tls read timed out')
      const payload = await this.readRecordPayload(left)
      if (payload === null) throw new Error('fake-tls unexpected record')
      acc = Buffer.concat([acc, payload])
    }
    return acc.subarray(0, n)
  }

  /** Next application-data payload, or null on close/unexpected record. */
  private async readRecordPayload(timeoutMs: number): Promise<Buffer | null> {
    const rec = await this.withTimeout(this.readRecord(), timeoutMs)
    return rec
  }

  private async readRecord(): Promise<Buffer | null> {
    for (;;) {
      const hdr = await this.reader.readExactly(5)
      const rtype = hdr[0]
      const recLen = hdr.readUInt16BE(3)
      if (rtype === TLS_RECORD_CCS) {
        if (recLen > 0) await this.reader.readExactly(recLen)
        continue
      }
      if (rtype !== TLS_RECORD_APPDATA) return null
      if (recLen === 0) continue
      return this.reader.readExactly(recLen)
    }
  }

  private withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fake-tls read timed out')), Math.max(1, timeoutMs))
      timer.unref?.()
      p.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e: unknown) => {
          clearTimeout(timer)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      )
    })
  }

  private async recordLoop(): Promise<void> {
    try {
      for (;;) {
        if (this.destroyed) break
        const payload = await this.readRecord()
        if (payload === null) break
        if (payload.length > 0) this.emitLocal('data', payload)
      }
    } catch {
      /* socket closed — terminate */
    }
  }

  write(data: Buffer): boolean {
    try {
      return this.socket.write(wrapTlsRecords(Buffer.from(data)))
    } catch {
      return false
    }
  }

  destroy(): void {
    this.destroyed = true
    try {
      this.socket.destroy()
    } catch {
      /* ignore */
    }
  }

  resume(): net.Socket {
    try {
      this.socket.resume()
    } catch {
      /* ignore */
    }
    return this.socket
  }

  pause(): net.Socket {
    try {
      this.socket.pause()
    } catch {
      /* ignore */
    }
    return this.socket
  }

  on(event: string, listener: (...args: any[]) => void): this {
    this.addLocal(event, listener)
    return this
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapper = (...args: unknown[]): void => {
      this.removeListener(event, wrapper)
      listener(...args)
    }
    this.addLocal(event, wrapper)
    return this
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  private addLocal(event: string, listener: (...args: any[]) => void): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
  }

  private emitLocal(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of [...set]) {
      try {
        fn(...args)
      } catch {
        /* listener must never break the loop */
      }
    }
  }
}

/**
 * Relay a wrong-secret probe to the real masking domain (`:443`),
 * prefixing the already-read ClientHello (mirrors `proxy_to_masking_domain`).
 */
export async function proxyToMaskingDomain(client: net.Socket, initialData: Buffer, domain: string, label: string): Promise<void> {
  counters.masked += 1
  let upstream: net.Socket
  try {
    upstream = await connectTcp(domain, 443, TCP_FALLBACK_TIMEOUT_MS)
  } catch (e) {
    warn('tg-proxy', `[${label}] masking: cannot connect to masking domain:443: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    return
  }
  info('tg-proxy', `[${label}] masking relay to :443`)
  try {
    if (initialData.length > 0) {
      upstream.write(Buffer.from(initialData))
    }
    const relay = (src: net.Socket, dst: net.Socket): Promise<void> =>
      new Promise((resolve) => {
        const onData = (chunk: Buffer): void => {
          try {
            if (!dst.destroyed) dst.write(chunk)
          } catch {
            resolve()
          }
        }
        const done = (): void => {
          src.removeListener('data', onData)
          resolve()
        }
        // Domain names stay out of the logs (mirrors DomainCensorFilter).
        src.on('data', onData)
        src.once('close', done)
        src.once('error', done)
      })
    try {
      client.resume()
    } catch {
      /* ignore */
    }
    await Promise.race([relay(client, upstream), relay(upstream, client)])
  } finally {
    try {
      upstream.destroy()
    } catch {
      /* ignore */
    }
    destroyClient(client)
  }
}

// ---------------------------------------------------------------------------
// Server state + lifecycle
// ---------------------------------------------------------------------------

export interface TgProxyStartOptions {
  port: number
  host?: string
  /** 32-hex secret. */
  secret: string
  cfProxyEnabled?: boolean
  /** Custom WS target table (merged over built-ins). */
  dcIps?: Record<number, string>
  /** Pre-warmed WS sockets per DC (0 = no pooling). */
  poolSize?: number
  /** Socket buffer hint in bytes (highWaterMark for outbound sockets). */
  highWaterMark?: number
  /** User CF-proxy domains (override the auto pool when non-empty). */
  cfDomains?: string[]
  /** Cloudflare Worker domains for the worker fallback. */
  workerDomains?: string[]
  /** FakeTLS masking domain ('' = disabled). */
  fakeTlsDomain?: string
  /** Route everything to test DCs. */
  forceTestDc?: boolean
  /** Accept a PROXY protocol v1 header. */
  proxyProtocol?: boolean
}

/**
 * Build start options from persisted settings (single mapping used by
 * IPC handlers, tray actions and autostart). Pure.
 */
export function tgStartOptsFromSettings(s: {
  port: number
  secret: string
  cfProxyEnabled: boolean
  host: string
  dcIps: string[]
  poolSize: number
  bufferKb: number
  cfDomains: string[]
  workerDomains: string[]
  fakeTlsDomain: string
  forceTestDc: boolean
  proxyProtocol: boolean
}): TgProxyStartOptions {
  let custom: Record<number, string> = {}
  for (const entry of normalizeDcIpEntries(s.dcIps)) {
    const sep = entry.indexOf(':')
    custom[Number(entry.slice(0, sep))] = entry.slice(sep + 1)
  }
  return {
    port: s.port,
    host: s.host,
    secret: s.secret,
    cfProxyEnabled: s.cfProxyEnabled,
    dcIps: custom,
    poolSize: s.poolSize,
    highWaterMark: s.bufferKb * 1024,
    cfDomains: [...s.cfDomains],
    workerDomains: [...s.workerDomains],
    fakeTlsDomain: s.fakeTlsDomain,
    forceTestDc: s.forceTestDc,
    proxyProtocol: s.proxyProtocol
  }
}

interface Counters {
  total: number
  active: number
  ws: number
  tcpFallback: number
  cf: number
  bad: number
  masked: number
  wsErrors: number
  bytesUp: number
  bytesDown: number
}

function freshCounters(): Counters {
  return { total: 0, active: 0, ws: 0, tcpFallback: 0, cf: 0, bad: 0, masked: 0, wsErrors: 0, bytesUp: 0, bytesDown: 0 }
}

let server: net.Server | null = null
let running = false
let listenHost: string = TG_PROXY_DEFAULT_HOST
let listenPort: number = TG_PROXY_DEFAULT_PORT
let startedAt: string | null = null
let lastError: string | null = null
let activeSecret = ''
let cfEnabled = true
let activeDcIps: Record<number, string> = {}
let activePoolSize = WS_POOL_SIZE
let activeHwm = 0
let activeWorkerDomains: string[] = []
let activeFakeTlsDomain = ''
let activeForceTestDc = false
let activeProxyProtocol = false
let cfRefreshTimer: NodeJS.Timeout | null = null
const counters: Counters = freshCounters()
const clients = new Set<net.Socket>()
const wsBlacklist = new Set<string>()
const dcFailUntil = new Map<string, number>()
const ipFailUntil = new Map<string, number>()

export function isTgProxyRunning(): boolean {
  return running && server !== null
}

/**
 * Read exactly n bytes from a TCP socket (timeout → throws).
 *
 * The socket is left PAUSED: the caller dials upstream (WS/TCP connect takes
 * hundreds of ms) before attaching its own `data` listener, and a socket
 * left in flowing mode with no listener silently DROPS arriving data in
 * Node.js (unlike asyncio, which buffers explicitly). Without this pause,
 * Telegram Desktop's first request — pipelined right after the init packet —
 * is lost and both sides idle until timeout (`^0.0B v0.0B` sessions).
 * Callers must `resume()` (bridge entry points) or destroy the socket.
 */
export function readTcpExactly(socket: net.Socket, n: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('client init timed out'))
    }, timeoutMs)
    timer.unref?.()
    const onData = (d: Buffer): void => {
      acc = Buffer.concat([acc, d])
      if (acc.length >= n) {
        cleanup()
        const out = Buffer.from(acc.subarray(0, n))
        const rest = Buffer.from(acc.subarray(n))
        if (rest.length > 0) socket.unshift(rest)
        resolve(out)
      }
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('client disconnected'))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
      // See above: never leave a listener-less socket flowing.
      try {
        socket.pause()
      } catch {
        /* ignore */
      }
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

/**
 * Read one `\\n`-terminated line (PROXY protocol header), returning the line
 * plus any bytes already read past it (re-queued via `unshift`).
 * The socket is left PAUSED like in {@link readTcpExactly}.
 */
export function readTcpLine(socket: net.Socket, timeoutMs: number, maxLen = 512): Promise<{ line: string; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('proxy protocol header timed out'))
    }, timeoutMs)
    timer.unref?.()
    const onData = (d: Buffer): void => {
      acc = Buffer.concat([acc, d])
      const idx = acc.indexOf('\n')
      if (idx >= 0) {
        cleanup()
        const line = acc.subarray(0, idx).toString('ascii')
        const rest = Buffer.from(acc.subarray(idx + 1))
        if (rest.length > 0) socket.unshift(rest)
        resolve({ line, rest })
      } else if (acc.length > maxLen) {
        cleanup()
        reject(new Error('proxy protocol header too long'))
      }
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('client disconnected'))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
      try {
        socket.pause()
      } catch {
        /* ignore */
      }
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

function destroyClient(socket: net.Socket): void {
  clients.delete(socket)
  try {
    socket.destroy()
  } catch {
    /* ignore */
  }
}

/**
 * Minimal socket surface used by the bridge pumps — satisfied by both
 * `net.Socket` (plain MTProto) and {@link FakeTlsSession} (`ee`-secrets).
 */
export interface BridgeSocket {
  on(event: string, listener: (...args: any[]) => void): unknown
  once(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  write(data: Buffer): boolean
  destroy(): unknown
  resume(): unknown
  pause(): unknown
  readonly destroyed: boolean
}

/** TCP(client) → WS(telegram) with re-encryption + packet splitting. */
async function pumpTcpToWs(client: BridgeSocket, ws: RawWebSocket, ctx: CryptoCtx, splitter: MsgSplitter | null, label: string): Promise<string | null> {
  let chain: Promise<void> = Promise.resolve()
  let failure: string | null = null
  const done = new Promise<string | null>((resolve) => {
    const onData = (chunk: Buffer): void => {
      counters.bytesUp += chunk.length
      let out: Buffer
      try {
        out = ctx.tgEnc.update(Buffer.from(ctx.cltDec.update(Buffer.from(chunk))))
      } catch (e) {
        failure = `crypto: ${e instanceof Error ? e.message : String(e)}`
        client.removeListener('data', onData)
        resolve(failure)
        return
      }
      const parts = splitter ? splitter.split(out) : [out]
      if (parts.length === 0) return
      chain = chain
        .then(() => (parts.length > 1 ? ws.sendBatch(parts) : ws.send(parts[0])))
        .catch((e: unknown) => {
          failure = `upstream: ${e instanceof Error ? e.message : String(e)}`
          client.removeListener('data', onData)
          resolve(failure)
        })
    }
    const onEnd = (): void => {
      const tail = splitter ? splitter.flush() : []
      if (tail.length > 0) {
        chain = chain
          .then(() => ws.send(tail[0]))
          .catch(() => undefined)
          .then(() => undefined)
      }
      client.removeListener('data', onData)
      void chain.then(() => resolve(failure))
    }
    const onError = (e: Error): void => {
      client.removeListener('data', onData)
      resolve(`client: ${e.message}`)
    }
    const onClose = (): void => {
      client.removeListener('data', onData)
      void chain.then(() => resolve(failure))
    }
    client.on('data', onData)
    client.once('end', onEnd)
    client.once('error', onError)
    client.once('close', onClose)
  })
  try {
    return await done
  } catch (e) {
    warn('tg-proxy', `[${label}] tcp->ws ended: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    return 'client: error'
  }
}

/** WS(telegram) → TCP(client) with re-encryption. */
async function pumpWsToTcp(client: BridgeSocket, ws: RawWebSocket, ctx: CryptoCtx): Promise<string | null> {
  try {
    for (;;) {
      const data = await ws.recv()
      if (data === null) return 'upstream: ws_close'
      counters.bytesDown += data.length
      let out: Buffer
      try {
        out = ctx.cltEnc.update(Buffer.from(ctx.tgDec.update(Buffer.from(data))))
      } catch (e) {
        return `crypto: ${e instanceof Error ? e.message : String(e)}`
      }
      let ok = true
      try {
        ok = client.destroyed ? false : client.write(out)
      } catch {
        return 'client: write failed'
      }
      if (!ok) {
        // A destroyed client never emits 'drain' — resolve on close/error
        // too, otherwise this pump (and its upstream socket) leaks forever.
        if (client.destroyed) return 'client: closed'
        await new Promise<void>((resolve) => {
          const done = (): void => {
            client.removeListener('drain', done)
            client.removeListener('close', done)
            client.removeListener('error', done)
            resolve()
          }
          client.once('drain', done)
          client.once('close', done)
          client.once('error', done)
        })
      }
      if (client.destroyed) return 'client: closed'
    }
  } catch (e) {
    return `upstream: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** Bidirectional bridge with session summary logging. */
async function bridgeWs(
  io: BridgeSocket,
  ws: RawWebSocket,
  ctx: CryptoCtx,
  splitter: MsgSplitter | null,
  label: string,
  dc: number,
  isMedia: boolean,
  teardown: () => void
): Promise<void> {
  const dcTag = `DC${dc}${isMedia ? 'm' : ''}`
  const up0 = counters.bytesUp
  const down0 = counters.bytesDown
  const t0 = Date.now()
  // Listeners attach synchronously inside the pumps (same tick), so resuming
  // here cannot lose data — buffered bytes are redelivered on resume.
  const pumps = Promise.all([pumpTcpToWs(io, ws, ctx, splitter, label), pumpWsToTcp(io, ws, ctx)])
  try {
    io.resume()
  } catch {
    /* ignore */
  }
  const [upErr, downErr] = await pumps
  const reason = upErr ?? downErr ?? 'normal'
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  info('tg-proxy', `[${label}] ${dcTag} WS session closed (${reason}): ^${humanBytes(counters.bytesUp - up0)} v${humanBytes(counters.bytesDown - down0)} in ${elapsed}s`)
  try {
    await ws.close()
  } catch {
    /* ignore */
  }
  try {
    teardown()
  } catch {
    /* ignore */
  }
}

/** Bidirectional TCP↔TCP bridge with re-encryption (direct fallback). */
async function bridgeTcp(io: BridgeSocket, remote: net.Socket, ctx: CryptoCtx, teardown: () => void): Promise<void> {
  const forward = (src: BridgeSocket, dst: BridgeSocket, isUp: boolean): Promise<void> =>
    new Promise((resolve) => {
      const onData = (chunk: Buffer): void => {
        let out: Buffer
        try {
          out = isUp
            ? ctx.tgEnc.update(Buffer.from(ctx.cltDec.update(Buffer.from(chunk))))
            : ctx.cltEnc.update(Buffer.from(ctx.tgDec.update(Buffer.from(chunk))))
        } catch {
          resolve()
          return
        }
        if (isUp) counters.bytesUp += chunk.length
        else counters.bytesDown += chunk.length
        try {
          if (!dst.destroyed) dst.write(out)
        } catch {
          resolve()
        }
      }
      const done = (): void => {
        src.removeListener('data', onData)
        resolve()
      }
      src.on('data', onData)
      src.once('close', done)
      src.once('error', done)
    })
  const both = Promise.race([forward(io, remote, true), forward(remote, io, false)])
  // `forward` attached synchronously above — resume now to redeliver anything
  // buffered while the TCP dial was in flight (see readTcpExactly).
  try {
    io.resume()
    remote.resume()
  } catch {
    /* ignore */
  }
  await both
  try {
    remote.destroy()
  } catch {
    /* ignore */
  }
  try {
    teardown()
  } catch {
    /* ignore */
  }
}

function connectTcp(host: string, port: number, timeoutMs: number, highWaterMark = 0): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    // See RawWebSocket.connect: HWM options are cast (same @types gap).
    const s =
      highWaterMark > 0
        ? new net.Socket({
            readableHighWaterMark: highWaterMark,
            writableHighWaterMark: highWaterMark
          } as net.SocketConstructorOpts)
        : new net.Socket()
    s.setNoDelay(true)
    const timer = setTimeout(() => {
      s.destroy()
      reject(new Error(`TCP connect to ${host}:${port} timed out`))
    }, timeoutMs)
    timer.unref?.()
    s.once('connect', () => {
      clearTimeout(timer)
      resolve(s)
    })
    s.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    s.connect({ host, port })
  })
}

async function cfProxyFallback(io: BridgeSocket, relayInit: Buffer, ctx: CryptoCtx, splitter: MsgSplitter | null, label: string, dc: number, isMedia: boolean, teardown: () => void): Promise<boolean> {
  const mediaTag = isMedia ? ' media' : ''
  info('tg-proxy', `[${label}] DC${dc}${mediaTag} -> trying CF proxy`)
  for (const base of balancer.getDomainsForDc(dc)) {
    const domain = `kws${dc}.${base}`
    try {
      const ws = await RawWebSocket.connect(domain, domain, CF_CONNECT_TIMEOUT_MS, TG_PROXY_WS_PATH, undefined, activeHwm > 0 ? activeHwm : undefined)
      if (balancer.updateDomainForDc(dc, base)) info('tg-proxy', `[${label}] Switched active CF domain`)
      counters.cf += 1
      await ws.send(Buffer.from(relayInit))
      // Await the session like upstream (`do_fallback` runs the bridge to
      // completion): returning early would let `handleClient`'s finally
      // destroy the still-live client socket, killing every fallback session.
      await bridgeWs(io, ws, ctx, splitter, label, dc, isMedia, teardown).catch(() => undefined)
      return true
    } catch (e) {
      warn('tg-proxy', `[${label}] DC${dc}${mediaTag} CF proxy failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    }
  }
  return false
}

/**
 * Cloudflare Worker fallback (`--cfproxy-worker-domain`): the worker relays
 * to `dst` itself, so we open WS straight to the worker with
 * `/apiws?dst=<ip>&dc=<n>` (mirrors `_cfproxy_worker_fallback`, no splitting).
 */
async function cfWorkerFallback(
  io: BridgeSocket,
  relayInit: Buffer,
  ctx: CryptoCtx,
  label: string,
  dc: number,
  isMedia: boolean,
  fallbackDst: string,
  teardown: () => void
): Promise<boolean> {
  const mediaTag = isMedia ? ' media' : ''
  const path = buildCfWorkerPath(fallbackDst, dc)
  for (const workerDomain of shuffled(activeWorkerDomains)) {
    info('tg-proxy', `[${label}] DC${dc}${mediaTag} -> trying CF worker ${workerDomain} for ${fallbackDst}`)
    try {
      const ws = await RawWebSocket.connect(workerDomain, workerDomain, CF_CONNECT_TIMEOUT_MS, path, undefined, activeHwm > 0 ? activeHwm : undefined)
      counters.cf += 1
      await ws.send(Buffer.from(relayInit))
      // Same as CF-proxy above: the bridge must run to completion here.
      await bridgeWs(io, ws, ctx, null, label, dc, isMedia, teardown).catch(() => undefined)
      return true
    } catch (e) {
      warn('tg-proxy', `[${label}] DC${dc}${mediaTag} CF worker failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    }
  }
  return false
}

async function tcpFallback(io: BridgeSocket, relayInit: Buffer, ctx: CryptoCtx, label: string, dc: number, isMedia: boolean, dst: string, teardown: () => void): Promise<boolean> {
  const mediaTag = isMedia ? ' media' : ''
  info('tg-proxy', `[${label}] DC${dc}${mediaTag} -> TCP fallback to ${dst}:443`)
  try {
    const remote = await connectTcp(dst, 443, TCP_FALLBACK_TIMEOUT_MS, activeHwm)
    counters.tcpFallback += 1
    remote.write(Buffer.from(relayInit))
    // Same as CF-proxy above: the bridge must run to completion here.
    await bridgeTcp(io, remote, ctx, teardown).catch(() => undefined)
    return true
  } catch (e) {
    warn('tg-proxy', `[${label}] TCP fallback to ${dst}:443 failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    return false
  }
}

/** Fallback chain: CF-worker → CF-proxy → direct TCP (mirrors `do_fallback`). */
async function doFallback(
  io: BridgeSocket,
  client: net.Socket,
  relayInit: Buffer,
  ctx: CryptoCtx,
  splitter: MsgSplitter | null,
  label: string,
  dc: number,
  isTestDc: boolean,
  isMedia: boolean
): Promise<boolean> {
  const teardown = (): void => destroyClient(client)
  const ipTable = isTestDc ? TG_PROXY_DC_TEST_IPS : TG_PROXY_DC_FALLBACK_IPS
  const dst = ipTable[dc]
  if (activeWorkerDomains.length > 0 && dst) {
    if (await cfWorkerFallback(io, relayInit, ctx, label, dc, isMedia, dst, teardown)) return true
  }
  if (cfEnabled && !isTestDc) {
    if (await cfProxyFallback(io, relayInit, ctx, splitter, label, dc, isMedia, teardown)) return true
  }
  if (dst) {
    if (await tcpFallback(io, relayInit, ctx, label, dc, isMedia, dst, teardown)) return true
  }
  return false
}

async function handleClient(client: net.Socket, secret: Buffer): Promise<void> {
  counters.total += 1
  counters.active += 1
  let label = `${client.remoteAddress ?? '?'}:${client.remotePort ?? '?'}`
  client.setNoDelay(true)
  const teardown = (): void => destroyClient(client)
  // Bad handshakes linger (drain) so scanners hang; everything else is
  // destroyed in `finally` (bridges already cleaned up — destroy is idempotent).
  let linger = false
  try {
    if (activeProxyProtocol) {
      // Behind nginx/haproxy: consume the `PROXY TCP4/6 ...` line first.
      try {
        const { line } = await readTcpLine(client, CLIENT_INIT_TIMEOUT_MS)
        const parsed = parseProxyV1Line(line)
        if (parsed) {
          label = parsed
          info('tg-proxy', `[${label}] PROXY protocol header accepted`)
        }
      } catch {
        return
      }
    }

    let handshake: Buffer | null = null
    // IO surface for the bridges: plain socket, or a FakeTLS record session.
    let io: BridgeSocket = client
    if (activeFakeTlsDomain !== '') {
      const first = await readTcpExactly(client, 1, CLIENT_INIT_TIMEOUT_MS).catch(() => null)
      if (!first) return
      if (first[0] === TLS_RECORD_HANDSHAKE) {
        const rest = await readTcpExactly(client, 4, CLIENT_INIT_TIMEOUT_MS).catch(() => null)
        if (!rest) return
        const recLen = rest.readUInt16BE(2)
        const body = await readTcpExactly(client, recLen, CLIENT_INIT_TIMEOUT_MS).catch(() => null)
        if (!body) return
        const hello = Buffer.concat([first, rest, body])
        const verified = verifyClientHello(hello, secret)
        if (!verified) {
          // Foreign probe — relay to the masking domain like the real site.
          linger = true
          await proxyToMaskingDomain(client, hello, activeFakeTlsDomain, label)
          return
        }
        info('tg-proxy', `[${label}] FakeTLS handshake accepted`)
        const session = new FakeTlsSession(client)
        client.write(buildServerHello(secret, verified.clientRandom, verified.sessionId))
        await waitDrain(client)
        session.start()
        handshake = await session.readExactly(HANDSHAKE_LEN, CLIENT_INIT_TIMEOUT_MS).catch(() => null)
        if (!handshake) return
        io = session
      } else {
        // Plain HTTP against a masking listener → redirect to the real site.
        linger = true
        try {
          client.write(
            `HTTP/1.1 301 Moved Permanently\r\nLocation: https://${activeFakeTlsDomain}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
          )
          await waitDrain(client)
        } catch {
          /* ignore */
        }
        return
      }
    } else {
      handshake = await readTcpExactly(client, HANDSHAKE_LEN, CLIENT_INIT_TIMEOUT_MS).catch(() => null)
      if (!handshake) return
    }
    const parsed = tryHandshake(handshake, secret)
    if (!parsed) {
      counters.bad += 1
      warn('tg-proxy', `[${label}] bad handshake (wrong secret or proto)`)
      // Drain like upstream so scanners hang instead of learning anything.
      linger = true
      client.resume()
      setTimeout(() => {
        if (!client.destroyed) destroyClient(client)
      }, 5000).unref?.()
      return
    }
    let dc = parsed.dcId
    const isTestDc = activeForceTestDc || dc >= 10000
    if (dc >= 10000) {
      info('tg-proxy', `[${label}] test DC${dc} -> DC${dc - 10000}`)
      dc -= 10000
    }
    const protoInt =
      parsed.protoTag.equals(PROTO_TAG_ABRIDGED)
        ? PROTO_ABRIDGED_INT
        : parsed.protoTag.equals(PROTO_TAG_INTERMEDIATE)
          ? PROTO_INTERMEDIATE_INT
          : PROTO_PADDED_INTERMEDIATE_INT
    const dcIdx = parsed.isMedia ? -dc : dc
    const relayInit = generateRelayInit(parsed.protoTag, dcIdx)
    const ctx = buildCryptoCtx(parsed.prekeyIv, secret, relayInit)
    const mediaTag = parsed.isMedia ? ' media' : ''
    const dcKey = `${dc}${isTestDc ? 't' : ''}${parsed.isMedia ? 'm' : ''}`
    // Custom `--dc-ip` targets override the built-ins (warmup included).
    const target = activeDcIps[dc] ?? TG_PROXY_DC_IPS[dc]
    const wsPath = isTestDc ? TG_PROXY_WS_PATH_TEST : TG_PROXY_WS_PATH
    const now = Date.now()
    let ws: RawWebSocket | null = null

    // Unknown DC, blacklisted WS or a cooling-down IP → straight to fallback.
    if (target === undefined) {
      info('tg-proxy', `[${label}] DC${dc} not in config -> fallback`)
    } else if (wsBlacklist.has(dcKey)) {
      info('tg-proxy', `[${label}] DC${dc}${mediaTag} WS blacklisted -> fallback`)
    } else if (!isTestDc && now < (ipFailUntil.get(target) ?? 0) && cfEnabled) {
      ws = wsPool.get(dc, parsed.isMedia)
      if (ws) info('tg-proxy', `[${label}] DC${dc}${mediaTag} WS IP cooling down, pool hit -> using WS`)
      else info('tg-proxy', `[${label}] DC${dc}${mediaTag} WS IP cooling down -> fallback`)
    } else if (!isTestDc) {
      ws = wsPool.get(dc, parsed.isMedia)
      if (ws) info('tg-proxy', `[${label}] DC${dc}${mediaTag} -> pool hit via ${target}`)
    }

    if (target !== undefined && !wsBlacklist.has(dcKey) && ws === null && (isTestDc || now >= (ipFailUntil.get(target) ?? 0) || !cfEnabled)) {
      const domains = wsDomains(dc, parsed.isMedia)
      const timeout = now < (dcFailUntil.get(dcKey) ?? 0) ? WS_FAIL_TIMEOUT_MS : WS_CONNECT_TIMEOUT_MS
      let failedRedirect = false
      let timedOut = false
      let allRedirects = true
      if (!isTestDc) {
        for (const domain of domains) {
          info('tg-proxy', `[${label}] DC${dc}${mediaTag} -> wss://${domain}${wsPath} via ${target}`)
          try {
            ws = await RawWebSocket.connect(target, domain, timeout, wsPath, undefined, activeHwm > 0 ? activeHwm : undefined)
            allRedirects = false
            break
          } catch (e) {
            if (e instanceof WsHandshakeError && e.isRedirect) {
              counters.wsErrors += 1
              failedRedirect = true
              warn('tg-proxy', `[${label}] DC${dc}${mediaTag} got ${e.statusCode} from relay -> ${e.location ?? '?'}`.slice(0, 300))
              continue
            }
            if (e instanceof WsConnectTimeout) {
              counters.wsErrors += 1
              timedOut = true
              warn('tg-proxy', `[${label}] DC${dc}${mediaTag} WS connect timed out via ${target}`)
              break
            }
            counters.wsErrors += 1
            allRedirects = false
            warn('tg-proxy', `[${label}] DC${dc}${mediaTag} WS connect failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
          }
        }
      } else {
        // Test DCs have no WS relays — go to TCP fallback below.
        ws = null
      }
      if (ws === null && !isTestDc) {
        if (timedOut && target) {
          ipFailUntil.set(target, now + IP_FAIL_COOLDOWN_MS)
          info('tg-proxy', `[${label}] DC${dc}${mediaTag} WS to ${target} timed out, cooldown 3600s`)
        }
        if (failedRedirect && allRedirects) {
          wsBlacklist.add(dcKey)
          warn('tg-proxy', `[${label}] DC${dc}${mediaTag} blacklisted for WS (all redirects)`)
        } else {
          dcFailUntil.set(dcKey, now + DC_FAIL_COOLDOWN_MS)
          info('tg-proxy', `[${label}] DC${dc}${mediaTag} WS failed, cooldown 60s`)
        }
      }
      if (ws !== null && target) ipFailUntil.delete(target)
    }

    if (ws === null) {
      let splitter: MsgSplitter | null = null
      try {
        splitter = new MsgSplitter(relayInit, protoInt)
      } catch {
        splitter = null
      }
      const ok = await doFallback(io, client, relayInit, ctx, splitter, label, dc, isTestDc, parsed.isMedia)
      if (!ok) {
        warn('tg-proxy', `[${label}] DC${dc}${mediaTag} no fallback available`)
        return
      }
      info('tg-proxy', `[${label}] DC${dc}${mediaTag} fallback closed`)
      return
    }

    counters.ws += 1
    if (target) wsPool.scheduleRefill(dc, parsed.isMedia, target, wsDomains(dc, parsed.isMedia))
    let splitter: MsgSplitter | null = null
    try {
      splitter = new MsgSplitter(relayInit, protoInt)
    } catch {
      splitter = null
    }
    await ws.send(Buffer.from(relayInit))
    await bridgeWs(io, ws, ctx, splitter, label, dc, parsed.isMedia, teardown)
  } catch (e) {
    err('tg-proxy', `[${label}] unexpected: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500))
  } finally {
    counters.active = Math.max(0, counters.active - 1)
    if (!linger) {
      try {
        if (!client.destroyed) client.destroy()
      } catch {
        /* ignore */
      }
      clients.delete(client)
    }
  }
}

// ---------------------------------------------------------------------------
// Public lifecycle API (used by ipc-handlers / index.ts)
// ---------------------------------------------------------------------------

/**
 * Start the proxy listener. Resolves when the socket is bound.
 * @throws on invalid secret or when the port cannot be bound.
 */
export async function startTgProxy(opts: TgProxyStartOptions): Promise<{ host: string; port: number }> {
  const host = (opts.host ?? TG_PROXY_DEFAULT_HOST).trim() || TG_PROXY_DEFAULT_HOST
  const port = normalizeTgPort(opts.port)
  const secretHex = opts.secret.trim().toLowerCase()
  if (!isValidTgSecret(secretHex)) throw new Error('Invalid TG proxy secret — must be 32 hex characters')
  if (isTgProxyRunning()) {
    if (listenPort === port && listenHost === host) return { host, port }
    await stopTgProxy()
  }
  const secret = Buffer.from(secretHex, 'hex')
  cfEnabled = opts.cfProxyEnabled !== false
  activeDcIps = { ...(opts.dcIps ?? {}) }
  activePoolSize = opts.poolSize === undefined ? WS_POOL_SIZE : Math.max(0, Math.min(32, Math.floor(opts.poolSize)))
  activeHwm = opts.highWaterMark !== undefined && opts.highWaterMark > 0 ? Math.floor(opts.highWaterMark) : 0
  activeWorkerDomains = [...(opts.workerDomains ?? [])]
  activeFakeTlsDomain = (opts.fakeTlsDomain ?? '').trim().toLowerCase()
  activeForceTestDc = opts.forceTestDc === true
  activeProxyProtocol = opts.proxyProtocol === true
  Object.assign(counters, freshCounters())
  wsBlacklist.clear()
  dcFailUntil.clear()
  ipFailUntil.clear()
  wsPool.clear()

  const userCfDomains = [...(opts.cfDomains ?? [])]
  if (userCfDomains.length > 0) {
    // User domains win over the auto-refreshed pool (mirrors config.py).
    balancer.updateDomainsList(userCfDomains)
    if (cfRefreshTimer) {
      clearInterval(cfRefreshTimer)
      cfRefreshTimer = null
    }
  } else {
    balancer.updateDomainsList(defaultCfProxyDomains())
  }
  if (cfEnabled && userCfDomains.length === 0) {
    void refreshCfProxyDomains().catch(() => undefined)
    if (cfRefreshTimer) clearInterval(cfRefreshTimer)
    cfRefreshTimer = setInterval(() => {
      void refreshCfProxyDomains().catch(() => undefined)
    }, 3600 * 1000)
    cfRefreshTimer.unref?.()
  }

  const srv = net.createServer((client) => {
    clients.add(client)
    client.once('close', () => clients.delete(client))
    void handleClient(client, secret).catch((e: unknown) => {
      err('tg-proxy', `client handler failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    })
  })
  srv.on('error', (e: Error) => {
    lastError = e.message.slice(0, 300)
    err('tg-proxy', `listener error: ${lastError}`)
  })
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(port, host, () => {
      srv.removeListener('error', reject)
      resolve()
    })
  }).catch((e: unknown) => {
    lastError = e instanceof Error ? e.message : String(e)
    throw new Error(`Cannot listen on ${host}:${port} — ${lastError}`.slice(0, 300))
  })

  server = srv
  running = true
  listenHost = host
  listenPort = (srv.address() as net.AddressInfo | null)?.port ?? port
  startedAt = new Date().toISOString()
  lastError = null
  activeSecret = secretHex
  const linkHost = listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost
  info('tg-proxy', `Listening on ${listenHost}:${listenPort} (secret ${secretHex.slice(0, 6)}…). Connect: ${buildTgLink(linkHost, listenPort, secretHex, activeFakeTlsDomain)}`)
  info(
    'tg-proxy',
    `Target DCs: ${Object.entries({ ...TG_PROXY_DC_IPS, ...activeDcIps }).map(([dc, ip]) => `DC${dc}:${ip}`).join(', ')}. ` +
      `CF fallback: ${cfEnabled ? 'on' : 'off'}${activeFakeTlsDomain !== '' ? `, FakeTLS: ${activeFakeTlsDomain}` : ''}` +
      `${activeForceTestDc ? ', force-test-dc' : ''}${activeProxyProtocol ? ', proxy-protocol' : ''}`
  )
  // Pre-warm idle WS sockets in the background (best effort, never blocks).
  try {
    wsPool.warmup({ ...TG_PROXY_DC_IPS, ...activeDcIps })
  } catch {
    /* ignore */
  }
  return { host: listenHost, port: listenPort }
}

/** Stop the listener and drop all sessions (never throws). */
export async function stopTgProxy(): Promise<void> {
  if (cfRefreshTimer) {
    clearInterval(cfRefreshTimer)
    cfRefreshTimer = null
  }
  wsPool.clear()
  for (const c of [...clients]) {
    try {
      c.destroy()
    } catch {
      /* ignore */
    }
  }
  clients.clear()
  Object.assign(counters, freshCounters())
  const srv = server
  server = null
  running = false
  startedAt = null
  if (!srv) return
  await new Promise<void>((resolve) => {
    try {
      srv.close(() => resolve())
      setTimeout(resolve, 3000).unref?.()
    } catch {
      resolve()
    }
  })
  info('tg-proxy', 'Proxy stopped.')
}

/** Snapshot for the renderer/tray. Never throws. */
export function getTgProxyStatus(): { status: TgProxyStatus; stats: TgProxyStats } {
  const stats = getTgProxyStats()
  let status: TgProxyStatus = 'stopped'
  if (running && server !== null) status = 'running'
  else if (lastError) status = 'error'
  return { status, stats }
}

export function getTgProxyStats(): TgProxyStats {
  return {
    running: running && server !== null,
    host: listenHost,
    port: listenPort,
    connectionsTotal: counters.total,
    connectionsActive: counters.active,
    connectionsWs: counters.ws,
    connectionsTcpFallback: counters.tcpFallback,
    connectionsCf: counters.cf,
    connectionsBad: counters.bad,
    connectionsMasked: counters.masked,
    wsErrors: counters.wsErrors,
    bytesUp: counters.bytesUp,
    bytesDown: counters.bytesDown,
    startedAt,
    lastError
  }
}

/** Active secret (for the `tg://proxy` link). Empty when never started. */
export function getTgProxySecret(): string {
  return activeSecret
}
