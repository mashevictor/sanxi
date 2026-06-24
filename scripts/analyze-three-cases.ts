/** 分析筱胜/智彩/益充 的合规候选与通勤 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';
import { loadEnvFile } from '../src/services/distance-service';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { getCommuteOriginForNextStop } from '../src/utils/commute';
import { legCacheKey } from '../src/services/distance-service';
import { getTransitFromDisk } from '../src/services/transit-disk-cache';
import { estimateCommuteMinutes } from '../src/utils/commute';

const TARGETS = ['上海筱胜企业管理咨询有限公司', '上海智彩电子科技有限公司', '上海益充电子商务有限公司'];

function legMin(from: string, to: string, cache: ReturnType<typeof preloadTransitLegCache>): number {
  const hit = cache.get(legCacheKey(from, to)) || getTransitFromDisk(legCacheKey(from, to));
  return hit?.minutes ?? estimateCommuteMinutes(from, to);
}

async function main() {
  loadEnvFile();
  useDiskTransitOnly();
  const cache = preloadTransitLegCache('.');
  const data = buildIntegratedData('.');
  const result = await dispatchSelectedCompanies(data, data.fullMatchCustomerIds, undefined, {
    commuteMode: 'transit',
    preferShortestCommute: true,
    legCache: cache,
    transitWarmMaxFetches: 0,
  });

  const assignments = new Map<number, number[]>();
  for (const p of result.pairings) {
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  for (const name of TARGETS) {
    const customer = data.customers.find((c) => c.companyName === name)!;
    const pairing = result.pairings.find((p) => p.customerId === customer.id)!;
    console.log(`\n【${name}】${pairing.timeSlot} → ${pairing.employeeName} ${pairing.commuteMinutes}分`);
    console.log(`  地址: ${customer.address}`);
    if (customer.rejectedPerson) console.log(`  放弃人: ${customer.rejectedPerson}`);

    const alts: { name: string; min: number; from: string }[] = [];
    for (const emp of data.employees) {
      const others = (assignments.get(emp.id) || []).filter((id) => id !== customer.id);
      const assigned = others.map((id) => data.customers.find((c) => c.id === id)!).filter(Boolean);
      const m = matchCustomerToEmployee(customer, emp, new Set(data.employees.map((e) => e.name)), assigned, {
        requirePlus: false,
      });
      if (!m.eligible) continue;
      const from = getCommuteOriginForNextStop(emp, assigned, customer);
      alts.push({ name: emp.name, min: legMin(from, customer.address, cache), from });
    }
    alts.sort((a, b) => a.min - b.min);
    console.log(`  合规候选 TOP8: ${alts.slice(0, 8).map((a) => `${a.name}(${a.min}分)`).join(' · ')}`);
    const under60 = alts.filter((a) => a.min <= 60);
    const under90 = alts.filter((a) => a.min <= 90);
    console.log(`  ≤60分: ${under60.length}人  ≤90分: ${under90.length}人`);
  }
}

main().catch(console.error);
