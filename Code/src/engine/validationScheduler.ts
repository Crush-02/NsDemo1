/**
 * 分步校验调度器
 * 将全量校验拆为小批次执行，每批之间让出主线程，保持UI可响应
 *
 * 支持三种场景：
 * 1. 导入后自动触发 — 不等待完成，用户可编辑
 * 2. 手动重新校验 — 不等待完成，用户可编辑
 * 3. 导出前触发 — 必须等待完成，期间禁用编辑
 */
import { reactive } from 'vue'
import type { ValidationResult } from './types'

/** 调度器进度状态类型 */
export interface SchedulerProgress {
  isRunning: boolean
  current: number
  total: number
  phase: '' | 'row' | 'crossRow' | 'done'
}

/** 创建一个响应式的进度状态 */
export function createSchedulerProgress(): SchedulerProgress {
  return reactive({
    isRunning: false,
    current: 0,
    total: 0,
    phase: '' as SchedulerProgress['phase'],
  })
}

/** Property模块的全局进度状态（向后兼容） */
export const schedulerProgress = createSchedulerProgress()

export class ValidationScheduler {
  private batchSize = 50
  private currentRow = 1
  private totalRows = 0
  private headerRowCount = 1
  private _isRunning = false
  private isCancelled = false
  private editedRows = new Set<number>()
  private resolvePromise: ((result: { errors: ValidationResult[]; warnings: ValidationResult[] }) => void) | null = null
  private progress: SchedulerProgress

  // 校验函数注入（由validationStore提供）
  private validateRowBatch: (startRow: number, endRow: number, skipRows: Set<number>) => ValidationResult[]
  private validateCrossRowAll: () => ValidationResult[]
  private clearAllResults: () => void
  private applyBatchResults: (results: ValidationResult[], startRow: number, endRow: number) => void
  private applyCrossRowResults: (results: ValidationResult[]) => void
  private updatePendingForBatch: (startRow: number, endRow: number) => void
  private updateStatsNow: () => void
  private getTotalDataRows: () => number

  constructor(opts: {
    headerRowCount: number
    batchSize?: number
    progress?: SchedulerProgress
    validateRowBatch: (startRow: number, endRow: number, skipRows: Set<number>) => ValidationResult[]
    validateCrossRowAll: () => ValidationResult[]
    clearAllResults: () => void
    applyBatchResults: (results: ValidationResult[], startRow: number, endRow: number) => void
    applyCrossRowResults: (results: ValidationResult[]) => void
    updatePendingForBatch: (startRow: number, endRow: number) => void
    updateStatsNow: () => void
    getTotalDataRows: () => number
  }) {
    this.headerRowCount = opts.headerRowCount
    if (opts.batchSize) this.batchSize = opts.batchSize
    this.progress = opts.progress || schedulerProgress
    this.validateRowBatch = opts.validateRowBatch
    this.validateCrossRowAll = opts.validateCrossRowAll
    this.clearAllResults = opts.clearAllResults
    this.applyBatchResults = opts.applyBatchResults
    this.applyCrossRowResults = opts.applyCrossRowResults
    this.updatePendingForBatch = opts.updatePendingForBatch
    this.updateStatsNow = opts.updateStatsNow
    this.getTotalDataRows = opts.getTotalDataRows
  }

  /** 调度器是否正在运行 */
  get isRunning(): boolean {
    return this._isRunning
  }

  /** 标记某行已被用户编辑，调度器跳过该行 */
  markRowEdited(row: number) {
    this.editedRows.add(row)
  }

  /**
   * 等待当前校验完成（如果正在运行），否则启动新的校验
   * 适用于导出场景：如果调度器正在运行则等待，否则启动全量校验
   */
  waitForCompletion(): Promise<{ errors: ValidationResult[]; warnings: ValidationResult[] }> {
    if (this._isRunning) {
      // 调度器正在运行，等待完成
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this._isRunning) {
            clearInterval(checkInterval)
            // 从当前state收集结果
            resolve({ errors: [], warnings: [] })
          }
        }, 100)
      })
    }
    // 调度器未运行，启动新的全量校验
    return this.run()
  }

  /** 启动分步校验，返回Promise（导出场景可await） */
  run(): Promise<{ errors: ValidationResult[]; warnings: ValidationResult[] }> {
    // 如果已有调度器在运行，先取消
    if (this._isRunning) {
      this.cancel()
    }

    return new Promise((resolve) => {
      this.resolvePromise = resolve
      this._isRunning = true
      this.isCancelled = false
      this.editedRows.clear()
      this.currentRow = this.headerRowCount
      this.totalRows = this.getTotalDataRows()

      this.progress.isRunning = true
      this.progress.current = 0
      this.progress.total = this.totalRows
      this.progress.phase = 'row'

      // 清除旧结果
      this.clearAllResults()

      this.scheduleNextBatch()
    })
  }

  /** 取消当前校验 */
  cancel() {
    this.isCancelled = true
    this._isRunning = false
    this.progress.isRunning = false
    this.progress.phase = ''
    if (this.resolvePromise) {
      this.resolvePromise({ errors: [], warnings: [] })
      this.resolvePromise = null
    }
  }

  private scheduleNextBatch() {
    if (this.isCancelled) return

    // 使用 setTimeout(0) 让出主线程
    setTimeout(() => this.executeBatch(), 0)
  }

  private executeBatch() {
    if (this.isCancelled) return

    const batchEnd = Math.min(this.currentRow + this.batchSize, this.headerRowCount + this.totalRows)

    // 校验当前批次（跳过用户已编辑的行）
    const batchResults = this.validateRowBatch(this.currentRow, batchEnd, this.editedRows)

    // 写入结果 + 应用样式
    this.applyBatchResults(batchResults, this.currentRow, batchEnd)

    // 更新待填写状态
    this.updatePendingForBatch(this.currentRow, batchEnd)

    // 更新进度
    const validatedCount = batchEnd - this.headerRowCount
    this.progress.current = validatedCount

    // 更新统计
    this.updateStatsNow()

    this.currentRow = batchEnd

    if (this.currentRow < this.headerRowCount + this.totalRows) {
      // 还有下一批
      this.scheduleNextBatch()
    } else {
      // 所有行校验完毕 → 执行跨行校验
      this.executeCrossRowPhase()
    }
  }

  private executeCrossRowPhase() {
    if (this.isCancelled) return

    this.progress.phase = 'crossRow'

    // 跨行校验（Map聚合，通常很快）
    const crossRowResults = this.validateCrossRowAll()

    // 写入结果 + 应用样式
    this.applyCrossRowResults(crossRowResults)

    // 更新统计
    this.updateStatsNow()

    // 完成
    this._isRunning = false
    this.progress.isRunning = false
    this.progress.phase = 'done'

    // 收集最终结果
    if (this.resolvePromise) {
      const allErrors = crossRowResults.filter((r) => r.severity === 'CRITICAL')
      const allWarnings = crossRowResults.filter((r) => r.severity !== 'CRITICAL')
      this.resolvePromise({ errors: allErrors, warnings: allWarnings })
      this.resolvePromise = null
    }
  }
}
