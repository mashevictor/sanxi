/** 诊断筱胜下午捆绑与益充补位-浦东后 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { buildAfternoonParkPairs } from '../src/services/afternoon-park-pairs';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import { preloadTransitLegCache, useDiskTransitOnly } from './transit-leg-cache';
import { loadEnvFile } from '../src/services/distance-service';
import { legCacheKey } from '../src/services/distance-service';
import { getTransitFromDisk } from '../src/services/transit-disk-cache';
import { estimateCommuteMinutes } from '../src/utils/commute';

function legMin(from: string, to: string, cache: ReturnType<typeof preloadTransitLegCache>) {
  return cache.get(legCacheKey(from, to))?.minutes ?? getTransitFromDisk(legCacheKey(from, to))?.minutes ?? estimateCommuteMinutes(from, to);
}

loadEnvFile();
useDiskTransitOnly();
const cache = preloadTransitLegCache('.');
const data = buildIntegratedData('.');

const xiaosheng = data.customers.find((c) => c.companyName.includes('筱胜'))!;
const yichong = data.customers.find((c) => c.companyName.includes('益充'))!;
const { pairs } = buildAfternoonParkPairs(data.customers.filter((c) => data.fullMatchCustomerIds.includes(c.id)));
const pair = pairs.find((p) => p.afternoon1.id === xiaosheng.id || p.afternoon2.id === xiaosheng.id);
console.log('筱胜捆绑:', pair ? `${pair.afternoon1.companyName} + ${pair.afternoon2.companyName}` : '无');

if (pair) {
  const names = ['演示-顾宝山', '补位-徐汇后', '盛雅琴', '舒立旻'];
  for (const name of names) {
    const emp = data.employees.find((e) => e.name === name)!;
    const m1 = matchCustomerToEmployee(pair.afternoon1, emp, new Set(data.employees.map((e) => e.name)), [], { requirePlus: false });
    const m2 = matchCustomerToEmployee(pair.afternoon2, emp, new Set(data.employees.map((e) => e.name)), [pair.afternoon1], { requirePlus: false });
    if (!m1.eligible || !m2.eligible) {
      console.log(`  ${name}: 不合规`);
      continue;
    }
    const c1from = emp.departureAddress;
    const c1 = legMin(c1from, pair.afternoon1.address, cache);
    const c2 = legMin(pair.afternoon1.address, pair.afternoon2.address, cache);
    console.log(`  ${name}: 段1=${c1} 段2=${c2} max=${Math.max(c1, c2)}`);
  }
}

const pudong = data.employees.find((e) => e.name === '补位-浦东后');
console.log('\n益充 + 补位-浦东后:', pudong?.departureAddress);
if (pudong) {
  const m = matchCustomerToEmployee(yichong, pudong, new Set(data.employees.map((e) => e.name)), [], { requirePlus: false });
  console.log('  eligible:', m.eligible, m.details.filter((d) => !d.passed).map((d) => d.rule));
  const mins = legMin(pudong.departureAddress, yichong.address, cache);
  console.log('  通勤(本地/缓存):', mins);
}
