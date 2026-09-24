'use strict'

// ทดสอบ API ทั้งหมดกับฐานข้อมูลชั่วคราว: npm test

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { createApp } = require('../server')

const PIN = '2468'
let ctx, server, base, dataDir
let cookie = ''

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-test-'))
  ctx = createApp({ dataDir, pin: PIN, log: { log () {}, error () {} } })
  await new Promise(resolve => { server = ctx.app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  ctx.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function call (method, url, body, { auth = true, csrf = true } = {}) {
  const headers = {}
  if (auth && cookie) headers.Cookie = cookie
  if (csrf) headers['X-Requested-With'] = 'bw'
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data, headers: res.headers }
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('ต้องใส่ PIN ก่อนใช้งาน', async () => {
  assert.equal((await call('GET', '/api/customers')).status, 401)
  const page = await call('GET', '/customer-list.html', undefined, { auth: false })
  assert.equal(page.status, 302)
  assert.match(page.headers.get('location'), /^\/login\.html\?next=/)
  assert.equal((await call('GET', '/login.html')).status, 200)
  assert.equal((await call('GET', '/healthz')).status, 200)
})

test('PIN ผิดถูกปฏิเสธ PIN ถูกได้ cookie', async () => {
  const bad = await call('POST', '/api/login', { pin: '0000' })
  assert.equal(bad.status, 401)
  const ok = await call('POST', '/api/login', { pin: PIN })
  assert.equal(ok.status, 200)
  const setCookie = ok.headers.get('set-cookie')
  assert.match(setCookie, /bw_session=/)
  assert.match(setCookie, /HttpOnly/)
  cookie = setCookie.split(';')[0]
  const me = await call('GET', '/api/me')
  assert.deepEqual(me.data, { authenticated: true, authRequired: true })
})

test('คำสั่งแก้ข้อมูลต้องมี header กัน CSRF', async () => {
  const res = await call('POST', '/api/customers', { name: 'x' }, { csrf: false })
  assert.equal(res.status, 403)
})

test('เพิ่มลูกค้า ค้นหา และเปิดดู', async () => {
  const noName = await call('POST', '/api/customers', { phone: '1' })
  assert.equal(noName.status, 400)

  const a = await call('POST', '/api/customers', {
    name: 'สมชาย ใจดี', phone: '080-111-2222', date: '2026-01-15', age: '40',
    r_sph: '-1.25', l_sph: '-1.50', detail: 'บรรทัดแรก\nบรรทัดสอง', frame: 'A1', lens: 'Blue', price: '1,500', deposit: 500
  })
  assert.equal(a.status, 201)
  const b = await call('POST', '/api/customers', { name: 'มานี', phone: '0899999999', price: 800, deposit: 800 })
  assert.equal(b.status, 201)

  const got = await call('GET', `/api/customers/${a.data.id}`)
  assert.equal(got.data.customer.price, 1500)
  assert.equal(got.data.customer.remain, 1000)
  assert.equal(got.data.customer.detail, 'บรรทัดแรก\nบรรทัดสอง')

  const noDate = await call('GET', `/api/customers/${b.data.id}`)
  assert.equal(noDate.data.customer.date, today(), 'ไม่กรอกวันที่ = วันนี้')

  const byName = await call('GET', '/api/customers?search=' + encodeURIComponent('สมชาย'))
  assert.equal(byName.data.total, 1)
  const byPhoneDigits = await call('GET', '/api/customers?search=0801112222')
  assert.equal(byPhoneDigits.data.total, 1, 'ค้นเบอร์แบบไม่มีขีดก็เจอ')
  const all = await call('GET', '/api/customers')
  assert.equal(all.data.total, 2)
  assert.equal(all.data.rows[0].visit_count, 1)
})

test('บันทึกครั้งใหม่ แก้ไขครั้งนั้น และลบครั้งนั้น', async () => {
  const list = await call('GET', '/api/customers?search=' + encodeURIComponent('สมชาย'))
  const id = list.data.rows[0].id

  const v = await call('POST', `/api/customers/${id}/visits`, {
    name: 'สมชาย ใจดี', phone: '080-111-2222', age: '41', date: '2026-02-01', r_sph: '-1.75', price: 2000, deposit: 0
  })
  assert.equal(v.status, 201)
  assert.equal(v.data.parent_id, id)

  // บันทึกครั้งใหม่จากรหัสของครั้งที่ 2 ต้องผูกกับลูกค้าคนเดิม (ไม่ซ้อนชั้น)
  const v3 = await call('POST', `/api/customers/${v.data.id}/visits`, { name: 'สมชาย ใจดี', date: '2026-03-01', price: 100 })
  assert.equal(v3.data.parent_id, id)

  const visits = await call('GET', `/api/customers/${v.data.id}/visits`)
  assert.equal(visits.data.customer.id, id)
  assert.equal(visits.data.visits.length, 3)
  assert.equal(visits.data.customer.age, '41', 'อัปเดตข้อมูลส่วนตัวของลูกค้าหลัก')
  assert.equal(visits.data.customer.date, '2026-01-15', 'วันที่ครั้งแรกไม่เปลี่ยน')

  // แก้ไขครั้งที่ 1: รายละเอียดต้องไม่หาย (บั๊กเดิม)
  const first = visits.data.visits[0]
  const upd = await call('PUT', `/api/visits/${first.id}`, { ...first, price: 1800, deposit: 800 })
  assert.equal(upd.status, 200)
  const after1 = (await call('GET', `/api/visits/${first.id}`)).data.visit
  assert.equal(after1.detail, 'บรรทัดแรก\nบรรทัดสอง')
  assert.equal(after1.remain, 1000)
  const second = (await call('GET', `/api/visits/${v.data.id}`)).data.visit
  assert.equal(second.price, 2000, 'แก้ครั้งที่ 1 ต้องไม่กระทบครั้งที่ 2')

  // ครั้งแรกลบจากหน้านี้ไม่ได้ ครั้งอื่นลบได้
  assert.equal((await call('DELETE', `/api/visits/${first.id}`)).status, 400)
  assert.equal((await call('DELETE', `/api/visits/${v3.data.id}`)).status, 200)
  const listAfter = await call('GET', '/api/customers?search=' + encodeURIComponent('สมชาย'))
  assert.equal(listAfter.data.rows[0].visit_count, 2)
})

test('แก้ข้อมูลส่วนตัว', async () => {
  const id = (await call('GET', '/api/customers?search=' + encodeURIComponent('มานี'))).data.rows[0].id
  const res = await call('PUT', `/api/customers/${id}`, { name: 'มานี มีนา', phone: '0899999999', date: '2026-04-01' })
  assert.equal(res.status, 200)
  const c = (await call('GET', `/api/customers/${id}`)).data.customer
  assert.equal(c.name, 'มานี มีนา')
  assert.equal(c.date, '2026-04-01')
  assert.equal((await call('PUT', '/api/customers/99999', { name: 'x' })).status, 404)
})

test('ยอดขายตามช่วงวันที่ และแดชบอร์ด', async () => {
  const jan = await call('GET', '/api/sales?from=2026-01-01&to=2026-01-31')
  assert.equal(jan.data.count, 1)
  assert.equal(jan.data.total, 1800)
  const swapped = await call('GET', '/api/sales?from=2026-12-31&to=2026-01-01')
  assert.equal(swapped.data.from, '2026-01-01')
  assert.equal((await call('GET', '/api/sales?from=2026-02-30&to=2026-03-01')).status, 400)

  const daily = await call('GET', '/api/sales/daily?from=2026-01-01&to=2026-12-31')
  assert.deepEqual(daily.data.rows.map(r => r.date), ['2026-01-15', '2026-02-01', '2026-04-01'])

  const d = (await call('GET', '/api/dashboard')).data
  assert.equal(d.dates.today, today())
  assert.equal(d.totals.orders, 3)
  assert.equal(d.totals.revenue, 1800 + 2000 + 800)
  assert.equal(d.pending.amount, 1000 + 2000)
  assert.equal(d.pending.count, 2)
  assert.equal(d.paidCount, 1)

  const recent = await call('GET', '/api/recent?limit=2')
  assert.equal(recent.data.rows.length, 2)
})

test('ส่งออก CSV / Excel และสำรองข้อมูล', async () => {
  const csv = await call('GET', '/api/export/csv')
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="banwaenraikhing_\d{4}-\d{2}-\d{2}\.csv"/)
  // fetch().text() ตัด BOM ออกให้ ต้องเช็กจาก byte จริง (Excel ต้องมี BOM ถึงจะอ่านภาษาไทยถูก)
  const raw = Buffer.from(await (await fetch(base + '/api/export/csv', { headers: { Cookie: cookie } })).arrayBuffer())
  assert.deepEqual([...raw.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  assert.ok(csv.data.startsWith('"ลำดับ","วันที่","ชื่อ"'))
  assert.equal(csv.data.trim().split('\r\n').length, 1 + 3)

  const xls = await call('GET', '/api/export/xls')
  assert.match(xls.data, /<Data ss:Type="Number">1800<\/Data>/)

  const res = await fetch(base + '/api/backup/download', { headers: { Cookie: cookie } })
  assert.equal(res.status, 200)
  const buf = Buffer.from(await res.arrayBuffer())
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3')
  const file = path.join(dataDir, 'check.db')
  fs.writeFileSync(file, buf)
  const copy = new DatabaseSync(file)
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 3)
  copy.close()
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'tmp')), [], 'ไฟล์ชั่วคราวถูกลบแล้ว')

  const json = await call('GET', '/api/backup/json')
  assert.match(json.headers.get('content-disposition'), /attachment; filename="banwaenraikhing_backup_.*\.json"/)
  assert.equal(json.data.count, 3)
  assert.equal(json.data.customers.length, 3)

  const name = ctx.backups.backupNow()
  const status = await call('GET', '/api/backup/status')
  assert.equal(status.data.latest.name, name)
})

test('ลบลูกค้าแล้วประวัติทุกครั้งหายไปด้วย', async () => {
  const id = (await call('GET', '/api/customers?search=' + encodeURIComponent('สมชาย'))).data.rows[0].id
  const res = await call('DELETE', `/api/customers/${id}`)
  assert.equal(res.data.deleted, 2)
  const d = (await call('GET', '/api/dashboard')).data
  assert.equal(d.totals.orders, 1)
  assert.equal((await call('GET', `/api/customers/${id}`)).status, 404)
})

test('ใส่ PIN ผิดเกิน 10 ครั้งถูกล็อก', async () => {
  let last
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/login', { pin: 'wrong' }, { auth: false })
  assert.equal(last.status, 429)
})

test('เปิดไฟล์ .db ของเวอร์ชันเดิมได้ และคอลัมน์ครบ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-old-'))
  const old = new DatabaseSync(path.join(dir, 'banwaenraikhing.db'))
  old.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, date TEXT, price REAL)')
  old.exec("INSERT INTO customers (name, date, price) VALUES ('เก่า', '2025-05-05', 99)")
  old.close()
  const c = createApp({ dataDir: dir, pin: '', log: { log () {}, error () {} } })
  const cols = c.db.prepare('PRAGMA table_info(customers)').all().map(r => r.name)
  for (const col of ['parent_id', 'r_sph', 'l_pd', 'detail', 'deposit', 'remain']) assert.ok(cols.includes(col), col)
  assert.equal(c.db.prepare('SELECT name FROM customers').get().name, 'เก่า')
  c.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
