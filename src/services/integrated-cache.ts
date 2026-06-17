import fs from 'fs';
import path from 'path';
import { buildIntegratedData, IntegratedData } from '../data/integrated-data';

const EXCEL_FILES = [
  '园区数据.xlsx',
  '首访数据.xlsx',
  '项目数据.xlsx',
  '回访数据.xlsx',
  '派单员工表 (1).xls',
];

let cached: IntegratedData | null = null;
let cachedSignature = '';

const INTEGRATED_DATA_VERSION = '20260617-front-back-tests';

export function getIntegratedDataVersion(): string {
  return INTEGRATED_DATA_VERSION;
}

function getDataSignature(dataDir: string): string {
  return (
    INTEGRATED_DATA_VERSION +
    '|' +
    EXCEL_FILES.map((f) => {
    const filePath = path.join(dataDir, f);
    try {
      const stat = fs.statSync(filePath);
      return `${f}:${stat.mtimeMs}`;
    } catch {
      return `${f}:missing`;
    }
    }).join('|')
  );
}

/** 内存缓存整合数据，Excel 变更时自动失效 */
export function getIntegratedData(dataDir: string): IntegratedData {
  const signature = getDataSignature(dataDir);
  if (cached && cachedSignature === signature) return cached;
  cached = buildIntegratedData(dataDir);
  cachedSignature = signature;
  return cached;
}

/** 服务启动时预热，避免首请求解析 Excel */
export function warmIntegratedCache(dataDir: string): void {
  try {
    const data = getIntegratedData(dataDir);
    console.log(`  数据缓存已预热: ${data.customers.length} 家公司、${data.employees.length} 名员工`);
  } catch (err) {
    console.warn('  数据缓存预热失败，将在首次请求时加载:', err instanceof Error ? err.message : err);
  }
}
