'use strict'

// ทดสอบการสำรองข้อมูล และการก๊อปไฟล์สำรองไปอีกที่ (BACKUP_COPY_DIR): npm test

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openDatabase } = require('../server/db')
const { createBackupManager } = require('../server/backup')

const quiet = { log () {}, error () {} }

function setup () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-backup-'))
  const dataDir = path.join(root, 'data')
  const db = openDatabase(path.join(dataDir, 'banwaenraikhing.db'))
  db.prepare("INSERT INTO customers (name, date) VALUES ('ทดสอบ', '2026-10-05')").run()
  const backups = path.join(dataDir, 'backups')
  fs.mkdirSync(backups, { recursive: true })
  return { root, dataDir, db, backups, done () { db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}

test('ก๊อปไฟล์สำรองไปโฟลเดอร์ BACKUP_COPY_DIR และเก็บไม่เกินจำนวนที่ตั้ง', () => {
  const t = setup()
  try {
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.writeFileSync(path.join(t.backups, `banwaenraikhing_${d}_100000.db`), 'old')
    const copyDir = path.join(t.root, 'shared', 'Documents', 'banwaenraikhing-backups')
    const b = createBackupManager({ db: t.db, dataDir: t.dataDir, keep: 2, copyDir, log: quiet })
    assert.equal(b.copyDir, copyDir)
    const name = b.backupNow()
    const copies = fs.readdirSync(copyDir)
    assert.equal(copies.length, 2)
    assert.ok(copies.includes(name))
    assert.deepEqual(fs.readFileSync(path.join(copyDir, name)), fs.readFileSync(path.join(t.backups, name)))
  } finally { t.done() }
})

test('ตอนเปิดระบบ ก๊อปไฟล์สำรองที่มีอยู่แล้วไปเก็บด้วย', () => {
  const t = setup()
  try {
    const existing = 'banwaenraikhing_2026-01-01_090000.db'
    fs.writeFileSync(path.join(t.backups, existing), 'recent') // ไฟล์ใหม่ไม่ถึง 24 ชม. จึงยังไม่สำรองซ้ำ
    const copyDir = path.join(t.root, 'copies')
    const b = createBackupManager({ db: t.db, dataDir: t.dataDir, copyDir, log: quiet })
    clearInterval(b.start())
    assert.deepEqual(fs.readdirSync(copyDir), [existing])
  } finally { t.done() }
})

test('ถ้าโฟลเดอร์ BACKUP_COPY_DIR ใช้ไม่ได้ ระบบยังสำรองข้อมูลได้ตามปกติ', () => {
  const t = setup()
  try {
    const blocker = path.join(t.root, 'not-a-folder')
    fs.writeFileSync(blocker, 'x')
    const b = createBackupManager({ db: t.db, dataDir: t.dataDir, copyDir: path.join(blocker, 'sub'), log: quiet })
    assert.equal(b.copyDir, '')
    const name = b.backupNow()
    assert.ok(fs.existsSync(path.join(t.backups, name)))
  } finally { t.done() }
})
