'use strict'

// ฐานข้อมูล SQLite (ใช้ SQLite ที่มากับ Node.js ไม่ต้องลง library เพิ่ม)
// โครงสร้างตารางเหมือนเวอร์ชัน Electron เดิมทุกคอลัมน์ ย้ายไฟล์ .db เดิมมาใช้ได้ทันที
// คอลัมน์ที่เพิ่มตามใบรายการของร้าน (โรคประจำตัว, แว่นเก่า) จะถูกเพิ่มให้ไฟล์เดิมเองตอนเปิดระบบ

const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const COLUMNS = {
  parent_id: 'INTEGER',
  name: 'TEXT', date: 'TEXT', age: 'TEXT', job: 'TEXT', phone: 'TEXT', address: 'TEXT',
  r_sph: 'TEXT', r_cyl: 'TEXT', r_ax: 'TEXT', r_va: 'TEXT', r_add: 'TEXT', r_pd: 'TEXT',
  l_sph: 'TEXT', l_cyl: 'TEXT', l_ax: 'TEXT', l_va: 'TEXT', l_add: 'TEXT', l_pd: 'TEXT',
  detail: 'TEXT', frame: 'TEXT', lens: 'TEXT',
  price: 'REAL', deposit: 'REAL', remain: 'REAL',
  disease: 'TEXT', old_glasses: 'TEXT'
}

// ข้อมูลส่วนตัว (เก็บที่ตัวลูกค้า)
const PERSONAL_FIELDS = ['name', 'date', 'age', 'job', 'phone', 'address', 'disease']
const RX_FIELDS = [
  'r_sph', 'r_cyl', 'r_ax', 'r_va', 'r_add', 'r_pd',
  'l_sph', 'l_cyl', 'l_ax', 'l_va', 'l_add', 'l_pd'
]
// ข้อมูลของการมาแต่ละครั้ง: แว่นเก่า, รายละเอียดเพิ่มเติม (Re), กรอบแว่น, เลนส์
const ORDER_FIELDS = ['old_glasses', 'detail', 'frame', 'lens']
const TEXT_FIELDS = [...PERSONAL_FIELDS, ...RX_FIELDS, ...ORDER_FIELDS]

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  name TEXT,
  date TEXT,
  age TEXT,
  job TEXT,
  phone TEXT,
  address TEXT,

  r_sph TEXT,
  r_cyl TEXT,
  r_ax TEXT,
  r_va TEXT,
  r_add TEXT,
  r_pd TEXT,

  l_sph TEXT,
  l_cyl TEXT,
  l_ax TEXT,
  l_va TEXT,
  l_add TEXT,
  l_pd TEXT,

  detail TEXT,
  frame TEXT,
  lens TEXT,

  price REAL,
  deposit REAL,
  remain REAL,

  disease TEXT,
  old_glasses TEXT
)`

function openDatabase (file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(CREATE_TABLE)

  // เพิ่มคอลัมน์ที่ขาด (สำหรับไฟล์ .db รุ่นเก่า) เหมือน ensureColumns() เดิม
  const existing = new Set(db.prepare('PRAGMA table_info(customers)').all().map(r => r.name))
  for (const [col, type] of Object.entries(COLUMNS)) {
    if (!existing.has(col)) db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${type}`)
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_parent_id ON customers(parent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_date ON customers(date)')
  return db
}

// รันหลายคำสั่งเป็นชุดเดียว ถ้าพังกลางทางจะย้อนกลับทั้งหมด
function transaction (db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try { db.exec('ROLLBACK') } catch (_) { /* ignore */ }
    throw err
  }
}

module.exports = {
  openDatabase,
  transaction,
  PERSONAL_FIELDS,
  RX_FIELDS,
  ORDER_FIELDS,
  TEXT_FIELDS
}
