/**
 * 演示：金山园区后道下午捆绑效果
 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { buildAfternoonParkPairs } from '../src/services/afternoon-park-pairs';
import { CustomerType, TimeSlot, TIME_SLOT_LABELS } from '../src/types';

const park = '加盟-金山资本现代产业园';
const POOL = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22];

async function main() {
  const data = buildIntegratedData('.');
  const customers = data.customers.filter(
    (c) => c.parkName === park && c.customerType === CustomerType.FOLLOW_UP
  );

  const { pairs, unpairedAfternoon } = buildAfternoonParkPairs(customers);
  console.log('\n=== 第一步：同园区下午捆绑对（', pairs.length, '对）===');
  for (const p of pairs) {
    const d1 = p.afternoon1.designatedPerson?.trim() || '无';
    const d2 = p.afternoon2.designatedPerson?.trim() || '无';
    console.log('  下午1:', p.afternoon1.companyName, '| 指定:', d1);
    console.log('  下午2:', p.afternoon2.companyName, '| 指定:', d2);
    console.log('  ---');
  }
  if (unpairedAfternoon.length) {
    console.log('未凑成对的下午单（', unpairedAfternoon.length, '家）:');
    for (const c of unpairedAfternoon) {
      console.log(' ', TIME_SLOT_LABELS[c.timeSlot], c.companyName);
    }
  }

  const result = await dispatchSelectedCompanies(
    data,
    customers.map((c) => c.id),
    undefined,
    { employeePoolIds: POOL, commuteMode: 'local' }
  );

  console.log('\n=== 第二步：实际派单（下午部分）===');
  console.log('匹配:', result.stats.matched, '/', result.stats.selected);

  const byEmp = new Map<string, { timeSlot: TimeSlot; companyName: string }[]>();
  for (const s of result.employeeSchedules) {
    const afternoon = s.orders.filter(
      (o) => o.timeSlot === TimeSlot.AFTERNOON_1 || o.timeSlot === TimeSlot.AFTERNOON_2
    );
    if (afternoon.length) byEmp.set(s.employeeName, afternoon);
  }

  for (const [emp, orders] of [...byEmp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const slots = orders
      .map((o) => `${TIME_SLOT_LABELS[o.timeSlot]}:${o.companyName}`)
      .join('  +  ');
    const tag = orders.length === 2 ? '[下午捆绑]' : '[单独下午单]';
    console.log(`${emp} ${tag}`);
    console.log(`   ${slots}`);
  }

  console.log('\n=== 第三步：典型员工全天行程（上午+下午捆绑）===');
  const triple = result.employeeSchedules.filter((s) => s.totalOrders === 3).slice(0, 2);
  for (const s of triple) {
    console.log(`\n${s.employeeName}（${s.totalOrders}单）:`);
    for (const o of s.orders) {
      console.log(`  ${TIME_SLOT_LABELS[o.timeSlot]} → ${o.companyName}`);
    }
  }
}

main().catch(console.error);
