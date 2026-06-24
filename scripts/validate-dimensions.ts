/**
 * 多维度匹配校验：后道/前道、手动员工池 vs AI 全员、多选子集
 * 运行: npm run validate:dimensions
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import {
  MANUAL_JINSHAN_BACK_POOL,
  JINSHAN_PARK,
  BAOSHAN_PARK,
} from '../src/services/role-match-scenarios';
import { CustomerType, EmployeeRole, TimeSlot } from '../src/types';
import { MAX_REALISTIC_COMMUTE_MINUTES } from '../src/utils/commute';
import { loadEnvFile } from '../src/services/distance-service';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';

const CORE_RULES = ['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配'];
const DATA_DIR = path.join(__dirname, '..');

interface Scenario {
  id: string;
  name: string;
  mode: 'manual' | 'ai';
  customerIds: number[];
  employeePoolIds?: number[];
  expectAllMatched?: boolean;
  /** 限定员工池场景允许 >90（如无补位员工的截图15人池） */
  allowOver90?: boolean;
}

async function runScenario(
  data: ReturnType<typeof buildIntegratedData>,
  scenario: Scenario,
  legCache: ReturnType<typeof preloadTransitLegCache>
) {
  const result = await dispatchSelectedCompanies(data, scenario.customerIds, undefined, {
    commuteMode: 'transit',
    preferShortestCommute: true,
    employeePoolIds: scenario.employeePoolIds,
    legCache,
    transitWarmMaxFetches: 0,
  });

  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));
  const assignments = new Map<number, number[]>();
  for (const p of result.pairings) {
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  let ruleErrors = 0;
  for (const p of result.pairings) {
    const customer = customerById.get(p.customerId)!;
    const employee = employeeById.get(p.employeeId)!;
    const assignedOthers = (assignments.get(p.employeeId) || [])
      .filter((id) => id !== p.customerId)
      .map((id) => customerById.get(id)!)
      .filter(Boolean);
    const match = matchCustomerToEmployee(customer, employee, availableNames, assignedOthers, {
      requirePlus: false,
    });
    const failed = match.details.filter((d) => CORE_RULES.includes(d.rule) && !d.passed);
    if (!match.eligible || failed.length) ruleErrors++;
  }

  const over90 = result.pairings.filter((p) => p.commuteMinutes > MAX_REALISTIC_COMMUTE_MINUTES).length;
  const over60 = result.pairings.filter((p) => p.commuteMinutes > 60).length;
  const ok =
    ruleErrors === 0 &&
    (scenario.allowOver90 || over90 === 0) &&
    (scenario.expectAllMatched === false ||
      (result.stats.unmatched === 0 && result.stats.matched === scenario.customerIds.length));

  return {
    ...scenario,
    selected: scenario.customerIds.length,
    poolSize: scenario.employeePoolIds?.length ?? data.employees.length,
    matched: result.stats.matched,
    unmatched: result.stats.unmatched,
    ruleErrors,
    over90,
    over60,
    avgCommute: result.stats.avgCommute,
    ok,
    unmatchedList: result.unmatchedCompanies.map((u) => `${u.companyName}: ${u.reason}`),
  };
}

async function main() {
  loadEnvFile();
  useDiskTransitOnly();
  const legCache = preloadTransitLegCache(DATA_DIR);
  const data = buildIntegratedData(DATA_DIR);

  const backIds = data.customers
    .filter((c) => c.customerType === CustomerType.FOLLOW_UP && data.fullMatchCustomerIds.includes(c.id))
    .map((c) => c.id);
  const frontIds = data.customers
    .filter((c) => c.customerType === CustomerType.FIRST_VISIT && data.fullMatchCustomerIds.includes(c.id))
    .map((c) => c.id);
  const projectIds = data.customers
    .filter((c) => c.customerType === CustomerType.PROJECT && data.fullMatchCustomerIds.includes(c.id))
    .map((c) => c.id);
  const jinshanBackIds = data.customers
    .filter(
      (c) =>
        c.parkName === JINSHAN_PARK &&
        c.customerType === CustomerType.FOLLOW_UP &&
        data.fullMatchCustomerIds.includes(c.id)
    )
    .map((c) => c.id);
  const baoshanBackIds = data.customers
    .filter(
      (c) =>
        c.parkName === BAOSHAN_PARK &&
        c.customerType === CustomerType.FOLLOW_UP &&
        data.fullMatchCustomerIds.includes(c.id)
    )
    .map((c) => c.id);

  const backPool = data.employees.filter((e) => e.roles.includes(EmployeeRole.BACK)).map((e) => e.id);
  const frontPool = data.employees.filter((e) => e.roles.includes(EmployeeRole.FRONT)).map((e) => e.id);
  const projectPool = data.employees
    .filter((e) => e.roles.includes(EmployeeRole.PROJECT))
    .map((e) => e.id);

  const afternoon2Ids = data.customers
    .filter((c) => c.timeSlot === TimeSlot.AFTERNOON_2 && data.fullMatchCustomerIds.includes(c.id))
    .map((c) => c.id);
  const multiPick = [
    ...data.customers.filter((c) => c.timeSlot === TimeSlot.MORNING).slice(0, 5),
    ...data.customers.filter((c) => c.timeSlot === TimeSlot.AFTERNOON_1).slice(0, 5),
    ...data.customers.filter((c) => c.timeSlot === TimeSlot.AFTERNOON_2).slice(0, 4),
  ].map((c) => c.id);

  const scenarios: Scenario[] = [
    {
      id: 'back-all-manual-pool',
      name: '后道 · 全部回访 + 后道员工池',
      mode: 'manual',
      customerIds: backIds,
      employeePoolIds: backPool,
    },
    {
      id: 'back-all-ai',
      name: '后道 · 全部回访 + AI全员',
      mode: 'ai',
      customerIds: backIds,
    },
    {
      id: 'back-jinshan-manual15',
      name: '后道 · 金山32家 + 手动15人池',
      mode: 'manual',
      customerIds: jinshanBackIds,
      employeePoolIds: MANUAL_JINSHAN_BACK_POOL,
      allowOver90: true,
    },
    {
      id: 'back-baoshan-manual-pool',
      name: '后道 · 宝山回访 + 后道池',
      mode: 'manual',
      customerIds: baoshanBackIds,
      employeePoolIds: backPool,
    },
    {
      id: 'front-all-manual-pool',
      name: '前道 · 全部首访 + 前道员工池',
      mode: 'manual',
      customerIds: frontIds,
      employeePoolIds: frontPool,
    },
    {
      id: 'front-all-ai',
      name: '前道 · 全部首访 + AI全员',
      mode: 'ai',
      customerIds: frontIds,
    },
    {
      id: 'project-all-manual-pool',
      name: '项目 · 全部 + 项目员工池',
      mode: 'manual',
      customerIds: projectIds,
      employeePoolIds: projectPool,
    },
    {
      id: 'project-all-ai',
      name: '项目 · 全部 + AI全员',
      mode: 'ai',
      customerIds: projectIds,
    },
    {
      id: 'afternoon2-all-ai',
      name: '多选 · 下午2全部14家',
      mode: 'ai',
      customerIds: afternoon2Ids,
    },
    {
      id: 'multi-slot-mix-manual',
      name: '多选 · 三时段混合14家 + 全员',
      mode: 'ai',
      customerIds: multiPick,
    },
    {
      id: 'full-55-ai',
      name: '全量55 · AI匹配(transit)',
      mode: 'ai',
      customerIds: data.fullMatchCustomerIds,
    },
  ];

  console.log('\n=== 多维度匹配校验 (transit + 通勤最短) ===\n');
  console.log(
    `数据: ${data.customers.length} 客户 · ${data.employees.length} 员工 · 后道${backIds.length} · 前道${frontIds.length} · 项目${projectIds.length}\n`
  );

  const results = [];
  const failed: string[] = [];

  for (const s of scenarios) {
    const r = await runScenario(data, s, legCache);
    results.push(r);
    const flag = r.ok ? '✓' : '✗';
    const overNote = r.over90 && s.allowOver90 ? '(限池可接受)' : '';
    console.log(
      `${flag} [${r.mode === 'manual' ? '手动池' : 'AI'}] ${r.name}: ${r.matched}/${r.selected} 池${r.poolSize} 未匹配${r.unmatched} 规则错${r.ruleErrors} >90:${r.over90}${overNote} 均${r.avgCommute}分`
    );
    if (!r.ok) {
      failed.push(r.name);
      r.unmatchedList.forEach((u) => console.log(`     ${u}`));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    allPassed: failed.length === 0,
    failed,
    results,
  };
  const outPath = path.join(DATA_DIR, 'public/cache/dimension-validate-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n报告: public/cache/dimension-validate-report.json`);

  if (failed.length) {
    console.log(`\n✗ ${failed.length} 个场景未通过: ${failed.join(' · ')}`);
    process.exit(1);
  }
  console.log('\n✓ 全部维度场景通过（后道/前道/项目 · 手动池/AI · 多选子集）');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
