<template>
  <div class="table-editor" @click="onEditorClick">
    <div class="luckysheet-container">
      <div
        id="luckysheet"
        style="margin:0px;padding:0px;position:absolute;width:100%;height:100%;"
      ></div>
    </div>
    <CellTooltip ref="cellTooltipRef" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { HEADER_COLUMNS, type CellData } from '../types'
import { getCurrentCelldata, saveToLocal, loadFromLocal, formatTimestamp } from '../utils/autoSave'
import { ElMessageBox, ElMessage, ElLoading } from 'element-plus'
import { useValidationStore } from '../engine/validationStore'
import CellTooltip from './CellTooltip.vue'

const cellTooltipRef = ref<InstanceType<typeof CellTooltip> | null>(null)
const validation = useValidationStore()

/** 上次编辑的单元格位置，用于ON_BLUR检测 */
let lastEditedCell: { row: number; col: number } | null = null

let autoSaveTimer: ReturnType<typeof setInterval> | null = null
/** 当前导入的loading实例，用于关闭 */
let importLoadingInstance: ReturnType<typeof ElLoading.service> | null = null

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
      fc: '#ffffff',
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
    data: [
      {
        name: '物业导入',
        color: '',
        status: 1,
        order: 0,
        celldata,
        config: {
          columnlen,
          rowhigh: { 0: 40 },
        },
        row: 100,
        column: 25,
        defaultRowHeight: 26,
        defaultColWidth: 100,
        frozenRowCount: 1,
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
      // Level 1: 输入时即时校验（只校验格式规则）
      cellUpdated(r: number, c: number, oldValue: any, newValue: any, isRefresh: boolean) {
        if (r === 0) return
        // 记录当前编辑的单元格
        lastEditedCell = { row: r, col: c }
        setTimeout(() => {
          validation.onCellInput(r, c)
        }, 100)
      },
      // 单元格点击：触发ON_BLUR + 显示tooltip
      cellMousedown(cell: any, postion: any, sheetFile: any, ctx: any) {
        // 先触发上次编辑单元格的ON_BLUR
        if (lastEditedCell) {
          const { row, col } = lastEditedCell
          lastEditedCell = null
          setTimeout(() => {
            validation.onCellBlur(row, col)
          }, 50)
        }
        // 显示tooltip
        setTimeout(() => {
          showTooltipForCurrentCell()
        }, 50)
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

/** 导入数据到Luckysheet（带进度反馈，避免UI卡死无响应） */
function importData(rows: string[][]) {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return

  // 显示全屏loading，让用户知道正在处理
  importLoadingInstance = ElLoading.service({
    lock: true,
    text: '正在准备导入数据...',
    background: 'rgba(0, 0, 0, 0.5)',
  })

  // 使用 requestAnimationFrame 分帧构建 celldata，避免大数据量时阻塞
  const maxCol = HEADER_COLUMNS.length
  const celldata: CellData[] = []
  let currentRow = 0

  function buildChunk() {
    const CHUNK_SIZE = 500 // 每帧处理500行
    const endRow = Math.min(currentRow + CHUNK_SIZE, rows.length)

    for (let r = currentRow; r < endRow; r++) {
      const row = rows[r]
      for (let c = 0; c < row.length && c < maxCol; c++) {
        if (row[c] !== '') {
          celldata.push({
            r: r + 1,
            c,
            v: { v: row[c], m: row[c], ct: { fa: 'General', t: 'g' } },
          })
        }
      }
    }

    currentRow = endRow

    if (currentRow < rows.length) {
      // 更新进度文字
      if (importLoadingInstance) {
        importLoadingInstance.setText(`正在处理数据... (${Math.round(currentRow / rows.length * 100)}%)`)
      }
      requestAnimationFrame(buildChunk)
    } else {
      // 数据构建完成，进入渲染阶段
      if (importLoadingInstance) importLoadingInstance.setText('正在渲染表格...')
      luckysheet.destroy()
      setTimeout(() => {
        initLuckysheet(celldata)
        // 渲染完成后进入校验阶段
        if (importLoadingInstance) importLoadingInstance.setText('正在校验数据...')
        setTimeout(() => {
          validation.runFullValidation()
          validation.applyAllValidationStyles()
          // 全部完成，关闭loading
          if (importLoadingInstance) {
            importLoadingInstance.close()
            importLoadingInstance = null
          }
          ElMessage.success(`导入成功，共${rows.length}行数据`)
        }, 300)
      }, 200)
    }
  }

  // 启动分帧构建
  requestAnimationFrame(buildChunk)
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
  const { errors, warnings } = validation.runFullValidation()
  validation.applyAllValidationStyles()

  if (errors.length > 0) {
    const errorLines = errors
      .slice(0, 10)
      .map((e) => `第${e.row + 1}行: ${e.message}`)
      .join('\n')
    const moreText = errors.length > 10 ? `\n...还有${errors.length - 10}个错误` : ''

    ElMessageBox.alert(
      `存在${errors.length}个错误，请修正后再导出：\n\n${errorLines}${moreText}`,
      '校验未通过',
      { type: 'error', confirmButtonText: '知道了' }
    )
    return false
  }

  if (warnings.length > 0) {
    try {
      await ElMessageBox.confirm(
        `存在${warnings.length}个警告，是否仍要导出？`,
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
})

onBeforeUnmount(() => {
  stopAutoSave()
  document.removeEventListener('mousedown', captureMouseEvent)
})

/** 捕获鼠标事件位置 */
function captureMouseEvent(e: MouseEvent) {
  ;(window as any).__lastMouseEvent = e
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
</style>
