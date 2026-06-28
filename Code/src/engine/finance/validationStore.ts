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

// ==================== 全局类型声明（用于Monkey-Patch） ====================

declare global {
  interface Window {
    /** 是否处于批量处理模式（Patch使用：跳过jfrefreshgrid） */
    __isBulkProcessing: boolean
    /** 批量处理期间收集的脏行（用于最后的增量刷新） */
    __dirtyRowsForBulk: Set<number>
    /** 批量处理结束后是否需要最终刷新画布 */
    __needsGridRefresh: boolean
    /** 【新增】全局防重入锁：防止 handleBulkDelete 被重复调用 */
    __isBulkDeleting: boolean
    /** 【新增】最近一次批量删除完成的时间戳，用于防止 cellMousedown 钩子触发二次删除 */
    __lastBulkDeleteTime: number
  }
}

// 初始化全局标志
if (typeof window !== 'undefined') {
  window.__isBulkProcessing = false
  window.__dirtyRowsForBulk = new Set()
  window.__needsGridRefresh = false
  window.__isBulkDeleting = false  // 【新增】初始化防重入锁
  window.__lastBulkDeleteTime = 0  // 【新增】初始化时间戳
}

// ==================== 配置常量 ====================

/** 批量操作的行数阈值：超过此值启用分帧异步处理 */
export const BATCH_THRESHOLD = 50

/** 分帧处理时每帧处理的行数 */
export const BATCH_ROWS_PER_FRAME = 50

/** 快照大小阈值：超过此值使用轻量检测模式 */
export const SNAPSHOT_THRESHOLD = 500

/** 快速删除路径阈值：超过此值跳过校验直接清除 */
export const FAST_DELETE_THRESHOLD = 100

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
  /** 是否正在执行批量操作（用于触发遮罩） */
  isProcessing: false,
  /** 批量操作进度百分比（0-100） */
  batchProgress: 0,
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
  // 小数据量（≤50行）：保持原有同步逻辑，即时响应
  if (changedRows.length <= BATCH_THRESHOLD) {
    executeBatchSync(changedRows, changedCols)
    return
  }

  // 大数据量：分帧异步处理，避免阻塞主线程
  executeBatchAsync(changedRows, changedCols)
}

/** 同步批量处理（小数据量，保持即时响应） */
function executeBatchSync(changedRows: number[], changedCols: number[]) {
  // 全程保持 __isBulkProcessing = true，防止 jfrefreshgrid 被逐次触发
  window.__isBulkProcessing = true

  for (const row of changedRows) {
    executeBlurValidation(row, -1, true)  // 静默模式：不触发样式
  }
  // 增量样式更新（只传变化的行）→ 统一通过 flowdata 应用
  const dirtyRows = new Set(changedRows)
  applyStylesViaFlowdata(dirtyRows)

  // 样式已通过 flowdata 应用完毕，关闭批量模式
  window.__isBulkProcessing = false

  // 触发跨行校验
  for (const col of changedCols) {
    if (CROSS_ROW_COL_MAP[col]) {
      scheduleCrossRowValidation(col)
    }
  }
}

/** 异步分帧批量处理（大数据量，防止卡死） */
function executeBatchAsync(changedRows: number[], changedCols: number[]) {
  // 标记正在处理中（用于触发遮罩）
  financeState.isProcessing = true

  // 全程保持 __isBulkProcessing = true，防止 jfrefreshgrid 被逐次触发
  window.__isBulkProcessing = true

  const totalRows = changedRows.length
  let currentIndex = 0

  // 收集所有需要处理的行作为脏行集合
  const allDirtyRows = new Set(changedRows)

  function processNextChunk() {
    if (currentIndex >= totalRows) {
      // 所有行处理完毕 → 统一应用样式 → 释放批量模式
      applyStylesViaFlowdata(allDirtyRows)

      // 样式已通过 flowdata 应用完毕，关闭批量模式
      window.__isBulkProcessing = false
      financeState.isProcessing = false

      // 触发跨行校验
      for (const col of changedCols) {
        if (CROSS_ROW_COL_MAP[col]) {
          scheduleCrossRowValidation(col)
        }
      }
      return
    }

    // 取出当前帧要处理的行（每帧BATCH_ROWS_PER_FRAME行）
    const endIndex = Math.min(currentIndex + BATCH_ROWS_PER_FRAME, totalRows)
    const chunk = changedRows.slice(currentIndex, endIndex)
    currentIndex = endIndex

    // 执行当前帧的校验（静默模式：不触发样式）
    for (const row of chunk) {
      executeBlurValidation(row, -1, true)
    }

    // 更新进度（用于遮罩进度条显示）
    financeState.batchProgress = Math.round((currentIndex / totalRows) * 100)

    // 安排下一帧
    requestAnimationFrame(() => processNextChunk())
  }

  // 启动分帧处理
  requestAnimationFrame(() => processNextChunk())
}

/**
 * 快速删除路径：分帧异步清除数据 + 统一刷新
 * 【双重数据结构同步方案】同时维护 flowdata 和 celldata，确保一致性
 *
 * 核心改进：
 * 1. 启用 __isBulkProcessing 全局标志 → Patch后的 jfrefreshgrid 会被跳过
 * 2. 同时修改两套数据结构：
 *    - flowdata[r][c] = null（二维数组，用于计算）
 *    - 从 celldata[] 移除对应条目（对象数组，用于渲染）
 * 3. 分帧处理避免阻塞主线程
 * 4. 最后关闭批量模式，统一刷新一次画布
 *
 * @param rows 要删除的行号数组
 * @param colRange 可选的列范围 { startCol, endCol }，精确匹配用户选区
 */
export async function handleBulkDelete(rows: number[], colRange?: { startCol: number; endCol: number }) {
  // ===== 【新增】防重入检查 =====
  if (window.__isBulkDeleting) {
    console.warn('[handleBulkDelete] ⚠️ 检测到重复调用，已忽略（防重入锁生效）')
    return  // 如果已经在执行中，直接返回
  }

  // 启用防重入锁
  window.__isBulkDeleting = true

  // 1. 启用批量模式（Patch会检测此标志并跳过 jfrefreshgrid）
  window.__isBulkProcessing = true
  window.__dirtyRowsForBulk.clear()
  window.__needsGridRefresh = false

  financeState.isProcessing = true

  const totalRows = rows.length
  let processedRows = 0

  // 确定要处理的列范围（只清除用户选中的列！）
  const startCol = colRange?.startCol ?? 0
  const endCol = colRange?.endCol ?? (FINANCE_COL_COUNT - 1)

  try {
    // 获取 Luckysheet 底层数据引用
    const ls = (window as any).luckysheet
    const sheetIndex = ls?.getCurrentSheetIndex?.()
    const sheet = ls?.getSheetByIndex?.(sheetIndex) || ls?.getSheet?.()
    const flowdata = sheet?.data || []
    const celldata = sheet?.celldata || []

    console.log(`[handleBulkDelete] 开始处理 ${totalRows} 行 × 列${startCol}-${endCol}`)
    console.log(`[handleBulkDelete] 使用双重数据同步模式 (flowdata + celldata)`)

    // 预先构建要删除的单元格坐标集合（用于快速查找celldata中的条目）
    const cellsToDelete = new Set<string>()
    for (const row of rows) {
      for (let col = startCol; col <= endCol; col++) {
        cellsToDelete.add(`${row}-${col}`)
      }
    }

    // 2. 分帧清除数据（每帧处理 BATCH_ROWS_PER_FRAME 行）
    while (processedRows < totalRows) {
      const batch = rows.slice(processedRows, processedRows + BATCH_ROWS_PER_FRAME)

      for (const row of batch) {
        // 2a. 直接操作 flowdata（二维数组）
        if (flowdata[row]) {
          for (let col = startCol; col <= endCol; col++) {
            flowdata[row][col] = null  // 直接置空
          }
        }

        // 2b. 清除我们的校验结果（只清除对应列）
        for (let col = startCol; col <= endCol; col++) {
          financeState.results.delete(`${row}-${col}`)
          financeState.pendingCells.delete(`${row}-${col}`)
        }

        // 记录脏行（用于最后的增量样式更新）
        window.__dirtyRowsForBulk.add(row)
      }

      processedRows += batch.length
      // 更新进度（0-80%用于数据清除阶段）
      financeState.batchProgress = Math.round((processedRows / totalRows) * 80)

      // 让出主线程，避免阻塞UI
      await new Promise(resolve => requestAnimationFrame(resolve))
    }

    // 3. 【关键】同步清理 celldata（在所有 flowdata 修改完成后统一处理）
    if (Array.isArray(celldata) && cellsToDelete.size > 0) {
      console.log(`[handleBulkDelete] 同步清理 celldata，共 ${cellsToDelete.size} 个单元格`)

      // 使用倒序遍历，安全删除数组元素
      for (let i = celldata.length - 1; i >= 0; i--) {
        const cell = celldata[i]
        if (cell && typeof cell === 'object' && 'r' in cell && 'c' in cell) {
          const key = `${cell.r}-${cell.c}`
          if (cellsToDelete.has(key)) {
            celldata.splice(i, 1)
          }
        }
      }
    }

    // 3. 应用样式（增量模式）- 此时仍处于批量模式，不会触发刷新
    applyStylesViaFlowdata(window.__dirtyRowsForBulk)
    financeState.batchProgress = 90

    // 4. 关闭批量模式，执行最终统一刷新！
    console.log('[handleBulkDelete] 批量处理完成，执行最终画布刷新')
    window.__isBulkProcessing = false

    if (window.__needsGridRefresh || window.__dirtyRowsForBulk.size > 0) {
      const ls = (window as any).luckysheet
      if (ls && typeof ls.jfrefreshgrid === 'function') {
        ls.jfrefreshgrid()
      }
    }

    markStatsDirty()
    financeState.batchProgress = 100

  } catch (err) {
    console.error('[handleBulkDelete] 处理失败:', err)
    window.__isBulkProcessing = false
  } finally {
    financeState.isProcessing = false
    window.__isBulkDeleting = false  // 【新增】释放防重入锁
    window.__lastBulkDeleteTime = Date.now()  // 【新增】记录完成时间，防止cellMousedown二次触发
  }
}

/**
 * 快速编辑路径：分帧异步校验 + 统一刷新
 * 与 handleBulkDelete 对称的编辑版本
 *
 * 核心改进：
 * 1. 全程保持 __isBulkProcessing = true，Patch 后的 jfrefreshgrid 被跳过
 * 2. 校验期间不触发样式渲染（executeBlurValidation 静默模式）
 * 3. 最后关闭批量模式，统一刷新1次画布
 */
export async function handleBulkEdit(
  rows: number[],
  colRange: { startCol: number; endCol: number },
  changedRows: number[],
  changedCols: number[]
) {
  // 防重入检查
  if (window.__isBulkProcessing) {
    console.warn('[handleBulkEdit] ⚠️ 批量处理正在进行中，已忽略')
    return
  }

  // 启用批量模式
  window.__isBulkProcessing = true
  window.__dirtyRowsForBulk.clear()
  window.__needsGridRefresh = false

  financeState.isProcessing = true

  const totalRows = rows.length
  let processedRows = 0

  // 收集脏行集合（用于样式更新）
  const allDirtyRows = new Set<number>()

  try {
    console.log(`[handleBulkEdit] 开始处理 ${totalRows} 行 × 列${colRange.startCol}-${colRange.endCol}`)

    // 1. 分帧校验（不触发样式）
    while (processedRows < totalRows) {
      const batch = rows.slice(processedRows, processedRows + BATCH_ROWS_PER_FRAME)

      for (const row of batch) {
        executeBlurValidation(row, -1, true)
        allDirtyRows.add(row)
        window.__dirtyRowsForBulk.add(row)
      }

      processedRows += batch.length
      financeState.batchProgress = Math.round((processedRows / totalRows) * 80)

      // 让出主线程
      await new Promise(resolve => requestAnimationFrame(resolve))
    }

    // 2. 统一应用样式（通过 flowdata 直接修改，不触发渲染）
    applyStylesViaFlowdata(allDirtyRows)
    financeState.batchProgress = 90

    // 3. 跨行校验
    for (const col of changedCols) {
      if (CROSS_ROW_COL_MAP[col]) {
        scheduleCrossRowValidation(col)
      }
    }

    // 4. 关闭批量模式，执行最终统一刷新
    console.log('[handleBulkEdit] 批量处理完成，执行最终画布刷新')
    window.__isBulkProcessing = false

    if (window.__needsGridRefresh || window.__dirtyRowsForBulk.size > 0) {
      const ls = (window as any).luckysheet
      if (ls && typeof ls.jfrefreshgrid === 'function') {
        ls.jfrefreshgrid()
      }
    }

    markStatsDirty()
    financeState.batchProgress = 100

  } catch (err) {
    console.error('[handleBulkEdit] 处理失败:', err)
    window.__isBulkProcessing = false
  } finally {
    financeState.isProcessing = false
    window.__isBulkProcessing = false
  }
}

/**
 * 通过直接修改flowdata批量应用样式
 * @param dirtyRows 可选的脏行集合。提供时只处理这些行的样式（增量模式）；
 *                   不提供或为空时全量遍历所有results（向后兼容）
 */
function applyStylesViaFlowdata(dirtyRows?: Set<number>) {
  const ls = (window as any).luckysheet
  if (!ls) return

  cancelStyleBatch()

  const flowdata = typeof ls.flowdata === 'function' ? ls.flowdata() : null
  if (!flowdata) {
    flushStyleBatchSync()
    return
  }

  const styleMap = new Map<string, { bd: any; bg?: string }>()

  if (dirtyRows && dirtyRows.size > 0) {
    // ===== 增量模式：只遍历脏行相关的单元格 =====
    for (const row of dirtyRows) {
      for (let col = 0; col < FINANCE_COL_COUNT; col++) {
        const key = `${row}-${col}`

        // 检查是否有错误结果
        const results = financeState.results.get(key)
        if (results && results.length > 0) {
          const worst = getWorstResultFromList(results)
          styleMap.set(key, worst.severity === 'CRITICAL'
            ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
            : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } }
          )
          continue
        }

        // 检查是否为待填写
        if (financeState.pendingCells.has(key)) {
          styleMap.set(key, { bd: { borderType: 'border-all', style: '3', color: '#E6A23C' }, bg: '#FDF6EC' })
          continue
        }

        // 无错误且非待填写：标记清除样式
        if (flowdata[row]?.[col]) {
          styleMap.set(key, { bd: null }) // null 表示恢复默认
        }
      }
    }
  } else {
    // ===== 全量模式：遍历所有results和pendingCells（向后兼容） =====
    financeState.results.forEach((results, key) => {
      if (!results.length) return
      const worst = getWorstResultFromList(results)
      styleMap.set(key, worst.severity === 'CRITICAL'
        ? { bd: { borderType: 'border-all', style: '2', color: '#F56C6C' }, bg: '#FEF0F0' }
        : { bd: { borderType: 'border-all', style: '2', color: '#E6A23C' } }
      )
    })
    financeState.pendingCells.forEach((key) => {
      if (styleMap.has(key)) return
      styleMap.set(key, { bd: { borderType: 'border-all', style: '3', color: '#E6A23C' }, bg: '#FDF6EC' })
    })
  }

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

    if (style.bd === null) {
      // 增量模式：清除错误样式，恢复默认
      delete cell.bd
      delete cell.bg
    } else {
      cell.bd = style.bd
      if (style.bg) cell.bg = style.bg
      else delete cell.bg
    }
  }

  try {
    if (ls.jfrefreshgrid) ls.jfrefreshgrid()
    else if (ls.refresh) ls.refresh()
  } catch { /* 忽略 */ }
}

/** 从结果列表中获取最严重的错误 */
function getWorstResultFromList(results: ValidationResult[]): ValidationResult {
  const o: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  return results.reduce((a, b) => o[a.severity] <= o[b.severity] ? a : b)
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

function executeBlurValidation(row: number, col: number, silent = false) {
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

  // 静默模式：跳过样式应用，由 handleBulkEdit 统一通过 applyStylesViaFlowdata 处理
  if (!silent) {
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
  } else {
    // 静默模式：只更新待填写状态，不触发渲染
    for (const r of rowAllResults) {
      updatePendingState(r.row, r.col)
    }
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
    // 配置常量和快速删除方法
    BATCH_THRESHOLD, SNAPSHOT_THRESHOLD, FAST_DELETE_THRESHOLD, handleBulkDelete, handleBulkEdit,
  }
}
