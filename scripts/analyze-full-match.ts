import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { CUSTOMER_TYPE_LABELS, TIME_SLOT_LABELS, TimeSlot } from '../src/types';

const data = buildIntegratedData('.');

const slotCount: Record<string, number> = {};
for (const c of data.customers) {
  const k = TIME_SLOT_LABELS[c.timeSlot];
  slotCount[k] = (slotCount[k] || 0) + 1;
}
console.log('时段分布', slotCount);

const des = data.customers.filter((c) => c.designatedPerson);
console.log('\n指定人', des.length);
des.forEach((c) => {
  const emp = data.employees.find((e) => e.name === c.designatedPerson);
  console.log(c.companyName, '->', c.designatedPerson, TIME_SLOT_LABELS[c.timeSlot], emp ? `员工容量${emp.orderCapacity.join(',')}` : '无员工');
});

const aft2 = data.customers.filter((c) => c.timeSlot === TimeSlot.AFTERNOON_2);
console.log('\n下午2共', aft2.length, '家');
const empAft2 = data.employees.filter((e) => e.orderCapacity.includes(TimeSlot.AFTERNOON_2));
console.log('有下午2容量员工', empAft2.length, empAft2.map((e) => e.name).join(','));

async function main() {
  const r = await dispatchSelectedCompanies(data, data.customers.map((c) => c.id));
  console.log('\n未匹配', r.unmatchedCompanies.length);
  for (const u of r.unmatchedCompanies) {
    console.log(u.companyName, '|', u.reason);
  }
}
main();
