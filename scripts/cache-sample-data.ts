/**
 * 仅生成首屏静态缓存 sample-data.json（不跑全量匹配，秒级完成）
 * 运行: npm run cache:sample-data
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { buildSampleDataPayload } from '../src/services/parse-metadata';

const ROOT = path.join(__dirname, '..');

function main() {
  const integrated = buildIntegratedData(ROOT);
  const payload = buildSampleDataPayload(integrated);
  const cacheDir = path.join(ROOT, 'public', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'sample-data.json'), JSON.stringify(payload), 'utf-8');
  console.log(`✓ sample-data.json (${integrated.customers.length} 家公司、${integrated.employees.length} 名员工)`);
}

main();
