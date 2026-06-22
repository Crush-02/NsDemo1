/**
 * 依赖追踪器
 * 当源字段变化时，自动重新校验受影响的目标字段
 */
import { getCellText } from './simpleValidator'

/** 依赖关系定义 */
interface DependencyRule {
  /** 触发源列 */
  sourceCols: number[]
  /** 受影响的目标列 */
  targetCols: number[]
  /** 条件描述（用于tooltip提示） */
  description: string
}

/** 所有条件依赖关系 */
const DEPENDENCY_RULES: DependencyRule[] = [
  // 有业主信息 → 售楼日期、业主客户类型必填
  {
    sourceCols: [16, 17, 18], // 业主客户名称、业主类型、业主联系电话
    targetCols: [12, 15],     // 售楼日期、业主客户类型
    description: '因业主信息已填写，此项变为必填',
  },
  // 收房日期有值 → 售楼日期必填
  {
    sourceCols: [13],       // 收房日期
    targetCols: [12],       // 售楼日期
    description: '收房日期已填写，售楼日期必填',
  },
  // 入住日期有值 → 售楼日期必填
  {
    sourceCols: [14],       // 入住日期
    targetCols: [12],       // 售楼日期
    description: '入住日期已填写，售楼日期必填',
  },
  // 有租户信息 → 租户证件类型、出租开始日期相关
  {
    sourceCols: [26, 27, 30, 23], // 租户客户名称、租户联系电话、租户证件号码、出租开始日期
    targetCols: [29, 23],         // 租户证件类型、出租开始日期
    description: '因租户信息已填写，此项变为必填',
  },
  // 租户证件类型有值 → 租户证件号码必填
  {
    sourceCols: [29],       // 租户证件类型
    targetCols: [30],       // 租户证件号码
    description: '租户证件类型已填写，证件号码必填',
  },
  // 业主客户类型=企业 → 企业联系人必填
  {
    sourceCols: [15],       // 业主客户类型
    targetCols: [21],       // 企业联系人
    description: '业主客户类型为企业时，企业联系人必填',
  },
  // 租户客户类型=企业 → 租户企业联系人必填
  {
    sourceCols: [25],       // 租户客户类型
    targetCols: [28],       // 租户企业联系人
    description: '租户客户类型为企业时，租户企业联系人必填',
  },
  // 业主证件号码有值 → 业主证件类型必填
  {
    sourceCols: [20],       // 业主证件号码
    targetCols: [19],       // 业主证件类型
    description: '业主证件号码已填写，业主证件类型必填',
  },
  // 业主证件类型有值 → 业主证件号码必填
  {
    sourceCols: [19],       // 业主证件类型
    targetCols: [20],       // 业主证件号码
    description: '业主证件类型已填写，业主证件号码必填',
  },
  // 业主客户类型有值 → 业主类型必填
  {
    sourceCols: [15],       // 业主客户类型
    targetCols: [17],       // 业主类型
    description: '业主客户类型已填写，业主类型必填',
  },
]

/** 源列 → 依赖规则的反向索引 */
const sourceToRules = new Map<number, DependencyRule[]>()

// 构建反向索引
DEPENDENCY_RULES.forEach((rule) => {
  rule.sourceCols.forEach((col) => {
    const existing = sourceToRules.get(col) || []
    existing.push(rule)
    sourceToRules.set(col, existing)
  })
})

/**
 * 当某个源列变化时，获取所有受影响的目标列
 * 返回去重后的目标列列表
 */
export function getAffectedTargetCols(changedCol: number): number[] {
  const rules = sourceToRules.get(changedCol)
  if (!rules) return []

  const targets = new Set<number>()
  rules.forEach((rule) => {
    rule.targetCols.forEach((col) => targets.add(col))
  })
  return Array.from(targets)
}

/**
 * 获取某个目标列的所有依赖描述
 * 用于tooltip提示"待填写"状态的原因
 */
export function getDependencyDescriptions(targetCol: number): string[] {
  const descriptions: string[] = []
  DEPENDENCY_RULES.forEach((rule) => {
    if (rule.targetCols.includes(targetCol)) {
      descriptions.push(rule.description)
    }
  })
  return descriptions
}

/**
 * 判断某个目标列是否处于"待填写"状态
 * 即：其依赖条件是否被触发
 */
export function isPendingRequired(row: number, targetCol: number): boolean {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return false

  for (const rule of DEPENDENCY_RULES) {
    if (!rule.targetCols.includes(targetCol)) continue

    // 检查此规则的源字段是否满足条件
    const sourceSatisfied = rule.sourceCols.some((col) => {
      const val = getCellText(row, col)
      if (val === '') return false
      // 特殊处理：客户类型=企业的条件
      if (col === 15 && val !== '企业') return false
      if (col === 25 && val !== '企业') return false
      return true
    })

    if (sourceSatisfied) return true
  }

  return false
}

/**
 * 获取某行所有处于"待填写"状态的列
 */
export function getPendingCols(row: number): number[] {
  const pending: number[] = []
  // 检查所有可能的目标列
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

/**
 * 当源字段变化时，返回需要重新校验的所有列（源列+目标列）
 */
export function getRevalidationCols(changedCol: number): number[] {
  const cols = new Set<number>([changedCol])
  getAffectedTargetCols(changedCol).forEach((col) => cols.add(col))
  return Array.from(cols)
}
