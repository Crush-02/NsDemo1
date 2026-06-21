import type { ValidationResult } from './types'

const luckysheet = () => (window as any).luckysheet

// ==================== 单元格值缓存 ====================
/** 单元格值缓存 key="row-col" → value，避免同一校验链路中重复调用 getCellValue */
const _cellCache = new Map<string, string>()

/** 获取单元格文本值（带缓存，空值安全，处理三种空状态） */
export function getCellText(row: number, col: number): string {
  const cacheKey = `${row}-${col}`
  const cached = _cellCache.get(cacheKey)
  if (cached !== undefined) return cached

  const ls = luckysheet()
  if (!ls) return ''
  const val = ls.getCellValue(row, col)
  if (val === null || val === undefined) {
    _cellCache.set(cacheKey, '')
    return ''
  }
  // 处理Luckysheet可能将日期存为Excel序列号的情况
  if (typeof val === 'number') {
    // 大于40000的数字很可能是Excel日期序列号
    if (val > 40000 && val < 100000) {
      const date = new Date((val - 25569) * 86400 * 1000)
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      const formatted = `${y}-${m}-${d}`
      _cellCache.set(cacheKey, formatted)
      return formatted
    }
  }
  const result = String(val).trim()
  _cellCache.set(cacheKey, result)
  return result
}

/** 清除单元格值缓存（每次校验操作开始时调用） */
export function clearCellCache(): void {
  _cellCache.clear()
}

/** 判断一行是否有数据 */
export function isRowNotEmpty(row: number): boolean {
  for (let c = 0; c < 25; c++) {
    if (getCellText(row, c) !== '') return true
  }
  return false
}

// ==================== 简单规则校验函数 ====================

/** 规则1: 房产简称_必填 - 不可为空 */
function validatePropertyName(row: number): ValidationResult | null {
  const val = getCellText(row, 0)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '房产简称_必填',
      severity: 'CRITICAL',
      message: '房产简称不可为空且在项目中唯一',
      row,
      col: 0,
    }
  }
  return null
}

/** 规则6: 楼层_必填 - 不可为空且必须为正整数 */
const FLOOR_REGEX = /^[1-9]\d*$/

function validateFloor(row: number): ValidationResult | null {
  const val = getCellText(row, 1)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '楼层_必填',
      severity: 'CRITICAL',
      message: '楼层不可为空且必须为正整数',
      row,
      col: 1,
    }
  }
  if (!FLOOR_REGEX.test(val)) {
    return {
      isValid: false,
      ruleId: '楼层_必填',
      severity: 'CRITICAL',
      message: '楼层不可为空且必须为正整数',
      row,
      col: 1,
    }
  }
  return null
}

/** 规则10: 房号_必填 - 不可为空 */
function validateRoomNo(row: number): ValidationResult | null {
  const val = getCellText(row, 2)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '房号_必填',
      severity: 'CRITICAL',
      message: '房号不可为空',
      row,
      col: 2,
    }
  }
  return null
}

/** 规则13: 房产类型_必填 - 不可为空且必须是枚举值 */
const PROPERTY_TYPES = ['住宅', '车位', '商铺', '写字楼', '其他']

function validatePropertyType(row: number): ValidationResult | null {
  const val = getCellText(row, 3)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '房产类型_必填',
      severity: 'CRITICAL',
      message: '房产类型不可为空，请选择：住宅|车位|商铺|写字楼|其他',
      row,
      col: 3,
    }
  }
  if (!PROPERTY_TYPES.includes(val)) {
    return {
      isValid: false,
      ruleId: '房产类型_必填',
      severity: 'CRITICAL',
      message: '房产类型不可为空，请选择：住宅|车位|商铺|写字楼|其他',
      row,
      col: 3,
    }
  }
  return null
}

/** 规则2: 格式_计费面积 - 如果有值，必须为正数，最多4位小数 */
const AREA_REGEX = /^(0|[1-9]\d*)(\.\d{1,4})?$/

function validateBillingArea(row: number): ValidationResult | null {
  const val = getCellText(row, 4)
  if (val === '') return null
  if (!AREA_REGEX.test(val)) {
    return {
      isValid: false,
      ruleId: '格式_计费面积',
      severity: 'HIGH',
      message: '计费面积应为正数，且需保留四位小数',
      row,
      col: 4,
    }
  }
  return null
}

/** 规则9: 格式_日期 - 如果有值，必须为YYYY-MM-DD格式（严格匹配+真实日期校验） */
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function isValidDate(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false
  // 额外校验：确保是真实存在的日期（如2月30号不合法）
  const date = new Date(value)
  const [y, m, d] = value.split('-').map(Number)
  return date.getFullYear() === y
    && date.getMonth() === m - 1
    && date.getDate() === d
}

function validateDateField(row: number, col: number): ValidationResult | null {
  const val = getCellText(row, col)
  if (val === '') return null
  if (!isValidDate(val)) {
    return {
      isValid: false,
      ruleId: '格式_日期',
      severity: 'HIGH',
      message: '日期格式错误，正确格式为YYYY-MM-DD',
      row,
      col,
    }
  }
  return null
}

/** 规则11: 格式_证件号码 - 如果有值，必须符合18位身份证号规则 */
const ID_CARD_REGEX = /^\d{17}[\dXx]$/

function validateIdNumber(row: number, col: number): ValidationResult | null {
  const val = getCellText(row, col)
  if (val === '') return null
  if (!ID_CARD_REGEX.test(val)) {
    return {
      isValid: false,
      ruleId: '格式_证件号码',
      severity: 'HIGH',
      message: '证件号码格式校验不通过，需符合身份证号规则',
      row,
      col,
    }
  }
  return null
}

// ==================== 公开接口 ====================

/** 日期列: F/G/H/T/U (col=5,6,7,19,20) */
const DATE_COLUMNS = [5, 6, 7, 19, 20]
/** 证件号码列: K/P (col=10,15) */
const ID_COLUMNS = [10, 15]

/**
 * 校验单个单元格（用于ON_INPUT即时校验）
 * 只校验格式类规则（日期、数字、枚举），不校验必填
 */
export function validateCell(row: number, col: number): ValidationResult | null {
  if (row === 0) return null

  // 楼层格式（ON_INPUT只检查格式，空值不报错）
  if (col === 1) {
    const val = getCellText(row, 1)
    if (val === '') return null
    if (!FLOOR_REGEX.test(val)) {
      return {
        isValid: false,
        ruleId: '楼层_必填',
        severity: 'CRITICAL',
        message: '楼层不可为空且必须为正整数',
        row,
        col: 1,
      }
    }
    return null
  }

  // 房产类型格式（ON_INPUT只检查枚举，空值不报错）
  if (col === 3) {
    const val = getCellText(row, 3)
    if (val === '') return null
    if (!PROPERTY_TYPES.includes(val)) {
      return {
        isValid: false,
        ruleId: '房产类型_必填',
        severity: 'CRITICAL',
        message: '房产类型不可为空，请选择：住宅|车位|商铺|写字楼|其他',
        row,
        col: 3,
      }
    }
    return null
  }

  // 计费面积格式
  if (col === 4) return validateBillingArea(row)

  // 日期格式
  if (DATE_COLUMNS.includes(col)) return validateDateField(row, col)

  // 证件号码格式
  if (ID_COLUMNS.includes(col)) return validateIdNumber(row, col)

  return null
}

/**
 * 校验一行数据（所有简单规则）
 */
export function validateRow(row: number): ValidationResult[] {
  if (row === 0) return []
  if (!isRowNotEmpty(row)) return []

  const results: ValidationResult[] = []

  // 必填规则
  const r1 = validatePropertyName(row)
  if (r1) results.push(r1)

  const r6 = validateFloor(row)
  if (r6) results.push(r6)

  const r10 = validateRoomNo(row)
  if (r10) results.push(r10)

  const r13 = validatePropertyType(row)
  if (r13) results.push(r13)

  // 格式规则
  const r2 = validateBillingArea(row)
  if (r2) results.push(r2)

  for (const col of DATE_COLUMNS) {
    const r = validateDateField(row, col)
    if (r) results.push(r)
  }

  for (const col of ID_COLUMNS) {
    const r = validateIdNumber(row, col)
    if (r) results.push(r)
  }

  return results
}

/**
 * 校验全部数据（简单规则）
 */
export function validateAll(): { errors: ValidationResult[]; warnings: ValidationResult[] } {
  const ls = luckysheet()
  if (!ls) return { errors: [], warnings: [] }

  const flowdata = ls.getFlowdata()
  if (!flowdata) return { errors: [], warnings: [] }

  const allResults: ValidationResult[] = []

  for (let r = 1; r < flowdata.length; r++) {
    const rowResults = validateRow(r)
    allResults.push(...rowResults)
  }

  const errors = allResults.filter((r) => r.severity === 'CRITICAL')
  const warnings = allResults.filter((r) => r.severity !== 'CRITICAL')

  return { errors, warnings }
}

/**
 * 获取已填写的行数（不含表头）
 */
export function getFilledRowCount(): number {
  const ls = luckysheet()
  if (!ls) return 0
  const flowdata = ls.getFlowdata()
  if (!flowdata) return 0

  let count = 0
  for (let r = 1; r < flowdata.length; r++) {
    if (isRowNotEmpty(r)) count++
  }
  return count
}

/**
 * 获取总行数（不含表头）
 */
export function getTotalRowCount(): number {
  const ls = luckysheet()
  if (!ls) return 0
  const flowdata = ls.getFlowdata()
  if (!flowdata) return 0
  return flowdata.length - 1
}
