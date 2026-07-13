/**
 * 应收已收 - 依赖追踪器
 * 当源字段变化时，自动重新校验受影响的目标字段
 */
import { getCellText } from './simpleValidator'

/** 依赖关系定义 */
interface DependencyRule {
  sourceCols: number[]
  targetCols: number[]
  description: string
}

/** 所有条件依赖关系（用于“待填写”状态判断） */
const DEPENDENCY_RULES: DependencyRule[] = [
  // 减免金额 → 减免分类
  {
    sourceCols: [9],
    targetCols: [10],
    description: '减免金额已填写，减免分类变为必填',
  },
  // 减免分类 → 减免金额
  {
    sourceCols: [10],
    targetCols: [9],
    description: '减免分类已填写，减免金额变为必填',
  },
]

/**
 * 联动规则（用于触发重校验，不产生“待填写”状态）
 * 缴款三字段联动是“一致性校验”而非“条件必填”，
 * 三个字段全空时不应触发待填写提示。
 */
const LINKAGE_RULES: DependencyRule[] = [
  { sourceCols: [13, 14], targetCols: [15], description: '' },
  { sourceCols: [13, 15], targetCols: [14], description: '' },
  { sourceCols: [14, 15], targetCols: [13], description: '' },
  // 应收金额变化时触发缴款金额上限重校验（但不产生“待填写”状态）
  { sourceCols: [8], targetCols: [13], description: '' },
]

/** 源列 → 全部规则的反向索引（依赖 + 联动，用于触发重校验） */
const sourceToRules = new Map<number, DependencyRule[]>()

;[...DEPENDENCY_RULES, ...LINKAGE_RULES].forEach((rule) => {
  rule.sourceCols.forEach((col) => {
    const existing = sourceToRules.get(col) || []
    existing.push(rule)
    sourceToRules.set(col, existing)
  })
})

/** 获取受影响的目标列 */
export function getAffectedTargetCols(changedCol: number): number[] {
  const rules = sourceToRules.get(changedCol)
  if (!rules) return []
  const targets = new Set<number>()
  rules.forEach((rule) => {
    rule.targetCols.forEach((col) => targets.add(col))
  })
  return Array.from(targets)
}

/** 获取依赖描述 */
export function getDependencyDescriptions(targetCol: number): string[] {
  const descriptions: string[] = []
  DEPENDENCY_RULES.forEach((rule) => {
    if (rule.targetCols.includes(targetCol)) {
      descriptions.push(rule.description)
    }
  })
  return descriptions
}

/** 判断目标列是否处于"待填写"状态 */
export function isPendingRequired(row: number, targetCol: number): boolean {
  for (const rule of DEPENDENCY_RULES) {
    if (!rule.targetCols.includes(targetCol)) continue
    const sourceSatisfied = rule.sourceCols.some((col) => {
      return getCellText(row, col) !== ''
    })
    if (sourceSatisfied) return true
  }
  return false
}

/** 获取某行所有处于"待填写"状态的列 */
export function getPendingCols(row: number): number[] {
  const pending: number[] = []
  const allTargets = new Set<number>()
  DEPENDENCY_RULES.forEach((rule) => {
    rule.targetCols.forEach((col) => allTargets.add(col))
  })
  allTargets.forEach((col) => {
    if (isPendingRequired(row, col)) {
      pending.push(col)
    }
  })
  return pending
}
