import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import { HEADER_COLUMNS, type HeaderColumn } from '../types'

/** Excel读取结果：表头 + 数据行 */
export interface ExcelReadResult {
  headers: string[]
  rows: string[][]
}

/** 列映射结果 */
export interface ColumnMappingResult {
  /** excelColIndex → toolColIndex 的映射 */
  mapping: Map<number, number>
  /** Excel中未匹配的字段名 */
  unmatchedExcelFields: string[]
  /** 工具中未被Excel匹配到的字段名 */
  missingToolFields: string[]
}

/**
 * 读取Excel文件，返回表头和数据行
 */
export function readExcelFile(file: File, maxCols?: number): Promise<ExcelReadResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]

        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: '',
        })

        if (rows.length === 0) {
          resolve({ headers: [], rows: [] })
          return
        }

        // 第1行为表头
        const headerRow = rows[0] as any[]
        const headers = headerRow.map((v: any) =>
          v === null || v === undefined ? '' : String(v).trim()
        )

        // 数据行从第2行开始
        const dataRows = rows.slice(1)
        const maxCol = maxCols ?? HEADER_COLUMNS.length

        const normalized = dataRows.map((row: any[]) => {
          const arr: string[] = []
          for (let c = 0; c < maxCol; c++) {
            const val = row[c]
            if (val === null || val === undefined) {
              arr.push('')
            } else if (val instanceof Date) {
              arr.push(dayjs(val).format('YYYY-MM-DD'))
            } else {
              arr.push(String(val).trim())
            }
          }
          return arr
        })

        resolve({ headers, rows: normalized })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 根据Excel表头与工具表头，构建列映射（精确匹配）
 */
export function buildColumnMapping(
  excelHeaders: string[],
  toolColumns: HeaderColumn[]
): ColumnMappingResult {
  const mapping = new Map<number, number>()
  const matchedToolCols = new Set<number>()
  const unmatchedExcelFields: string[] = []

  // 构建工具表头的 label → colIndex 映射
  const labelToCol = new Map<string, number>()
  for (const col of toolColumns) {
    labelToCol.set(col.label, col.colIndex)
  }

  // 遍历Excel表头，精确匹配
  for (let i = 0; i < excelHeaders.length; i++) {
    const header = excelHeaders[i]
    if (!header) continue
    const toolCol = labelToCol.get(header)
    if (toolCol !== undefined) {
      mapping.set(i, toolCol)
      matchedToolCols.add(toolCol)
    } else {
      unmatchedExcelFields.push(header)
    }
  }

  // 工具中未被匹配到的字段
  const missingToolFields = toolColumns
    .filter(col => !matchedToolCols.has(col.colIndex))
    .map(col => col.label)

  return { mapping, unmatchedExcelFields, missingToolFields }
}

/**
 * 根据列映射重排数据行
 */
export function remapRows(
  rows: string[][],
  mapping: Map<number, number>,
  totalCols: number
): string[][] {
  return rows.map(row => {
    const newRow: string[] = new Array(totalCols).fill('')
    for (const [excelCol, toolCol] of mapping.entries()) {
      if (excelCol < row.length) {
        newRow[toolCol] = row[excelCol]
      }
    }
    return newRow
  })
}

/**
 * 将Luckysheet当前数据导出为xlsx文件
 */
export function exportExcel(): void {
  const luckysheet = (window as any).luckysheet
  let flowdata: any[][] | null = null
  if (typeof luckysheet.getSheetData === 'function') flowdata = luckysheet.getSheetData()
  else if (typeof luckysheet.flowdata === 'function') flowdata = luckysheet.flowdata()
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

  // 获取项目名称（取第一个非空的项目名称，col=0）
  let projectName = ''
  for (let r = 1; r < flowdata.length; r++) {
    const cell = flowdata[r]?.[0]
    if (cell && cell.v !== null && cell.v !== undefined) {
      const val = String(cell.m || cell.v).trim()
      if (val) {
        projectName = val
        break
      }
    }
  }

  // 创建工作簿
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(exportRows)

  // 设置列宽
  const colWidths = HEADER_COLUMNS.map((col) => ({ wch: Math.ceil(col.width / 8) }))
  ws['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, ws, '房产信息数据')

  // 导出文件（文件名带项目名称）
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const prefix = projectName ? `${projectName}` : '房产信息数据'
  const fileName = `${prefix}房产信息数据_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`
  saveAs(new Blob([wbout], { type: 'application/octet-stream' }), fileName)
}
