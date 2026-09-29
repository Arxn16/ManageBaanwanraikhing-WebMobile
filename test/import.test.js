'use strict'

// ทดสอบคำสั่งนำเข้าข้อมูล (server/import.js): npm test

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { createApp } = require('../server')
const { prepareImport, applyImport, ImportError, main } = require('../server/import')

let dataDir, importDir, ctx, server, base

const silent = { log () {}, error () {} }

function importNow (file) {
  const plan = prepareImport({ dataDir, file })
  try {
    return { plan, ...applyImport(plan) }
  } finally {
    plan.db.close()
  }
}

async function apiTotal () {
  const res = await fetch(base + '/api/customers')
  return (await res.json()).total
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-import-'))
  importDir = path.join(dataDir, 'import')
  fs.mkdirSync(importDir)
  // ระบบที่เปิดอยู่ (ไม่ตั้ง PIN) มีข้อมูลเดิม 2 รายการ
  ctx = createApp({ dataDir, pin: '', log: silent })
  ctx.db.exec("INSERT INTO customers (name, date, price, deposit, remain) VALUES ('ลูกค้าเดิม', '2026-01-01', 100, 0, 100), ('ลูกค้าเดิม 2', '2026-01-02', 200, 200, 0)")
  await new Promise(resolve => { server = ctx.app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  ctx.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('นำเข้า JSON: แทนที่ข้อมูลเดิม เก็บ id/parent_id ตัดช่องว่าง และระบบที่เปิดอยู่เห็นทันที', async () => {
  assert.equal(await apiTotal(), 2)
  const file = path.join(importDir, 'export.json')
  fs.writeFileSync(file, JSON.stringify({
    customers: [
      { _id: { $oid: 'abc' }, id: 10, parent_id: null, name: '  ภูลกานต์  ', date: '2023-04-25', r_sph: '-7.50' + ' '.repeat(500), price: { $numberDouble: '14800' }, deposit: 14800, remain: 0 },
      { id: 11, parent_id: 10, name: 'ภูลกานต์', date: '2024-01-02', price: 500, deposit: 0, remain: 500 },
      { id: 12, parent_id: null, name: 'ไม่มีราคา', date: '2025-02-19', price: null, deposit: 1800, remain: null, color: 'x' }
    ]
  }))
  const { plan, backupFile } = importNow(file)
  assert.equal(plan.summary.total, 3)
  assert.equal(plan.summary.customers, 2)
  assert.equal(plan.summary.visits, 1)
  assert.equal(plan.lost, 2, 'ข้อมูลเดิม 2 รายการจะหายไป')
  assert.ok(plan.trimmed >= 2)
  assert.ok(plan.warnings.some(w => w.includes('ไม่มีราคา')))
  assert.ok(plan.warnings.some(w => w.includes('color')))

  // ข้อมูลเดิมถูกสำรองไว้ก่อน
  const backup = new DatabaseSync(backupFile, { readOnly: true })
  assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 2)
  backup.close()

  const rows = ctx.db.prepare('SELECT * FROM customers ORDER BY id').all()
  assert.deepEqual(rows.map(r => r.id), [10, 11, 12])
  assert.equal(rows[0].name, 'ภูลกานต์')
  assert.equal(rows[0].r_sph, '-7.50')
  assert.equal(rows[0].price, 14800)
  assert.equal(rows[1].parent_id, 10)
  assert.equal(rows[2].price, null)
  assert.equal(rows[0].disease, '', 'คอลัมน์ที่ไฟล์ไม่มี เป็นค่าว่าง')

  // ระบบที่เปิดอยู่เห็นข้อมูลใหม่โดยไม่ต้องรีสตาร์ต และเพิ่มลูกค้าใหม่ต่อจาก id สูงสุด
  assert.equal(await apiTotal(), 2)
  const visits = await (await fetch(base + '/api/customers/11/visits')).json()
  assert.equal(visits.customer.id, 10)
  assert.equal(visits.visits.length, 2)
  const created = await fetch(base + '/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bw' },
    body: JSON.stringify({ name: 'ลูกค้าใหม่' })
  })
  assert.equal((await created.json()).id, 13)
})

test('นำเข้าไฟล์ SQL dump ของ SQLite', () => {
  const file = path.join(importDir, 'dump.sql')
  fs.writeFileSync(file, `-- SQLite database dump
CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, name TEXT, date TEXT, price REAL, deposit REAL, remain REAL, frame TEXT);
INSERT INTO "customers" ("id", "parent_id", "name", "date", "price", "deposit", "remain", "frame") VALUES (1, NULL, 'กัลยา', '2025-07-04', 2000.0, 2000.0, 0.0, 'LEVI''S LV7104/F');
INSERT INTO "customers" ("id", "parent_id", "name", "date", "price", "deposit", "remain", "frame") VALUES (2, 1, 'กัลยา', '2025-08-01', 1800.0, 800.0, 1000.0, 'Polo');
`)
  const { plan } = importNow(file)
  assert.equal(plan.summary.total, 2)
  const rows = ctx.db.prepare('SELECT id, parent_id, frame, remain FROM customers ORDER BY id').all()
  assert.deepEqual(rows.map(r => [r.id, r.parent_id, r.frame, r.remain]), [[1, null, "LEVI'S LV7104/F", 0], [2, 1, 'Polo', 1000]])
  assert.throws(() => prepareImport({ dataDir, file: writeTmp('bad.sql', "ATTACH DATABASE 'x.db' AS x;") }), ImportError)
})

test('นำเข้าไฟล์ .db ของโปรแกรมเดิม (ไม่มีคอลัมน์ใหม่) และคืนค่าจากไฟล์สำรองได้', () => {
  const file = path.join(importDir, 'old-app.db')
  const old = new DatabaseSync(file)
  old.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, name TEXT, date TEXT, detail TEXT, price REAL, deposit REAL, remain REAL)')
  old.exec("INSERT INTO customers (name, date, detail, price, deposit, remain) VALUES ('เก่า 1', '2022-01-01', 'แว่นเก่า L-1.75', 1200, 1200, 0), ('เก่า 2', '2022-02-02', '', 900, 0, 900)")
  old.close()
  const { plan, backupFile } = importNow(file)
  assert.equal(plan.summary.total, 2)
  const r = ctx.db.prepare('SELECT * FROM customers WHERE id = 1').get()
  assert.equal(r.name, 'เก่า 1')
  assert.equal(r.old_glasses, '')

  // ใช้คำสั่งเดียวกันกู้คืนจากไฟล์สำรองได้ (ไฟล์สำรองคือข้อมูลจาก SQL ก่อนหน้า)
  importNow(backupFile)
  assert.equal(ctx.db.prepare('SELECT frame FROM customers WHERE id = 1').get().frame, "LEVI'S LV7104/F")
})

test('ไม่ยอมนำเข้าไฟล์ที่ผิด', () => {
  assert.throws(() => prepareImport({ dataDir, file: path.join(dataDir, 'banwaenraikhing.db') }), /ฐานข้อมูลที่ระบบใช้อยู่/)
  assert.throws(() => prepareImport({ dataDir, file: path.join(importDir, 'nope.db') }), /ไม่พบไฟล์/)
  assert.throws(() => prepareImport({ dataDir, file: writeTmp('dup.json', JSON.stringify([{ id: 1, name: 'a' }, { id: 1, name: 'b' }])) }), /ซ้ำ/)
  assert.throws(() => prepareImport({ dataDir, file: writeTmp('empty.json', '{"customers": []}') }), /ไม่มีข้อมูล/)
  assert.throws(() => prepareImport({ dataDir, file: writeTmp('x.csv', 'a,b') }), /รองรับเฉพาะ/)
})

test('คำสั่ง: --dry-run ไม่แก้อะไร และ --yes นำเข้าได้โดยไม่ต้องถาม', async () => {
  const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n
  const file = writeTmp('three.json', JSON.stringify({ customers: [{ id: 5, name: 'ก' }, { id: 6, name: 'ข' }, { id: 7, parent_id: 5, name: 'ก' }] }))
  const log = console.log
  console.log = () => {}
  const prevDir = process.env.DATA_DIR
  process.env.DATA_DIR = dataDir
  try {
    assert.equal(await main([file, '--dry-run']), 0)
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, before)
    assert.equal(await main([file, '--yes']), 0)
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 3)
    assert.equal(await main([]), 1)
  } finally {
    console.log = log
    if (prevDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDir
  }
})

function writeTmp (name, content) {
  const file = path.join(importDir, name)
  fs.writeFileSync(file, content)
  return file
}
