/**
 * 批量测试手动派单场景（本地或生产）
 * 运行: npx tsx scripts/batch-manual-match-test.ts [baseUrl]
 */

import { buildIntegratedData } from '../src/data/integrated-data';
import { buildManualPoolPresetMetas } from '../src/services/manual-pool-presets';
import { buildManualPoolIds } from '../src/services/manual-pool-cache';
import { MANUAL_JINSHAN_BACK_POOL } from '../src/services/role-match-scenarios';
import { CustomerType } from '../src/types';

const BASE = process.argv[2] || 'http://101.32.209.251';
const ROOT = process.cwd();

type Scenario = { name: string; customerIds: number[]; employeePoolIds: number[] | null };

function buildScenarios(): Scenario[] {
  const data = buildIntegratedData(ROOT);
  const back = buildManualPoolIds(data, 'back');
  const jinshan = data.customers
    .filter(
      (c) =>
        c.parkName === '加盟-金山资本现代产业园' &&
        c.customerType === CustomerType.FOLLOW_UP
    )
    .map((c) => c.id);

  const basePool = MANUAL_JINSHAN_BACK_POOL.filter((id) =>
    data.employees.some((e) => e.id === id)
  );
  const swap1 = [...basePool];
  swap1[0] = back.employeePoolIds.find((id) => !basePool.includes(id)) ?? swap1[0];
  const swap2 = [...basePool];
  const extras = back.employeePoolIds.filter((id) => !basePool.includes(id));
  if (extras.length >= 2) {
    swap2[0] = extras[0];
    swap2[1] = extras[1];
  }

  const presets = buildManualPoolPresetMetas(data).map((p) => ({
    name: `预设:${p.label}`,
    customerIds: p.customerIds,
    employeePoolIds: p.employeePoolIds,
  }));

  return [
    { name: '后道全量41+48', customerIds: back.customerIds, employeePoolIds: back.employeePoolIds },
    {
      name: '后道全量41+15人',
      customerIds: back.customerIds,
      employeePoolIds: basePool,
    },
    {
      name: '金山32+15人(截图池)',
      customerIds: jinshan,
      employeePoolIds: basePool,
    },
    {
      name: '金山32+换1员工',
      customerIds: jinshan,
      employeePoolIds: swap1,
    },
    {
      name: '金山32+换2员工',
      customerIds: jinshan,
      employeePoolIds: swap2,
    },
    {
      name: '金山32无员工池',
      customerIds: jinshan,
      employeePoolIds: null,
    },
    {
      name: '前10公司+前10员工',
      customerIds: back.customerIds.slice(0, 10),
      employeePoolIds: back.employeePoolIds.slice(0, 10),
    },
    {
      name: '前20+前15',
      customerIds: back.customerIds.slice(0, 20),
      employeePoolIds: back.employeePoolIds.slice(0, 15),
    },
    ...presets,
  ];
}

async function main() {
  console.log(`\n=== 手动派单批量测试 ${BASE} ===\n`);
  const boot = await fetch(`${BASE}/api/bootstrap`).then((r) => r.json());
  const sessionId = boot.sessionId as string;
  const scenarios = buildScenarios();
  const results: { name: string; ms: number; matched: string; note: string; ok: boolean }[] = [];

  for (const s of scenarios) {
    const body: Record<string, unknown> = {
      sessionId,
      customerIds: s.customerIds,
      commuteMode: 'transit',
    };
    if (s.employeePoolIds?.length) body.employeePoolIds = s.employeePoolIds;
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/api/dispatch/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json();
      const ms = Date.now() - t0;
      const matched = `${data.stats?.matched ?? '?'}/${data.stats?.selected ?? s.customerIds.length}`;
      const note = String(data.message || '').slice(0, 48);
      const ok = res.ok && ms < 15000;
      results.push({ name: s.name, ms, matched, note, ok });
      console.log(`${ok ? '✓' : '⚠'} ${s.name} ${ms}ms ${matched} — ${note}`);
    } catch (e) {
      const ms = Date.now() - t0;
      results.push({
        name: s.name,
        ms,
        matched: 'ERR',
        note: e instanceof Error ? e.message : String(e),
        ok: false,
      });
      console.log(`✗ ${s.name} ${ms}ms — ${e instanceof Error ? e.message : e}`);
    }
  }

  const slow = results.filter((r) => r.ms > 10000);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项 · 慢(>10s) ${slow.length} · 未达标 ${failed.length}\n`);
  process.exit(failed.length ? 1 : 0);
}

main();
