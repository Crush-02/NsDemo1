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
      <ValidationPanel :visible="showPanel" @close="showPanel = false" />
    </div>
    <ValidationBar />
  </div>

  <!-- 编辑器：应收已收数据导入 -->
  <div v-else-if="currentView === 'finance'" class="app-container">
    <Toolbar title="应收、已收数据导入 - 在线填表工具" :col-count="18" @import="onFinanceImport" @export="onFinanceExport">
      <template #extra>
        <el-button size="small" @click="backToHome">← 返回首页</el-button>
        <el-button size="small" @click="showFinancePanel = !showFinancePanel">
          {{ showFinancePanel ? '隐藏面板' : '校验面板' }}
        </el-button>
      </template>
    </Toolbar>
    <div class="main-area">
      <FinanceTableEditor ref="financeEditorRef" />
      <FinanceValidationPanel :visible="showFinancePanel" @close="showFinancePanel = false" />
    </div>
    <FinanceValidationBar />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
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
</style>
