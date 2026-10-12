<template>
  <div class="issue-list">
    <!-- 空态：与改造前 groupByRow 返回空数组时的表现一致 -->
    <div v-if="issues.length === 0" class="empty-hint">无{{ label }}问题</div>

    <template v-else>
      <div
        v-for="issue in issues"
        :key="issue.key"
        class="issue-group"
      >
        <!-- 聚合行：消息 + 列名 + 条数；点击跳到第一处出错单元格 -->
        <div
          class="issue-head"
          :class="severityClass(issue.severity)"
          @click="navigate(issue)"
        >
          <span class="issue-msg">{{ firstLine(issue.message) }}</span>
          <span v-if="hasMoreLines(issue.message)" class="issue-more">
            +{{ extraLineCount(issue.message) }}
          </span>
          <span class="issue-meta">
            {{ colName(issue.col) }} · 共 {{ formatNumber(issue.count) }} 处
          </span>
          <!-- count 为 1 时无明细可展，直接定位即可 -->
          <span
            v-if="issue.count > 1"
            class="issue-expand"
            :class="{ open: isDetailOpen(issue.key) }"
            @click.stop="toggleDetail(issue.key)"
          >▸</span>
        </div>

        <!-- 二级明细：限量渲染，避免单组两万行再次拖死浏览器 -->
        <div v-if="isDetailOpen(issue.key)" class="issue-detail">
          <div
            v-for="row in visibleRows(issue)"
            :key="row"
            class="issue-row"
            @click="navigateRow(issue, row)"
          >
            第 {{ row + 1 }} 行
          </div>
          <button
            v-if="issue.rows.length > visibleCount(issue.key)"
            class="load-more-btn"
            type="button"
            @click.stop="loadMore(issue.key)"
          >
            显示更多（已显示 {{ visibleCount(issue.key) }} / {{ formatNumber(issue.rows.length) }}）
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 聚合问题列表（房产 / 应收已收两面板共用）
 *
 * ==================== 为什么用聚合视图 ====================
 * 批量导入时同类问题成批出现（整列没填 → 两万条一样的警告）。
 * 改造前逐条渲染：19,233 条 → 约 13.7 万个 DOM 节点 + 1.9 万个事件
 * 监听器，点开抽屉即卡死。聚合后按「列 + 文案」归并为数十项，
 * DOM 降至三位数（实测 449×）。
 *
 * 聚合不是「为了性能牺牲体验」：用户想知道的不是「第 47,382 行有问题」，
 * 而是「房产类型整列格式不对，共 19,996 处」。
 *
 * ==================== 为什么要二级限量 ====================
 * 聚合解决了「主视图过大」，但明细可能仍有两万行。
 * 若二级一次性渲染，问题只是被推迟一层 —— 故每组默认只渲染
 * ISSUE_PAGE_SIZE 条，点击「显示更多」再放量。
 */
import { computed } from 'vue'
import type { AggregatedIssue } from '../engine/issueAggregator'
import type { Severity } from '../engine/types'

const props = withDefaults(
  defineProps<{
    /** 聚合后的问题组（已按条数降序） */
    issues: AggregatedIssue[]
    /** 已展开明细的组 key 集合 */
    expandedKeys: Set<string>
    /** 每组当前已渲染的明细条数（key → 条数） */
    visibleCounts: Record<string, number>
    /** 该列名解析函数（房产 / 财务各传自己的） */
    colName: (col: number) => string
    /** 空态文案里的分类名，如「错误」/「警告」 */
    label?: string
    /** 每组明细首屏渲染条数 */
    pageSize?: number
  }>(),
  { label: '校验', pageSize: 100 },
)

const emit = defineEmits<{
  (e: 'toggle-detail', key: string): void
  (e: 'load-more', key: string): void
  (e: 'navigate', row: number, col: number): void
}>()

/** 首屏渲染条数上限 */
const ISSUE_PAGE_SIZE = computed(() => props.pageSize)

/** 首行文案（多行时只展示首条，其余折成 +N） */
function firstLine(message: string): string {
  const idx = message.indexOf('\n')
  return idx === -1 ? message : message.slice(0, idx)
}

/** 是否有多余行 */
function hasMoreLines(message: string): boolean {
  return message.indexOf('\n') !== -1
}

/** 多余行数 */
function extraLineCount(message: string): number {
  return message.split('\n').length - 1
}

/** 千分位 */
function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

function severityClass(severity: Severity): string {
  if (severity === 'CRITICAL') return 'severity-critical'
  if (severity === 'HIGH') return 'severity-high'
  return 'severity-medium'
}

function isDetailOpen(key: string): boolean {
  return props.expandedKeys.has(key)
}

/** 该组当前应渲染的明细行（限量） */
function visibleRows(issue: AggregatedIssue): number[] {
  return issue.rows.slice(0, visibleCount(issue.key))
}

function visibleCount(key: string): number {
  return props.visibleCounts[key] ?? ISSUE_PAGE_SIZE.value
}

function toggleDetail(key: string) {
  emit('toggle-detail', key)
}

function loadMore(key: string) {
  emit('load-more', key)
}

/** 点击聚合行 → 跳到第一处出错单元格 */
function navigate(issue: AggregatedIssue) {
  if (issue.rows.length === 0) return
  emit('navigate', issue.rows[0], issue.col)
}

/** 点击某条明细 → 跳到该行 */
function navigateRow(issue: AggregatedIssue, row: number) {
  emit('navigate', row, issue.col)
}
</script>

<style scoped>
.issue-list {
  display: flex;
  flex-direction: column;
}

.issue-group {
  border-bottom: 1px solid #f0f0f0;
}

.issue-group:last-child {
  border-bottom: none;
}

/* 聚合行 */
.issue-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.issue-head:hover {
  background: #f5f7fa;
}

.issue-msg {
  flex: 1;
  /* 中文走浏览器原生 CJK 断行；overflow-wrap 仅在长串超宽时断开。
     不可用 word-break: break-all —— 逐字符测宽在万级条目下会拖垮布局。 */
  overflow-wrap: break-word;
}

.issue-meta {
  flex-shrink: 0;
  font-size: 11px;
  color: #909399;
  white-space: nowrap;
}

.issue-expand {
  flex-shrink: 0;
  font-size: 11px;
  color: #909399;
  cursor: pointer;
  padding: 0 4px;
  transition: transform 0.15s ease;
  user-select: none;
}

.issue-expand.open {
  transform: rotate(90deg);
}

.issue-more {
  flex-shrink: 0;
  font-size: 11px;
  color: #909399;
  background: #f0f0f0;
  border-radius: 8px;
  padding: 1px 6px;
}

/* 严重度：仅着色消息文字，克制不刺眼 */
.severity-critical .issue-msg { color: #f56c6c; }
.severity-high .issue-msg { color: #e6a23c; }
.severity-medium .issue-msg { color: #e6a23c; }

/* 二级明细 */
.issue-detail {
  padding: 2px 0 6px 18px;
}

.issue-row {
  padding: 4px 10px;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
}

.issue-row:hover {
  background: #ecf5ff;
  color: #409eff;
}

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

.empty-hint {
  padding: 20px 0;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
</style>
