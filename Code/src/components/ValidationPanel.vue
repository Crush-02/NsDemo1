<template>
  <transition name="slide">
    <div v-if="visible" class="validation-panel">
      <div class="panel-header">
        <span class="panel-title">校验结果</span>
        <el-button text size="small" @click="$emit('close')">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>

      <!-- 分类抽屉：错误 / 警告 / 待填写（默认全部收起） -->
      <div class="panel-body">
        <template v-if="counts.total > 0">
          <!-- 错误 -->
          <div class="drawer drawer-error" :class="{ 'is-empty': counts.errors === 0 }">
            <button
              class="drawer-head"
              type="button"
              :disabled="counts.errors === 0"
              :aria-expanded="isExpanded('errors')"
              @click="toggle('errors')"
            >
              <span class="drawer-arrow" :class="{ open: isExpanded('errors') }" aria-hidden="true"></span>
              <span class="drawer-label">错误</span>
              <span class="drawer-count">{{ counts.errors }}</span>
            </button>

            <div v-if="isExpanded('errors')" class="drawer-body">
              <IssueList
                :issues="errorIssues"
                :expanded-keys="expandedIssueKeys"
                :visible-counts="issueVisibleCounts"
                :col-name="getColName"
                label="错误"
                @toggle-detail="toggleIssueDetail"
                @load-more="loadMoreIssueRows"
                @navigate="navigateToCell"
              />
            </div>
          </div>

          <!-- 警告 -->
          <div class="drawer drawer-warning" :class="{ 'is-empty': counts.warnings === 0 }">
            <button
              class="drawer-head"
              type="button"
              :disabled="counts.warnings === 0"
              :aria-expanded="isExpanded('warnings')"
              @click="toggle('warnings')"
            >
              <span class="drawer-arrow" :class="{ open: isExpanded('warnings') }" aria-hidden="true"></span>
              <span class="drawer-label">警告</span>
              <span class="drawer-count">{{ counts.warnings }}</span>
            </button>

            <div v-if="isExpanded('warnings')" class="drawer-body">
              <IssueList
                :issues="warningIssues"
                :expanded-keys="expandedIssueKeys"
                :visible-counts="issueVisibleCounts"
                :col-name="getColName"
                label="警告"
                @toggle-detail="toggleIssueDetail"
                @load-more="loadMoreIssueRows"
                @navigate="navigateToCell"
              />
            </div>
          </div>

          <!-- 待填写 -->
          <div class="drawer drawer-pending" :class="{ 'is-empty': counts.pending === 0 }">
            <button
              class="drawer-head"
              type="button"
              :disabled="counts.pending === 0"
              :aria-expanded="isExpanded('pending')"
              @click="toggle('pending')"
            >
              <span class="drawer-arrow" :class="{ open: isExpanded('pending') }" aria-hidden="true"></span>
              <span class="drawer-label">待填写</span>
              <span class="drawer-count">{{ counts.pending }}</span>
            </button>

            <div v-if="isExpanded('pending')" class="drawer-body">
              <div
                v-for="item in pendingItems.slice(0, pendingVisible)"
                :key="item.key"
                class="pending-item"
                @click="navigateToCell(item.row, item.col)"
              >
                <span class="pending-icon">📋</span>
                <span>第 {{ item.row + 1 }} 行 - {{ getColName(item.col) }}</span>
                <span class="pending-desc">{{ item.description }}</span>
              </div>
              <button
                v-if="pendingItems.length > pendingVisible"
                class="load-more-btn"
                type="button"
                @click="pendingVisible += PENDING_PAGE_SIZE"
              >
                显示更多（已显示 {{ pendingVisible }} / {{ pendingItems.length }}）
              </button>
            </div>
          </div>
        </template>

        <div v-else class="empty-hint">无校验问题</div>
      </div>

      <!-- 底部操作 -->
      <div class="panel-footer">
        <el-button
          class="validate-btn"
          size="default"
          :loading="schedulerProgress.isRunning"
          @click="refreshValidation"
        >
          {{ schedulerProgress.isRunning ? '校验中...' : '重新校验' }}
        </el-button>
        <el-button
          v-if="schedulerProgress.isRunning"
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
import { reactive, computed, ref } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { state, getAggregatedIssues, startValidation, cancelValidation, schedulerProgress } from '../engine/validationStore'
import { getDependencyDescriptions } from '../engine/dependencyTracker'
import { HEADER_COLUMNS } from '../types'
import IssueList from './IssueList.vue'
import type { Severity } from '../engine/types'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

/** 分类键 */
type Category = 'errors' | 'warnings' | 'pending'

/** 抽屉展开状态：默认全部收起（不做"有内容自动展开"） */
const expanded = reactive<Record<Category, boolean>>({
  errors: false,
  warnings: false,
  pending: false,
})

/** 严重度优先级（与 getAllCellErrors 取"最严重"的口径保持一致） */
const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }

/**
 * 分类计数（轻量路径）
 * 默认收起时仅走这里：单次遍历 results 只做累加，不构建条目对象
 * 口径 = 单元格数，与展开后的条目数完全一致
 */
const counts = computed(() => {
  // 访问 size 确保 Vue 响应式追踪（既有写法）
  void state.results.size
  void state.pendingCells.size

  let errors = 0
  let warnings = 0
  state.results.forEach((results) => {
    if (!results.length) return
    let worst = results[0].severity
    for (const r of results) {
      if (SEVERITY_ORDER[r.severity] < SEVERITY_ORDER[worst]) worst = r.severity
    }
    if (worst === 'CRITICAL') errors++
    else warnings++
  })

  const pending = state.pendingCells.size
  return { errors, warnings, pending, total: errors + warnings + pending }
})

/** 是否处于展开态（数量为 0 时强制收起，避免展开空抽屉） */
function isExpanded(key: Category): boolean {
  return expanded[key] && counts.value[key] > 0
}

/** 切换抽屉 */
function toggle(key: Category) {
  if (counts.value[key] === 0) return
  expanded[key] = !expanded[key]
}

/**
 * 聚合后的错误 / 警告分组（仅展开时求值，computed 惰性）
 *
 * 由 store 层 getAggregatedIssues() 完成「单次遍历 + 按(列,文案)归并」，
 * 见 engine/issueAggregator.ts。这样两个面板共用一套逻辑，
 * 不再各自写一份（此前组件重复度 83~98%）。
 */
const errorIssues = computed(() => {
  void state.results.size
  return getAggregatedIssues().errors
})

const warningIssues = computed(() => {
  void state.results.size
  return getAggregatedIssues().warnings
})

/** 展开了明细的组 key（跨两个抽屉共用，键本身含列号不会冲突） */
const expandedIssueKeys = reactive(new Set<string>())

/** 每组当前已渲染的明细条数：key → 条数 */
const issueVisibleCounts = reactive<Record<string, number>>({})

/** 明细首屏渲染条数上限 */
const ISSUE_PAGE_SIZE = 100

/** 展开 / 收起某组明细；收起时不重置计数，便于再次展开回到原处 */
function toggleIssueDetail(key: string) {
  if (expandedIssueKeys.has(key)) expandedIssueKeys.delete(key)
  else expandedIssueKeys.add(key)
}

/** 「显示更多」：单组明细再加一批 */
function loadMoreIssueRows(key: string) {
  issueVisibleCounts[key] = (issueVisibleCounts[key] ?? ISSUE_PAGE_SIZE) + ISSUE_PAGE_SIZE
}

/** 待填写条目 */
const pendingItems = computed(() => {
  void state.pendingCells.size
  const items: { key: string; row: number; col: number; description: string }[] = []
  state.pendingCells.forEach((key) => {
    const [rowStr, colStr] = key.split('-')
    const row = Number(rowStr)
    const col = Number(colStr)
    const descriptions = getDependencyDescriptions(col)
    items.push({
      key,
      row,
      col,
      description: descriptions[0] || '此项变为必填',
    })
  })
  return items.sort((a, b) => a.row - b.row || a.col - b.col)
})

/** 待填写首屏渲染条数（4.4 万行场景下 pendingCells 也可能有数万条） */
const PENDING_PAGE_SIZE = 100
/** 待填写当前已渲染条数 */
const pendingVisible = ref(PENDING_PAGE_SIZE)

/** 获取列名 */
function getColName(col: number): string {
  return HEADER_COLUMNS[col]?.label || `列${col}`
}

/** 导航到单元格（选中 + 滚动到视口中央） */
function navigateToCell(row: number, col: number) {
  const luckysheet = (window as any).luckysheet
  if (!luckysheet) return

  try {
    // 1. 滚动到目标单元格（默认到左上角）
    if (typeof luckysheet.scroll === 'function') {
      luckysheet.scroll({
        targetRow: row,
        targetColumn: col,
      })
    }

    // 2. 选中目标单元格
    luckysheet.setRangeShow({
      row: [row, row],
      column: [col, col],
    })

    // 3. 安全回退半屏，使目标单元格居中；触底时保持贴边（否则会把边缘单元格推出视口）
    setTimeout(() => {
      centerScrollbarSafely('#luckysheet-scrollbar-y', 'y')
      centerScrollbarSafely('#luckysheet-scrollbar-x', 'x')
    }, 50)
  } catch {
    // 忽略失败
  }
}

/**
 * 安全滚动：把目标从视口起点回退半屏使其居中，但绝不把目标推出视口。
 *
 * Luckysheet 的滚动条是伪滚动条，视觉滚动由该元素的 scroll 事件驱动
 * （程序化赋值 scrollTop/scrollLeft 不会触发原生事件，故必须手动派发）。
 *
 * 边缘单元格跳转失效的根因：luckysheet.scroll() 设置的是目标行/列的左上角坐标，
 * 当目标接近内容末尾时，scrollTop 会被浏览器钳到 max = scrollHeight - clientHeight，
 * 此时目标贴在视口边缘；若再无条件下减半屏，视口会上移，目标反而落到视口之外。
 * 因此仅在「未触底」时回退半屏，已触底时保持不动（贴边即完整可见）。
 */
function centerScrollbarSafely(selector: string, axis: 'y' | 'x') {
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return

  const viewport = axis === 'y' ? el.clientHeight : el.clientWidth
  const max = axis === 'y'
    ? el.scrollHeight - el.clientHeight
    : el.scrollWidth - el.clientWidth
  const cur = axis === 'y' ? el.scrollTop : el.scrollLeft

  const next = max > 0 && cur < max ? Math.max(0, cur - viewport / 2) : cur

  if (axis === 'y') el.scrollTop = next
  else el.scrollLeft = next

  // Luckysheet 依赖 scroll 事件驱动重绘
  el.dispatchEvent(new Event('scroll'))
}

/** 重新校验 */
function refreshValidation() {
  if (schedulerProgress.isRunning) return
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

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}

/* ==================== 分类抽屉 ==================== */

.drawer {
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}

.drawer-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.drawer-head:disabled {
  cursor: default;
}

.drawer-label {
  flex-shrink: 0;
}

.drawer-count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.85);
}

/* 展开箭头（CSS 三角形，展开时旋转 90°） */
.drawer-arrow {
  flex-shrink: 0;
  width: 0;
  height: 0;
  border-left: 4px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.15s ease;
}

.drawer-arrow.open {
  transform: rotate(90deg);
}

.drawer-error .drawer-head {
  background: #fef0f0;
  color: #f56c6c;
}

.drawer-error .drawer-head:hover:not(:disabled) {
  background: #fce0e0;
}

.drawer-warning .drawer-head {
  background: #fdf6ec;
  color: #e6a23c;
}

.drawer-warning .drawer-head:hover:not(:disabled) {
  background: #fbebd6;
}

.drawer-pending .drawer-head {
  background: #f0f9eb;
  color: #67c23a;
}

.drawer-pending .drawer-head:hover:not(:disabled) {
  background: #e5f5db;
}

/* 数量为 0：置灰且不可点击 */
.drawer.is-empty .drawer-head,
.drawer.is-empty .drawer-head:hover {
  background: #f5f7fa;
  color: #c0c4cc;
}

.drawer-body {
  background: #fff;
  padding: 2px 0 6px;
  animation: drawer-expand 0.16s ease-out;
}

@keyframes drawer-expand {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ==================== 条目 ==================== */

/* overflow-wrap: break-word 只在「单个长单词/长串超过容器宽度」时才断行，
   中文（以及中英混排）走浏览器原生 CJK 断行路径，速度远快于逐字符测宽。
   原 word-break: break-all 会强制逐字符断行，在 19,233 条规模下
   单次布局需计算 13.7 万个盒模型，是抽屉展开卡死的主要放大因素。 */

.pending-item {
  display: flex;
  align-items: flex-start;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  gap: 6px;
  transition: background 0.15s;
  flex-wrap: wrap;
}

.pending-item:hover {
  background: #f5f7fa;
}

/* 「显示更多」按钮（待填写限量的兜底；错误/警告抽屉内的同名样式在 IssueList 中） */
.load-more-btn {
  display: block;
  width: calc(100% - 20px);
  margin: 6px 10px;
  padding: 5px 0;
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.load-more-btn:hover {
  background: #ecf5ff;
  color: #409eff;
}

.pending-icon {
  flex-shrink: 0;
}

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

/* 侧边栏滑入动画 */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
/* 校验面板主操作按钮：亮橙背景 */
.validate-btn.el-button {
  background-color: rgb(255, 115, 0);
  border-color: rgb(255, 115, 0);
  color: #ffffff;
}
.validate-btn.el-button:hover,
.validate-btn.el-button:focus {
  background-color: rgb(230, 100, 0);
  border-color: rgb(230, 100, 0);
  color: #ffffff;
}
.validate-btn.el-button.is-loading,
.validate-btn.el-button:disabled {
  background-color: rgb(255, 115, 0);
  border-color: rgb(255, 115, 0);
  color: #ffffff;
}
</style>
