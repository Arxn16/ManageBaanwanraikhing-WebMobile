'use strict'

// ส่งออกข้อมูลเป็น CSV / Excel (คอลัมน์เหมือนเวอร์ชันเดิม)

const HEADERS = [
  'ลำดับ', 'วันที่', 'ชื่อ', 'เบอร์โทร', 'อายุ', 'อาชีพ', 'ที่อยู่',
  'R SPH', 'R CYL', 'R AX', 'R VA', 'R ADD', 'R PD/SH',
  'L SPH', 'L CYL', 'L AX', 'L VA', 'L ADD', 'L PD/SH',
  'กรอบแว่น', 'เลนส์', 'รายละเอียด', 'ราคา', 'มัดจำ', 'คงเหลือ'
]

const FIELDS = [
  'date', 'name', 'phone', 'age', 'job', 'address',
  'r_sph', 'r_cyl', 'r_ax', 'r_va', 'r_add', 'r_pd',
  'l_sph', 'l_cyl', 'l_ax', 'l_va', 'l_add', 'l_pd',
  'frame', 'lens', 'detail'
]

const MONEY = ['price', 'deposit', 'remain']

function toRows (records) {
  return records.map((r, i) => [
    i + 1,
    ...FIELDS.map(f => (r[f] === null || r[f] === undefined ? '' : String(r[f]))),
    ...MONEY.map(f => Number(r[f] || 0))
  ])
}

const BOM = '﻿'

function buildCsv (records) {
  const quote = v => `"${String(v).replace(/"/g, '""')}"`
  const lines = [HEADERS.map(quote).join(',')]
  for (const row of toRows(records)) lines.push(row.map(quote).join(','))
  return BOM + lines.join('\r\n') + '\r\n'
}

function buildExcelXml (records) {
  const encode = value => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
  const cell = v => typeof v === 'number'
    ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
    : `<Cell><Data ss:Type="String">${encode(v)}</Data></Cell>`
  const headerRow = `      <Row>${HEADERS.map(h => cell(h)).join('')}</Row>`
  const body = toRows(records).map(row => `      <Row>${row.map(cell).join('')}</Row>`).join('\n')
  return BOM + `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="สรุปยอดขาย">
    <Table>
${headerRow}
${body}
    </Table>
  </Worksheet>
</Workbook>
`
}

module.exports = { buildCsv, buildExcelXml, HEADERS }
