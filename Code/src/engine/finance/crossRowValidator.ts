/**
 * 应收已收 - 跨行校验器
 * 规则1: 项目名称一致性
 * 规则7: 计费日期逻辑（结束日期 > 开始日期）
 * 规则8: 数据重复校验（房产简称+收费科目+计费开始+计费结束）
 */
import type { ValidationResult } from '../types'
import { getCellText, isRowNotEmpty, isValidDateStr, normalizeDate } from './simpleValidator'
import { FINANCE_HEADER_ROW_COUNT } from './types'

/** 获取flowdata */
function getFlowdata(): any[][] | null {
  const ls = (window as any).luckysheet
  if (!ls) return null
  if (typeof ls.getSheetData === 'function') return ls.getSheetData()
  if (typeof ls.flowdata === 'function') return ls.flowdata()
  return null
}

/**
 * 规则1: 项目名称一致性
 * 一个表格内项目名称必须保持一致
 */
export function validateProjectNameConsistency(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  const projectNames = new Set<string>()
  const nameRows = new Map<string, number[]>()

  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue
    const val = getCellText(r, 0)
    if (val === '') continue
    projectNames.add(val)
    const rows = nameRows.get(val) || []
    rows.push(r)
    nameRows.set(val, rows)
  }

  // 如果只有一个项目名称（或为空），则通过
  if (projectNames.size <= 1) return []

  // 有多个不同的项目名称 → 所有行都报错
  const results: ValidationResult[] = []
  nameRows.forEach((rows) => {
    rows.forEach((row) => {
      results.push({
        isValid: false,
        ruleId: '项目名称一致性',
        severity: 'CRITICAL',
        message: '一个表格内项目名称必须保持一致，不允许出现多个不同的项目名称',
        row, col: 0,
      })
    })
  })

  return results
}

/**
 * 规则7: 计费日期逻辑
 * 计费结束日期必须晚于计费开始日期
 */
export function validateBillingDateOrder(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  const results: ValidationResult[] = []

  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue
    const startStr = getCellText(r, 5)  // 计费开始日期
    const endStr = getCellText(r, 6)    // 计费结束日期

    if (startStr === '' || endStr === '') continue
    if (!isValidDateStr(startStr) || !isValidDateStr(endStr)) continue

    const start = normalizeDate(startStr)
    const end = normalizeDate(endStr)

    if (end <= start) {
      results.push({
        isValid: false,
        ruleId: '计费日期逻辑',
        severity: 'HIGH',
        message: '计费结束日期必须晚于计费开始日期',
        row: r, col: 6,
      })
    }
  }

  return results
}

/**
 * 规则8: 数据重复校验
 * 房产简称 + 收费科目 + 计费开始日期 + 计费结束日期 不可全部相同
 */
export function validateDataDuplicate(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  const comboToRows = new Map<string, number[]>()

  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue
    const prop = getCellText(r, 1)     // 房产简称
    const subject = getCellText(r, 3)  // 收费科目
    const start = getCellText(r, 5)    // 计费开始日期
    const end = getCellText(r, 6)      // 计费结束日期

    if (prop === '' || subject === '') continue

    // 标准化日期用于比较
    const startNorm = isValidDateStr(start) ? normalizeDate(start) : start
    const endNorm = isValidDateStr(end) ? normalizeDate(end) : end

    const key = `${prop}|${subject}|${startNorm}|${endNorm}`
    const rows = comboToRows.get(key) || []
    rows.push(r)
    comboToRows.set(key, rows)
  }

  const results: ValidationResult[] = []
  comboToRows.forEach((rows, key) => {
    if (rows.length <= 1) return
    const [prop, subject, start, end] = key.split('|')
    rows.forEach((row) => {
      results.push({
        isValid: false,
        ruleId: '数据重复校验',
        severity: 'CRITICAL',
        message: `房产简称"${prop}"的收费科目"${subject}"在计费周期(${start}~${end})内存在重复数据`,
        row, col: 1,
      })
    })
  })

  return results
}

/**
 * 执行所有跨行校验
 */
export function validateAllCrossRow(): ValidationResult[] {
  const results: ValidationResult[] = []
  results.push(...validateProjectNameConsistency())
  results.push(...validateBillingDateOrder())
  results.push(...validateDataDuplicate())
  return results
}

/**
 * 单列跨行校验（用于ON_BLUR时只校验相关列）
 */
export function validateCrossRowByCol(col: number): ValidationResult[] {
  const results: ValidationResult[] = []
  if (col === 0) results.push(...validateProjectNameConsistency())
  if (col === 5 || col === 6) results.push(...validateBillingDateOrder())
  if (col === 1 || col === 3 || col === 5 || col === 6) results.push(...validateDataDuplicate())
  return results
}
