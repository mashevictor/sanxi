/**
 * AI 全量匹配预计算缓存：public/cache/full-match.json
 */

import fs from 'fs';
import path from 'path';
import { SelectDispatchResponse, SelectDispatchPairing } from './select-dispatch';
import { DistanceSource } from './distance-service';
import { getIntegratedDataVersion } from './integrated-cache';
import { LockedPairing } from './pairing-optimizer';
import { isIdSubset, normalizeIdList } from './manual-pool-cache';

export interface FullMatchCacheFile {
  version: 1;
  dataVersion: string;
  generatedAt: string;
  fullMatchCustomerIds: number[];
  maxCommuteMinutes: number;
  distanceSource?: string;
  stats: SelectDispatchResponse['stats'];
  message: string;
  pairings: SelectDispatchPairing[];
  unmatchedCompanies: SelectDispatchResponse['unmatchedCompanies'];
  employeeSchedules: SelectDispatchResponse['employeeSchedules'];
}

export type FullMatchHit =
  | { mode: 'full'; dispatch: SelectDispatchResponse }
  | {
      mode: 'partial';
      lockedPairings: LockedPairing[];
      rematchCustomerIds: number[];
    };

let loaded: FullMatchCacheFile | null = null;

function cachePath(dataDir: string): string {
  return path.join(dataDir, 'public', 'cache', 'full-match.json');
}

export function resetFullMatchCacheMemory(): void {
  loaded = null;
}

export function loadFullMatchCacheFile(dataDir: string): FullMatchCacheFile | null {
  const ver = getIntegratedDataVersion();
  if (loaded && loaded.dataVersion !== ver) {
    loaded = null;
  }
  if (loaded) return loaded;
  const file = cachePath(dataDir);
  if (!fs.existsSync(file)) return null;
  try {
    loaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as FullMatchCacheFile;
    return loaded;
  } catch {
    return null;
  }
}

function buildSlicedFullMatch(
  full: FullMatchCacheFile,
  customerIds: number[],
  pairings: SelectDispatchPairing[],
  unmatched: SelectDispatchResponse['unmatchedCompanies']
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
        ? `已为 ${customerIds.length} 家公司匹配 ${matched} 单，全部合规（全量缓存）`
        : `已为 ${customerIds.length} 家公司匹配 ${matched} 单，${failed} 单待处理（全量缓存）`,
    maxCommuteMinutes: full.maxCommuteMinutes,
    distanceSource: full.distanceSource as DistanceSource | undefined,
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

export function sliceFullMatchCache(
  full: FullMatchCacheFile,
  customerIds: number[],
  lockedPairings: LockedPairing[] = [],
  matchOnlyCustomerIds?: number[]
):
  | { complete: true; dispatch: SelectDispatchResponse }
  | { complete: false; lockedPairings: LockedPairing[]; rematchCustomerIds: number[] } {
  const lockedSet = new Set(lockedPairings.map((p) => p.customerId));
  const customerSet = new Set(customerIds);
  const resolveIds = (matchOnlyCustomerIds?.length ? matchOnlyCustomerIds : customerIds).filter(
    (id) => customerSet.has(id) && !lockedSet.has(id)
  );

  const byCid = new Map(full.pairings.map((p) => [p.customerId, p]));
  const rematchCustomerIds: number[] = [];
  const newLocks: LockedPairing[] = [];

  for (const id of resolveIds) {
    const p = byCid.get(id);
    if (p) {
      newLocks.push({ customerId: id, employeeId: p.employeeId });
    } else {
      rematchCustomerIds.push(id);
    }
  }

  if (rematchCustomerIds.length > 0) {
    return {
      complete: false,
      lockedPairings: [...lockedPairings, ...newLocks],
      rematchCustomerIds,
    };
  }

  const pairings = full.pairings
    .filter((p) => customerSet.has(p.customerId))
    .map((p) => ({ ...p, locked: true }));
  const unmatched = full.unmatchedCompanies.filter((u) => customerSet.has(u.customerId));

  return {
    complete: true,
    dispatch: buildSlicedFullMatch(full, customerIds, pairings, unmatched),
  };
}

export function tryGetFullMatchDispatch(
  dataDir: string,
  customerIds: unknown[],
  lockedPairings: LockedPairing[] = [],
  matchOnlyCustomerIds?: unknown[]
): FullMatchHit | null {
  const cids = normalizeIdList(customerIds);
  if (!cids.length) return null;
  const file = loadFullMatchCacheFile(dataDir);
  if (!file?.pairings?.length) return null;
  if (file.dataVersion !== getIntegratedDataVersion()) return null;
  if (!isIdSubset(cids, file.fullMatchCustomerIds)) return null;

  const sliced = sliceFullMatchCache(
    file,
    cids,
    lockedPairings,
    matchOnlyCustomerIds ? normalizeIdList(matchOnlyCustomerIds) : undefined
  );
  if (sliced.complete) {
    return { mode: 'full', dispatch: sliced.dispatch };
  }
  if (sliced.lockedPairings.length) {
    return {
      mode: 'partial',
      lockedPairings: sliced.lockedPairings,
      rematchCustomerIds: sliced.rematchCustomerIds,
    };
  }
  return null;
}
