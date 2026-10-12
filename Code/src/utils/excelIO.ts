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
 * 计算实际需要读取的列宽
 *
 * 注意：sheet_to_json 会把每一行都补齐到 sheet 的 !ref 宽度，而 !ref 可能被
 * "仅有格式/残留内容"的远列（如 ZZ 列）撑大，因此不能直接用 !ref 或行长度作为读取宽度。
 * 这里按「实际存在非空值的最大列」收敛，并以调用方期望的最小列数作为下限。
 *
 * @param rows sheet_to_json(header:1, defval:'') 的原始输出（每行已按 !ref 补齐）
 * @param minCols 最小列数（工具期望列数，作为下限，保证不裁掉工具需要的列）
 */
function getActualMaxCol(rows: unknown[][], minCols: number): number {
  let maxCol = minCols
  for (const row of rows) {
    if (!row) continue
    // 从右往左扫，命中第一个非空值即可确定该行的最右有效列
    for (let c = row.length - 1; c >= maxCol; c--) {
      const val = row[c]
      if (val === null || val === undefined || val === '') continue
      if (String(val).trim() !== '') {
        maxCol = c + 1
        break
      }
    }
  }
  return maxCol
}

/** Excel 日期序列号上界（9999-12-31），超出即视为非法 */
const MAX_EXCEL_SERIAL = 2958465

/** 归一后的日期字符串格式 */
const NORMALIZED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 收集表格中「被 Excel 认定为日期」的单元格，统一归一为 YYYY-MM-DD
 *
 * 判定依据是单元格自身的数字格式（`cell.z`）而非列位置，因此：
 * - 无需知道哪些列是日期列（房产模块工具列序与 Excel 列序并不一致，从 col19 起偏移 2）
 * - 文本/常规单元格天然不满足 `is_date`，零误伤
 * - 使用 Excel 数字序列号经 SSF 格式化，而非 Date 对象：
 *   xlsx 在 cellDates 下给出的 Date 存在约 -43 秒偏移（本地时刻 23:59:17），
 *   直接格式化会差一天（2026-06-01 → 2026-05-31）；序列号路径无此问题，
 *   也不会因单元格显示格式不同（m/d/yy、dd/mm/yyyy、yyyy年m月d日）而产生差异。
 *
 * 性能：只遍历「实际存在的单元格」（`Object.keys(sheet)`），而不是 `!ref` 覆盖的整块矩形。
 * 44,579 × 27 的模板下，后者要执行 120 万次 `encode_cell()` 字符串分配（实测 897ms），
 * 前者只需遍历 42.5 万个真实单元格（实测 514ms）。
 *
 * @param sheet 工作表对象
 * @returns "行下标_列下标" → "YYYY-MM-DD"；下标以 `!ref` 起点为原点，与 sheet_to_json 输出下标一致
 */
function buildDateMap(sheet: XLSX.WorkSheet): Map<string, string> {
  const dateMap = new Map<string, string>()
  const ref = sheet?.['!ref']
  if (!ref) return dateMap

  const range = XLSX.utils.decode_range(ref)
  for (const addr of Object.keys(sheet)) {
    // '!' 前缀是 !ref / !merges / !autofilter 等元信息键，不是单元格
    if (addr.charCodeAt(0) === 33 /* '!' */) continue

    const cell = sheet[addr]
    if (!cell || cell.t !== 'n' || !cell.z) continue
    if (!XLSX.SSF.is_date(cell.z)) continue

    const serial = cell.v
    if (typeof serial !== 'number' || !isFinite(serial)) continue
    // 守卫：0 或越界序列号会产出 1900-01-00 / 空串等非法值
    if (serial < 1 || serial > MAX_EXCEL_SERIAL) continue

    const text = XLSX.SSF.format('yyyy-mm-dd', serial)
    if (!NORMALIZED_DATE_RE.test(text)) continue

    const pos = XLSX.utils.decode_cell(addr)
    dateMap.set(`${pos.r - range.s.r}_${pos.c - range.s.c}`, text)
  }
  return dateMap
}

/**
 * 读取Excel文件，返回表头和数据行
 *
 * **只读取第一个工作表**（`sheets: 0`），调用方需保证待导入数据位于第一个 sheet。
 *
 * 日期归一：凡是被 Excel 认定为日期格式的单元格，一律统一输出 `YYYY-MM-DD`。
 * 否则同一列会因各单元格显示格式不同而混出 `2026/6/1`（4位年）与 `5/31/27`（2位年）两种文本，
 * 而 Luckysheet 的日期识别只认 4 位年 —— 结果同一列一半被转成日期型、一半留作文本，
 * 并触发大量「日期格式错误」误报、连带使跨行的计费日期先后校验被静默跳过。
 *
 * @param file Excel文件
 * @param maxCols 工具期望的最小列数（如应收模块传18）；实际读取宽度取「maxCols 与表格实际有值列数」的较大者，
 *                既避免超宽模板（如27列应收模板）中缴款日期/支付方式所在列被截断丢失，
 *                也不会因模板在远列残留格式而被撑宽。不传时默认房产模块的32列
 * @param headerRowIndex 表头所在行索引（0-based），默认0即第一行。设为3可跳过前3行模板提示行
 */
export function readExcelFile(
  file: File,
  maxCols?: number,
  headerRowIndex: number = 0
): Promise<ExcelReadResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        // sheets: 0 —— 只解析第一个工作表。
        // 本函数只使用 SheetNames[0]，而用户工作簿常含多个统计表
        // （实测 10.8MB 文件的第 3 张表就有 156 万单元格），全量解析纯属白读：
        // 15,636ms → 2,037~3,562ms。
        // cellNF 必须保留：不传则 cell.z 为 undefined，日期归一失效；
        // 也刻意不用 cellDates，它会把序列号换成带偏移的 Date 对象。
        const workbook = XLSX.read(data, { type: 'array', cellNF: true, sheets: 0 })
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

        // 被 Excel 认定为日期的单元格 → YYYY-MM-DD（下标与 rows 对齐）
        const dateMap = buildDateMap(sheet)

        // 从指定行读取表头（0-based），跳过之前的模板提示行
        const headerRow = rows[headerRowIndex] as any[]
        const headers = headerRow.map((v: any) =>
          v === null || v === undefined ? '' : String(v).trim()
        )

        // 数据行从表头行的下一行开始
        const dataRows = rows.slice(headerRowIndex + 1)
        // 读取宽度 = max(工具期望列数, 表格实际有值列数)
        // 下限：工具期望列数（不传时取房产模块的 32 列，保证工具需要的列都读进来）
        // 上限：按实际有值的最大列收敛，避免模板在远列残留格式时被 !ref 撑宽
        // （如金桂家园应收模板为27列，缴款日期col18、支付方式col19若按18截断会丢失）
        const maxCol = getActualMaxCol(rows, maxCols ?? HEADER_COLUMNS.length)

        const normalized = dataRows.map((row: any[], i: number) => {
          const arr: string[] = []
          // 还原为 rows 数组下标（dataRows 是 rows 从 headerRowIndex+1 起的切片）
          const rowIdx = headerRowIndex + 1 + i
          for (let c = 0; c < maxCol; c++) {
            // 日期优先：命中则直接用归一后的 YYYY-MM-DD，跳过原文本
            const dateText = dateMap.get(`${rowIdx}_${c}`)
            if (dateText !== undefined) {
              arr.push(dateText)
              continue
            }
            const val = row[c]
            if (val === null || val === undefined) {
              arr.push('')
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
 * 「4位年在前」的日期文本：年.月.日 / 年-月-日 / 年/月/日 / 年月日
 *
 * 只接受 4 位年，是因为年在前时顺序完全无歧义（年→月→日）；
 * 2 位年（如 `25/7.31`）需要猜世纪，一律不认。
 */
const TEXT_DATE_RE = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/
const TEXT_DATE_CN_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/

/**
 * 尝试把「4位年在前」的日期文本解析为 YYYY-MM-DD
 * @returns 解析成功且为真实存在的日期时返回 YYYY-MM-DD，否则返回 null
 */
function parseTextDate(value: string): string | null {
  const m = value.match(TEXT_DATE_RE) || value.match(TEXT_DATE_CN_RE)
  if (!m) return null

  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null

  // 回环校验：挡掉 2月30日、4月31日，以及 JS 把 0-99 年映射到 1900+ 的坑
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null

  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 把日期列内的「文本型日期」统一归一为 YYYY-MM-DD
 *
 * 背景：`readExcelFile` 只能归一「被 Excel 认定为日期」的单元格（数字序列号 + 日期格式）。
 * 但用户常把日期填成**文本**（单元格格式为常规/文本），此时 Excel 并未认定它是日期，例如
 * 房产模板的「出租开始日期」整列是文本 `2024.10.1`、应收模板的「缴款日期」是文本 `2026.2.6`。
 * 这类值既不被本工具归一，也不被 Luckysheet 识别（其日期识别只认 `-` 与 `/` 分隔），
 * 最终会触发大量「日期格式错误」误报。
 *
 * 安全边界（三条同时满足才转换）：
 * 1. **仅限调用方传入的日期列** —— 杜绝误伤备注、合同编号、联系电话等列
 * 2. **仅认 4 位年在前的格式** —— 顺序无歧义；2 位年、月日在前一律不认
 * 3. **必须是真实存在的日期** —— 月 1~12、日符合当月天数
 *
 * 不满足的值原样保留，继续由校验器报错让人工核对（绝不猜）。
 *
 * 注意：必须在 `remapRows` **之后**调用，因为传入的列号是工具侧列索引，
 * 与 Excel 原始列序并不一致（房产模块自 col19 起偏移 2）。
 *
 * @param rows 已 remap 到工具列序的数据行
 * @param dateCols 工具侧的日期列索引数组
 * @returns 新的行数组（未发生改动的行原样复用，避免无谓分配）
 */
export function normalizeDateColumns(rows: string[][], dateCols: number[]): string[][] {
  if (!dateCols || dateCols.length === 0) return rows

  const cols = new Set(dateCols)
  return rows.map((row) => {
    let patched: string[] | null = null
    for (const c of cols) {
      const val = row[c]
      if (val === undefined || val === null || val === '') continue
      const fixed = parseTextDate(val)
      // 解析失败，或本来就已经是目标格式 → 不动
      if (fixed === null || fixed === val) continue
      if (!patched) patched = row.slice()
      patched[c] = fixed
    }
    return patched ?? row
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
