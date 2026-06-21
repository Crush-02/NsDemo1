import { reactive } from 'vue'
import type { ValidationResult, CellError, Severity } from './types'
import { sanitizeMessage } from './types'
import { validateCell, validateRow, validateAll, getFilledRowCount, getTotalRowCount, clearCellCache, getCellText } from './simpleValidator'
import { validateConditionalRow, validateConditionalAll } from './conditionalValidator'
import { validateAllCrossRow, validateCrossRowByCol } from './crossRowValidator'
import { getAffectedTargetCols, isPendingRequired, getPendingCols } from './dependencyTracker'

/** 跨行校验规则ID集合（统一管理，避免硬编码散落多处） */
export const CROSS_ROW_RULE_IDS = new Set([
  '房产简称_唯一性',
  '客户信息一致性',
  '日期顺序',
  '同名客户一致性',
])

/** 校验结果状态 */
export const state = reactive({
  /** 所有校验结果，key为 "row-col" */
  results: new Map<string, ValidationResult[]>(),
  /** 错误总数(CRITICAL) */
  errorCount: 0,
  /** 警告总数(HIGH+MEDIUM) */
  warningCount: 0,
  /** 已填写行数 */
  filledRows: 0,
  /** 总行数 */
  totalRows: 0,
  /** 待填写单元格集合，key为 "row-col" */
  pendingCells: new Set<string>(),
})

/** 生成单元格key */
function cellKey(row: number, col: number): string {
  return `${row}-${col}`
}

// ==================== 统计更新（防抖） ====================
let _statsTimer: ReturnType<typeof setTimeout> | null = null
let _statsDirty = false

/** 更新统计（带防抖：高频调用时合并为一次，最多延迟100ms执行） */
function updateStats() {
  _statsDirty = true
  if (_statsTimer) return
  _statsTimer = setTimeout(() => {
    _statsTimer = null
    if (!_statsDirty) return
    _statsDirty = false
    _updateStatsNow()
  }, 30)
}

/** 立即执行统计更新（用于需要同步获取最新统计的场景） */
function flushStats(): void {
  if (_statsTimer) {
    clearTimeout(_statsTimer)
    _statsTimer = null
  }
  _statsDirty = false
  _updateStatsNow()
}

/** 统计更新的实际实现 */
function _updateStatsNow(): void {
  let errors = 0
  let warnings = 0
  state.results.forEach((results) => {
    results.forEach((r) => {
      if (r.severity === 'CRITICAL') errors++
      else warnings++
    })
  })
  state.errorCount = errors
  state.warningCount = warnings
  state.filledRows = getFilledRowCount()
  state.totalRows = getTotalRowCount()
}

/** 清除某个单元格的校验结果 */
export function clearCellResult(row: number, col: number) {
  state.results.delete(cellKey(row, col))
}

/** 设置某个单元格的校验结果 */
export function setCellResult(row: number, col: number, result: ValidationResult | null) {
  const key = cellKey(row, col)
  if (result) {
    result.message = sanitizeMessage(result.message)
    state.results.set(key, [result])
  } else {
    state.results.delete(key)
  }
  updateStats()
}

/** 追加某个单元格的校验结果（用于多规则命中同一单元格） */
export function appendCellResult(row: number, col: number, result: ValidationResult) {
  result.message = sanitizeMessage(result.message)
  const key = cellKey(row, col)
  const existing = state.results.get(key)
  if (existing) {
    existing.push(result)
  } else {
    state.results.set(key, [result])
  }
  updateStats()
}

/** 设置某行所有校验结果 */
export function setRowResults(row: number, results: ValidationResult[]) {
  for (let c = 0; c < 25; c++) {
    state.results.delete(cellKey(row, c))
  }
  results.forEach((r) => {
    r.message = sanitizeMessage(r.message)
    const key = cellKey(r.row, r.col)
    const existing = state.results.get(key)
    if (existing) {
      existing.push(r)
    } else {
      state.results.set(key, [r])
    }
  })
  updateStats()
}

/** 执行全量校验（简单+条件+跨行） */
export function runFullValidation(): { errors: ValidationResult[]; warnings: ValidationResult[] } {
  clearCellCache()
  state.results.clear()
  state.pendingCells.clear()

  // 1. 简单规则
  const { errors: simpleErrors, warnings: simpleWarnings } = validateAll()
  const allResults: ValidationResult[] = [...simpleErrors, ...simpleWarnings]

  // 2. 条件规则
  const conditionalResults = validateConditionalAll()
  allResults.push(...conditionalResults)

  // 3. 跨行校验
  const crossRowResults = validateAllCrossRow()
  allResults.push(...crossRowResults)

  // 写入所有结果
  allResults.forEach((r) => {
    r.message = sanitizeMessage(r.message)
    const key = cellKey(r.row, r.col)
    const existing = state.results.get(key)
    if (existing) {
      existing.push(r)
    } else {
      state.results.set(key, [r])
    }
  })

  // 更新待填写状态（使用缓存的 getCellText 避免重复 API 调用）
  const ls = (window as any).luckysheet
  if (ls) {
    const flowdata = ls.getFlowdata()
    if (flowdata) {
      for (let r = 1; r < flowdata.length; r++) {
        const pendingCols = getPendingCols(r)
        pendingCols.forEach((col) => {
          // 使用 getCellText（已缓存）代替直接调用 ls.getCellValue
          const val = getCellText(r, col)
          const isEmpty = val === ''
          const hasError = state.results.has(cellKey(r, col))
          if (isEmpty && !hasError) {
            state.pendingCells.add(cellKey(r, col))
          }
        })
      }
    }
  }

  flushStats()
  const errors = allResults.filter((r) => r.severity === 'CRITICAL')
  const warnings = allResults.filter((r) => r.severity !== 'CRITICAL')
  return { errors, warnings }
}

/** ON_INPUT: 即时校验单个单元格（只校验格式） */
export function onCellInput(row: number, col: number) {
  clearCellCache()
  clearCellResult(row, col)
  const result = validateCell(row, col)
  setCellResult(row, col, result)
  applyCellStyle(row, col, result)
}

/** ON_BLUR: 失焦时校验（简单+条件+依赖目标+跨行） */
export function onCellBlur(row: number, col: number) {
  clearCellCache()
  // 1. 对当前行执行完整简单校验
  const rowSimpleResults = validateRow(row)

  // 2. 对当前行执行完整条件校验
  const rowCondResults = validateConditionalRow(row)

  // 3. 合并简单+条件结果
  const rowAllResults = [...rowSimpleResults, ...rowCondResults]

  // 4. 清除当前行所有旧的简单和条件校验结果，保留跨行结果
  for (let c = 0; c < 25; c++) {
    const key = cellKey(row, c)
    const existing = state.results.get(key)
    if (existing) {
      // 只保留跨行规则的结果
      const crossRowOnly = existing.filter((r) => CROSS_ROW_RULE_IDS.has(r.ruleId))
      if (crossRowOnly.length > 0) {
        state.results.set(key, crossRowOnly)
      } else {
        state.results.delete(key)
      }
    }
  }

  // 5. 写入新的简单+条件结果
  rowAllResults.forEach((r) => {
    r.message = sanitizeMessage(r.message)
    const key = cellKey(r.row, r.col)
    const existing = state.results.get(key)
    if (existing) {
      existing.push(r)
    } else {
      state.results.set(key, [r])
    }
  })

  // 6. 更新当前行所有有变化的列的样式和待填写状态
  const colsToUpdate = new Set<number>()
  rowAllResults.forEach((r) => colsToUpdate.add(r.col))
  // 也检查依赖目标列
  getAffectedTargetCols(col).forEach((c) => colsToUpdate.add(c))
  // 也检查当前列
  colsToUpdate.add(col)

  colsToUpdate.forEach((c) => {
    const worst = getWorstResult(row, c)
    applyCellStyle(row, c, worst)
    updatePendingState(row, c)
  })

  // 7. 跨行校验（仅相关列）
  const crossRowResults = validateCrossRowByCol(col)
  clearCrossRowResultsForCol(col)
  crossRowResults.forEach((r) => {
    appendCellResult(r.row, r.col, r)
    applyCellStyle(r.row, r.col, getWorstResult(r.row, r.col))
  })

  updateStats()
}

/** 获取某单元格最严重的结果 */
function getWorstResult(row: number, col: number): ValidationResult | null {
  const results = state.results.get(cellKey(row, col))
  if (!results || results.length === 0) return null
  const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  return results.reduce((a, b) => order[a.severity] <= order[b.severity] ? a : b)
}

/** 清除某列所有行的跨行校验结果（优化：使用常量Set + 减少遍历） */
function clearCrossRowResultsForCol(col: number) {
  const keysToDelete: string[] = []
  // 只处理目标列的key，通过前缀匹配减少遍历范围
  const prefix = `-${col}`
  state.results.forEach((results, key) => {
    if (!key.endsWith(prefix)) return
    // 只删除跨行规则的结果
    const filtered = results.filter((r) => !CROSS_ROW_RULE_IDS.has(r.ruleId))
    if (filtered.length === 0) {
      keysToDelete.push(key)
    } else {
      state.results.set(key, filtered)
    }
  })
  keysToDelete.forEach((key) => state.results.delete(key))
}

/** 更新待填写状态 */
function updatePendingState(row: number, col: number) {
  const key = cellKey(row, col)
  const ls = (window as any).luckysheet
  if (!ls) return

  const val = ls.getCellValue(row, col)
  const isEmpty = val === null || val === undefined || String(val).trim() === ''
  const hasError = state.results.has(key)

  if (isEmpty && !hasError && isPendingRequired(row, col)) {
    state.pendingCells.add(key)
    applyPendingStyle(row, col)
  } else {
    state.pendingCells.delete(key)
  }
}

/** 获取某个单元格的错误信息 */
export function getCellErrors(row: number, col: number): CellError | null {
  const key = cellKey(row, col)
  const results = state.results.get(key)
  if (!results || results.length === 0) return null

  const worst = results.reduce((a, b) => {
    const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
    return order[a.severity] <= order[b.severity] ? a : b
  })

  return {
    row,
    col,
    severity: worst.severity,
    messages: results.map((r) => r.message),
  }
}

/** 获取所有有错误的单元格 */
export function getAllCellErrors(): CellError[] {
  const errors: CellError[] = []
  state.results.forEach((results, key) => {
    if (results.length === 0) return
    const [rowStr, colStr] = key.split('-')
    const row = Number(rowStr)
    const col = Number(colStr)
    const worst = results.reduce((a, b) => {
      const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return order[a.severity] <= order[b.severity] ? a : b
    })
    errors.push({
      row,
      col,
      severity: worst.severity,
      messages: results.map((r) => r.message),
    })
  })
  return errors
}

/** 应用单元格样式 */
export function applyCellStyle(row: number, col: number, result: ValidationResult | null) {
  const ls = (window as any).luckysheet
  if (!ls) return

  if (!result) {
    // 检查是否为待填写状态
    const key = cellKey(row, col)
    if (state.pendingCells.has(key)) {
      applyPendingStyle(row, col)
      return
    }
    // 清除样式：恢复正常边框
    ls.setCellStyle(row, col, {
      bd: { borderType: 'border-all', style: '1', color: '#d4d4d4' },
      bg: '#ffffff',
    })
    // 如果之前为设置样式而填入的空格，清除它
    const cellVal = ls.getCellValue(row, col)
    if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() === '') {
      ls.setCellValue(row, col, '')
    }
  } else {
    const cellVal = ls.getCellValue(row, col)
    if (cellVal === null || cellVal === undefined || cellVal === '' || String(cellVal).trim() === '') {
      ls.setCellValue(row, col, ' ')
    }

    if (result.severity === 'CRITICAL') {
      ls.setCellStyle(row, col, {
        bd: { borderType: 'border-all', style: '2', color: '#F56C6C' },
        bg: '#FEF0F0',
      })
    } else if (result.severity === 'HIGH') {
      ls.setCellStyle(row, col, {
        bd: { borderType: 'border-all', style: '2', color: '#E6A23C' },
      })
    } else if (result.severity === 'MEDIUM') {
      ls.setCellStyle(row, col, {
        bd: { borderType: 'border-all', style: '2', color: '#E6A23C' },
      })
    }
  }
}

/** 应用待填写样式（黄色虚线边框） */
function applyPendingStyle(row: number, col: number) {
  const ls = (window as any).luckysheet
  if (!ls) return

  const cellVal = ls.getCellValue(row, col)
  if (cellVal === null || cellVal === undefined || cellVal === '' || String(cellVal).trim() === '') {
    ls.setCellValue(row, col, ' ')
  }
  ls.setCellStyle(row, col, {
    bd: { borderType: 'border-all', style: '3', color: '#E6A23C' },
    bg: '#FDF6EC',
  })
}

/** 应用全量校验样式（分片处理，每帧处理一批DOM操作，避免UI卡死） */
export function applyAllValidationStyles() {
  const ls = (window as any).luckysheet
  if (!ls) return

  // 收集所有需要应用样式的单元格（纯数据收集，无DOM操作）
  const errorEntries: { row: number; col: number; result: ValidationResult | null }[] = []
  state.results.forEach((results, key) => {
    if (results.length === 0) return
    const [rowStr, colStr] = key.split('-')
    const row = Number(rowStr)
    const col = Number(colStr)
    const worst = results.reduce((a, b) => {
      const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return order[a.severity] <= order[b.severity] ? a : b
    })
    errorEntries.push({ row, col, result: worst })
  })

  const pendingEntries: { row: number; col: number }[] = []
  state.pendingCells.forEach((key) => {
    if (state.results.has(key)) return
    const [rowStr, colStr] = key.split('-')
    pendingEntries.push({ row: Number(rowStr), col: Number(colStr) })
  })

  // 分片执行DOM操作，每帧最多处理50个单元格
  const CHUNK_SIZE = 50
  let errorIdx = 0
  let pendingIdx = 0

  function processChunk() {
    const ls2 = (window as any).luckysheet
    if (!ls2) return

    // 处理错误样式（优先）
    let count = 0
    while (errorIdx < errorEntries.length && count < CHUNK_SIZE) {
      const { row, col, result } = errorEntries[errorIdx++]
      applyCellStyle(row, col, result)
      count++
    }

    // 如果错误样式处理完还有余量，处理待填写样式
    while (pendingIdx < pendingEntries.length && count < CHUNK_SIZE) {
      const { row, col } = pendingEntries[pendingIdx++]
      applyPendingStyle(row, col)
      count++
    }

    // 还有剩余则下一帧继续
    if (errorIdx < errorEntries.length || pendingIdx < pendingEntries.length) {
      requestAnimationFrame(processChunk)
    }
  }

  requestAnimationFrame(processChunk)
}

/** 导出使用 */
export function useValidationStore() {
  return {
    state,
    onCellInput,
    onCellBlur,
    runFullValidation,
    getCellErrors,
    getAllCellErrors,
    applyAllValidationStyles,
    setRowResults,
  }
}
