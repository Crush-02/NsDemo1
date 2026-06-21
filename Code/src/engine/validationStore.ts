import { reactive } from 'vue'
import type { ValidationResult, CellError, Severity } from './types'
import { sanitizeMessage, PROPERTY_CROSS_ROW_RULE_IDS } from './types'
import {
  validateCell, validateRow, validateAll,
  getFilledRowCount, getTotalRowCount,
} from './simpleValidator'
import { validateConditionalRow, validateConditionalAll } from './conditionalValidator'
import { validateAllCrossRow, validateCrossRowByCol } from './crossRowValidator'
import { getAffectedTargetCols, isPendingRequired, getPendingCols } from './dependencyTracker'
import { ValidationScheduler, schedulerProgress } from './validationScheduler'

export { schedulerProgress }

// ==================== 状态 ====================

export const state = reactive({
  results: new Map<string, ValidationResult[]>(),
  errorCount: 0,
  warningCount: 0,
  filledRows: 0,
  totalRows: 0,
  pendingCells: new Set<string>(),
  /** 校验进度（绑定到全局schedulerProgress） */
  validationProgress: schedulerProgress,
})

function cellKey(row: number, col: number): string {
  return `${row}-${col}`
}

// ==================== 统计缓存（避免频繁遍历+调用getSheetData） ====================

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
  state.results.forEach((results) => {
    for (const r of results) {
      if (r.severity === 'CRITICAL') errors++
      else warnings++
    }
  })
  state.errorCount = errors
  state.warningCount = warnings
  state.filledRows = getFilledRowCount()
  state.totalRows = getTotalRowCount()
}

// ==================== 基础操作（纯内存操作，不碰Luckysheet API） ====================

export function clearCellResult(row: number, col: number) {
  state.results.delete(cellKey(row, col))
}

export function setCellResult(row: number, col: number, result: ValidationResult | null) {
  const key = cellKey(row, col)
  if (result) {
    result.message = sanitizeMessage(result.message)
    state.results.set(key, [result])
  } else {
    state.results.delete(key)
  }
  markStatsDirty()
}

export function appendCellResult(row: number, col: number, result: ValidationResult) {
  result.message = sanitizeMessage(result.message)
  const key = cellKey(row, col)
  const existing = state.results.get(key)
  if (existing) existing.push(result)
  else state.results.set(key, [result])
  markStatsDirty()
}

export function setRowResults(row: number, results: ValidationResult[]) {
  for (let c = 0; c < 32; c++) state.results.delete(cellKey(row, c))
  for (const r of results) {
    r.message = sanitizeMessage(r.message)
    const key = cellKey(r.row, r.col)
    const existing = state.results.get(key)
    if (existing) existing.push(r)
    else state.results.set(key, [r])
  }
  markStatsDirty()
}

// ==================== 样式批处理（仅在blur/导出时使用） ====================

let styleBatch: Array<{ row: number; col: number; attr: string; value: any }> = []
let styleBatchTimer: number | null = null

/** 入队样式操作 */
function batchSetCellFormat(row: number, col: number, attr: string, value: any) {
  styleBatch.push({ row, col, attr, value })
  if (!styleBatchTimer) {
    styleBatchTimer = window.setTimeout(flushStyleBatch, 0)
  }
}

/** 刷新样式队列 */
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

/** 同步刷新（用于需要立即反馈的场景） */
function flushStyleBatchSync() {
  if (styleBatchTimer) { clearTimeout(styleBatchTimer); styleBatchTimer = null }
  flushStyleBatch()
}

/** 取消所有待执行的样式操作 */
function cancelStyleBatch() {
  if (styleBatchTimer) { clearTimeout(styleBatchTimer); styleBatchTimer = null }
  styleBatch = []
}

// ==================== 样式应用函数 ====================

/**
 * 应用单元格样式
 * @param useSpaceHack 是否对空单元格填入空格占位符
 *   日常编辑时设为false（避免undo堆积），仅导出前全量校验时设为true
 */
export function applyCellStyle(row: number, col: number, result: ValidationResult | null, useSpaceHack = false) {
  if (!result) {
    const key = cellKey(row, col)
    if (state.pendingCells.has(key)) { applyPendingStyle(row, col, useSpaceHack); return }
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

/** 全量样式应用（仅导出前使用，useSpaceHack=true） */
export function applyAllValidationStyles() {
  const ls = (window as any).luckysheet
  if (!ls) return

  const styleMap = new Map<string, { bd: any; bg?: string }>()

  state.results.forEach((results, key) => {
    if (!results.length) return
    const worst = results.reduce((a, b) => {
      const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return o[a.severity] <= o[b.severity] ? a : b
    })
    styleMap.set(key, worst.severity === 'CRITICAL'
      ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
      : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } })
  })

  state.pendingCells.forEach((key) => {
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

/**
 * ON_INPUT: 即时校验单个单元格并更新样式
 */
export function onCellInput(row: number, col: number) {
  clearCellResult(row, col)
  const result = validateCell(row, col)
  setCellResult(row, col, result)
  applyCellStyle(row, col, result, false)
  updatePendingState(row, col)
  flushStyleBatchSync()
}

/** ON_BLUR: 失焦校验（防抖+分离跨行），支持多个pending */
export function onCellBlur(row: number, col: number) {
  // 去重：避免同一行列重复入队
  const exists = pendingBlurs.some(b => b.row === row && b.col === col)
  if (!exists) {
    pendingBlurs.push({ row, col })
  }
  if (blurDebounceTimer) clearTimeout(blurDebounceTimer)
  blurDebounceTimer = window.setTimeout(() => {
    blurDebounceTimer = null
    const blurs = pendingBlurs.slice()
    pendingBlurs = []
    // 收集所有需要跨行校验的列
    const crossRowCols = new Set<number>()
    for (const { row: r, col: c } of blurs) {
      executeBlurValidation(r, c)
      if (CROSS_ROW_COL_MAP[c]) {
        crossRowCols.add(c)
      }
    }
    // 一次性触发所有相关的跨行校验
    if (crossRowCols.size > 0) {
      scheduleCrossRowValidation(Array.from(crossRowCols))
    }
  }, 200)
}

/** 实际执行blur校验（简单+条件，不含跨行） */
function executeBlurValidation(row: number, col: number) {
  const rowSimpleResults = validateRow(row)
  const rowCondResults = validateConditionalRow(row)
  const rowAllResults = [...rowSimpleResults, ...rowCondResults]

  // 清除当前行旧的简单/条件结果，保留跨行结果
  for (let c = 0; c < 32; c++) {
    const key = cellKey(row, c)
    const existing = state.results.get(key)
    if (existing) {
      const crossOnly = existing.filter((r) =>
        (PROPERTY_CROSS_ROW_RULE_IDS as readonly string[]).includes(r.ruleId)
      )
      if (crossOnly.length > 0) state.results.set(key, crossOnly)
      else state.results.delete(key)
    }
  }

  // 写入新结果
  for (const r of rowAllResults) {
    r.message = sanitizeMessage(r.message)
    const key = cellKey(r.row, r.col)
    const existing = state.results.get(key)
    if (existing) existing.push(r)
    else state.results.set(key, [r])
  }

  // 更新样式（日常编辑不用空格占位）
  const colsToUpdate = new Set<number>()
  for (const r of rowAllResults) colsToUpdate.add(r.col)
  getAffectedTargetCols(col).forEach((c) => colsToUpdate.add(c))
  colsToUpdate.add(col)

  for (const c of colsToUpdate) {
    applyCellStyle(row, c, getWorstResult(row, c), false)
    updatePendingState(row, c)
  }

  markStatsDirty()
  flushStyleBatchSync()

  // 通知调度器此行已被编辑（如果调度器正在运行）
  if (scheduler.isRunning) {
    scheduler.markRowEdited(row)
  }
  // 跨行校验由 onCellBlur 统一调度，此处不再触发
}

// ==================== 增量跨行校验延迟执行 ====================

let crossRowTimer: number | null = null
let crossRowPendingCols: number[] = []

/** 编辑列 → 需要重算的跨行规则映射 */
const CROSS_ROW_COL_MAP: Record<number, string[]> = {
  6: ['房产简称_唯一性'],
  12: ['日期顺序'],
  13: ['日期顺序'],
  19: ['业主证件号码_一致性'],
  20: ['业主证件号码_一致性'],
  30: ['客户信息一致性'],
}

function scheduleCrossRowValidation(cols: number[]) {
  // 过滤出涉及跨行规则的列
  const relevantCols = cols.filter(c => CROSS_ROW_COL_MAP[c])
  if (!relevantCols.length) return

  // 合并到pending列表（去重）
  for (const c of relevantCols) {
    if (!crossRowPendingCols.includes(c)) {
      crossRowPendingCols.push(c)
    }
  }
  if (crossRowTimer) return
  crossRowTimer = window.setTimeout(() => {
    crossRowTimer = null
    const targetCols = crossRowPendingCols.slice()
    crossRowPendingCols = []
    executeCrossRowValidation(targetCols)
  }, 800)
}

function executeCrossRowValidation(cols: number[]) {
  // 收集所有相关列的跨行校验结果
  let allCrossRowResults: ValidationResult[] = []
  const allRuleIds = new Set<string>()

  for (const col of cols) {
    const results = validateCrossRowByCol(col)
    allCrossRowResults.push(...results)
    const ruleIds = CROSS_ROW_COL_MAP[col]
    if (ruleIds) ruleIds.forEach(id => allRuleIds.add(id))
  }

  // 清除所有相关列的旧跨行结果
  clearCrossRowResultsForRuleIds(Array.from(allRuleIds))

  if (!allCrossRowResults.length) {
    markStatsDirty()
    flushStyleBatchSync()
    return
  }

  for (const r of allCrossRowResults) {
    appendCellResult(r.row, r.col, r)
    applyCellStyle(r.row, r.col, getWorstResult(r.row, r.col), false)
  }
  markStatsDirty()
  flushStyleBatchSync()
}

// ==================== 辅助函数 ====================

function getWorstResult(row: number, col: number): ValidationResult | null {
  const results = state.results.get(cellKey(row, col))
  if (!results?.length) return null
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  return results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
}

function clearCrossRowResultsForCol(col: number) {
  const ruleIds = CROSS_ROW_COL_MAP[col]
  if (!ruleIds) return
  clearCrossRowResultsForRuleIds(ruleIds)
}

/** 根据ruleId列表清除跨行校验结果 */
function clearCrossRowResultsForRuleIds(ruleIds: string[]) {
  if (!ruleIds.length) return

  const keysToDelete: string[] = []
  state.results.forEach((results, key) => {
    const filtered = results.filter((r) => !ruleIds.includes(r.ruleId))
    if (!filtered.length) keysToDelete.push(key)
    else state.results.set(key, filtered)
  })
  for (const k of keysToDelete) state.results.delete(k)
}

function updatePendingState(row: number, col: number) {
  const key = cellKey(row, col)
  const ls = (window as any).luckysheet
  if (!ls) return
  const v = ls.getCellValue(row, col)
  const isEmpty = v === null || v === undefined || String(v).trim() === ''
  if (isEmpty && !state.results.has(key) && isPendingRequired(row, col)) {
    state.pendingCells.add(key)
    applyPendingStyle(row, col, false)
  } else {
    state.pendingCells.delete(key)
  }
}

export function getCellErrors(row: number, col: number): CellError | null {
  const results = state.results.get(cellKey(row, col))
  if (!results?.length) return null
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  const worst = results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
  return { row, col, severity: worst.severity, messages: results.map((r) => r.message) }
}

export function getAllCellErrors(): CellError[] {
  const errors: CellError[] = []
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  state.results.forEach((results, key) => {
    if (!results.length) return
    const [rs, cs] = key.split('-')
    const row = Number(rs), col = Number(cs)
    const worst = results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
    errors.push({ row, col, severity: worst.severity, messages: results.map((r) => r.message) })
  })
  return errors
}

// ==================== 分步校验调度器 ====================

const scheduler = new ValidationScheduler({
  headerRowCount: 1,
  batchSize: 50,
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
    state.results.clear()
    state.pendingCells.clear()
  },
  applyBatchResults(results, startRow, endRow) {
    // 仅写入结果到内存，不调用任何Luckysheet API
    for (const r of results) {
      r.message = sanitizeMessage(r.message)
      const key = cellKey(r.row, r.col)
      const existing = state.results.get(key)
      if (existing) existing.push(r)
      else state.results.set(key, [r])
    }
  },
  applyCrossRowResults(results) {
    // 仅写入结果到内存，不调用任何Luckysheet API
    for (const r of results) {
      r.message = sanitizeMessage(r.message)
      const key = cellKey(r.row, r.col)
      const existing = state.results.get(key)
      if (existing) existing.push(r)
      else state.results.set(key, [r])
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
        if (isEmpty && !state.results.has(key)) {
          state.pendingCells.add(key)
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
  return scheduler.run()
}

/** 等待校验完成（导出场景使用） */
export function waitForValidation(): Promise<{ errors: ValidationResult[]; warnings: ValidationResult[] }> {
  return scheduler.waitForCompletion()
}

/** 取消当前校验 */
export function cancelValidation() {
  scheduler.cancel()
}

/** 获取调度器运行状态 */
export function isValidationRunning(): boolean {
  return scheduler.isRunning
}

/**
 * 校验完成后一次性应用所有样式
 * 直接修改Luckysheet内部flowdata，避免逐个调用setCellFormat导致的内存暴涨
 * 最后调用一次jfrefreshgrid刷新画布
 */
export function applyAllStylesFromResults() {
  const ls = (window as any).luckysheet
  if (!ls) return

  // 构建样式映射：cellKey → { bd, bg? }
  const styleMap = new Map<string, { bd: any; bg?: string }>()

  state.results.forEach((results, key) => {
    if (!results.length) return
    const worst = results.reduce((a, b) => {
      const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
      return o[a.severity] <= o[b.severity] ? a : b
    })
    styleMap.set(key, worst.severity === 'CRITICAL'
      ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
      : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } })
  })

  state.pendingCells.forEach((key) => {
    if (styleMap.has(key)) return
    styleMap.set(key, { bd: { borderType: 'border-all', style: '3', color: '#E6A23C' }, bg: '#FDF6EC' })
  })

  if (!styleMap.size) return

  // 直接修改flowdata中的单元格对象
  const flowdata = typeof ls.flowdata === 'function' ? ls.flowdata() : null
  if (!flowdata) {
    // 降级：使用API方式
    applyAllValidationStyles()
    return
  }

  for (const [key, style] of styleMap.entries()) {
    const [rs, cs] = key.split('-')
    const row = Number(rs), col = Number(cs)

    // 确保行数组存在
    if (!flowdata[row]) continue
    let cell = flowdata[row][col]

    // 空单元格需要创建占位对象（否则Luckysheet不渲染样式）
    if (!cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === '') {
      if (!cell) {
        cell = { v: ' ', m: ' ', ct: { fa: 'General', t: 'g' } }
        flowdata[row][col] = cell
      } else {
        cell.v = cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '' ? cell.v : ' '
        cell.m = cell.m !== null && cell.m !== undefined && String(cell.m).trim() !== '' ? cell.m : ' '
      }
    }

    // 直接设置样式属性
    cell.bg = style.bg || '#ffffff'
    cell.bd = style.bd
  }

  // 刷新画布
  if (typeof ls.jfrefreshgrid === 'function') {
    ls.jfrefreshgrid()
  } else {
    // 降级：强制刷新
    try {
      ls.setCellValue(0, 0, ls.getCellValue(0, 0), { isRefresh: true })
    } catch { /* 忽略 */ }
  }

  // 清理undo栈释放内存
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
  return scheduler.run()
}

// ==================== 清理（防内存泄漏） ====================

/** 清理所有定时器和待处理任务 */
export function cleanupTimers() {
  if (blurDebounceTimer) { clearTimeout(blurDebounceTimer); blurDebounceTimer = null }
  pendingBlurs = []
  if (crossRowTimer) { clearTimeout(crossRowTimer); crossRowTimer = null }
  crossRowPendingCols = []
  cancelStyleBatch()
  if (statsRafId) { cancelAnimationFrame(statsRafId); statsRafId = null }
  statsDirty = false
  scheduler.cancel()
}

export function useValidationStore() {
  return {
    state, onCellInput, onCellBlur, runFullValidation,
    startValidation, waitForValidation, cancelValidation, isValidationRunning,
    getCellErrors, getAllCellErrors, applyAllValidationStyles, applyAllStylesFromResults, setRowResults,
    cleanupTimers,
  }
}
