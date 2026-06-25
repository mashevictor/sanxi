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

export function listPresetCacheFilenames(data: IntegratedData): string[] {
  return buildManualPoolPresetMetas(data).map((p) => presetCacheFilename(p.id));
}
