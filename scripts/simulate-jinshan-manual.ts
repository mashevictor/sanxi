/**
 * 模拟：金山园区 + 后道 + 15员工池 + 32客户 手动派单场景
 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { CustomerType, TimeSlot, EmployeeRole, TIME_SLOT_LABELS } from '../src/types';

const root = '.';
const data = buildIntegratedData(root);

const jinshanPark = '加盟-金山资本现代产业园';

const jinshanFollowUp = data.customers.filter(
  (c) => c.parkName === jinshanPark && c.customerType === CustomerType.FOLLOW_UP
);

const backEmployees = data.employees.filter((e) => e.roles.includes(EmployeeRole.BACK));

console.log('金山回访客户总数:', jinshanFollowUp.length);
const bySlot = { MORNING: 0, AFTERNOON_1: 0, AFTERNOON_2: 0 };
for (const c of jinshanFollowUp) bySlot[c.timeSlot]++;
console.log('时段分布:', bySlot);

// 模拟用户选 15 名后道员工（优先金山出发地 + 有下午双档）
const jinshanBack = backEmployees.filter((e) => e.departureAddress.includes('金山'));
const withAfternoon2 = backEmployees.filter((e) => e.orderCapacity.includes(TimeSlot.AFTERNOON_2));
console.log('后道员工总数:', backEmployees.length, '金山出发:', jinshanBack.length, '含下午2:', withAfternoon2.length);

// 取 15 人：金山后道优先，补足全时段
const poolIds = new Set<number>();
for (const e of jinshanBack) {
  if (poolIds.size >= 15) break;
  poolIds.add(e.id);
}
for (const e of backEmployees) {
  if (poolIds.size >= 15) break;
  if (!poolIds.has(e.id)) poolIds.add(e.id);
}
const pool = data.employees.filter((e) => poolIds.has(e.id));

let morningCap = 0;
let afternoon1Cap = 0;
let afternoon2Cap = 0;
for (const e of pool) {
  if (e.orderCapacity.includes(TimeSlot.MORNING)) morningCap++;
  if (e.orderCapacity.includes(TimeSlot.AFTERNOON_1)) afternoon1Cap++;
  if (e.orderCapacity.includes(TimeSlot.AFTERNOON_2)) afternoon2Cap++;
}
console.log('\n15人池容量: 上午', morningCap, '下午1', afternoon1Cap, '下午2', afternoon2Cap);
console.log('总容量槽位:', morningCap + afternoon1Cap + afternoon2Cap);

// 用全部金山回访客户测试（若不足32则用全部）
const customerIds = jinshanFollowUp.map((c) => c.id);
console.log('\n测试客户数:', customerIds.length);

async function main() {
  const result = await dispatchSelectedCompanies(data, customerIds, undefined, {
    employeePoolIds: Array.from(poolIds),
    commuteMode: 'local',
  });

  console.log('匹配结果:', result.stats.matched, '/', result.stats.selected);
  console.log('未匹配:', result.stats.unmatched);
  console.log('消息:', result.message);

  const schedMap = new Map(result.employeeSchedules.map((s) => [s.employeeId, s]));
  const multi = result.employeeSchedules.filter((s) => s.totalOrders >= 2);
  console.log('\n多单员工:', multi.length);
  for (const s of multi.sort((a, b) => b.totalOrders - a.totalOrders).slice(0, 8)) {
    console.log(
      `  ${s.employeeName}: ${s.totalOrders}单 (上午${s.morningOrders} 下午${s.afternoonOrders})`,
      s.orders.map((o) => o.timeSlot).join('+')
    );
  }

  if (result.unmatchedCompanies.length) {
    console.log('\n未匹配样例:');
    for (const u of result.unmatchedCompanies.slice(0, 5)) {
      console.log(' ', u.companyName, u.timeSlot, u.reason);
    }
  }

  // 验证：已有下午2单的员工再匹配下午1是否冲突
  const empWith2Afternoon = result.employeeSchedules.find(
    (s) => s.orders.filter((o) => o.timeSlot !== '上午').length >= 2
  );
  if (empWith2Afternoon) {
    console.log('\n下午双档员工示例:', empWith2Afternoon.employeeName, empWith2Afternoon.orders.map((o) => o.timeSlot));
  }
}

main().catch(console.error);
