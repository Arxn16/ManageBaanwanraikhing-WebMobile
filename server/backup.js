'use strict'

// สำรองข้อมูลอัตโนมัติ: เก็บไฟล์ไว้ที่ data/backups/ วันละ 1 ไฟล์ เก็บย้อนหลังตาม BACKUP_KEEP (ค่าเริ่มต้น 30 ไฟล์)
// ถ้าตั้ง BACKUP_COPY_DIR จะก๊อปไฟล์สำรองไปเก็บที่นั่นด้วย เช่นโฟลเดอร์ Documents ของมือถือ
// (ถ้าแอป Termux ถูกลบ ไฟล์ใน data/backups/ จะหายไปด้วย แต่สำเนาใน Documents ยังอยู่)

const fs = require('node:fs')
const path = require('node:path')
const { stamp } = require('./dates')

const NAME_RE = /^banwaenraikhing_\d{4}-\d{2}-\d{2}_\d{6}\.db$/

function createBackupManager ({ db, dataDir, keep = 30, intervalHours = 24, copyDir = '', log = console }) {
  const dir = path.join(dataDir, 'backups')
  const tmpDir = path.join(dataDir, 'tmp')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(tmpDir, { recursive: true })

  // โฟลเดอร์ที่ใช้ไม่ได้ (ไม่มีสิทธิ์เขียน ฯลฯ) ให้ข้ามไป ระบบยังสำรองใน data/backups/ ตามปกติ
  let mirrorDir = ''
  if (copyDir) {
    try {
      mirrorDir = path.resolve(copyDir)
      fs.mkdirSync(mirrorDir, { recursive: true })
    } catch (err) {
      log.error(`ใช้โฟลเดอร์ BACKUP_COPY_DIR ไม่ได้ (${copyDir}): ${err.message}`)
      mirrorDir = ''
    }
  }

  function list () {
    return fs.readdirSync(dir)
      .filter(name => NAME_RE.test(name))
      .map(name => {
        const st = fs.statSync(path.join(dir, name))
        return { name, time: st.mtime.toISOString(), mtimeMs: st.mtimeMs, size: st.size }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  // สำเนาที่ถูกต้องครบถ้วนแม้ระบบกำลังใช้งานอยู่
  function snapshotTo (target) {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    return target
  }

  function prune () {
    for (const old of list().slice(Math.max(1, keep))) {
      try { fs.unlinkSync(path.join(dir, old.name)) } catch (err) { log.error('ลบไฟล์สำรองเก่าไม่ได้:', err.message) }
    }
  }

  // ก๊อปไฟล์สำรองล่าสุดไปที่ BACKUP_COPY_DIR แล้วลบสำเนาเก่าเกินจำนวนที่เก็บ (ชื่อไฟล์มีวันเวลา เรียงตามชื่อได้เลย)
  function mirror () {
    if (!mirrorDir) return 0
    let copied = 0
    try {
      const have = new Set(fs.readdirSync(mirrorDir))
      for (const b of list().slice(0, Math.max(1, keep))) {
        if (have.has(b.name)) continue
        const src = path.join(dir, b.name)
        const dst = path.join(mirrorDir, b.name)
        fs.copyFileSync(src, dst)
        try { const st = fs.statSync(src); fs.utimesSync(dst, st.atime, st.mtime) } catch (_) { /* บางที่แก้เวลาไฟล์ไม่ได้ ไม่เป็นไร */ }
        copied++
      }
      const copies = fs.readdirSync(mirrorDir).filter(n => NAME_RE.test(n)).sort().reverse()
      for (const old of copies.slice(Math.max(1, keep))) fs.unlinkSync(path.join(mirrorDir, old))
    } catch (err) {
      log.error('ก๊อปไฟล์สำรองไปที่ BACKUP_COPY_DIR ไม่สำเร็จ:', err.message)
    }
    return copied
  }

  function backupNow () {
    let file = path.join(dir, `banwaenraikhing_${stamp()}.db`)
    if (fs.existsSync(file)) file = file.replace(/\.db$/, '') + `_${Date.now() % 1000}.db`
    snapshotTo(file)
    prune()
    mirror()
    return path.basename(file)
  }

  function maybeBackup () {
    const latest = list()[0]
    if (latest && Date.now() - latest.mtimeMs < intervalHours * 60 * 60 * 1000) return null
    try {
      const name = backupNow()
      log.log(`สำรองข้อมูลแล้ว: backups/${name}`)
      return name
    } catch (err) {
      log.error('สำรองข้อมูลอัตโนมัติไม่สำเร็จ:', err.message)
      return null
    }
  }

  function start () {
    maybeBackup()
    mirror() // ไฟล์สำรองที่มีอยู่ก่อนตั้ง BACKUP_COPY_DIR ก็ก๊อปไปด้วย
    const timer = setInterval(maybeBackup, 60 * 60 * 1000)
    timer.unref()
    return timer
  }

  // ไฟล์ชั่วคราวสำหรับให้ดาวน์โหลด (ลบทิ้งหลังส่งเสร็จ)
  function tempSnapshot () {
    const file = path.join(tmpDir, `download_${Date.now()}_${Math.random().toString(16).slice(2)}.db`)
    return snapshotTo(file)
  }

  // ล้างไฟล์ชั่วคราวที่ค้างจากการดาวน์โหลดที่ไม่จบ
  for (const name of fs.readdirSync(tmpDir)) {
    try { fs.unlinkSync(path.join(tmpDir, name)) } catch (_) { /* ignore */ }
  }

  return { dir, copyDir: mirrorDir, keep, intervalHours, list, backupNow, maybeBackup, mirror, start, tempSnapshot }
}

module.exports = { createBackupManager }
