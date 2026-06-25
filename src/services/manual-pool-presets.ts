/**
 * 手动派单常用预设池（精确公司+员工组合），预计算后可秒开
 */

import { IntegratedData } from '../data/integrated-data';
import { buildRoleScenarioDefs } from './role-match-scenarios';

export interface ManualPoolPresetMeta {
  id: string;
  label: string;
  customerIds: number[];
  employeePoolIds: number[];
}

export function buildManualPoolPresetMetas(data: IntegratedData): ManualPoolPresetMeta[] {
  return buildRoleScenarioDefs(data)
    .filter((s) => s.employeePoolIds)
    .map((s) => ({
      id: s.id,
      label: s.name,
      customerIds: s.customerIds(data).sort((a, b) => a - b),
      employeePoolIds: s.employeePoolIds!(data).sort((a, b) => a - b),
    }));
}

export function presetCacheFilename(presetId: string): string {
  return `manual-pool-preset-${presetId}.json`;
}

/** 两员工池对称差（换人 k 个 ≈ 2k） */
export function symmetricPoolDiffSize(a: number[], b: number[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let n = 0;
  for (const id of sa) if (!sb.has(id)) n++;
  for (const id of sb) if (!sa.has(id)) n++;
  return n;
}

/** 公司完全一致、员工池仅少量换人时找最近预设（默认最多换 3 人 = diff 6） */
export function findNearestPresetMeta(
  customerIds: number[],
  employeePoolIds: number[],
  presets: ManualPoolPresetMeta[],
  maxPoolDiff = 6
): ManualPoolPresetMeta | null {
  let best: ManualPoolPresetMeta | null = null;
  let bestDiff = Infinity;
  for (const p of presets) {
    if (!sameIdSet(customerIds, p.customerIds)) continue;
    const diff = symmetricPoolDiffSize(employeePoolIds, p.employeePoolIds);
    if (diff === 0 || diff > maxPoolDiff) continue;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

function sameIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

export function listPresetCacheFilenames(data: IntegratedData): string[] {
  return buildManualPoolPresetMetas(data).map((p) => presetCacheFilename(p.id));
}
