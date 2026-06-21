/**
 * 跨行校验器
 * 实现跨行唯一性、一致性、日期顺序校验
 */
import type { ValidationResult } from './types'
import { getCellText, isRowNotEmpty } from './simpleValidator'

const luckysheet = () => (window as any).luckysheet

/**
 * 规则1补充: 房产简称唯一性
 * 遍历所有行的房产简称，重复值标记错误
 */
export function validatePropertyNameUniqueness(): ValidationResult[] {
  const ls = luckysheet()
  if (!ls) return []
  const flowdata = ls.getFlowdata()
  if (!flowdata) return []

  // 统计每个房产简称出现的行
  const nameToRows = new Map<string, number[]>()
  for (let r = 1; r < flowdata.length; r++) {
    const val = getCellText(r, 0)
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
        col: 0,
      })
    })
  })

  return results
}

/**
 * 规则3: 客户信息一致性
 * 同一证件号码对应不同的客户名称 → 报错
 * 检查业主(col=10, col=8)和租户(col=15, col=13)
 */
export function validateCustomerConsistency(): ValidationResult[] {
  const ls = luckysheet()
  if (!ls) return []
  const flowdata = ls.getFlowdata()
  if (!flowdata) return []

  // 证件号码 → 名称 的映射
  const idToNames = new Map<string, Map<string, { row: number; col: number }[]>>()

  for (let r = 1; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue

    // 业主证件号码(col=10) → 业主名称(col=8)
    const ownerId = getCellText(r, 10)
    if (ownerId !== '') {
      const ownerName = getCellText(r, 8)
      if (!idToNames.has(ownerId)) {
        idToNames.set(ownerId, new Map())
      }
      const nameMap = idToNames.get(ownerId)!
      if (!nameMap.has(ownerName)) {
        nameMap.set(ownerName, [])
      }
      nameMap.get(ownerName)!.push({ row: r, col: 10 })
    }

    // 租户证件号码(col=15) → 租户名称(col=13)
    const tenantId = getCellText(r, 15)
    if (tenantId !== '') {
      const tenantName = getCellText(r, 13)
      if (!idToNames.has(tenantId)) {
        idToNames.set(tenantId, new Map())
      }
      const nameMap = idToNames.get(tenantId)!
      if (!nameMap.has(tenantName)) {
        nameMap.set(tenantName, [])
      }
      nameMap.get(tenantName)!.push({ row: r, col: 15 })
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
 * 收房日期(col=6)不能小于售楼日期(col=5)
 */
export function validateDateOrder(): ValidationResult[] {
  const ls = luckysheet()
  if (!ls) return []
  const flowdata = ls.getFlowdata()
  if (!flowdata) return []

  const results: ValidationResult[] = []
  const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

  for (let r = 1; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue
    const saleDate = getCellText(r, 5)
    const receiveDate = getCellText(r, 6)

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
        col: 6,
      })
    }
  }

  return results
}

/**
 * 规则18: 同名客户联系信息一致性
 * 同名客户的联系电话和证件号码必须一致
 */
export function validateSameNameConsistency(): ValidationResult[] {
  const ls = luckysheet()
  if (!ls) return []
  const flowdata = ls.getFlowdata()
  if (!flowdata) return []

  // 按名称分组，记录电话和证件号码
  interface CustomerInfo {
    phone: string
    idNo: string
    rows: { row: number; phoneCol: number; idCol: number }[]
  }

  const ownerMap = new Map<string, CustomerInfo>()
  const tenantMap = new Map<string, CustomerInfo>()

  for (let r = 1; r < flowdata.length; r++) {
    if (!isRowNotEmpty(r)) continue

    // 业主
    const ownerName = getCellText(r, 8)
    if (ownerName !== '') {
      const ownerPhone = getCellText(r, 9)
      const ownerId = getCellText(r, 10)
      if (!ownerMap.has(ownerName)) {
        ownerMap.set(ownerName, { phone: '', idNo: '', rows: [] })
      }
      const info = ownerMap.get(ownerName)!
      if (info.phone === '' && ownerPhone !== '') info.phone = ownerPhone
      if (info.idNo === '' && ownerId !== '') info.idNo = ownerId
      info.rows.push({ row: r, phoneCol: 9, idCol: 10 })
    }

    // 租户
    const tenantName = getCellText(r, 13)
    if (tenantName !== '') {
      const tenantPhone = getCellText(r, 14)
      const tenantId = getCellText(r, 15)
      if (!tenantMap.has(tenantName)) {
        tenantMap.set(tenantName, { phone: '', idNo: '', rows: [] })
      }
      const info = tenantMap.get(tenantName)!
      if (info.phone === '' && tenantPhone !== '') info.phone = tenantPhone
      if (info.idNo === '' && tenantId !== '') info.idNo = tenantId
      info.rows.push({ row: r, phoneCol: 14, idCol: 15 })
    }
  }

  const results: ValidationResult[] = []

  const checkConsistency = (map: Map<string, CustomerInfo>) => {
    map.forEach((info, name) => {
      if (info.rows.length <= 1) return
      // 检查每行的电话和证件号码是否与第一行一致
      info.rows.forEach(({ row, phoneCol, idCol }) => {
        const phone = getCellText(row, phoneCol)
        const idNo = getCellText(row, idCol)
        const phoneMismatch = info.phone !== '' && phone !== '' && phone !== info.phone
        const idMismatch = info.idNo !== '' && idNo !== '' && idNo !== info.idNo
        if (phoneMismatch || idMismatch) {
          results.push({
            isValid: false,
            ruleId: '同名客户一致性',
            severity: 'HIGH',
            message: '同名客户的联系方式和证件号码必须一致',
            row,
            col: phoneMismatch ? phoneCol : idCol,
          })
        }
      })
    })
  }

  checkConsistency(ownerMap)
  checkConsistency(tenantMap)

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
  results.push(...validateSameNameConsistency())
  return results
}

/**
 * 单列跨行校验（用于ON_BLUR时只校验相关列）
 */
export function validateCrossRowByCol(col: number): ValidationResult[] {
  const results: ValidationResult[] = []
  // 房产简称列 → 唯一性校验
  if (col === 0) {
    results.push(...validatePropertyNameUniqueness())
  }
  // 证件号码列 → 一致性校验
  if (col === 10 || col === 15) {
    results.push(...validateCustomerConsistency())
  }
  // 收房日期/售楼日期 → 日期顺序校验
  if (col === 5 || col === 6) {
    results.push(...validateDateOrder())
  }
  // 电话/证件号码 → 同名一致性
  if (col === 9 || col === 10 || col === 14 || col === 15) {
    results.push(...validateSameNameConsistency())
  }
  return results
}
