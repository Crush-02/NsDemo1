/**
 * 跨行校验器
 * 实现跨行唯一性、一致性、日期顺序校验
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

/**
 * 规则1补充: 房产简称唯一性
 * 遍历所有行的房产简称，重复值标记错误
 */
export function validatePropertyNameUniqueness(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  // 统计每个房产简称出现的行
  const nameToRows = new Map<string, number[]>()
  for (let r = 1; r < flowdata.length; r++) {
    const val = getCellText(r, 6)
    if (val === '') continue
    if (!isRowNotEmpty(r)) continue
    const rows = nameToRows.get(val) || []
    rows.push(r)
    nameToRows.set(val, rows)
  }

  // 对重复的生成错误
  const results: ValidationResult[] = []
  nameToRows.forEach((rows, name) => {
    if (rows.length <= 1) return
    rows.forEach((row) => {
      results.push({
        isValid: false,
        ruleId: '房产简称_唯一性',
        severity: 'HIGH',
        message: `房产简称"${name}"重复出现${rows.length}次，在项目中必须唯一`,
        row,
        col: 6,
      })
    })
  })

  return results
}

/**
 * 规则3: 客户信息一致性
 * 同一证件号码对应不同的客户名称 → 报错
 * 检查租户(col=30, col=26)
 */
export function validateCustomerConsistency(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  // 证件号码 → 名称 的映射
  const idToNames = new Map<string, Map<string, { row: number; col: number }[]>>()

  for (let r = 1; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue

    // 租户证件号码(col=30) → 租户客户名称(col=26)
    const tenantId = getCellText(r, 30)
    if (tenantId !== '') {
      const tenantName = getCellText(r, 26)
      if (!idToNames.has(tenantId)) {
        idToNames.set(tenantId, new Map())
      }
      const nameMap = idToNames.get(tenantId)!
      if (!nameMap.has(tenantName)) {
        nameMap.set(tenantName, [])
      }
      nameMap.get(tenantName)!.push({ row: r, col: 30 })
    }
  }

  // 同一证件号码对应多个不同名称 → 报错
  const results: ValidationResult[] = []
  idToNames.forEach((nameMap, id) => {
    if (nameMap.size <= 1) return
    // 有多个不同名称对应同一证件号码
    nameMap.forEach((locations) => {
      locations.forEach(({ row, col }) => {
        results.push({
          isValid: false,
          ruleId: '客户信息一致性',
          severity: 'HIGH',
          message: '存在相同证件号码但是名称不同的客户，请核对客户信息',
          row,
          col,
        })
      })
    })
  })

  return results
}

/**
 * 规则14: 日期先后顺序
 * 收房日期(col=13)不能小于售楼日期(col=12)
 */
export function validateDateOrder(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  const results: ValidationResult[] = []
  const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

  for (let r = 1; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue
    const saleDate = getCellText(r, 12)
    const receiveDate = getCellText(r, 13)

    if (saleDate === '' || receiveDate === '') continue
    if (!DATE_REGEX.test(saleDate) || !DATE_REGEX.test(receiveDate)) continue

    // 字符串直接比较（YYYY-MM-DD格式保证可比较）
    if (receiveDate < saleDate) {
      results.push({
        isValid: false,
        ruleId: '日期顺序',
        severity: 'HIGH',
        message: '收房日期不能小于售楼日期',
        row: r,
        col: 13,
      })
    }
  }

  return results
}

/**
 * 规则: 业主证件号码跨行一致性
 * 不同业主（名称+电话不同）不能使用相同的证件号码
 */
export function validateOwnerIdNoConsistency(): ValidationResult[] {
  const flowdata = getFlowdata()
  if (!flowdata) return []

  // key: 业主证件号码 → { ownerKeys: Set<string>, rows: number[] }
  // ownerKey = "业主名称|业主电话"，用于判断是否为不同业主
  const idNoMap = new Map<string, { ownerKeys: Set<string>; rows: number[] }>()

  for (let r = 1; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue

    const ownerName = getCellText(r, 16)
    const ownerPhone = getCellText(r, 18)
    const ownerIdNo = getCellText(r, 20)

    // 证件号码为空则跳过
    if (ownerIdNo === '') continue
    // 业主名称和电话都为空则跳过（无法判断是否为不同业主）
    if (ownerName === '' && ownerPhone === '') continue

    const ownerKey = `${ownerName}|${ownerPhone}`
    if (!idNoMap.has(ownerIdNo)) {
      idNoMap.set(ownerIdNo, { ownerKeys: new Set(), rows: [] })
    }
    const info = idNoMap.get(ownerIdNo)!
    info.ownerKeys.add(ownerKey)
    info.rows.push(r)
  }

  const results: ValidationResult[] = []
  idNoMap.forEach((info, idNo) => {
    // 只有当同一个证件号码对应多个不同业主时才报错
    if (info.ownerKeys.size <= 1) return

    // 所有使用该证件号码的行都报错
    info.rows.forEach((row) => {
      results.push({
        isValid: false,
        ruleId: '业主证件号码_一致性',
        severity: 'HIGH',
        message: `业主证件号码"${idNo}"被不同业主使用，不同业主的证件号码不能相同`,
        row,
        col: 20,
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
  results.push(...validatePropertyNameUniqueness())
  results.push(...validateCustomerConsistency())
  results.push(...validateDateOrder())
  results.push(...validateOwnerIdNoConsistency())
  return results
}

/**
 * 单列跨行校验（用于ON_BLUR时只校验相关列）
 */
export function validateCrossRowByCol(col: number): ValidationResult[] {
  const results: ValidationResult[] = []
  // 房产简称列 → 唯一性校验
  if (col === 6) {
    results.push(...validatePropertyNameUniqueness())
  }
  // 租户证件号码列 → 一致性校验
  if (col === 30) {
    results.push(...validateCustomerConsistency())
  }
  // 收房日期/售楼日期 → 日期顺序校验
  if (col === 12 || col === 13) {
    results.push(...validateDateOrder())
  }
  // 业主证件号码 → 跨行一致性
  if (col === 19 || col === 20) {
    results.push(...validateOwnerIdNoConsistency())
  }
  return results
}
