<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="cell-tooltip"
      :style="tooltipStyle"
    >
      <div class="tooltip-content">
        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          class="tooltip-item"
          :class="severityClass"
        >
          <span class="tooltip-icon">{{ severityIcon }}</span>
          {{ msg }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CellError } from '../engine/types'

const visible = ref(false)
const cellError = ref<CellError | null>(null)
const position = ref({ x: 0, y: 0 })

const messages = computed(() => cellError.value?.messages || [])

const severityClass = computed(() => {
  if (!cellError.value) return ''
  return cellError.value.severity === 'CRITICAL' ? 'severity-critical' : 'severity-high'
})

const severityIcon = computed(() => {
  if (!cellError.value) return ''
  return cellError.value.severity === 'CRITICAL' ? '✖' : '⚠'
})

const tooltipStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))

/** 显示tooltip */
function show(error: CellError, x: number, y: number) {
  cellError.value = error
  // 边界溢出检测
  const tooltipWidth = 360
  const tooltipHeight = 80
  const vw = window.innerWidth
  const vh = window.innerHeight
  const adjustedX = x + tooltipWidth > vw ? Math.max(4, vw - tooltipWidth - 8) : x
  const adjustedY = y + tooltipHeight > vh ? Math.max(4, y - tooltipHeight - 8) : y
  position.value = { x: adjustedX, y: adjustedY }
  visible.value = true
}

/** 隐藏tooltip */
function hide() {
  visible.value = false
  cellError.value = null
}

defineExpose({ show, hide })
</script>

<style scoped>
.cell-tooltip {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  animation: tooltip-fade-in 0.15s ease-out;
}

.tooltip-content {
  background: #fff;
  border-radius: 4px;
  padding: 8px 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  max-width: 360px;
  font-size: 13px;
  line-height: 1.5;
}

.tooltip-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.tooltip-item + .tooltip-item {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #f0f0f0;
}

.severity-critical {
  color: #F56C6C;
}

.severity-high {
  color: #E6A23C;
}

.tooltip-icon {
  flex-shrink: 0;
  font-size: 12px;
  margin-top: 2px;
}

@keyframes tooltip-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
