'use strict'

// ทดสอบการหา IP ของเครื่อง (ใช้บอกที่อยู่ให้เครื่องอื่นในร้าน): npm test

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { lanAddresses, parseIfconfig } = require('../server/net')

test('อ่าน IP จาก ifconfig ของ Android (Termux) ได้ และข้ามเน็ตมือถือ', () => {
  const termux = `Warning: cannot open /proc/net/dev (Permission denied). Limited output.
lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536
        inet 127.0.0.1  netmask 255.0.0.0
rmnet_data0: flags=65<UP,RUNNING>  mtu 1500
        inet 10.84.12.7  netmask 255.255.255.252
wlan0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 192.168.1.23  netmask 255.255.255.0  broadcast 192.168.1.255
        inet6 fe80::1c2b:3cff:fe4d:5e6f  prefixlen 64  scopeid 0x20<link>
tun0: flags=81<UP,POINTOPOINT,RUNNING>  mtu 1500
        inet 10.8.0.2  netmask 255.255.255.0`
  assert.deepEqual(parseIfconfig(termux), ['192.168.1.23'])
})

test('อ่าน IP จาก ifconfig รูปแบบอื่น (macOS, Linux รุ่นเก่า) ได้', () => {
  const mac = 'en0: flags=8863<UP,BROADCAST,SMART,RUNNING> mtu 1500\n\tinet 192.168.1.10 netmask 0xffffff00 broadcast 192.168.1.255\n'
  const old = 'wlan0     Link encap:Ethernet  HWaddr aa:bb:cc:dd:ee:ff\n          inet addr:192.168.0.5  Bcast:192.168.0.255  Mask:255.255.255.0\n'
  assert.deepEqual(parseIfconfig(mac), ['192.168.1.10'])
  assert.deepEqual(parseIfconfig(old), ['192.168.0.5'])
  assert.deepEqual(parseIfconfig(''), [])
  assert.deepEqual(parseIfconfig(undefined), [])
})

test('lanAddresses ไม่ทำให้ระบบดับ และคืนเป็นรายการ IP เสมอ', () => {
  const list = lanAddresses()
  assert.ok(Array.isArray(list))
  for (const ip of list) assert.match(ip, /^\d{1,3}(\.\d{1,3}){3}$/)
})
