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
    severity: 'CRITICAL',
    message: '业主客户信息填写时，售楼时间必填',
    row,
    col: 12,
  }
}

/** 规则20: 业主客户类型_必填（触发：仅业主类型有值——兜底"只填业主类型"场景；其余触发源由 validateOwnerGroupRequired 统一处理） */
function validateOwnerCustType(row: number): ValidationResult | null {
  if (getCellText(row, 17) === '') return null
  if (getCellText(row, 15) !== '') return null
  return {
    isValid: false,
    ruleId: '业主客户类型_必填',
    severity: 'CRITICAL',
    message: '业主类型已填写时，业主客户类型必填（个人 或 企业）',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
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
    severity: 'CRITICAL',
    message: '租户证件类型已填写时，租户证件号码必填',
    row,
    col: 30,
  }
}

/**
 * 业主信息三组联动必填校验（聚合函数，按缺失字段去重）
 * 规则1: 业主联系电话(18)有值 → 业主客户类型(15)、业主客户名称(16)、业主类型(17) 均必填
 * 规则2: 业主客户类型(15)有值 → 业主类型(17)、业主客户名称(16) 均必填
 * 规则3: 业主客户名称(16)有值 → 业主类型(17)、业主客户类型(15) 均必填
 * 同一缺失字段只报一次，多个触发源合并进一条消息
 */
function validateOwnerGroupRequired(row: number): ValidationResult[] {
  const results: ValidationResult[] = []

  /** 缺失目标列 → 触发源标签列表（聚合，防重复） */
  const missingMap = new Map<number, string[]>()

  /** 触发源标签 */
  const TRIGGER_LABELS: Record<number, string> = {
    15: '业主客户类型',
    16: '业主客户名称',
    17: '业主类型',
    18: '业主联系电话',
  }
  /** 目标列 → ruleId（沿用既有命名策略：目标字段_必填） */
  const RULE_IDS: Record<number, string> = {
    15: '业主客户类型_必填',
    16: '业主客户名称_必填',
    17: '业主类型_必填',
  }

  /** 若目标列缺失，记录其触发源标签（去重） */
  const markMissing = (sourceCol: number, targetCol: number) => {
    if (getCellText(row, targetCol) === '') {
      const list = missingMap.get(targetCol) || []
      const triggerLabel = TRIGGER_LABELS[sourceCol]
      if (!list.includes(triggerLabel)) list.push(triggerLabel)
      missingMap.set(targetCol, list)
    }
  }

  // 规则1: 业主联系电话(18)有值 → 15/16/17 必填
  if (getCellText(row, 18) !== '') {
    markMissing(18, 15)
    markMissing(18, 16)
    markMissing(18, 17)
  }
  // 规则2: 业主客户类型(15)有值 → 17/16 必填
  if (getCellText(row, 15) !== '') {
    markMissing(15, 17)
    markMissing(15, 16)
  }
  // 规则3: 业主客户名称(16)有值 → 17/15 必填
  if (getCellText(row, 16) !== '') {
    markMissing(16, 17)
    markMissing(16, 15)
  }

  // 按缺失列聚合生成错误（一列一条，标明缺失字段名）
  missingMap.forEach((triggers, col) => {
    const triggerText = triggers.join('、')
    results.push({
      isValid: false,
      ruleId: RULE_IDS[col],
      severity: 'CRITICAL',
      message: `${triggerText}已填写时，${TRIGGER_LABELS[col]}必填`,
      row,
      col,
    })
  })

  return results
}

/** 规则: 单元名称有值时，楼栋名称必填 */
function validateBuildingNameRequired(row: number): ValidationResult | null {
  if (getCellText(row, 3) === '') return null  // 单元名称无值，不触发
  if (getCellText(row, 2) !== '') return null  // 楼栋名称已有值
  return {
    isValid: false,
    ruleId: '楼栋名称_必填',
    severity: 'CRITICAL',
    message: '单元名称已填写时，楼栋名称必填',
    row,
    col: 2,
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

  // 业主三组联动必填（规则1/2/3，聚合函数）
  results.push(...validateOwnerGroupRequired(row))

  const r_building_name = validateBuildingNameRequired(row)
  if (r_building_name) results.push(r_building_name)

  return results
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
