// Builds the money movements Excel file. ExcelJS is loaded only when someone exports.

const GREEN = 'FF0B3D2A'
const LINE = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }
const nice = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ')
const STATUS_COLOR: Record<string, string> = { COMPLETED: 'FF047857', FAILED: 'FFB91C1C', PENDING: 'FFB45309', PROCESSING: 'FF0369A1' }
const COLUMNS = [
  { title: 'Date', width: 22 },
  { title: 'Who', width: 18 },
  { title: 'Type', width: 18 },
  { title: 'Status', width: 14 },
  { title: 'Amount (₦)', width: 18 },
  { title: 'Description', width: 62 },
  { title: 'Reference', width: 48 },
]
// Excel has no time zones, so shift the time to keep the clock the user sees
const localDate = (v: string) => {
  const d = new Date(v)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
}

export async function downloadMovements(rows: any[], filterText: string, fileName: string) {
  const ExcelJS = (await import('exceljs')).default
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Money movements', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4', margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  })
  sheet.columns = COLUMNS.map(c => ({ width: c.width }))

  sheet.getCell('A1').value = 'TAREVA money movements'
  sheet.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: GREEN } }
  sheet.getRow(1).height = 26
  sheet.getCell('A2').value = `Exported ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. ${rows.length} rows. ${filterText}`
  sheet.getCell('A2').font = { name: 'Calibri', size: 10, color: { argb: 'FF6B7280' } }

  const head = sheet.getRow(4)
  head.values = COLUMNS.map(c => c.title)
  head.height = 24
  head.eachCell(cell => {
    cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
    cell.alignment = { vertical: 'middle', indent: 1 }
  })

  rows.forEach((r, index) => {
    // text is stored as text, so nothing typed by a user can run as a formula
    const row = sheet.addRow([localDate(r.createdAt), r.who, nice(r.type), nice(r.status), Number(r.amount), r.description || '', r.reference])
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'top', wrapText: true, indent: 1 }
      cell.border = { bottom: LINE }
      if (index % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8F7' } }
    })
    row.eachCell({ includeEmpty: true }, cell => { cell.font = { name: 'Calibri', size: 11 } })
    row.getCell(1).numFmt = 'd mmm yyyy, h:mm AM/PM'
    row.getCell(1).alignment = { vertical: 'top', horizontal: 'left', indent: 1 }
    row.getCell(4).font = { name: 'Calibri', bold: true, color: { argb: STATUS_COLOR[r.status] || 'FF374151' } }
    row.getCell(5).numFmt = '#,##0.00'
    row.getCell(5).alignment = { vertical: 'top', horizontal: 'right', indent: 2 }
    row.getCell(5).font = { name: 'Calibri', bold: true }
    row.getCell(7).font = { name: 'Calibri', size: 9, color: { argb: 'FF6B7280' } }
  })
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: COLUMNS.length } }

  const data = await book.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}