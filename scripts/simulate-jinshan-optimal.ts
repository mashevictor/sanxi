/**
 * 最优 15 人池：金山园区 + 后道 + 32 客户
 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { CustomerType, TimeSlot, EmployeeRole } from '../src/types';

const data = buildIntegratedData('.');
const park = '加盟-金山资本现代产业园';
const customers = data.customers.filter(
  (c) => c.parkName === park && c.customerType === CustomerType.FOLLOW_UP
);
const back = data.employees.filter((e) => e.roles.includes(EmployeeRole.BACK));

const scored = back
  .map((e) => {
    const jinshan = e.departureAddress.includes('金山') ? 10 : 0;
    const caps = e.orderCapacity.length;
    return {
      e,
      score: jinshan + caps * 3 + (e.orderCapacity.includes(TimeSlot.AFTERNOON_2) ? 2 : 0),
    };
  })
  .sort((a, b) => b.score - a.score);

const poolIds = scored.slice(0, 15).map((x) => x.e.id);
let morning = 0;
let afternoon1 = 0;
let afternoon2 = 0;
for (const id of poolIds) {
  const e = data.employees.find((x) => x.id === id)!;
  if (e.orderCapacity.includes(TimeSlot.MORNING)) morning++;
  if (e.orderCapacity.includes(TimeSlot.AFTERNOON_1)) afternoon1++;
  if (e.orderCapacity.includes(TimeSlot.AFTERNOON_2)) afternoon2++;
}
console.log('最优15人池容量:', { morning, afternoon1, afternoon2, total: morning + afternoon1 + afternoon2 });
console.log(
  '选中员工:',
  poolIds.map((id) => data.employees.find((e) => e.id === id)!.name).join(', ')
);

async function main() {
  const result = await dispatchSelectedCompanies(
    data,
    customers.map((c) => c.id),
    undefined,
    { employeePoolIds: poolIds, commuteMode: 'local' }
  );
  console.log('匹配:', result.stats.matched, '/', result.stats.selected);
  console.log('未匹配:', result.stats.unmatched);
  if (result.unmatchedCompanies.length) {
    const reasons: Record<string, number> = {};
    for (const u of result.unmatchedCompanies) {
      const r = u.reason || 'unknown';
      reasons[r] = (reasons[r] || 0) + 1;
    }
    console.log('失败原因分布:', reasons);
    for (const u of result.unmatchedCompanies.slice(0, 5)) {
      console.log(' ', u.companyName, u.timeSlot, u.reason);
    }
  }
}

main().catch(console.error);

/** 全时段优先池：9 名三档 + 补足上午 */
async function runFullCapacityPool() {
  const full = back.filter((e) => e.orderCapacity.length === 3);
  const morningExtra = back.filter(
    (e) => e.orderCapacity.includes(TimeSlot.MORNING) && e.orderCapacity.length === 2 && !full.includes(e)
  );
  const ids = [...full.map((e) => e.id), ...morningExtra.map((e) => e.id)].slice(0, 15);
  let morning = 0;
  let afternoon1 = 0;
  let afternoon2 = 0;
  for (const id of ids) {
    const e = data.employees.find((x) => x.id === id)!;
    if (e.orderCapacity.includes(TimeSlot.MORNING)) morning++;
    if (e.orderCapacity.includes(TimeSlot.AFTERNOON_1)) afternoon1++;
    if (e.orderCapacity.includes(TimeSlot.AFTERNOON_2)) afternoon2++;
  }
  console.log('\n--- 全时段优先 15 人池 ---');
  console.log('容量:', { morning, afternoon1, afternoon2 });
  const result = await dispatchSelectedCompanies(data, customers.map((c) => c.id), undefined, {
    employeePoolIds: ids,
    commuteMode: 'local',
  });
  console.log('匹配:', result.stats.matched, '/', result.stats.selected);
}

runFullCapacityPool().catch(console.error);
