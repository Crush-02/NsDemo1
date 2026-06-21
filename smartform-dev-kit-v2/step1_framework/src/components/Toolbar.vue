<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <h2 class="toolbar-title">物业导入 - 在线填表工具</h2>
    </div>
    <div class="toolbar-right">
      <slot name="extra" />
      <el-button type="primary" @click="handleImport" :icon="Upload">导入Excel</el-button>
      <el-button type="success" @click="handleExport" :icon="Download">导出Excel</el-button>
    </div>
    <input
      ref="fileInputRef"
      type="file"
      accept=".xlsx,.xls"
      style="display: none"
      @change="onFileChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Upload, Download } from '@element-plus/icons-vue'
import { ElMessage, ElLoading } from 'element-plus'
import { readExcelFile } from '../utils/excelIO'

const emit = defineEmits<{
  (e: 'import', data: string[][]): void
  (e: 'export'): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

function handleImport() {
  fileInputRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 显示loading（XLSX.read 是 CPU 密集操作，需要让用户感知）
  const loading = ElLoading.service({
    lock: true,
    text: '正在解析Excel文件...',
    background: 'rgba(0, 0, 0, 0.5)',
  })

  try {
    const data = await readExcelFile(file)
    loading.close()
    emit('import', data)
    // 成功提示已移至 TableEditor.importData 内部（导入完成后显示）
  } catch (err: any) {
    loading.close()
    ElMessage.error('导入失败: ' + (err.message || '未知错误'))
  }

  input.value = ''
}

function handleExport() {
  emit('export')
}
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  height: 56px;
  box-sizing: border-box;
}

.toolbar-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.toolbar-right {
  display: flex;
  gap: 10px;
}
</style>
