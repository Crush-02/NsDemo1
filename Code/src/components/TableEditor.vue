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

/** 校验遮罩层状态 */
const showValidationOverlay = ref(false)
const validationPercent = computed(() => {
  const p = validation.state.validationProgress
  if (!p.total) return 0
  if (p.phase === 'crossRow') return 95
  if (p.phase === 'done') return 100
  return Math.min(Math.round((p.current / p.total) * 95), 94)
})
const validationPhaseText = computed(() => {
  const p = validation.state.validationProgress
  if (p.phase === 'row') return '行校验中...'
  if (p.phase === 'crossRow') return '跨行校验中...'
  if (p.phase === 'done') return '校验完成'
  return ''
})

/** 上次编辑的单元格位置，用于ON_BLUR检测 */
let lastEditedCell: { row: number; col: number } | null = null
let autoSaveTimer: ReturnType<typeof setInterval> | null = null

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

/** 房产信息必填列索引 */
const PROPERTY_REQUIRED_COLS = new Set([0, 2, 4, 5, 6, 8])

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
      },
      cellUpdated(r: number, c: number, oldValue: any, newValue: any, isRefresh: boolean) {
        if (r === 0) return
        // 记录编辑的单元格位置，等失焦时触发blur校验
        lastEditedCell = { row: r, col: c }
        // 输入时即时校验（格式规则+必填规则）
        validation.onCellInput(r, c)
      },
      // 单元格点击：触发ON_BLUR + 检测值变化 + 显示tooltip
      cellMousedown(cell: any, postion: any, sheetFile: any, ctx: any) {
        // 检测上次选中区域中所有单元格值是否变化
        if (lastSelectionSnapshot.size > 0) {
          const changedRows = new Set<number>()
          const changedCols = new Set<number>()
          for (const [key, oldVal] of lastSelectionSnapshot.entries()) {
            const [rs, cs] = key.split('-')
            const row = Number(rs), col = Number(cs)
            const newVal = getCellValue(row, col)
            if (oldVal !== newVal) {
              validation.onCellInput(row, col)
              changedRows.add(row)
              changedCols.add(col)
            }
          }
          // 对变化的行和列触发blur校验（使用实际变化的列以触发正确的跨行校验）
          for (const row of changedRows) {
            for (const col of changedCols) {
              validation.onCellBlur(row, col)
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
})

onBeforeUnmount(() => {
  stopAutoSave()
  document.removeEventListener('mousedown', captureMouseEvent)
  // 清理Shift+滚轮监听
  if (shiftScrollHandler) {
    document.removeEventListener('wheel', shiftScrollHandler)
    shiftScrollHandler = null
  }
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
