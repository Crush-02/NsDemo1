<template>
  <transition name="slide">
    <div v-if="visible" class="validation-panel">
      <div class="panel-header">
        <span class="panel-title">校验结果</span>
        <el-button text size="small" @click="$emit('close')">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>

      <div class="panel-summary">
        <div class="summary-item summary-error">
          <span class="summary-count">{{ state.errorCount }}</span>
          <span class="summary-label">错误</span>
        </div>
        <div class="summary-item summary-warning">
          <span class="summary-count">{{ state.warningCount }}</span>
          <span class="summary-label">警告</span>
        </div>
        <div class="summary-item summary-pending">
          <span class="summary-count">{{ state.pendingCells.size }}</span>
          <span class="summary-label">待填写</span>
        </div>
      </div>

      <div class="panel-tabs">
        <button :class="['tab-btn', activeTab === 'errors' && 'active']" @click="activeTab = 'errors'">
          校验问题
        </button>
        <button :class="['tab-btn', activeTab === 'pending' && 'active']" @click="activeTab = 'pending'">
          待填写
        </button>
      </div>

      <!-- 校验问题列表 -->
      <div v-if="activeTab === 'errors'" class="panel-body">
        <template v-if="groupedErrors.length > 0">
          <div v-for="group in groupedErrors" :key="group.row" class="error-group">
            <div class="group-header">第 {{ group.row + 1 }} 行</div>
            <div
              v-for="err in group.errors"
              :key="`${err.row}-${err.col}-${err.messages[0]}`"
              class="error-item"
              :class="severityClass(err.severity)"
              @click="navigateToCell(err.row, err.col)"
            >
              <span class="error-severity">{{ severityLabel(err.severity) }}</span>
              <span class="error-col">{{ getColName(err.col) }}：</span>
              <span class="error-msg">{{ err.messages[0] }}</span>
              <span v-if="err.messages.length > 1" class="error-more">+{{ err.messages.length - 1 }}</span>
            </div>
          </div>
        </template>
        <div v-else class="empty-hint">无校验问题</div>
      </div>

      <!-- 待填写列表 -->
      <div v-if="activeTab === 'pending'" class="panel-body">
        <template v-if="pendingList.length > 0">
          <div
            v-for="item in pendingList"
            :key="item.key"
            class="pending-item"
            @click="navigateToCell(item.row, item.col)"
          >
            <span class="pending-icon">📋</span>
            <span>第 {{ item.row + 1 }} 行 - {{ getColName(item.col) }}</span>
            <span class="pending-desc">{{ item.description }}</span>
          </div>
        </template>
        <div v-else class="empty-hint">无待填写项</div>
      </div>

      <div class="panel-footer">
        <el-button
          size="small"
          :loading="financeSchedulerProgress.isRunning"
          @click="refreshValidation"
        >
          {{ financeSchedulerProgress.isRunning ? '校验中...' : '重新校验' }}
        </el-button>
        <el-button
          v-if="financeSchedulerProgress.isRunning"
          size="small"
          type="danger"
          text
          @click="cancelValidation()"
        >
          取消
        </el-button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Close } from '@element-plus/icons-vue'
import {
  financeState as state,
  getAllCellErrors,
  startValidation,
  cancelValidation,
  financeSchedulerProgress,
} from '../engine/finance/validationStore'
import { getDependencyDescriptions } from '../engine/finance/dependencyTracker'
import { FINANCE_HEADER_COLUMNS } from '../engine/finance/types'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const activeTab = ref<'errors' | 'pending'>('errors')

const groupedErrors = computed(() => {
  const _size = state.results.size
  void _size
  const allErrors = getAllCellErrors()
  const rowMap = new Map<number, typeof allErrors>()
  allErrors.forEach((err) => {
    const existing = rowMap.get(err.row) || []
    existing.push(err)
    rowMap.set(err.row, existing)
  })
  const groups: { row: number; errors: typeof allErrors }[] = []
  rowMap.forEach((errors, row) => {
    groups.push({ row, errors: errors.sort((a, b) => a.col - b.col) })
  })
  return groups.sort((a, b) => a.row - b.row)
})

const pendingList = computed(() => {
  const _size = state.pendingCells.size
  void _size
  const items: { key: string; row: number; col: number; description: string }[] = []
  state.pendingCells.forEach((key) => {
    const [rowStr, colStr] = key.split('-')
    const row = Number(rowStr)
    const col = Number(colStr)
    const descriptions = getDependencyDescriptions(col)
    items.push({ key, row, col, description: descriptions[0] || '此项变为必填' })
  })
  return items.sort((a, b) => a.row - b.row || a.col - b.col)
})

function getColName(col: number): string {
  return FINANCE_HEADER_COLUMNS[col]?.label || `列${col}`
}

function severityClass(severity: string): string {
  if (severity === 'CRITICAL') return 'severity-critical'
  if (severity === 'HIGH') return 'severity-high'
  return 'severity-medium'
}

function severityLabel(severity: string): string {
  if (severity === 'CRITICAL') return '错误'
  if (severity === 'HIGH') return '警告'
  return '提示'
}

function navigateToCell(row: number, col: number) {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return
  try {
    if (typeof luckysheet.scroll === 'function') {
      luckysheet.scroll({ targetRow: row, targetColumn: col })
    }
    luckysheet.setRangeShow({ row: [row, row], column: [col, col] })

    // 额外偏移，将目标单元格移到视口中央
    setTimeout(() => {
      const scrollbarX = document.querySelector('#luckysheet-scrollbar-x') as HTMLElement | null
      const scrollbarY = document.querySelector('#luckysheet-scrollbar-y') as HTMLElement | null
      const cellMain = document.querySelector('#luckysheet-cell-main') as HTMLElement | null
      if (!scrollbarX || !scrollbarY || !cellMain) return

      const halfW = cellMain.clientWidth / 2
      const halfH = cellMain.clientHeight / 2

      const newLeft = Math.max(0, scrollbarX.scrollLeft - halfW)
      const newTop = Math.max(0, scrollbarY.scrollTop - halfH)

      scrollbarX.scrollLeft = newLeft
      scrollbarY.scrollTop = newTop

      scrollbarX.dispatchEvent(new Event('scroll'))
      scrollbarY.dispatchEvent(new Event('scroll'))
    }, 50)
  } catch { /* 忽略 */ }
}

function refreshValidation() {
  if (financeSchedulerProgress.isRunning) return
  startValidation()
}
</script>

<style scoped>
.validation-panel {
  width: 320px;
  height: 100%;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.panel-summary {
  display: flex;
  padding: 12px 16px;
  gap: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.summary-item {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  border-radius: 6px;
}

.summary-count {
  display: block;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}

.summary-label {
  display: block;
  font-size: 12px;
  margin-top: 2px;
}

.summary-error { background: #fef0f0; color: #f56c6c; }
.summary-warning { background: #fdf6ec; color: #e6a23c; }
.summary-pending { background: #f0f9eb; color: #67c23a; }

.panel-tabs {
  display: flex;
  border-bottom: 1px solid #e4e7ed;
}

.tab-btn {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: none;
  font-size: 13px;
  color: #909399;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-btn:hover { color: #409eff; }
.tab-btn.active { color: #409eff; border-bottom-color: #409eff; font-weight: 500; }

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.error-group { margin-bottom: 4px; }

.group-header {
  padding: 6px 16px;
  font-size: 12px;
  color: #909399;
  background: #fafafa;
  font-weight: 500;
}

.error-item {
  display: flex;
  align-items: flex-start;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  gap: 4px;
  transition: background 0.15s;
}

.error-item:hover { background: #f5f7fa; }

.error-severity {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 500;
}

.severity-critical .error-severity { background: #fef0f0; color: #f56c6c; }
.severity-high .error-severity { background: #fdf6ec; color: #e6a23c; }
.severity-medium .error-severity { background: #fdf6ec; color: #e6a23c; }
.severity-critical .error-msg { color: #f56c6c; }
.severity-high .error-msg { color: #e6a23c; }
.severity-medium .error-msg { color: #e6a23c; }

.error-col { color: #606266; flex-shrink: 0; font-weight: 500; }
.error-msg { flex: 1; color: #606266; word-break: break-all; }

.error-more {
  flex-shrink: 0;
  font-size: 11px;
  color: #909399;
  background: #f0f0f0;
  padding: 0 4px;
  border-radius: 3px;
}

.pending-item {
  display: flex;
  align-items: flex-start;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  gap: 6px;
  transition: background 0.15s;
  flex-wrap: wrap;
}

.pending-item:hover { background: #f5f7fa; }
.pending-icon { flex-shrink: 0; }

.pending-desc {
  width: 100%;
  font-size: 11px;
  color: #909399;
  padding-left: 22px;
}

.empty-hint {
  text-align: center;
  color: #c0c4cc;
  padding: 40px 0;
  font-size: 14px;
}

.panel-footer {
  padding: 8px 16px;
  border-top: 1px solid #e4e7ed;
  text-align: center;
}

.slide-enter-active, .slide-leave-active { transition: transform 0.25s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
