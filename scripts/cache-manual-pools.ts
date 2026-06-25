/**
 * 预计算手动派单：后道/前道全量 + 常用预设池
 * 运行: npm run cache:manual-pools
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import {
  buildManualPoolIds,
  ManualPoolCacheFile,
  ManualPoolKind,
} from '../src/services/manual-pool-cache';
import { buildManualPoolPresetMetas, presetCacheFilename } from '../src/services/manual-pool-presets';
import { getIntegratedDataVersion } from '../src/services/integrated-cache';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';
import { loadEnvFile } from '../src/services/distance-service';

const ROOT = path.join(__dirname, '..');

async function buildDispatch(
  integrated: ReturnType<typeof buildIntegratedData>,
  customerIds: number[],
  employeePoolIds: number[],
  legCache: ReturnType<typeof preloadTransitLegCache>
) {
  return dispatchSelectedCompanies(integrated, customerIds, undefined, {
    employeePoolIds,
    commuteMode: 'transit',
    preferShortestCommute: true,
    legCache,
    transitWarmMaxFetches: 0,
  });
}

async function buildOne(
  kind: ManualPoolKind,
  legCache: ReturnType<typeof preloadTransitLegCache>
): Promise<ManualPoolCacheFile> {
  const integrated = buildIntegratedData(ROOT);
  const { customerIds, employeePoolIds, poolLabel } = buildManualPoolIds(integrated, kind);

  console.log(`\n[${kind}] ${poolLabel}`);
  console.log(`  公司 ${customerIds.length} 家 · 员工池 ${employeePoolIds.length} 人`);

  const dispatch = await buildDispatch(integrated, customerIds, employeePoolIds, legCache);

  console.log(
    `  匹配 ${dispatch.stats.matched}/${dispatch.stats.selected} · 均通勤 ${dispatch.stats.avgCommute} 分`
  );

  return {
    version: 1,
    dataVersion: getIntegratedDataVersion(),
    poolKind: kind,
    poolLabel,
    generatedAt: new Date().toISOString(),
    customerIds,
    employeePoolIds,
    dispatch,
  };
}

async function buildPreset(
  integrated: ReturnType<typeof buildIntegratedData>,
  preset: ReturnType<typeof buildManualPoolPresetMetas>[0],
  legCache: ReturnType<typeof preloadTransitLegCache>
): Promise<ManualPoolCacheFile> {
  console.log(`\n[preset:${preset.id}] ${preset.label}`);
  console.log(`  公司 ${preset.customerIds.length} 家 · 员工池 ${preset.employeePoolIds.length} 人`);

  const dispatch = await buildDispatch(
    integrated,
    preset.customerIds,
    preset.employeePoolIds,
    legCache
  );

  console.log(
    `  匹配 ${dispatch.stats.matched}/${dispatch.stats.selected} · 均通勤 ${dispatch.stats.avgCommute} 分`
  );

  return {
    version: 1,
    dataVersion: getIntegratedDataVersion(),
    presetId: preset.id,
    poolLabel: preset.label,
    generatedAt: new Date().toISOString(),
    customerIds: preset.customerIds,
    employeePoolIds: preset.employeePoolIds,
    dispatch,
  };
}

async function main() {
  loadEnvFile();
  useDiskTransitOnly();
  const legCache = preloadTransitLegCache(ROOT);
  console.log(`手动派单池缓存 · 公交磁盘 ${legCache.size} 条`);

  const cacheDir = path.join(ROOT, 'public', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const integrated = buildIntegratedData(ROOT);

  for (const kind of ['back', 'front'] as ManualPoolKind[]) {
    const payload = await buildOne(kind, legCache);
    const filename = kind === 'back' ? 'manual-pool-back.json' : 'manual-pool-front.json';
    fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(payload), 'utf-8');
    console.log(`✓ ${filename}`);
  }

  const presets = buildManualPoolPresetMetas(integrated);
  console.log(`\n预设池 ${presets.length} 个…`);
  for (const preset of presets) {
    const payload = await buildPreset(integrated, preset, legCache);
    const filename = presetCacheFilename(preset.id);
    fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(payload), 'utf-8');
    console.log(`✓ ${filename}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
