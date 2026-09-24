'use strict'

// วันที่ตามเวลาท้องถิ่น (TZ=Asia/Bangkok)
// เวอร์ชันเดิมใช้ toISOString() ซึ่งเป็นเวลา UTC ทำให้ช่วงตี 0–7 โมงเช้าวันที่เพี้ยนไป 1 วัน
// และยอด "เดือนนี้/ปีนี้" ไปนับวันสุดท้ายของเดือน/ปีก่อนหน้าด้วย

const pad = n => String(n).padStart(2, '0')

function toISODate (d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isISODate (s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function ranges (now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const mondayOffset = (today.getDay() + 6) % 7
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset)
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  return {
    today: toISODate(today),
    weekStart: toISODate(weekStart),
    weekEnd: toISODate(weekEnd),
    monthStart: toISODate(new Date(today.getFullYear(), today.getMonth(), 1)),
    monthEnd: toISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    yearStart: `${today.getFullYear()}-01-01`,
    yearEnd: `${today.getFullYear()}-12-31`
  }
}

// ใช้ตั้งชื่อไฟล์ เช่น 2026-09-24_153000
function stamp (d = new Date()) {
  return `${toISODate(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

module.exports = { toISODate, isISODate, ranges, stamp }
