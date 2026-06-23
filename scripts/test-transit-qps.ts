/**
 * 高德 QPS 策略验证：小批量匹配 + 统计
 * 运行: GAODE_API_KEY=xxx GAODE_QPS=1 npx tsx scripts/test-transit-qps.ts
 */

import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { getGaodeCommuteStats, resetGaodeCommuteStats, loadEnvFile } from '../src/services/distance-service';
import { flushTransitDiskCache } from '../src/services/transit-disk-cache';

const DATA_DIR = '.';

async function main() {
  loadEnvFile();
  resetGaodeCommuteStats();

  if (!process.env.GAODE_API_KEY) {
    console.error('请设置 GAODE_API_KEY');
    process.exit(1);
  }

  const data = buildIntegratedData(DATA_DIR);
  const ids = data.fullMatchCustomerIds.slice(0, 8);
  const t0 = Date.now();

  console.log(`\n=== 高德 QPS 策略测试（${ids.length} 家公司）===`);
  console.log(`GAODE_QPS=${process.env.GAODE_QPS || 1}\n`);

  const result = await dispatchSelectedCompanies(data, ids, undefined, { commuteMode: 'transit' });
  flushTransitDiskCache();

  const stats = getGaodeCommuteStats();
  const transitCount = result.pairings.filter((p) => p.route?.source === 'transit').length;
  const localCount = result.pairings.filter((p) => p.route?.source === 'local').length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n--- 匹配结果 ---`);
  console.log(`匹配: ${result.stats.matched}/${result.stats.selected}  未匹配: ${result.stats.unmatched}`);
  console.log(`通勤来源: ${result.distanceSource}`);
  console.log(`公交/地铁: ${transitCount} 条  本地降级: ${localCount} 条`);
  console.log(`耗时: ${elapsed}s`);

  console.log(`\n--- QPS 策略统计 ---`);
  console.log(`内存命中: ${stats.memoryHits}`);
  console.log(`磁盘命中: ${stats.diskHits}`);
  console.log(`API 调用: ${stats.apiCalls}`);
  console.log(`本地降级: ${stats.localFallbacks}`);
  console.log(`限流重试: ${stats.limiter.retries}  触发限流: ${stats.limiter.rateLimited}`);
  console.log(`磁盘缓存条目: ${stats.disk.entries}  本次新增: ${stats.disk.saved}`);

  console.log(`\n--- 样例路线 ---`);
  for (const p of result.pairings.slice(0, 3)) {
    console.log(
      `  ${p.companyName} → ${p.employeeName}: ${p.commuteMinutes}分 [${p.route?.source}] ${(p.route?.pathSummary || '').slice(0, 55)}…`
    );
  }

  if (result.stats.unmatched > 0) {
    process.exit(1);
  }
  console.log('\n✓ 测试通过\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
