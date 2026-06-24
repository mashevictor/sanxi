/**
 * 匹配结果路线合理性审计：逐单、逐段检查时间与 pathSummary
 */

import {
  Customer,
  Employee,
  TIME_SLOT_LABELS,
} from '../types';
import { SelectDispatchPairing } from './select-dispatch';
import {
  getCommuteOriginForNextStop,
  MAX_ACCEPTABLE_COMMUTE_MINUTES,
  MAX_REALISTIC_COMMUTE_MINUTES,
  sortCustomersByVisitOrder,
} from '../utils/commute';
import {
  estimateStraightKmHeuristic,
  isSuspiciousCachedTransit,
  reasonableTransitCapMinutes,
  sameShanghaiDistrict,
  transitHasDetourLines,
} from '../utils/transit-reasonable';
import { RouteEstimate, legCacheKey, getLegFromCache } from './distance-service';
import { getTransitFromDisk } from './transit-disk-cache';
import type { LegCache } from './distance-service';

export type RouteIssueLevel = 'error' | 'warn' | 'info';

export interface RouteIssue {
  level: RouteIssueLevel;
  type: string;
  company: string;
  employee: string;
  slot?: string;
  minutes?: number;
  from?: string;
  to?: string;
  message: string;
  pathSummary?: string;
  source?: string;
}

function resolveLegRoute(
  from: string,
  to: string,
  legCache?: LegCache
): RouteEstimate | undefined {
  const mem = getLegFromCache(from, to, legCache);
  if (mem) return mem;
  const disk = getTransitFromDisk(legCacheKey(from, to));
  return disk;
}

/** 单段路线内容与时长是否合理 */
export function auditSingleLeg(
  from: string,
  to: string,
  route: RouteEstimate | undefined,
  minutes: number,
  context: { company: string; employee: string; slot?: string; designatedPerson?: string }
): RouteIssue[] {
  const issues: RouteIssue[] = [];
  const path = route?.pathSummary || '';
  const source = route?.source || 'unknown';
  const sk = route?.straightKm ?? estimateStraightKmHeuristic(from, to);
  const cap = reasonableTransitCapMinutes(sk);
  const designated = context.designatedPerson === context.employee;

  if (route && isSuspiciousCachedTransit(route, from, to)) {
    issues.push({
      level: 'error',
      type: '绕远路线',
      company: context.company,
      employee: context.employee,
      slot: context.slot,
      minutes,
      from,
      to,
      message: `路线疑似绕远（${minutes} 分，路径 ${route.distanceKm ?? '?'} km）`,
      pathSummary: path.slice(0, 200),
      source,
    });
  }

  if (/市域机场线|机场联络线|磁浮/.test(path)) {
    const sameDist = sameShanghaiDistrict(from, to);
    if (sameDist || sk < 25) {
      issues.push({
        level: 'error',
        type: '不合理线路',
        company: context.company,
        employee: context.employee,
        slot: context.slot,
        minutes,
        from,
        to,
        message: `含机场/磁浮线，同区或短途不应出现（${minutes} 分）`,
        pathSummary: path.slice(0, 200),
        source,
      });
    }
  }

  if (transitHasDetourLines(path, sk) && !issues.some((i) => i.type === '不合理线路')) {
    issues.push({
      level: 'warn',
      type: '绕远关键词',
      company: context.company,
      employee: context.employee,
      minutes,
      message: `路径含常见绕远关键词，直线约 ${sk.toFixed(1)} km`,
      pathSummary: path.slice(0, 200),
      source,
    });
  }

  if (minutes > MAX_REALISTIC_COMMUTE_MINUTES) {
    issues.push({
      level: designated ? 'info' : 'error',
      type: '超现实上限',
      company: context.company,
      employee: context.employee,
      slot: context.slot,
      minutes,
      message: designated
        ? `指定人单 ${minutes} 分（> ${MAX_REALISTIC_COMMUTE_MINUTES}，指定人优先）`
        : `单程 ${minutes} 分超过 ${MAX_REALISTIC_COMMUTE_MINUTES} 分现实上限`,
      pathSummary: path.slice(0, 120),
      source,
    });
  } else if (minutes > MAX_ACCEPTABLE_COMMUTE_MINUTES) {
    issues.push({
      level: designated ? 'info' : 'warn',
      type: '超软上限',
      company: context.company,
      employee: context.employee,
      slot: context.slot,
      minutes,
      message: designated
        ? `指定人单 ${minutes} 分（> ${MAX_ACCEPTABLE_COMMUTE_MINUTES}）`
        : `单程 ${minutes} 分超过 ${MAX_ACCEPTABLE_COMMUTE_MINUTES} 分软上限（直线约 ${sk.toFixed(1)} km，合理上限约 ${cap} 分）`,
      pathSummary: path.slice(0, 120),
      source,
    });
  } else if (minutes > cap + 5 && source === 'transit') {
    issues.push({
      level: 'warn',
      type: '偏长',
      company: context.company,
      employee: context.employee,
      minutes,
      message: `${minutes} 分高于直线 ${sk.toFixed(1)} km 的合理上限 ${cap} 分`,
      pathSummary: path.slice(0, 120),
      source,
    });
  }

  if (source === 'local' && !path.includes('步行') && sk < 6) {
    issues.push({
      level: 'info',
      type: '本地估算',
      company: context.company,
      employee: context.employee,
      minutes,
      message: `近距离 (${sk.toFixed(1)} km) 使用本地矩阵估算，部署高德 Key 后可得精确公交/步行`,
      source,
    });
  }

  if (!path && minutes > 0) {
    issues.push({
      level: 'warn',
      type: '缺少路径说明',
      company: context.company,
      employee: context.employee,
      minutes,
      message: '有通勤分钟数但无 pathSummary',
    });
  }

  return issues;
}

/** 全量派单结果：逐单首段 + 一人多单各串联段 */
export function auditAllPairingRoutes(
  pairings: SelectDispatchPairing[],
  customers: Customer[],
  employees: Employee[],
  legCache?: LegCache
): RouteIssue[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const byEmp = new Map<number, SelectDispatchPairing[]>();

  for (const p of pairings) {
    const list = byEmp.get(p.employeeId) || [];
    list.push(p);
    byEmp.set(p.employeeId, list);
  }

  const issues: RouteIssue[] = [];

  for (const [empId, orders] of byEmp) {
    const employee = employeeById.get(empId);
    if (!employee) continue;

    const sorted = sortCustomersByVisitOrder(
      orders.map((p) => customerById.get(p.customerId)!).filter(Boolean)
    );
    const assigned: Customer[] = [];

    for (const customer of sorted) {
      const pairing = orders.find((p) => p.customerId === customer.id)!;
      const from = getCommuteOriginForNextStop(employee, assigned, customer);
      const isFirst = from === employee.departureAddress;
      const route = pairing.route;
      const legRoute =
        isFirst
          ? route
          : resolveLegRoute(from, customer.address, legCache) || route;

      const legMinutes = isFirst
        ? pairing.commuteMinutes
        : legRoute?.minutes ?? pairing.commuteMinutes;

      if (!isFirst && legRoute && Math.abs(legMinutes - pairing.commuteMinutes) > 2) {
        issues.push({
          level: 'warn',
          type: '串联偏差',
          company: customer.companyName,
          employee: employee.name,
          slot: TIME_SLOT_LABELS[customer.timeSlot],
          minutes: pairing.commuteMinutes,
          from,
          to: customer.address,
          message: `报告 ${pairing.commuteMinutes} 分 vs 串联重算 ${legMinutes} 分（差 ${Math.abs(legMinutes - pairing.commuteMinutes)}）`,
          pathSummary: legRoute.pathSummary?.slice(0, 150),
          source: legRoute.source,
        });
      }

      issues.push(
        ...auditSingleLeg(from, customer.address, legRoute, legMinutes, {
          company: customer.companyName,
          employee: employee.name,
          slot: TIME_SLOT_LABELS[customer.timeSlot],
          designatedPerson: customer.designatedPerson,
        })
      );

      assigned.push(customer);
    }
  }

  return issues;
}

export function summarizeRouteAudit(issues: RouteIssue[]) {
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const infos = issues.filter((i) => i.level === 'info');
  return {
    total: issues.length,
    errorCount: errors.length,
    warningCount: warns.length,
    infoCount: infos.length,
    allRoutesReasonable: errors.length === 0,
    errors,
    warnings: warns,
    infos,
  };
}
