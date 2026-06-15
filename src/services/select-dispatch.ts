/**
 * 选择模式派单：增量匹配 + 员工行程 + 一人多单
 */

import {
  Customer,
  Employee,
  CUSTOMER_TYPE_LABELS,
  TIME_SLOT_LABELS,
  DispatchResult,
  TimeSlot,
} from '../types';
import { ImportResult } from './excel-importer';
import { MAX_ACCEPTABLE_COMMUTE_MINUTES, calculateDailyCommute } from '../utils/commute';
import {
  findOptimalPairing,
  findOptimalAutoPairingAsync,
  CompanyEmployeePairing,
  LockedPairing,
  PairingOptions,
} from './pairing-optimizer';
import { CommuteMode } from './distance-service';

export interface EmployeeSchedule {
  employeeId: number;
  employeeName: string;
  departureAddress: string;
  totalOrders: number;
  morningOrders: number;
  afternoonOrders: number;
  totalCommuteMinutes: number;
  orders: {
    customerId: number;
    companyName: string;
    timeSlot: string;
    customerType: string;
    address: string;
    parkName: string;
    commuteMinutes: number;
  }[];
  routeSegments: { from: string; to: string; minutes: number }[];
}

export interface SelectDispatchPairing {
  customerId: number;
  companyName: string;
  address: string;
  parkName: string;
  customerType: string;
  timeSlot: string;
  employeeId: number;
  employeeName: string;
  departureAddress: string;
  score: number;
  commuteMinutes: number;
  locked?: boolean;
  route?: { minutes: number; distanceKm?: number; pathSummary: string; source: 'deepseek' | 'local' };
  rules: { rule: string; passed: boolean; message: string }[];
}

export interface SelectDispatchResponse {
  success: boolean;
  message: string;
  maxCommuteMinutes: number;
  distanceSource?: 'deepseek' | 'local' | 'mixed';
  stats: {
    selected: number;
    matched: number;
    unmatched: number;
    totalScore: number;
    avgCommute: number;
  };
  pairings: SelectDispatchPairing[];
  unmatchedCompanies: {
    customerId: number;
    companyName: string;
    parkName: string;
    address: string;
    customerType: string;
    reason: string;
    eligibleCount: number;
    nearestAttempt?: {
      employeeName: string;
      departureAddress: string;
      failedRules: { rule: string; message: string }[];
      route?: { minutes: number; distanceKm?: number; pathSummary: string; source: 'deepseek' | 'local' };
    };
    conflictWith?: {
      employeeName: string;
      takenByCompany: string;
      route?: { minutes: number; distanceKm?: number; pathSummary: string; source: 'deepseek' | 'local' };
    };
  }[];
  employeeSchedules: EmployeeSchedule[];
}

export interface DispatchOptions {
  lockedPairings?: LockedPairing[];
  matchOnlyCustomerIds?: number[];
  employeePoolIds?: number[];
  commuteMode?: CommuteMode;
}

export async function dispatchSelectedCompanies(
  data: ImportResult,
  customerIds: number[],
  employeeIds?: number[],
  options: DispatchOptions = {}
): Promise<SelectDispatchResponse> {
  const customers = customerIds
    .map((id) => data.customers.find((c) => c.id === id))
    .filter((c): c is Customer => !!c);

  if (customers.length !== customerIds.length) throw new Error('部分公司 ID 不存在');
  if (new Set(customerIds).size !== customerIds.length) throw new Error('公司不能重复选择');

  const pairingOptions: PairingOptions = {
    lockedPairings: options.lockedPairings,
    matchOnlyCustomerIds: options.matchOnlyCustomerIds,
    commuteMode: options.commuteMode ?? 'local',
  };

  let result;
  let employeeMap: Map<number, Employee>;

  if (employeeIds && employeeIds.length > 0) {
    const employees = employeeIds
      .map((id) => data.employees.find((e) => e.id === id))
      .filter((e): e is Employee => !!e);
    if (employees.length !== employeeIds.length) throw new Error('部分员工 ID 不存在');
    if (customers.length !== employees.length) {
      throw new Error(`公司与员工数量必须一致（当前 ${customers.length} : ${employees.length}）`);
    }
    result = findOptimalPairing(customers, employees);
    employeeMap = new Map(employees.map((e) => [e.id, e]));
  } else {
    let employees = data.employees;
    if (options.employeePoolIds?.length) {
      const poolSet = new Set(options.employeePoolIds);
      employees = data.employees.filter((e) => poolSet.has(e.id));
      if (employees.length === 0) throw new Error('所选员工池为空');
    }
    result = await findOptimalAutoPairingAsync(customers, employees, pairingOptions);
    employeeMap = new Map(data.employees.map((e) => [e.id, e]));
  }

  const customerMap = new Map(data.customers.map((c) => [c.id, c]));
  const pairings = result.pairings.map((p) => formatPairing(p, customerMap, employeeMap));
  const employeeSchedules = buildEmployeeSchedules(result.pairings, customerMap, employeeMap);

  const avgCommute =
    pairings.length > 0
      ? Math.round(pairings.reduce((s, p) => s + p.commuteMinutes, 0) / pairings.length)
      : 0;

  const unmatchedCompanies = result.unmatched.map((u) => {
    const c = customerMap.get(u.customerId)!;
    return {
      customerId: u.customerId,
      companyName: u.customerName,
      parkName: u.parkName,
      address: u.address,
      customerType: CUSTOMER_TYPE_LABELS[c.customerType],
      reason: u.reason,
      eligibleCount: u.eligibleCount,
      nearestAttempt: u.nearestAttempt,
      conflictWith: u.conflictWith,
    };
  });

  return {
    success: result.allEligible,
    message: result.message,
    maxCommuteMinutes: MAX_ACCEPTABLE_COMMUTE_MINUTES,
    distanceSource: result.distanceSource,
    stats: {
      selected: customers.length,
      matched: pairings.length,
      unmatched: unmatchedCompanies.length,
      totalScore: result.totalScore,
      avgCommute,
    },
    pairings,
    unmatchedCompanies,
    employeeSchedules,
  };
}

function formatPairing(
  p: CompanyEmployeePairing,
  customerMap: Map<number, Customer>,
  employeeMap: Map<number, Employee>
): SelectDispatchPairing {
  const customer = customerMap.get(p.customerId)!;
  const employee = employeeMap.get(p.employeeId)!;
  return {
    customerId: p.customerId,
    companyName: p.customerName,
    address: customer.address,
    parkName: customer.parkName,
    customerType: CUSTOMER_TYPE_LABELS[customer.customerType],
    timeSlot: TIME_SLOT_LABELS[customer.timeSlot],
    employeeId: p.employeeId,
    employeeName: p.employeeName,
    departureAddress: employee.departureAddress,
    score: p.score,
    commuteMinutes: p.commuteMinutes,
    locked: p.locked,
    route: p.route,
    rules: p.details.map((d) => ({ rule: d.rule, passed: d.passed, message: d.message })),
  };
}

function buildEmployeeSchedules(
  pairings: CompanyEmployeePairing[],
  customerMap: Map<number, Customer>,
  employeeMap: Map<number, Employee>
): EmployeeSchedule[] {
  const grouped = new Map<number, CompanyEmployeePairing[]>();
  for (const p of pairings) {
    if (!grouped.has(p.employeeId)) grouped.set(p.employeeId, []);
    grouped.get(p.employeeId)!.push(p);
  }

  const slotOrder = (ts: TimeSlot) =>
    ts === TimeSlot.MORNING ? 0 : ts === TimeSlot.AFTERNOON_1 ? 1 : 2;

  return Array.from(grouped.entries()).map(([empId, orders]) => {
    const emp = employeeMap.get(empId)!;
    const sorted = orders
      .map((p) => ({ p, c: customerMap.get(p.customerId)! }))
      .sort((a, b) => slotOrder(a.c.timeSlot) - slotOrder(b.c.timeSlot));

    const customers = sorted.map((x) => x.c);
    const daily = calculateDailyCommute(emp, customers);

    return {
      employeeId: empId,
      employeeName: emp.name,
      departureAddress: emp.departureAddress,
      totalOrders: orders.length,
      morningOrders: customers.filter((c) => c.timeSlot === TimeSlot.MORNING).length,
      afternoonOrders: customers.filter((c) => c.timeSlot !== TimeSlot.MORNING).length,
      totalCommuteMinutes: daily.totalMinutes,
      orders: sorted.map(({ p, c }) => ({
        customerId: p.customerId,
        companyName: p.customerName,
        timeSlot: TIME_SLOT_LABELS[c.timeSlot],
        customerType: CUSTOMER_TYPE_LABELS[c.customerType],
        address: c.address,
        parkName: c.parkName,
        commuteMinutes: p.commuteMinutes,
      })),
      routeSegments: daily.segments,
    };
  });
}

export function pairingsToDispatchResults(pairings: SelectDispatchPairing[]): DispatchResult[] {
  return pairings.map((p) => ({
    customerId: p.customerId,
    customerName: p.companyName,
    employeeId: p.employeeId,
    employeeName: p.employeeName,
    timeSlot: Object.entries(TIME_SLOT_LABELS).find(([, v]) => v === p.timeSlot)?.[0] as DispatchResult['timeSlot'],
    customerType: Object.entries(CUSTOMER_TYPE_LABELS).find(([, v]) => v === p.customerType)?.[0] as DispatchResult['customerType'],
    commuteMinutes: p.commuteMinutes,
    matchScore: p.score,
    matchDetails: p.rules.map((r) => ({ rule: r.rule, passed: r.passed, message: r.message })),
  }));
}
