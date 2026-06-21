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
  getSheetData: () => any[][] | null
  flowdata: () => any[][] | null
  setCellFormat: (row: number, col: number, attr: string, value: any, setting?: Record<string, any>) => void
  getRange: () => any[]
  setRangeShow: (range: any, setting?: Record<string, any>) => void
  destroy: () => void
}

/** 表头列配置 - 30列（以房产数据导入-SaaS版模板为准） */
export const HEADER_COLUMNS: HeaderColumn[] = [
  { field: 'projectName', label: '项目名称', width: 120, colIndex: 0 },
  { field: 'areaName', label: '管理区域名称', width: 120, colIndex: 1 },
  { field: 'buildingName', label: '楼栋名称', width: 100, colIndex: 2 },
  { field: 'unitName', label: '单元名称', width: 100, colIndex: 3 },
  { field: 'floor', label: '楼层', width: 80, colIndex: 4 },
  { field: 'roomNo', label: '房号', width: 80, colIndex: 5 },
  { field: 'propertyName', label: '房产简称', width: 150, colIndex: 6 },
  { field: 'billingArea', label: '计费面积', width: 120, colIndex: 7 },
  { field: 'propertyType', label: '房产类型', width: 100, colIndex: 8 },
  { field: 'relatedProperty', label: '关联房产简称', width: 130, colIndex: 9 },
  { field: 'propertyRemark', label: '房产备注', width: 150, colIndex: 10 },
  { field: 'certificateNo', label: '产权证书号', width: 150, colIndex: 11 },
  { field: 'saleDate', label: '售楼日期', width: 120, colIndex: 12 },
  { field: 'receiveDate', label: '收房日期', width: 120, colIndex: 13 },
  { field: 'moveInDate', label: '入住日期', width: 120, colIndex: 14 },
  { field: 'ownerCustType', label: '业主客户类型', width: 110, colIndex: 15 },
  { field: 'ownerName', label: '业主客户名称', width: 120, colIndex: 16 },
  { field: 'ownerType', label: '业主类型', width: 100, colIndex: 17 },
  { field: 'ownerPhone', label: '业主联系电话', width: 130, colIndex: 18 },
  { field: 'ownerIdType', label: '业主证件类型', width: 110, colIndex: 19 },
  { field: 'ownerIdNo', label: '业主证件号码', width: 180, colIndex: 20 },
  { field: 'ownerContact', label: '企业联系人', width: 120, colIndex: 21 },
  { field: 'ownerRemark', label: '业主备注', width: 150, colIndex: 22 },
  { field: 'rentStartDate', label: '出租开始日期', width: 130, colIndex: 23 },
  { field: 'rentEndDate', label: '出租结束日期', width: 130, colIndex: 24 },
  { field: 'tenantCustType', label: '租户客户类型', width: 110, colIndex: 25 },
  { field: 'tenantName', label: '租户客户名称', width: 120, colIndex: 26 },
  { field: 'tenantPhone', label: '租户联系电话', width: 130, colIndex: 27 },
  { field: 'tenantContact', label: '租户企业联系人', width: 120, colIndex: 28 },
  { field: 'tenantIdType', label: '租户证件类型', width: 110, colIndex: 29 },
  { field: 'tenantIdNo', label: '租户证件号码', width: 180, colIndex: 30 },
  { field: 'tenantRemark', label: '租户备注', width: 150, colIndex: 31 },
]

/** 自动保存的localStorage key */
export const AUTO_SAVE_KEY = 'smartform_property_import_draft'
