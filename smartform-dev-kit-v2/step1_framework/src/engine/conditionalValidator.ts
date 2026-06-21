/**
 * 条件规则校验器
 * 实现8条条件依赖规则（has_triggers=true的规则）
 */
import type { ValidationResult } from './types'
import { getCellText, isRowNotEmpty } from './simpleValidator'

const luckysheet = () => (window as any).luckysheet

// ==================== 条件检测函数 ====================

/** 有业主信息：业主名称/业主联系电话/业主证件号码任一有值 */
function hasOwnerInfo(row: number): boolean {
  return [8, 9, 10].some((col) => getCellText(row, col) !== '')
}

/** 有租户信息：租户名称/电话/证件号码/出租开始日期任一有值 */
function hasTenantInfo(row: number): boolean {
  return [13, 14, 15, 19].some((col) => getCellText(row, col) !== '')
}

/** 售楼日期是否必填（3个条件OR） */
function isSaleDateRequired(row: number): boolean {
  return hasOwnerInfo(row)
    || getCellText(row, 6) !== ''  // 收房日期有值
    || getCellText(row, 7) !== ''  // 入住日期有值
}

// ==================== 条件规则校验 ====================

/** 规则7: 售楼日期_必填（触发：有业主信息） */
function validateSaleDateOwner(row: number): ValidationResult | null {
  if (!hasOwnerInfo(row)) return null
  if (getCellText(row, 5) !== '') return null
  return {
    isValid: false,
    ruleId: '售楼日期_必填_业主',
    severity: 'HIGH',
    message: '业主客户信息填写时，售楼时间必填',
    row,
    col: 5,
  }
}

/** 规则20: 业主客户类型_必填（触发：有业主信息） */
function validateOwnerCustType(row: number): ValidationResult | null {
  if (!hasOwnerInfo(row)) return null
  if (getCellText(row, 11) !== '') return null
  return {
    isValid: false,
    ruleId: '业主客户类型_必填',
    severity: 'HIGH',
    message: '业主的客户信息填写时，业主类型必填（个人 或 企业）',
    row,
    col: 11,
  }
}

/** 规则8: 售楼日期_必填（触发：收房日期有值） */
function validateSaleDateReceive(row: number): ValidationResult | null {
  if (getCellText(row, 6) === '') return null // 收房日期无值，不触发
  if (getCellText(row, 5) !== '') return null // 售楼日期已有值
  return {
    isValid: false,
    ruleId: '售楼日期_必填_收房',
    severity: 'HIGH',
    message: '收房日期填写时，售楼日期必填',
    row,
    col: 5,
  }
}

/** 规则16: 售楼日期_必填（触发：入住日期有值） */
function validateSaleDateMoveIn(row: number): ValidationResult | null {
  if (getCellText(row, 7) === '') return null
  if (getCellText(row, 5) !== '') return null
  return {
    isValid: false,
    ruleId: '售楼日期_必填_入住',
    severity: 'HIGH',
    message: '入住日期填写时，售楼日期必填',
    row,
    col: 5,
  }
}

/** 规则5: 租户证件号码_必填（触发：有租户信息 AND 证件类型有值） */
function validateTenantIdNumber(row: number): ValidationResult | null {
  if (!hasTenantInfo(row)) return null
  if (getCellText(row, 16) === '') return null // 证件类型无值，不触发
  if (getCellText(row, 15) !== '') return null // 证件号码已有值
  return {
    isValid: false,
    ruleId: '租户证件类型_必填',
    severity: 'MEDIUM',
    message: '租户证件类型非空时，租户证件号码必填',
    row,
    col: 15,
  }
}

/** 规则15: 出租开始日期_必填（触发：有租户信息） */
function validateRentStartDate(row: number): ValidationResult | null {
  if (!hasTenantInfo(row)) return null
  if (getCellText(row, 19) !== '') return null
  return {
    isValid: false,
    ruleId: '出租开始日期_必填',
    severity: 'MEDIUM',
    message: '租户的信息填写时，出租日期必填',
    row,
    col: 19,
  }
}

/** 规则12/19: 租户联系人_必填（触发：租户客户类型=企业） */
function validateTenantContact(row: number): ValidationResult | null {
  if (getCellText(row, 17) !== '企业') return null
  if (getCellText(row, 18) !== '') return null
  return {
    isValid: false,
    ruleId: '租户联系人_必填',
    severity: 'MEDIUM',
    message: '租户客户类型为企业时，租户联系人必填',
    row,
    col: 18,
  }
}

/** 规则17: 业主联系人_必填（触发：业主客户类型=企业） */
function validateOwnerContact(row: number): ValidationResult | null {
  if (getCellText(row, 11) !== '企业') return null
  if (getCellText(row, 12) !== '') return null
  return {
    isValid: false,
    ruleId: '业主联系人_必填',
    severity: 'MEDIUM',
    message: '业主客户类型为企业时，业主联系人必填',
    row,
    col: 12,
  }
}

// ==================== 公开接口 ====================

/**
 * 校验一行数据的所有条件规则
 */
export function validateConditionalRow(row: number): ValidationResult[] {
  if (row === 0) return []
  if (!isRowNotEmpty(row)) return []

  const results: ValidationResult[] = []

  const r7 = validateSaleDateOwner(row)
  if (r7) results.push(r7)

  const r20 = validateOwnerCustType(row)
  if (r20) results.push(r20)

  const r8 = validateSaleDateReceive(row)
  if (r8) results.push(r8)

  const r16 = validateSaleDateMoveIn(row)
  if (r16) results.push(r16)

  const r5 = validateTenantIdNumber(row)
  if (r5) results.push(r5)

  const r15 = validateRentStartDate(row)
  if (r15) results.push(r15)

  const r12 = validateTenantContact(row)
  if (r12) results.push(r12)

  const r17 = validateOwnerContact(row)
  if (r17) results.push(r17)

  return results
}

/**
 * 校验单个单元格的条件规则（用于ON_BLUR时校验目标字段）
 */
export function validateConditionalCell(row: number, col: number): ValidationResult | null {
  if (row === 0) return null

  // 售楼日期(col=5)的条件校验
  if (col === 5) {
    if (getCellText(row, 5) !== '') return null
    if (hasOwnerInfo(row)) {
      return { isValid: false, ruleId: '售楼日期_必填_业主', severity: 'HIGH', message: '业主客户信息填写时，售楼时间必填', row, col: 5 }
    }
    if (getCellText(row, 6) !== '') {
      return { isValid: false, ruleId: '售楼日期_必填_收房', severity: 'HIGH', message: '收房日期填写时，售楼日期必填', row, col: 5 }
    }
    if (getCellText(row, 7) !== '') {
      return { isValid: false, ruleId: '售楼日期_必填_入住', severity: 'HIGH', message: '入住日期填写时，售楼日期必填', row, col: 5 }
    }
    return null
  }

  // 业主客户类型(col=11)
  if (col === 11) {
    if (hasOwnerInfo(row) && getCellText(row, 11) === '') {
      return { isValid: false, ruleId: '业主客户类型_必填', severity: 'HIGH', message: '业主的客户信息填写时，业主类型必填（个人 或 企业）', row, col: 11 }
    }
    return null
  }

  // 业主联系人(col=12)
  if (col === 12) {
    if (getCellText(row, 11) === '企业' && getCellText(row, 12) === '') {
      return { isValid: false, ruleId: '业主联系人_必填', severity: 'MEDIUM', message: '业主客户类型为企业时，业主联系人必填', row, col: 12 }
    }
    return null
  }

  // 租户证件号码(col=15)
  if (col === 15) {
    if (hasTenantInfo(row) && getCellText(row, 16) !== '' && getCellText(row, 15) === '') {
      return { isValid: false, ruleId: '租户证件类型_必填', severity: 'MEDIUM', message: '租户证件类型非空时，租户证件号码必填', row, col: 15 }
    }
    return null
  }

  // 出租开始日期(col=19)
  if (col === 19) {
    if (hasTenantInfo(row) && getCellText(row, 19) === '') {
      return { isValid: false, ruleId: '出租开始日期_必填', severity: 'MEDIUM', message: '租户的信息填写时，出租日期必填', row, col: 19 }
    }
    return null
  }

  // 租户联系人(col=18)
  if (col === 18) {
    if (getCellText(row, 17) === '企业' && getCellText(row, 18) === '') {
      return { isValid: false, ruleId: '租户联系人_必填', severity: 'MEDIUM', message: '租户客户类型为企业时，租户联系人必填', row, col: 18 }
    }
    return null
  }

  return null
}

/**
 * 全量条件校验
 */
export function validateConditionalAll(): ValidationResult[] {
  const ls = luckysheet()
  if (!ls) return []
  const flowdata = ls.getFlowdata()
  if (!flowdata) return []

  const allResults: ValidationResult[] = []
  for (let r = 1; r < flowdata.length; r++) {
    allResults.push(...validateConditionalRow(r))
  }
  return allResults
}
