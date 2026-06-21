import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import { HEADER_COLUMNS } from '../types'

/**
 * 读取Excel文件，返回数据行（不含表头）
 * 每行最多25列，不足补空串
 */
export function readExcelFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]

        // 读取为二维数组，raw:false 确保获取格式化文本
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: '',
        })

        // 跳过第1行（表头），从第2行开始
        const dataRows = rows.slice(1)

        // 标准化：每行最多25列，不足补空串
        const maxCol = HEADER_COLUMNS.length
        const normalized = dataRows.map((row: any[]) => {
          const arr: string[] = []
          for (let c = 0; c < maxCol; c++) {
            const val = row[c]
            if (val === null || val === undefined) {
              arr.push('')
            } else if (val instanceof Date) {
              // 日期统一格式化为 YYYY-MM-DD
              arr.push(dayjs(val).format('YYYY-MM-DD'))
            } else {
              arr.push(String(val).trim())
            }
          }
          return arr
        })

        resolve(normalized)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 将Luckysheet当前数据导出为xlsx文件
 */
export function exportExcel(): void {
  const luckysheet = (window as any).luckysheet
  const flowdata = luckysheet.getFlowdata()
  if (!flowdata) return

  // 构建导出数据：表头 + 数据行
  const headers = HEADER_COLUMNS.map((col) => col.label)
  const exportRows: string[][] = [headers]

  for (let r = 1; r < flowdata.length; r++) {
    const row: string[] = []
    let hasData = false
    for (let c = 0; c < HEADER_COLUMNS.length; c++) {
      const cell = flowdata[r]?.[c]
      let val = ''
      if (cell && cell.v !== null && cell.v !== undefined) {
        val = String(cell.m || cell.v).trim()
        if (val) hasData = true
      }
      row.push(val)
    }
    // 跳过全空行
    if (hasData) {
      exportRows.push(row)
    }
  }

  // 创建工作簿
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(exportRows)

  // 设置列宽
  const colWidths = HEADER_COLUMNS.map((col) => ({ wch: Math.ceil(col.width / 8) }))
  ws['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, ws, '物业导入')

  // 导出文件
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const fileName = `物业导入数据_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`
  saveAs(new Blob([wbout], { type: 'application/octet-stream' }), fileName)
}
