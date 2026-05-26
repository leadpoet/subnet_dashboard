import * as XLSX from 'xlsx'

export type XlsxCell = string | number | boolean | Date | null | undefined

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\[\]\\/*?:]/g, ' ').trim()
  return (cleaned || 'Export').slice(0, 31)
}

function columnWidths(headers: string[], rows: XlsxCell[][]) {
  return headers.map((header, colIdx) => {
    const max = rows.reduce((width, row) => {
      const value = row[colIdx]
      const text = value == null ? '' : String(value)
      return Math.max(width, text.length)
    }, header.length)

    return { wch: Math.max(10, Math.min(max + 2, 60)) }
  })
}

export function buildWorkbook(headers: string[], rows: XlsxCell[][], sheetName = 'Export') {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  worksheet['!cols'] = columnWidths(headers, rows)

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheetName))
  return workbook
}

export function buildXlsxArrayBuffer(
  headers: string[],
  rows: XlsxCell[][],
  sheetName = 'Export',
): ArrayBuffer {
  return XLSX.write(buildWorkbook(headers, rows, sheetName), {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer
}

export function downloadXlsx(
  filename: string,
  headers: string[],
  rows: XlsxCell[][],
  sheetName = 'Export',
) {
  const blob = new Blob([buildXlsxArrayBuffer(headers, rows, sheetName)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}
