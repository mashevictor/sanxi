/**
 * 生成匹配缓存：演示 10 家 + 全量 55 家
 * 运行: npm run cache:showcase
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData, buildShowcaseSnapshot } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';

const DATA_DIR = path.join(__dirname, '..');

async function writeCache(filename: string, payload: object) {
  const cacheDir = path.join(DATA_DIR, 'public', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(payload), 'utf-8');
}

async function main() {
  const integrated = buildIntegratedData(DATA_DIR);

  const showcaseSnapshot = buildShowcaseSnapshot();
  const showcaseDispatch = await dispatchSelectedCompanies(
    integrated,
    showcaseSnapshot.showcaseCustomerIds
  );

  const showcaseCache = {
    version: 1,
    generatedAt: new Date().toISOString(),
    showcaseCustomerIds: showcaseSnapshot.showcaseCustomerIds,
    showcaseEmployeeIds: showcaseSnapshot.showcaseEmployeeIds,
    maxCommuteMinutes: 60,
    distanceSource: showcaseDispatch.distanceSource || 'local',
    stats: showcaseDispatch.stats,
    message: showcaseDispatch.message,
    pairings: showcaseDispatch.pairings,
    unmatchedCompanies: showcaseDispatch.unmatchedCompanies,
    employeeSchedules: showcaseDispatch.employeeSchedules,
  };

  const fullDispatch = await dispatchSelectedCompanies(integrated, integrated.fullMatchCustomerIds);
  const fullCache = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fullMatchCustomerIds: integrated.fullMatchCustomerIds,
    maxCommuteMinutes: 60,
    distanceSource: fullDispatch.distanceSource || 'local',
    stats: fullDispatch.stats,
    message: fullDispatch.message,
    pairings: fullDispatch.pairings,
    unmatchedCompanies: fullDispatch.unmatchedCompanies,
    employeeSchedules: fullDispatch.employeeSchedules,
  };

  await writeCache('showcase-match.json', showcaseCache);
  await writeCache('full-match.json', fullCache);

  console.log(`✓ showcase-match.json (${showcaseDispatch.stats.matched}/${showcaseDispatch.stats.selected})`);
  console.log(`✓ full-match.json (${fullDispatch.stats.matched}/${fullDispatch.stats.selected})`);
  if (fullDispatch.unmatchedCompanies.length) {
    fullDispatch.unmatchedCompanies.forEach((u) => console.log('  未匹配:', u.companyName, u.reason));
    process.exit(1);
  }
  console.log('全量 55 家匹配 100% 成功');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
