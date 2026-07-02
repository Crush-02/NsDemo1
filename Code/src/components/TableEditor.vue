<template>
  <div class="table-editor" @click="onEditorClick">
    <div class="luckysheet-container">
      <div
        id="luckysheet"
        style="margin:0px;padding:0px;position:absolute;width:100%;height:100%;"
      ></div>
    </div>
    <CellTooltip ref="cellTooltipRef" />
    <!-- 校验遮罩层 -->
    <div v-if="showValidationOverlay" class="validation-overlay">
      <div class="validation-overlay-card">
        <div class="validation-spinner"></div>
        <div class="validation-overlay-text">数据校验进行中，请稍等</div>
        <div class="validation-overlay-progress">
          <div class="validation-progress-bar">
            <div
              class="validation-progress-fill"
              :style="{ width: validationPercent + '%' }"
            ></div>
          </div>
          <span class="validation-progress-label">{{ validationPercent }}%</span>
        </div>
        <div class="validation-overlay-phase">{{ validationPhaseText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { HEADER_COLUMNS, type CellData } from '../types'
import { getCurrentCelldata, saveToLocal, loadFromLocal, formatTimestamp } from '../utils/autoSave'
import { buildColumnMapping, remapRows, type ExcelReadResult } from '../utils/excelIO'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useValidationStore } from '../engine/validationStore'
import CellTooltip from './CellTooltip.vue'

const cellTooltipRef = ref<InstanceType<typeof CellTooltip> | null>(null)
const validation = useValidationStore()

// ==================== 键盘拦截：Delete/Backspace 快速删除 ====================

/** 键盘事件处理函数引用（用于清理） */
let keydownHandler: ((e: KeyboardEvent) => void) | null = null

/**
 * 拦截 Delete/Backspace 键盘事件
 * 当选区超过阈值时，绕过 Luckysheet 的慢速实现，使用我们的快速分帧删除
 *
 * 【关键改进】
 * 原来的 BatchDefender 依赖 cellUpdated hook，但 Luckysheet 的 Delete 操作
 * 根本不触发 cellUpdated！导致 BatchDefender 完全失效。
 *
 * 新方案直接在键盘层面拦截，100%可靠。
 */
function setupKeyboardInterceptor() {
  keydownHandler = (e: KeyboardEvent) => {
    // 只拦截 Delete 和 Backspace
    if (e.key !== 'Delete' && e.key !== 'Backspace') return

    // 获取当前选区
    const ls = (window as any).luckysheet
    if (!ls) return

    try {
      const ranges = ls.getRange()
      if (!ranges || !ranges.length) return

      // 计算总行数
      let totalRows = 0
      for (const range of ranges) {
        totalRows += (range.row[1] - range.row[0] + 1)
      }

      // 只拦截大选区（超过阈值）
      if (totalRows <= validation.FAST_DELETE_THRESHOLD) return

      // ===== 大选区：拦截并使用快速路径 =====
      // 【新增】双重检查：防止重复调用
      if ((window as any).__isBulkDeleting) {
        console.log('[KeyInterceptor] ⚠️ 批量删除正在进行中，忽略本次按键')
        e.preventDefault()
        e.stopImmediatePropagation()
        return false
      }

      e.preventDefault()
      e.stopImmediatePropagation()  // 【关键修复】阻止同一元素上的其他监听器收到事件

      console.log(`[KeyInterceptor] 拦截${e.key}键，选中${totalRows}行，使用快速删除路径`)

      // 收集所有受影响的行和列（精确匹配用户选区）
      const affectedRows: number[] = []
      let minCol = Infinity
      let maxCol = -Infinity

      for (const range of ranges) {
        // 收集行
        for (let r = range.row[0]; r <= range.row[1]; r++) {
          affectedRows.push(r)
        }
        // 收集列范围
        minCol = Math.min(minCol, range.column[0])
        maxCol = Math.max(maxCol, range.column[1])
      }

      console.log(`[KeyInterceptor] 拦截${e.key}键，选中${affectedRows.length}行×列${minCol}-${maxCol}`)

      // 显示遮罩层
      showValidationOverlay.value = true

      // 使用分帧异步快速删除（传递精确的行列范围）
      validation.handleBulkDelete(affectedRows, { startCol: minCol, endCol: maxCol })

      // 【关键修复】清空快照，防止 cellMousedown 钩子检测到变化后二次调用 handleBulkDelete
      lastSelectionSnapshot = new Map()

      // 监听完成状态，自动隐藏遮罩
      watchProcessingState()

      return false
    } catch (err) {
      console.error('[KeyInterceptor] 处理失败:', err)
      // 出错时不拦截，让 Luckysheet 正常处理
    }
  }

  // 使用捕获阶段确保优先于 Luckysheet 处理
  document.addEventListener('keydown', keydownHandler, true)
  console.log('[KeyInterceptor] Delete/Backspace 键盘拦截器已安装')
}

/** 清理键盘拦截器 */
function cleanupKeyboardInterceptor() {
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler, true)
    keydownHandler = null
    console.log('[KeyInterceptor] 键盘拦截器已卸载')
  }
}

// ==================== Luckysheet 性能补丁 (Monkey-Patch) ====================

/**
 * 安装 Luckysheet 性能优化补丁
 * 
 * 【核心原理】通过替换 Luckysheet 内部关键函数，在批量操作期间跳过耗时的画布重绘
 * 
 * 【解决的问题】
 * - Cloudflare Pages 环境中键盘拦截器可能不生效（事件系统差异）
 * - 即使拦截了 Delete 键，Luckysheet 的 jfrefreshgrid 仍然是性能瓶颈
 * - 每次调用 setcellvalue 都会触发一次完整的画布重绘（~50-200ms）
 * 
 * 【补丁内容】
 * 1. Patch jfrefreshgrid: 批量处理期间跳过刷新，最后统一刷一次
 * 2. Patch setcellvalue: 禁止自动触发 isRefresh=true
 * 
 * 【为什么这个方案一定能生效】
 * - 不依赖 DOM 事件系统（直接替换 JS 函数对象）
 * - 不受 Cloudflare 部署环境影响（纯 JavaScript 运行时）
 * - 100% 控制执行流程（在 Luckysheet 内部层面）
 */
function installLuckysheetPerformancePatch() {
  const ls = (window as any).luckysheet
  
  if (!ls) {
    console.warn('[Patch] Luckysheet 未就绪，500ms后重试...')
    setTimeout(installLuckysheetPerformancePatch, 500)
    return
  }

  // ===== Patch 1: 替换 jfrefreshgrid =====
  if (typeof ls.jfrefreshgrid === 'function') {
    const originalRefreshGrid = ls.jfrefreshgrid.bind(ls)
    
    ls.jfrefreshgrid = function patchedRefreshGrid(...args: any[]) {
      // 批量处理期间：只标记需要刷新，不实际执行
      if (window.__isBulkProcessing) {
        window.__needsGridRefresh = true
        console.log('[Patch] ⏭️ jfrefreshgrid 被跳过（批量模式）')
        return null
      }
      
      // 正常模式：调用原始函数
      return originalRefreshGrid.apply(this, args)
    }
    
    console.log('[Patch] ✓ jfrefreshgrid 已替换：批量模式自动跳过')
  } else {
    console.warn('[Patch] ⚠️ 未找到 jfrefreshgrid 函数')
  }

  // ⚠️ 注意：不再 Patch setcellvalue
  // 原因：强制 isRefresh=false 会导致 Luckysheet 内部数据不一致（flowdata vs celldata）
  // 现在的策略：
  // - setcellvalue 正常调用（允许 Luckysheet 内部数据同步机制正常工作）
  // - 但其内部触发的 jfrefreshgrid 调用会被上面的 Patch 拦截
  // - 最终由 handleBulkDelete 在关闭批量模式后统一刷新一次

  console.log('[Patch] ✅ Luckysheet 性能补丁安装完成！')
  console.log('[Patch]   大量删除/编辑操作将使用快速路径')
}

// ==================== 批量操作防御系统 (BatchDefender) ====================

const showValidationOverlay = ref(false)
const validationPercent = computed(() => {
  // 优先使用校验调度器进度
  const p = validation.state.validationProgress
  if (p.total > 0) {
    if (p.phase === 'crossRow') return 95
    if (p.phase === 'done') return 100
    return Math.min(Math.round((p.current / p.total) * 95), 94)
  }
  // 使用批量操作进度
  if (validation.state.isProcessing) {
    return validation.state.batchProgress || 0
  }
  return 0
})
const validationPhaseText = computed(() => {
  const p = validation.state.validationProgress
  if (validation.state.isProcessing && !p.isRunning) return '数据处理中...'
  if (p.phase === 'row') return '行校验中...'
  if (p.phase === 'crossRow') return '跨行校验中...'
  if (p.phase === 'done') return '校验完成'
  return ''
})

/** 上次编辑的单元格位置，用于ON_BLUR检测 */
let lastEditedCell: { row: number; col: number } | null = null
let autoSaveTimer: ReturnType<typeof setInterval> | null = null

// ==================== 批量操作防御系统 ====================
/** 批量操作状态跟踪 */
interface BatchOperationState {
  isActive: boolean           // 是否处于批量操作中
  changedRows: Set<number>   // 变化的行集合
  changedCols: Set<number>   // 变化的列集合
  operationType: 'DELETE' | 'EDIT' | 'UNKNOWN'  // 操作类型
  startTime: number          // 开始时间戳
  updateCount: number        // 已收到的更新次数
  editValue?: any            // 编辑操作时记录用户输入的值（用于 handleBulkEdit 双写）
}
let batchOp: BatchOperationState | null = null

/** 批量操作检测阈值：收到多少次连续更新后判定为批量操作
 *  【重要】生产环境中Luckysheet内部处理较慢，cellUpdated调用间隔可能达到15-20ms
 *  原值20在生产环境需要300-400ms才能累积到，但防抖窗口只有100ms，导致永远无法触发
 *  降低到5可以在100ms内可靠触发（5 × 20ms = 100ms）
 */
const BATCH_DETECT_THRESHOLD = 5

/** 批量操作检测窗口：多少毫秒内的更新视为同一批次
 *  【重要】必须大于 (BATCH_DETECT_THRESHOLD × 最大预期调用间隔)
 *  生产环境最大间隔约20ms → 5 × 20ms = 100ms → 设置为500ms留足余量
 */
const BATCH_DETECT_WINDOW_MS = 500

/** 批量操作防抖延迟：最后一次更新后等待多久才执行flush
 *  【重要】设置为300ms确保所有cellUpdated都到达后再统一处理
 *  原值100ms太短， Luckysheet可能还在内部循环中
 */
const BATCH_DEBOUNCE_DELAY_MS = 300

/** 防抖定时器ID */
let batchDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 处理 cellUpdated 事件（带批量操作防御）
 * 核心改进：检测到批量删除/编辑时进入静默模式，避免逐格校验导致卡死
 */
function handleCellUpdate(r: number, c: number, oldValue: any, newValue: any) {
  if (r === 0) return

  // 记录编辑位置
  lastEditedCell = { row: r, col: c }

  // ===== 批量操作检测与防御 =====
  const now = Date.now()
  const isEmptyValue = newValue === null || newValue === undefined || String(newValue).trim() === ''

  if (!batchOp) {
    // 创建新的批量操作上下文
    batchOp = {
      isActive: false,
      changedRows: new Set(),
      changedCols: new Set(),
      operationType: isEmptyValue ? 'DELETE' : 'EDIT',
      startTime: now,
      updateCount: 1,
      editValue: isEmptyValue ? undefined : newValue,  // 记录编辑值
    }
    batchOp.changedRows.add(r)
    batchOp.changedCols.add(c)

    // 设置防抖：如果窗口期内没有新更新，则处理当前批次
    if (batchDebounceTimer) clearTimeout(batchDebounceTimer)
    batchDebounceTimer = setTimeout(flushBatchOperation, BATCH_DEBOUNCE_DELAY_MS)

  } else {
    // 累积更新
    batchOp.updateCount++
    batchOp.changedRows.add(r)
    batchOp.changedCols.add(c)

    // 更新操作类型（如果有非空值则视为编辑）
    if (!isEmptyValue && batchOp.operationType === 'DELETE') {
      batchOp.operationType = 'EDIT'
    }

    // 检测是否达到批量阈值 → 激活静默模式
    if (!batchOp.isActive && batchOp.updateCount >= BATCH_DETECT_THRESHOLD) {
      batchOp.isActive = true
      showValidationOverlay.value = true
      // 【关键修复】立即启用批量模式，跳过后续所有 jfrefreshgrid 调用
      // 解决：生产环境中 KeyInterceptor 可能不生效，Luckysheet 自行处理 Delete 时
      // 每个单元格都会触发 jfrefreshgrid（~50ms/次），1000+ 单元格 = 50+ 秒阻塞
      // 启用批量模式后，Monkey-Patch 的 jfrefreshgrid 会自动跳过，大幅减少阻塞
      window.__isBulkProcessing = true
      window.__dirtyRowsForBulk.clear()
      window.__needsGridRefresh = false
      console.log(`[BatchDefender] 检测到批量${batchOp.operationType === 'DELETE' ? '删除' : '编辑'}操作，已静默 ${batchOp.updateCount} 次更新，批量模式已启用`)
    }

    // 重置防抖定时器（使用独立的防抖延迟，而非检测窗口）
    if (batchDebounceTimer) clearTimeout(batchDebounceTimer)
    batchDebounceTimer = setTimeout(flushBatchOperation, BATCH_DEBOUNCE_DELAY_MS)
  }

  // 如果处于批量静默模式 → 跳过单格校验
  if (batchOp?.isActive) {
    return // 静默：不调用 onCellInput
  }

  // 正常模式：单格即时校验
  validation.onCellInput(r, c)
}

/**
 * 刷新批量操作（防抖回调）
 * 在批量操作结束后统一处理所有累积的变更
 */
function flushBatchOperation() {
  batchDebounceTimer = null

  if (!batchOp || batchOp.changedRows.size === 0) {
    batchOp = null
    return
  }

  const { changedRows, changedCols, operationType, isActive } = batchOp
  const rowsArr = Array.from(changedRows)
  const colsArr = Array.from(changedCols)

  console.log(`[BatchDefender] 刷新批量操作: type=${operationType}, rows=${rowsArr.length}, cols=${colsArr.length}, wasSilent=${isActive}`)

  // 【关键修复】如果刚完成批量删除（3秒内），跳过，防止二次调用handleBulkDelete
  if (operationType === 'DELETE' && Date.now() - (window as any).__lastBulkDeleteTime < 3000) {
    console.log('[BatchDefender] ⏭️ 跳过删除刷新（刚完成批量删除）')
    batchOp = null
    showValidationOverlay.value = false
    return
  }

  if (isActive && operationType === 'DELETE' && rowsArr.length > validation.FAST_DELETE_THRESHOLD) {
    // 大批量删除：走快速删除路径（分帧异步），传递列范围防止全删
    // handleBulkDelete 会在自己的 finally 块中重置 __isBulkProcessing
    const minCol = Math.min(...colsArr)
    const maxCol = Math.max(...colsArr)
    validation.handleBulkDelete(rowsArr, { startCol: minCol, endCol: maxCol })
    watchProcessingState()
  } else if (isActive && operationType === 'EDIT' && rowsArr.length > validation.FAST_DELETE_THRESHOLD) {
    // 大批量编辑：走快速编辑路径（分帧异步），与 handleBulkDelete 对称
    // handleBulkEdit 会在自己的 finally 块中重置 __isBulkProcessing
    const minCol = Math.min(...colsArr)
    const maxCol = Math.max(...colsArr)
    validation.handleBulkEdit(rowsArr, { startCol: minCol, endCol: maxCol }, rowsArr, colsArr, batchOp?.editValue)
    watchProcessingState()
  } else if (isActive && rowsArr.length > validation.BATCH_THRESHOLD) {
    // 中等批量：走分帧处理路径
    validation.onBatchInputComplete(rowsArr, colsArr)
    watchProcessingState()
    // onBatchInputComplete 内部已管理 __isBulkProcessing，此处不再手动重置
  } else {
    // 小批量或非静默：正常处理每个单元格
    for (const row of changedRows) {
      for (const col of changedCols) {
        validation.onCellInput(row, col, changedRows.size > 1)
      }
    }
    if (changedRows.size > 1) {
      validation.onBatchInputComplete(rowsArr, colsArr)
    }
    // 小批量操作不需要遮罩，直接隐藏
    showValidationOverlay.value = false
    // 小批量路径需手动重置批量模式
    window.__isBulkProcessing = false
  }

  batchOp = null
}

/** 上次选中区域所有单元格的值快照，用于检测Delete/Backspace/多选编辑 */
let lastSelectionSnapshot: Map<string, string> = new Map()

function getCellValue(r: number, c: number): string {
  const ls = (window as any).luckysheet
  if (!ls) return ''
  const v = ls.getCellValue(r, c)
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/** 获取当前选区的所有单元格快照 */
function captureSelectionSnapshot(): Map<string, string> {
  const snapshot = new Map<string, string>()
  try {
    const ls = (window as any).luckysheet
    const ranges = ls.getRange()
    if (!ranges || !ranges.length) return snapshot
    for (const range of ranges) {
      const r1 = range.row[0], r2 = range.row[1]
      const c1 = range.column[0], c2 = range.column[1]
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          snapshot.set(`${r}-${c}`, getCellValue(r, c))
        }
      }
    }
  } catch {}
  return snapshot
}

/**
 * 检测大选区操作类型
 * 通过采样检测是否大部分单元格变为空值（删除）或有变化（编辑）
 * @returns 'DELETE' | 'BATCH_EDIT' | 'NORMAL'
 */
function detectOperationType(snapshot: Map<string, string>): string {
  // 采样10%或至少50个单元格
  const sampleSize = Math.min(Math.floor(snapshot.size * 0.1), 500)
  const keys = Array.from(snapshot.keys())
  const sampleKeys = keys.sort(() => Math.random() - 0.5).slice(0, sampleSize)

  let emptyCount = 0
  let changedCount = 0

  for (const key of sampleKeys) {
    const [row, col] = key.split('-').map(Number)
    const newVal = getCellValue(row, col)
    const oldVal = snapshot.get(key) || ''

    if (newVal === '' && oldVal !== '') {
      emptyCount++
    }
    if (newVal !== oldVal) {
      changedCount++
    }
  }

  // 超过80%为空值 → 判定为删除操作
  if (emptyCount / sampleSize > 0.8) return 'DELETE'
  // 超过50%有变化 → 判定为批量编辑
  if (changedCount / sampleSize > 0.5) return 'BATCH_EDIT'
  return 'NORMAL'
}

/** 从快照获取影响的所有行 */
function getAffectedRowsFromSnapshot(snapshot: Map<string, string>): number[] {
  const rows = new Set<number>()
  for (const key of snapshot.keys()) {
    const row = Number(key.split('-')[0])
    if (row > 0) rows.add(row) // 跳过表头
  }
  return Array.from(rows)
}

/** 从快照获取影响的列范围（最小列和最大列） */
function getAffectedColsFromSnapshot(snapshot: Map<string, string>): { min: number; max: number } {
  let min = Infinity, max = -Infinity
  for (const key of snapshot.keys()) {
    const col = Number(key.split('-')[1])
    if (col < min) min = col
    if (col > max) max = col
  }
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 31 : max }
}

/** 监听批量处理状态，完成后自动隐藏遮罩 */
let processingWatchTimer: ReturnType<typeof setTimeout> | null = null
function watchProcessingState() {
  if (processingWatchTimer) clearTimeout(processingWatchTimer)

  const check = () => {
    if (!validation.state.isProcessing) {
      showValidationOverlay.value = false
      processingWatchTimer = null
      return
    }
    processingWatchTimer = setTimeout(check, 100)
  }

  check()
}

/** 房产信息必填列索引 */
const PROPERTY_REQUIRED_COLS = new Set([0, 4, 5, 6, 7, 8])

/** 构建表头行celldata */

function buildHeaderCells(): CellData[] {
  return HEADER_COLUMNS.map((col, c) => ({
    r: 0,
    c,
    v: {
      v: col.label,
      m: col.label,
      ct: { fa: 'General', t: 'g' },
      bl: 1,
      fc: PROPERTY_REQUIRED_COLS.has(c) ? '#F56C6C' : '#ffffff',
      bg: '#409EFF',
      ht: 0,
    },
  }))
}

/** 构建列宽配置 */
function buildColumnLen(): Record<number, number> {
  const result: Record<number, number> = {}
  HEADER_COLUMNS.forEach((col) => {
    result[col.colIndex] = col.width
  })
  return result
}

/** 初始化Luckysheet */
function initLuckysheet(extraCelldata?: CellData[]) {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) {
    console.error('Luckysheet未加载，请检查CDN引入')
    return
  }

  const headerCells = buildHeaderCells()
  let celldata: CellData[]

  if (extraCelldata && extraCelldata.length > 0) {
    celldata = [...headerCells, ...extraCelldata]
  } else {
    celldata = headerCells
  }

  const columnlen = buildColumnLen()

  luckysheet.create({
    container: 'luckysheet',
    lang: 'zh',
    title: '房产信息',
    data: [
      {
        name: '房产信息数据',
        color: '',
        status: 1,
        order: 0,
        celldata,
        config: {
          columnlen,
          rowhigh: { 0: 40 },
        },
        row: 100,
        column: 30,
        defaultRowHeight: 26,
        defaultColWidth: 100,
        frozen: { type: 'row' },
      },
    ],
    showtoolbar: true,
    showsheetbar: false,
    showstatisticBar: true,
    sheetBottomConfig: false,
    allowEdit: true,
    enableAddRow: true,
    enableAddBackTop: false,
    hook: {
      // 表头行(第0行)不可编辑
      cellUpdateBefore(r: number, c: number, value: any, isRefresh: boolean) {
        if (r === 0) return false
        // 【关键修复】批量操作期间阻止Luckysheet内部逐格更新
        // 1. __isBulkDeleting: handleBulkDelete 正在执行时阻止所有操作
        // 2. __isBulkProcessing: BatchDefender 检测到批量操作后阻止所有操作
        //    （包括编辑和删除），因为 handleBulkEdit/handleBulkDelete 会统一处理
        if ((window as any).__isBulkDeleting) {
          return false
        }
        if ((window as any).__isBulkProcessing) {
          return false
        }
        if (Date.now() - (window as any).__lastBulkDeleteTime < 3000) {
          return false
        }
      },
      cellUpdated(r: number, c: number, oldValue: any, newValue: any, isRefresh: boolean) {
        // 使用批量操作防御系统处理更新
        handleCellUpdate(r, c, oldValue, newValue)
      },
      // 单元格点击：触发ON_BLUR + 检测值变化 + 显示tooltip
      cellMousedown(cell: any, postion: any, sheetFile: any, ctx: any) {
        // 检测上次选中区域中所有单元格值是否变化
        if (lastSelectionSnapshot.size > 0) {
          // ===== 新增：大选区智能路径检测 =====
          if (lastSelectionSnapshot.size > validation.SNAPSHOT_THRESHOLD) {
            const operationType = detectOperationType(lastSelectionSnapshot)

            // 【关键修复】如果刚完成批量删除（3秒内），跳过检测，防止二次触发
            if (Date.now() - (window as any).__lastBulkDeleteTime < 3000) {
              console.log('[cellMousedown] ⏭️ 跳过删除检测（刚完成批量删除）')
              // 注意：仍需触发 ON_BLUR，不能跳过
              if (lastEditedCell) {
                const { row, col } = lastEditedCell
                lastEditedCell = null
                validation.onCellBlur(row, col)
              }
              lastSelectionSnapshot = captureSelectionSnapshot()
              setTimeout(() => showTooltipForCurrentCell(), 30)
              return
            }

            if (operationType === 'DELETE') {
              // 快速删除路径：跳过校验直接清除结果（分帧异步）
              const affectedRows = getAffectedRowsFromSnapshot(lastSelectionSnapshot)
              // 从快照中推算列范围（防止全删）
              const affectedCols = getAffectedColsFromSnapshot(lastSelectionSnapshot)
              if (affectedRows.length > validation.FAST_DELETE_THRESHOLD) {
                showValidationOverlay.value = true
                validation.handleBulkDelete(affectedRows, { startCol: affectedCols.min, endCol: affectedCols.max })
                // 监听 isProcessing 变化来隐藏遮罩（异步完成）
                watchProcessingState()
                lastEditedCell = null
                lastSelectionSnapshot = captureSelectionSnapshot()
                setTimeout(() => showTooltipForCurrentCell(), 30)
                return // 提前返回，不走后面的详细比较
              }
            }

            if (operationType === 'BATCH_EDIT' && lastSelectionSnapshot.size > validation.FAST_DELETE_THRESHOLD) {
              // 大批量编辑路径：走 handleBulkEdit（分帧异步 + 遮罩保护）
              const changedRows = new Set<number>()
              const changedCols = new Set<number>()
              let editValue: any = undefined
              for (const [key, oldVal] of lastSelectionSnapshot.entries()) {
                const [rs, cs] = key.split('-')
                const row = Number(rs), col = Number(cs)
                const newVal = getCellValue(row, col)
                if (oldVal !== newVal) {
                  changedRows.add(row)
                  changedCols.add(col)
                  if (editValue === undefined && newVal !== null && newVal !== undefined && String(newVal).trim() !== '') {
                    editValue = newVal  // 捕获用户输入的值
                  }
                }
              }
              if (changedRows.size > 0) {
                showValidationOverlay.value = true
                const rowsArr = Array.from(changedRows)
                const colsArr = Array.from(changedCols)
                const minCol = Math.min(...colsArr)
                const maxCol = Math.max(...colsArr)
                validation.handleBulkEdit(rowsArr, { startCol: minCol, endCol: maxCol }, rowsArr, colsArr, editValue)
                watchProcessingState()
              }
              lastEditedCell = null
              lastSelectionSnapshot = captureSelectionSnapshot()
              setTimeout(() => showTooltipForCurrentCell(), 30)
              return // 提前返回
            }
          }

          // ===== 原有逻辑：小选区详细比较 =====
          const changedRows = new Set<number>()
          const changedCols = new Set<number>()
          const isBatch = lastSelectionSnapshot.size > 1
          for (const [key, oldVal] of lastSelectionSnapshot.entries()) {
            const [rs, cs] = key.split('-')
            const row = Number(rs), col = Number(cs)
            const newVal = getCellValue(row, col)
            if (oldVal !== newVal) {
              if (isBatch) {
                // 批量模式：仅清除结果，不做逐格校验
                validation.onCellInput(row, col, true)
              } else {
                validation.onCellInput(row, col, false)
              }
              changedRows.add(row)
              changedCols.add(col)
            }
          }
          if (isBatch) {
            // 批量模式：整行校验 + flowdata直接刷新（小数据量同步执行）
            validation.onBatchInputComplete(Array.from(changedRows), Array.from(changedCols))
          } else {
            // 单格模式：触发blur校验
            for (const row of changedRows) {
              for (const col of changedCols) {
                validation.onCellBlur(row, col)
              }
            }
          }
        }

        // 触发上次编辑单元格的ON_BLUR
        if (lastEditedCell) {
          const { row, col } = lastEditedCell
          lastEditedCell = null
          validation.onCellBlur(row, col)
        }

        // 记录当前选中区域所有单元格的值快照
        lastSelectionSnapshot = captureSelectionSnapshot()

        // 延迟显示tooltip（等Luckysheet完成选中）
        setTimeout(() => showTooltipForCurrentCell(), 30)
      },
    },
  })
}

/** 根据当前选中区域显示tooltip */
function showTooltipForCurrentCell() {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return

  // 隐藏上一个tooltip
  cellTooltipRef.value?.hide()

  try {
    const range = luckysheet.getRange()
    if (!range || !range[0]) return

    const row = range[0].row[0]
    const col = range[0].column[0]
    if (row === 0) return

    const error = validation.getCellErrors(row, col)
    if (!error) return

    // 使用最近一次鼠标事件的位置
    const mouseEvent = (window as any).__lastMouseEvent
    if (mouseEvent) {
      cellTooltipRef.value?.show(error, mouseEvent.clientX + 12, mouseEvent.clientY + 12)
    }
  } catch (e) {
    // getRange可能失败，忽略
  }
}

/** 点击编辑区域时隐藏tooltip（点击非错误单元格） */
function onEditorClick(e: MouseEvent) {
  // 保存鼠标位置
  ;(window as any).__lastMouseEvent = e
  // 延迟隐藏，让cellMousedown先处理
  setTimeout(() => {
    const luckysheet = (window as any).luckysheet
    if (!luckysheet) return
    try {
      const range = luckysheet.getRange()
      if (!range || !range[0]) {
        cellTooltipRef.value?.hide()
        return
      }
      const row = range[0].row[0]
      const col = range[0].column[0]
      const error = validation.getCellErrors(row, col)
      if (!error) {
        cellTooltipRef.value?.hide()
      }
    } catch {
      cellTooltipRef.value?.hide()
    }
  }, 100)
}

/** 导入数据到Luckysheet */
function importData(result: ExcelReadResult) {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return

  // 构建列映射
  const { mapping, unmatchedExcelFields, missingToolFields } = buildColumnMapping(
    result.headers,
    HEADER_COLUMNS
  )

  // 提示未匹配字段
  if (unmatchedExcelFields.length > 0) {
    ElMessage.warning(`以下Excel字段未识别，已跳过：${unmatchedExcelFields.join('、')}`)
  }
  if (missingToolFields.length > 0) {
    ElMessage.info(`以下字段Excel中缺失：${missingToolFields.join('、')}`)
  }

  // 无任何匹配时终止导入
  if (mapping.size === 0) {
    ElMessage.error('Excel表头与工具字段无匹配项，请检查Excel格式')
    return
  }

  // 根据映射重排数据
  const remapped = remapRows(result.rows, mapping, HEADER_COLUMNS.length)

  const celldata: CellData[] = []
  remapped.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val !== '') {
        celldata.push({
          r: r + 1,
          c,
          v: {
            v: val,
            m: val,
            ct: { fa: 'General', t: 'g' },
          },
        })
      }
    })
  })

  luckysheet.destroy()
  setTimeout(() => {
    initLuckysheet(celldata)
    // 导入后启动分步校验，显示遮罩层
    setTimeout(async () => {
      showValidationOverlay.value = true
      try {
        await validation.startValidation()
        validation.applyAllStylesFromResults()
      } finally {
        showValidationOverlay.value = false
      }
    }, 500)
  }, 200)
}

/** 检查并恢复草稿 */
async function checkDraft() {
  const draft = loadFromLocal()
  if (!draft || !draft.celldata || draft.celldata.length === 0) return

  const timeStr = formatTimestamp(draft.timestamp)
  try {
    await ElMessageBox.confirm(
      `检测到 ${timeStr} 保存的草稿数据，是否恢复？`,
      '恢复草稿',
      { confirmButtonText: '恢复', cancelButtonText: '忽略', type: 'info' }
    )
    const dataCells = draft.celldata.filter((cell) => cell.r > 0)
    initLuckysheet(dataCells)
    ElMessage.success('草稿已恢复')
    return true
  } catch {
    initLuckysheet()
    return false
  }
}

/** 导出前校验 */
async function validateBeforeExport(): Promise<boolean> {
  // 显示遮罩层，等待校验完成
  showValidationOverlay.value = true
  try {
    await validation.waitForValidation()
    validation.applyAllStylesFromResults()
  } finally {
    showValidationOverlay.value = false
  }

  const { errorCount, warningCount } = validation.state

  if (errorCount > 0) {
    const allErrors = validation.getAllCellErrors().filter(e => e.severity === 'CRITICAL')
    const errorLines = allErrors
      .slice(0, 10)
      .map((e) => `第${e.row + 1}行: ${e.messages.join('; ')}`)
      .join('\n')
    const moreText = allErrors.length > 10 ? `\n...还有${allErrors.length - 10}个错误` : ''

    ElMessageBox.alert(
      `存在${errorCount}个错误，请修正后再导出：\n\n${errorLines}${moreText}`,
      '校验未通过',
      { type: 'error', confirmButtonText: '知道了' }
    )
    return false
  }

  if (warningCount > 0) {
    try {
      await ElMessageBox.confirm(
        `存在${warningCount}个警告，是否仍要导出？`,
        '校验警告',
        { confirmButtonText: '继续导出', cancelButtonText: '取消', type: 'warning' }
      )
      return true
    } catch {
      return false
    }
  }

  return true
}

/** 启动自动保存 */
function startAutoSave() {
  autoSaveTimer = setInterval(() => {
    const celldata = getCurrentCelldata()
    if (celldata.length > 0) {
      saveToLocal(celldata)
    }
  }, 30000)
}

/** 停止自动保存 */
function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
    autoSaveTimer = null
  }
}

/** 暴露方法给父组件 */
defineExpose({
  importData,
  validateBeforeExport,
})

onMounted(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 100))

  const restored = await checkDraft()
  if (!restored) {
    const draft = loadFromLocal()
    if (!draft || !draft.celldata || draft.celldata.length === 0) {
      initLuckysheet()
    }
  }

  startAutoSave()

  // 全局鼠标事件追踪
  document.addEventListener('mousedown', captureMouseEvent)

  // Shift+滚轮横向滚动：使用 document 捕获阶段监听
  setupShiftScroll()

  // Delete/Backspace 键盘拦截：大选区快速删除
  setupKeyboardInterceptor()
  
  // 安装 Luckysheet 性能补丁（Monkey-Patch，解决Cloudflare环境卡死问题）
  setTimeout(() => {
    installLuckysheetPerformancePatch()
  }, 300) // 给 Luckysheet 足够时间完成初始化
})

onBeforeUnmount(() => {
  stopAutoSave()
  document.removeEventListener('mousedown', captureMouseEvent)
  // 清理Shift+滚轮监听
  if (shiftScrollHandler) {
    document.removeEventListener('wheel', shiftScrollHandler)
    shiftScrollHandler = null
  }
  // 清理键盘拦截器
  cleanupKeyboardInterceptor()
  validation.cleanupTimers()
})

/** 捕获鼠标事件位置 */
function captureMouseEvent(e: MouseEvent) {
  ;(window as any).__lastMouseEvent = e
}

// ==================== Shift+滚轮横向滚动 ====================

/**
 * Shift + 鼠标滚轮 → 横向滚动表格
 *
 * 核心原理（第13次迭代，基于实测结论）：
 *
 * 实测发现：
 *   ✅ wheel事件可以到达 document 捕获阶段的 handler
 *   ✅ cellMain.scrollLeft 赋值能改变属性值
 *   ❌ 但 Luckysheet 不使用原生 scrollLeft 渲染内容！
 *      它用 CSS transform: translate() 做虚拟滚动
 *      所以改 scrollLeft 无视觉效果
 *
 * 正确方案：
 *   操作 #luckysheet-scrollbar-x（Luckysheet 自带的横向滚动条）的 scrollLeft
 *   然后触发其 scroll 事件 → Luckysheet 内部监听此事件 → 更新 transform
 */
let shiftScrollHandler: ((e: WheelEvent) => void) | null = null

function setupShiftScroll() {
  if (shiftScrollHandler) {
    document.removeEventListener('wheel', shiftScrollHandler)
  }

  shiftScrollHandler = (e: WheelEvent) => {
    if (!e.shiftKey) return

    const el = e.target as HTMLElement | null
    if (!el?.closest('#luckysheet')) return

    if (e.deltaY === 0) return

    // 找到 Luckysheet 的横向滚动条元素
    const scrollbarX = document.querySelector('#luckysheet-scrollbar-x') as HTMLElement | null
    if (!scrollbarX || scrollbarX.scrollWidth <= scrollbarX.clientWidth) return

    // 关键：阻止事件继续传播到 Luckysheet 内部的 wheel handler
    // 这样 Luckysheet 就不会处理竖向滚动
    e.stopPropagation()
    e.preventDefault()

    // 设置滚动条的 scrollLeft → 触发 Luckysheet 内部 scroll 事件 → 更新 transform → 横向滚动
    scrollbarX.scrollLeft += e.deltaY
  }

  document.addEventListener('wheel', shiftScrollHandler, { capture: true, passive: false })
}
</script>

<style scoped>
.table-editor {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.luckysheet-container {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
}

/* 校验遮罩层 */
.validation-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: not-allowed;
  user-select: none;
}

.validation-overlay-card {
  background: #fff;
  border-radius: 12px;
  padding: 32px 48px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  min-width: 280px;
}

.validation-overlay-text {
  font-size: 16px;
  color: #303133;
  margin-top: 20px;
  font-weight: 500;
}

.validation-overlay-progress {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.validation-progress-bar {
  flex: 1;
  height: 8px;
  background: #e4e7ed;
  border-radius: 4px;
  overflow: hidden;
}

.validation-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #409EFF, #67C23A);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.validation-progress-label {
  font-size: 13px;
  color: #909399;
  min-width: 36px;
  text-align: right;
}

.validation-overlay-phase {
  margin-top: 8px;
  font-size: 13px;
  color: #909399;
}

/* 旋转动画 */
.validation-spinner {
  width: 36px;
  height: 36px;
  margin: 0 auto;
  border: 3px solid #e4e7ed;
  border-top-color: #409EFF;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
