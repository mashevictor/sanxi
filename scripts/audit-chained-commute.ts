/**
 * 审计一人多单：串联重算是否与派单结果一致，且任一段是否 >90
 */
import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';
import { loadEnvFile, legCacheKey } from '../src/services/distance-service';
import { getTransitFromDisk } from '../src/services/transit-disk-cache';
import {
  sortCustomersByVisitOrder,
  getCommuteOriginForNextStop,
  estimateCommuteMinutes,
  MAX_REALISTIC_COMMUTE_MINUTES,
} from '../src/utils/commute';
import { TIME_SLOT_LABELS } from '../src/types';

loadEnvFile();
useDiskTransitOnly();
const cache = preloadTransitLegCache('.');

function legMin(from: string, to: string): number {
  return (
    cache.get(legCacheKey(from, to))?.minutes ??
    getTransitFromDisk(legCacheKey(from, to))?.minutes ??
    estimateCommuteMinutes(from, to)
  );
}

async function main() {
  const data = buildIntegratedData('.');
  const result = await dispatchSelectedCompanies(data, data.fullMatchCustomerIds, undefined, {
    commuteMode: 'transit',
    preferShortestCommute: true,
    legCache: cache,
    transitWarmMaxFetches: 0,
  });

  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const byEmp = new Map<number, typeof result.pairings>();

  for (const p of result.pairings) {
    if (!byEmp.has(p.employeeId)) byEmp.set(p.employeeId, []);
    byEmp.get(p.employeeId)!.push(p);
  }

  let multiOrderEmps = 0;
  let legMismatch = 0;
  let routeOver90 = 0;
  const mismatchSamples: string[] = [];
  const over90Samples: string[] = [];

  for (const [empId, orders] of byEmp) {
    if (orders.length < 2) continue;
    multiOrderEmps++;
    const emp = employeeById.get(empId)!;
    const customers = sortCustomersByVisitOrder(
      orders.map((p) => customerById.get(p.customerId)!).filter(Boolean)
    );

    const assigned: typeof customers = [];
    for (const customer of customers) {
      const pairing = orders.find((p) => p.customerId === customer.id)!;
      const from = getCommuteOriginForNextStop(emp, assigned, customer);
      const expected = legMin(from, customer.address);
      if (Math.abs(expected - pairing.commuteMinutes) > 2) {
        legMismatch++;
        if (mismatchSamples.length < 5) {
          mismatchSamples.push(
            `${emp.name} ${customer.companyName.slice(0, 12)}: 报告${pairing.commuteMinutes} vs 重算${expected}`
          );
        }
      }
      if (pairing.commuteMinutes > MAX_REALISTIC_COMMUTE_MINUTES) {
        routeOver90++;
        if (over90Samples.length < 10) {
          over90Samples.push(
            `${emp.name} ${TIME_SLOT_LABELS[customer.timeSlot]} ${customer.companyName.slice(0, 16)} ${pairing.commuteMinutes}分`
          );
        }
      }
      assigned.push(customer);
    }
  }

  console.log('\n=== 一人多单串联通勤审计 ===\n');
  console.log(`多单员工: ${multiOrderEmps} 人`);
  console.log(`串联重算偏差>2分: ${legMismatch} 段`);
  console.log(`多单中 >90分 段: ${routeOver90} 段`);
  if (mismatchSamples.length) {
    console.log('\n偏差样例:');
    mismatchSamples.forEach((s) => console.log(' ', s));
  }
  if (over90Samples.length) {
    console.log('\n>90分样例:');
    over90Samples.forEach((s) => console.log(' ', s));
  }

  const out = {
    multiOrderEmps,
    legMismatch,
    routeOver90,
    ok: legMismatch === 0,
  };
  const outPath = path.join('.', 'public/cache/chained-commute-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n报告: ${outPath}`);
  console.log(legMismatch === 0 ? '\n✓ 串联重算与派单结果一致' : '\n✗ 存在串联重算偏差');
}

main().catch(console.error);
