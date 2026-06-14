/**
 * 派单 API 响应构建
 */

import {
  DispatchBatch,
  CUSTOMER_TYPE_LABELS,
  TIME_SLOT_LABELS,
  Customer,
  InvestmentPark,
  DispatchEmployeeSheet,
  TimeSlot,
  Employee,
} from '../types';
import { ImportResult } from './excel-importer';

export interface DispatchApiResult {
  success: boolean;
  stats: {
    totalCustomers: number;
    totalEmployees: number;
    assigned: number;
    failed: number;
    firstVisit: number;
    project: number;
    followUp: number;
    avgCommute: number;
    maxCommute: number;
    handInHandGroups: number;
    parks: string[];
    selectedParks?: string[];
  };
  results: {
    employeeName: string;
    timeSlot: string;
    customerType: string;
    companyName: string;
    parkName: string;
    address: string;
    commuteMinutes?: number;
    matchScore: number;
  }[];
  /** 派单后：员工派单信息表 */
  employeeSheets: DispatchEmployeeSheet[];
  byEmployee: Record<string, DispatchApiResult['results']>;
  failedCustomers: {
    companyName: string;
    customerType: string;
    timeSlot: string;
    parkName: string;
    designatedPerson?: string;
    rejectedPerson?: string;
  }[];
  frontProjectMode: string;
  selectedEmployees?: { id: number; name: string; serviceParkName: string }[];
}

export function buildDispatchResponse(
  batch: DispatchBatch,
  importResult: ImportResult,
  frontProjectMode: string,
  extra?: {
    selectedParks?: string[];
    selectedEmployees?: { id: number; name: string; serviceParkName: string }[];
  }
): DispatchApiResult {
  const assignedIds = new Set(batch.results.map((r) => r.customerId));
  const customerMap = new Map(importResult.customers.map((c) => [c.id, c]));
  const employeeMap = new Map(importResult.employees.map((e) => [e.id, e]));

  const failedCustomers = importResult.customers
    .filter((c) => !assignedIds.has(c.id))
    .map((c) => ({
      companyName: c.companyName,
      customerType: CUSTOMER_TYPE_LABELS[c.customerType],
      timeSlot: TIME_SLOT_LABELS[c.timeSlot],
      parkName: c.parkName,
      designatedPerson: c.designatedPerson,
      rejectedPerson: c.rejectedPerson,
    }));

  const results = batch.results.map((r) => {
    const customer = customerMap.get(r.customerId);
    return {
      employeeName: r.employeeName,
      timeSlot: TIME_SLOT_LABELS[r.timeSlot],
      customerType: CUSTOMER_TYPE_LABELS[r.customerType],
      companyName: r.customerName,
      parkName: customer?.parkName || '',
      address: customer?.address || '',
      commuteMinutes: r.commuteMinutes,
      matchScore: r.matchScore,
    };
  });

  const byEmployee: Record<string, typeof results> = {};
  for (const r of results) {
    if (!byEmployee[r.employeeName]) byEmployee[r.employeeName] = [];
    byEmployee[r.employeeName].push(r);
  }

  const employeeSheets = buildEmployeeSheets(batch, customerMap, employeeMap);

  return {
    success: true,
    stats: {
      totalCustomers: batch.totalCustomers,
      totalEmployees: batch.totalEmployees,
      assigned: batch.statistics.totalAssigned,
      failed: failedCustomers.length,
      firstVisit: importResult.stats.firstVisitCount,
      project: importResult.stats.projectCount,
      followUp: importResult.stats.followUpCount,
      avgCommute: batch.statistics.avgCommuteMinutes,
      maxCommute: batch.statistics.maxCommuteMinutes,
      handInHandGroups: batch.statistics.handInHandGroups,
      parks: importResult.parks.map((p) => p.name),
      selectedParks: extra?.selectedParks,
    },
    results,
    employeeSheets,
    byEmployee,
    failedCustomers,
    frontProjectMode,
    selectedEmployees: extra?.selectedEmployees,
  };
}

/** 生成派单员工信息表（派单后输出） */
function buildEmployeeSheets(
  batch: DispatchBatch,
  customerMap: Map<number, Customer>,
  employeeMap: Map<number, Employee>
): DispatchEmployeeSheet[] {
  const grouped = new Map<number, typeof batch.results>();

  for (const r of batch.results) {
    if (!grouped.has(r.employeeId)) grouped.set(r.employeeId, []);
    grouped.get(r.employeeId)!.push(r);
  }

  return Array.from(grouped.entries()).map(([empId, orders]) => {
    const emp = employeeMap.get(empId);
    const orderDetails = orders.map((r) => {
      const c = customerMap.get(r.customerId);
      return {
        companyName: r.customerName,
        timeSlot: TIME_SLOT_LABELS[r.timeSlot],
        customerType: CUSTOMER_TYPE_LABELS[r.customerType],
        address: c?.address || '',
        commuteMinutes: r.commuteMinutes,
      };
    });

    return {
      employeeId: empId,
      employeeName: emp?.name || orders[0].employeeName,
      serviceParkName: emp?.serviceParkName || '',
      totalOrders: orders.length,
      morningOrders: orders.filter((o) => o.timeSlot === TimeSlot.MORNING).length,
      afternoon1Orders: orders.filter((o) => o.timeSlot === TimeSlot.AFTERNOON_1).length,
      afternoon2Orders: orders.filter((o) => o.timeSlot === TimeSlot.AFTERNOON_2).length,
      totalCommuteMinutes: orders.reduce((s, o) => s + (o.commuteMinutes || 0), 0),
      orders: orderDetails,
    };
  });
}

/** 按园区统计待派单客户（园区表与客户单关联） */
export function getParkStats(customers: Customer[], parkMasters: InvestmentPark[] = []) {
  const masterMap = new Map(parkMasters.map((p) => [p.name, p]));
  const map = new Map<string, {
    name: string;
    parkId: number;
    address: string;
    cityName: string;
    customerCount: number;
    firstVisit: number;
    project: number;
    followUp: number;
    morning: number;
    afternoon1: number;
    afternoon2: number;
  }>();

  for (const master of parkMasters) {
    if (!map.has(master.name)) {
      map.set(master.name, {
        name: master.name,
        parkId: master.id,
        address: master.address || '',
        cityName: master.cityName,
        customerCount: 0,
        firstVisit: 0,
        project: 0,
        followUp: 0,
        morning: 0,
        afternoon1: 0,
        afternoon2: 0,
      });
    }
  }

  for (const c of customers) {
    if (!map.has(c.parkName)) {
      const master = masterMap.get(c.parkName);
      map.set(c.parkName, {
        name: c.parkName,
        parkId: c.parkId,
        address: master?.address || '',
        cityName: master?.cityName || c.cityName,
        customerCount: 0,
        firstVisit: 0,
        project: 0,
        followUp: 0,
        morning: 0,
        afternoon1: 0,
        afternoon2: 0,
      });
    }
    const stat = map.get(c.parkName)!;
    stat.customerCount++;
    if (c.customerType === 'FIRST_VISIT') stat.firstVisit++;
    if (c.customerType === 'PROJECT') stat.project++;
    if (c.customerType === 'FOLLOW_UP') stat.followUp++;
    if (c.timeSlot === 'MORNING') stat.morning++;
    if (c.timeSlot === 'AFTERNOON_1') stat.afternoon1++;
    if (c.timeSlot === 'AFTERNOON_2') stat.afternoon2++;
  }

  return Array.from(map.values()).sort((a, b) => b.customerCount - a.customerCount);
}
