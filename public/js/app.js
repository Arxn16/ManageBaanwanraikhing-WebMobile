/* บ้านแว่นไร่ขิง — โค้ดฝั่งหน้าเว็บ (ใช้ได้ทั้งมือถือและคอม) */
(function () {
  'use strict'

  // ---------- เครื่องมือทั่วไป ----------

  const $ = id => document.getElementById(id)
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c])
  const num = v => {
    const n = Number(String(v ?? '').replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  const money = v => num(v).toLocaleString('th-TH', { maximumFractionDigits: 2 })
  const baht = v => `${money(v)} บาท`
  const pad = n => String(n).padStart(2, '0')
  const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const parseISO = s => {
    const [y, m, d] = String(s).split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const val = id => ($(id) ? $(id).value : '')
  const setVal = (id, v) => { if ($(id)) $(id).value = v ?? '' }
  const setText = (id, v) => { if ($(id)) $(id).textContent = v }
  const show = (id, on = true) => { if ($(id)) $(id).classList.toggle('hidden', !on) }
  const debounce = (fn, ms) => {
    let t
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
  }
  const telLink = phone => phone
    ? `<a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}" class="text-pink-700 underline decoration-pink-200 underline-offset-2">${esc(phone)}</a>`
    : '-'

  const PERSONAL_FIELDS = ['name', 'date', 'age', 'job', 'phone', 'address']
  const RX_COLS = [['sph', 'SPH'], ['cyl', 'CYL'], ['ax', 'AX'], ['va', 'VA'], ['add', 'ADD'], ['pd', 'PD/SH']]
  const RX_FIELDS = ['r', 'l'].flatMap(side => RX_COLS.map(([k]) => `${side}_${k}`))
  const ORDER_FIELDS = ['detail', 'frame', 'lens']
  const TEXT_FIELDS = [...PERSONAL_FIELDS, ...RX_FIELDS, ...ORDER_FIELDS]

  function toast (message, type = 'ok') {
    let box = $('toast-box')
    if (!box) {
      box = document.createElement('div')
      box.id = 'toast-box'
      box.className = 'pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4'
      document.body.appendChild(box)
    }
    const el = document.createElement('div')
    el.className = `pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-center text-white shadow-lg ${type === 'error' ? 'bg-red-600' : 'bg-green-600'}`
    el.textContent = message
    box.appendChild(el)
    setTimeout(() => el.remove(), type === 'error' ? 5000 : 2500)
  }

  // ---------- เรียก server ----------

  let unloading = false
  window.addEventListener('pagehide', () => { unloading = true })
  window.addEventListener('beforeunload', () => { unloading = true })
  window.addEventListener('pageshow', () => { unloading = false })

  function goLogin () {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search)
  }

  async function request (method, url, body) {
    const opts = { method, headers: { 'X-Requested-With': 'bw' }, credentials: 'same-origin' }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    let res
    try {
      res = await fetch(url, opts)
    } catch (e) {
      const err = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่าต่อ Wi-Fi ของร้านอยู่')
      err.silent = unloading // ยกเลิกเพราะกำลังเปลี่ยนหน้า ไม่ต้องแจ้ง
      throw err
    }
    if (res.status === 401 && !url.startsWith('/api/login')) {
      goLogin()
      throw new Error('กรุณาเข้าสู่ระบบใหม่')
    }
    let data = null
    try { data = await res.json() } catch (e) { /* ไม่ใช่ JSON */ }
    if (!res.ok) throw new Error((data && data.error) || `เกิดข้อผิดพลาด (${res.status})`)
    return data
  }

  const api = {
    get: url => request('GET', url),
    post: (url, body) => request('POST', url, body ?? {}),
    put: (url, body) => request('PUT', url, body ?? {}),
    del: url => request('DELETE', url)
  }

  // ให้ปุ่มกดซ้ำไม่ได้ระหว่างรอ และแสดงข้อความเมื่อผิดพลาด
  function action (fn) {
    return async function (...args) {
      const btn = args[0] instanceof HTMLElement ? args[0] : null
      if (btn) {
        if (btn.disabled) return
        btn.disabled = true
      }
      try {
        return await fn.apply(this, args)
      } catch (err) {
        if (err && err.silent) return
        console.error(err)
        if (err && err.message) toast(err.message, 'error')
      } finally {
        if (btn) btn.disabled = false
      }
    }
  }

  function download (url) {
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // ---------- ฟอร์ม ----------

  function rxEditorHtml (prefix = '') {
    const eye = (side, label) => `
      <div class="rx-row">
        <div class="rx-eye">${side} <span class="text-sm font-normal text-pink-700">${label}</span></div>
        <div class="grid flex-1 grid-cols-3 gap-2 md:grid-cols-6">
          ${RX_COLS.map(([k, title]) => `
            <label class="rx-field">${title}
              <input id="${prefix}${side.toLowerCase()}_${k}" ${k === 'ax' ? 'inputmode="numeric"' : ''} autocomplete="off" autocapitalize="off" spellcheck="false">
            </label>`).join('')}
        </div>
      </div>`
    return `
      <div class="rx-box">
        <h2 class="mb-1 font-semibold text-pink-900">ค่าสายตา</h2>
        ${eye('R', '(ขวา)')}
        ${eye('L', '(ซ้าย)')}
      </div>`
  }

  function mountRxEditor (containerId, prefix = '') {
    const el = $(containerId)
    if (el) el.innerHTML = rxEditorHtml(prefix)
  }

  function readFields (fields, prefix = '') {
    const out = {}
    for (const f of fields) out[f] = val(prefix + f).trim()
    return out
  }

  function fillFields (fields, record, prefix = '') {
    for (const f of fields) setVal(prefix + f, record ? record[f] : '')
  }

  function calculateRemain (prefix = '') {
    setVal(prefix + 'remain', num(val(prefix + 'price')) - num(val(prefix + 'deposit')))
  }

  // ---------- หน้าต่างรายละเอียดลูกค้า (ใช้ร่วมกันหลายหน้า) ----------

  let afterDataChange = () => {}
  let detailCustomerId = null
  let editingVisit = null

  function openModal (modal) {
    modal.classList.remove('hidden')
    document.body.classList.add('overflow-hidden')
  }

  function closeModal (modal) {
    if (!modal) return
    modal.classList.add('hidden')
    const anyOpen = [...document.querySelectorAll('[data-modal]')].some(m => !m.classList.contains('hidden'))
    if (!anyOpen) document.body.classList.remove('overflow-hidden')
  }

  function ensureDetailModal () {
    let modal = $('detail-modal')
    if (modal) return modal
    modal = document.createElement('div')
    modal.id = 'detail-modal'
    modal.dataset.modal = ''
    modal.className = 'fixed inset-0 z-40 hidden flex items-end justify-center bg-black/50 sm:items-center sm:p-4'
    modal.innerHTML = `
      <div class="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-3xl">
        <div class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-pink-100 bg-white px-4 py-3 sm:px-6">
          <h2 class="text-xl font-bold text-pink-900">รายละเอียดลูกค้า</h2>
          <button type="button" data-close class="rounded-full bg-pink-100 px-4 py-2 text-pink-700 hover:bg-pink-200">ปิด</button>
        </div>
        <div id="detail-content" class="p-4 sm:p-6"></div>
      </div>`
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-close]')) closeCustomerDetail()
    })
    document.body.appendChild(modal)
    return modal
  }

  function renderVisit (v, index) {
    const cell = x => `<td class="border border-pink-200 px-1 py-2 text-center sm:px-2">${esc(x)}</td>`
    const eyeRow = side => `
      <tr>
        <td class="border border-pink-200 px-1 py-2 text-center font-semibold sm:px-2">${side.toUpperCase()}</td>
        ${RX_COLS.map(([k]) => cell(v[`${side}_${k}`])).join('')}
      </tr>`
    const remain = num(v.remain)
    return `
      <div class="mb-4 rounded-2xl border border-pink-200 bg-white p-3 last:mb-0 sm:p-4">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-lg font-semibold text-pink-900">ครั้งที่ ${index + 1}</p>
            <p class="text-sm text-gray-600">วันที่ ${esc(v.date) || '-'} · ราคา ${baht(v.price)}</p>
          </div>
          <button type="button" onclick="editVisitRecord(${v.id})" class="btn-sm bg-blue-500 hover:bg-blue-600">แก้ไข</button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full border-collapse text-sm text-pink-900">
            <thead>
              <tr class="bg-pink-100">
                <th class="border border-pink-200 px-1 py-2 text-xs sm:px-2 sm:text-sm">ตา</th>
                ${RX_COLS.map(([, t]) => `<th class="border border-pink-200 px-1 py-2 text-xs sm:px-2 sm:text-sm">${t}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${eyeRow('r')}${eyeRow('l')}</tbody>
          </table>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-800 sm:text-base">
          <div class="whitespace-pre-line"><span class="font-semibold">หมายเหตุ / รายละเอียด:</span> ${esc(v.detail) || '-'}</div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div><span class="font-semibold">กรอบแว่น:</span> ${esc(v.frame) || '-'}</div>
            <div><span class="font-semibold">เลนส์:</span> ${esc(v.lens) || '-'}</div>
            <div><span class="font-semibold">มัดจำ:</span> ${money(v.deposit)} · <span class="font-semibold">คงเหลือ:</span>
              <span class="${remain > 0 ? 'font-semibold text-red-600' : 'text-green-700'}">${money(remain)}</span> บาท</div>
          </div>
        </div>
      </div>`
  }

  async function showCustomerDetail (id) {
    const { customer: c, visits } = await api.get(`/api/customers/${id}/visits`)
    const modal = ensureDetailModal()
    detailCustomerId = c.id
    const totalRemain = visits.reduce((s, v) => s + num(v.remain), 0)
    const info = [['วันที่', esc(c.date) || '-'], ['ชื่อ', esc(c.name) || '-'], ['เบอร์โทร', telLink(c.phone)],
      ['อายุ', esc(c.age) || '-'], ['อาชีพ', esc(c.job) || '-'], ['ที่อยู่', esc(c.address) || '-']]
    $('detail-content').innerHTML = `
      <div class="grid grid-cols-1 gap-4">
        <div class="grid grid-cols-1 gap-2 text-gray-800 sm:grid-cols-2">
          ${info.map(([k, v]) => `<div><span class="font-semibold">${k}:</span> ${v}</div>`).join('')}
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="/edit-customer.html?id=${c.id}" class="btn-sm bg-blue-500 hover:bg-blue-600">แก้ไขข้อมูลลูกค้า</a>
          <a href="/edit-customer.html?id=${c.id}&new=1" class="btn-sm bg-indigo-500 hover:bg-indigo-600">➕ เพิ่มการมาครั้งใหม่</a>
        </div>
        <div class="rounded-3xl border border-pink-200 bg-pink-50 p-3 sm:p-4">
          <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-lg font-bold text-pink-900">ประวัติค่าสายตา (${visits.length} ครั้ง)</h3>
            ${totalRemain > 0 ? `<span class="text-sm font-semibold text-red-600">ค้างชำระรวม ${baht(totalRemain)}</span>` : ''}
          </div>
          ${visits.map(renderVisit).join('')}
        </div>
      </div>`
    openModal(modal)
  }

  function closeCustomerDetail () {
    closeModal($('detail-modal'))
    detailCustomerId = null
  }

  function ensureEditVisitModal () {
    let modal = $('edit-visit-modal')
    if (modal) return modal
    modal = document.createElement('div')
    modal.id = 'edit-visit-modal'
    modal.dataset.modal = ''
    modal.className = 'fixed inset-0 z-50 hidden flex items-end justify-center bg-black/50 sm:items-center sm:p-4'
    modal.innerHTML = `
      <div class="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-w-3xl sm:rounded-3xl sm:p-8">
        <h2 class="mb-4 text-xl font-bold text-pink-900 sm:text-2xl">แก้ไขข้อมูลการมาครั้งนี้</h2>
        <div class="mb-4 grid grid-cols-2 gap-3">
          <label class="field col-span-2 sm:col-span-1">วันที่<input type="date" id="ev-date"></label>
          <label class="field">ราคา<input id="ev-price" inputmode="decimal" oninput="calculateRemain('ev-')"></label>
          <label class="field">มัดจำ<input id="ev-deposit" inputmode="decimal" oninput="calculateRemain('ev-')"></label>
          <label class="field">คงเหลือ<input id="ev-remain" readonly tabindex="-1"></label>
        </div>
        ${rxEditorHtml('ev-')}
        <label class="field mt-4">หมายเหตุ / รายละเอียด<textarea id="ev-detail" rows="3"></textarea></label>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="field">กรอบแว่น<input id="ev-frame"></label>
          <label class="field">เลนส์<input id="ev-lens"></label>
        </div>
        <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <button type="button" id="ev-delete" onclick="deleteVisitRecord(this)" class="btn hidden bg-red-500 hover:bg-red-600">🗑️ ลบครั้งนี้</button>
          <div class="flex flex-col-reverse gap-3 sm:ml-auto sm:flex-row">
            <button type="button" onclick="closeEditVisitModal()" class="btn-light">ยกเลิก</button>
            <button type="button" onclick="updateVisitRecord(this)" class="btn bg-blue-500 hover:bg-blue-600">บันทึก</button>
          </div>
        </div>
      </div>`
    modal.addEventListener('click', e => { if (e.target === modal) closeEditVisitModal() })
    document.body.appendChild(modal)
    return modal
  }

  // แก้บั๊กเดิม: ปุ่มบันทึกจำรหัสการมาครั้งแรกที่เปิดไว้ และช่องรายละเอียดถูกล้างทุกครั้งที่แก้
  async function editVisitRecord (visitId) {
    const { visit } = await api.get(`/api/visits/${visitId}`)
    const modal = ensureEditVisitModal()
    editingVisit = visit
    setVal('ev-date', visit.date)
    setVal('ev-price', visit.price ?? 0)
    setVal('ev-deposit', visit.deposit ?? 0)
    calculateRemain('ev-')
    fillFields([...RX_FIELDS, ...ORDER_FIELDS], visit, 'ev-')
    show('ev-delete', visit.parent_id !== null)
    openModal(modal)
  }

  function closeEditVisitModal () {
    closeModal($('edit-visit-modal'))
    editingVisit = null
  }

  async function refreshDetail () {
    if (detailCustomerId) await showCustomerDetail(detailCustomerId)
    await afterDataChange()
  }

  async function updateVisitRecord () {
    if (!editingVisit) return
    const body = readFields(['date', ...RX_FIELDS, ...ORDER_FIELDS], 'ev-')
    body.price = val('ev-price')
    body.deposit = val('ev-deposit')
    await api.put(`/api/visits/${editingVisit.id}`, body)
    closeEditVisitModal()
    toast('บันทึกการแก้ไขแล้ว')
    await refreshDetail()
  }

  async function deleteVisitRecord () {
    if (!editingVisit) return
    if (!confirm(`ลบข้อมูลการมาวันที่ ${editingVisit.date || '-'} ใช่หรือไม่?`)) return
    await api.del(`/api/visits/${editingVisit.id}`)
    closeEditVisitModal()
    toast('ลบข้อมูลการมาครั้งนี้แล้ว')
    await refreshDetail()
  }

  async function deleteCustomer (id, name, visitCount) {
    const extra = visitCount > 1 ? ` และประวัติการมาทั้งหมด ${visitCount} ครั้ง` : ''
    if (!confirm(`ต้องการลบข้อมูลลูกค้า "${name || '-'}"${extra} ใช่หรือไม่?`)) return false
    await api.del(`/api/customers/${id}`)
    toast('ลบข้อมูลลูกค้าแล้ว')
    return true
  }

  // ---------- หน้าเมนู ----------

  async function initMenu () {
    const me = await api.get('/api/me')
    show('logout-btn', me.authRequired)
    try {
      const s = await api.get('/api/backup/status')
      setText('backup-status', s.latest
        ? `สำรองอัตโนมัติล่าสุด ${new Date(s.latest.time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })} (เก็บไว้ ${s.count} ไฟล์)`
        : 'ยังไม่มีไฟล์สำรองอัตโนมัติ')
    } catch (e) {
      setText('backup-status', '')
    }
  }

  async function logout () {
    await api.post('/api/logout')
    location.href = '/login.html'
  }

  // ---------- หน้ารายชื่อลูกค้า ----------

  const list = { page: 1, search: '', seq: 0 }

  function customerButtons (c, small) {
    const cls = small ? 'btn-sm w-full px-1' : 'btn-sm'
    const nameArg = esc(JSON.stringify(c.name || ''))
    return `
      <button type="button" onclick="showCustomerDetail(${c.id})" class="${cls} bg-pink-500 hover:bg-pink-600">ดู</button>
      <a href="/edit-customer.html?id=${c.id}" class="${cls} bg-blue-500 hover:bg-blue-600">แก้ไข</a>
      <a href="/edit-customer.html?id=${c.id}&new=1" class="${cls} bg-indigo-500 hover:bg-indigo-600">${small ? '+ครั้งใหม่' : 'เพิ่มครั้งใหม่'}</a>
      <button type="button" onclick="deleteCustomerFromList(this, ${c.id}, ${nameArg}, ${Number(c.visit_count) || 1})" class="${cls} bg-red-500 hover:bg-red-600">ลบ</button>`
  }

  function visitBadge (c) {
    const n = Number(c.visit_count) || 1
    return n > 1 ? `<span class="ml-1 whitespace-nowrap rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700">มา ${n} ครั้ง</span>` : ''
  }

  function renderPagination (data) {
    const el = $('pagination')
    if (!el) return
    const { page, pages } = data
    if (pages <= 1) { el.innerHTML = ''; return }
    const nums = new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages))
    const sorted = [...nums].sort((a, b) => a - b)
    const btn = (label, target, active = false, disabled = false) => `
      <button type="button" ${disabled ? 'disabled' : `onclick="loadCustomers(${target})"`}
        class="min-w-[2.75rem] rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-pink-600 text-white' : 'border border-pink-200 bg-white text-pink-700 hover:bg-pink-100'} disabled:opacity-40">${label}</button>`
    let html = btn('‹', page - 1, false, page === 1)
    let prev = 0
    for (const n of sorted) {
      if (n - prev > 1) html += '<span class="px-1 py-2 text-gray-400">…</span>'
      html += btn(n, n, n === page)
      prev = n
    }
    html += btn('›', page + 1, false, page === pages)
    el.innerHTML = html
  }

  async function loadCustomers (page = list.page, search = list.search) {
    const seq = ++list.seq
    const data = await api.get(`/api/customers?page=${page}&search=${encodeURIComponent(search)}`)
    if (seq !== list.seq) return // มีคำค้นใหม่กว่าแล้ว
    list.page = data.page
    list.search = search
    setText('customer-total', `ทั้งหมด ${data.total.toLocaleString('th-TH')} ราย`)

    const empty = search ? `ไม่พบลูกค้าที่ตรงกับ "${esc(search)}"` : 'ยังไม่มีข้อมูลลูกค้า'
    const table = $('customer-list')
    if (table) {
      table.innerHTML = data.rows.length ? data.rows.map((c, i) => `
        <tr class="hover:bg-pink-50">
          <td class="border p-2 text-center">${data.offset + i + 1}</td>
          <td class="whitespace-nowrap border p-2">${esc(c.date)}</td>
          <td class="border p-2">${esc(c.name)}${visitBadge(c)}</td>
          <td class="whitespace-nowrap border p-2">${telLink(c.phone)}</td>
          <td class="border p-2 text-right">${money(c.price)}</td>
          <td class="border p-2 text-right ${num(c.remain) > 0 ? 'font-semibold text-red-600' : ''}">${money(c.remain)}</td>
          <td class="border p-2"><div class="flex flex-wrap justify-center gap-2">${customerButtons(c, false)}</div></td>
        </tr>`).join('')
        : `<tr><td colspan="7" class="border p-6 text-center text-gray-500">${empty}</td></tr>`
    }
    const cards = $('customer-cards')
    if (cards) {
      cards.innerHTML = data.rows.length ? data.rows.map((c, i) => `
        <div class="rounded-2xl border border-pink-100 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs text-gray-400">#${data.offset + i + 1} · ${esc(c.date) || '-'}</p>
              <p class="break-words text-lg font-semibold text-gray-900">${esc(c.name) || '-'}${visitBadge(c)}</p>
              <p>${telLink(c.phone)}</p>
            </div>
            <div class="shrink-0 text-right text-sm">
              <p class="text-gray-500">ราคา <span class="font-semibold text-gray-900">${money(c.price)}</span></p>
              <p class="${num(c.remain) > 0 ? 'font-semibold text-red-600' : 'text-green-700'}">คงเหลือ ${money(c.remain)}</p>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-4 gap-2">${customerButtons(c, true)}</div>
        </div>`).join('')
        : `<p class="rounded-2xl bg-white p-6 text-center text-gray-500">${empty}</p>`
    }
    renderPagination(data)
  }

  const searchCustomers = debounce(() => {
    action(loadCustomers)(1, val('search-box').trim())
  }, 250)

  async function deleteCustomerFromList (btn, id, name, visitCount) {
    if (await deleteCustomer(id, name, visitCount)) await loadCustomers()
  }

  async function initCustomerList () {
    afterDataChange = () => loadCustomers()
    await loadCustomers(1, '')
  }

  // ---------- หน้าเพิ่มลูกค้า ----------

  function resetAddForm () {
    fillFields(TEXT_FIELDS, null)
    setVal('price', '')
    setVal('deposit', '')
    setVal('remain', '')
    setVal('date', isoDate())
  }

  async function saveCustomer () {
    const body = readFields(TEXT_FIELDS)
    body.price = val('price')
    body.deposit = val('deposit')
    if (!body.name) {
      toast('กรุณากรอกชื่อลูกค้า', 'error')
      $('name').focus()
      return
    }
    const { id } = await api.post('/api/customers', body)
    toast('บันทึกข้อมูลสำเร็จ')
    const result = $('result')
    if (result) {
      result.innerHTML = `บันทึก "${esc(body.name)}" สำเร็จ ·
        <button type="button" onclick="showCustomerDetail(${id})" class="underline">ดูข้อมูล</button>`
    }
    resetAddForm()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function initAddCustomer () {
    mountRxEditor('rx-editor')
    setVal('date', isoDate())
  }

  // ---------- หน้าแก้ไข / บันทึกครั้งใหม่ ----------

  const edit = { id: null, newVisit: false, customer: null, visits: [] }

  async function initEditCustomer () {
    const params = new URLSearchParams(location.search)
    const id = Number(params.get('id'))
    edit.newVisit = params.get('new') === '1'
    if (!id) {
      toast('ไม่พบรหัสลูกค้า', 'error')
      setTimeout(() => { location.href = '/customer-list.html' }, 1200)
      return
    }
    mountRxEditor('rx-editor')
    afterDataChange = async () => {
      edit.visits = (await api.get(`/api/customers/${edit.id}/visits`)).visits
    }
    const { customer, visits } = await api.get(`/api/customers/${id}/visits`)
    edit.id = customer.id
    edit.customer = customer
    edit.visits = visits
    fillFields(PERSONAL_FIELDS, customer)

    document.title = edit.newVisit ? 'บันทึกการมาครั้งใหม่' : 'แก้ไขข้อมูลลูกค้า'
    setText('page-title', edit.newVisit ? 'บันทึกการมาครั้งใหม่' : 'แก้ไขข้อมูลลูกค้า')
    setText('page-subtitle', edit.newVisit
      ? `${customer.name || ''} · มาแล้ว ${visits.length} ครั้ง กรอกค่าสายตาครั้งนี้แล้วกดบันทึก`
      : 'แก้ไขข้อมูลส่วนตัวแล้วกดบันทึก ส่วนค่าสายตาแต่ละครั้งแก้ได้ที่ปุ่ม "ดูประวัติ"')
    setText('date-label', edit.newVisit ? 'วันที่มาครั้งนี้' : 'วันที่ (ครั้งแรก)')
    show('visit-section', edit.newVisit)
    show('new-visit-actions', edit.newVisit)
    show('edit-actions', !edit.newVisit)
    show('copy-last-rx', edit.newVisit && visits.length > 0)
    if (edit.newVisit) setVal('date', isoDate())
    const link = $('new-visit-link')
    if (link) link.href = `/edit-customer.html?id=${edit.id}&new=1`
  }

  function showEditHistory () {
    if (edit.id) return showCustomerDetail(edit.id)
  }

  function copyLastRx () {
    const last = edit.visits[edit.visits.length - 1]
    if (!last) return
    fillFields(RX_FIELDS, last)
    toast(`คัดลอกค่าสายตาจากวันที่ ${last.date || '-'} แล้ว`)
  }

  async function updateCustomer () {
    const body = readFields(PERSONAL_FIELDS)
    if (!body.name) { toast('กรุณากรอกชื่อลูกค้า', 'error'); return }
    await api.put(`/api/customers/${edit.id}`, body)
    toast('บันทึกการแก้ไขสำเร็จ')
    setTimeout(() => { location.href = '/customer-list.html' }, 800)
  }

  async function saveAsNewVisit () {
    const body = readFields(TEXT_FIELDS)
    body.price = val('price')
    body.deposit = val('deposit')
    if (!body.name) { toast('กรุณากรอกชื่อลูกค้า', 'error'); return }
    await api.post(`/api/customers/${edit.id}/visits`, body)
    toast('บันทึกเป็นครั้งใหม่สำเร็จ')
    setTimeout(() => { location.href = '/customer-list.html' }, 800)
  }

  async function deleteCustomerFromEdit () {
    const c = edit.customer
    if (!c) return
    if (await deleteCustomer(c.id, c.name, edit.visits.length)) {
      setTimeout(() => { location.href = '/customer-list.html' }, 600)
    }
  }

  // ---------- หน้าแดชบอร์ดยอดขาย ----------

  const dash = { dates: null, weekOffset: 0 }

  async function loadSalesDashboard () {
    const d = await api.get('/api/dashboard')
    dash.dates = d.dates
    setText('today-sales', baht(d.today.sales))
    setText('today-customers', `${d.today.count} คน`)
    setText('week-sales', baht(d.week.sales))
    setText('month-sales', baht(d.month.sales))
    setText('year-sales', baht(d.year.sales))
    setText('pending-amount', baht(d.pending.amount))
    setText('pending-count', `${d.pending.count} ใบยังค้าง · จ่ายครบ ${d.paidCount} ใบ`)
    setText('summary-total-revenue', baht(d.totals.revenue))
    setText('summary-paid-amount', baht(d.totals.paid))
    setText('summary-total-remain', baht(d.totals.remain))
    setText('summary-total-orders', `${d.totals.orders} ใบ`)
    setText('dashboard-updated', `ข้อมูล ณ ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`)
  }

  function updateDashboardFilterInputs () {
    const type = val('dashboard-filter-type')
    show('filter-day-wrap', type === 'day')
    show('filter-month-wrap', type === 'month')
    show('filter-year-wrap', type === 'year')
    show('filter-range-wrap', type === 'range')
  }

  function currentFilterRange () {
    const D = dash.dates
    switch (val('dashboard-filter-type')) {
      case 'day': {
        const d = val('filter-day') || D.today
        return [d, d]
      }
      case 'week':
        return [D.weekStart, D.weekEnd]
      case 'month': {
        const m = /^\d{4}-\d{2}$/.test(val('filter-month')) ? val('filter-month') : D.today.slice(0, 7)
        const [y, mo] = m.split('-').map(Number)
        return [`${y}-${pad(mo)}-01`, `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`]
      }
      case 'year': {
        let y = parseInt(val('filter-year'), 10) || Number(D.today.slice(0, 4))
        if (y > 2400) y -= 543 // พิมพ์ปี พ.ศ. มา
        return [`${y}-01-01`, `${y}-12-31`]
      }
      case 'range': {
        const a = val('filter-range-start') || D.today
        const b = val('filter-range-end') || a
        return a <= b ? [a, b] : [b, a]
      }
      default:
        return [D.today, D.today]
    }
  }

  async function loadDashboardDetails () {
    if (!dash.dates) return
    const [from, to] = currentFilterRange()
    const data = await api.get(`/api/sales?from=${from}&to=${to}`)
    setText('dashboard-detail-range', from === to ? `วันที่ ${from}` : `${from} ถึง ${to}`)
    setText('dashboard-detail-count', `${data.count} รายการ`)
    setText('dashboard-detail-total', baht(data.total))
    setText('dashboard-detail-remain', baht(data.remain))
    const cards = $('dashboard-detail-cards')
    if (cards) {
      cards.innerHTML = data.rows.length ? data.rows.map((r, i) => saleCard(r, `${i + 1} · ${esc(r.date) || '-'}`)).join('')
        : '<p class="rounded-2xl bg-gray-50 p-6 text-center text-gray-500">ไม่พบข้อมูลในช่วงนี้</p>'
    }
    const tbody = $('dashboard-detail-table-body')
    if (!tbody) return
    tbody.innerHTML = data.rows.length ? data.rows.map((r, i) => `
      <tr class="border-b border-gray-100 hover:bg-gray-50">
        <td class="p-3">${i + 1}</td>
        <td class="whitespace-nowrap p-3">${esc(r.date)}</td>
        <td class="p-3">${esc(r.name)}</td>
        <td class="whitespace-nowrap p-3">${telLink(r.phone)}</td>
        <td class="whitespace-nowrap p-3 text-right">${money(r.price)}</td>
        <td class="whitespace-nowrap p-3 text-right">${money(r.deposit)}</td>
        <td class="whitespace-nowrap p-3 text-right ${num(r.remain) > 0 ? 'font-semibold text-red-600' : 'text-green-700'}">${money(r.remain)}</td>
        <td class="p-3"><button type="button" onclick="showCustomerDetail(${r.id})" class="btn-sm bg-pink-500 hover:bg-pink-600">ดู</button></td>
      </tr>`).join('')
      : '<tr><td colspan="8" class="p-6 text-center text-gray-500">ไม่พบข้อมูลในช่วงนี้</td></tr>'
  }

  function saleCard (r, caption) {
    const remain = num(r.remain)
    const status = r.remain === undefined ? ''
      : `<p class="${remain > 0 ? 'font-semibold text-red-600' : 'text-green-700'}">${remain > 0 ? `ค้าง ${money(remain)}` : 'จ่ายครบ'}</p>`
    return `
      <button type="button" onclick="showCustomerDetail(${r.id})" class="w-full rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm active:bg-gray-50">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs text-gray-400">${caption}</p>
            <p class="break-words font-semibold text-gray-900">${esc(r.name) || '-'}</p>
            <p class="text-sm text-gray-500">${esc(r.phone) || '-'}</p>
          </div>
          <div class="shrink-0 text-right text-sm">
            <p class="font-semibold text-gray-900">${baht(r.price)}</p>
            ${status}
          </div>
        </div>
      </button>`
  }

  async function loadWeeklySales () {
    if (!dash.dates) return
    const monday = parseISO(dash.dates.weekStart)
    monday.setDate(monday.getDate() + dash.weekOffset * 7)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
      return { date: isoDate(d), label: d.toLocaleDateString('th-TH', { weekday: 'long' }) }
    })
    const data = await api.get(`/api/sales/daily?from=${days[0].date}&to=${days[6].date}`)
    const byDate = Object.fromEntries(data.rows.map(r => [r.date, r]))
    setText('week-label', dash.weekOffset === 0 ? 'สัปดาห์นี้ (จันทร์–อาทิตย์)' : `${days[0].date} ถึง ${days[6].date}`)
    let weekTotal = 0
    let weekCount = 0
    const rows = days.map(d => {
      const r = byDate[d.date] || { count: 0, total: 0 }
      weekTotal += num(r.total)
      weekCount += r.count
      const isToday = d.date === dash.dates.today
      return `
        <tr class="cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${isToday ? 'bg-pink-50' : ''}" onclick="openDailySales('${d.date}')">
          <td class="whitespace-nowrap p-3 font-medium">${d.label}${isToday ? ' <span class="text-xs text-pink-600">(วันนี้)</span>' : ''}
            <div class="text-xs text-gray-400">${d.date}</div></td>
          <td class="whitespace-nowrap p-3">${baht(r.total)}</td>
          <td class="whitespace-nowrap p-3">${r.count} รายการ</td>
          <td class="hidden whitespace-nowrap p-3 font-medium text-blue-600 sm:table-cell">ดู →</td>
        </tr>`
    }).join('')
    const tbody = $('recent-orders-body')
    if (tbody) {
      tbody.innerHTML = rows + `
        <tr class="bg-gray-50 font-semibold">
          <td class="p-3">รวม</td>
          <td class="whitespace-nowrap p-3">${baht(weekTotal)}</td>
          <td class="whitespace-nowrap p-3">${weekCount} รายการ</td>
          <td class="hidden p-3 sm:table-cell"></td>
        </tr>`
    }
  }

  function shiftWeek (delta) {
    dash.weekOffset = delta === 0 ? 0 : dash.weekOffset + delta
    return loadWeeklySales()
  }

  async function openDailySales (date) {
    setVal('dashboard-filter-type', 'day')
    setVal('filter-day', date)
    updateDashboardFilterInputs()
    await loadDashboardDetails()
    const section = $('filter-section')
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function loadRecentCustomers () {
    const { rows } = await api.get('/api/recent?limit=5')
    const cards = $('recent-customers-cards')
    if (cards) {
      cards.innerHTML = rows.length ? rows.map(r => saleCard(r, `ครั้งล่าสุด ${esc(r.date) || '-'}`)).join('')
        : '<p class="rounded-2xl bg-gray-50 p-6 text-center text-gray-500">ไม่พบข้อมูล</p>'
    }
    const tbody = $('recent-customers-body')
    if (!tbody) return
    tbody.innerHTML = rows.length ? rows.map(r => `
      <tr class="cursor-pointer border-b border-gray-100 hover:bg-gray-50" onclick="showCustomerDetail(${r.id})">
        <td class="p-3">${esc(r.name)}</td>
        <td class="whitespace-nowrap p-3">${esc(r.phone) || '-'}</td>
        <td class="whitespace-nowrap p-3">${baht(r.price)}</td>
        <td class="whitespace-nowrap p-3">${esc(r.date) || '-'}</td>
      </tr>`).join('')
      : '<tr><td colspan="4" class="p-6 text-center text-gray-500">ไม่พบข้อมูล</td></tr>'
  }

  function exportSales () {
    download(val('exportType') === 'csv' ? '/api/export/csv' : '/api/export/xls')
  }

  function exportToCSV () {
    download('/api/export/csv')
  }

  async function refreshDashboard () {
    await loadSalesDashboard()
    await Promise.all([loadWeeklySales(), loadRecentCustomers(), loadDashboardDetails()])
  }

  async function initSalesDashboard () {
    afterDataChange = refreshDashboard
    await loadSalesDashboard()
    setVal('filter-day', dash.dates.today)
    setVal('filter-month', dash.dates.today.slice(0, 7))
    setVal('filter-year', dash.dates.today.slice(0, 4))
    setVal('filter-range-start', dash.dates.monthStart)
    setVal('filter-range-end', dash.dates.today)
    updateDashboardFilterInputs()
    await Promise.all([loadWeeklySales(), loadRecentCustomers(), loadDashboardDetails()])
  }

  // ---------- หน้าเข้าสู่ระบบ ----------

  function safeNext (next) {
    return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/'
  }

  async function initLogin () {
    const next = safeNext(new URLSearchParams(location.search).get('next'))
    const me = await api.get('/api/me').catch(() => null)
    if (me && (me.authenticated || !me.authRequired)) {
      location.replace(next)
      return
    }
    const form = $('login-form')
    const pin = $('pin')
    pin.focus()
    form.addEventListener('submit', async e => {
      e.preventDefault()
      const btn = form.querySelector('button[type=submit]')
      btn.disabled = true
      setText('login-error', '')
      try {
        await api.post('/api/login', { pin: pin.value })
        location.replace(next)
      } catch (err) {
        setText('login-error', err.message)
        pin.select()
      } finally {
        btn.disabled = false
      }
    })
  }

  // ---------- เริ่มทำงาน ----------

  const pages = {
    menu: initMenu,
    'customer-list': initCustomerList,
    'add-customer': initAddCustomer,
    'edit-customer': initEditCustomer,
    'sales-dashboard': initSalesDashboard,
    login: initLogin
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if ($('edit-visit-modal') && !$('edit-visit-modal').classList.contains('hidden')) closeEditVisitModal()
    else if ($('detail-modal') && !$('detail-modal').classList.contains('hidden')) closeCustomerDetail()
  })

  document.addEventListener('DOMContentLoaded', () => {
    const init = pages[document.body.dataset.page]
    if (init) action(init)()
  })

  // ให้ปุ่มใน HTML (onclick) เรียกใช้ได้
  Object.assign(window, {
    calculateRemain,
    showCustomerDetail: action(showCustomerDetail),
    closeCustomerDetail,
    editVisitRecord: action(editVisitRecord),
    closeEditVisitModal,
    updateVisitRecord: action(updateVisitRecord),
    deleteVisitRecord: action(deleteVisitRecord),
    loadCustomers: action(loadCustomers),
    filterCustomers: searchCustomers,
    deleteCustomerFromList: action(deleteCustomerFromList),
    exportToCSV,
    saveCustomer: action(saveCustomer),
    copyLastRx,
    showEditHistory: action(showEditHistory),
    updateCustomer: action(updateCustomer),
    saveAsNewVisit: action(saveAsNewVisit),
    deleteCustomerFromEdit: action(deleteCustomerFromEdit),
    updateDashboardFilterInputs,
    loadDashboardDetails: action(loadDashboardDetails),
    shiftWeek: action(shiftWeek),
    openDailySales: action(openDailySales),
    loadRecentCustomers: action(loadRecentCustomers),
    refreshDashboard: action(refreshDashboard),
    exportSales,
    logout: action(logout)
  })
})()
