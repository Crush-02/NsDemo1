<template>
  <div class="validation-bar">
    <div class="bar-left">
      <span class="bar-item">
        ✅ 已填写 {{ state.filledRows }}/{{ state.totalRows }} 行
      </span>
    </div>
    <div class="bar-right">
      <span v-if="state.warningCount > 0" class="bar-item bar-warning">
        ⚠️ {{ state.warningCount }}个警告
      </span>
      <span v-if="state.errorCount > 0" class="bar-item bar-error">
        ❌ {{ state.errorCount }}个错误
      </span>
      <span v-if="state.errorCount === 0 && state.warningCount === 0" class="bar-item bar-ok">
        ✅ 无校验问题
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { state } from '../engine/validationStore'
</script>

<style scoped>
.validation-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 20px;
  background: #f5f7fa;
  border-top: 1px solid #e4e7ed;
  height: 32px;
  font-size: 13px;
  color: #606266;
  flex-shrink: 0;
}

.bar-left, .bar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.bar-item {
  white-space: nowrap;
}

.bar-warning {
  color: #E6A23C;
  font-weight: 500;
}

.bar-error {
  color: #F56C6C;
  font-weight: 500;
}

.bar-ok {
  color: #67C23A;
}
</style>
