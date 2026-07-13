/**
 * 应收已收 - 条件规则校验器
 * 实现条件依赖规则：减免联动、缴款三字段联动、缴款金额上限、计费日期逻辑
 */
import type { ValidationResult } from '../types'
import { getCellText, isRowNotEmpty, isValidDateStr, normalizeDate } from './simpleValidator'
import { FINANCE_HEADER_ROW_COUNT } from './types'

// ==================== 条件规则校验 ====================

/** 规则3: 减免金额有值 → 减免分类必填 */
function validateExemptionAmountToCategory(row: number): ValidationResult | null {
  if (getCellText(row, 9) === '') return null  // 减免金额空，不触发
  if (getCellText(row, 10) !== '') return null // 减免分类已有值
  return {
    isValid: false,
    ruleId: '减免金额_减免分类联动',
    severity: 'HIGH',
    message: '减免金额已填写时，减免分类为必填项',
    row, col: 10,
  }
}

/** 规则4: 减免分类有值 → 减免金额必填 */
function validateExemptionCategoryToAmount(row: number): ValidationResult | null {
  if (getCellText(row, 10) === '') return null // 减免分类空，不触发
  if (getCellText(row, 9) !== '') return null  // 减免金额已有值
  return {
    isValid: false,
    ruleId: '减免分类_减免金额联动',
    severity: 'HIGH',
    message: '减免分类已填写时，减免金额为必填项',
    row, col: 9,
  }
}

/** 规则5: 缴款三字段联动 - 检查三个字段要么全空要么全有值 */
function validatePaymentTriple(row: number): ValidationResult[] {
  const amount = getCellText(row, 13)   // 缴款金额
  const date = getCellText(row, 14)     // 缴款日期
  const method = getCellText(row, 15)   // 支付方式

  const hasAmount = amount !== ''
  const hasDate = date !== ''
  const hasMethod = method !== ''

  // 全空或全有值 → 通过
  if ((!hasAmount && !hasDate && !hasMethod) || (hasAmount && hasDate && hasMethod)) {
    return []
  }

  const results: ValidationResult[] = []

  if (!hasAmount && (hasDate || hasMethod)) {
    results.push({
      isValid: false, ruleId: '缴款三字段联动', severity: 'HIGH',
      message: '缴款金额、缴款日期、支付方式三个字段需同时填写或同时为空',
      row, col: 13,
    })
  }
  if (!hasDate && (hasAmount || hasMethod)) {
    results.push({
      isValid: false, ruleId: '缴款三字段联动', severity: 'HIGH',
      message: '缴款金额、缴款日期、支付方式三个字段需同时填写或同时为空',
      row, col: 14,
    })
  }
  if (!hasMethod && (hasAmount || hasDate)) {
    results.push({
      isValid: false, ruleId: '缴款三字段联动', severity: 'HIGH',
      message: '缴款金额、缴款日期、支付方式三个字段需同时填写或同时为空',
      row, col: 15,
    })
  }

  return results
}

/** 规则6: 缴款金额 ≤ 应收金额 */
function validatePaymentAmountLimit(row: number): ValidationResult | null {
  const payStr = getCellText(row, 13)
  if (payStr === '') return null
  const recvStr = getCellText(row, 8)
  if (recvStr === '') return null // 应收金额为空则跳过

  const pay = parseFloat(payStr)
  const recv = parseFloat(recvStr)
  if (isNaN(pay) || isNaN(recv)) return null

  if (pay > recv) {
    return {
      isValid: false,
      ruleId: '缴款金额上限',
      severity: 'CRITICAL',
      message: `缴款金额(${payStr})不能大于应收金额(${recvStr})`,
      row, col: 13,
    }
  }
  return null
}

// ==================== 公开接口 ====================

/**
 * 校验一行数据的所有条件规则
 */
export function validateConditionalRow(row: number): ValidationResult[] {
  if (row < FINANCE_HEADER_ROW_COUNT) return []
  if (!isRowNotEmpty(row)) return []

  const results: ValidationResult[] = []

  const r3 = validateExemptionAmountToCategory(row)
  if (r3) results.push(r3)

  const r4 = validateExemptionCategoryToAmount(row)
  if (r4) results.push(r4)

  results.push(...validatePaymentTriple(row))

  const r6 = validatePaymentAmountLimit(row)
  if (r6) results.push(r6)

  return results
}

/**
 * 全量条件校验
 */
export function validateConditionalAll(): ValidationResult[] {
  const ls = (window as any).luckysheet
  let flowdata: any[][] | null = null
  if (ls) {
    if (typeof ls.getSheetData === 'function') flowdata = ls.getSheetData()
    else if (typeof ls.flowdata === 'function') flowdata = ls.flowdata()
  }
  if (!flowdata) return []

  const allResults: ValidationResult[] = []
  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    allResults.push(...validateConditionalRow(r))
  }
  return allResults
}
