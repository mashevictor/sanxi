/**
 * Excel 数据导入服务
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import {
  Customer,
  Employee,
  InvestmentPark,
  CustomerType,
  DispatchStatus,
  EmployeeStatus,
  EmployeeRole,
  PlusLevel,
  TimeSlot,
} from '../types';
import {
  parseTimeSlot,
  parsePlusCount,
  getPlusLevel,
  parseEmployeeRoles,
  parseEmployeeStatus,
  parsePlusCapabilities,
  parseOrderCapacity,
  parseDateTime,
  detectHandInHand,
} from '../utils/parsers';

export interface ImportResult {
  parks: InvestmentPark[];
  customers: Customer[];
  employees: Employee[];
  cities: string[];
  stats: {
    firstVisitCount: number;
    projectCount: number;
    followUpCount: number;
    employeeCount: number;
    handInHandGroups: number;
  };
}

let customerIdCounter = 1;
let employeeIdCounter = 1;
let cityIdCounter = 1;
let parkIdCounter = 1;

const cityMap = new Map<string, number>();
const parkMasterMap = new Map<string, InvestmentPark>();

function getOrCreateCityId(name: string): number {
  if (!cityMap.has(name)) cityMap.set(name, cityIdCounter++);
  return cityMap.get(name)!;
}

/** 获取或创建园区主数据（从客户单中的园区名自动补全，或由园区表导入） */
function getOrCreatePark(name: string, cityName = '上海市', address?: string): InvestmentPark {
  if (!parkMasterMap.has(name)) {
    const cityId = getOrCreateCityId(cityName);
    parkMasterMap.set(name, {
      id: parkIdCounter++,
      name,
      cityId,
      cityName,
      address: address || '',
      status: 'ACTIVE',
    });
  } else if (address && !parkMasterMap.get(name)!.address) {
    parkMasterMap.get(name)!.address = address;
  }
  return parkMasterMap.get(name)!;
}

function getParkId(name: string): number {
  return getOrCreatePark(name).id;
}

function resetCounters(): void {
  customerIdCounter = 1;
  employeeIdCounter = 1;
  cityIdCounter = 1;
  parkIdCounter = 1;
  cityMap.clear();
  parkMasterMap.clear();
}

/** 从园区表 Excel 导入（可选）列：园区名称, 城市, 园区地址 */
function importParksFromBuffer(buffer: Buffer): void {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet);
  for (const row of rows) {
    const name = String(row['园区名称'] || row['招商园区'] || row['园区名'] || '');
    if (!name) continue;
    getOrCreatePark(
      name,
      String(row['城市'] || row['地区'] || '上海市'),
      String(row['园区地址'] || row['地址'] || '')
    );
  }
}

function importParksFromSheet(filePath: string): void {
  importParksFromBuffer(fs.readFileSync(filePath));
}

/** 从 Excel 文件导入客户数据 */
function importCustomersFromWorkbook(
  workbook: XLSX.WorkBook,
  customerType: CustomerType,
  timeColumn: string,
  addressColumn: string,
  plusColumn: string
): Customer[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet);

  return rows.map((row) => {
    const companyName = String(row['企业全称 *'] || row['企业全称'] || '');
    const appointmentTime = String(row[timeColumn] || '');
    const address = String(row[addressColumn] || '');
    const parkName = String(row['招商园区'] || '');
    const plusCount = parsePlusCount(String(row[plusColumn] || '0次'));
    const designatedPerson = row['指定人'] ? String(row['指定人']) : undefined;
    const rejectedPerson = row['放弃人'] ? String(row['放弃人']) : undefined;
    const remark = row['备注'] ? String(row['备注']) : undefined;

    const cityName = '上海市';
    const cityId = getOrCreateCityId(cityName);
    const park = getOrCreatePark(parkName, cityName);

    return {
      id: customerIdCounter++,
      companyName,
      address,
      customerType,
      appointmentTime: parseDateTime(appointmentTime),
      timeSlot: parseTimeSlot(appointmentTime),
      cityId,
      cityName,
      parkId: park.id,
      parkName: park.name,
      plusCount,
      plusLevel: getPlusLevel(plusCount),
      designatedPerson,
      rejectedPerson,
      isHandInHand: detectHandInHand(remark),
      handInHandGroup: undefined,
      remark,
      dispatchStatus: DispatchStatus.PENDING,
    };
  });
}

function importCustomersFromSheet(
  filePath: string,
  customerType: CustomerType,
  timeColumn: string,
  addressColumn: string,
  plusColumn: string
): Customer[] {
  return importCustomersFromWorkbook(
    XLSX.readFile(filePath),
    customerType,
    timeColumn,
    addressColumn,
    plusColumn
  );
}

function importCustomersFromBuffer(
  buffer: Buffer,
  customerType: CustomerType,
  timeColumn: string,
  addressColumn: string,
  plusColumn: string
): Customer[] {
  return importCustomersFromWorkbook(
    XLSX.read(buffer, { type: 'buffer' }),
    customerType,
    timeColumn,
    addressColumn,
    plusColumn
  );
}

/** 从 Excel 导入员工基础信息（派单前主数据，非派单结果） */
function importEmployeesFromWorkbook(workbook: XLSX.WorkBook): Employee[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const dataRows = rawData.slice(2) as string[][];

  return dataRows
    .filter((row) => row[0] && row[0].trim())
    .map((row) => {
      const name = String(row[0] || '');
      const cityName = String(row[1] || '上海市');
      const serviceParkName = String(row[2] || ''); // Excel列「招商园区」= 负责服务的园区
      const roles = parseEmployeeRoles(String(row[3] || ''));
      const status = parseEmployeeStatus(String(row[4] || '正常'));
      const departureAddress = String(row[5] || '');
      const plusCapabilities = parsePlusCapabilities(String(row[6] || ''));
      const orderCapacity = parseOrderCapacity(String(row[7] || ''));
      const remark = row[8] ? String(row[8]) : undefined;

      const cityId = getOrCreateCityId(cityName);
      const servicePark = getOrCreatePark(serviceParkName, cityName);

      return {
        id: employeeIdCounter++,
        name,
        cityId,
        cityName,
        serviceParkId: servicePark.id,
        serviceParkName: servicePark.name,
        roles,
        status,
        departureAddress,
        plusCapabilities,
        orderCapacity,
        remark,
      };
    });
}

function importEmployeesFromSheet(filePath: string): Employee[] {
  return importEmployeesFromWorkbook(XLSX.readFile(filePath, { type: 'file' }));
}

function importEmployeesFromBuffer(buffer: Buffer): Employee[] {
  return importEmployeesFromWorkbook(XLSX.read(buffer, { type: 'buffer' }));
}

/** 处理牵手单分组 */
function processHandInHandGroups(customers: Customer[]): void {
  const handInHandCustomers = customers.filter((c) => c.isHandInHand);
  const groups = new Map<string, Customer[]>();

  for (const customer of handInHandCustomers) {
    const key = customer.remark || 'default';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(customer);
  }

  let groupIndex = 1;
  for (const [, groupCustomers] of groups) {
    const groupId = `HIH_GROUP_${groupIndex++}`;
    for (const customer of groupCustomers) {
      customer.handInHandGroup = groupId;
    }
  }
}

/** 从数据目录导入所有测试数据 */
export function importAllData(dataDir: string): ImportResult {
  resetCounters();

  const parkPath = path.join(dataDir, '园区数据.xlsx');
  if (fs.existsSync(parkPath)) importParksFromSheet(parkPath);

  const firstVisitPath = path.join(dataDir, '首访数据.xlsx');
  const projectPath = path.join(dataDir, '项目数据.xlsx');
  const followUpPath = path.join(dataDir, '回访数据.xlsx');
  const employeePath = path.join(dataDir, '派单员工表 (1).xls');

  const firstVisitCustomers = fs.existsSync(firstVisitPath)
    ? importCustomersFromSheet(firstVisitPath, CustomerType.FIRST_VISIT, '首访日期时间', '首访地址', '首访PlusN次')
    : [];

  const projectCustomers = fs.existsSync(projectPath)
    ? importCustomersFromSheet(projectPath, CustomerType.PROJECT, '项目+日期时间', '项目+拜访人地址', '项目PlusN次')
    : [];

  const followUpCustomers = fs.existsSync(followUpPath)
    ? importCustomersFromSheet(followUpPath, CustomerType.FOLLOW_UP, '回访+日期时间', '回访+拜访人地址', '回访PlusN次')
    : [];

  const allCustomers = [...firstVisitCustomers, ...projectCustomers, ...followUpCustomers];
  processHandInHandGroups(allCustomers);

  const employees = fs.existsSync(employeePath)
    ? importEmployeesFromSheet(employeePath).filter((e) => e.status === EmployeeStatus.ACTIVE)
    : [];

  const handInHandGroups = new Set(
    allCustomers.filter((c) => c.handInHandGroup).map((c) => c.handInHandGroup)
  ).size;

  return {
    parks: Array.from(parkMasterMap.values()),
    customers: allCustomers,
    employees,
    cities: Array.from(cityMap.keys()),
    stats: {
      firstVisitCount: firstVisitCustomers.length,
      projectCount: projectCustomers.length,
      followUpCount: followUpCustomers.length,
      employeeCount: employees.length,
      handInHandGroups,
    },
  };
}

/** 导入演示数据：5个园区 + 5名员工（数量一致） */
export function importDemoData(dataDir: string): ImportResult {
  resetCounters();

  const parkPath = path.join(dataDir, '园区数据.xlsx');
  if (fs.existsSync(parkPath)) importParksFromSheet(parkPath);

  const demoParks = [
    '加盟-金山资本现代产业园',
    '宝山高新',
    '山东济南',
    '江苏徐州',
    '江苏镇江',
  ];

  const firstVisitPath = path.join(dataDir, '首访数据.xlsx');
  const projectPath = path.join(dataDir, '项目数据.xlsx');
  const followUpPath = path.join(dataDir, '回访数据.xlsx');
  const employeePath = path.join(dataDir, '员工基础表_示例.xlsx');
  const fallbackEmployeePath = path.join(dataDir, '派单员工表 (1).xls');

  const firstVisitCustomers = fs.existsSync(firstVisitPath)
    ? importCustomersFromSheet(firstVisitPath, CustomerType.FIRST_VISIT, '首访日期时间', '首访地址', '首访PlusN次')
    : [];
  const projectCustomers = fs.existsSync(projectPath)
    ? importCustomersFromSheet(projectPath, CustomerType.PROJECT, '项目+日期时间', '项目+拜访人地址', '项目PlusN次')
    : [];
  const followUpCustomers = fs.existsSync(followUpPath)
    ? importCustomersFromSheet(followUpPath, CustomerType.FOLLOW_UP, '回访+日期时间', '回访+拜访人地址', '回访PlusN次')
    : [];

  const allCustomers = [...firstVisitCustomers, ...projectCustomers, ...followUpCustomers]
    .filter((c) => demoParks.includes(c.parkName));
  processHandInHandGroups(allCustomers);

  let employees: Employee[] = [];
  if (fs.existsSync(employeePath)) {
    employees = importEmployeesFromBuffer(fs.readFileSync(employeePath)).filter(
      (e) => e.status === EmployeeStatus.ACTIVE
    );
  } else if (fs.existsSync(fallbackEmployeePath)) {
    const allEmps = importEmployeesFromSheet(fallbackEmployeePath).filter(
      (e) => e.status === EmployeeStatus.ACTIVE
    );
    const demoNames = new Set(['韩哲川', '崔宏芝', '殷汝飞', '王睿', '刘帅']);
    employees = allEmps.filter((e) => demoNames.has(e.name));
  }

  const handInHandGroups = new Set(
    allCustomers.filter((c) => c.handInHandGroup).map((c) => c.handInHandGroup)
  ).size;

  return {
    parks: Array.from(parkMasterMap.values()).filter((p) => demoParks.includes(p.name)),
    customers: allCustomers,
    employees,
    cities: Array.from(cityMap.keys()),
    stats: {
      firstVisitCount: allCustomers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length,
      projectCount: allCustomers.filter((c) => c.customerType === CustomerType.PROJECT).length,
      followUpCount: allCustomers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length,
      employeeCount: employees.length,
      handInHandGroups,
    },
  };
}

export interface UploadFiles {
  parks?: Buffer;
  firstVisit?: Buffer;
  project?: Buffer;
  followUp?: Buffer;
  employees?: Buffer;
}

/** 仅导入客户数据 */
export function importCustomersOnly(files: Omit<UploadFiles, 'employees'>): {
  customers: Customer[];
  parks: InvestmentPark[];
  stats: { firstVisitCount: number; projectCount: number; followUpCount: number; handInHandGroups: number };
} {
  resetCounters();

  const firstVisitCustomers = files.firstVisit
    ? importCustomersFromBuffer(files.firstVisit, CustomerType.FIRST_VISIT, '首访日期时间', '首访地址', '首访PlusN次')
    : [];
  const projectCustomers = files.project
    ? importCustomersFromBuffer(files.project, CustomerType.PROJECT, '项目+日期时间', '项目+拜访人地址', '项目PlusN次')
    : [];
  const followUpCustomers = files.followUp
    ? importCustomersFromBuffer(files.followUp, CustomerType.FOLLOW_UP, '回访+日期时间', '回访+拜访人地址', '回访PlusN次')
    : [];

  const allCustomers = [...firstVisitCustomers, ...projectCustomers, ...followUpCustomers];
  processHandInHandGroups(allCustomers);

  const handInHandGroups = new Set(
    allCustomers.filter((c) => c.handInHandGroup).map((c) => c.handInHandGroup)
  ).size;

  return {
    customers: allCustomers,
    parks: Array.from(parkMasterMap.values()),
    stats: {
      firstVisitCount: firstVisitCustomers.length,
      projectCount: projectCustomers.length,
      followUpCount: followUpCustomers.length,
      handInHandGroups,
    },
  };
}

/** 仅导入员工数据 */
export function importEmployeesOnly(buffer: Buffer): Employee[] {
  resetCounters();
  return importEmployeesFromBuffer(buffer).filter((e) => e.status === EmployeeStatus.ACTIVE);
}

/** 从完整数据目录加载（用于示例） */
export function importSampleMetadata(dataDir: string): ImportResult {
  return importAllData(dataDir);
}

/** 从上传的文件 Buffer 导入数据（员工表可选） */
export function importFromUploads(files: UploadFiles): ImportResult {
  return importFullData(files, true);
}

/** 统一导入，只 reset 一次保证园区 ID 一致 */
export function importFullData(files: UploadFiles, requireEmployees = false): ImportResult {
  resetCounters();

  if (files.parks) importParksFromBuffer(files.parks);

  const firstVisitCustomers = files.firstVisit
    ? importCustomersFromBuffer(files.firstVisit, CustomerType.FIRST_VISIT, '首访日期时间', '首访地址', '首访PlusN次')
    : [];
  const projectCustomers = files.project
    ? importCustomersFromBuffer(files.project, CustomerType.PROJECT, '项目+日期时间', '项目+拜访人地址', '项目PlusN次')
    : [];
  const followUpCustomers = files.followUp
    ? importCustomersFromBuffer(files.followUp, CustomerType.FOLLOW_UP, '回访+日期时间', '回访+拜访人地址', '回访PlusN次')
    : [];

  const allCustomers = [...firstVisitCustomers, ...projectCustomers, ...followUpCustomers];
  processHandInHandGroups(allCustomers);

  const employees = files.employees
    ? importEmployeesFromBuffer(files.employees).filter((e) => e.status === EmployeeStatus.ACTIVE)
    : [];

  if (requireEmployees && employees.length === 0) {
    throw new Error('员工表无有效数据');
  }

  const handInHandGroups = new Set(
    allCustomers.filter((c) => c.handInHandGroup).map((c) => c.handInHandGroup)
  ).size;

  return {
    parks: Array.from(parkMasterMap.values()),
    customers: allCustomers,
    employees,
    cities: Array.from(cityMap.keys()),
    stats: {
      firstVisitCount: firstVisitCustomers.length,
      projectCount: projectCustomers.length,
      followUpCount: followUpCustomers.length,
      employeeCount: employees.length,
      handInHandGroups,
    },
  };
}

export interface ExportRow {
  customerName: string;
  employeeName: string;
  timeSlot: string;
  customerType: string;
  commuteMinutes?: number;
  matchScore?: number;
  parkName?: string;
  address?: string;
}

function buildExportSheet(results: ExportRow[]): XLSX.WorkBook {
  const rows = results.map((r) => ({
    '员工姓名': r.employeeName,
    '时段': r.timeSlot,
    '客户类型': r.customerType,
    '企业名称': r.customerName,
    '招商园区': r.parkName || '',
    '拜访地址': r.address || '',
    '通勤(分钟)': r.commuteMinutes ?? '',
    '匹配得分': r.matchScore ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '派单结果');
  return wb;
}

/** 导出派单结果为 Buffer（用于网页下载） */
export function exportDispatchResultsToBuffer(results: ExportRow[]): Buffer {
  const wb = buildExportSheet(results);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 导出派单结果为 Excel */
export function exportDispatchResults(
  results: ExportRow[],
  outputPath: string
): string {
  const wb = buildExportSheet(results);

  try {
    XLSX.writeFile(wb, outputPath);
    return outputPath;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES') {
      const ext = path.extname(outputPath);
      const base = path.basename(outputPath, ext);
      const dir = path.dirname(outputPath);
      const fallbackPath = path.join(dir, `${base}_${Date.now()}${ext}`);

      XLSX.writeFile(wb, fallbackPath);
      console.warn(
        `\n[提示] 原文件被占用（可能正在 Excel 中打开）: ${outputPath}\n` +
        `       已改存为: ${fallbackPath}\n` +
        `       请关闭 Excel 后重新运行，即可覆盖原文件。`
      );
      return fallbackPath;
    }
    throw err;
  }
}
