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
  '住户联系人': '租户联系人',
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
