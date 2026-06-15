/**
 * 公司-员工合规配对（支持一人多单、增量锁定配对）
 */

import { Customer, Employee, MatchDetail, TimeSlot } from '../types';
import { matchCustomerToEmployee, MatchResult, sortCustomersForDispatch } from './match-rules';
import { estimateCommuteMinutes } from '../utils/commute';
import { buildCommuteMatrix, CommuteMatrix, CommuteMode, RouteEstimate } from './distance-service';

export interface LockedPairing {
  customerId: number;
  employeeId: number;
}

export interface PairingOptions {
  lockedPairings?: LockedPairing[];
  matchOnlyCustomerIds?: number[];
  commuteMode?: CommuteMode;
}

export interface CompanyEmployeePairing {
  customerId: number;
  customerName: string;
  employeeId: number;
  employeeName: string;
  eligible: boolean;
  score: number;
  details: MatchDetail[];
  commuteMinutes: number;
  route?: RouteEstimate;
  locked?: boolean;
}

export interface UnmatchedCompany {
  customerId: number;
  customerName: string;
  parkName: string;
  customerType: string;
  address: string;
  reason: string;
  eligibleCount: number;
  nearestAttempt?: {
    employeeName: string;
    departureAddress: string;
    failedRules: { rule: string; message: string }[];
    route?: RouteEstimate;
  };
  conflictWith?: {
    employeeName: string;
    takenByCompany: string;
    route?: RouteEstimate;
  };
}

export interface PairingOptimizationResult {
  pairings: CompanyEmployeePairing[];
  unmatched: UnmatchedCompany[];
  totalScore: number;
  allEligible: boolean;
  message: string;
  distanceSource?: 'deepseek' | 'local' | 'mixed';
}

const SLOT_ORDER: Record<TimeSlot, number> = {
  [TimeSlot.MORNING]: 0,
  [TimeSlot.AFTERNOON_1]: 1,
  [TimeSlot.AFTERNOON_2]: 2,
};

function getCommuteMinutes(customer: Customer, employee: Employee, commuteCell?: RouteEstimate): number {
  if (commuteCell && commuteCell.minutes > 0) return commuteCell.minutes;
  return estimateCommuteMinutes(employee.departureAddress, customer.address);
}

function getRoute(customer: Customer, employee: Employee, commuteCell?: RouteEstimate): RouteEstimate {
  if (commuteCell && commuteCell.minutes > 0) return commuteCell;
  const minutes = estimateCommuteMinutes(employee.departureAddress, customer.address);
  return {
    minutes,
    pathSummary: `本地估算：${employee.departureAddress} → ${customer.address}（园区 ${customer.parkName}），约 ${minutes} 分钟`,
    source: 'local',
  };
}

function buildPairing(
  customer: Customer,
  employee: Employee,
  match: MatchResult,
  commuteCell?: RouteEstimate,
  locked = false
): CompanyEmployeePairing {
  const route = getRoute(customer, employee, commuteCell);
  return {
    customerId: customer.id,
    customerName: customer.companyName,
    employeeId: employee.id,
    employeeName: employee.name,
    eligible: true,
    score: match.score,
    details: match.details,
    commuteMinutes: route.minutes,
    route,
    locked,
  };
}

function findCommuteCell(
  customer: Customer,
  employee: Employee,
  customers: Customer[],
  employees: Employee[],
  commuteMatrix?: CommuteMatrix
): RouteEstimate | undefined {
  if (!commuteMatrix) return undefined;
  const ci = customers.indexOf(customer);
  const ei = employees.indexOf(employee);
  if (ci < 0 || ei < 0) return undefined;
  return commuteMatrix[ci]?.[ei];
}

function combinedScore(customer: Customer, employee: Employee, match: MatchResult, commuteCell?: RouteEstimate): number {
  const commute = getCommuteMinutes(customer, employee, commuteCell);
  return match.score - commute * 0.2;
}

function analyzeUnmatched(
  customer: Customer,
  employees: Employee[],
  assignedPerEmp: Map<number, Customer[]>,
  pairings: CompanyEmployeePairing[]
): UnmatchedCompany {
  const availableNames = new Set(employees.map((e) => e.name));
  let bestIdx = -1;
  let bestPassCount = -1;

  for (let j = 0; j < employees.length; j++) {
    const assigned = assignedPerEmp.get(employees[j].id) || [];
    const match = matchCustomerToEmployee(customer, employees[j], availableNames, assigned, { requirePlus: false });
    const passCount = match.details.filter((d) => d.passed && d.rule !== 'Plus匹配').length;
    if (passCount > bestPassCount) {
      bestPassCount = passCount;
      bestIdx = j;
    }
  }

  const eligibleCount = employees.filter((e) => {
    const assigned = assignedPerEmp.get(e.id) || [];
    return matchCustomerToEmployee(customer, e, availableNames, assigned, { requirePlus: false }).eligible;
  }).length;

  if (eligibleCount === 0 && bestIdx >= 0) {
    const assigned = assignedPerEmp.get(employees[bestIdx].id) || [];
    const match = matchCustomerToEmployee(customer, employees[bestIdx], availableNames, assigned, { requirePlus: false });
    const failedRules = match.details
      .filter((d) => !d.passed && d.rule !== 'Plus匹配')
      .map((d) => ({ rule: d.rule, message: d.message }));
    const ruleNames = failedRules.map((r) => r.rule).join('、') || '无可用员工';
    return {
      customerId: customer.id,
      customerName: customer.companyName,
      parkName: customer.parkName,
      customerType: customer.customerType,
      address: customer.address,
      eligibleCount: 0,
      reason: `无合规员工（${ruleNames} 不满足）`,
      nearestAttempt: {
        employeeName: employees[bestIdx].name,
        departureAddress: employees[bestIdx].departureAddress,
        failedRules,
        route: {
          minutes: estimateCommuteMinutes(employees[bestIdx].departureAddress, customer.address),
          pathSummary: `${employees[bestIdx].departureAddress} → ${customer.address}`,
          source: 'local',
        },
      },
    };
  }

  const conflictPair = pairings.find((p) => {
    const emp = employees.find((e) => e.id === p.employeeId);
    if (!emp) return false;
    const assigned = assignedPerEmp.get(emp.id) || [];
    return matchCustomerToEmployee(customer, emp, availableNames, assigned, { requirePlus: false }).eligible;
  });

  return {
    customerId: customer.id,
    customerName: customer.companyName,
    parkName: customer.parkName,
    customerType: customer.customerType,
    address: customer.address,
    eligibleCount,
    reason: eligibleCount > 0 ? '该时段可用员工已满' : '无合规员工可派',
    conflictWith: conflictPair
      ? { employeeName: conflictPair.employeeName, takenByCompany: conflictPair.customerName }
      : undefined,
  };
}

function findCapacitatedMatching(
  customers: Customer[],
  employees: Employee[],
  commuteMatrix: CommuteMatrix | undefined,
  options: PairingOptions = {}
): { pairings: CompanyEmployeePairing[]; unmatched: UnmatchedCompany[] } {
  const availableNames = new Set(employees.map((e) => e.name));
  const assignedPerEmp = new Map<number, Customer[]>();
  const pairings: CompanyEmployeePairing[] = [];
  const lockedIds = new Set((options.lockedPairings || []).map((p) => p.customerId));
  const matchOnlySet = options.matchOnlyCustomerIds ? new Set(options.matchOnlyCustomerIds) : null;

  for (const lock of options.lockedPairings || []) {
    const customer = customers.find((c) => c.id === lock.customerId);
    const employee = employees.find((e) => e.id === lock.employeeId);
    if (!customer || !employee) continue;
    const assigned = assignedPerEmp.get(employee.id) || [];
    const match = matchCustomerToEmployee(customer, employee, availableNames, assigned, { requirePlus: false });
    if (!match.eligible) continue;
    const commuteCell = findCommuteCell(customer, employee, customers, employees, commuteMatrix);
    pairings.push(buildPairing(customer, employee, match, commuteCell, true));
    assigned.push(customer);
    assignedPerEmp.set(employee.id, assigned);
  }

  const toMatch = customers.filter((c) => {
    if (lockedIds.has(c.id)) return false;
    if (matchOnlySet && !matchOnlySet.has(c.id)) return false;
    return !pairings.some((p) => p.customerId === c.id);
  });

  for (const customer of sortCustomersForDispatch(toMatch)) {
    let bestEmp: Employee | null = null;
    let bestMatch: MatchResult | null = null;
    let bestScore = -Infinity;
    let bestCommuteCell: RouteEstimate | undefined;

    for (const employee of employees) {
      const assigned = assignedPerEmp.get(employee.id) || [];
      const match = matchCustomerToEmployee(customer, employee, availableNames, assigned, { requirePlus: false });
      if (!match.eligible) continue;
      const commuteCell = findCommuteCell(customer, employee, customers, employees, commuteMatrix);
      const sc = combinedScore(customer, employee, match, commuteCell);
      if (sc > bestScore) {
        bestScore = sc;
        bestEmp = employee;
        bestMatch = match;
        bestCommuteCell = commuteCell;
      }
    }

    if (bestEmp && bestMatch) {
      pairings.push(buildPairing(customer, bestEmp, bestMatch, bestCommuteCell, false));
      const assigned = assignedPerEmp.get(bestEmp.id) || [];
      assigned.push(customer);
      assignedPerEmp.set(bestEmp.id, assigned);
    }
  }

  const matchedIds = new Set(pairings.map((p) => p.customerId));
  const unmatched = customers
    .filter((c) => !matchedIds.has(c.id))
    .map((c) => analyzeUnmatched(c, employees, assignedPerEmp, pairings));

  pairings.sort((a, b) => {
    const ca = customers.find((c) => c.id === a.customerId);
    const cb = customers.find((c) => c.id === b.customerId);
    if (!ca || !cb) return 0;
    return (SLOT_ORDER[ca.timeSlot] ?? 0) - (SLOT_ORDER[cb.timeSlot] ?? 0);
  });

  return { pairings, unmatched };
}

function resolveDistanceSource(commuteMatrix?: CommuteMatrix): PairingOptimizationResult['distanceSource'] {
  if (!commuteMatrix) return 'local';
  let hasDeepseek = false;
  let hasLocal = false;
  for (const row of commuteMatrix) {
    for (const cell of row) {
      if (cell.source === 'deepseek') hasDeepseek = true;
      if (cell.source === 'local') hasLocal = true;
    }
  }
  if (hasDeepseek && hasLocal) return 'mixed';
  if (hasDeepseek) return 'deepseek';
  return 'local';
}

async function runCompliantPairingAsync(
  customers: Customer[],
  employees: Employee[],
  autoSelected: boolean,
  options: PairingOptions = {}
): Promise<PairingOptimizationResult> {
  if (customers.length === 0) throw new Error('请至少选择一家公司');

  const availableNames = new Set(employees.map((e) => e.name));
  const eligibleMask = customers.map((c) =>
    employees.map((e) => {
      const assigned: Customer[] = [];
      for (const lock of options.lockedPairings || []) {
        if (lock.employeeId === e.id) {
          const lc = customers.find((x) => x.id === lock.customerId);
          if (lc) assigned.push(lc);
        }
      }
      return matchCustomerToEmployee(c, e, availableNames, assigned, { requirePlus: false }).eligible;
    })
  );

  const commuteMatrix = await buildCommuteMatrix(
    customers.map((c) => ({ address: c.address, parkName: c.parkName, companyName: c.companyName })),
    employees,
    eligibleMask,
    options.commuteMode ?? 'local'
  );

  const { pairings, unmatched } = findCapacitatedMatching(customers, employees, commuteMatrix, options);
  const n = customers.length;

  let message: string;
  if (unmatched.length === 0) {
    message = autoSelected
      ? `已为 ${n} 家公司匹配 ${pairings.length} 单，全部合规（支持员工一天多单）`
      : `${pairings.length} 组配对全部合规`;
  } else if (pairings.length === 0) {
    message = `${n} 家公司均无法合规匹配`;
  } else {
    message = `${pairings.length} 单已合规匹配，${unmatched.length} 家未匹配`;
  }

  return {
    pairings,
    unmatched,
    totalScore: pairings.reduce((s, p) => s + p.score, 0),
    allEligible: unmatched.length === 0,
    message,
    distanceSource: resolveDistanceSource(commuteMatrix),
  };
}

export function findOptimalPairing(customers: Customer[], employees: Employee[]): PairingOptimizationResult {
  if (customers.length !== employees.length) {
    throw new Error(`公司与员工数量必须一致，当前 ${customers.length} : ${employees.length}`);
  }
  const { pairings, unmatched } = findCapacitatedMatching(customers, employees, undefined, {});
  return {
    pairings,
    unmatched,
    totalScore: pairings.reduce((s, p) => s + p.score, 0),
    allEligible: unmatched.length === 0,
    message: unmatched.length === 0 ? `${pairings.length} 组全部合规` : `${pairings.length} 组已匹配`,
    distanceSource: 'local',
  };
}

export function findOptimalAutoPairing(
  customers: Customer[],
  allEmployees: Employee[],
  options: PairingOptions = {}
): PairingOptimizationResult {
  const { pairings, unmatched } = findCapacitatedMatching(customers, allEmployees, undefined, options);
  return {
    pairings,
    unmatched,
    totalScore: pairings.reduce((s, p) => s + p.score, 0),
    allEligible: unmatched.length === 0,
    message:
      unmatched.length === 0
        ? `已为 ${customers.length} 家公司匹配 ${pairings.length} 单`
        : `${pairings.length} 单已匹配，${unmatched.length} 家未匹配`,
    distanceSource: 'local',
  };
}

export async function findOptimalAutoPairingAsync(
  customers: Customer[],
  allEmployees: Employee[],
  options: PairingOptions = {}
): Promise<PairingOptimizationResult> {
  return runCompliantPairingAsync(customers, allEmployees, true, options);
}
