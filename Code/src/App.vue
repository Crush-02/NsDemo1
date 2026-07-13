<template>
  <!-- 首页：模板选择 -->
  <HomeView v-if="currentView === 'home'" @select="onTemplateSelect" />

  <!-- 编辑器：房产信息数据导入 -->
  <div v-else-if="currentView === 'property'" class="app-container">
    <Toolbar title="房产信息数据导入 - 在线填表工具" @import="onPropertyImport" @export="onPropertyExport">
      <template #extra>
        <el-button size="small" @click="backToHome">← 返回首页</el-button>
        <el-button size="small" @click="showPanel = !showPanel">
          {{ showPanel ? '隐藏面板' : '校验面板' }}
        </el-button>
      </template>
    </Toolbar>
    <div class="main-area">
      <TableEditor ref="tableEditorRef" />
      <div v-if="showPanel" class="sync-scrollbar-y" @scroll="onSyncScroll">
        <div class="sync-scrollbar-content"></div>
      </div>
      <ValidationPanel :visible="showPanel" @close="showPanel = false" />
    </div>
    <ValidationBar />
  </div>

  <!-- 编辑器：应收已收数据导入 -->
  <div v-else-if="currentView === 'finance'" class="app-container">
    <Toolbar title="应收、已收数据导入 - 在线填表工具" :col-count="18" :header-row-index="3" @import="onFinanceImport" @export="onFinanceExport">
      <template #extra>
        <el-button size="small" @click="backToHome">← 返回首页</el-button>
        <el-button size="small" @click="showFinancePanel = !showFinancePanel">
          {{ showFinancePanel ? '隐藏面板' : '校验面板' }}
        </el-button>
      </template>
    </Toolbar>
    <div class="main-area">
      <FinanceTableEditor ref="financeEditorRef" />
      <div v-if="showFinancePanel" class="sync-scrollbar-y" @scroll="onSyncScroll">
        <div class="sync-scrollbar-content"></div>
      </div>
      <FinanceValidationPanel :visible="showFinancePanel" @close="showFinancePanel = false" />
    </div>
    <FinanceValidationBar />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import HomeView from './components/HomeView.vue'
import Toolbar from './components/Toolbar.vue'
import TableEditor from './components/TableEditor.vue'
import ValidationBar from './components/ValidationBar.vue'
import ValidationPanel from './components/ValidationPanel.vue'
import FinanceTableEditor from './components/FinanceTableEditor.vue'
import FinanceValidationBar from './components/FinanceValidationBar.vue'
import FinanceValidationPanel from './components/FinanceValidationPanel.vue'
import { exportExcel, type ExcelReadResult } from './utils/excelIO'

const currentView = ref<'home' | 'property' | 'finance'>('home')
const tableEditorRef = ref<InstanceType<typeof TableEditor> | null>(null)
const financeEditorRef = ref<InstanceType<typeof FinanceTableEditor> | null>(null)
const showPanel = ref(false)
const showFinancePanel = ref(false)

/** 选择模板 → 进入编辑器 */
function onTemplateSelect(template: string) {
  if (template === 'property') currentView.value = 'property'
  else if (template === 'finance') currentView.value = 'finance'
}

/** 返回首页 */
function backToHome() {
  currentView.value = 'home'
}

// ==================== 房产信息导入/导出 ====================

function onPropertyImport(data: ExcelReadResult) {
  tableEditorRef.value?.importData(data)
}

async function onPropertyExport() {
  const canExport = await tableEditorRef.value?.validateBeforeExport()
  if (canExport === false) return
  exportExcel()
}

// ==================== 应收已收导入/导出 ====================

function onFinanceImport(data: ExcelReadResult) {
  financeEditorRef.value?.importData(data)
}

async function onFinanceExport() {
  const canExport = await financeEditorRef.value?.validateBeforeExport()
  if (canExport === false) return
  financeEditorRef.value?.exportExcel()
}

// ==================== 同步滚动条：面板打开时在面板左侧提供表格垂直滚动条 ====================

let syncScrollRAF = 0
let isUserScrolling = false

/** 当用户拖动同步滚动条时，同步到 Luckysheet */
function onSyncScroll(e: Event) {
  const syncBar = e.target as HTMLElement
  const luckysheetBar = document.querySelector('#luckysheet-scrollbar-y') as HTMLElement | null
  if (!luckysheetBar || !syncBar) return

  isUserScrolling = true
  // 按比例同步滚动位置
  const ratio = syncBar.scrollTop / (syncBar.scrollHeight - syncBar.clientHeight || 1)
  luckysheetBar.scrollTop = ratio * (luckysheetBar.scrollHeight - luckysheetBar.clientHeight)
  luckysheetBar.dispatchEvent(new Event('scroll'))
  requestAnimationFrame(() => { isUserScrolling = false })
}

/** 从 Luckysheet 滚动条同步到自定义滚动条 */
function syncFromLuckysheet() {
  if (isUserScrolling) return
  const luckysheetBar = document.querySelector('#luckysheet-scrollbar-y') as HTMLElement | null
  const syncBars = document.querySelectorAll('.sync-scrollbar-y')
  if (!luckysheetBar || syncBars.length === 0) return

  const ratio = luckysheetBar.scrollTop / (luckysheetBar.scrollHeight - luckysheetBar.clientHeight || 1)
  syncBars.forEach((bar) => {
    const el = bar as HTMLElement
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
  })
}

/** 同步滚动条内容高度以匹配 Luckysheet 滚动范围 */
function updateSyncScrollbarSize() {
  const luckysheetBar = document.querySelector('#luckysheet-scrollbar-y') as HTMLElement | null
  const syncBars = document.querySelectorAll('.sync-scrollbar-y')
  if (!luckysheetBar || syncBars.length === 0) return

  // 计算缩放比例：让自定义滚动条的内容高度 = 可视高度 * (luckysheet.scrollHeight / luckysheet.clientHeight)
  const scrollRange = luckysheetBar.scrollHeight - luckysheetBar.clientHeight
  syncBars.forEach((bar) => {
    const el = bar as HTMLElement
    const content = el.querySelector('.sync-scrollbar-content') as HTMLElement
    if (content) {
      // 内容高度 = 可视高度 + 滚动范围，确保能滚动同样的比例
      content.style.height = `${el.clientHeight + scrollRange}px`
    }
  })
}

/** 监听 Luckysheet 滚动条的变化 */
function startSyncLoop() {
  let lastScrollTop = -1
  let lastScrollHeight = -1

  function tick() {
    const luckysheetBar = document.querySelector('#luckysheet-scrollbar-y') as HTMLElement | null
    if (luckysheetBar) {
      if (luckysheetBar.scrollTop !== lastScrollTop) {
        lastScrollTop = luckysheetBar.scrollTop
        syncFromLuckysheet()
      }
      if (luckysheetBar.scrollHeight !== lastScrollHeight) {
        lastScrollHeight = luckysheetBar.scrollHeight
        updateSyncScrollbarSize()
      }
    }
    syncScrollRAF = requestAnimationFrame(tick)
  }
  syncScrollRAF = requestAnimationFrame(tick)
}

// 面板显示时启动同步，隐藏时停止
watch([showPanel, showFinancePanel], ([p1, p2]) => {
  if (p1 || p2) {
    nextTick(() => {
      updateSyncScrollbarSize()
      startSyncLoop()
    })
  } else {
    cancelAnimationFrame(syncScrollRAF)
  }
})

onMounted(() => {
  if (showPanel.value || showFinancePanel.value) {
    nextTick(() => {
      updateSyncScrollbarSize()
      startSyncLoop()
    })
  }
})

onUnmounted(() => {
  cancelAnimationFrame(syncScrollRAF)
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.app-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
}

.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* 同步滚动条：面板打开时显示在面板左侧，用于拖动表格 */
.sync-scrollbar-y {
  width: 14px;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f5f5f5;
  border-left: 1px solid #ddd;
  flex-shrink: 0;
}

.sync-scrollbar-y::-webkit-scrollbar {
  width: 8px;
}

.sync-scrollbar-y::-webkit-scrollbar-track {
  background: #f0f0f0;
  border-radius: 4px;
}

.sync-scrollbar-y::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.sync-scrollbar-y::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

.sync-scrollbar-content {
  width: 1px;
}
</style>
