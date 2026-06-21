import type { ValidationResult } from './types'

/** 获取luckysheet API对象 */
function getLs(): any {
  return (window as any).luckysheet
}

/** 获取flowdata */
function getFlowdata(): any[][] | null {
  const ls = getLs()
  if (!ls) return null
  if (typeof ls.getSheetData === 'function') return ls.getSheetData()
  if (typeof ls.flowdata === 'function') return ls.flowdata()
  return null
}

/** 获取单元格文本值（空值安全，处理三种空状态） */
export function getCellText(row: number, col: number): string {
  const ls = getLs()
  if (!ls) return ''
  const val = ls.getCellValue(row, col)
  if (val === null || val === undefined) return ''
  // 处理Luckysheet可能将日期存为Excel序列号的情况
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
  for (let c = 0; c < 32; c++) {
    if (getCellText(row, c) !== '') return true
  }
  return false
}

// ==================== 简单规则校验函数 ====================

/** 规则: 项目名称_必填 */
function validateProjectName(row: number): ValidationResult | null {
  const val = getCellText(row, 0)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '项目名称_必填',
      severity: 'CRITICAL',
      message: '项目名称不可为空',
      row,
      col: 0,
    }
  }
  return null
}

/** 规则: 楼栋名称_必填 */
function validateBuildingName(row: number): ValidationResult | null {
  const val = getCellText(row, 2)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '楼栋名称_必填',
      severity: 'CRITICAL',
      message: '楼栋名称不可为空',
      row,
      col: 2,
    }
  }
  return null
}

/** 规则1: 房产简称_必填 - 不可为空 */
function validatePropertyName(row: number): ValidationResult | null {
  const val = getCellText(row, 6)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '房产简称_必填',
      severity: 'CRITICAL',
      message: '房产简称不可为空且在项目中唯一',
      row,
      col: 6,
    }
  }
  return null
}

/** 规则6: 楼层_必填 - 不可为空且必须为正整数 */
const FLOOR_REGEX = /^[1-9]\d*$/

function validateFloor(row: number): ValidationResult | null {
  const val = getCellText(row, 4)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '楼层_必填',
      severity: 'CRITICAL',
      message: '楼层不可为空且必须为正整数',
      row,
      col: 4,
    }
  }
  if (!FLOOR_REGEX.test(val)) {
    return {
      isValid: false,
      ruleId: '楼层_必填',
      severity: 'CRITICAL',
      message: '楼层不可为空且必须为正整数',
      row,
      col: 4,
    }
  }
  return null
}

/** 规则10: 房号_必填 - 不可为空 */
function validateRoomNo(row: number): ValidationResult | null {
  const val = getCellText(row, 5)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '房号_必填',
      severity: 'CRITICAL',
      message: '房号不可为空',
      row,
      col: 5,
    }
  }
  return null
}

/** 规则13: 房产类型_必填 - 不可为空且必须是枚举值 */
const PROPERTY_TYPES = ['机动车位', '非机动车位', '商品房', '写字楼', '商铺', '别墅']

function validatePropertyType(row: number): ValidationResult | null {
  const val = getCellText(row, 8)
  if (val === '') {
    return {
      isValid: false,
      ruleId: '房产类型_必填',
      severity: 'CRITICAL',
      message: '房产类型不可为空，请选择：机动车位|非机动车位|商品房|写字楼|商铺|别墅',
      row,
      col: 8,
    }
  }
  if (!PROPERTY_TYPES.includes(val)) {
    return {
      isValid: false,
      ruleId: '房产类型_必填',
      severity: 'CRITICAL',
      message: '房产类型不可为空，请选择：机动车位|非机动车位|商品房|写字楼|商铺|别墅',
      row,
      col: 8,
    }
  }
  return null
}

/** 规则2: 格式_计费面积 - 如果有值，必须为正数，最多4位小数 */
const AREA_REGEX = /^(0|[1-9]\d*)(\.\d{1,4})?$/

function validateBillingArea(row: number): ValidationResult | null {
  const val = getCellText(row, 7)
  if (val === '') return null
  if (!AREA_REGEX.test(val)) {
    return {
      isValid: false,
      ruleId: '格式_计费面积',
      severity: 'HIGH',
      message: '计费面积应为正数，且需保留四位小数',
      row,
      col: 7,
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

/** 格式_客户类型 - 如果有值，必须是"个人"或"企业" */
const CUST_TYPES = ['个人', '企业']

function validateCustType(row: number, col: number): ValidationResult | null {
  const val = getCellText(row, col)
  if (val === '') return null
  if (!CUST_TYPES.includes(val)) {
    return {
      isValid: false,
      ruleId: '格式_客户类型',
      severity: 'HIGH',
      message: '客户类型必须为"个人"或"企业"',
      row,
      col,
    }
  }
  return null
}

/** 业主证件类型 - 非必填，有值则必须为"身份证"或"其他" */
const OWNER_ID_TYPES = ['身份证', '其他']

function validateOwnerIdType(row: number): ValidationResult | null {
  const val = getCellText(row, 19)
  if (val === '') return null
  if (!OWNER_ID_TYPES.includes(val)) {
    return {
      isValid: false,
      ruleId: '格式_业主证件类型',
      severity: 'HIGH',
      message: '业主证件类型必须为"身份证"或"其他"',
      row,
      col: 19,
    }
  }
  return null
}

/** 业主证件号码 - 如果填入则业主证件类型必填；身份证则校验GB 11643-1999 */
function validateOwnerIdNo(row: number): ValidationResult | null {
  const idNo = getCellText(row, 20)
  const idType = getCellText(row, 19)

  // 证件号码有值但证件类型为空
  if (idNo !== '' && idType === '') {
    return {
      isValid: false,
      ruleId: '业主证件类型_必填',
      severity: 'HIGH',
      message: '填写业主证件号码时，业主证件类型必填',
      row,
      col: 19,
    }
  }

  // 证件类型为身份证，校验证件号码格式（GB 11643-1999）
  if (idType === '身份证' && idNo !== '') {
    if (!isValidGB11643(idNo)) {
      return {
        isValid: false,
        ruleId: '格式_业主证件号码',
        severity: 'HIGH',
        message: '业主证件号码不符合GB 11643-1999身份证标准',
        row,
        col: 20,
      }
    }
  }

  return null
}

/** GB 11643-1999 身份证号校验（18位，含校验码验证） */
function isValidGB11643(id: string): boolean {
  // 18位：6位地址码 + 8位出生日期 + 3位顺序码 + 1位校验码
  if (!/^\d{17}[\dXx]$/.test(id)) return false

  // 出生日期校验
  const year = parseInt(id.substring(6, 10))
  const month = parseInt(id.substring(10, 12))
  const day = parseInt(id.substring(12, 14))
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return false

  // 校验码验证
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id[i]) * weights[i]
  }
  const checkChar = checkCodes[sum % 11]
  return id[17].toUpperCase() === checkChar
}

// ==================== 公开接口 ====================

/** 日期列: 售楼/收房/入住/出租开始/出租结束 (col=12,13,14,23,24) */
const DATE_COLUMNS = [12, 13, 14, 23, 24]
/** 证件号码列: 租户证件号码 (col=30) */
const ID_COLUMNS = [30]
/** 客户类型列: 业主客户类型/租户客户类型 (col=15,25) */
const CUST_TYPE_COLUMNS = [15, 25]

/**
 * 校验单个单元格（用于ON_INPUT即时校验）
 * 校验格式规则 + 必填规则
 */
export function validateCell(row: number, col: number): ValidationResult | null {
  if (row === 0) return null

  // 必填规则
  if (col === 0) return validateProjectName(row)
  if (col === 2) return validateBuildingName(row)
  if (col === 5) return validateRoomNo(row)
  if (col === 6) return validatePropertyName(row)

  // 楼层（必填+格式）
  if (col === 4) return validateFloor(row)

  // 房产类型（必填+枚举）
  if (col === 8) return validatePropertyType(row)

  // 计费面积格式
  if (col === 7) return validateBillingArea(row)

  // 日期格式
  if (DATE_COLUMNS.includes(col)) return validateDateField(row, col)

  // 证件号码格式
  if (ID_COLUMNS.includes(col)) return validateIdNumber(row, col)

  // 客户类型格式
  if (CUST_TYPE_COLUMNS.includes(col)) return validateCustType(row, col)

  // 业主证件类型格式
  if (col === 19) return validateOwnerIdType(row)

  // 业主证件号码（需联动证件类型）
  if (col === 20) return validateOwnerIdNo(row)

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
  const rProject = validateProjectName(row)
  if (rProject) results.push(rProject)

  const rBuilding = validateBuildingName(row)
  if (rBuilding) results.push(rBuilding)

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

  for (const col of CUST_TYPE_COLUMNS) {
    const r = validateCustType(row, col)
    if (r) results.push(r)
  }

  // 业主证件类型 + 业主证件号码
  const rIdType = validateOwnerIdType(row)
  if (rIdType) results.push(rIdType)

  const rIdNo = validateOwnerIdNo(row)
  if (rIdNo) results.push(rIdNo)

  return results
}

/**
 * 校验全部数据（简单规则）
 */
export function validateAll(): { errors: ValidationResult[]; warnings: ValidationResult[] } {
  const flowdata = getFlowdata()
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
  const flowdata = getFlowdata()
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
  const flowdata = getFlowdata()
  if (!flowdata) return 0
  return flowdata.length - 1
}
