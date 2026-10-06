'use strict'

// ทดสอบตัวช่วยดูค่าสายตา (สรุปสายตาและแปลงค่า): npm test

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseDiopter, parseAxis, parseVA, fmt, eye, assess, contactPower } = require('../public/js/rx-tools')

test('อ่านค่าสายตาที่พิมพ์มาหลายแบบ', () => {
  const cases = [['-1.25', -1.25], ['+2.00', 2], ['00', 0], ['+-00', 0], ['+-', 0], ['PL', 0], ['-025', -0.25],
    ['-125', -1.25], ['−2.00', -2], ['+0.75 (ชาไล่สี มองไกล)', 0.75], ['-3', -3], ['', null], [null, null],
    ['-', null], ['+', null], ['.', null], ['-1.', -1]] // ระหว่างพิมพ์ยังไม่ครบ ไม่ต้องขึ้นว่าอ่านไม่ได้
  for (const [raw, want] of cases) assert.equal(parseDiopter(raw), want, `"${raw}"`)
  for (const raw of ['+-0.50', '-3.00-0.75', 'PRISM2', '0-.75', '45.00']) assert.ok(Number.isNaN(parseDiopter(raw)), `"${raw}" ต้องอ่านไม่ได้`)
  assert.equal(parseAxis('180'), 180)
  assert.equal(parseAxis('0'), 180)
  assert.ok(Number.isNaN(parseAxis('PD Base in')))
  assert.equal(parseVA('20/40'), 0.5)
  assert.equal(parseVA('6/6'), 1)
})

test('จัดระดับสายตาสั้น/ยาวตามเกณฑ์ IMI และ AOA', () => {
  const kind = sph => { const e = eye({ r_sph: sph }, 'r'); return e.kind + (e.level ?? '') }
  assert.equal(kind('-0.25'), 'normal')
  assert.equal(kind('-0.50'), 'myopia0')
  assert.equal(kind('-3.00'), 'myopia0')
  assert.equal(kind('-3.25'), 'myopia1')
  assert.equal(kind('-6.00'), 'myopia2')
  assert.equal(kind('+0.25'), 'normal')
  assert.equal(kind('+2.00'), 'hyperopia0')
  assert.equal(kind('+2.25'), 'hyperopia1')
  assert.equal(kind('+5.25'), 'hyperopia2')
  // ใช้ค่ารวม SE: -0.25 -0.50 → SE -0.50 = สั้น
  assert.equal(eye({ r_sph: '-0.25', r_cyl: '-0.50', r_ax: '180' }, 'r').kind, 'myopia')
})

test('สายตาเอียง ระดับและแนวเอียง ทั้งแบบ CYL ลบและบวก', () => {
  const a = (cyl, ax) => { const e = eye({ r_sph: '-1.00', r_cyl: cyl, r_ax: ax }, 'r'); return [e.astig, e.astigType] }
  assert.deepEqual(a('-0.25', '180'), [null, undefined])
  assert.deepEqual(a('-0.50', '180'), [0, 'ตามกฎ'])
  assert.deepEqual(a('-1.25', '90'), [1, 'ผิดกฎ'])
  assert.deepEqual(a('-2.25', '45'), [2, 'แนวเฉียง'])
  assert.deepEqual(a('+1.00', '90'), [0, 'ตามกฎ']) // แบบบวกที่แกน 90 = แบบลบที่แกน 180
})

test('ข้อความสรุปใช้หน่วยแบบที่ร้านพูด', () => {
  const r = assess({ r_sph: '-1.25', r_cyl: '-0.50', r_ax: '180', l_sph: '+-0.50' })
  assert.match(r.rText, /สายตาสั้นเล็กน้อย/)
  assert.match(r.rText, /สั้น 125 เอียง 50/)
  assert.match(r.lText, /อ่านค่าไม่ได้/)
  assert.deepEqual([r.rSum.state, r.rSum.talk, r.lSum.state], ['ok', 'สั้น 125 เอียง 50', 'bad'])
  assert.equal(assess({}).empty, true)
  const addOnly = assess({ r_add: '+2.00', l_add: '+2.00' }) // มีแค่ ADD ก็ยังแสดงสรุป
  assert.equal(addOnly.empty, false)
  assert.equal(addOnly.add, 'ยาวตามอายุ ADD +2.00')
  assert.equal(addOnly.rSum.state, 'empty')
})

test('อายุ 40 ขึ้นไป ค่าบวกไม่มี ADD: บอกว่าอาจเป็นแว่นอ่านหนังสือ', () => {
  const plus = { r_sph: '+2.50', l_sph: '+2.50' }
  assert.match(assess(plus, null, { age: '55' }).nearHint, /อายุ 55 .*ยาวตามอายุ/)
  assert.equal(assess(plus, null, { age: '30' }).nearHint, null)
  assert.equal(assess(plus).nearHint, null)
  assert.equal(assess({ ...plus, r_add: '+2.00' }, null, { age: '55' }).nearHint, null)
  assert.equal(assess({ r_sph: '-2.00' }, null, { age: '55' }).nearHint, null)
})

test('แปลงค่า: สลับ CYL, SE, แว่นอ่านหนังสือ, ระยะคอม, คอนแทคเลนส์, VA', () => {
  const r = assess({ r_sph: '+1.00', r_cyl: '-0.50', r_ax: '90', r_add: '+2.00', r_va: '20/40', l_sph: '-1.00', l_add: '+2.00' })
  const row = label => r.rows.find(x => x.label === label)
  assert.equal(row('สลับรูปแบบ CYL').r, '+0.50 +0.50 × 180')
  assert.equal(row('ค่ารวม (SE)').r, '+0.75')
  assert.equal(row('แว่นอ่านหนังสือ').l, '+1.00')
  assert.equal(row('ระยะคอม (ประมาณ)').l, '0.00')
  assert.equal(row('VA').r, '20/40 = 6/12 = 0.5')
  assert.equal(fmt(contactPower(-6)), '-5.50')
  assert.equal(fmt(contactPower(-8)), '-7.50')
  assert.equal(fmt(contactPower(5)), '+5.25')
  assert.equal(fmt(contactPower(-2)), '-2.00')
})

test('เตือนสองตาต่างกัน และเทียบกับครั้งก่อน', () => {
  const now = assess({ r_sph: '-1.50', l_sph: '-3.75' }, { date: '2025-10-01', r_sph: '-1.00', l_sph: '-3.75' })
  assert.equal(now.aniso.warn, true)
  assert.match(now.change.text, /R สั้นเพิ่ม 50/)
  assert.match(now.change.text, /L คงเดิม/)
  assert.equal(assess({ r_sph: '-1.00', l_sph: '-2.25' }).aniso.warn, false)
})
