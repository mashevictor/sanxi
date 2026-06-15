/**
 * 扫描各种选集组合，找出未匹配或不合规场景
 */
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import { CUSTOMER_TYPE_LABELS, TIME_SLOT_LABELS, CustomerType } from '../src/types';

const CORE_RULES = ['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配'];

async function validateSelection(data: ReturnType<typeof buildIntegratedData>, ids: number[]) {
  const r = await dispatchSelectedCompanies(data, ids);
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));
  const assignments = new Map<number, number[]>();
  for (const p of r.pairings) {
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  let ruleErrors = 0;
  for (const p of r.pairings) {
    const customer = customerById.get(p.customerId)!;
    const employee = employeeById.get(p.employeeId)!;
    const assignedOthers = (assignments.get(p.employeeId) || [])
      .filter((id) => id !== p.customerId)
      .map((id) => customerById.get(id)!)
      .filter(Boolean);
    const match = matchCustomerToEmployee(customer, employee, availableNames, assignedOthers, {
      requirePlus: false,
    });
    if (!match.eligible) ruleErrors++;
  }

  return {
    selected: ids.length,
    matched: r.stats.matched,
    unmatched: r.unmatchedCompanies.length,
    ruleErrors,
    unmatchedList: r.unmatchedCompanies.map((u) => `${u.customerName}(${u.reason})`),
    over60: r.pairings.filter((p) => p.commuteMinutes > 60).length,
  };
}

async function main() {
  const data = buildIntegratedData('.');
  const allIds = data.fullMatchCustomerIds;

  const scenarios: { name: string; ids: number[] }[] = [
    { name: '全量55', ids: allIds },
    {
      name: '金山前道3家',
      ids: data.customers
        .filter((c) => c.customerType === CustomerType.FIRST_VISIT && c.parkName.includes('金山'))
        .slice(0, 3)
        .map((c) => c.id),
    },
    {
      name: '全部首访前道',
      ids: data.customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).map((c) => c.id),
    },
    {
      name: '金山园区全部',
      ids: data.customers.filter((c) => c.parkName.includes('金山')).map((c) => c.id),
    },
    {
      name: '下午2全部14家',
      ids: data.customers.filter((c) => c.timeSlot === 'AFTERNOON_2').map((c) => c.id),
    },
  ];

  console.log('=== 选集场景扫描 ===\n');
  const problems: string[] = [];

  for (const s of scenarios) {
    const r = await validateSelection(data, s.ids);
    const ok = r.unmatched === 0 && r.ruleErrors === 0;
    const flag = ok ? '✓' : '✗';
    console.log(
      `${flag} ${s.name}: ${r.matched}/${r.selected} 未匹配${r.unmatched} 规则错${r.ruleErrors} 通勤>60:${r.over60}`
    );
    if (!ok) {
      problems.push(s.name);
      r.unmatchedList.forEach((u) => console.log('   ', u));
    }
  }

  if (problems.length) {
    console.log('\n需修复场景:', problems.join(', '));
    process.exit(1);
  }
  console.log('\n✓ 所有扫描场景均合理');
}

main();
