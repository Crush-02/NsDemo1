<template>
  <div class="validation-bar">
    <div class="bar-left">
      <span class="bar-item">
        ✅ 已填写 {{ state.filledRows }}/{{ state.totalRows }} 行
      </span>
      <!-- 校验进度条 -->
      <span v-if="progress.isRunning" class="bar-item bar-progress">
        <span class="progress-label">
          {{ progress.phase === 'row' ? '校验中' : progress.phase === 'crossRow' ? '跨行校验中' : '校验完成' }}
        </span>
        <el-progress
          :percentage="progress.total > 0 ? Math.round(progress.current / progress.total * 100) : 0"
          :stroke-width="6"
          :show-text="true"
          :format="() => `${progress.current}/${progress.total}`"
          status=""
          class="inline-progress"
        />
      </span>
    </div>
    <div class="bar-right">
      <span v-if="state.warningCount > 0" class="bar-item bar-warning">
        ⚠️ {{ state.warningCount }}个警告
      </span>
      <span v-if="state.errorCount > 0" class="bar-item bar-error">
        ❌ {{ state.errorCount }}个错误
      </span>
      <span v-if="state.errorCount === 0 && state.warningCount === 0 && !progress.isRunning" class="bar-item bar-ok">
        ✅ 无校验问题
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { state, schedulerProgress } from '../engine/validationStore'

const progress = schedulerProgress
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

.bar-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #409EFF;
  font-weight: 500;
}

.progress-label {
  font-size: 12px;
}

.inline-progress {
  width: 120px;
}

.inline-progress :deep(.el-progress__text) {
  font-size: 11px !important;
  min-width: 50px;
}
</style>
