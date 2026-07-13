import { AUTO_SAVE_KEY, type AutoSaveData, type CellData } from '../types'

/** 将celldata保存到localStorage */
export function saveToLocal(celldata: CellData[]): void {
  const data: AutoSaveData = {
    timestamp: Date.now(),
    celldata,
  }
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(data))
  } catch (e) {
    console.warn('自动保存失败:', e)
  }
}

/** 从localStorage读取草稿数据 */
export function loadFromLocal(): AutoSaveData | null {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AutoSaveData
  } catch (e) {
    console.warn('读取草稿失败:', e)
    return null
  }
}

/** 清除localStorage草稿 */
export function clearLocal(): void {
  localStorage.removeItem(AUTO_SAVE_KEY)
}

/** 格式化时间戳为可读字符串 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 获取当前Luckysheet的celldata */
export function getCurrentCelldata(): CellData[] {
  const luckysheet = (window as any).luckysheet
  let flowdata: any[][] | null = null
  if (typeof luckysheet.getSheetData === 'function') flowdata = luckysheet.getSheetData()
  else if (typeof luckysheet.flowdata === 'function') flowdata = luckysheet.flowdata()
  if (!flowdata) return []

  const celldata: CellData[] = []
  for (let r = 0; r < flowdata.length; r++) {
    for (let c = 0; c < flowdata[r].length; c++) {
      const cell = flowdata[r][c]
      if (cell && (cell.v !== null && cell.v !== undefined && cell.v !== '')) {
        celldata.push({
          r,
          c,
          v: {
            v: cell.v,
            m: cell.m || String(cell.v),
            ct: cell.ct || { fa: 'General', t: 'g' },
            bl: cell.bl,
            fc: cell.fc,
            bg: cell.bg,
            ht: cell.ht,
          },
        })
      }
    }
  }
  return celldata
}
