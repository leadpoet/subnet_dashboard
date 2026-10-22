import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildWorkbook, buildXlsxArrayBuffer, downloadXlsx } from '../src/lib/xlsx-export.ts'

const headers = ['Company', 'Revenue', 'Active', 'Note', 'As Of']
const rows = [
  ['Acme', 12.5, true, '=HYPERLINK("https://example.test","click")', new Date('2026-10-22T00:00:00Z')],
  ['West', 0, false, '+SUM(1,2)', null],
  ['Third', -4, true, '@user', undefined],
  ['Fourth', 1, false, '-1+2', null],
]
const sheetName = 'Q4/[2026]?:'

const originalTimezone = process.env.TZ
try {
  // The existing exporter uses the local Date string for width and SheetJS
  // serializes local time. Keep both behaviors covered in CI and on laptops.
  for (const { zone, dateWidth, dateSerial, dateDisplay } of [
    { zone: 'UTC', dateWidth: 60, dateSerial: 46317, dateDisplay: '10/22/26' },
    { zone: 'America/Los_Angeles', dateWidth: 59, dateSerial: 46316.708333333336, dateDisplay: '10/21/26' },
  ]) {
    process.env.TZ = zone
    const workbook = buildWorkbook(headers, rows, sheetName)
    assert.deepEqual(workbook.SheetNames, ['Q4  2026'])
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    assert.deepEqual(sheet['!cols'], [
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 44 }, { wch: dateWidth },
    ], `${zone} column widths`)
    assert.ok(Math.abs(sheet.E2.v - dateSerial) < 1e-8, `${zone} date serial`)
    assert.equal(sheet.E2.w, dateDisplay, `${zone} displayed date`)

    const array = buildXlsxArrayBuffer(headers, rows, sheetName)
    const decoded = XLSX.read(array, { type: 'array', cellDates: false, cellNF: true })
    const exported = decoded.Sheets[decoded.SheetNames[0]]
    for (const address of ['A1', 'B2', 'C2', 'D2', 'E2', 'B3', 'C3', 'D3', 'D4', 'D5']) {
      assert.equal(exported[address].t, sheet[address].t, `${zone} ${address} type`)
      assert.equal(exported[address].v, sheet[address].v, `${zone} ${address} value`)
      assert.equal(exported[address].z, sheet[address].z ?? 'General', `${zone} ${address} format`)
    }
    for (const address of ['D2', 'D3', 'D4', 'D5']) {
      assert.equal(exported[address].t, 's', `${zone} ${address} remains text`)
      assert.equal(exported[address].f, undefined, `${zone} ${address} must not become a formula`)
    }
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimezone
}

const originalDocument = globalThis.document
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const links = []
const revoked = []
let blob
try {
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, 'a')
      const link = { click: () => { link.clicked = true } }
      links.push(link)
      return link
    },
  }
  URL.createObjectURL = (value) => {
    blob = value
    return 'blob:test-export'
  }
  URL.revokeObjectURL = (value) => revoked.push(value)
  downloadXlsx('report', headers, rows, sheetName)
  assert.equal(links[0].download, 'report.xlsx')
  assert.equal(links[0].href, 'blob:test-export')
  assert.equal(links[0].clicked, true)
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.deepEqual(revoked, ['blob:test-export'])
} finally {
  globalThis.document = originalDocument
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
}

console.log('xlsx-export: columns, values, date serial, text safety, and download behavior passed')
