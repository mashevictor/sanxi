/**
 * 派单系统入口
 */

import * as path from 'path';
import { importAllData, exportDispatchResults } from './services/excel-importer';
import { DispatchEngine, formatDispatchReport } from './services/dispatch-engine';
import { FrontProjectMode } from './types';

const DATA_DIR = path.resolve(__dirname, '..');

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       招 商 派 单 系 统 v1.0            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log();

  console.log('[1/3] 导入 Excel 测试数据...');
  const importResult = importAllData(DATA_DIR);

  console.log(`  ✓ 首访(前道): ${importResult.stats.firstVisitCount} 条`);
  console.log(`  ✓ 项目:       ${importResult.stats.projectCount} 条`);
  console.log(`  ✓ 回访(后道): ${importResult.stats.followUpCount} 条`);
  console.log(`  ✓ 员工:       ${importResult.stats.employeeCount} 人`);
  console.log(`  ✓ 招商园区:   ${importResult.parks.join(', ')}`);
  console.log(`  ✓ 牵手单组:   ${importResult.stats.handInHandGroups} 组`);
  console.log();

  console.log('[2/3] 执行派单算法...');
  const engine = new DispatchEngine({
    frontProjectMode: FrontProjectMode.RANDOM,
    enableDistanceOptimization: true,
    allowCommuteOverridePlus: true,
  });

  const batch = engine.dispatch(importResult.customers, importResult.employees);
  console.log(`  ✓ 成功派单: ${batch.statistics.totalAssigned} / ${batch.totalCustomers}`);
  console.log();

  console.log('[3/3] 生成派单报告...');
  const report = formatDispatchReport(batch);
  console.log(report);

  const outputPath = path.join(DATA_DIR, '派单结果.xlsx');
  const savedPath = exportDispatchResults(
    batch.results.map((r) => ({
      customerName: r.customerName,
      employeeName: r.employeeName,
      timeSlot: r.timeSlot,
      customerType: r.customerType,
      commuteMinutes: r.commuteMinutes,
    })),
    outputPath
  );
  console.log(`\n派单结果已导出: ${savedPath}`);
}

main().catch(console.error);
