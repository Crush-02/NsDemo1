import XLSX from 'xlsx';
import { statSync } from 'fs';

const HEADERS = [
  '房产简称', '楼层', '房号', '房产类型', '计费面积',
  '售楼日期', '收房日期', '入住日期', '业主名称', '业主联系电话',
  '业主证件号码', '业主客户类型', '业主联系人', '租户名称', '租户联系电话',
  '租户证件号码', '租户证件类型', '租户客户类型', '租户联系人',
  '出租开始日期', '出租结束日期', '备注', '项目编号', '栋座', '单元'
];

const BUILDINGS = ['A栋', 'B栋', 'C栋', 'D栋', 'E栋'];
const UNITS = ['1单元', '2单元', '3单元'];
const PROPERTY_TYPES = ['住宅', '商铺', '办公', '车库', '仓库'];
const CUSTOMER_TYPES = ['个人', '企业'];
const ID_TYPES = ['身份证', '营业执照', '护照', '其他'];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[rand(0, arr.length - 1)];
}

function randomDate(yearStart = 2015, yearEnd = 2025) {
  const y = rand(yearStart, yearEnd);
  const m = rand(1, 12);
  const d = rand(1, 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function randomPhone() {
  const prefixes = ['138', '139', '150', '151', '186', '187', '188', '189'];
  return pick(prefixes) + String(rand(10000000, 99999999));
}

function randomIdNumber(type) {
  switch (type) {
    case '身份证':
      // 合法18位身份证号格式
      const areaCodes = ['110101', '310101', '440305', '330102', '510104'];
      return pick(areaCodes) + String(rand(20000101, 20231231)) + String(rand(100, 999));
    case '营业执照':
      return '91' + String(rand(1000000000000, 9999999999999));
    default:
      return String(rand(1000000000000000000, 9999999999999999999));
  }
}

function randomArea() {
  return (rand(4000, 250000) / 100).toFixed(2);
}

// 生成房产简称: 项目编号-栋座-单元-楼层-房号
function genPropAbbr(projNo, building, unit, floor, room) {
  return `${projNo}-${building.replace('栋', '')}-${unit.replace('单元', '')}-${floor}${room}`;
}

const TOTAL_ROWS = 2000;
const MISSING_RATE = 0.30;   // ~30% 缺失必填字段
const FORMAT_ERR_RATE = 0.20; // ~20% 格式错误
const DUP_RATE = 0.10;        // ~10% 重复房产简称

const data = [HEADERS];

// 预选一些行号用于重复房产简称 (10% = 200行，其中100行会复制前面某行的简称)
const dupRowIndices = new Set();
while (dupRowIndices.size < 200) {
  dupRowIndices.add(rand(2, TOTAL_ROWS + 1)); // 数据行从索引2开始（index 1是表头）
}

// 记录已使用的房产简称，用于生成重复值
const usedAbbrs = [];

for (let i = 1; i <= TOTAL_ROWS; i++) {
  const rowIdx = i; // 数据行号 (1-based for logic)
  const r = Math.random();
  let category;

  if (r < MISSING_RATE) {
    category = 'missing';
  } else if (r < MISSING_RATE + FORMAT_ERR_RATE) {
    category = 'format_err';
  } else if (r < MISSING_RATE + FORMAT_ERR_RATE + DUP_RATE) {
    category = 'duplicate';
  } else {
    category = 'correct';
  }

  const projNo = `PRJ${String(rand(1, 20)).padStart(3, '0')}`;
  const building = pick(BUILDINGS);
  const unit = pick(UNITS);
  const floor = rand(1, 33);
  const room = String(rand(1, 12)).padStart(2, '0');
  const propType = pick(PROPERTY_TYPES);
  const area = randomArea();

  let abbr = genPropAbbr(projNo, building, unit, floor, room);

  // 处理重复房产简称
  if (category === 'duplicate' && usedAbbrs.length > 0) {
    abbr = pick(usedAbbrs);
  }
  usedAbbrs.push(abbr);

  const saleDate = randomDate(2015, 2022);
  const collectDate = randomDate(2018, 2024);
  const checkinDate = randomDate(2019, 2025);
  const ownerName = `业主${String(i).padStart(4, '0')}`;
  const ownerPhone = randomPhone();
  const ownerCustType = pick(CUSTOMER_TYPES);
  const ownerIdType = '身份证';
  const ownerIdNum = randomIdNumber(ownerIdType);
  const ownerContact = `联系人${String.fromCharCode(65 + (i % 26))}`;

  const hasTenant = Math.random() > 0.4; // 60%有租户
  const tenantName = hasTenant ? `租户${String(i).padStart(4, '0')}` : '';
  const tenantPhone = hasTenant ? randomPhone() : '';
  const tenantIdType = hasTenant ? pick(ID_TYPES) : '';
  const tenantIdNum = hasTenant ? randomIdNumber(tenantIdType) : '';
  const tenantCustType = hasTenant ? pick(CUSTOMER_TYPES) : '';
  const tenantContact = hasTenant ? `租户联系人${String.fromCharCode(65 + ((i + 3) % 26))}` : '';

  const leaseStart = hasTenant ? randomDate(2022, 2024) : '';
  const leaseEnd = hasTenant ? randomDate(2024, 2027) : '';

  const remark = category === 'missing' || category === 'format_err'
    ? `[测试${category}]第${i}行`
    : '';

  // 构建基础完整行
  let row = [
    abbr,
    floor,
    room,
    propType,
    area,
    saleDate,
    collectDate,
    checkinDate,
    ownerName,
    ownerPhone,
    ownerIdNum,
    ownerCustType,
    ownerContact,
    tenantName,
    tenantPhone,
    tenantIdNum,
    tenantIdType,
    tenantCustType,
    tenantContact,
    leaseStart,
    leaseEnd,
    remark,
    projNo,
    building,
    unit
  ];

  // === 缺失必填字段场景 (~30%) ===
  if (category === 'missing') {
    const missType = rand(1, 8);
    switch (missType) {
      case 1: row[0] = ''; break;           // 房产简称缺失
      case 2: row[3] = ''; break;           // 房产类型缺失
      case 4: row[6] = ''; break;           // 收房日期缺失
      case 5: row[8] = ''; break;           // 业主名称缺失
      case 6: row[9] = ''; break;           // 业主联系电话缺失
      case 7: row[10] = ''; break;          // 业主证件号码缺失
      case 8: row[22] = ''; break;          // 项目编号缺失
      case 3:
        row[4] = ''; break;                 // 计费面积缺失
    }
  }

  // === 格式错误场景 (~20%) ===
  if (category === 'format_err') {
    const errType = rand(1, 10);
    switch (errType) {
      case 1: row[5] = '2024/03/15'; break;                    // 日期用斜杠
      case 2: row[5] = '2024年3月15日'; break;                  // 中文日期
      case 3: row[9] = '138abc12345'; break;                     // 电话含字母
      case 4: row[9] = '12345'; break;                          // 电话太短
      case 5: row[10] = 'abc123xyz'; break;                      // 证件号码含字母且长度不对
      case 6: row[10] = '110101123'; break;                      // 证件号码太短
      case 7: row[4] = '不是数字'; break;                         // 面积非数字
      case 8: row[4] = '-50.00'; break;                          // 面积负数
      case 9: row[15] = '短号码'; break;                         // 租户证件号码太短
      case 10: row[19] = '13/05/2024'; break;                   // 出租日期格式错
    }
  }

  data.push(row);
}

const ws = XLSX.utils.aoa_to_sheet(data);

// 设置列宽
ws['!cols'] = HEADERS.map((h, idx) => {
  const widths = [22, 6, 8, 10, 12, 14, 14, 14, 14, 16, 22, 10, 14, 14, 16, 22, 10, 10, 14, 14, 14, 20, 10, 8, 8];
  return { wch: widths[idx] || 12 };
});

// 冻结首行
ws['!rows'] = [{ hidden: false }]; // 表头行样式提示

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '房产数据');

const outputPath = 'test-large-2000rows.xlsx';
XLSX.writeFile(wb, outputPath);

console.log(`✅ 已生成测试文件: ${outputPath}`);
console.log(`   总行数: ${TOTAL_ROWS} 行数据 (+ 1 行表头)`);
console.log(`   文件大小: ${(statSync(outputPath).size / 1024).toFixed(1)} KB`);

// 统计各类数据
let missingCount = 0, formatErrCount = 0, dupCount = 0, correctCount = 0;
for (let i = 1; i <= TOTAL_ROWS; i++) {
  const cat = data[i][21]; // 通过备注列反推
  if (cat?.includes('missing')) missingCount++;
  else if (cat?.includes('format_err')) formatErrCount++;
  else if (data[i].some((cell, ci) => ci === 0 && usedAbbrs.filter(u => u === cell).length > 1)) {
    // 简化统计：通过备注或重复检测
    if (!cat?.includes('missing') && !cat?.includes('format_err')) {
      if (dupRowIndices.has(i + 1)) dupCount++;
      else correctCount++;
    }
  } else {
    if (!cat?.includes('missing') && !cat?.includes('format_err')) correctCount++;
  }
}
console.log(`   数据分布:`);
console.log(`     - 缺失必填字段 (CRITICAL): ~${Math.round(missingCount / TOTAL_ROWS * 100)}% (${missingCount} 行)`);
console.log(`     - 格式错误:              ~${Math.round(formatErrCount / TOTAL_ROWS * 100)}% (${formatErrCount} 行)`);
console.log(`     - 重复房产简称:          ~${Math.round(dupCount / TOTAL_ROWS * 100)}% (${dupCount} 行)`);
console.log(`     - 正确数据:              ~${Math.round(correctCount / TOTAL_ROWS * 100)}% (${correctCount} 行)`);
