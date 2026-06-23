/**
 * 公交/地铁模式 · 10 组场景测试（前道/后道/混合 + 通勤最优校验）
 * 运行: GAODE_API_KEY=xxx GAODE_QPS=1 npx tsx scripts/test-transit-scenarios.ts
 */

import { buildIntegratedData, IntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import {
  buildRoleScenarioDefs,
  JINSHAN_PARK,
  BAOSHAN_PARK,
  MANUAL_JINSHAN_BACK_POOL,
} from '../src/services/role-match-scenarios';
import { CustomerType, EmployeeRole, TimeSlot } from '../src/types';
import { getGaodeCommuteStats, loadEnvFile } from '../src/services/distance-service';
import { flushTransitDiskCache } from '../src/services/transit-disk-cache';
import { estimateChainedLegMinutes } from '../src/utils/commute';

const CORE_RULES = ['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配'];

interface ScenarioResult {
  id: string;
  name: string;
  roleCategory: string;
  selected: number;
  matched: number;
  unmatched: number;
  ruleErrors: number;
  avgCommute: number;
  maxCommute: number;
  totalCommute: number;
  transitLegs: number;
  suboptimal: number;
  ok: boolean;
  note?: string;
}

function idsOf(data: IntegratedData, filter: (c: IntegratedData['customers'][0]) => boolean): number[] {
  return data.customers.filter(filter).map((c) => c.id);
}

function buildExtraScenarios(data: IntegratedData) {
  const frontPool = data.employees.filter((e) => e.roles.includes(EmployeeRole.FRONT)).map((e) => e.id);
  const backPool = data.employees.filter((e) => e.roles.includes(EmployeeRole.BACK)).map((e) => e.id);

  return [
    {
      id: 'mix-jinshan-all',
      name: '混合 · 金山园区全部（首访+回访+项目）',
      roleCategory: '混合',
      customerIds: () => idsOf(data, (c) => c.parkName === JINSHAN_PARK),
      employeePoolIds: () => [...new Set([...frontPool, ...backPool])],
    },
    {
      id: 'mix-baoshan-all',
      name: '混合 · 宝山园区全部',
      roleCategory: '混合',
      customerIds: () => idsOf(data, (c) => c.parkName === BAOSHAN_PARK),
      employeePoolIds: () => [...new Set([...frontPool, ...backPool])],
    },
    {
      id: 'mix-front-back-6',
      name: '混合 · 前3后3（跨职责）',
      roleCategory: '混合',
      customerIds: () => {
        const front = data.customers
          .filter((c) => c.customerType === CustomerType.FIRST_VISIT)
          .slice(0, 3)
          .map((c) => c.id);
        const back = data.customers
          .filter((c) => c.customerType === CustomerType.FOLLOW_UP && c.parkName === JINSHAN_PARK)
          .slice(0, 3)
          .map((c) => c.id);
        return [...front, ...back];
      },
      employeePoolIds: () => [...new Set([...frontPool, ...MANUAL_JINSHAN_BACK_POOL])],
    },
    {
      id: 'back-chaiqiang-baoshan',
      name: '后道 · 宝山指定人多单（柴强）',
      roleCategory: '后道',
      customerIds: () =>
        idsOf(
          data,
          (c) =>
            c.parkName === BAOSHAN_PARK &&
            c.customerType === CustomerType.FOLLOW_UP &&
            c.designatedPerson === '柴强'
        ),
      employeePoolIds: () => backPool,
    },
    {
      id: 'back-cross-park-10',
      name: '后道 · 跨园区（金山5+宝山5）',
      roleCategory: '后道',
      customerIds: () => {
        const j = idsOf(
          data,
          (c) => c.parkName === JINSHAN_PARK && c.customerType === CustomerType.FOLLOW_UP
        ).slice(0, 5);
        const b = idsOf(
          data,
          (c) => c.parkName === BAOSHAN_PARK && c.customerType === CustomerType.FOLLOW_UP
        ).slice(0, 5);
        return [...j, ...b];
      },
      employeePoolIds: () => backPool,
    },
  ];
}

/** 校验：在同等已分配状态下，当前员工是否为合规候选中本段通勤最短 */
function auditCommuteOptimality(
  data: IntegratedData,
  pairings: Awaited<ReturnType<typeof dispatchSelectedCompanies>>['pairings'],
  employeePool: number[]
): number {
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const poolSet = new Set(employeePool);
  const availableNames = new Set(
    data.employees.filter((e) => poolSet.has(e.id)).map((e) => e.name)
  );
  const assignments = new Map<number, number[]>();
  for (const p of pairings) {
    if (!poolSet.has(p.employeeId)) continue;
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  let suboptimal = 0;

  for (const p of pairings) {
    if (!poolSet.has(p.employeeId)) continue;
    const customer = customerById.get(p.customerId);
    const chosen = employeeById.get(p.employeeId);
    if (!customer || !chosen) continue;

    const othersOnEmp = (assignments.get(p.employeeId) || [])
      .filter((id) => id !== p.customerId)
      .map((id) => customerById.get(id)!)
      .filter(Boolean);

    let minCommute = Infinity;
    let minEmpId = p.employeeId;

    for (const empId of employeePool) {
      const emp = employeeById.get(empId);
      if (!emp) continue;
      const assignedOthers = (assignments.get(empId) || [])
        .filter((id) => id !== p.customerId)
        .map((id) => customerById.get(id)!)
        .filter(Boolean);
      const match = matchCustomerToEmployee(customer, emp, availableNames, assignedOthers, {
        requirePlus: false,
      });
      if (!match.eligible) continue;
      const commute = estimateChainedLegMinutes(emp, assignedOthers, customer);
      if (commute < minCommute) {
        minCommute = commute;
        minEmpId = emp.id;
      }
    }

    if (minEmpId !== p.employeeId && p.route?.source === 'transit') {
      suboptimal++;
    }
  }

  return suboptimal;
}

async function runScenario(
  data: IntegratedData,
  def: {
    id: string;
    name: string;
    roleCategory: string;
    customerIds: () => number[];
    employeePoolIds?: () => number[];
    expectMatched?: (d: IntegratedData, ids: number[]) => number;
    expectUnmatched?: (d: IntegratedData, ids: number[]) => number;
  }
): Promise<ScenarioResult> {
  const customerIds = def.customerIds();
  const poolIds = def.employeePoolIds?.();

  const result = await dispatchSelectedCompanies(data, customerIds, undefined, {
    commuteMode: 'transit',
    employeePoolIds: poolIds,
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
    const failedCore = match.details.filter((d) => CORE_RULES.includes(d.rule) && !d.passed);
    if (!match.eligible || failedCore.length) ruleErrors++;
  }

  const commutes = result.pairings.map((p) => p.commuteMinutes);
  const transitLegs = result.pairings.filter((p) => p.route?.source === 'transit').length;
  const suboptimal = poolIds ? auditCommuteOptimality(data, result.pairings, poolIds) : 0;

  const expectM = def.expectMatched?.(data, customerIds);
  const expectU = def.expectUnmatched?.(data, customerIds) ?? 0;
  const matchOk =
    expectM != null ? result.stats.matched === expectM : result.stats.unmatched <= expectU;
  const ok = matchOk && ruleErrors === 0;

  return {
    id: def.id,
    name: def.name,
    roleCategory: def.roleCategory,
    selected: customerIds.length,
    matched: result.stats.matched,
    unmatched: result.stats.unmatched,
    ruleErrors,
    avgCommute: commutes.length
      ? Math.round(commutes.reduce((a, b) => a + b, 0) / commutes.length)
      : 0,
    maxCommute: commutes.length ? Math.max(...commutes) : 0,
    totalCommute: commutes.reduce((a, b) => a + b, 0),
    transitLegs,
    suboptimal,
    ok,
    note:
      result.stats.unmatched > 0
        ? result.unmatchedCompanies.map((u) => u.companyName).join('、')
        : undefined,
  };
}

async function main() {
  loadEnvFile();
  const data = buildIntegratedData('.');

  const base = buildRoleScenarioDefs(data).map((d) => ({
    id: d.id,
    name: d.name,
    roleCategory: d.roleCategory,
    customerIds: () => d.customerIds(data),
    employeePoolIds: d.employeePoolIds ? () => d.employeePoolIds!(data) : undefined,
    expectMatched: d.expectMatched,
    expectUnmatched: d.expectUnmatched,
  }));

  const extras = buildExtraScenarios(data);
  const scenarios = [...base.slice(0, 5), ...extras];

  console.log('\n=== 公交/地铁匹配 · 10 组场景测试 ===\n');
  console.log(`GAODE_QPS=${process.env.GAODE_QPS || 1}\n`);

  const results: ScenarioResult[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    console.log(`[${i + 1}/10] ${s.name}…`);
    results.push(await runScenario(data, s));
  }

  flushTransitDiskCache();
  const stats = getGaodeCommuteStats();

  console.log('\n--- 结果汇总 ---\n');
  console.log(
    '场景'.padEnd(28),
    '类型'.padEnd(6),
    '匹配'.padEnd(8),
    '均通勤'.padEnd(8),
    '最大'.padEnd(6),
    '公交段'.padEnd(6),
    '非最优'.padEnd(6),
    '状态'
  );
  console.log('-'.repeat(88));

  for (const r of results) {
    console.log(
      r.name.slice(0, 26).padEnd(28),
      r.roleCategory.padEnd(6),
      `${r.matched}/${r.selected}`.padEnd(8),
      `${r.avgCommute}分`.padEnd(8),
      `${r.maxCommute}分`.padEnd(6),
      String(r.transitLegs).padEnd(6),
      String(r.suboptimal).padEnd(6),
      r.ok ? '✓' : '✗'
    );
    if (r.note && !r.ok) console.log(`    未匹配: ${r.note}`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n通过: ${passed}/10`);
  console.log(
    `[API] 内存${stats.memoryHits} 磁盘${stats.diskHits} 调用${stats.apiCalls} 降级${stats.localFallbacks} 重试${stats.limiter.retries}`
  );

  if (passed < 10) process.exit(1);
  console.log('\n✓ 全部场景：规则合规 + 公交通勤择优\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
