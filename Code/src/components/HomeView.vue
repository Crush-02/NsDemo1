<template>
  <div class="home-container">
    <!-- 顶部导航 -->
    <header class="home-header">
      <div class="header-inner">
        <div class="header-brand">
          <div class="brand-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#409EFF" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="9" x2="9" y2="21" />
            </svg>
          </div>
          <h1 class="brand-title">新视窗填表工具</h1>
        </div>
        <span class="header-desc">数据导入在线填表工具</span>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="home-main">
      <div class="main-content">
        <div class="section-header">
          <h2 class="section-title">选择导入模板</h2>
          <p class="section-subtitle">请选择要使用的数据导入模板，不同模板对应不同的业务场景</p>
        </div>

        <div class="template-grid">
          <!-- 物业导入（可用） -->
          <div class="template-card" @click="selectTemplate('property')">
            <div class="card-icon-wrap card-icon-primary">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
                <path d="M9 21V12h6v9" />
              </svg>
            </div>
            <div class="card-body">
              <h3 class="card-title">房产信息数据导入</h3>
              <p class="card-desc">房产信息、业主与租户数据的在线录入与校验，支持 Excel 批量导入导出</p>
              <div class="card-tags">
                <span class="tag tag-blue">房产管理</span>
                <span class="tag tag-green">数据校验</span>
                <span class="tag tag-orange">30列字段</span>
              </div>
            </div>
            <div class="card-action">
              <span class="action-text">开始使用</span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>

          <!-- 应收已收导入（可用） -->
          <div class="template-card" @click="selectTemplate('finance')">
            <div class="card-icon-wrap card-icon-green">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M12 4v16M2 10h20" />
                <circle cx="7" cy="15" r="1.5" />
              </svg>
            </div>
            <div class="card-body">
              <h3 class="card-title">应收、已收数据导入</h3>
              <p class="card-desc">应收、已收账款数据的在线录入与校验，支持减免联动、缴款校验等规则</p>
              <div class="card-tags">
                <span class="tag tag-green">应收管理</span>
                <span class="tag tag-blue">账款校验</span>
                <span class="tag tag-orange">18列字段</span>
              </div>
            </div>
            <div class="card-action">
              <span class="action-text">开始使用</span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>

          <!-- 更多模板占位 -->
          <div class="template-card card-disabled">
            <div class="card-badge">即将推出</div>
            <div class="card-icon-wrap card-icon-gray">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                <path d="M14 2v6h6" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="16" y2="17" />
              </svg>
            </div>
            <div class="card-body">
              <h3 class="card-title">更多模板</h3>
              <p class="card-desc">更多业务场景的数据导入模板正在开发中，敬请期待</p>
              <div class="card-tags">
                <span class="tag tag-gray">持续更新</span>
              </div>
            </div>
            <div class="card-action action-disabled">
              <span class="action-text">敬请期待</span>
      </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 底部 -->
    <footer class="home-footer">
      <span>新视窗填表工具 v1.0.0</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (e: 'select', template: string): void
}>()

function selectTemplate(template: string) {
  emit('select', template)
}
</script>

<style scoped>
.home-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
  background: #f5f7fa;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== 顶部导航 ===== */
.home-header {
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  height: 60px;
  flex-shrink: 0;
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  display: flex;
  align-items: center;
}

.brand-title {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  margin: 0;
  letter-spacing: -0.3px;
}

.header-desc {
  font-size: 14px;
  color: #909399;
}

/* ===== 主内容 ===== */
.home-main {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 48px 32px;
}

.main-content {
  max-width: 1100px;
  width: 100%;
}

.section-header {
  margin-bottom: 36px;
}

.section-title {
  font-size: 26px;
  font-weight: 700;
  color: #303133;
  margin: 0 0 8px 0;
}

.section-subtitle {
  font-size: 15px;
  color: #909399;
  margin: 0;
}

/* ===== 模板卡片网格 ===== */
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.template-card {
  position: relative;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e4e7ed;
  padding: 28px 24px 20px;
  cursor: pointer;
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.template-card:not(.card-disabled):hover {
  border-color: #409EFF;
  box-shadow: 0 8px 24px rgba(64, 158, 255, 0.12);
  transform: translateY(-2px);
}

.template-card:not(.card-disabled):active {
  transform: translateY(0);
}

.card-disabled {
  cursor: default;
  opacity: 0.6;
}

/* 徽章 */
.card-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 11px;
  color: #909399;
  background: #f0f2f5;
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 500;
}

/* 图标 */
.card-icon-wrap {
  width: 60px;
  height: 60px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-icon-primary {
  background: linear-gradient(135deg, #e8f4ff 0%, #d4ecff 100%);
  color: #409EFF;
}

.card-icon-gray {
  background: #f5f7fa;
  color: #b0b6bf;
}

.card-icon-green {
  background: linear-gradient(135deg, #e8f8f0 0%, #d4f0e0 100%);
  color: #67C23A;
}

/* 卡片内容 */
.card-body {
  flex: 1;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}

.card-desc {
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
  margin: 0 0 12px 0;
}

.card-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.tag-blue {
  background: #ecf5ff;
  color: #409EFF;
}

.tag-green {
  background: #f0f9eb;
  color: #67C23A;
}

.tag-orange {
  background: #fdf6ec;
  color: #E6A23C;
}

.tag-gray {
  background: #f5f7fa;
  color: #b0b6bf;
}

/* 底部操作 */
.card-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.action-text {
  font-size: 14px;
  font-weight: 500;
  color: #409EFF;
}

.card-action:not(.action-disabled) svg {
  transition: transform 0.2s;
}

.template-card:not(.card-disabled):hover .card-action svg {
  transform: translateX(4px);
}

.action-disabled .action-text {
  color: #c0c4cc;
}

/* ===== 底部 ===== */
.home-footer {
  text-align: center;
  padding: 16px;
  font-size: 12px;
  color: #c0c4cc;
  flex-shrink: 0;
}
</style>
