/* บ้านแว่นไร่ขิง — ช่วยดูค่าสายตา: สรุปสายตาคร่าวๆ และแปลงค่า (ใช้ในร้าน ไม่บันทึก ไม่พิมพ์)
 *
 * เกณฑ์ที่ใช้ (ใช้ค่าสายตารวม SE = SPH + CYL/2)
 *   สายตาสั้น   IMI 2019: SE ≤ −0.50 คือสั้น, ≤ −6.00 คือสั้นมาก (ช่วง −3.25 ถึง −5.75 = ปานกลาง ตามที่คลินิกใช้ทั่วไป)
 *   สายตายาว    AOA: ≤ +2.00 น้อย, +2.25 ถึง +5.00 ปานกลาง, > +5.00 มาก (เริ่มนับที่ +0.50)
 *   สายตาเอียง  เกณฑ์ที่ใช้ทั่วไป: 0.50–1.00 เล็กน้อย, 1.25–2.00 ปานกลาง, > 2.00 มาก
 *   สองตาต่างกัน ตั้งแต่ 1.00 บอกไว้, ตั้งแต่ 2.00 เตือนว่าอาจใส่แว่นไม่สบายตา
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.RxTools) และใน Node (require) สำหรับชุดทดสอบ
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.RxTools = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const q = x => Math.round(x * 4) / 4 // ปัดทีละ 0.25 ตามขั้นของเลนส์
  const noNegZero = x => (Object.is(x, -0) ? 0 : x)
  const LEVEL = ['เล็กน้อย', 'ปานกลาง', 'มาก']

  // อ่านค่าที่พิมพ์มาหลายแบบ: "-1.25", "00", "+-00", "-025", "PL", "+0.75 (หมายเหตุ)"
  // คืน null = ไม่ได้กรอก, NaN = อ่านไม่ได้ (เช่น "+-0.50" ไม่รู้ว่าบวกหรือลบ, "-3.00-0.75" สองค่าในช่องเดียว)
  function parseDiopter (raw, max = 30) {
    let s = String(raw ?? '').trim()
    if (!s) return null
    s = s.replace(/[−–—]/g, '-').replace(/\s+/g, '').toUpperCase()
    if (/^(PL|PLANO|PLAN|±|\+-|-\+)$/.test(s)) return 0
    if (/^[+-]?\.?$/.test(s)) return null // ยังพิมพ์ไม่เสร็จ เช่น "-" หรือ "."
    let plusMinus = false
    const pm = /^(±|\+-|-\+)/.exec(s)
    if (pm) { plusMinus = true; s = s.slice(pm[0].length) }
    const m = /^([+-]?)(\d+\.(?!\d)|\d*\.?\d+)/.exec(s)
    if (!m) return NaN
    if (/^[+\-\d.]/.test(s.slice(m[0].length))) return NaN
    let n = Number(m[2])
    if (!m[2].includes('.')) {
      if (m[2].length >= 3) n /= 100 // "-025" = -0.25
      else if (n > 20) n /= 100 // "-25" = -0.25
    }
    if (m[1] === '-') n = -n
    if (plusMinus) return n === 0 ? 0 : NaN
    if (!Number.isFinite(n) || Math.abs(n) > max) return NaN
    return noNegZero(n)
  }

  function parseAxis (raw) {
    const s = String(raw ?? '').replace(/\s+/g, '')
    if (!s) return null
    const m = /^(\d{1,3})(°|DEG)?$/i.exec(s)
    if (!m) return NaN
    const n = Number(m[1])
    return n <= 180 ? (n === 0 ? 180 : n) : NaN
  }

  // VA แบบ 20/40, 6/12 หรือทศนิยม 0.5 → ค่าทศนิยม
  function parseVA (raw) {
    const s = String(raw ?? '').replace(/\s+/g, '')
    if (!s) return null
    let m = /^(20|6)\/(\d{1,3}(?:\.\d+)?)$/.exec(s)
    if (m) {
      const d = Number(m[1]) / Number(m[2])
      return d > 0 && d <= 3 ? d : NaN
    }
    m = /^\d(\.\d{1,2})?$/.exec(s)
    if (m) {
      const d = Number(s)
      return d > 0 && d <= 2 ? d : NaN
    }
    return NaN
  }

  function fmt (x) {
    if (x === null || x === undefined || Number.isNaN(x)) return '–'
    const v = noNegZero(q(x))
    return v === 0 ? '0.00' : (v > 0 ? '+' : '-') + Math.abs(v).toFixed(2)
  }
  const shop = x => String(Math.round(Math.abs(q(x)) * 100)) // -1.75 → "175" แบบที่ร้านพูด

  function rxText (s, c, ax) {
    return q(c) === 0 ? fmt(s) : `${fmt(s)} ${fmt(c)} × ${ax ?? '?'}`
  }

  function vaText (d) {
    const ft = Math.round(20 / d)
    const m6 = Math.round((6 / d) * 10) / 10
    const dec = Math.round(d * 100) / 100
    return `20/${ft} = 6/${m6} = ${dec >= 1 ? dec.toFixed(1) : dec}`
  }

  // วิเคราะห์ตาข้างเดียว (side = 'r' หรือ 'l')
  function eye (v, side) {
    const raw = k => v[`${side}_${k}`]
    const sph = parseDiopter(raw('sph'))
    const cyl = parseDiopter(raw('cyl'), 10)
    const ax = parseAxis(raw('ax'))
    const add = parseDiopter(raw('add'), 4)
    const va = parseVA(raw('va'))
    const e = { side, hasData: sph !== null || cyl !== null, ok: false, bad: [] }
    if (Number.isNaN(sph)) e.bad.push(['SPH', raw('sph')])
    if (Number.isNaN(cyl)) e.bad.push(['CYL', raw('cyl')])
    if (Number.isNaN(ax)) e.bad.push(['AX', raw('ax')])
    e.add = add !== null && !Number.isNaN(add) && add > 0 ? add : null
    e.va = va !== null && !Number.isNaN(va) ? va : null
    if (!e.hasData || Number.isNaN(sph) || Number.isNaN(cyl)) return e

    e.ok = true
    e.sph = sph ?? 0
    e.cyl = cyl ?? 0
    e.ax = ax === null || Number.isNaN(ax) ? null : ax
    e.se = e.sph + e.cyl / 2
    const se = q(e.se)
    if (se <= -0.5) { e.kind = 'myopia'; e.level = se <= -6 ? 2 : se <= -3.25 ? 1 : 0 } else if (se >= 0.5) { e.kind = 'hyperopia'; e.level = se > 5 ? 2 : se >= 2.25 ? 1 : 0 } else e.kind = 'normal'

    const ac = Math.abs(q(e.cyl))
    e.astig = ac >= 0.5 ? (ac <= 1 ? 0 : ac <= 2 ? 1 : 2) : null
    if (e.astig !== null && e.ax !== null) {
      const minusAx = e.cyl > 0 ? (e.ax > 90 ? e.ax - 90 : e.ax + 90) : e.ax // ดูแนวเอียงจากแบบ CYL ลบ
      e.astigType = minusAx <= 30 || minusAx >= 150 ? 'ตามกฎ' : minusAx >= 60 && minusAx <= 120 ? 'ผิดกฎ' : 'แนวเฉียง'
    }
    return e
  }

  // แบบที่ร้านพูดกับลูกค้า (คิดจากแบบ CYL ลบ): "สั้น 125 เอียง 50"
  function vernacular (e) {
    const sph = e.cyl > 0 ? e.sph + e.cyl : e.sph
    const out = []
    if (q(sph) < 0) out.push(`สั้น ${shop(sph)}`)
    else if (q(sph) > 0) out.push(`ยาว ${shop(sph)}`)
    if (q(e.cyl) !== 0) out.push(`เอียง ${shop(e.cyl)}`)
    return out.join(' ') || 'ค่า 0'
  }

  // state: 'empty' = ไม่ได้กรอก, 'bad' = อ่านค่าไม่ได้, 'ok' = มี desc (ตามเกณฑ์) และ talk (แบบที่ร้านพูด)
  function eyeSummary (e) {
    if (!e.hasData) return { state: 'empty', desc: 'ไม่ได้กรอก', talk: '' }
    if (!e.ok) return { state: 'bad', desc: `อ่านค่าไม่ได้ (${e.bad.map(([k, v]) => `${k} "${v}"`).join(', ')})`, talk: '' }
    const parts = []
    if (e.kind === 'myopia') parts.push(`สายตาสั้น${LEVEL[e.level]}`)
    else if (e.kind === 'hyperopia') parts.push(`สายตายาว${LEVEL[e.level]}`)
    else parts.push('มองไกลใกล้เคียงปกติ')
    if (e.astig !== null) parts.push(`เอียง${LEVEL[e.astig]}${e.astigType ? ` (${e.astigType})` : ''}`)
    return { state: 'ok', desc: parts.join(' · '), talk: vernacular(e) }
  }

  function eyeText (e) {
    const s = eyeSummary(e)
    return s.talk ? `${s.desc} — ${s.talk}` : s.desc
  }

  function changeText (now, before) {
    const d = q(now) - q(before)
    if (Math.abs(d) < 0.25) return 'คงเดิม'
    if (q(now) < 0 || (q(now) === 0 && q(before) < 0)) return d < 0 ? `สั้นเพิ่ม ${shop(d)}` : `สั้นลด ${shop(d)}`
    if (q(now) > 0 || q(before) > 0) return d > 0 ? `ยาวเพิ่ม ${shop(d)}` : `ยาวลด ${shop(d)}`
    return `เปลี่ยน ${shop(d)}`
  }

  // คอนแทคเลนส์: ค่าเกิน ±4.00 ต้องคิดระยะห่างจากตา (แว่นห่างตา 12 มม.)
  const vertex = (f, d = 0.012) => f / (1 - d * f)
  function contactPower (x) {
    const v = Math.abs(x) >= 4 ? vertex(x) : x
    return Math.abs(v) > 6 ? Math.round(v * 2) / 2 : q(v) // เกิน ±6.00 คอนแทคมักมีทีละ 0.50
  }

  function conversions (r, l) {
    const eyes = [r, l]
    const rows = []
    const row = (label, fn) => {
      const vals = eyes.map(e => (e.ok ? fn(e) : null))
      if (vals.some(Boolean)) rows.push({ label, r: vals[0] || '–', l: vals[1] || '–' })
    }
    if (eyes.some(e => e.ok && q(e.cyl) !== 0)) {
      row('สลับรูปแบบ CYL', e => (q(e.cyl) !== 0 && e.ax !== null
        ? rxText(e.sph + e.cyl, -e.cyl, e.ax > 90 ? e.ax - 90 : e.ax + 90) : null))
      row('ค่ารวม (SE)', e => fmt(e.se))
    }
    row('คอนแทคเลนส์', e => fmt(contactPower(e.se)) + (Math.abs(q(e.cyl)) >= 1 ? ' *' : ''))
    const addOf = e => e.add ?? (e === r ? l.add : r.add)
    if (eyes.some(e => e.ok && addOf(e))) {
      row('แว่นอ่านหนังสือ', e => (addOf(e) ? rxText(e.sph + addOf(e), e.cyl, e.ax) : null))
      row('ระยะคอม (ประมาณ)', e => (addOf(e) ? rxText(e.sph + addOf(e) / 2, e.cyl, e.ax) : null))
    }
    const va = eyes.map(e => (e.va ? vaText(e.va) : null))
    if (va.some(Boolean)) rows.push({ label: 'VA', r: va[0] || '–', l: va[1] || '–' })
    return { rows, toric: eyes.some(e => e.ok && Math.abs(q(e.cyl)) >= 1) }
  }

  // สรุปทั้งสองตา และเทียบกับครั้งก่อน (prev ไม่บังคับ)
  // opts.age: อายุ 40 ขึ้นไป ค่าบวกที่ไม่มี ADD อาจเป็นค่าแว่นอ่านหนังสือ (ยาวตามอายุ) ไม่ใช่สายตายาวแต่กำเนิด
  function assess (v, prev, opts = {}) {
    const r = eye(v || {}, 'r')
    const l = eye(v || {}, 'l')
    let add = null
    if (r.add || l.add) {
      add = r.add && l.add && q(r.add) !== q(l.add)
        ? `ยาวตามอายุ ADD R ${fmt(r.add)} / L ${fmt(l.add)}`
        : `ยาวตามอายุ ADD ${fmt(r.add || l.add)}`
    }
    let aniso = null
    if (r.ok && l.ok) {
      const d = Math.abs(q(r.se) - q(l.se))
      if (d >= 2) aniso = { warn: true, text: `สองตาต่างกันมาก ${shop(d)} อาจใส่แว่นไม่สบายตา` }
      else if (d >= 1) aniso = { warn: false, text: `สองตาต่างกัน ${shop(d)}` }
    }
    const age = parseInt(opts.age, 10)
    const nearHint = age >= 40 && !add && [r, l].some(e => e.ok && e.kind === 'hyperopia')
      ? `อายุ ${age} ถ้าเป็นค่าแว่นอ่านหนังสือ = ยาวตามอายุ`
      : null
    let change = null
    if (prev) {
      const parts = []
      for (const [now, side] of [[r, 'r'], [l, 'l']]) {
        const before = eye(prev, side)
        if (now.ok && before.ok) parts.push(`${side.toUpperCase()} ${changeText(now.se, before.se)}`)
      }
      if (parts.length) change = { date: prev.date || '', text: parts.join(' · ') }
    }
    return {
      r,
      l,
      empty: !r.hasData && !l.hasData && !add && !r.va && !l.va,
      rSum: eyeSummary(r),
      lSum: eyeSummary(l),
      rText: eyeText(r),
      lText: eyeText(l),
      add,
      nearHint,
      aniso,
      change,
      ...conversions(r, l)
    }
  }

  return { parseDiopter, parseAxis, parseVA, fmt, eye, eyeSummary, eyeText, assess, contactPower, vertex }
})
