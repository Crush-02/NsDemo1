/**
 * 应收已收 - 简单规则校验器
 * 单字段格式校验：必填、日期格式、金额格式、枚举值
 */
import type { ValidationResult } from '../types'
import {
  FINANCE_DATE_COLUMNS, FINANCE_REQUIRED_COLUMNS,
  PAYMENT_METHODS, EXEMPTION_CATEGORIES,
  FINANCE_HEADER_ROW_COUNT, FINANCE_COL_COUNT,
} from './types'

/** 获取luckysheet API对象 */
function getLs(): any {
  return (window as any).luckysheet
}

/** 获取单元格文本值（空值安全，处理日期序列号） */
export function getCellText(row: number, col: number): string {
  const ls = getLs()
  if (!ls) return ''
  const val = ls.getCellValue(row, col)
  if (val === null || val === undefined) return ''
  if (typeof val === 'number') {
    if (val > 40000 && val < 100000) {
      const date = new Date((val - 25569) * 86400 * 1000)
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  }
  return String(val).trim()
}

/** 判断一行是否有数据 */
export function isRowNotEmpty(row: number): boolean {
  for (let c = 0; c < 18; c++) {
    if (getCellText(row, c) !== '') return true
  }
  return false
}

/** 获取flowdata */
function getFlowdata(): any[][] | null {
  const ls = getLs()
  if (!ls) return null
  if (typeof ls.getSheetData === 'function') return ls.getSheetData()
  if (typeof ls.flowdata === 'function') return ls.flowdata()
  return null
}

// ==================== 日期校验 ====================

/** 校验日期格式：YYYY-MM-DD 或 YYYY/M/D */
const DATE_REGEX_STRICT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DATE_REGEX_SLASH = /^\d{4}\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/

export function isValidDateStr(value: string): boolean {
  if (DATE_REGEX_STRICT.test(value)) {
    const date = new Date(value)
    const [y, m, d] = value.split('-').map(Number)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
  }
  if (DATE_REGEX_SLASH.test(value)) {
    const parts = value.split('/').map(Number)
    const date = new Date(parts[0], parts[1] - 1, parts[2])
    return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2]
  }
  return false
}

/** 将日期字符串标准化为 YYYY-MM-DD 用于比较 */
export function normalizeDate(value: string): string {
  if (DATE_REGEX_SLASH.test(value)) {
    const parts = value.split('/').map(Number)
    const m = String(parts[1]).padStart(2, '0')
    const d = String(parts[2]).padStart(2, '0')
    return `${parts[0]}-${m}-${d}`
  }
  return value
}

// ==================== 金额校验 ====================

const AMOUNT_REGEX = /^(0|[1-9]\d*)(\.\d{1,2})?$/

function isValidAmount(value: string): boolean {
  if (!AMOUNT_REGEX.test(value)) return false
  return parseFloat(value) > 0
}

// ==================== 单字段校验函数 ====================

/** 必填字段校验 */
const REQUIRED_LABELS: Record<number, string> = {
  0: '项目名称', 1: '房产简称', 2: '收费对象',
  3: '收费科目', 5: '计费开始日期', 6: '计费结束日期', 8: '应收金额',
}

function validateRequired(row: number, col: number): ValidationResult | null {
  if (!FINANCE_REQUIRED_COLUMNS.includes(col)) return null
  const val = getCellText(row, col)
  if (val !== '') return null
  return {
    isValid: false,
    ruleId: `必填_${REQUIRED_LABELS[col]}`,
    severity: 'CRITICAL',
    message: `${REQUIRED_LABELS[col]}不可为空`,
    row, col,
  }
}

/** 日期格式校验 */
function validateDateField(row: number, col: number): ValidationResult | null {
  if (!FINANCE_DATE_COLUMNS.includes(col)) return null
  const val = getCellText(row, col)
  if (val === '') return null
  if (!isValidDateStr(val)) {
    return {
      isValid: false,
      ruleId: '格式_日期',
      severity: 'HIGH',
      message: '日期格式错误，正确格式为YYYY-MM-DD或YYYY/M/D',
      row, col,
    }
  }
  return null
}

/** 金额格式校验 */
function validateAmountField(row: number, col: number): ValidationResult | null {
  if (col !== 8 && col !== 9 && col !== 13) return null
  const val = getCellText(row, col)
  if (val === '') return null
  if (!isValidAmount(val)) {
    const labels: Record<number, string> = { 8: '应收金额', 9: '减免金额', 13: '缴款金额' }
    return {
      isValid: false,
      ruleId: '格式_金额',
      severity: 'HIGH',
      message: `${labels[col]}必须为大于0的数值，最多保留2位小数`,
      row, col,
    }
  }
  return null
}

/** 支付方式枚举校验 */
function validatePaymentMethod(row: number): ValidationResult | null {
  const val = getCellText(row, 15)
  if (val === '') return null
  if (!PAYMENT_METHODS.includes(val)) {
    return {
      isValid: false,
      ruleId: '格式_支付方式',
      severity: 'HIGH',
      message: `支付方式必须为：${PAYMENT_METHODS.join('、')}`,
      row, col: 15,
    }
  }
  return null
}

/** 减免分类枚举校验 */
function validateExemptionCategory(row: number): ValidationResult | null {
  const val = getCellText(row, 10)
  if (val === '') return null
  if (!EXEMPTION_CATEGORIES.includes(val)) {
    return {
      isValid: false,
      ruleId: '格式_减免分类',
      severity: 'HIGH',
      message: `减免分类必须为：${EXEMPTION_CATEGORIES.join('、')}`,
      row, col: 10,
    }
  }
  return null
}

// ==================== 公开接口 ====================

/**
 * 校验单个单元格（用于ON_INPUT即时校验）
 * 校验格式规则 + 必填规则
 */
export function validateCell(row: number, col: number): ValidationResult | null {
  if (row < FINANCE_HEADER_ROW_COUNT) return null
  // 必填规则
  if (FINANCE_REQUIRED_COLUMNS.includes(col)) return validateRequired(row, col)
  // 日期格式
  if (FINANCE_DATE_COLUMNS.includes(col)) return validateDateField(row, col)
  // 金额格式
  if (col === 8 || col === 9 || col === 13) return validateAmountField(row, col)
  // 支付方式枚举
  if (col === 15) return validatePaymentMethod(row)
  // 减免分类枚举
  if (col === 10) return validateExemptionCategory(row)
  return null
}

/**
 * 校验一行数据（所有简单规则）
 */
export function validateRow(row: number): ValidationResult[] {
  if (row < FINANCE_HEADER_ROW_COUNT) return []
  if (!isRowNotEmpty(row)) return []

  const results: ValidationResult[] = []

  // 必填
  for (const col of FINANCE_REQUIRED_COLUMNS) {
    const r = validateRequired(row, col)
    if (r) results.push(r)
  }

  // 日期格式
  for (const col of FINANCE_DATE_COLUMNS) {
    const r = validateDateField(row, col)
    if (r) results.push(r)
  }

  // 金额格式
  for (const col of [8, 9, 13]) {
    const r = validateAmountField(row, col)
    if (r) results.push(r)
  }

  // 枚举
  const rPay = validatePaymentMethod(row)
  if (rPay) results.push(rPay)

  const rExempt = validateExemptionCategory(row)
  if (rExempt) results.push(rExempt)

  return results
}

/**
 * 校验全部数据（简单规则）
 */
export function validateAll(): { errors: ValidationResult[]; warnings: ValidationResult[] } {
  const flowdata = getFlowdata()
  if (!flowdata) return { errors: [], warnings: [] }

  const allResults: ValidationResult[] = []
  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    allResults.push(...validateRow(r))
  }

  return {
    errors: allResults.filter((r) => r.severity === 'CRITICAL'),
    warnings: allResults.filter((r) => r.severity !== 'CRITICAL'),
  }
}

/** 获取已填写的行数（不含表头） */
export function getFilledRowCount(): number {
  const flowdata = getFlowdata()
  if (!flowdata) return 0
  let count = 0
  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    if (isRowNotEmpty(r)) count++
  }
  return count
}

/** 获取总行数（不含表头） */
export function getTotalRowCount(): number {
  const flowdata = getFlowdata()
  if (!flowdata) return 0
  return flowdata.length - FINANCE_HEADER_ROW_COUNT
}
