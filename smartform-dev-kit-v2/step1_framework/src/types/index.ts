/** 表头列定义 */
export interface HeaderColumn {
  field: string
  label: string
  width: number
  colIndex: number
}

/** Luckysheet单元格数据格式 */
export interface CellData {
  r: number
  c: number
  v: {
    v: string | number
    m: string
    ct: { fa: string; t: string }
    bl?: number
    fc?: string
    bg?: string
    ht?: number
  }
}

/** 自动保存的数据结构 */
export interface AutoSaveData {
  timestamp: number
  celldata: CellData[]
}

/** Luckysheet全局对象类型 */
export interface LuckysheetGlobal {
  create: (options: Record<string, any>) => void
  getCellValue: (row: number, col: number, setting?: Record<string, any>) => any
  setCellValue: (row: number, col: number, value: any, setting?: Record<string, any>) => void
  getFlowdata: () => any[][] | null
  setCellStyle: (row: number, col: number, style: Record<string, any>) => void
  getRange: () => any[]
  destroy: () => void
}

/** 表头列配置 - 25列 */
export const HEADER_COLUMNS: HeaderColumn[] = [
  { field: 'propertyName', label: '房产简称', width: 150, colIndex: 0 },
  { field: 'floor', label: '楼层', width: 80, colIndex: 1 },
  { field: 'roomNo', label: '房号', width: 80, colIndex: 2 },
  { field: 'propertyType', label: '房产类型', width: 100, colIndex: 3 },
  { field: 'billingArea', label: '计费面积', width: 120, colIndex: 4 },
  { field: 'saleDate', label: '售楼日期', width: 120, colIndex: 5 },
  { field: 'receiveDate', label: '收房日期', width: 120, colIndex: 6 },
  { field: 'moveInDate', label: '入住日期', width: 120, colIndex: 7 },
  { field: 'ownerName', label: '业主名称', width: 120, colIndex: 8 },
  { field: 'ownerPhone', label: '业主联系电话', width: 130, colIndex: 9 },
  { field: 'ownerIdNo', label: '业主证件号码', width: 180, colIndex: 10 },
  { field: 'ownerCustType', label: '业主客户类型', width: 110, colIndex: 11 },
  { field: 'ownerContact', label: '业主联系人', width: 120, colIndex: 12 },
  { field: 'tenantName', label: '租户名称', width: 120, colIndex: 13 },
  { field: 'tenantPhone', label: '租户联系电话', width: 130, colIndex: 14 },
  { field: 'tenantIdNo', label: '租户证件号码', width: 180, colIndex: 15 },
  { field: 'tenantIdType', label: '租户证件类型', width: 110, colIndex: 16 },
  { field: 'tenantCustType', label: '租户客户类型', width: 110, colIndex: 17 },
  { field: 'tenantContact', label: '租户联系人', width: 120, colIndex: 18 },
  { field: 'rentStartDate', label: '出租开始日期', width: 130, colIndex: 19 },
  { field: 'rentEndDate', label: '出租结束日期', width: 130, colIndex: 20 },
  { field: 'remark', label: '备注', width: 200, colIndex: 21 },
  { field: 'projectNo', label: '项目编号', width: 100, colIndex: 22 },
  { field: 'building', label: '栋座', width: 80, colIndex: 23 },
  { field: 'unit', label: '单元', width: 80, colIndex: 24 },
]

/** 自动保存的localStorage key */
export const AUTO_SAVE_KEY = 'smartform_property_import_draft'
