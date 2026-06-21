/**
 * 应收已收 - 校验状态管理中枢
 * 复用与 property 模块相同的状态管理模式，独立的校验器引用
 */
import { reactive } from 'vue'
import type { ValidationResult, CellError, Severity } from '../types'
import { sanitizeMessage, FINANCE_CROSS_ROW_RULE_IDS } from '../types'
import {
  validateCell, validateRow, validateAll,
  getFilledRowCount, getTotalRowCount,
} from './simpleValidator'
import { validateConditionalRow, validateConditionalAll } from './conditionalValidator'
import { validateAllCrossRow, validateCrossRowByCol } from './crossRowValidator'
import { getAffectedTargetCols, isPendingRequired, getPendingCols } from './dependencyTracker'
import { FINANCE_COL_COUNT, FINANCE_HEADER_ROW_COUNT } from './types'
import { ValidationScheduler, createSchedulerProgress } from '../validationScheduler'

// ==================== 状态 ====================

/** 应收已收模块独立的校验进度状态 */
export const financeSchedulerProgress = createSchedulerProgress()

export const financeState = reactive({
  results: new Map<string, ValidationResult[]>(),
  errorCount: 0,
  warningCount: 0,
  filledRows: 0,
  totalRows: 0,
  pendingCells: new Set<string>(),
  /** 校验进度 */
  validationProgress: financeSchedulerProgress,
})

function cellKey(row: number, col: number): string {
  return `${row}-${col}`
}

// ==================== 统计缓存 ====================

let statsDirty = false
let statsRafId: number | null = null

function markStatsDirty() {
  if (!statsDirty) {
    statsDirty = true
    statsRafId = requestAnimationFrame(() => {
      updateStatsNow()
      statsDirty = false
      statsRafId = null
    })
  }
}

function updateStatsNow() {
  let errors = 0, warnings = 0
  financeState.results.forEach((results) => {
    for (const r of results) {
      if (r.severity === 'CRITICAL') errors++
      else warnings++
    }
  })
  financeState.errorCount = errors
  financeState.warningCount = warnings
  financeState.filledRows = getFilledRowCount()
  financeState.totalRows = getTotalRowCount()
}

// ==================== 基础操作 ====================

function clearCellResult(row: number, col: number) {
  financeState.results.delete(cellKey(row, col))
}

function setCellResult(row: number, col: number, result: ValidationResult | null) {
  const key = cellKey(row, col)
  if (result) {
    result.message = sanitizeMessage(result.message)
    financeState.results.set(key, [result])
  } else {
    financeState.results.delete(key)
  }
  markStatsDirty()
}

function appendCellResult(row: number, col: number, result: ValidationResult) {
  result.message = sanitizeMessage(result.message)
  const key = cellKey(row, col)
  const existing = financeState.results.get(key)
  if (existing) existing.push(result)
  else financeState.results.set(key, [result])
  markStatsDirty()
}

// ==================== 样式批处理 ====================

let styleBatch: Array<{ row: number; col: number; attr: string; value: any }> = []
let styleBatchTimer: number | null = null

function batchSetCellFormat(row: number, col: number, attr: string, value: any) {
  styleBatch.push({ row, col, attr, value })
  if (!styleBatchTimer) {
    styleBatchTimer = window.setTimeout(flushStyleBatch, 0)
  }
}

function flushStyleBatch() {
  styleBatchTimer = null
  if (!styleBatch.length) return
  const ls = (window as any).luckysheet
  if (!ls) { styleBatch = []; return }

  const cellStyles = new Map<string, Map<string, any>>()
  for (const item of styleBatch) {
    const key = `${item.row}-${item.col}`
    let m = cellStyles.get(key)
    if (!m) { m = new Map(); cellStyles.set(key, m) }
    m.set(item.attr, item.value)
  }

  const entries = Array.from(cellStyles.entries())
  for (let i = 0; i < entries.length; i++) {
    const [key, attrs] = entries[i]
    const [rowStr, colStr] = key.split('-')
    const row = Number(rowStr), col = Number(colStr)
    const isLast = i === entries.length - 1
    for (const [attr, value] of attrs) {
      ls.setCellFormat(row, col, attr, value, { isRefresh: isLast })
    }
  }
  styleBatch = []
}

function flushStyleBatchSync() {
  if (styleBatchTimer) { clearTimeout(styleBatchTimer); styleBatchTimer = null }
  flushStyleBatch()
}

function cancelStyleBatch() {
  if (styleBatchTimer) { clearTimeout(styleBatchTimer); styleBatchTimer = null }
  styleBatch = []
}

// ==================== 样式应用函数 ====================

function applyCellStyle(row: number, col: number, result: ValidationResult | null, useSpaceHack = false) {
  if (!result) {
    const key = cellKey(row, col)
    if (financeState.pendingCells.has(key)) { applyPendingStyle(row, col, useSpaceHack); return }
    batchSetCellFormat(row, col, 'bd', { borderType: 'border-all', style: '1', color: '#d4d4d4' })
    batchSetCellFormat(row, col, 'bg', '#ffffff')
    if (useSpaceHack) {
      const ls = (window as any).luckysheet
      if (ls) {
        const v = ls.getCellValue(row, col)
        if (v !== null && v !== undefined && String(v).trim() === '') ls.setCellValue(row, col, '')
      }
    }
  } else {
    if (useSpaceHack) {
      const ls = (window as any).luckysheet
      if (ls) {
        const v = ls.getCellValue(row, col)
        if (v === null || v === undefined || v === '' || String(v).trim() === '') ls.setCellValue(row, col, ' ')
      }
    }
    if (result.severity === 'CRITICAL') {
      batchSetCellFormat(row, col, 'bd', { borderType: 'border-all', style: '2', color: '#F56C6C' })
      batchSetCellFormat(row, col, 'bg', '#FEF0F0')
    } else {
      batchSetCellFormat(row, col, 'bd', { borderType: 'border-all', style: '2', color: '#E6A23C' })
    }
  }
}

function applyPendingStyle(row: number, col: number, useSpaceHack = false) {
  const ls = (window as any).luckysheet
  if (!ls) return
  if (useSpaceHack) {
    const v = ls.getCellValue(row, col)
    if (v === null || v === undefined || v === '' || String(v).trim() === '') ls.setCellValue(row, col, ' ')
  }
  batchSetCellFormat(row, col, 'bd', { borderType: 'border-all', style: '3', color: '#E6A23C' })
  batchSetCellFormat(row, col, 'bg', '#FDF6EC')
}

/** 全量样式应用（导出前使用） */
export function applyAllValidationStyles() {
  const ls = (window as any).luckysheet
  if (!ls) return

  const styleMap = new Map<string, { bd: any; bg?: string }>()

  financeState.results.forEach((results, key) => {
    if (!results.length) return
    const worst = results.reduce((a, b) => {
      const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return o[a.severity] <= o[b.severity] ? a : b
    })
    styleMap.set(key, worst.severity === 'CRITICAL'
      ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
      : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } })
  })

  financeState.pendingCells.forEach((key) => {
    if (styleMap.has(key)) return
    styleMap.set(key, { bd: { borderType: 'border-all', style: '3', color: '#E6A23C' }, bg: '#FDF6EC' })
  })

  const entries = Array.from(styleMap.entries())
  for (let i = 0; i < entries.length; i++) {
    const [key, style] = entries[i]
    const [rs, cs] = key.split('-')
    const row = Number(rs), col = Number(cs)
    const isLast = i === entries.length - 1
    const v = ls.getCellValue(row, col)
    if (v === null || v === undefined || v === '' || String(v).trim() === '') {
      ls.setCellValue(row, col, ' ', { isRefresh: false })
    }
    ls.setCellFormat(row, col, 'bd', style.bd, { isRefresh: false })
    if (style.bg) ls.setCellFormat(row, col, 'bg', style.bg, { isRefresh: isLast })
    else if (isLast) ls.setCellFormat(row, col, 'bd', style.bd, { isRefresh: true })
  }
  if (!entries.length) ls.setCellValue(0, 0, ls.getCellValue(0, 0), { isRefresh: true })
}

// ==================== 防抖校验 ====================

let blurDebounceTimer: number | null = null
let pendingBlurs: { row: number; col: number }[] = []

export function onCellInput(row: number, col: number, batch = false) {
  clearCellResult(row, col)
  if (batch) {
    // 批量模式：跳过单格校验，只清除结果
    applyCellStyle(row, col, null, false)
  } else {
    const result = validateCell(row, col)
    setCellResult(row, col, result)
    applyCellStyle(row, col, result, false)
    updatePendingState(row, col)
    flushStyleBatchSync()
  }
}

/** 批量输入后的整行校验（由 cellMousedown 调用） */
export function onBatchInputComplete(changedRows: number[], changedCols: number[]) {
  for (const row of changedRows) {
    executeBlurValidation(row, -1)
  }
  // 直接修改flowdata批量应用样式
  applyStylesViaFlowdata()
  // 触发跨行校验
  for (const col of changedCols) {
    if (CROSS_ROW_COL_MAP[col]) {
      scheduleCrossRowValidation(col)
    }
  }
}

/** 通过直接修改flowdata批量应用样式 */
function applyStylesViaFlowdata() {
  const ls = (window as any).luckysheet
  if (!ls) return

  cancelStyleBatch()

  const flowdata = typeof ls.flowdata === 'function' ? ls.flowdata() : null
  if (!flowdata) {
    flushStyleBatchSync()
    return
  }

  const styleMap = new Map<string, { bd: any; bg?: string }>()
  financeState.results.forEach((results, key) => {
    if (!results.length) return
    const worst = results.reduce((a, b) => {
      const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return o[a.severity] <= o[b.severity] ? a : b
    })
    styleMap.set(key, worst.severity === 'CRITICAL'
      ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
      : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } })
  })
  financeState.pendingCells.forEach((key) => {
    if (styleMap.has(key)) return
    styleMap.set(key, { bd: { borderType: 'border-all', style: '3', color: '#E6A23C' }, bg: '#FDF6EC' })
  })

  for (const [key, style] of styleMap.entries()) {
    const [rs, cs] = key.split('-')
    const row = Number(rs), col = Number(cs)
    if (!flowdata[row]) continue
    let cell = flowdata[row][col]
    if (!cell) {
      cell = { v: ' ', m: ' ', ct: { fa: 'General', t: 'g' } }
      flowdata[row][col] = cell
    }
    if (cell.v === null || cell.v === undefined || String(cell.v).trim() === '') {
      cell.v = ' '
      cell.m = ' '
    }
    cell.bd = style.bd
    if (style.bg) cell.bg = style.bg
    else delete cell.bg
  }

  try {
    if (ls.jfrefreshgrid) ls.jfrefreshgrid()
    else if (ls.refresh) ls.refresh()
  } catch { /* 忽略 */ }
}

export function onCellBlur(row: number, col: number) {
  if (blurDebounceTimer) clearTimeout(blurDebounceTimer)
  // 去重：同一单元格不重复入队
  if (!pendingBlurs.some((p) => p.row === row && p.col === col)) {
    pendingBlurs.push({ row, col })
  }
  blurDebounceTimer = window.setTimeout(() => {
    blurDebounceTimer = null
    const items = pendingBlurs.splice(0)
    for (const { row: r, col: c } of items) {
      executeBlurValidation(r, c)
    }
    // 所有行校验完毕后，统一刷新一次渲染
    flushStyleBatchSync()
  }, 200)
}

function executeBlurValidation(row: number, col: number) {
  const rowSimpleResults = validateRow(row)
  const rowCondResults = validateConditionalRow(row)
  const rowAllResults = [...rowSimpleResults, ...rowCondResults]

  // 清除当前行旧结果，保留跨行结果
  for (let c = 0; c < FINANCE_COL_COUNT; c++) {
    const key = cellKey(row, c)
    const existing = financeState.results.get(key)
    if (existing) {
      const crossOnly = existing.filter((r) =>
        (FINANCE_CROSS_ROW_RULE_IDS as readonly string[]).includes(r.ruleId)
      )
      if (crossOnly.length > 0) financeState.results.set(key, crossOnly)
      else financeState.results.delete(key)
    }
  }

  for (const r of rowAllResults) {
    r.message = sanitizeMessage(r.message)
    const key = cellKey(r.row, r.col)
    const existing = financeState.results.get(key)
    if (existing) existing.push(r)
    else financeState.results.set(key, [r])
  }

  const colsToUpdate = new Set<number>()
  for (const r of rowAllResults) colsToUpdate.add(r.col)
  if (col >= 0) {
    getAffectedTargetCols(col).forEach((c) => colsToUpdate.add(c))
    colsToUpdate.add(col)
  }

  for (const c of colsToUpdate) {
    applyCellStyle(row, c, getWorstResult(row, c), false)
    updatePendingState(row, c)
  }

  markStatsDirty()
  // 不在此处刷新渲染，由 onCellBlur 统一刷新

  // 通知调度器此行已被编辑（如果调度器正在运行）
  if (financeScheduler.isRunning) {
    financeScheduler.markRowEdited(row)
  }

  // 延迟执行增量跨行校验
  scheduleCrossRowValidation(col)
}

// ==================== 增量跨行校验延迟执行 ====================

let crossRowTimer: number | null = null
let crossRowPendingCol = -1

/** 编辑列 → 需要重算的跨行规则映射 */
const CROSS_ROW_COL_MAP: Record<number, string[]> = {
  0: ['项目名称一致性'],
  1: ['数据重复校验'],
  3: ['数据重复校验'],
  5: ['计费日期逻辑', '数据重复校验'],
  6: ['计费日期逻辑', '数据重复校验'],
}

function scheduleCrossRowValidation(col: number) {
  // 如果该列不涉及跨行规则，直接跳过
  if (!CROSS_ROW_COL_MAP[col]) return

  crossRowPendingCol = col
  if (crossRowTimer) return
  crossRowTimer = window.setTimeout(() => {
    crossRowTimer = null
    const targetCol = crossRowPendingCol
    crossRowPendingCol = -1
    executeCrossRowValidation(targetCol)
  }, 800)
}

function executeCrossRowValidation(col: number) {
  const crossRowResults = validateCrossRowByCol(col)
  if (!crossRowResults.length) {
    // 即使没有新结果，也需要清除旧的跨行结果
    clearCrossRowResultsForCol(col)
    markStatsDirty()
    flushStyleBatchSync()
    return
  }

  clearCrossRowResultsForCol(col)
  for (const r of crossRowResults) {
    appendCellResult(r.row, r.col, r)
    applyCellStyle(r.row, r.col, getWorstResult(r.row, r.col), false)
  }
  markStatsDirty()
  flushStyleBatchSync()
}

// ==================== 辅助函数 ====================

function getWorstResult(row: number, col: number): ValidationResult | null {
  const results = financeState.results.get(cellKey(row, col))
  if (!results?.length) return null
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  return results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
}

function clearCrossRowResultsForCol(col: number) {
  const ruleIds = CROSS_ROW_COL_MAP[col]
  if (!ruleIds) return

  const keysToDelete: string[] = []
  financeState.results.forEach((results, key) => {
    const filtered = results.filter((r) => !ruleIds.includes(r.ruleId))
    if (!filtered.length) keysToDelete.push(key)
    else financeState.results.set(key, filtered)
  })
  for (const k of keysToDelete) financeState.results.delete(k)
}

function updatePendingState(row: number, col: number) {
  const key = cellKey(row, col)
  const ls = (window as any).luckysheet
  if (!ls) return
  const v = ls.getCellValue(row, col)
  const isEmpty = v === null || v === undefined || String(v).trim() === ''
  if (isEmpty && !financeState.results.has(key) && isPendingRequired(row, col)) {
    financeState.pendingCells.add(key)
    applyPendingStyle(row, col, false)
  } else {
    financeState.pendingCells.delete(key)
  }
}

export function getCellErrors(row: number, col: number): CellError | null {
  const results = financeState.results.get(cellKey(row, col))
  if (!results?.length) return null
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  const worst = results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
  return { row, col, severity: worst.severity, messages: results.map((r) => r.message) }
}

export function getAllCellErrors(): CellError[] {
  const errors: CellError[] = []
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  financeState.results.forEach((results, key) => {
    if (!results.length) return
    const [rs, cs] = key.split('-')
    const row = Number(rs), col = Number(cs)
    const worst = results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
    errors.push({ row, col, severity: worst.severity, messages: results.map((r) => r.message) })
  })
  return errors
}

// ==================== 分步校验调度器 ====================

const financeScheduler = new ValidationScheduler({
  headerRowCount: FINANCE_HEADER_ROW_COUNT,
  batchSize: 50,
  progress: financeSchedulerProgress,
  validateRowBatch(startRow, endRow, skipRows) {
    const results: ValidationResult[] = []
    for (let r = startRow; r < endRow; r++) {
      if (skipRows.has(r)) continue
      results.push(...validateRow(r))
      results.push(...validateConditionalRow(r))
    }
    return results
  },
  validateCrossRowAll() {
    return validateAllCrossRow()
  },
  clearAllResults() {
    financeState.results.clear()
    financeState.pendingCells.clear()
  },
  applyBatchResults(results, startRow, endRow) {
    // 仅写入结果到内存，不调用任何Luckysheet API
    for (const r of results) {
      r.message = sanitizeMessage(r.message)
      const key = cellKey(r.row, r.col)
      const existing = financeState.results.get(key)
      if (existing) existing.push(r)
      else financeState.results.set(key, [r])
    }
  },
  applyCrossRowResults(results) {
    // 仅写入结果到内存，不调用任何Luckysheet API
    for (const r of results) {
      r.message = sanitizeMessage(r.message)
      const key = cellKey(r.row, r.col)
      const existing = financeState.results.get(key)
      if (existing) existing.push(r)
      else financeState.results.set(key, [r])
    }
  },
  updatePendingForBatch(startRow, endRow) {
    // 仅更新pendingCells集合，不调用任何Luckysheet API
    const ls = (window as any).luckysheet
    if (!ls) return
    // 直接读取flowdata避免API开销
    const flowdata = typeof ls.flowdata === 'function' ? ls.flowdata() : null
    for (let r = startRow; r < endRow; r++) {
      for (const col of getPendingCols(r)) {
        const key = cellKey(r, col)
        let isEmpty = true
        if (flowdata && flowdata[r]) {
          const cell = flowdata[r][col]
          const v = cell ? cell.v : null
          isEmpty = v === null || v === undefined || String(v).trim() === ''
        } else {
          const v = ls.getCellValue(r, col)
          isEmpty = v === null || v === undefined || String(v).trim() === ''
        }
        if (isEmpty && !financeState.results.has(key)) {
          financeState.pendingCells.add(key)
        }
      }
    }
  },
  updateStatsNow() {
    updateStatsNow()
  },
  getTotalDataRows() {
    return getTotalRowCount()
  },
})

/** 启动分步校验（导入后/手动重新校验） */
export function startValidation(): Promise<{ errors: ValidationResult[]; warnings: ValidationResult[] }> {
  return financeScheduler.run()
}

/** 等待校验完成（导出场景使用） */
export function waitForValidation(): Promise<{ errors: ValidationResult[]; warnings: ValidationResult[] }> {
  return financeScheduler.waitForCompletion()
}

/** 取消当前校验 */
export function cancelValidation() {
  financeScheduler.cancel()
  financeSchedulerProgress.isRunning = false
  financeSchedulerProgress.phase = ''
}

/** 获取调度器运行状态 */
export function isValidationRunning(): boolean {
  return financeScheduler.isRunning
}

/**
 * 校验完成后一次性应用所有样式
 * 直接修改Luckysheet内部flowdata，避免逐个调用setCellFormat导致的内存暴涨
 * 最后调用一次jfrefreshgrid刷新画布
 */
export function applyAllStylesFromResults() {
  const ls = (window as any).luckysheet
  if (!ls) return

  // 构建样式映射
  const styleMap = new Map<string, { bd: any; bg?: string }>()

  financeState.results.forEach((results, key) => {
    if (!results.length) return
    const worst = results.reduce((a, b) => {
      const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return o[a.severity] <= o[b.severity] ? a : b
    })
    styleMap.set(key, worst.severity === 'CRITICAL'
      ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
      : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } })
  })

  financeState.pendingCells.forEach((key) => {
    if (styleMap.has(key)) return
    styleMap.set(key, { bd: { borderType: 'border-all', style: '3', color: '#E6A23C' }, bg: '#FDF6EC' })
  })

  if (!styleMap.size) return

  // 直接修改flowdata中的单元格对象
  const flowdata = typeof ls.flowdata === 'function' ? ls.flowdata() : null
  if (!flowdata) {
    applyAllValidationStyles()
    return
  }

  for (const [key, style] of styleMap.entries()) {
    const [rs, cs] = key.split('-')
    const row = Number(rs), col = Number(cs)

    if (!flowdata[row]) continue
    let cell = flowdata[row][col]

    if (!cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === '') {
      if (!cell) {
        cell = { v: ' ', m: ' ', ct: { fa: 'General', t: 'g' } }
        flowdata[row][col] = cell
      } else {
        cell.v = cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '' ? cell.v : ' '
        cell.m = cell.m !== null && cell.m !== undefined && String(cell.m).trim() !== '' ? cell.m : ' '
      }
    }

    cell.bg = style.bg || '#ffffff'
    cell.bd = style.bd
  }

  if (typeof ls.jfrefreshgrid === 'function') {
    ls.jfrefreshgrid()
  } else {
    try {
      ls.setCellValue(0, 0, ls.getCellValue(0, 0), { isRefresh: true })
    } catch { /* 忽略 */ }
  }

  try {
    const sheetFile = ls.getluckysheetfile?.()
    if (sheetFile && sheetFile[0]) {
      if (Array.isArray(sheetFile[0].jfguard_select_save)) sheetFile[0].jfguard_select_save = []
    }
  } catch { /* 忽略 */ }
}

// ==================== 全量校验（兼容旧接口，导出场景使用调度器） ====================

/**
 * 全量校验（导出场景使用）
 * 内部使用调度器分步执行，返回Promise
 */
export function runFullValidation(): Promise<{ errors: ValidationResult[]; warnings: ValidationResult[] }> {
  return startValidation()
}

// ==================== 清理 ====================

export function cleanupTimers() {
  if (blurDebounceTimer) { clearTimeout(blurDebounceTimer); blurDebounceTimer = null }
  pendingBlurs = []
  if (crossRowTimer) { clearTimeout(crossRowTimer); crossRowTimer = null }
  crossRowPendingCol = -1
  cancelStyleBatch()
  if (statsRafId) { cancelAnimationFrame(statsRafId); statsRafId = null }
  statsDirty = false
  financeScheduler.cancel()
  financeSchedulerProgress.isRunning = false
  financeSchedulerProgress.phase = ''
}

export function useFinanceValidationStore() {
  return {
    state: financeState,
    onCellInput, onCellBlur, onBatchInputComplete, runFullValidation,
    startValidation, waitForValidation, cancelValidation, isValidationRunning,
    getCellErrors, getAllCellErrors, applyAllValidationStyles, applyAllStylesFromResults,
    flushStyles: flushStyleBatchSync,
    cleanupTimers,
  }
}
