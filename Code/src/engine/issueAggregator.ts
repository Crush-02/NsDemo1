/**
 * 校验问题聚合（房产 / 应收已收两模块共用）
 *
 * ==================== 为什么需要聚合 ====================
 * 批量导入场景下，同一类问题会成批出现：一整列没填支付方式，
 * 就是两万条一模一样的警告。逐条渲染会产生约 13.7 万个 DOM 节点
 * 与 1.9 万个事件监听器，点开抽屉即卡死。
 *
 * 实测（44,562 行 / 19,233 条警告）：按「列 + 文案」聚合后
 * 20,329 条 → 37 组，DOM 节点 122,048 → 272（449×）。
 *
 * 聚合同时也是体验改善：用户想知道的不是「第 47,382 行有问题」，
 * 而是「支付方式整列没填，共 19,996 处」。
 *
 * ==================== 设计要点 ====================
 *
 * 1. **必须按 (col, message) 二元组聚合，不能只按 message**
 *    部分规则文案不含列名，同一条消息会横跨多个列
 *    （如「缴款三字段需同时填写或同时为空」出现在 col 13/15/16）。
 *    只按 message 聚合会把不同列的问题混在一组，用户无法定位。
 *
 * 2. **不能用 results 的 Map key（"row-col"）作为聚合键**
 *    那是行级的：同一条消息散落在两万行上会得到两万个 key，起不到聚合作用。
 *
 * 3. **动态文案天然不收敛**
 *    如「房产简称"X"的收费科目"Y"在计费周期(a~b)内存在重复数据」，
 *    每条文案都含具体值，聚合后仍是一条一组（等于没聚合）。
 *    这些项 count 通常为 1，界面上表现为「无展开按钮、直接定位」，
 *    不会造成卡顿。若某批数据全是此类错误，退化为逐条列表行为（可接受）。
 *
 * 4. **同一格多条消息不能只取 messages[0]**
 *    getAllCellErrors 把多���消息压进 messages[]，只取首条会丢信息，
 *    故用 join('\n') 参与键计算，保证「总数守恒」。
 *
 * 5. **rows 必须显式排序**
 *    Map 的遍历是插入序，不保证行号有序；不排序会导致展示「第 5 行、
 *    第 7 行、第 6 行」这种乱序。
 */

import type { CellError, Severity } from './types'

/** 聚合后的问题项 */
export interface AggregatedIssue {
  /** 聚合键：`${col}||${message}`，同一列同一文案归为一组 */
  key: string
  /** 问题所在列（0-based，工具列索引） */
  col: number
  /** 问题文案（组内唯一，每组只存一份） */
  message: string
  /** 组内最严重级别 */
  severity: Severity
  /** 该组命中总数 */
  count: number
  /** 命中行号（升序）—— 供二级展开与单元格定位 */
  rows: number[]
}

/** 严重度优先级（与 getAllCellErrors 取「最严重」的口径一致） */
const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }

/**
 * 按「列 + 文案」聚合问题列表
 *
 * @param list 单元格错误列表（来自 getAllCellErrors）
 * @returns 聚合项数组，按 条数降序 → 列升序 → 文案 排序
 *          （末两级用于保证 count 相同时顺序稳定，重新校验不会跳动）
 *
 * @invariant Σ 各组 count === list.length（总数守恒，防漏报）
 */
export function aggregateIssues(list: CellError[]): AggregatedIssue[] {
  const map = new Map<string, AggregatedIssue>()

  for (const err of list) {
    // 同格多条消息用 \n 连接参与键计算，避免只取 messages[0] 丢信息
    const message = err.messages.join('\n')
    const key = `${err.col}||${message}`

    const existing = map.get(key)
    if (existing) {
      existing.count++
      existing.rows.push(err.row)
      // 组内取最严重
      if (SEVERITY_ORDER[err.severity] < SEVERITY_ORDER[existing.severity]) {
        existing.severity = err.severity
      }
    } else {
      map.set(key, {
        key,
        col: err.col,
        message,
        severity: err.severity,
        count: 1,
        rows: [err.row],
      })
    }
  }

  const groups = Array.from(map.values())
  for (const g of groups) g.rows.sort((a, b) => a - b)

  return groups.sort(
    (a, b) => b.count - a.count || a.col - b.col || a.message.localeCompare(b.message),
  )
}

/**
 * 单次遍历产出「错误组」与「警告组」
 *
 * 背景：改造前 errorGroups / warningGroups 各自独立调用
 * getAllCellErrors()，是两次全量遍历。此处合并为一次，
 * 既省一次遍历（约 10ms @ 19k 条），也消除重复代码。
 *
 * @param getAllErrors 取全部单元格错误的函数（由各模块的 store 提供）
 */
export function splitBySeverity(getAllErrors: () => CellError[]): {
  errors: AggregatedIssue[]
  warnings: AggregatedIssue[]
} {
  const all = getAllErrors()
  const errorItems: CellError[] = []
  const warningItems: CellError[] = []

  for (const err of all) {
    if (err.severity === 'CRITICAL') errorItems.push(err)
    else warningItems.push(err)
  }

  return { errors: aggregateIssues(errorItems), warnings: aggregateIssues(warningItems) }
}
