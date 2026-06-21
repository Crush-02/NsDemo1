<template>
  <div class="app-container">
    <Toolbar @import="onImport" @export="onExport">
      <template #extra>
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Toolbar from './components/Toolbar.vue'
import TableEditor from './components/TableEditor.vue'
import ValidationBar from './components/ValidationBar.vue'
import ValidationPanel from './components/ValidationPanel.vue'
import { exportExcel } from './utils/excelIO'

const tableEditorRef = ref<InstanceType<typeof TableEditor> | null>(null)
const showPanel = ref(false)

function onImport(data: string[][]) {
  tableEditorRef.value?.importData(data)
}

async function onExport() {
  // 导出前校验
  const canExport = await tableEditorRef.value?.validateBeforeExport()
  if (canExport === false) return

  exportExcel()
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
