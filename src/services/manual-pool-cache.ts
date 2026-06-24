/**
 * 手动派单预计算池：后道全量 / 前道全量匹配结果缓存
 */

import fs from 'fs';
import path from 'path';
import {
  CustomerType,
  EmployeeRole,
  Employee,
} from '../types';
import { IntegratedData } from '../data/integrated-data';
import { SelectDispatchResponse, SelectDispatchPairing } from './select-dispatch';
import { getIntegratedDataVersion } from './integrated-cache';
import { LockedPairing } from './pairing-optimizer';

export type ManualPoolKind = 'back' | 'front';

export interface ManualPoolCacheFile {
  version: 1;
  dataVersion: string;
  poolKind: ManualPoolKind;
  poolLabel: string;
  generatedAt: string;
  customerIds: number[];
  employeePoolIds: number[];
  dispatch: SelectDispatchResponse;
}

export type ManualPoolHit =
  | { mode: 'full'; dispatch: SelectDispatchResponse; poolKind: ManualPoolKind }
  | {
      mode: 'partial';
      poolKind: ManualPoolKind;
      lockedPairings: LockedPairing[];
      rematchCustomerIds: number[];
    };

const CACHE_FILES: Record<ManualPoolKind, string> = {
  back: 'manual-pool-back.json',
  front: 'manual-pool-front.json',
};

let loaded: Partial<Record<ManualPoolKind, ManualPoolCacheFile>> = {};

function cachePath(dataDir: string, kind: ManualPoolKind): string {
  return path.join(dataDir, 'public', 'cache', CACHE_FILES[kind]);
}

export function resetManualPoolCacheMemory(): void {
  loaded = {};
}

export function loadManualPoolCacheFile(
  dataDir: string,
  kind: ManualPoolKind
): ManualPoolCacheFile | null {
  if (loaded[kind]) return loaded[kind]!;
  const file = cachePath(dataDir, kind);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as ManualPoolCacheFile;
    loaded[kind] = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function loadAllManualPoolCaches(dataDir: string): ManualPoolCacheFile[] {
  return (['back', 'front'] as ManualPoolKind[])
    .map((k) => loadManualPoolCacheFile(dataDir, k))
    .filter((c): c is ManualPoolCacheFile => !!c);
}

function sortedNums(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

function sameIdSet(a: number[], b: number[]): boolean {
  const sa = sortedNums(a);
  const sb = sortedNums(b);
  if (sa.length !== sb.length) return false;
  return sa.every((v, i) => v === sb[i]);
}

export function isIdSubset(sub: number[], sup: number[]): boolean {
  const set = new Set(sup);
  return sub.every((id) => set.has(id));
}

/** 员工池去同名（与手动页「全选员工」一致） */
export function dedupeEmployeePoolIds(employees: Employee[]): number[] {
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const e of employees) {
    const name = (e.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ids.push(e.id);
  }
  return ids;
}

export function buildManualPoolIds(
  data: IntegratedData,
  kind: ManualPoolKind
): { customerIds: number[]; employeePoolIds: number[]; poolLabel: string } {
  if (kind === 'back') {
    const customerIds = data.customers
      .filter((c) => c.customerType === CustomerType.FOLLOW_UP)
      .map((c) => c.id);
    const employees = data.employees.filter((e) => e.roles.includes(EmployeeRole.BACK));
    return {
      customerIds,
      employeePoolIds: dedupeEmployeePoolIds(employees),
      poolLabel: '后道全量（全部回访公司 × 后道员工池）',
    };
  }
  const customerIds = data.customers
    .filter((c) => c.customerType === CustomerType.FIRST_VISIT)
    .map((c) => c.id);
  const employees = data.employees.filter((e) => e.roles.includes(EmployeeRole.FRONT));
  return {
    customerIds,
    employeePoolIds: dedupeEmployeePoolIds(employees),
    poolLabel: '前道全量（全部首访公司 × 前道员工池）',
  };
}

function buildSlicedDispatch(
  full: SelectDispatchResponse,
  pairings: SelectDispatchPairing[],
  unmatched: SelectDispatchResponse['unmatchedCompanies'],
  customerIds: number[]
): SelectDispatchResponse {
  const customerSet = new Set(customerIds);
  const empIds = new Set(pairings.map((p) => p.employeeId));
  const schedules = (full.employeeSchedules || [])
    .filter((s) => empIds.has(s.employeeId))
    .map((s) => {
      const orders = s.orders.filter((o) => customerSet.has(o.customerId));
      return {
        ...s,
        orders,
        totalOrders: orders.length,
        morningOrders: orders.filter((o) => o.timeSlot === '上午').length,
        afternoonOrders: orders.filter((o) => o.timeSlot !== '上午').length,
        totalCommuteMinutes: orders.reduce((sum, o) => sum + (o.commuteMinutes || 0), 0),
        routeSegments: s.routeSegments.filter((seg, i) => i < orders.length),
      };
    })
    .filter((s) => s.orders.length > 0);

  const matched = pairings.length;
  const failed = unmatched.length;
  const avgCommute =
    matched > 0
      ? Math.round(pairings.reduce((s, p) => s + p.commuteMinutes, 0) / matched)
      : 0;

  return {
    success: failed === 0,
    message:
      failed === 0
        ? `已为 ${customerIds.length} 家公司匹配 ${matched} 单，全部合规（缓存切片）`
        : `已为 ${customerIds.length} 家公司匹配 ${matched} 单，${failed} 单待处理（缓存切片）`,
    maxCommuteMinutes: full.maxCommuteMinutes,
    distanceSource: full.distanceSource,
    stats: {
      selected: customerIds.length,
      matched,
      unmatched: failed,
      totalScore: pairings.reduce((s, p) => s + p.score, 0),
      avgCommute,
    },
    pairings,
    unmatchedCompanies: unmatched,
    employeeSchedules: schedules,
  };
}

/** 从全量池缓存中切出子集；员工不在池内则进入 rematch */
export function sliceManualPoolDispatch(
  full: SelectDispatchResponse,
  customerIds: number[],
  employeePoolIds: number[]
):
  | { complete: true; dispatch: SelectDispatchResponse }
  | { complete: false; lockedPairings: LockedPairing[]; rematchCustomerIds: number[] } {
  const customerSet = new Set(customerIds);
  const poolSet = new Set(employeePoolIds);
  const pairings: SelectDispatchPairing[] = [];
  const lockedPairings: LockedPairing[] = [];
  const matchedIds = new Set<number>();

  for (const p of full.pairings || []) {
    if (!customerSet.has(p.customerId)) continue;
    if (poolSet.has(p.employeeId)) {
      pairings.push(p);
      matchedIds.add(p.customerId);
      lockedPairings.push({ customerId: p.customerId, employeeId: p.employeeId });
    }
  }

  const rematchCustomerIds = customerIds.filter((id) => !matchedIds.has(id));
  for (const u of full.unmatchedCompanies || []) {
    if (customerSet.has(u.customerId) && !matchedIds.has(u.customerId)) {
      if (!rematchCustomerIds.includes(u.customerId)) {
        rematchCustomerIds.push(u.customerId);
      }
    }
  }

  if (rematchCustomerIds.length === 0) {
    const unmatched = (full.unmatchedCompanies || []).filter((u) => customerSet.has(u.customerId));
    return {
      complete: true,
      dispatch: buildSlicedDispatch(full, pairings, unmatched, customerIds),
    };
  }

  return { complete: false, lockedPairings, rematchCustomerIds };
}

export function tryGetManualPoolDispatch(
  dataDir: string,
  customerIds: number[],
  employeePoolIds?: number[]
): ManualPoolHit | null {
  if (!employeePoolIds?.length || !customerIds.length) return null;

  for (const kind of ['back', 'front'] as ManualPoolKind[]) {
    const file = loadManualPoolCacheFile(dataDir, kind);
    if (!file) continue;
    if (file.dataVersion !== getIntegratedDataVersion()) continue;

    if (
      sameIdSet(customerIds, file.customerIds) &&
      sameIdSet(employeePoolIds, file.employeePoolIds)
    ) {
      return { mode: 'full', dispatch: file.dispatch, poolKind: kind };
    }

    if (
      isIdSubset(customerIds, file.customerIds) &&
      isIdSubset(employeePoolIds, file.employeePoolIds)
    ) {
      const sliced = sliceManualPoolDispatch(file.dispatch, customerIds, employeePoolIds);
      if (sliced.complete) {
        return { mode: 'full', dispatch: sliced.dispatch, poolKind: kind };
      }
      if (sliced.lockedPairings.length > 0) {
        return {
          mode: 'partial',
          poolKind: kind,
          lockedPairings: sliced.lockedPairings,
          rematchCustomerIds: sliced.rematchCustomerIds,
        };
      }
    }
  }
  return null;
}

export function getManualPoolMeta(data: IntegratedData): {
  back: { customerIds: number[]; employeePoolIds: number[]; cacheUrl: string; poolLabel: string };
  front: { customerIds: number[]; employeePoolIds: number[]; cacheUrl: string; poolLabel: string };
} {
  const ver = getIntegratedDataVersion();
  const back = buildManualPoolIds(data, 'back');
  const front = buildManualPoolIds(data, 'front');
  return {
    back: {
      ...back,
      cacheUrl: `/cache/manual-pool-back.json?v=${ver}`,
    },
    front: {
      ...front,
      cacheUrl: `/cache/manual-pool-front.json?v=${ver}`,
    },
  };
}
