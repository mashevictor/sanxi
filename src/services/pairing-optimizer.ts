/**
 * 公司-员工合规配对（支持一人多单、增量锁定配对）
 */

import { Customer, Employee, MatchDetail, TimeSlot, CustomerType } from '../types';
import { matchCustomerToEmployee, MatchResult, sortCustomersForDispatch } from './match-rules';
import {
  estimateChainedLegMinutes,
  buildChainedRouteEstimate,
  sortCustomersByVisitOrder,
  getCommuteOriginForNextStop,
} from '../utils/commute';
import {
  buildCommuteMatrix,
  CommuteMatrix,
  CommuteMode,
  DistanceSource,
  estimateRouteWithMode,
  getLegFromCache,
  LegCache,
  resolveDistanceSource,
  RouteEstimate,
  warmChainedTransitLegs,
} from './distance-service';
import { buildAfternoonParkPairs, AfternoonParkPair } from './afternoon-park-pairs';

export interface LockedPairing {
  customerId: number;
  employeeId: number;
}

export interface PairingOptions {
  lockedPairings?: LockedPairing[];
  matchOnlyCustomerIds?: number[];
  commuteMode?: CommuteMode;
  legCache?: LegCache;
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
  distanceSource?: DistanceSource;
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
  commuteCell?: RouteEstimate,
  legCache?: LegCache
): number {
  const from = getCommuteOriginForNextStop(employee, assignedBefore, customer);
  if (from === employee.departureAddress && commuteCell && commuteCell.minutes > 0) {
    return commuteCell.minutes;
  }
  const leg = getLegFromCache(from, customer.address, legCache);
  if (leg) return leg.minutes;
  return estimateChainedLegMinutes(employee, assignedBefore, customer, commuteCell);
}

function getChainedRoute(
  customer: Customer,
  employee: Employee,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate,
  legCache?: LegCache
): RouteEstimate {
  const from = getCommuteOriginForNextStop(employee, assignedBefore, customer);
  if (from === employee.departureAddress && commuteCell && commuteCell.minutes > 0) {
    return {
      minutes: commuteCell.minutes,
      pathSummary: commuteCell.pathSummary || `${from} → ${customer.address}`,
      source: commuteCell.source,
    };
  }
  const leg = getLegFromCache(from, customer.address, legCache);
  if (leg) return leg;
  return buildChainedRouteEstimate(employee, assignedBefore, customer, commuteCell);
}

function buildPairing(
  customer: Customer,
  employee: Employee,
  match: MatchResult,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate,
  locked = false,
  legCache?: LegCache
): CompanyEmployeePairing {
  const route = getChainedRoute(customer, employee, assignedBefore, commuteCell, legCache);
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

function isBetterEmployeePick(
  commuteMode: CommuteMode | undefined,
  newCommute: number,
  newScore: number,
  bestCommute: number,
  bestScore: number
): boolean {
  if (commuteMode === 'transit') {
    if (newCommute !== bestCommute) return newCommute < bestCommute;
    return newScore > bestScore;
  }
  return newScore - newCommute * 0.2 > bestScore - bestCommute * 0.2;
}

function combinedScore(
  customer: Customer,
  employee: Employee,
  match: MatchResult,
  assignedBefore: Customer[],
  commuteCell?: RouteEstimate,
  legCache?: LegCache
): number {
  const commute = getChainedCommuteMinutes(customer, employee, assignedBefore, commuteCell, legCache);
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
  commuteMatrix?: CommuteMatrix,
  legCache?: LegCache
): number {
  const cell1 = findCommuteCell(pair.afternoon1, employee, customers, employees, commuteMatrix);
  const cell2 = findCommuteCell(pair.afternoon2, employee, customers, employees, commuteMatrix);
  return (
    combinedScore(pair.afternoon1, employee, match1, assignedBefore, cell1, legCache) +
    combinedScore(pair.afternoon2, employee, match2, [...assignedBefore, pair.afternoon1], cell2, legCache)
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
  pairings: CompanyEmployeePairing[],
  legCache?: LegCache,
  commuteMode?: CommuteMode
): AfternoonParkPair[] {
  const failed: AfternoonParkPair[] = [];

  for (const pair of pairs) {
    let bestEmp: Employee | null = null;
    let bestMatch1: MatchResult | null = null;
    let bestMatch2: MatchResult | null = null;
    let bestScore = -Infinity;
    let bestCommute = Infinity;
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

      const cell1 = findCommuteCell(pair.afternoon1, employee, customers, employees, commuteMatrix);
      const cell2 = findCommuteCell(pair.afternoon2, employee, customers, employees, commuteMatrix);
      const c1 = getChainedCommuteMinutes(pair.afternoon1, employee, assigned, cell1, legCache);
      const c2 = getChainedCommuteMinutes(
        pair.afternoon2,
        employee,
        [...assigned, pair.afternoon1],
        cell2,
        legCache
      );
      const totalCommute = c1 + c2;
      const sc =
        commuteMode === 'transit'
          ? match1.score + match2.score
          : combinedPairScore(
              pair,
              employee,
              match1,
              match2,
              assigned,
              customers,
              employees,
              commuteMatrix,
              legCache
            );

      if (isBetterEmployeePick(commuteMode, totalCommute, sc, bestCommute, bestScore)) {
        bestScore = sc;
        bestCommute = totalCommute;
        bestEmp = employee;
        bestMatch1 = match1;
        bestMatch2 = match2;
        bestCell1 = cell1;
        bestCell2 = cell2;
      }
    }

    if (bestEmp && bestMatch1 && bestMatch2) {
      const assignedBefore = assignedPerEmp.get(bestEmp.id) || [];
      pairings.push({
        ...buildPairing(pair.afternoon1, bestEmp, bestMatch1, assignedBefore, bestCell1, false, legCache),
        details: appendAfternoonBindDetail(bestMatch1.details),
      });
      pairings.push({
        ...buildPairing(
          pair.afternoon2,
          bestEmp,
          bestMatch2,
          [...assignedBefore, pair.afternoon1],
          bestCell2,
          false,
          legCache
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
    pairings.push(buildPairing(customer, employee, match, assigned, commuteCell, true, options.legCache));
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
    pairings,
    options.legCache,
    options.commuteMode
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
    let bestCommute = Infinity;
    let bestCommuteCell: RouteEstimate | undefined;

    for (const employee of employees) {
      const assigned = assignedPerEmp.get(employee.id) || [];
      const match = matchCustomerToEmployee(customer, employee, availableNames, assigned, { requirePlus: false });
      if (!match.eligible) continue;
      const commuteCell = findCommuteCell(customer, employee, customers, employees, commuteMatrix);
      const commute = getChainedCommuteMinutes(
        customer,
        employee,
        assigned,
        commuteCell,
        options.legCache
      );
      const sc =
        options.commuteMode === 'transit'
          ? match.score
          : combinedScore(customer, employee, match, assigned, commuteCell, options.legCache);

      if (isBetterEmployeePick(options.commuteMode, commute, sc, bestCommute, bestScore)) {
        bestScore = sc;
        bestCommute = commute;
        bestEmp = employee;
        bestMatch = match;
        bestCommuteCell = commuteCell;
      }
    }

    if (bestEmp && bestMatch) {
      const assigned = assignedPerEmp.get(bestEmp.id) || [];
      pairings.push(buildPairing(customer, bestEmp, bestMatch, assigned, bestCommuteCell, false, options.legCache));
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

  const recalculated = recalculateChainedPairings(pairings, customers, employees, options.legCache);
  return { pairings: recalculated, unmatched };
}

/** 按最终全天行程重算每单串联通勤（公交/地铁或本地） */
async function recalculateChainedPairingsAsync(
  pairings: CompanyEmployeePairing[],
  customers: Customer[],
  employees: Employee[],
  options: PairingOptions = {}
): Promise<CompanyEmployeePairing[]> {
  const mode = options.commuteMode ?? 'local';
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
      const from = getCommuteOriginForNextStop(emp, assigned, customer);
      let route: RouteEstimate;
      if (mode === 'transit') {
        route =
          getLegFromCache(from, customer.address, options.legCache) ||
          (await estimateRouteWithMode(
            from,
            customer.address,
            customer.parkName,
            customer.companyName,
            'transit'
          ));
      } else {
        route = getChainedRoute(customer, emp, assigned, pairing.route, options.legCache);
      }
      updated.set(pairing.customerId, {
        ...pairing,
        commuteMinutes: route.minutes,
        route,
      });
      assigned.push(customer);
    }
  }

  return pairings.map((p) => updated.get(p.customerId) || p);
}

function recalculateChainedPairings(
  pairings: CompanyEmployeePairing[],
  customers: Customer[],
  employees: Employee[],
  legCache?: LegCache
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
      const route = getChainedRoute(customer, emp, assigned, pairing.route, legCache);
      updated.set(pairing.customerId, {
        ...pairing,
        commuteMinutes: route.minutes,
        route,
      });
      assigned.push(customer);
    }
  }

  return pairings.map((p) => updated.get(p.customerId) || p);
}

async function runCompliantPairingAsync(
  customers: Customer[],
  employees: Employee[],
  autoSelected: boolean,
  options: PairingOptions = {}
): Promise<PairingOptimizationResult> {
  if (customers.length === 0) throw new Error('请至少选择一家公司');

  const mode = options.commuteMode ?? 'local';
  let pairingOptions = options;

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

  if (mode === 'transit') {
    const legCache = new Map<string, RouteEstimate>();
    pairingOptions = { ...options, legCache };
  }

  const commuteMatrix = await buildCommuteMatrix(
    customers.map((c) => ({ address: c.address, parkName: c.parkName, companyName: c.companyName })),
    employees,
    eligibleMask,
    mode,
    pairingOptions.legCache
  );

  if (mode === 'transit' && pairingOptions.legCache) {
    const maxWarm =
      customers.length <= 12 ? 800 : customers.length <= 25 ? 400 : 150;
    await warmChainedTransitLegs(
      customers.map((c) => c.address),
      pairingOptions.legCache,
      maxWarm
    );
  }

  const { pairings, unmatched } = findCapacitatedMatching(
    customers,
    employees,
    commuteMatrix,
    pairingOptions
  );
  const n = customers.length;

  const finalPairings =
    mode === 'transit'
      ? await recalculateChainedPairingsAsync(pairings, customers, employees, pairingOptions)
      : pairings;

  let message: string;
  if (unmatched.length === 0) {
    message = autoSelected
      ? `已为 ${n} 家公司匹配 ${finalPairings.length} 单，全部合规（支持员工一天多单）`
      : `${finalPairings.length} 组配对全部合规`;
  } else if (finalPairings.length === 0) {
    message = `${n} 家公司均无法合规匹配`;
  } else {
    message = `${finalPairings.length} 单已合规匹配，${unmatched.length} 家未匹配`;
  }

  return {
    pairings: finalPairings,
    unmatched,
    totalScore: finalPairings.reduce((s, p) => s + p.score, 0),
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
