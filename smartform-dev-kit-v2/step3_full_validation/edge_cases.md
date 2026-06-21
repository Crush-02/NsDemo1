# 边界情况与特殊逻辑

本文档列出实现完整校验时必须注意的边界情况和特殊处理逻辑。
请务必逐条阅读，避免遗漏导致校验结果与后端API不一致。

---

## 1. 空值判断的三重陷阱

Luckysheet中单元格的值有三种"空"状态，必须统一处理：

```
状态A: null          → 从未填写过的单元格
状态B: ""            → 填写过又清空的单元格
状态C: "   "         → 只输入了空格的单元格
```

**统一处理函数**（Step1已定义，Step3必须复用）：

```typescript
function getCellText(row: number, col: number): string {
  const val = luckysheet.getCellValue(row, col)
  if (val === null || val === undefined) return ''
  return String(val).trim()
}
```

**判断规则**：
- `getCellText() === ''` → 视为空值（未填写）
- `getCellText() !== ''` → 视为有值（已填写）
- 所有校验逻辑必须基于`getCellText()`的返回值，不要直接使用`getCellValue()`

---

## 2. 日期格式严格匹配

后端API只接受`YYYY-MM-DD`格式，以下格式均不合法：

| 输入 | 是否合法 | 原因 |
|------|----------|------|
| 2024-01-15 | 合法 | 标准格式 |
| 2024-1-5 | 不合法 | 月和日必须补零 |
| 2024/01/15 | 不合法 | 分隔符必须是短横线 |
| 20240115 | 不合法 | 缺少分隔符 |
| 2024-01-15 10:30 | 不合法 | 不允许带时间 |
| 2024-02-30 | 不合法 | 2月没有30号（需校验真实日期） |

**正则校验**：

```typescript
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function isValidDateFormat(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false
  // 额外校验：确保是真实存在的日期（如2月30号不合法）
  const date = new Date(value)
  const [y, m, d] = value.split('-').map(Number)
  return date.getFullYear() === y
    && date.getMonth() === m - 1
    && date.getDate() === d
}
```

**日期比较**（用于规则14：收房日期不能小于售楼日期）：

```typescript
function compareDates(date1: string, date2: string): number {
  // 输入已通过isValidDateFormat校验，格式保证为YYYY-MM-DD
  // 字符串直接比较即可（因为格式固定）
  if (date1 < date2) return -1
  if (date1 > date2) return 1
  return 0
}
```

---

## 3. 身份证号码校验

规则：18位身份证号，最后一位可以是X。

**正则**：

```typescript
const ID_CARD_REGEX = /^\d{17}[\dX]$/
```

**注意**：
- 只校验格式，不做校验码计算（后端也不做）
- 大写X和小写x都应接受，但存储时统一转为大写
- 证件号码字段有两处：业主证件号码(col=10)和租户证件号码(col=15)，规则相同

---

## 4. 计费面积校验

规则：正数，保留4位小数。

```typescript
function isValidArea(value: string): boolean {
  // 允许整数或最多4位小数的正数
  const AREA_REGEX = /^(0|[1-9]\d*)(\.\d{1,4})?$/
  return AREA_REGEX.test(value)
}
```

**合法示例**：1, 100, 0.5, 12.3456
**不合法示例**：0, -1, 1.23456, 01.5, .5

---

## 5. 楼层校验

规则：正整数。

```typescript
function isValidFloor(value: string): boolean {
  const FLOOR_REGEX = /^[1-9]\d*$/
  return FLOOR_REGEX.test(value)
}
```

**注意**：
- 0不合法（楼层从1开始）
- 负数不合法
- 小数不合法（如1.5）
- 前导零不合法（如01）

---

## 6. 条件触发的清除逻辑

当条件源字段被清空时，目标字段的"必填"状态应同步清除：

```
场景：用户先填写业主名称="张三"，触发售楼日期必填
      然后用户清空业主名称

处理：
  1. 重新检测"有业主信息"条件 → false
  2. 售楼日期的"待填写"状态清除（黄色虚线边框消失）
  3. 如果售楼日期为空，不再报错
  4. 如果售楼日期有值，保留值但不报必填错误
```

**关键**：每次源字段变化时，必须重新评估所有依赖该源字段的条件规则。

---

## 7. 多条件触发同一目标

售楼日期(col=5)可以被3个不同条件触发为必填：

| 条件 | 触发源 | 规则ID |
|------|--------|--------|
| 有业主信息 | col=8,9,10 任一有值 | 规则7 |
| 收房日期有值 | col=6 有值 | 规则8 |
| 入住日期有值 | col=7 有值 | 规则16 |

**逻辑**：3个条件是OR关系，任一满足则售楼日期必填。
只有3个条件全部不满足时，售楼日期才不是必填。

```typescript
function isSaleDateRequired(row: number): boolean {
  return hasOwnerInfo(row)
    || getCellText(row, 6) !== ''  // 收房日期
    || getCellText(row, 7) !== ''  // 入住日期
}
```

---

## 8. 跨行校验的时机

跨行校验（唯一性、一致性）不应在每次输入时触发，性能开销太大。

**触发时机**：
- ON_SAVE（保存前）：必须执行全部跨行校验
- ON_BLUR（失焦时）：仅校验当前字段相关的跨行规则
  - 离开"房产简称"列 → 校验唯一性
  - 离开"证件号码"列 → 校验一致性
  - 离开其他列 → 不触发跨行校验

---

## 9. 跨行校验的清除

当用户修改了导致跨行校验失败的值时，需要清除所有相关行的错误标记：

```
场景：第2行和第5行的房产简称都是"A栋-1001"
      两行都标记了"重复"错误

用户将第5行房产简称改为"A栋-1002"

处理：
  1. 清除第5行的重复错误
  2. 重新检查第2行 → 不再重复 → 清除第2行的重复错误
  3. 如果还有其他行重复，保留那些行的错误
```

---

## 10. 术语映射

后端API返回的错误信息中使用"住户"，前端必须替换为"租户"：

```typescript
function fixTerminology(message: string): string {
  return message.replace(/住户/g, '租户')
}
```

**应用位置**：所有显示给用户的错误提示信息都应经过此函数处理。

---

## 11. 已废弃规则（不要实现）

以下规则已确认废弃，不要实现：

| 原规则ID | 内容 | 废弃原因 |
|----------|------|----------|
| 房产_客户_组合唯一性 | 同一房产+客户组合唯一 | 后端已移除此约束 |

如果AI自行推断出类似规则，请忽略。

---

## 12. Luckysheet数据格式注意事项

### 12.1 getCellValue返回类型

`luckysheet.getCellValue(row, col)` 可能返回：
- `null`（空单元格）
- `number`（数字类型，如楼层=10返回数字10而非字符串"10"）
- `string`（文本）
- `object`（富文本，极少见）

**必须统一转为字符串**：`String(val).trim()`

### 12.2 日期在Luckysheet中的存储

Luckysheet可能将日期存储为数字（Excel序列号），而非字符串"YYYY-MM-DD"。

**处理方式**：

```typescript
function getCellDate(row: number, col: number): string {
  const val = luckysheet.getCellValue(row, col)
  if (val === null || val === undefined) return ''
  if (typeof val === 'number') {
    // Excel序列号转日期
    const date = new Date((val - 25569) * 86400 * 1000)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(val).trim()
}
```

### 12.3 下拉选择（select类型）的值

房产类型、客户类型等select字段的值就是选项文本本身：
- 房产类型：`"住宅"` / `"车位"` / `"商铺"` / `"写字楼"` / `"其他"`
- 业主客户类型：`"个人"` / `"企业"`
- 租户客户类型：`"个人"` / `"企业"`
- 租户证件类型：`"身份证"` / `"护照"` / `"其他"`

不需要做值映射，直接比较字符串即可。

---

## 13. 校验结果去重

同一单元格可能被多条规则同时标记错误（如售楼日期既触发"必填"又触发"格式"错误）。

**去重策略**：
- 同一单元格只显示最高严重度的错误
- 严重度排序：CRITICAL > HIGH > MEDIUM
- 错误信息合并显示，用换行分隔

```typescript
function deduplicateErrors(errors: ValidationResult[]): ValidationResult[] {
  const cellMap = new Map<string, ValidationResult>()
  for (const err of errors) {
    const key = `${err.row}-${err.col}`
    const existing = cellMap.get(key)
    if (!existing || severityRank(err.severity) > severityRank(existing.severity)) {
      cellMap.set(key, err)
    }
  }
  return Array.from(cellMap.values())
}
```

---

## 14. 性能约束

- 单次校验（一行所有规则）应在10ms内完成
- 全量校验（100行×20规则）应在500ms内完成
- 跨行校验遍历使用Map而非数组嵌套循环
- 避免在cellUpdated回调中执行耗时操作，使用setTimeout(fn, 0)延迟
