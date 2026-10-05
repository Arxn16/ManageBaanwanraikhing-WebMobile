'use strict'

// หา IP ของเครื่องนี้ในวง Wi-Fi เพื่อบอกว่าเครื่องอื่นในร้านต้องเปิดที่อยู่ไหน
// Android (Termux) หลายรุ่นไม่ให้ Node อ่านข้อมูล network (os.networkInterfaces() error)
// กรณีนั้นจะลองอ่านจากคำสั่ง ifconfig แทน ถ้ายังหาไม่ได้ก็คืนค่าว่าง ระบบทำงานต่อได้ตามปกติ

const os = require('node:os')
const { spawnSync } = require('node:child_process')

// ข้าม loopback, เน็ตมือถือ (rmnet/ccmni/...), VPN และ interface เสมือน เพราะเครื่องอื่นใน Wi-Fi เข้าไม่ถึง
const SKIP_IFACE = /^(lo|rmnet|ccmni|pdp|seth|v4-|dummy|tun|ppp|clat|sit|ip6|gre|wwan)/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

const usable = ip => IPV4.test(ip) && !ip.startsWith('127.') && !ip.startsWith('169.254.')

// อ่านผลของ ifconfig ได้ทั้งแบบ "inet 192.168.1.5" (Android/macOS/Linux) และ "inet addr:192.168.1.5" (Linux รุ่นเก่า)
function parseIfconfig (text) {
  const out = []
  let iface = ''
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\S/.test(line)) iface = line.split(/[:\s]/)[0]
    const m = line.match(/\binet (?:addr:)?(\d{1,3}(?:\.\d{1,3}){3})/)
    if (m && usable(m[1]) && !SKIP_IFACE.test(iface) && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

function fromInterfaces () {
  const out = []
  let ifaces
  try { ifaces = os.networkInterfaces() } catch (_) { return out }
  for (const [name, list] of Object.entries(ifaces || {})) {
    if (SKIP_IFACE.test(name)) continue
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && usable(a.address) && !out.includes(a.address)) out.push(a.address)
    }
  }
  return out
}

function fromIfconfig () {
  const r = spawnSync('ifconfig', [], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
  return parseIfconfig(r.stdout)
}

function lanAddresses () {
  const list = fromInterfaces()
  return list.length ? list : fromIfconfig()
}

module.exports = { lanAddresses, parseIfconfig }
