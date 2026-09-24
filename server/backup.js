'use strict'

// สำรองข้อมูลอัตโนมัติ: เก็บไฟล์ไว้ที่ data/backups/ วันละ 1 ไฟล์ เก็บย้อนหลังตาม BACKUP_KEEP (ค่าเริ่มต้น 30 ไฟล์)

const fs = require('node:fs')
const path = require('node:path')
const { stamp } = require('./dates')

const NAME_RE = /^banwaenraikhing_\d{4}-\d{2}-\d{2}_\d{6}\.db$/

function createBackupManager ({ db, dataDir, keep = 30, intervalHours = 24, log = console }) {
  const dir = path.join(dataDir, 'backups')
  const tmpDir = path.join(dataDir, 'tmp')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(tmpDir, { recursive: true })

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

  function backupNow () {
    let file = path.join(dir, `banwaenraikhing_${stamp()}.db`)
    if (fs.existsSync(file)) file = file.replace(/\.db$/, '') + `_${Date.now() % 1000}.db`
    snapshotTo(file)
    prune()
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

  return { dir, keep, intervalHours, list, backupNow, maybeBackup, start, tempSnapshot }
}

module.exports = { createBackupManager }
