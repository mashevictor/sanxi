/**
 * 对比「旧规则 vs 通勤最短优先」全量匹配效果（均使用高德公交/地铁 transit 磁盘缓存）
 * 运行: npm run compare:commute
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { loadEnvFile } from '../src/services/distance-service';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';

const MAX = 60;
const DATA_DIR = path.join(__dirname, '..');

const DISPATCH_OPTS = {
  commuteMode: 'transit' as const,
  transitWarmMaxFetches: 0,
};

async function main() {
  loadEnvFile();
  useDiskTransitOnly();
  const legCache = preloadTransitLegCache(DATA_DIR);
  const data = buildIntegratedData(DATA_DIR);
  const ids = data.fullMatchCustomerIds;

  console.log(`\n=== 匹配规则对比（55 家，高德 transit 磁盘 ${legCache.size} 条，不调 API）===\n`);

  const legacy = await dispatchSelectedCompanies(data, ids, undefined, {
    ...DISPATCH_OPTS,
    preferShortestCommute: false,
    legCache,
  });

  const modern = await dispatchSelectedCompanies(data, ids, undefined, {
    ...DISPATCH_OPTS,
    preferShortestCommute: true,
    legCache,
  });

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const legacyCommutes = legacy.pairings.map((p) => p.commuteMinutes);
  const modernCommutes = modern.pairings.map((p) => p.commuteMinutes);
  const legacyOver60 = legacyCommutes.filter((c) => c > MAX).length;
  const modernOver60 = modernCommutes.filter((c) => c > MAX).length;

  console.log('指标                    旧规则                  新规则（通勤最短优先）');
  console.log('─'.repeat(72));
  console.log(`匹配数                  ${legacy.stats.matched}/55              ${modern.stats.matched}/55`);
  console.log(`平均通勤                ${legacy.stats.avgCommute} 分              ${modern.stats.avgCommute} 分`);
  console.log(`总通勤                  ${sum(legacyCommutes)} 分              ${sum(modernCommutes)} 分`);
  console.log(`超 60 分警告            ${legacyOver60} 条                  ${modernOver60} 条`);
  console.log(`通勤来源                ${legacy.distanceSource || '—'}              ${modern.distanceSource || '—'}`);
  console.log(`未匹配                  ${legacy.stats.unmatched}                   ${modern.stats.unmatched}`);

  console.log('\n--- 规则差异 ---');
  console.log('旧规则（preferShortestCommute: false）：');
  console.log('  · 选员工：combinedScore = match.score − 通勤×0.2（Plus/园区分可压过通勤）');
  console.log('  · 下午捆绑：combinedPairScore 最高');
  console.log('新规则（默认，高德 transit 串联通勤）：');
  console.log('  · 选员工：合规候选中串联通勤最短 → 同通勤比 match.score');
  console.log('  · 下午捆绑：下午1+下午2 总通勤最短 → 同总通勤比 score');

  const legacyMap = new Map(legacy.pairings.map((p) => [p.customerId, p]));
  const changes: {
    company: string;
    slot: string;
    oldEmp: string;
    oldMin: number;
    newEmp: string;
    newMin: number;
    delta: number;
  }[] = [];

  for (const np of modern.pairings) {
    const op = legacyMap.get(np.customerId);
    if (!op) continue;
    if (op.employeeId !== np.employeeId || op.commuteMinutes !== np.commuteMinutes) {
      changes.push({
        company: np.companyName,
        slot: np.timeSlot,
        oldEmp: op.employeeName,
        oldMin: op.commuteMinutes,
        newEmp: np.employeeName,
        newMin: np.commuteMinutes,
        delta: op.commuteMinutes - np.commuteMinutes,
      });
    }
  }
  changes.sort((a, b) => b.delta - a.delta);

  console.log(`\n--- 派单变化（共 ${changes.length} 条）---`);
  for (const c of changes.slice(0, 20)) {
    const sign = c.delta > 0 ? `省 ${c.delta} 分` : c.delta < 0 ? `增 ${-c.delta} 分` : '持平';
    console.log(`[${c.company}] ${c.slot}: ${c.oldEmp}(${c.oldMin}) → ${c.newEmp}(${c.newMin}) ${sign}`);
  }
  if (changes.length > 20) console.log(`... 另有 ${changes.length - 20} 条`);

  const improved = changes.filter((c) => c.delta > 0);
  const worsened = changes.filter((c) => c.delta < 0);
  console.log(
    `\n通勤改善 ${improved.length} 条，变长 ${worsened.length} 条，净变化 ${sum(improved.map((c) => c.delta)) - sum(worsened.map((c) => -c.delta))} 分`
  );

  const outPath = path.join(DATA_DIR, 'public/cache/commute-priority-compare.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        transitDiskEntries: legCache.size,
        legacy: {
          matched: legacy.stats.matched,
          avgCommute: legacy.stats.avgCommute,
          totalCommute: sum(legacyCommutes),
          over60: legacyOver60,
          distanceSource: legacy.distanceSource,
        },
        modern: {
          matched: modern.stats.matched,
          avgCommute: modern.stats.avgCommute,
          totalCommute: sum(modernCommutes),
          over60: modernOver60,
          distanceSource: modern.distanceSource,
        },
        changes,
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log(`\n详细 JSON: public/cache/commute-priority-compare.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
