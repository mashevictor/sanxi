/**
 * 预计算手动派单：后道全量 / 前道全量，写入 public/cache/manual-pool-*.json
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
import { getIntegratedDataVersion } from '../src/services/integrated-cache';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';
import { loadEnvFile } from '../src/services/distance-service';

const ROOT = path.join(__dirname, '..');

async function buildOne(
  kind: ManualPoolKind,
  legCache: ReturnType<typeof preloadTransitLegCache>
): Promise<ManualPoolCacheFile> {
  const integrated = buildIntegratedData(ROOT);
  const { customerIds, employeePoolIds, poolLabel } = buildManualPoolIds(integrated, kind);

  console.log(`\n[${kind}] ${poolLabel}`);
  console.log(`  公司 ${customerIds.length} 家 · 员工池 ${employeePoolIds.length} 人`);

  const dispatch = await dispatchSelectedCompanies(integrated, customerIds, undefined, {
    employeePoolIds,
    commuteMode: 'transit',
    preferShortestCommute: true,
    legCache,
    transitWarmMaxFetches: 0,
  });

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

async function main() {
  loadEnvFile();
  useDiskTransitOnly();
  const legCache = preloadTransitLegCache(ROOT);
  console.log(`手动派单池缓存 · 公交磁盘 ${legCache.size} 条`);

  const cacheDir = path.join(ROOT, 'public', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  for (const kind of ['back', 'front'] as ManualPoolKind[]) {
    const payload = await buildOne(kind, legCache);
    const filename = kind === 'back' ? 'manual-pool-back.json' : 'manual-pool-front.json';
    fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(payload), 'utf-8');
    console.log(`✓ ${filename}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
