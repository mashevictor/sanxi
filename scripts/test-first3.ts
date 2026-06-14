import { loadEnvFile } from '../src/services/distance-service';
import { importAllData } from '../src/services/excel-importer';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import path from 'path';

loadEnvFile();

async function main() {
  const dataDir = path.join(__dirname, '..');
  const data = importAllData(dataDir);
  const first3 = data.customers.slice(0, 3).map((c) => c.id);

  console.log('=== 前 3 家公司 ===');
  for (const c of data.customers.slice(0, 3)) {
    console.log(`- ${c.companyName} | 园区: ${c.parkName} | 地址: ${c.address}`);
  }

  const result = await dispatchSelectedCompanies(data, first3);
  console.log('\n=== 匹配结果 ===');
  console.log(result.message);
  console.log(`距离来源: ${result.distanceSource}`);
  console.log(`已选 ${result.stats.selected} / 匹配 ${result.stats.matched} / 未匹配 ${result.stats.unmatched}`);

  for (const p of result.pairings) {
    console.log(`\n✓ ${p.companyName} → ${p.employeeName}`);
    console.log(`  出发地: ${p.departureAddress}`);
    console.log(`  园区: ${p.parkName}`);
    console.log(`  通勤: ${p.commuteMinutes} 分钟 (${p.route?.source})`);
    if (p.route?.pathSummary) console.log(`  路径: ${p.route.pathSummary}`);
  }

  for (const u of result.unmatchedCompanies) {
    console.log(`\n✗ 未匹配: ${u.companyName}`);
    console.log(`  原因: ${u.reason}`);
    if (u.nearestAttempt) {
      console.log(`  最近候选: ${u.nearestAttempt.employeeName} (${u.nearestAttempt.departureAddress})`);
      if (u.nearestAttempt.route) console.log(`  通勤: ${u.nearestAttempt.route.minutes}分 - ${u.nearestAttempt.route.pathSummary}`);
      for (const r of u.nearestAttempt.failedRules) console.log(`    ✗ ${r.rule}: ${r.message}`);
    }
    if (u.conflictWith) {
      console.log(`  冲突: ${u.conflictWith.employeeName} 已派给 ${u.conflictWith.takenByCompany}`);
      if (u.conflictWith.route) console.log(`  若派此人通勤: ${u.conflictWith.route.minutes}分 - ${u.conflictWith.route.pathSummary}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
