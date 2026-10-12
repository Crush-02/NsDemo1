# smartform-dev-kit 项目长期笔记（D:\WorkFile\Code\NsCode\Code）

## 导入日期处理：两级归一（重要架构约定）

导入链路上有**两个**归一环节，新增模块时必须两个都接上：

| 环节 | 位置 | 判定依据 | 覆盖 |
|---|---|---|---|
| ① 单元格级 | `utils/excelIO.ts` → `readExcelFile` 内 `buildDateMap()` | `cell.t==='n' && SSF.is_date(cell.z)`（**Excel 自己认定是日期**） | 数字序列号 + 日期格式的单元格 |
| ② 列级 | `utils/excelIO.ts` → `normalizeDateColumns(rows, dateCols)` | 值匹配 `^\d{4}[.\-/]M[.\-/]D$` 或 `^\d{4}年M月D日$` + 真实日期回环校验 | 文本型日期（如 `2024.10.1`） |

- ② **必须在 `remapRows` 之后调用**，因为传入的是**工具侧列索引**
- 列清单统一取自 `engine/simpleValidator.ts` 的 `DATE_COLUMNS`（房产）与 `engine/finance/types.ts` 的 `FINANCE_DATE_COLUMNS`（应收），已导出
- 只认 **4 位年在前**（顺序无歧义）；2 位年、一格两个日期的脏数据**一律不动**，继续报错让人工核对

## xlsx 读取参数（踩过的坑）

- **必须传 `cellNF: true`** —— 不传时 `cell.z`（数字格式串）是 `undefined`，日期判定失效
- **不要用 `cellDates: true`** —— 它把序列号换成 Date，而该 Date 有约 **−43 秒偏移**，`dayjs(v).format('YYYY-MM-DD')` 会**差一天**。正确做法是保留序列号用 `SSF.format('yyyy-mm-dd', v)`
- `sheet_to_json` 的数组下标以 **`!ref` 起点为原点**，不是绝对行号
- `SSF.format` 边界：`serial=0`→`1900-01-00`、`60`→`1900-02-29`、`2958466`→空串，需守卫并用正则兜底

## Luckysheet 的日期识别（解释很多显示异常的根因）

- 写入任何单元格都会经过 `Cs()` → `xs()` → `ds()` 自动判定并**原地改写**单元格类型/格式
- `ds()` 的正则**只接受 4 位年 + `-`/`/` 分隔**：`2026/6/1` 会被转成日期型显示 `2026-06-01`，而 `5/31/27`、`2024.10.1` **不被识别**，保持文本
- 结论：**同一列出现"一半归一、一半没归一"不是业务代码干的，是 Luckysheet 干的**

## 列序陷阱

- **工具列索引 ≠ Excel 列索引**：房产模块工具侧 32 列、Excel 模板 30 列，**自 col19 起偏移 2**（工具多了业主证件类型/号码）
- 凡涉及"按列号操作"的逻辑，都要先确认是 Excel 侧还是工具侧
- 金桂家园《应收、已收导入模板》`!ref = A1:AA10`，实际 **27 列**（表头行到「收款人」），不要只看前 20 列就下结论

## 用户真实数据里的日期形态（10 个模板 16.5 万格实测）

99.6% 是「数字序列号 + 日期格式」（两级归一后已全覆盖）；剩余 0.2% 文本型中 93% 是 `YYYY.M.D`（如 `2026.2.6`、`2030.3.31`），集中在**缴款日期**与**减免日期**列。

## Luckysheet 性能红线：建表必须传 `data`，不能只传 `celldata`

**`buildGridData` 在只给 `celldata` 时是 O(行数²)**：它以空表起步，`celldata` 按行递增排列，
每遇到一个新行号就调用 `Zo()` **复制整张已建好的表**（`for c in rows: e[c] = [].concat(...)`），
再叠加新行。实测（真实 Chromium，同数据同配置）：

| 行数 | 只传 `celldata` | 同时传 `data`（二维数组） |
|---|---|---|
| 5,000 | 3,513 ms | **93 ms** |
| 10,000 | 14,649 ms | **134 ms** |
| 20,000 | 62,462 ms | **264 ms** |
| 44,579 | **> 180,000 ms（卡死）** | **545 ms** |

- 空 `celldata` + 1 万行 → 19 ms（**成本由"有数据的行数"驱动，与列数无关**）
- CPU Profile 热点：`initialjfFile` 自耗时 **75.8%**
- 正确姿势：`luckysheet.create({ data: [{ data: <二维数组>, config: { row, column } }] })`
  —— 二维数组下标=行号，元素为 `{v,m,ct}` 或 `null`；**不要传 `celldata`**
- 附带影响：Luckysheet 不再维护 `sheet.celldata`，`handleBulkEdit`/`handleBulkDelete` 的
  celldata 双写逻辑需一并回归

## Luckysheet 的 celldata 语义（实测，别被注释误导）

- **Luckysheet 从不回写 `celldata`**：`create` 后它就是只读快照，`setCellValue` 只改 `flowdata`。
  实测：`setCellValue(5,1,'EDITED')` 后 `flowdata` 变为 EDITED，而 `celldata` 中 (5,1) 仍是原值。
  ⇒ 项目里「flowdata + celldata 双写」**不是配合 Luckysheet**，而是在维护一份没人读的副本。
  ⇒ 即使**不改**走 `data`，这段双写也是冗余的。
- 只传 `data` 时 `sheet.celldata` **键不存在**（`hasOwnProperty` = false）；代码里
  `sheet?.celldata || []` 会拿到临时空数组，`push` 进去直接丢弃 → 无副作用。
- Luckysheet 内部真正读 `sheet.celldata` 的只有**多表懒加载**（`loadSheetUrl`，本项目未启用）；
  其余 `celldata` 命中都是 `iscelldata()`（区域格式判断）和透视表自身的 `celldata`（同名不同物）。
- 需要 celldata 时可用官方 `luckysheet.transToCellData()` 一次性从 flowdata 重建，不必逐格双写。
- **本项目 Luckysheet 无 `getSheetByIndex` / `getCurrentSheetIndex`** → 代码里
  `ls?.getSheetByIndex?.(idx) || ls?.getSheet?.()` 实际总是回退到 `getSheet()`（可用 API：
  `getluckysheetfile()` / `getAllSheets()` / `getSheet()` / `getSheetData()` / `transToCellData`）。

## 本机工具链环境（2026-10-08 记录）

- **`node_modules/.bin` 为空**（软链被清）→ `npx vite` / `npx esbuild` 会报「不是内部或外部命令」。
  绕行：`node node_modules/vite/bin/vite.js`、`node node_modules/esbuild/bin/esbuild`
- 沙箱内 `curl localhost` 走代理会返回 502，**必须加 `--noproxy '*'`**
- Node 运行时路径：`C:/Users/123/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`
- 无 vite CLI 时跑浏览器实验的省事组合：`python -m http.server <port> --bind 127.0.0.1` 托管 `dist/`，
  再用 CDP 驱动 `C:/Users/123/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`

## 验证/量测技巧（本项目已跑通）

- **CDP 驱动 Chromium 免 Playwright 复现**：直接 spawn
  `C:/Users/123/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
  （`--headless=new --remote-debugging-port=xxxx --user-data-dir=<tmp>`），
  Node 22 自带全局 `WebSocket` 即可发 CDP 命令；用 `DOM.setFileInputFiles` 可真实走 UI 导入流程
- **踩坑**：Node 脚本直接 `console.log` 时曾出现输出丢失 → **务必把输出重定向到文件再读**
- **踩坑**：`XLSX.read` 不传 `cellNF` 时 `cell.z` 为 `undefined`；`cellDates: true` 的 Date 有 −43 秒偏移（差一天）
- 浏览器多轮量测之间要 `HeapProfiler.collectGarbage`，否则堆增长会污染后续结果

## 工作约定

- 默认**只改本地，不 commit、不 push**
- 编码前先出方案，用户确认后再动手
- 验证方式：esbuild 打包真实源码跑 Node 断言（见技能 `smartform-engine-verify`），收尾跑 `npx vue-tsc --noEmit` 与 `rm -rf dist && npm run build`（构建需绕过沙箱）
