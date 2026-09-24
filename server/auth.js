'use strict'

// ระบบ PIN: ใส่ PIN ครั้งเดียว มือถือจะจำไว้ 30 วัน
// เปลี่ยน APP_PIN เมื่อไหร่ ทุกเครื่องต้องใส่ PIN ใหม่

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const COOKIE_NAME = 'bw_session'
const MAX_AGE_SEC = 30 * 24 * 60 * 60
const MAX_FAILURES = 10
const LOCK_MS = 10 * 60 * 1000

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest()

function loadSecret (dataDir) {
  const file = path.join(dataDir, 'session.key')
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch (_) { /* สร้างใหม่ */ }
  const secret = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

function parseCookies (header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    try { out[key] = decodeURIComponent(value) } catch (_) { out[key] = value }
  }
  return out
}

function createAuth ({ pin, dataDir }) {
  const enabled = typeof pin === 'string' && pin.length > 0
  const key = sha256(loadSecret(dataDir) + ':' + (pin || ''))
  const pinHash = sha256(pin || '')
  const failures = new Map() // ip -> { count, first }

  const sign = value => crypto.createHmac('sha256', key).update(value).digest('base64url')

  function issueToken () {
    const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_SEC)
    return `${exp}.${sign(exp)}`
  }

  function verifyToken (token) {
    if (typeof token !== 'string') return false
    const [exp, sig] = token.split('.')
    if (!exp || !sig) return false
    const a = Buffer.from(sig)
    const b = Buffer.from(sign(exp))
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
    return Number(exp) > Date.now() / 1000
  }

  function isAuthed (req) {
    if (!enabled) return true
    return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME])
  }

  function checkPin (input) {
    return crypto.timingSafeEqual(sha256(input ?? ''), pinHash)
  }

  function isLocked (ip) {
    const f = failures.get(ip)
    if (!f) return false
    if (Date.now() - f.first > LOCK_MS) { failures.delete(ip); return false }
    return f.count >= MAX_FAILURES
  }

  function recordFailure (ip) {
    const now = Date.now()
    const f = failures.get(ip)
    if (!f || now - f.first > LOCK_MS) failures.set(ip, { count: 1, first: now })
    else f.count += 1
  }

  function clearFailures (ip) { failures.delete(ip) }

  function setSessionCookie (res) {
    res.append('Set-Cookie', `${COOKIE_NAME}=${issueToken()}; Max-Age=${MAX_AGE_SEC}; Path=/; HttpOnly; SameSite=Lax`)
  }

  function clearSessionCookie (res) {
    res.append('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
  }

  return {
    enabled,
    isAuthed,
    checkPin,
    isLocked,
    recordFailure,
    clearFailures,
    setSessionCookie,
    clearSessionCookie
  }
}

module.exports = { createAuth }
