/**
 * 用户截图中的 15 名后道员工 + 金山 32 家回访
 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { CustomerType, TimeSlot, EmployeeRole, TIME_SLOT_LABELS } from '../src/types';

/** 截图手动派单 15 人（id 7–20 共 14 人 + 常见第 15 人吴佳键） */
const USER_POOL_IDS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22];

const park = '加盟-金山资本现代产业园';
const data = buildIntegratedData('.');
const customers = data.customers.filter(
  (c) => c.parkName === park && c.customerType === CustomerType.FOLLOW_UP
);

const poolIds = USER_POOL_IDS.filter((id) => data.employees.some((e) => e.id === id));

const bySlot = { MORNING: 0, AFTERNOON_1: 0, AFTERNOON_2: 0 };
for (const c of customers) bySlot[c.timeSlot]++;

let morning = 0;
let afternoon1 = 0;
let afternoon2 = 0;
console.log('\n员工池（', poolIds.length, '人）:');
for (const id of poolIds) {
  const e = data.employees.find((x) => x.id === id)!;
  const caps = e.orderCapacity.map((s) => TIME_SLOT_LABELS[s]).join('、');
  console.log(`  ${e.name} | ${caps} | ${e.departureAddress}`);
  if (e.orderCapacity.includes(TimeSlot.MORNING)) morning++;
  if (e.orderCapacity.includes(TimeSlot.AFTERNOON_1)) afternoon1++;
  if (e.orderCapacity.includes(TimeSlot.AFTERNOON_2)) afternoon2++;
}

console.log('\n金山回访客户:', customers.length);
console.log('需求时段:', {
  上午: bySlot.MORNING,
  下午1: bySlot.AFTERNOON_1,
  下午2: bySlot.AFTERNOON_2,
});
console.log('员工池容量:', { 上午: morning, 下午1: afternoon1, 下午2: afternoon2 });

async function main() {
  const result = await dispatchSelectedCompanies(
    data,
    customers.map((c) => c.id),
    undefined,
    { employeePoolIds: poolIds, commuteMode: 'local' }
  );

  console.log('\n=== 匹配结果 ===');
  console.log(result.stats.matched, '/', result.stats.selected, '成功');
  console.log('未匹配:', result.stats.unmatched);
  console.log('消息:', result.message);

  if (result.unmatchedCompanies.length) {
    console.log('\n未匹配明细:');
    for (const u of result.unmatchedCompanies) {
      console.log(`  ${u.companyName} | ${u.reason}`);
    }
  }

  const multi = result.employeeSchedules.filter((s) => s.totalOrders >= 2);
  console.log('\n多单员工:', multi.length);
  for (const s of multi.sort((a, b) => b.totalOrders - a.totalOrders)) {
    console.log(
      `  ${s.employeeName}: ${s.totalOrders}单`,
      s.orders.map((o) => o.timeSlot).join('+')
    );
  }
}

main().catch(console.error);
