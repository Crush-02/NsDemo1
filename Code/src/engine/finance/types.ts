/** 应收已收 - 表头列定义 */
export interface FinanceHeaderColumn {
  field: string
  label: string
  width: number
  colIndex: number
}

/** 应收已收 - 18列配置 */
export const FINANCE_HEADER_COLUMNS: FinanceHeaderColumn[] = [
  // 基本信息 A-C (col 0-2)
  { field: 'projectName', label: '项目名称', width: 120, colIndex: 0 },
  { field: 'propertyShortName', label: '房产简称', width: 120, colIndex: 1 },
  { field: 'chargeTarget', label: '收费对象', width: 120, colIndex: 2 },
  // 应收 D-M (col 3-12)
  { field: 'chargeSubject', label: '收费科目', width: 120, colIndex: 3 },
  { field: 'chargeStandard', label: '收费标准', width: 130, colIndex: 4 },
  { field: 'billingStartDate', label: '计费开始日期', width: 120, colIndex: 5 },
  { field: 'billingEndDate', label: '计费结束日期', width: 120, colIndex: 6 },
  { field: 'receivableDate', label: '应收日期', width: 110, colIndex: 7 },
  { field: 'receivableAmount', label: '应收金额', width: 100, colIndex: 8 },
  { field: 'exemptionAmount', label: '减免金额', width: 100, colIndex: 9 },
  { field: 'exemptionCategory', label: '减免分类', width: 120, colIndex: 10 },
  { field: 'exemptionDate', label: '减免日期', width: 110, colIndex: 11 },
  { field: 'receivableRemark', label: '应收备注', width: 150, colIndex: 12 },
  // 已收 N-R (col 13-17)
  { field: 'paymentAmount', label: '缴款金额', width: 100, colIndex: 13 },
  { field: 'paymentDate', label: '缴款日期', width: 110, colIndex: 14 },
  { field: 'paymentMethod', label: '支付方式', width: 110, colIndex: 15 },
  { field: 'paymentRemark', label: '已收备注', width: 150, colIndex: 16 },
  { field: 'contractNo', label: '合同编号', width: 130, colIndex: 17 },
]

/** 应收已收 - 自动保存的localStorage key */
export const FINANCE_AUTO_SAVE_KEY = 'smartform_finance_receivable_draft'

/** 应收已收 - 总列数 */
export const FINANCE_COL_COUNT = FINANCE_HEADER_COLUMNS.length

/** 表头行数（分类行 + 注意事项行 + 格式提示行 + 列名行） */
export const FINANCE_HEADER_ROW_COUNT = 4

/** 表头行数据（对应Excel模板前4行） */
export const FINANCE_HEADER_ROWS: string[][] = [
  // Row 0: 分类行
  ['基本信息', '', '', '应收', '', '', '', '', '', '', '', '', '', '已收', '', '', '', ''],
  // Row 1: 注意事项
  [
    '注意事项：\n1.红色为必填项\n2.请勿修改表头',
    '房产简称必须与房产导入表中保持一致，否则无法导入',
    '收费对象为房产导入表中的业主/租户姓名',
    '1.请财务核对各项目收费科目命名规则是否一致\n2.收费标准需加上单位，如2.5元/平方/月',
    '',
    '1.日期格式：XXXX/XX/XX\n2.应收日期一般为月初或月末',
    '', '',
    '1.应收金额填欠费总金额\n2.若有减免则减免分类、减免日期也需填写',
    '', '', '', '',
    '缴款金额需小于等于实际应收金额',
    '日期格式：XXXX/XX/XX',
    '下拉选择', '', '',
  ],
  // Row 2: 格式提示
  ['', '', '', '', '', '“短日期”格式', '“短日期”格式', '“短日期”格式',
   '"数值"格式，最多保疙2位小数', '"数值"格式，最多保疙2位小数',
   '下拉框', '"短日期"格式', '',
   '"数值"格式，最多保疙2位小数', '格式"短日期"', '下拉选择', '', ''],
  // Row 3: 列名
  FINANCE_HEADER_COLUMNS.map(col => col.label),
]

/** 支付方式可选值 */
export const PAYMENT_METHODS = ['现金', '银行转账', '微信', '支付宝', '对公转账']

/** 减免分类可选值 */
export const EXEMPTION_CATEGORIES = ['空置减免', '特殊减免', '活动优惠减免']

/** 日期列: 计费开始/结束/应收/减免/缴款 (col 5,6,7,11,14) */
export const FINANCE_DATE_COLUMNS = [5, 6, 7, 11, 14]

/** 金额列: 应收/减免/缴款 (col 8,9,13) */
export const FINANCE_AMOUNT_COLUMNS = [8, 9, 13]

/** 必填列索引: 项目名称(0), 房产简称(1), 收费对象(2), 收费科目(3), 计费开始日期(5), 计费结束日期(6), 应收金额(8) */
export const FINANCE_REQUIRED_COLUMNS = [0, 1, 2, 3, 5, 6, 8]
