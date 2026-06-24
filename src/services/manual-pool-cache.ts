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
import { SelectDispatchResponse } from './select-dispatch';
import { getIntegratedDataVersion } from './integrated-cache';

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

export function tryGetManualPoolDispatch(
  dataDir: string,
  customerIds: number[],
  employeePoolIds?: number[]
): { dispatch: SelectDispatchResponse; poolKind: ManualPoolKind; cached: true } | null {
  if (!employeePoolIds?.length || !customerIds.length) return null;

  for (const kind of ['back', 'front'] as ManualPoolKind[]) {
    const file = loadManualPoolCacheFile(dataDir, kind);
    if (!file) continue;
    if (file.dataVersion !== getIntegratedDataVersion()) continue;
    if (
      sameIdSet(customerIds, file.customerIds) &&
      sameIdSet(employeePoolIds, file.employeePoolIds)
    ) {
      return { dispatch: file.dispatch, poolKind: kind, cached: true };
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
