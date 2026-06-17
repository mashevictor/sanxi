/**
 * 生成匹配测试报告 JSON
 * 运行: npm run test:match-report
 */

import fs from 'fs';
import path from 'path';
import { buildMatchTestReport } from '../src/services/match-test-report';

const ROOT = path.join(__dirname, '..');

async function main() {
  const report = await buildMatchTestReport(ROOT);
  const cacheDir = path.join(ROOT, 'public', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const outPath = path.join(cacheDir, 'test-match-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`✓ test-match-report.json`);
  console.log(`  场景 ${report.summary.passedScenarios}/${report.summary.totalScenarios} 通过`);
  console.log(`  页面: /test-match.html`);
  for (const s of report.scenarios) {
    console.log(`  ${s.passed ? '✓' : '✗'} ${s.name}: ${s.stats.matched}/${s.stats.selected}`);
  }
  if (!report.summary.allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
