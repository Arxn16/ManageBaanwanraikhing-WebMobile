'use strict'

// ทดสอบหน้ารายการค้างชำระ การรับชำระ และการแก้ปี พ.ศ. ในวันที่: npm test

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openDatabase } = require('../server/db')
const { normalize } = require('../server/import')
const { normalizeDate } = require('../server/dates')
const { createApp } = require('../server')

const PIN = '135790'
let ctx, server, base, dataDir, cookie = ''
const logs = []

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-pay-'))
  // ฐานข้อมูลเดิมที่มีวันที่เป็นปี พ.ศ. ปนอยู่
  const db = openDatabase(path.join(dataDir, 'banwaenraikhing.db'))
  const ins = db.prepare('INSERT INTO customers (name, date, price, deposit, remain) VALUES (?, ?, ?, ?, ?)')
  ins.run('ปี พ.ศ.', '2569-03-02', 1000, 1000, 0)
  ins.run('ปี ค.ศ.', '2026-03-03', 2000, 500, 1500)
  db.close()
  ctx = createApp({ dataDir, pin: PIN, log: { log: m => logs.push(String(m)), error () {} } })
  await new Promise(resolve => { server = ctx.app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bw' }, body: JSON.stringify({ pin: PIN }) })
  cookie = res.headers.get('set-cookie').split(';')[0]
})

after(() => {
  server.close()
  ctx.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function call (method, url, body) {
  const headers = { Cookie: cookie, 'X-Requested-With': 'bw' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, data: await res.json() }
}

test('แปลงวันที่ปี พ.ศ. เป็น ค.ศ.', () => {
  assert.equal(normalizeDate('2569-03-02'), '2026-03-02')
  assert.equal(normalizeDate('2026-03-02'), '2026-03-02')
  assert.equal(normalizeDate(''), '')
  assert.equal(normalizeDate('abc'), 'abc')
})

test('เปิดระบบแล้วแก้วันที่ปี พ.ศ. ที่บันทึกไว้เดิมให้เอง', () => {
  const row = ctx.db.prepare("SELECT date FROM customers WHERE name = 'ปี พ.ศ.'").get()
  assert.equal(row.date, '2026-03-02')
  assert.ok(logs.some(m => m.includes('1 รายการ')))
})

test('บันทึกลูกค้าและการมาครั้งใหม่ด้วยปี พ.ศ. ได้วันที่ ค.ศ.', async () => {
  const created = await call('POST', '/api/customers', { name: 'ใหม่', date: '2569-10-06', price: 3000, deposit: 1000 })
  assert.equal(created.status, 201)
  const { data } = await call('GET', `/api/customers/${created.data.id}`)
  assert.equal(data.customer.date, '2026-10-06')
  const visit = await call('POST', `/api/customers/${created.data.id}/visits`, { date: '2569-10-07', price: 500 })
  const put = await call('PUT', `/api/visits/${visit.data.id}`, { date: '2569-10-08' })
  assert.equal(put.status, 200)
  assert.equal((await call('GET', `/api/visits/${visit.data.id}`)).data.visit.date, '2026-10-08')
})

test('รายการค้างชำระแสดงเฉพาะที่ยังค้าง พร้อมยอดรวม', async () => {
  const { status, data } = await call('GET', '/api/pending')
  assert.equal(status, 200)
  assert.ok(data.rows.every(r => r.remain > 0))
  assert.equal(data.total, data.rows.reduce((s, r) => s + r.remain, 0))
  assert.ok(!data.rows.some(r => r.name === 'ปี พ.ศ.'))
})

test('รับชำระบางส่วน แล้วรับส่วนที่เหลือครบ', async () => {
  const id = ctx.db.prepare("SELECT id FROM customers WHERE name = 'ปี ค.ศ.'").get().id
  const part = await call('POST', `/api/visits/${id}/payment`, { amount: '1,000' })
  assert.equal(part.status, 200)
  assert.deepEqual([part.data.deposit, part.data.remain], [1500, 500])
  const over = await call('POST', `/api/visits/${id}/payment`, { amount: 600 })
  assert.equal(over.status, 400)
  const zero = await call('POST', `/api/visits/${id}/payment`, { amount: 0 })
  assert.equal(zero.status, 400)
  const full = await call('POST', `/api/visits/${id}/payment`, {})
  assert.equal(full.status, 200)
  assert.deepEqual([full.data.amount, full.data.deposit, full.data.remain], [500, 2000, 0])
  const again = await call('POST', `/api/visits/${id}/payment`, {})
  assert.equal(again.status, 400)
  const dash = await call('GET', '/api/dashboard')
  assert.equal(dash.data.pending.count, (await call('GET', '/api/pending')).data.count)
})

test('นำเข้าไฟล์ที่มีวันที่ปี พ.ศ. แปลงเป็น ค.ศ. และแจ้งเตือน', () => {
  const columns = [{ name: 'id', type: 'INTEGER' }, { name: 'parent_id', type: 'INTEGER' }, { name: 'name', type: 'TEXT' }, { name: 'date', type: 'TEXT' }, { name: 'price', type: 'REAL' }]
  const { records, warnings } = normalize([{ id: 1, name: 'ก', date: '2568-12-31', price: 100 }], columns)
  assert.equal(records[0].date, '2025-12-31')
  assert.ok(warnings.some(w => w.includes('ปี พ.ศ.')))
})
