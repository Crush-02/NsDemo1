/** 校验严重度 */
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM'

/** 校验结果 */
export interface ValidationResult {
  isValid: boolean
  ruleId: string
  severity: Severity
  message: string
  row: number
  col: number
}

/** 校验规则定义 */
export interface ValidationRule {
  ruleId: string
  description: string
  severity: Severity
  /** 该规则涉及的列 */
  columns: number[]
  /** 是否为条件触发规则（Step3实现） */
  hasTriggers: boolean
}

/** 单元格错误信息（用于tooltip和样式） */
export interface CellError {
  row: number
  col: number
  severity: Severity
  messages: string[]
}

/** 术语替换映射 */
export const TERM_REPLACEMENTS: Record<string, string> = {
  '住户客户类型': '租户客户类型',
  '住户联系人': '租户企业联系人',
  '住户': '租户',
}

/** 对消息文本进行术语替换 */
export function sanitizeMessage(msg: string): string {
  let result = msg
  for (const [from, to] of Object.entries(TERM_REPLACEMENTS)) {
    result = result.replaceAll(from, to)
  }
  return result
}

// ==================== 跨行校验规则ID常量 ====================

/** 房产信息模块 - 跨行校验规则ID */
export const PROPERTY_CROSS_ROW_RULE_IDS = [
  '房产简称_唯一性',
  '客户信息一致性',
  '日期顺序',
  '业主证件号码_一致性',
] as const

/** 应收已收模块 - 跨行校验规则ID */
export const FINANCE_CROSS_ROW_RULE_IDS = [
  '项目名称一致性',
  '计费日期逻辑',
  '数据重复校验',
] as const
