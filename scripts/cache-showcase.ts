/**
 * 生成演示匹配缓存（固定 ID，仅演示员工，跨环境一致）
 * 运行: npm run cache:showcase
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData, buildShowcaseSnapshot } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';

const DATA_DIR = path.join(__dirname, '..');

async function main() {
  const snapshot = buildShowcaseSnapshot();
  const dispatch = await dispatchSelectedCompanies(snapshot, snapshot.showcaseCustomerIds);

  const integrated = buildIntegratedData(DATA_DIR);

  const matchCache = {
    version: 1,
    generatedAt: new Date().toISOString(),
    showcaseCustomerIds: snapshot.showcaseCustomerIds,
    showcaseEmployeeIds: snapshot.showcaseEmployeeIds,
    maxCommuteMinutes: 60,
    distanceSource: dispatch.distanceSource || 'local',
    stats: dispatch.stats,
    message: dispatch.message,
    pairings: dispatch.pairings,
    unmatchedCompanies: dispatch.unmatchedCompanies,
    employeeSchedules: dispatch.employeeSchedules,
  };

  const root = path.join(__dirname, '..');
  const cacheDir = path.join(root, 'public', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(path.join(cacheDir, 'showcase-match.json'), JSON.stringify(matchCache), 'utf-8');
  fs.writeFileSync(path.join(root, '_showcase_match.json'), JSON.stringify(matchCache, null, 2), 'utf-8');

  const demoEmps = new Set(snapshot.showcaseEmployeeIds);
  const allDemo = dispatch.pairings.every((p) => demoEmps.has(p.employeeId));

  console.log(`✓ public/cache/showcase-match.json (${dispatch.stats.matched}/${dispatch.stats.selected} 匹配)`);
  console.log(`  演示员工匹配: ${allDemo ? '是' : '否'}`);
  console.log(`  整合数据: ${integrated.customers.length} 公司 / ${integrated.employees.length} 员工`);
  console.log(dispatch.message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
