/**
 * 条件规则校验器
 * 实现8条条件依赖规则（has_triggers=true的规则）
 */
import type { ValidationResult } from './types'
import { getCellText, isRowNotEmpty } from './simpleValidator'

/** 获取flowdata */
function getFlowdata(): any[][] | null {
  const ls = (window as any).luckysheet
  if (!ls) return null
  if (typeof ls.getSheetData === 'function') return ls.getSheetData()
  if (typeof ls.flowdata === 'function') return ls.flowdata()
  return null
}

// ==================== 条件检测函数 ====================

/** 有业主信息：业主客户名称/业主类型/业主联系电话任一有值 */
function hasOwnerInfo(row: number): boolean {
  return [16, 17, 18].some((col) => getCellText(row, col) !== '')
}

/** 有租户信息：租户客户名称/租户联系电话/租户证件号码/出租开始日期任一有值 */
function hasTenantInfo(row: number): boolean {
  return [23, 26, 27, 30].some((col) => getCellText(row, col) !== '')
}

/** 售楼日期是否必填（3个条件OR） */
function isSaleDateRequired(row: number): boolean {
  return hasOwnerInfo(row)
    || getCellText(row, 13) !== ''  // 收房日期有值
    || getCellText(row, 14) !== ''  // 入住日期有值
}

// ==================== 条件规则校验 ====================

/** 规则7: 售楼日期_必填（触发：有业主信息） */
function validateSaleDateOwner(row: number): ValidationResult | null {
  if (!hasOwnerInfo(row)) return null
  if (getCellText(row, 12) !== '') return null
  return {
    isValid: false,
    ruleId: '售楼日期_必填_业主',
    severity: 'HIGH',
    message: '业主客户信息填写时，售楼时间必填',
    row,
    col: 12,
  }
}

/** 规则20: 业主客户类型_必填（触发：有业主信息） */
function validateOwnerCustType(row: number): ValidationResult | null {
  if (!hasOwnerInfo(row)) return null
  if (getCellText(row, 15) !== '') return null
  return {
    isValid: false,
    ruleId: '业主客户类型_必填',
    severity: 'HIGH',
    message: '业主的客户信息填写时，业主客户类型必填（个人 或 企业）',
    row,
    col: 15,
  }
}

/** 规则8: 售楼日期_必填（触发：收房日期有值） */
function validateSaleDateReceive(row: number): ValidationResult | null {
  if (getCellText(row, 13) === '') return null // 收房日期无值，不触发
  if (getCellText(row, 12) !== '') return null // 售楼日期已有值
  return {
    isValid: false,
    ruleId: '售楼日期_必填_收房',
    severity: 'HIGH',
    message: '收房日期填写时，售楼日期必填',
    row,
    col: 12,
  }
}

/** 规则16: 售楼日期_必填（触发：入住日期有值） */
function validateSaleDateMoveIn(row: number): ValidationResult | null {
  if (getCellText(row, 14) === '') return null
  if (getCellText(row, 12) !== '') return null
  return {
    isValid: false,
    ruleId: '售楼日期_必填_入住',
    severity: 'HIGH',
    message: '入住日期填写时，售楼日期必填',
    row,
    col: 12,
  }
}

/** 规则: 出租开始日期填写时，租户客户名称必填 */
function validateTenantNameOnRent(row: number): ValidationResult | null {
  if (getCellText(row, 23) === '') return null // 出租日期未填，不触发
  if (getCellText(row, 26) !== '') return null // 租户客户名称已有值
  return {
    isValid: false,
    ruleId: '租户客户名称_必填',
    severity: 'MEDIUM',
    message: '出租日期填写时，租户客户名称必填',
    row,
    col: 26,
  }
}

/** 规则: 租户联系电话非空时，租户客户名称必填 */
function validateTenantNameOnPhone(row: number): ValidationResult | null {
  if (getCellText(row, 27) === '') return null // 联系电话为空，不触发
  if (getCellText(row, 26) !== '') return null // 租户客户名称已有值
  return {
    isValid: false,
    ruleId: '租户客户名称_必填',
    severity: 'MEDIUM',
    message: '租户联系电话填写时，租户客户名称必填',
    row,
    col: 26,
  }
}

/** 规则15: 出租开始日期_必填（触发：有租户信息） */
function validateRentStartDate(row: number): ValidationResult | null {
  if (!hasTenantInfo(row)) return null
  if (getCellText(row, 23) !== '') return null
  return {
    isValid: false,
    ruleId: '出租开始日期_必填',
    severity: 'MEDIUM',
    message: '租户的信息填写时，出租日期必填',
    row,
    col: 23,
  }
}

/** 规则16: 出租结束日期_必填（触发：有租户信息） */
function validateRentEndDate(row: number): ValidationResult | null {
  if (!hasTenantInfo(row)) return null
  if (getCellText(row, 24) !== '') return null
  return {
    isValid: false,
    ruleId: '出租结束日期_必填',
    severity: 'MEDIUM',
    message: '租户的信息填写时，出租结束日期必填',
    row,
    col: 24,
  }
}

/** 规则12/19: 租户企业联系人_必填（触发：租户客户类型=企业） */
function validateTenantContact(row: number): ValidationResult | null {
  if (getCellText(row, 25) !== '企业') return null
  if (getCellText(row, 28) !== '') return null
  return {
    isValid: false,
    ruleId: '租户企业联系人_必填',
    severity: 'MEDIUM',
    message: '租户客户类型为企业时，租户企业联系人必填',
    row,
    col: 28,
  }
}

/** 规则17: 企业联系人_必填（触发：业主客户类型=企业） */
function validateOwnerContact(row: number): ValidationResult | null {
  if (getCellText(row, 15) !== '企业') return null
  if (getCellText(row, 21) !== '') return null
  return {
    isValid: false,
    ruleId: '企业联系人_必填',
    severity: 'MEDIUM',
    message: '业主客户类型为企业时，企业联系人必填',
    row,
    col: 21,
  }
}

/** 规则: 业主证件号码_必填（触发：业主证件类型有值） */
function validateOwnerIdNoRequired(row: number): ValidationResult | null {
  const idType = getCellText(row, 19)
  if (idType === '') return null  // 证件类型未填，不触发
  const idNo = getCellText(row, 20)
  if (idNo !== '') return null    // 证件号码已填，不报错
  return {
    isValid: false,
    ruleId: '业主证件号码_必填',
    severity: 'HIGH',
    message: '业主证件类型已填写时，业主证件号码必填',
    row,
    col: 20,
  }
}

/** 规则: 租户证件号码_必填（触发：租户证件类型有值） */
function validateTenantIdNoRequired(row: number): ValidationResult | null {
  const idType = getCellText(row, 29)
  if (idType === '') return null  // 证件类型未填，不触发
  const idNo = getCellText(row, 30)
  if (idNo !== '') return null    // 证件号码已填，不报错
  return {
    isValid: false,
    ruleId: '租户证件号码_必填',
    severity: 'HIGH',
    message: '租户证件类型已填写时，租户证件号码必填',
    row,
    col: 30,
  }
}

/** 业主客户类型有值时，业主类型必填 */
function validateOwnerTypeRequired(row: number): ValidationResult | null {
  const custType = getCellText(row, 15)
  if (custType === '') return null  // 业主客户类型未填，不触发
  const ownerType = getCellText(row, 17)
  if (ownerType !== '') return null  // 业主类型已填，不报错
  return {
    isValid: false,
    ruleId: '业主类型_必填',
    severity: 'HIGH',
    message: '业主客户类型已填写时，业主类型必填（业主 或 共有产权人）',
    row,
    col: 17,
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

  const r15 = validateRentStartDate(row)
  if (r15) results.push(r15)

  const r_tenant_name = validateTenantNameOnRent(row)
  if (r_tenant_name) results.push(r_tenant_name)

  const r_tenant_name_phone = validateTenantNameOnPhone(row)
  if (r_tenant_name_phone) results.push(r_tenant_name_phone)

  const r16_end = validateRentEndDate(row)
  if (r16_end) results.push(r16_end)

  const r12 = validateTenantContact(row)
  if (r12) results.push(r12)

  const r17 = validateOwnerContact(row)
  if (r17) results.push(r17)

  const r_owner_id_no = validateOwnerIdNoRequired(row)
  if (r_owner_id_no) results.push(r_owner_id_no)

  const r_tenant_id_no = validateTenantIdNoRequired(row)
  if (r_tenant_id_no) results.push(r_tenant_id_no)

  const r_owner_type = validateOwnerTypeRequired(row)
  if (r_owner_type) results.push(r_owner_type)

  return results
}

/**
 * 校验单个单元格的条件规则（用于ON_BLUR时校验目标字段）
 */
export function validateConditionalCell(row: number, col: number): ValidationResult | null {
  if (row === 0) return null

  // 售楼日期(col=12)的条件校验
  if (col === 12) {
    if (getCellText(row, 12) !== '') return null
    if (hasOwnerInfo(row)) {
      return { isValid: false, ruleId: '售楼日期_必填_业主', severity: 'HIGH', message: '业主客户信息填写时，售楼时间必填', row, col: 12 }
    }
    if (getCellText(row, 13) !== '') {
      return { isValid: false, ruleId: '售楼日期_必填_收房', severity: 'HIGH', message: '收房日期填写时，售楼日期必填', row, col: 12 }
    }
    if (getCellText(row, 14) !== '') {
      return { isValid: false, ruleId: '售楼日期_必填_入住', severity: 'HIGH', message: '入住日期填写时，售楼日期必填', row, col: 12 }
    }
    return null
  }

  // 业主客户类型(col=15)
  if (col === 15) {
    if (hasOwnerInfo(row) && getCellText(row, 15) === '') {
      return { isValid: false, ruleId: '业主客户类型_必填', severity: 'HIGH', message: '业主的客户信息填写时，业主客户类型必填（个人 或 企业）', row, col: 15 }
    }
    return null
  }

  // 企业联系人(col=21)
  if (col === 21) {
    if (getCellText(row, 15) === '企业' && getCellText(row, 21) === '') {
      return { isValid: false, ruleId: '企业联系人_必填', severity: 'MEDIUM', message: '业主客户类型为企业时，企业联系人必填', row, col: 21 }
    }
    return null
  }

  // 出租开始日期(col=23)
  if (col === 23) {
    if (hasTenantInfo(row) && getCellText(row, 23) === '') {
      return { isValid: false, ruleId: '出租开始日期_必填', severity: 'MEDIUM', message: '租户的信息填写时，出租日期必填', row, col: 23 }
    }
    // 出租日期填写时，租户客户名称必填
    if (getCellText(row, 23) !== '' && getCellText(row, 26) === '') {
      return { isValid: false, ruleId: '租户客户名称_必填', severity: 'MEDIUM', message: '出租日期填写时，租户客户名称必填', row, col: 26 }
    }
    return null
  }

  // 租户客户名称(col=26)
  if (col === 26) {
    // 出租日期填写时，租户客户名称必填
    if (getCellText(row, 23) !== '' && getCellText(row, 26) === '') {
      return { isValid: false, ruleId: '租户客户名称_必填', severity: 'MEDIUM', message: '出租日期填写时，租户客户名称必填', row, col: 26 }
    }
    // 租户联系电话填写时，租户客户名称必填
    if (getCellText(row, 27) !== '' && getCellText(row, 26) === '') {
      return { isValid: false, ruleId: '租户客户名称_必填', severity: 'MEDIUM', message: '租户联系电话填写时，租户客户名称必填', row, col: 26 }
    }
    return null
  }

  // 租户联系电话(col=27)
  if (col === 27) {
    // 联系电话非空时，租户客户名称必填
    if (getCellText(row, 27) !== '' && getCellText(row, 26) === '') {
      return { isValid: false, ruleId: '租户客户名称_必填', severity: 'MEDIUM', message: '租户联系电话填写时，租户客户名称必填', row, col: 26 }
    }
    return null
  }

  // 出租结束日期(col=24)
  if (col === 24) {
    if (hasTenantInfo(row) && getCellText(row, 24) === '') {
      return { isValid: false, ruleId: '出租结束日期_必填', severity: 'MEDIUM', message: '租户的信息填写时，出租结束日期必填', row, col: 24 }
    }
    return null
  }

  // 租户企业联系人(col=28)
  if (col === 28) {
    if (getCellText(row, 25) === '企业' && getCellText(row, 28) === '') {
      return { isValid: false, ruleId: '租户企业联系人_必填', severity: 'MEDIUM', message: '租户客户类型为企业时，租户企业联系人必填', row, col: 28 }
    }
    return null
  }

  // 业主证件号码(col=20)
  if (col === 20) {
    const idType = getCellText(row, 19)
    if (idType !== '' && getCellText(row, 20) === '') {
      return { isValid: false, ruleId: '业主证件号码_必填', severity: 'HIGH', message: '业主证件类型已填写时，业主证件号码必填', row, col: 20 }
    }
    return null
  }

  // 业主证件类型(col=19) - 变化时需触发证件号码校验
  if (col === 19) {
    const idType = getCellText(row, 19)
    if (idType !== '' && getCellText(row, 20) === '') {
      return { isValid: false, ruleId: '业主证件号码_必填', severity: 'HIGH', message: '业主证件类型已填写时，业主证件号码必填', row, col: 20 }
    }
    return null
  }

  // 租户证件号码(col=30)
  if (col === 30) {
    const idType = getCellText(row, 29)
    if (idType !== '' && getCellText(row, 30) === '') {
      return { isValid: false, ruleId: '租户证件号码_必填', severity: 'HIGH', message: '租户证件类型已填写时，租户证件号码必填', row, col: 30 }
    }
    return null
  }

  // 租户证件类型(col=29) - 变化时需触发证件号码校验
  if (col === 29) {
    const idType = getCellText(row, 29)
    if (idType !== '' && getCellText(row, 30) === '') {
      return { isValid: false, ruleId: '租户证件号码_必填', severity: 'HIGH', message: '租户证件类型已填写时，租户证件号码必填', row, col: 30 }
    }
    return null
  }

  // 业主客户类型(col=15) - 变化时需触发业主类型校验
  if (col === 15) {
    const custType = getCellText(row, 15)
    if (custType !== '' && getCellText(row, 17) === '') {
      return { isValid: false, ruleId: '业主类型_必填', severity: 'HIGH', message: '业主客户类型已填写时，业主类型必填（业主 或 共有产权人）', row, col: 17 }
    }
    return null
  }

  // 业主类型(col=17) - 变化时需触发业主证件号码校验
  if (col === 17) {
    const idType = getCellText(row, 19)
    if (idType !== '' && getCellText(row, 20) === '') {
      return { isValid: false, ruleId: '业主证件号码_必填', severity: 'HIGH', message: '业主证件类型已填写时，业主证件号码必填', row, col: 20 }
    }
    return null
  }

  return null
}

/**
 * 全量条件校验
 */
export function validateConditionalAll(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  const allResults: ValidationResult[] = []
  for (let r = 1; r < flowdata.length; r++) {
    allResults.push(...validateConditionalRow(r))
  }
  return allResults
}
