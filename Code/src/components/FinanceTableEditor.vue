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
import { FINANCE_HEADER_COLUMNS, FINANCE_AUTO_SAVE_KEY, FINANCE_HEADER_ROW_COUNT, FINANCE_HEADER_ROWS, FINANCE_REQUIRED_COLUMNS, type FinanceHeaderColumn } from '../engine/finance/types'
import type { CellData, HeaderColumn } from '../types'
import { getCurrentCelldata, saveToLocal, loadFromLocal, formatTimestamp } from '../utils/autoSave'
import { buildColumnMapping, remapRows, type ExcelReadResult } from '../utils/excelIO'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useFinanceValidationStore } from '../engine/finance/validationStore'
import CellTooltip from './CellTooltip.vue'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'

const cellTooltipRef = ref<InstanceType<typeof CellTooltip> | null>(null)
const validation = useFinanceValidationStore()

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
      e.preventDefault()
      e.stopPropagation()

      console.log(`[KeyInterceptor] 拦截${e.key}键，选中${totalRows}行，使用快速删除路径`)

      // 收集所有受影响的行
      const affectedRows: number[] = []
      for (const range of ranges) {
        for (let r = range.row[0]; r <= range.row[1]; r++) {
          affectedRows.push(r)
        }
      }

      // 显示遮罩层
      showValidationOverlay.value = true

      // 使用分帧异步快速删除
      validation.handleBulkDelete(affectedRows)

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

let lastEditedCell: { row: number; col: number } | null = null
let autoSaveTimer: ReturnType<typeof setInterval> | null = null

// ==================== 批量操作防御系统 ====================
/** 批量操作状态跟踪 */
interface BatchOperationState {
  isActive: boolean
  changedRows: Set<number>
  changedCols: Set<number>
  operationType: 'DELETE' | 'EDIT' | 'UNKNOWN'
  startTime: number
  updateCount: number
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
let batchDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 处理 cellUpdated 事件（带批量操作防御）
 */
function handleCellUpdate(r: number, c: number, oldValue: any, newValue: any) {
  if (r === 0) return
  lastEditedCell = { row: r, col: c }

  const now = Date.now()
  const isEmptyValue = newValue === null || newValue === undefined || String(newValue).trim() === ''

  if (!batchOp) {
    batchOp = {
      isActive: false,
      changedRows: new Set(),
      changedCols: new Set(),
      operationType: isEmptyValue ? 'DELETE' : 'EDIT',
      startTime: now,
      updateCount: 1,
    }
    batchOp.changedRows.add(r)
    batchOp.changedCols.add(c)
    if (batchDebounceTimer) clearTimeout(batchDebounceTimer)
    batchDebounceTimer = setTimeout(flushBatchOperation, BATCH_DEBOUNCE_DELAY_MS)
  } else {
    batchOp.updateCount++
    batchOp.changedRows.add(r)
    batchOp.changedCols.add(c)
    if (!isEmptyValue && batchOp.operationType === 'DELETE') {
      batchOp.operationType = 'EDIT'
    }
    if (!batchOp.isActive && batchOp.updateCount >= BATCH_DETECT_THRESHOLD) {
      batchOp.isActive = true
      showValidationOverlay.value = true
      console.log(`[BatchDefender] 检测到批量${batchOp.operationType === 'DELETE' ? '删除' : '编辑'}操作`)
    }
    if (batchDebounceTimer) clearTimeout(batchDebounceTimer)
    batchDebounceTimer = setTimeout(flushBatchOperation, BATCH_DEBOUNCE_DELAY_MS)
  }

  if (batchOp?.isActive) return
  validation.onCellInput(r, c)
}

function flushBatchOperation() {
  batchDebounceTimer = null
  if (!batchOp || batchOp.changedRows.size === 0) {
    batchOp = null
    return
  }

  const { changedRows, changedCols, operationType, isActive } = batchOp
  const rowsArr = Array.from(changedRows)
  const colsArr = Array.from(changedCols)

  console.log(`[BatchDefender] 刷新批量操作: type=${operationType}, rows=${rowsArr.length}`)

  if (isActive && operationType === 'DELETE' && rowsArr.length > validation.FAST_DELETE_THRESHOLD) {
    validation.handleBulkDelete(rowsArr)
    watchProcessingState()
  } else if (isActive && rowsArr.length > validation.BATCH_THRESHOLD) {
    validation.onBatchInputComplete(rowsArr, colsArr)
    watchProcessingState()
  } else {
    for (const row of changedRows) {
      for (const col of changedCols) {
        validation.onCellInput(row, col, changedRows.size > 1)
      }
    }
    if (changedRows.size > 1) {
      validation.onBatchInputComplete(rowsArr, colsArr)
    }
    showValidationOverlay.value = false
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
    if (row >= FINANCE_HEADER_ROW_COUNT) rows.add(row) // 跳过表头
  }
  return Array.from(rows)
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

/** 区域颜色配置：基本信息(蓝) / 应收(橙) / 已收(绿) */
const ZONE_COLORS: Record<string, { dark: string; light: string; mid: string }> = {
  basic: { dark: '#409EFF', light: '#ECF5FF', mid: '#D9ECFF' },
  recv:  { dark: '#E6A23C', light: '#FDF6EC', mid: '#FAE8D0' },
  paid:  { dark: '#67C23A', light: '#F0F9EB', mid: '#E1F3D8' },
}

function getZone(col: number) {
  if (col <= 2) return 'basic'
  if (col <= 12) return 'recv'
  return 'paid'
}

/** 应收已收必填列索引 */
const FINANCE_REQUIRED_COLS_SET = new Set(FINANCE_REQUIRED_COLUMNS)

/** 构建表头行celldata（4行：分类行 + 注意事项行 + 格式提示行 + 列名行） */

function buildHeaderCells(): CellData[] {
  const cells: CellData[] = []

  for (let r = 0; r < FINANCE_HEADER_ROW_COUNT; r++) {
    const rowData = FINANCE_HEADER_ROWS[r]

    for (let c = 0; c < rowData.length; c++) {
      const val = rowData[c]
      if (val === '') continue
      const zone = ZONE_COLORS[getZone(c)]

      let bg: string, fc: string, bl: number | undefined, ht: number | undefined, tb: number | undefined

      if (r === 0) {
        // 分类行：深色底 + 白字 + 居中加粗
        bg = zone.dark; fc = '#ffffff'; bl = 1; ht = 0
      } else if (r === 3) {
        // 列名行：中间色底 + 必填列红色字/非必填深色字 + 加粗
        bg = zone.mid; fc = FINANCE_REQUIRED_COLS_SET.has(c) ? '#F56C6C' : '#303133'; bl = 1
      } else {
        // 注意事项/格式提示行：浅色底 + 灰色字
        bg = zone.light; fc = r === 1 ? '#909399' : '#606266'; tb = r === 1 ? 1 : undefined
      }

      cells.push({
        r, c,
        v: {
          v: val, m: val,
          ct: { fa: 'General', t: 'g' },
          bl, fc, bg, ht, tb,
        },
      })
    }
  }
  return cells
}

/** 构建列宽配置 */
function buildColumnLen(): Record<number, number> {
  const result: Record<number, number> = {}
  FINANCE_HEADER_COLUMNS.forEach((col) => {
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
    title: '应收已收',
    data: [
      {
        name: '应收已收数据',
        color: '',
        status: 1,
        order: 0,
        celldata,
        config: {
          columnlen,
          rowhigh: { 0: 36, 1: 60, 2: 30, 3: 40 },
          merge: {
            // Row 0: 分类行合并
            '0_0': { r: 0, c: 0, rs: 1, cs: 3 },   // 基本信息 A-C
            '0_3': { r: 0, c: 3, rs: 1, cs: 10 },   // 应收 D-M
            '0_13': { r: 0, c: 13, rs: 1, cs: 5 },  // 已收 N-R
            // Row 1: 注意事项合并
            '1_3': { r: 1, c: 3, rs: 1, cs: 2 },    // 收费科目注意
            '1_5': { r: 1, c: 5, rs: 1, cs: 3 },    // 日期注意
            '1_8': { r: 1, c: 8, rs: 1, cs: 4 },    // 应收金额注意
          },
        },
        row: 100,
        column: 18,
        defaultRowHeight: 26,
        defaultColWidth: 100,
        frozen: { type: 'rangeRow', range: { row_focus: FINANCE_HEADER_ROW_COUNT - 1 } },
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
      cellUpdateBefore(r: number) {
        if (r < FINANCE_HEADER_ROW_COUNT) return false
      },
      cellUpdated(r: number, c: number) {
        if (r < FINANCE_HEADER_ROW_COUNT) return
        // 使用批量操作防御系统处理更新（内部会处理lastEditedCell和onCellInput）
        handleCellUpdate(r, c, null, null)
      },
      cellMousedown() {
        // 检测上次选中区域中所有单元格值是否变化
        if (lastSelectionSnapshot.size > 0) {
          // ===== 新增：大选区智能路径检测 =====
          if (lastSelectionSnapshot.size > validation.SNAPSHOT_THRESHOLD) {
            const operationType = detectOperationType(lastSelectionSnapshot)

            if (operationType === 'DELETE') {
              // 快速删除路径：跳过校验直接清除结果（分帧异步）
              const affectedRows = getAffectedRowsFromSnapshot(lastSelectionSnapshot)
              if (affectedRows.length > validation.FAST_DELETE_THRESHOLD) {
                showValidationOverlay.value = true
                validation.handleBulkDelete(affectedRows)
                // 监听 isProcessing 变化来隐藏遮罩（异步完成）
                watchProcessingState()
                lastEditedCell = null
                lastSelectionSnapshot = captureSelectionSnapshot()
                setTimeout(() => showTooltipForCurrentCell(), 30)
                return // 提前返回，不走后面的详细比较
              }
            }

            if (operationType === 'BATCH_EDIT' && lastSelectionSnapshot.size > validation.FAST_DELETE_THRESHOLD) {
              // 大批量编辑路径：分帧处理 + 遮罩保护
              const changedRows = new Set<number>()
              const changedCols = new Set<number>()
              for (const [key, oldVal] of lastSelectionSnapshot.entries()) {
                const [rs, cs] = key.split('-')
                const row = Number(rs), col = Number(cs)
                const newVal = getCellValue(row, col)
                if (oldVal !== newVal) {
                  validation.onCellInput(row, col, true) // 批量模式清除结果
                  changedRows.add(row)
                  changedCols.add(col)
                }
              }
              if (changedRows.size > 0) {
                showValidationOverlay.value = true
                // onBatchInputComplete 内部会自动设置 isProcessing 并更新 batchProgress
                validation.onBatchInputComplete(Array.from(changedRows), Array.from(changedCols))
                // 监听 isProcessing 变化来隐藏遮罩
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
            for (const row of changedRows) {
              for (const col of changedCols) {
                validation.onCellBlur(row, col)
              }
            }
          }
        }

        if (lastEditedCell) {
          const { row, col } = lastEditedCell
          lastEditedCell = null
          validation.onCellBlur(row, col)
        }

        // 记录当前选中区域所有单元格的值快照
        lastSelectionSnapshot = captureSelectionSnapshot()

        setTimeout(() => showTooltipForCurrentCell(), 30)
      },
    },
  })
}

/** 根据当前选中区域显示tooltip */
function showTooltipForCurrentCell() {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return
  cellTooltipRef.value?.hide()
  try {
    const range = luckysheet.getRange()
    if (!range || !range[0]) return
    const row = range[0].row[0]
    const col = range[0].column[0]
    if (row < FINANCE_HEADER_ROW_COUNT) return
    const error = validation.getCellErrors(row, col)
    if (!error) return
    const mouseEvent = (window as any).__lastMouseEvent
    if (mouseEvent) {
      cellTooltipRef.value?.show(error, mouseEvent.clientX + 12, mouseEvent.clientY + 12)
    }
  } catch {
    // getRange可能失败，忽略
  }
}

/** 点击编辑区域时隐藏tooltip */
function onEditorClick(e: MouseEvent) {
  ;(window as any).__lastMouseEvent = e
  setTimeout(() => {
    const luckysheet = (window as any).luckysheet
    if (!luckysheet) return
    try {
      const range = luckysheet.getRange()
      if (!range || !range[0]) { cellTooltipRef.value?.hide(); return }
      const row = range[0].row[0]
      const col = range[0].column[0]
      const error = validation.getCellErrors(row, col)
      if (!error) cellTooltipRef.value?.hide()
    } catch {
      cellTooltipRef.value?.hide()
    }
  }, 100)
}

/** 导入数据到Luckysheet */
function importData(result: ExcelReadResult) {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return

  // 构建列映射（FINANCE_HEADER_COLUMNS 需要转为 HeaderColumn 兼容格式）
  const toolColumns: HeaderColumn[] = FINANCE_HEADER_COLUMNS.map(col => ({
    field: col.field,
    label: col.label,
    width: col.width,
    colIndex: col.colIndex,
  }))
  const { mapping, unmatchedExcelFields, missingToolFields } = buildColumnMapping(
    result.headers,
    toolColumns
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
  const remapped = remapRows(result.rows, mapping, FINANCE_HEADER_COLUMNS.length)

  const celldata: CellData[] = []
  remapped.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val !== '') {
        celldata.push({
          r: r + FINANCE_HEADER_ROW_COUNT,
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
  const raw = localStorage.getItem(FINANCE_AUTO_SAVE_KEY)
  if (!raw) return false
  try {
    const draft = JSON.parse(raw)
    if (!draft || !draft.celldata || draft.celldata.length === 0) return false

    const timeStr = formatTimestamp(draft.timestamp)
    try {
      await ElMessageBox.confirm(
        `检测到 ${timeStr} 保存的草稿数据，是否恢复？`,
        '恢复草稿',
        { confirmButtonText: '恢复', cancelButtonText: '忽略', type: 'info' }
      )
      const dataCells = draft.celldata.filter((cell: CellData) => cell.r >= FINANCE_HEADER_ROW_COUNT)
      initLuckysheet(dataCells)
      ElMessage.success('草稿已恢复')
      return true
    } catch {
      initLuckysheet()
      return false
    }
  } catch {
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

/** 导出Excel（使用exceljs保留表头样式） */
async function exportExcel() {
  const luckysheet = (window as any).luckysheet
  let flowdata: any[][] | null = null
  if (typeof luckysheet.getSheetData === 'function') flowdata = luckysheet.getSheetData()
  else if (typeof luckysheet.flowdata === 'function') flowdata = luckysheet.flowdata()
  if (!flowdata) return

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('应收已收数据')

  // 设置列宽
  ws.columns = FINANCE_HEADER_COLUMNS.map((col) => ({ width: col.width / 7 }))

  // 获取合并单元格配置
  const merges: Record<string, any> = {}
  try {
    const sheetConfig = luckysheet.getAllSheets?.()?.[0]?.config?.merge
    if (sheetConfig) Object.assign(merges, sheetConfig)
  } catch { /* 忽略 */ }

  // 颜色转换：#RRGGBB → FFAARRGG
  function toArgb(hex: string): string {
    if (!hex || hex.length < 7) return 'FF000000'
    return 'FF' + hex.slice(1).toUpperCase()
  }

  // 填充所有行
  for (let r = 0; r < flowdata.length; r++) {
    const isDataRow = r >= FINANCE_HEADER_ROW_COUNT
    let hasData = false
    const rowValues: any[] = []

    for (let c = 0; c < FINANCE_HEADER_COLUMNS.length; c++) {
      const cell = flowdata[r]?.[c]
      let val = ''
      if (cell && cell.v !== null && cell.v !== undefined) {
        val = String(cell.m || cell.v).trim()
        if (val) hasData = true
      }
      rowValues.push(val || null) // null = 空单元格
    }

    // 数据行跳过全空行
    if (isDataRow && !hasData) continue

    const excelRow = ws.addRow(rowValues)
    const excelRowIdx = excelRow.number // 1-based

    // 应用样式
    for (let c = 0; c < FINANCE_HEADER_COLUMNS.length; c++) {
      const excelCell = excelRow.getCell(c + 1) // 1-based
      const srcCell = flowdata[r]?.[c]

      if (!isDataRow && srcCell) {
        // 表头行：应用Luckysheet中的样式
        const bg = srcCell.bg || ZONE_COLORS[getZone(c)].light
        const fc = srcCell.fc || '#303133'
        const bl = srcCell.bl === 1
        const ht = srcCell.ht
        const tb = srcCell.tb

        excelCell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: toArgb(bg) },
        }
        excelCell.font = {
          color: { argb: toArgb(fc) },
          bold: bl,
          size: r === 1 || r === 2 ? 9 : 11,
        }
        const alignment: Partial<ExcelJS.Alignment> = { vertical: 'middle' }
        if (ht === 0) alignment.horizontal = 'center'
        if (tb === 1) alignment.wrapText = true
        excelCell.alignment = alignment
      }

      // 所有单元格加细边框
      excelCell.border = {
        top: { style: 'thin', color: { argb: 'FFD4D4D4' } },
        left: { style: 'thin', color: { argb: 'FFD4D4D4' } },
        bottom: { style: 'thin', color: { argb: 'FFD4D4D4' } },
        right: { style: 'thin', color: { argb: 'FFD4D4D4' } },
      }
    }

    // 设置表头行行高
    if (!isDataRow) {
      const heights: Record<number, number> = { 0: 28, 1: 48, 2: 24, 3: 32 }
      excelRow.height = heights[r] || 24
    }
  }

  // 应用合并单元格
  for (const key of Object.keys(merges)) {
    const m = merges[key]
    if (m && typeof m.r === 'number') {
      const startCell = ws.getCell(m.r + 1, m.c + 1)
      const endCell = ws.getCell(m.r + m.rs, m.c + m.cs)
      ws.mergeCells(Number(startCell.row), Number(startCell.col), Number(endCell.row), Number(endCell.col))
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  // 获取项目名称（取第一个非空的项目名称，col=0）
  let projectName = ''
  for (let r = FINANCE_HEADER_ROW_COUNT; r < flowdata.length; r++) {
    const cell = flowdata[r]?.[0]
    if (cell && cell.v !== null && cell.v !== undefined) {
      const val = String(cell.m || cell.v).trim()
      if (val) {
        projectName = val
        break
      }
    }
  }
  const prefix = projectName ? `${projectName}` : '应收已收数据'
  const fileName = `${prefix}应收已收数据_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`
  saveAs(new Blob([buffer], { type: 'application/octet-stream' }), fileName)
}

/** 自动保存（使用专用key） */
function startAutoSave() {
  autoSaveTimer = setInterval(() => {
    const celldata = getCurrentCelldata()
    if (celldata.length > 0) {
      try {
        localStorage.setItem(FINANCE_AUTO_SAVE_KEY, JSON.stringify({ timestamp: Date.now(), celldata }))
      } catch {
        // 忽略
      }
    }
  }, 30000)
}

function stopAutoSave() {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null }
}

defineExpose({ importData, validateBeforeExport, exportExcel })

// ==================== Shift+滚轮横向滚动 ====================
let shiftScrollHandler: ((e: WheelEvent) => void) | null = null

function setupShiftScroll() {
  if (shiftScrollHandler) document.removeEventListener('wheel', shiftScrollHandler)
  shiftScrollHandler = (e: WheelEvent) => {
    if (!e.shiftKey) return
    const el = e.target as HTMLElement | null
    if (!el?.closest('#luckysheet')) return
    if (e.deltaY === 0) return
    const scrollbarX = document.querySelector('#luckysheet-scrollbar-x') as HTMLElement | null
    if (!scrollbarX || scrollbarX.scrollWidth <= scrollbarX.clientWidth) return
    e.stopPropagation()
    e.preventDefault()
    scrollbarX.scrollLeft += e.deltaY
  }
  document.addEventListener('wheel', shiftScrollHandler, { capture: true, passive: false })
}

function captureMouseEvent(e: MouseEvent) {
  ;(window as any).__lastMouseEvent = e
}

onMounted(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  const restored = await checkDraft()
  if (!restored) {
    const raw = localStorage.getItem(FINANCE_AUTO_SAVE_KEY)
    if (!raw) {
      initLuckysheet()
    } else {
      try {
        const draft = JSON.parse(raw)
        if (!draft?.celldata?.length) initLuckysheet()
      } catch { initLuckysheet() }
    }
  }
  startAutoSave()
  document.addEventListener('mousedown', captureMouseEvent)
  setupShiftScroll()
  // Delete/Backspace 键盘拦截：大选区快速删除
  setupKeyboardInterceptor()
})

onBeforeUnmount(() => {
  stopAutoSave()
  document.removeEventListener('mousedown', captureMouseEvent)
  if (shiftScrollHandler) {
    document.removeEventListener('wheel', shiftScrollHandler)
    shiftScrollHandler = null
  }
  // 清理键盘拦截器
  cleanupKeyboardInterceptor()
  validation.cleanupTimers()
})
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
  background: linear-gradient(90deg, #E6A23C, #67C23A);
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

.validation-spinner {
  width: 36px;
  height: 36px;
  margin: 0 auto;
  border: 3px solid #e4e7ed;
  border-top-color: #E6A23C;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
