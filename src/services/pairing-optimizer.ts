/**
 * 公司-员工合规配对（支持一人多单、增量锁定配对）
 */

import { Customer, Employee, MatchDetail, TimeSlot, CustomerType } from '../types';
import { matchCustomerToEmployee, MatchResult, sortCustomersForDispatch } from './match-rules';
import {
  estimateChainedLegMinutes,
  buildChainedRouteEstimate,
  sortCustomersByVisitOrder,
} from '../utils/commute';
import { buildCommuteMatrix, CommuteMatrix, CommuteMode, RouteEstimate } from './distance-service';
import { buildAfternoonParkPairs, AfternoonParkPair } from './afternoon-park-pairs';

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

function getChainedCommuteMinutes(
  customer: Customer,
  employee: Employee,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate
): number {
  return estimateChainedLegMinutes(employee, assignedBefore, customer, commuteCell);
}

function getChainedRoute(
  customer: Customer,
  employee: Employee,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate
): RouteEstimate {
  return buildChainedRouteEstimate(employee, assignedBefore, customer, commuteCell);
}

function buildPairing(
  customer: Customer,
  employee: Employee,
  match: MatchResult,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate,
  locked = false
): CompanyEmployeePairing {
  const route = getChainedRoute(customer, employee, assignedBefore, commuteCell);
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

function combinedScore(
  customer: Customer,
  employee: Employee,
  match: MatchResult,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate
): number {
  const commute = getChainedCommuteMinutes(customer, employee, assignedBefore, commuteCell);
  return match.score - commute * 0.2;
}

function combinedPairScore(
  pair: AfternoonParkPair,
  employee: Employee,
  match1: MatchResult,
  match2: MatchResult,
  assignedBefore: Customer[],
  customers: Customer[],
  employees: Employee[],
  commuteMatrix?: CommuteMatrix
): number {
  const cell1 = findCommuteCell(pair.afternoon1, employee, customers, employees, commuteMatrix);
  const cell2 = findCommuteCell(pair.afternoon2, employee, customers, employees, commuteMatrix);
  return (
    combinedScore(pair.afternoon1, employee, match1, assignedBefore, cell1) +
    combinedScore(pair.afternoon2, employee, match2, [...assignedBefore, pair.afternoon1], cell2)
  );
}

function appendAfternoonBindDetail(details: MatchDetail[]): MatchDetail[] {
  return [
    ...details,
    {
      rule: '下午捆绑',
      passed: true,
      message: '同园区后道：下午1+下午2 绑定同一员工',
    },
  ];
}

function analyzeUnmatchedAfternoonPair(
  pair: AfternoonParkPair,
  employees: Employee[],
  assignedPerEmp: Map<number, Customer[]>
): UnmatchedCompany[] {
  const availableNames = new Set(employees.map((e) => e.name));
  let bestEmp: Employee | null = null;
  let bestPass = -1;

  for (const employee of employees) {
    const assigned = assignedPerEmp.get(employee.id) || [];
    const m1 = matchCustomerToEmployee(pair.afternoon1, employee, availableNames, assigned, {
      requirePlus: false,
    });
    const m2 = matchCustomerToEmployee(pair.afternoon2, employee, availableNames, [...assigned, pair.afternoon1], {
      requirePlus: false,
    });
    const pass = m1.details.filter((d) => d.passed && d.rule !== 'Plus匹配').length
      + m2.details.filter((d) => d.passed && d.rule !== 'Plus匹配').length;
    if (pass > bestPass) {
      bestPass = pass;
      bestEmp = employee;
    }
  }

  const reason = bestEmp
    ? `下午捆绑未满足：同园区后道需同一员工承接下午1+下午2（最近候选 ${bestEmp.name} 无法同时合规）`
    : '下午捆绑未满足：同园区后道无员工可同时承接下午1+下午2';

  const mk = (c: Customer): UnmatchedCompany => ({
    customerId: c.id,
    customerName: c.companyName,
    parkName: c.parkName,
    customerType: c.customerType,
    address: c.address,
    eligibleCount: 0,
    reason,
    nearestAttempt: bestEmp
      ? {
          employeeName: bestEmp.name,
          departureAddress: bestEmp.departureAddress,
          failedRules: [{ rule: '下午捆绑', message: reason }],
        }
      : undefined,
  });

  return [mk(pair.afternoon1), mk(pair.afternoon2)];
}

function matchAfternoonParkPairs(
  pairs: AfternoonParkPair[],
  customers: Customer[],
  employees: Employee[],
  commuteMatrix: CommuteMatrix | undefined,
  availableNames: Set<string>,
  assignedPerEmp: Map<number, Customer[]>,
  pairings: CompanyEmployeePairing[]
): AfternoonParkPair[] {
  const failed: AfternoonParkPair[] = [];

  for (const pair of pairs) {
    let bestEmp: Employee | null = null;
    let bestMatch1: MatchResult | null = null;
    let bestMatch2: MatchResult | null = null;
    let bestScore = -Infinity;
    let bestCell1: RouteEstimate | undefined;
    let bestCell2: RouteEstimate | undefined;

    for (const employee of employees) {
      const assigned = assignedPerEmp.get(employee.id) || [];
      const match1 = matchCustomerToEmployee(pair.afternoon1, employee, availableNames, assigned, {
        requirePlus: false,
      });
      if (!match1.eligible) continue;
      const match2 = matchCustomerToEmployee(
        pair.afternoon2,
        employee,
        availableNames,
        [...assigned, pair.afternoon1],
        { requirePlus: false }
      );
      if (!match2.eligible) continue;

      const sc = combinedPairScore(
        pair,
        employee,
        match1,
        match2,
        assigned,
        customers,
        employees,
        commuteMatrix
      );
      if (sc > bestScore) {
        bestScore = sc;
        bestEmp = employee;
        bestMatch1 = match1;
        bestMatch2 = match2;
        bestCell1 = findCommuteCell(pair.afternoon1, employee, customers, employees, commuteMatrix);
        bestCell2 = findCommuteCell(pair.afternoon2, employee, customers, employees, commuteMatrix);
      }
    }

    if (bestEmp && bestMatch1 && bestMatch2) {
      const assignedBefore = assignedPerEmp.get(bestEmp.id) || [];
      pairings.push({
        ...buildPairing(pair.afternoon1, bestEmp, bestMatch1, assignedBefore, bestCell1, false),
        details: appendAfternoonBindDetail(bestMatch1.details),
      });
      pairings.push({
        ...buildPairing(
          pair.afternoon2,
          bestEmp,
          bestMatch2,
          [...assignedBefore, pair.afternoon1],
          bestCell2,
          false
        ),
        details: appendAfternoonBindDetail(bestMatch2.details),
      });
      const assigned = assignedPerEmp.get(bestEmp.id) || [];
      assigned.push(pair.afternoon1, pair.afternoon2);
      assignedPerEmp.set(bestEmp.id, assigned);
    } else {
      failed.push(pair);
    }
  }

  return failed;
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
        route: (() => {
          const leg = buildChainedRouteEstimate(employees[bestIdx], assigned, customer);
          return {
            minutes: leg.minutes,
            pathSummary: leg.pathSummary,
            source: leg.source,
          };
        })(),
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
    pairings.push(buildPairing(customer, employee, match, assigned, commuteCell, true));
    assigned.push(customer);
    assignedPerEmp.set(employee.id, assigned);
  }

  const toMatch = customers.filter((c) => {
    if (lockedIds.has(c.id)) return false;
    if (matchOnlySet && !matchOnlySet.has(c.id)) return false;
    return !pairings.some((p) => p.customerId === c.id);
  });

  const { pairs: afternoonPairs, unpairedAfternoon, otherCustomers } = buildAfternoonParkPairs(toMatch);
  const failedPairs = matchAfternoonParkPairs(
    afternoonPairs,
    customers,
    employees,
    commuteMatrix,
    availableNames,
    assignedPerEmp,
    pairings
  );

  const pairedIds = new Set(pairings.map((p) => p.customerId));
  const stillToMatch = [
    ...otherCustomers.filter((c) => !pairedIds.has(c.id)),
    ...unpairedAfternoon.filter((c) => !pairedIds.has(c.id)),
  ];

  for (const customer of sortCustomersForDispatch(stillToMatch)) {
    let bestEmp: Employee | null = null;
    let bestMatch: MatchResult | null = null;
    let bestScore = -Infinity;
    let bestCommuteCell: RouteEstimate | undefined;

    for (const employee of employees) {
      const assigned = assignedPerEmp.get(employee.id) || [];
      const match = matchCustomerToEmployee(customer, employee, availableNames, assigned, { requirePlus: false });
      if (!match.eligible) continue;
      const commuteCell = findCommuteCell(customer, employee, customers, employees, commuteMatrix);
      const sc = combinedScore(customer, employee, match, assigned, commuteCell);
      if (sc > bestScore) {
        bestScore = sc;
        bestEmp = employee;
        bestMatch = match;
        bestCommuteCell = commuteCell;
      }
    }

    if (bestEmp && bestMatch) {
      const assigned = assignedPerEmp.get(bestEmp.id) || [];
      pairings.push(buildPairing(customer, bestEmp, bestMatch, assigned, bestCommuteCell, false));
      assigned.push(customer);
      assignedPerEmp.set(bestEmp.id, assigned);
    }
  }

  const matchedIds = new Set(pairings.map((p) => p.customerId));
  const failedPairCustomerIds = new Set(
    failedPairs.flatMap((pair) => [pair.afternoon1.id, pair.afternoon2.id])
  );
  const unmatchedFromPairs = failedPairs.flatMap((pair) =>
    analyzeUnmatchedAfternoonPair(pair, employees, assignedPerEmp)
  );
  const unmatched = [
    ...unmatchedFromPairs,
    ...customers
      .filter((c) => !matchedIds.has(c.id) && !failedPairCustomerIds.has(c.id))
      .map((c) => analyzeUnmatched(c, employees, assignedPerEmp, pairings)),
  ];

  pairings.sort((a, b) => {
    const ca = customers.find((c) => c.id === a.customerId);
    const cb = customers.find((c) => c.id === b.customerId);
    if (!ca || !cb) return 0;
    return (SLOT_ORDER[ca.timeSlot] ?? 0) - (SLOT_ORDER[cb.timeSlot] ?? 0);
  });

  const recalculated = recalculateChainedPairings(pairings, customers, employees);
  return { pairings: recalculated, unmatched };
}

/** 按最终全天行程重算每单串联通勤（修正下午捆绑先于上午匹配时的本段分钟数） */
function recalculateChainedPairings(
  pairings: CompanyEmployeePairing[],
  customers: Customer[],
  employees: Employee[]
): CompanyEmployeePairing[] {
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  const byEmp = new Map<number, CompanyEmployeePairing[]>();
  for (const p of pairings) {
    if (!byEmp.has(p.employeeId)) byEmp.set(p.employeeId, []);
    byEmp.get(p.employeeId)!.push(p);
  }

  const updated = new Map<number, CompanyEmployeePairing>();
  for (const [empId, orders] of byEmp) {
    const emp = employeeMap.get(empId);
    if (!emp) continue;
    const customersForEmp = sortCustomersByVisitOrder(
      orders.map((p) => customerMap.get(p.customerId)!).filter(Boolean)
    );
    const assigned: Customer[] = [];
    for (const customer of customersForEmp) {
      const pairing = orders.find((p) => p.customerId === customer.id);
      if (!pairing) continue;
      const route = buildChainedRouteEstimate(emp, assigned, customer);
      updated.set(pairing.customerId, {
        ...pairing,
        commuteMinutes: route.minutes,
        route: {
          minutes: route.minutes,
          pathSummary: route.pathSummary,
          source: route.source,
        },
      });
      assigned.push(customer);
    }
  }

  return pairings.map((p) => updated.get(p.customerId) || p);
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
