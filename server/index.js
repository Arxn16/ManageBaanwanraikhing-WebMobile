'use strict'

// บ้านแว่นไร่ขิง — เซิร์ฟเวอร์สำหรับใช้ภายในร้าน
// มือถือหรือคอมที่ต่อ Wi-Fi วงเดียวกัน เปิดผ่านเบราว์เซอร์ได้เลย

process.env.TZ = process.env.TZ || 'Asia/Bangkok'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const express = require('express')

const { openDatabase, transaction, TEXT_FIELDS, PERSONAL_FIELDS, RX_FIELDS, ORDER_FIELDS } = require('./db')
const { createAuth } = require('./auth')
const { createBackupManager } = require('./backup')
const { buildCsv, buildExcelXml } = require('./export')
const dates = require('./dates')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const VISIT_FIELDS = ['date', ...RX_FIELDS, ...ORDER_FIELDS]
const PERSONAL_KEEP_DATE = PERSONAL_FIELDS.filter(k => k !== 'date')
const setList = fields => fields.map(f => `${f} = ?`).join(', ')

// ---------- ตัวช่วย ----------

function httpError (status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function text (v, max = 2000) {
  if (v === null || v === undefined) return ''
  return String(v).trim().slice(0, max)
}

const round2 = n => Math.round(n * 100) / 100

function money (v) {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? round2(n) : 0
}

function intParam (v, fallback) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function idParam (v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'รหัสไม่ถูกต้อง')
  return n
}

const likeTerm = s => '%' + s.replace(/[\\%_]/g, m => '\\' + m) + '%'

function pickText (body, fields) {
  const out = {}
  for (const f of fields) out[f] = text(body[f])
  return out
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

// ช่องที่ไม่ได้ส่งมา = ใช้ค่าเดิม (ช่องที่ส่งมาเป็นค่าว่าง = ล้างค่า)
function mergeText (existing, body, fields) {
  const out = {}
  for (const f of fields) out[f] = has(body, f) ? text(body[f]) : text(existing ? existing[f] : '')
  return out
}

const mergeMoney = (existing, body, key) => (has(body, key) ? money(body[key]) : money(existing ? existing[key] : 0))

function lanAddresses () {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address)
    }
  }
  return out
}

// ---------- แอป ----------

function createApp (options = {}) {
  const log = options.log || console
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'))
  const dbFile = path.join(dataDir, 'banwaenraikhing.db')
  const db = openDatabase(dbFile)
  const pin = options.pin !== undefined ? options.pin : (process.env.APP_PIN || '')
  const auth = createAuth({ pin: String(pin).trim(), dataDir })
  const backups = createBackupManager({
    db,
    dataDir,
    keep: clamp(intParam(process.env.BACKUP_KEEP, 30), 1, 3650),
    intervalHours: clamp(intParam(process.env.BACKUP_INTERVAL_HOURS, 24), 1, 24 * 30),
    log
  })

  const SEARCH_WHERE = `(
    COALESCE(c.name, '') LIKE ? ESCAPE '\\'
    OR COALESCE(c.phone, '') LIKE ? ESCAPE '\\'
    OR (? <> '' AND REPLACE(REPLACE(COALESCE(c.phone, ''), '-', ''), ' ', '') LIKE ? ESCAPE '\\')
  )`

  const q = {
    byId: db.prepare('SELECT * FROM customers WHERE id = ?'),
    countRoots: db.prepare(`SELECT COUNT(*) AS count FROM customers c WHERE c.parent_id IS NULL AND ${SEARCH_WHERE}`),
    listRoots: db.prepare(`
      SELECT c.id, c.date, c.name, c.phone, c.price, c.remain,
             (SELECT COUNT(*) FROM customers v WHERE v.parent_id = c.id) + 1 AS visit_count
      FROM customers c
      WHERE c.parent_id IS NULL AND ${SEARCH_WHERE}
      ORDER BY c.id ASC
      LIMIT ? OFFSET ?`),
    insert: db.prepare(`
      INSERT INTO customers (parent_id, ${TEXT_FIELDS.join(', ')}, price, deposit, remain)
      VALUES (?, ${TEXT_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)`),
    updatePersonal: db.prepare(`UPDATE customers SET ${setList(PERSONAL_FIELDS)} WHERE id = ?`),
    updatePersonalKeepDate: db.prepare(`UPDATE customers SET ${setList(PERSONAL_KEEP_DATE)} WHERE id = ?`),
    updateVisit: db.prepare(`
      UPDATE customers SET
        date = ?, price = ?, deposit = ?, remain = ?,
        ${setList([...RX_FIELDS, ...ORDER_FIELDS])}
      WHERE id = ?`),
    visitsOf: db.prepare('SELECT * FROM customers WHERE id = ? OR parent_id = ? ORDER BY date ASC, id ASC'),
    deleteById: db.prepare('DELETE FROM customers WHERE id = ?'),
    deleteChildren: db.prepare('DELETE FROM customers WHERE parent_id = ?'),
    sumRange: db.prepare('SELECT COALESCE(SUM(price), 0) AS total, COUNT(*) AS count FROM customers WHERE date BETWEEN ? AND ?'),
    pending: db.prepare('SELECT COALESCE(SUM(remain), 0) AS total, COUNT(*) AS count FROM customers WHERE remain > 0'),
    totals: db.prepare(`
      SELECT COALESCE(SUM(price), 0) AS revenue,
             COALESCE(SUM(COALESCE(price, 0) - COALESCE(remain, 0)), 0) AS paid,
             COALESCE(SUM(remain), 0) AS remain,
             COUNT(*) AS orders
      FROM customers`),
    salesRange: db.prepare(`
      SELECT id, parent_id, date, name, phone, price, deposit, remain
      FROM customers WHERE date BETWEEN ? AND ?
      ORDER BY date DESC, id DESC`),
    daily: db.prepare(`
      SELECT date, COUNT(*) AS count, COALESCE(SUM(price), 0) AS total
      FROM customers WHERE date BETWEEN ? AND ?
      GROUP BY date ORDER BY date ASC`),
    recent: db.prepare('SELECT id, parent_id, name, phone, date, price FROM customers ORDER BY date DESC, id DESC LIMIT ?'),
    exportAll: db.prepare('SELECT * FROM customers ORDER BY id ASC'),
    exportRange: db.prepare('SELECT * FROM customers WHERE date BETWEEN ? AND ? ORDER BY id ASC')
  }

  function mustGet (id, label = 'ข้อมูลลูกค้า') {
    const row = q.byId.get(id)
    if (!row) throw httpError(404, `ไม่พบ${label}`)
    return row
  }

  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
  })

  app.get('/healthz', (req, res) => {
    db.prepare('SELECT 1 AS ok').get()
    res.json({ ok: true })
  })

  app.use('/api', express.json({ limit: '256kb' }))

  // กันเว็บอื่นยิงคำสั่งแก้ข้อมูลแทนผู้ใช้ (CSRF)
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    if (req.get('X-Requested-With') !== 'bw') return res.status(403).json({ error: 'คำขอไม่ถูกต้อง' })
    next()
  })

  // ---------- เข้าสู่ระบบ ----------

  app.get('/api/me', (req, res) => {
    res.json({ authenticated: auth.isAuthed(req), authRequired: auth.enabled })
  })

  app.post('/api/login', (req, res) => {
    if (!auth.enabled) return res.json({ ok: true })
    const ip = req.socket.remoteAddress || 'unknown'
    if (auth.isLocked(ip)) {
      return res.status(429).json({ error: 'ใส่ PIN ผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่' })
    }
    const input = text((req.body || {}).pin, 100)
    if (!auth.checkPin(input)) {
      auth.recordFailure(ip)
      setTimeout(() => res.status(401).json({ error: 'PIN ไม่ถูกต้อง' }), 400)
      return
    }
    auth.clearFailures(ip)
    auth.setSessionCookie(res)
    res.json({ ok: true })
  })

  app.post('/api/logout', (req, res) => {
    auth.clearSessionCookie(res)
    res.json({ ok: true })
  })

  app.use('/api', (req, res, next) => {
    if (auth.isAuthed(req)) return next()
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' })
  })

  // ---------- ลูกค้า ----------

  app.get('/api/customers', (req, res) => {
    const search = text(req.query.search, 100)
    const term = likeTerm(search)
    const digits = search.replace(/\D/g, '')
    const digitsTerm = digits ? likeTerm(digits) : ''
    const where = [term, term, digits, digitsTerm]
    const limit = clamp(intParam(req.query.limit, 10), 1, 100)
    const total = Number(q.countRoots.get(...where).count)
    const pages = Math.max(1, Math.ceil(total / limit))
    const page = clamp(intParam(req.query.page, 1), 1, pages)
    const offset = (page - 1) * limit
    const rows = q.listRoots.all(...where, limit, offset)
    res.json({ total, page, pages, limit, offset, rows })
  })

  app.post('/api/customers', (req, res) => {
    const body = req.body || {}
    const f = pickText(body, TEXT_FIELDS)
    if (!f.name) throw httpError(400, 'กรุณากรอกชื่อลูกค้า')
    if (!f.date) f.date = dates.ranges().today
    const price = money(body.price)
    const deposit = money(body.deposit)
    const info = q.insert.run(null, ...TEXT_FIELDS.map(k => f[k]), price, deposit, round2(price - deposit))
    res.status(201).json({ id: Number(info.lastInsertRowid) })
  })

  app.get('/api/customers/:id', (req, res) => {
    res.json({ customer: mustGet(idParam(req.params.id)) })
  })

  // แก้ข้อมูลส่วนตัว (เหมือนปุ่ม "อัพเดตข้อมูลส่วนตัว" เดิม)
  app.put('/api/customers/:id', (req, res) => {
    const id = idParam(req.params.id)
    const row = mustGet(id)
    const f = mergeText(row, req.body || {}, PERSONAL_FIELDS)
    if (!f.name) throw httpError(400, 'กรุณากรอกชื่อลูกค้า')
    q.updatePersonal.run(...PERSONAL_FIELDS.map(k => f[k]), id)
    res.json({ ok: true })
  })

  // ลบลูกค้า พร้อมประวัติการมาทุกครั้ง (เวอร์ชันเดิมลบแค่รายการแรก ประวัติที่เหลือค้างอยู่ในยอดขาย)
  app.delete('/api/customers/:id', (req, res) => {
    const id = idParam(req.params.id)
    const row = mustGet(id)
    const deleted = transaction(db, () => {
      let n = 0
      if (row.parent_id === null) n += Number(q.deleteChildren.run(id).changes)
      n += Number(q.deleteById.run(id).changes)
      return n
    })
    res.json({ deleted })
  })

  app.get('/api/customers/:id/visits', (req, res) => {
    const row = mustGet(idParam(req.params.id))
    const rootId = row.parent_id ?? row.id
    const root = rootId === row.id ? row : (q.byId.get(rootId) || row)
    res.json({ customer: root, visits: q.visitsOf.all(rootId, rootId) })
  })

  // บันทึกเป็นครั้งใหม่ (เหมือนปุ่ม "บันทึกเป็นครั้งใหม่" เดิม)
  app.post('/api/customers/:id/visits', (req, res) => {
    const row = mustGet(idParam(req.params.id))
    const rootId = row.parent_id ?? row.id
    const root = rootId === row.id ? row : q.byId.get(rootId)
    const body = req.body || {}
    // ข้อมูลส่วนตัวที่ไม่ได้ส่งมา ใช้ของลูกค้าคนเดิม / ค่าสายตาและราคาเป็นของครั้งใหม่
    const f = {
      ...mergeText(root || row, body, PERSONAL_KEEP_DATE),
      ...pickText(body, ['date', ...RX_FIELDS, ...ORDER_FIELDS])
    }
    if (!f.name) throw httpError(400, 'กรุณากรอกชื่อลูกค้า')
    if (!f.date) f.date = dates.ranges().today
    const price = money(body.price)
    const deposit = money(body.deposit)
    const id = transaction(db, () => {
      q.updatePersonalKeepDate.run(...PERSONAL_KEEP_DATE.map(k => f[k]), root ? root.id : row.id)
      const info = q.insert.run(rootId, ...TEXT_FIELDS.map(k => f[k]), price, deposit, round2(price - deposit))
      return Number(info.lastInsertRowid)
    })
    res.status(201).json({ id, parent_id: rootId })
  })

  // ---------- การมาแต่ละครั้ง ----------

  app.get('/api/visits/:id', (req, res) => {
    res.json({ visit: mustGet(idParam(req.params.id), 'ข้อมูลการมาครั้งนี้') })
  })

  app.put('/api/visits/:id', (req, res) => {
    const id = idParam(req.params.id)
    const row = mustGet(id, 'ข้อมูลการมาครั้งนี้')
    const body = req.body || {}
    const f = mergeText(row, body, VISIT_FIELDS)
    const price = mergeMoney(row, body, 'price')
    const deposit = mergeMoney(row, body, 'deposit')
    q.updateVisit.run(
      f.date, price, deposit, round2(price - deposit),
      ...RX_FIELDS.map(k => f[k]),
      ...ORDER_FIELDS.map(k => f[k]),
      id
    )
    res.json({ ok: true })
  })

  app.delete('/api/visits/:id', (req, res) => {
    const id = idParam(req.params.id)
    const row = mustGet(id, 'ข้อมูลการมาครั้งนี้')
    if (row.parent_id === null) {
      throw httpError(400, 'นี่คือการมาครั้งแรก ถ้าต้องการลบให้ลบที่ตัวลูกค้าแทน')
    }
    q.deleteById.run(id)
    res.json({ deleted: 1 })
  })

  // ---------- ยอดขาย ----------

  app.get('/api/dashboard', (req, res) => {
    const r = dates.ranges()
    const sum = (from, to) => {
      const x = q.sumRange.get(from, to)
      return { sales: x.total, count: Number(x.count) }
    }
    const pending = q.pending.get()
    const totals = q.totals.get()
    totals.orders = Number(totals.orders)
    res.json({
      dates: r,
      today: sum(r.today, r.today),
      week: sum(r.weekStart, r.weekEnd),
      month: sum(r.monthStart, r.monthEnd),
      year: sum(r.yearStart, r.yearEnd),
      pending: { amount: pending.total, count: Number(pending.count) },
      paidCount: totals.orders - Number(pending.count),
      totals
    })
  })

  function dateRange (query) {
    let from = text(query.from, 10)
    let to = text(query.to, 10)
    if (!dates.isISODate(from) || !dates.isISODate(to)) throw httpError(400, 'ช่วงวันที่ไม่ถูกต้อง')
    if (from > to) [from, to] = [to, from]
    return [from, to]
  }

  app.get('/api/sales', (req, res) => {
    const [from, to] = dateRange(req.query)
    const rows = q.salesRange.all(from, to)
    const total = round2(rows.reduce((s, r) => s + (Number(r.price) || 0), 0))
    const remain = round2(rows.reduce((s, r) => s + (Number(r.remain) || 0), 0))
    res.json({ from, to, count: rows.length, total, remain, rows })
  })

  app.get('/api/sales/daily', (req, res) => {
    const [from, to] = dateRange(req.query)
    res.json({ from, to, rows: q.daily.all(from, to).map(r => ({ ...r, count: Number(r.count) })) })
  })

  app.get('/api/recent', (req, res) => {
    res.json({ rows: q.recent.all(clamp(intParam(req.query.limit, 5), 1, 50)) })
  })

  // ---------- ส่งออก / สำรองข้อมูล ----------

  function exportRecords (query) {
    if (query.from && query.to) {
      const [from, to] = dateRange(query)
      return q.exportRange.all(from, to)
    }
    return q.exportAll.all()
  }

  app.get('/api/export/csv', (req, res) => {
    const body = buildCsv(exportRecords(req.query))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="banwaenraikhing_${dates.ranges().today}.csv"`)
    res.send(body)
  })

  app.get('/api/export/xls', (req, res) => {
    const body = buildExcelXml(exportRecords(req.query))
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="banwaenraikhing_${dates.ranges().today}.xls"`)
    res.send(body)
  })

  app.get('/api/backup/status', (req, res) => {
    const list = backups.list()
    const latest = list[0] ? { name: list[0].name, time: list[0].time, size: list[0].size } : null
    res.json({ latest, count: list.length, keep: backups.keep, intervalHours: backups.intervalHours })
  })

  app.get('/api/backup/download', (req, res, next) => {
    const file = backups.tempSnapshot()
    res.download(file, `banwaenraikhing_backup_${dates.stamp()}.db`, err => {
      fs.unlink(file, () => {})
      if (err && !res.headersSent) next(err)
    })
  })

  app.get('/api/backup/json', (req, res) => {
    const rows = q.exportAll.all()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="banwaenraikhing_backup_${dates.stamp()}.json"`)
    res.send(JSON.stringify({
      app: 'banwaenraikhing',
      version: 2,
      exportedAt: new Date().toISOString(),
      count: rows.length,
      customers: rows
    }, null, 2))
  })

  // ---------- หน้าเว็บ ----------

  // หน้าเว็บทุกหน้าต้องใส่ PIN ก่อน (ยกเว้นหน้า login และไฟล์ css/js/ไอคอน)
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api/')) return next()
    const ext = path.extname(req.path)
    const isPage = ext === '' || ext === '.html'
    if (!isPage || req.path === '/login.html' || req.path === '/login' || auth.isAuthed(req)) return next()
    res.redirect(302, '/login.html?next=' + encodeURIComponent(req.originalUrl))
  })

  app.get('/dashboard.html', (req, res) => res.redirect(301, '/'))

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders (res, file) {
      if (file.endsWith('.html') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache')
    }
  }))

  app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API นี้' }))
  app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('ไม่พบหน้านี้'))

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500
    let message = err.message
    if (err.type === 'entity.parse.failed') { status = 400; message = 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }
    if (err.type === 'entity.too.large') { status = 413; message = 'ข้อมูลใหญ่เกินไป' }
    if (status >= 500) {
      log.error(err)
      message = 'เกิดข้อผิดพลาดในระบบ'
    }
    if (res.headersSent) return
    res.status(status).json({ error: message })
  })

  return {
    app,
    db,
    auth,
    backups,
    dataDir,
    dbFile,
    close () { try { db.close() } catch (_) { /* ignore */ } }
  }
}

// ---------- เริ่มระบบ ----------

if (require.main === module) {
  const ctx = createApp()
  const port = intParam(process.env.PORT, 3000)
  const server = ctx.app.listen(port, '0.0.0.0', () => {
    const inDocker = fs.existsSync('/.dockerenv')
    console.log('บ้านแว่นไร่ขิง พร้อมใช้งานแล้ว')
    console.log(`- ฐานข้อมูล: ${ctx.dbFile}`)
    if (inDocker) {
      console.log(`- เปิดจากมือถือ: http://<IP ของเครื่องที่รัน Docker>:${port}`)
    } else {
      console.log(`- เครื่องนี้: http://localhost:${port}`)
      for (const ip of lanAddresses()) console.log(`- มือถือ (Wi-Fi เดียวกัน): http://${ip}:${port}`)
    }
    if (ctx.auth.enabled) {
      console.log('- PIN: เปิดใช้งาน')
      if (/^(1234|0000|123456)$/.test(String(process.env.APP_PIN || '').trim())) {
        console.log('  ⚠️  PIN ยังเป็นค่าเริ่มต้น ควรเปลี่ยน APP_PIN ในไฟล์ .env')
      }
    } else {
      console.log('- ⚠️  ยังไม่ได้ตั้ง APP_PIN ทุกคนที่ต่อ Wi-Fi ร้านจะเปิดข้อมูลลูกค้าได้')
    }
  })
  ctx.backups.start()

  let closing = false
  const shutdown = signal => {
    if (closing) return
    closing = true
    console.log(`ได้รับ ${signal} กำลังปิดระบบ...`)
    server.close(() => {
      ctx.close()
      process.exit(0)
    })
    server.closeIdleConnections()
    setTimeout(() => { ctx.close(); process.exit(0) }, 5000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

module.exports = { createApp }
