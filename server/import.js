'use strict'

// นำเข้าข้อมูลลูกค้าจากไฟล์ แล้วแทนที่ข้อมูลทั้งหมดในระบบ
//
//   ใช้กับ Docker :  docker compose exec app node server/import.js data/import/<ชื่อไฟล์>
//   ไม่ใช้ Docker  :  node server/import.js data/import/<ชื่อไฟล์>
//
// รองรับไฟล์ .db / .sqlite (ไฟล์ฐานข้อมูลจากโปรแกรมเดิม หรือไฟล์สำรองของระบบนี้),
// .sql (ไฟล์ dump ของ SQLite) และ .json (ไฟล์ที่มี "customers": [...] หรือไฟล์สำรอง JSON ของระบบนี้)
//
// ตัวเลือก:  --dry-run  ตรวจไฟล์อย่างเดียว ยังไม่นำเข้า
//           --yes      ไม่ต้องถามยืนยัน
//
// ก่อนนำเข้าจะสำรองข้อมูลเดิมไว้ที่ data/backups/before-import_<วันเวลา>.db ให้อัตโนมัติ
// ระบบที่เปิดอยู่จะเห็นข้อมูลใหม่ทันที ไม่ต้องรีสตาร์ต

process.env.TZ = process.env.TZ || 'Asia/Bangkok'

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { DatabaseSync } = require('node:sqlite')
const { openDatabase, transaction } = require('./db')
const { stamp } = require('./dates')

const SQLITE_EXT = new Set(['.db', '.sqlite', '.sqlite3'])

class ImportError extends Error {}

// รองรับ JSON แบบ MongoDB Extended เช่น {"$numberDouble": "1500"} หรือ {"$oid": "..."}
function unwrap (v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (k in v) return Number(v[k])
    }
    if ('$oid' in v) return String(v.$oid)
    if ('$date' in v) return String(v.$date).slice(0, 10)
  }
  return v
}

function readTable (db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'").get()
  if (!table) throw new ImportError('ไม่พบตาราง customers ในไฟล์นี้')
  return db.prepare('SELECT * FROM customers ORDER BY id').all()
}

function readRecords (file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') {
    let data
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    } catch (err) {
      throw new ImportError('อ่านไฟล์ JSON ไม่ได้: ' + err.message)
    }
    const rows = Array.isArray(data) ? data : data && data.customers
    if (!Array.isArray(rows)) throw new ImportError('ไม่พบรายการลูกค้าในไฟล์ JSON (ต้องมี "customers": [...])')
    return rows.map(r => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, unwrap(v)])))
  }
  if (ext === '.sql') {
    const sql = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    if (/\b(ATTACH|DETACH)\b/i.test(sql)) throw new ImportError('ไฟล์ SQL นี้มีคำสั่ง ATTACH/DETACH ซึ่งไม่รองรับ')
    const mem = new DatabaseSync(':memory:')
    try {
      mem.exec(sql)
      return readTable(mem)
    } catch (err) {
      if (err instanceof ImportError) throw err
      throw new ImportError('อ่านไฟล์ SQL ไม่ได้: ' + err.message + ' (รองรับเฉพาะไฟล์ dump ของ SQLite)')
    } finally {
      mem.close()
    }
  }
  if (SQLITE_EXT.has(ext)) {
    let src
    try {
      src = new DatabaseSync(file, { readOnly: true })
      return readTable(src)
    } catch (err) {
      if (err instanceof ImportError) throw err
      throw new ImportError('เปิดไฟล์ฐานข้อมูลไม่ได้: ' + err.message)
    } finally {
      if (src) src.close()
    }
  }
  throw new ImportError('รองรับเฉพาะไฟล์ .db, .sqlite, .sql และ .json')
}

// แปลงข้อมูลจากไฟล์ให้ตรงกับคอลัมน์ของระบบ
function normalize (rows, columns) {
  const warnings = []
  let trimmed = 0
  const hasIds = rows.some(r => r.id !== undefined && r.id !== null && r.id !== '')
  const known = new Set(columns.map(c => c.name))
  const ignored = new Set()

  const records = rows.map((r, index) => {
    for (const k of Object.keys(r)) if (!known.has(k) && k !== '_id') ignored.add(k)
    const out = {}
    for (const { name, type } of columns) {
      let v = r[name]
      if (name === 'id') {
        v = hasIds ? Number(v) : index + 1
        if (!Number.isInteger(v) || v <= 0) throw new ImportError(`รายการที่ ${index + 1} มีรหัส (id) ไม่ถูกต้อง: ${r.id}`)
      } else if (name === 'parent_id') {
        v = v === undefined || v === null || v === '' || Number(v) === 0 ? null : Number(v)
        if (v !== null && !Number.isInteger(v)) throw new ImportError(`รายการ id ${out.id} มี parent_id ไม่ถูกต้อง: ${r.parent_id}`)
      } else if (/INT|REAL|NUM|FLOA|DOUB/i.test(type)) {
        if (v === undefined || v === null || v === '') v = null
        else {
          const n = Number(String(v).replace(/[,\s]/g, ''))
          if (Number.isFinite(n)) v = n
          else {
            warnings.push(`รายการ id ${out.id}: ช่อง ${name} ไม่ใช่ตัวเลข (${v}) บันทึกเป็นค่าว่าง`)
            v = null
          }
        }
      } else {
        const s = v === undefined || v === null ? '' : String(v)
        v = s.trim()
        if (v !== s) trimmed++
      }
      out[name] = v
    }
    return out
  })

  const seen = new Set()
  for (const r of records) {
    if (seen.has(r.id)) throw new ImportError(`มีรหัส (id) ซ้ำกันในไฟล์: ${r.id}`)
    seen.add(r.id)
  }
  const byId = new Map(records.map(r => [r.id, r]))
  const orphans = records.filter(r => r.parent_id !== null && !byId.has(r.parent_id))
  if (orphans.length) warnings.push(`มี ${orphans.length} รายการที่ลูกค้าหลักไม่อยู่ในไฟล์ (id: ${orphans.slice(0, 10).map(r => r.id).join(', ')}${orphans.length > 10 ? ', ...' : ''})`)
  const noPrice = records.filter(r => r.price === null)
  if (noPrice.length) warnings.push(`มี ${noPrice.length} รายการที่ไม่มีราคา (id: ${noPrice.slice(0, 10).map(r => r.id).join(', ')}${noPrice.length > 10 ? ', ...' : ''})`)
  if (ignored.size) warnings.push(`ข้ามช่องที่ระบบไม่รู้จัก: ${[...ignored].join(', ')}`)

  return { records, warnings, trimmed }
}

function summarize (records) {
  const dates = records.map(r => r.date).filter(Boolean).sort()
  const sum = key => records.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  return {
    total: records.length,
    customers: records.filter(r => r.parent_id === null).length,
    visits: records.filter(r => r.parent_id !== null).length,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    sales: sum('price'),
    remain: sum('remain')
  }
}

// อ่านและตรวจไฟล์ เทียบกับข้อมูลในระบบ (ยังไม่แก้อะไร)
function prepareImport ({ dataDir, file }) {
  const source = path.resolve(file)
  const dbFile = path.join(path.resolve(dataDir), 'banwaenraikhing.db')
  if (!fs.existsSync(source)) throw new ImportError(`ไม่พบไฟล์ ${file}`)
  if (source === dbFile) {
    throw new ImportError('ไฟล์นี้คือฐานข้อมูลที่ระบบใช้อยู่ ให้ย้ายไฟล์ที่จะนำเข้าไปไว้ที่ data/import/ ก่อน')
  }
  const rows = readRecords(source)
  if (!rows.length) throw new ImportError('ไฟล์นี้ไม่มีข้อมูลลูกค้า')

  const db = openDatabase(dbFile)
  const columns = db.prepare('PRAGMA table_info(customers)').all().map(c => ({ name: c.name, type: String(c.type || '') }))
  const { records, warnings, trimmed } = normalize(rows, columns)
  const current = db.prepare('SELECT id, name, date FROM customers').all()
  const incoming = new Map(records.map(r => [r.id, r]))
  const lost = current.filter(c => {
    const r = incoming.get(c.id)
    return !r || (r.name || '') !== (c.name || '').trim() || (r.date || '') !== (c.date || '')
  }).length

  return { db, dbFile, source, columns, records, warnings, trimmed, currentCount: current.length, lost, summary: summarize(records) }
}

// สำรองข้อมูลเดิม แล้วแทนที่ด้วยข้อมูลจากไฟล์ในครั้งเดียว (ถ้าพังกลางทางจะย้อนกลับทั้งหมด)
function applyImport (plan) {
  const { db, dbFile, columns, records } = plan
  const backupDir = path.join(path.dirname(dbFile), 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const base = path.join(backupDir, `before-import_${stamp()}`)
  let backupFile = `${base}.db`
  for (let n = 2; fs.existsSync(backupFile); n++) backupFile = `${base}_${n}.db`
  db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`)

  const names = columns.map(c => c.name)
  const insert = db.prepare(`INSERT INTO customers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
  transaction(db, () => {
    db.exec('DELETE FROM customers')
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'customers'")
    for (const r of records) insert.run(...names.map(n => r[n]))
  })
  return { backupFile }
}

// ---------- ใช้จาก command line ----------

const baht = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })

function ask (question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer) }))
}

async function main (argv) {
  const args = argv.filter(a => !a.startsWith('--') && a !== '-y')
  const dryRun = argv.includes('--dry-run')
  const yes = argv.includes('--yes') || argv.includes('-y')
  if (args.length !== 1) {
    console.log('วิธีใช้:  node server/import.js <ไฟล์ .db / .sql / .json> [--dry-run] [--yes]')
    console.log('ตัวอย่าง: docker compose exec app node server/import.js data/import/banwaenraikhing.db')
    return 1
  }
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
  let plan
  try {
    plan = prepareImport({ dataDir, file: args[0] })
  } catch (err) {
    console.error(`❌ ${err instanceof ImportError ? err.message : err.stack || err}`)
    return 1
  }

  const s = plan.summary
  console.log(`ไฟล์: ${args[0]}`)
  console.log(`  ${s.total} รายการ (ลูกค้า ${s.customers} คน, มาซ้ำ ${s.visits} ครั้ง) วันที่ ${s.firstDate || '-'} ถึง ${s.lastDate || '-'}`)
  console.log(`  ยอดขายรวม ${baht(s.sales)} บาท · ค้างชำระ ${baht(s.remain)} บาท`)
  if (plan.trimmed) console.log(`  ตัดช่องว่างเกินหน้า/หลังข้อความ ${plan.trimmed} ช่อง`)
  for (const w of plan.warnings) console.log(`  ⚠️  ${w}`)
  console.log(`ข้อมูลในระบบตอนนี้: ${plan.currentCount} รายการ → จะถูกแทนที่ด้วยข้อมูลจากไฟล์ทั้งหมด`)
  if (plan.lost) console.log(`  ⚠️  มี ${plan.lost} รายการในระบบที่ไม่มีหรือไม่ตรงกับในไฟล์ จะหายไปหลังนำเข้า (กู้คืนได้จากไฟล์สำรอง)`)

  if (dryRun) {
    console.log('ตรวจอย่างเดียว (--dry-run) ยังไม่ได้นำเข้า')
    plan.db.close()
    return 0
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('ต้องยืนยันก่อนนำเข้า ให้รันใหม่พร้อม --yes')
      plan.db.close()
      return 2
    }
    const answer = (await ask('พิมพ์ y แล้วกด Enter เพื่อนำเข้า: ')).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      console.log('ยกเลิกแล้ว ไม่มีอะไรเปลี่ยน')
      plan.db.close()
      return 2
    }
  }

  try {
    const { backupFile } = applyImport(plan)
    console.log(`สำรองข้อมูลเดิมไว้ที่ ${path.relative(process.cwd(), backupFile) || backupFile}`)
    console.log(`✅ นำเข้าเสร็จแล้ว ${s.total} รายการ รีเฟรชหน้าเว็บก็จะเห็นข้อมูลใหม่`)
    return 0
  } catch (err) {
    console.error(`❌ นำเข้าไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ: ${err.message}`)
    return 1
  } finally {
    plan.db.close()
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code })
}

module.exports = { readRecords, normalize, prepareImport, applyImport, ImportError, main }
