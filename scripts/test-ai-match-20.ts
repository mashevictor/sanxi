/**
 * 生成 20 组新园区+员工+客户，测试 AI 匹配是否正常
 * 运行: npx tsx scripts/test-ai-match-20.ts
 */

import { canDepartureServePark, explainParkMatchFailure } from '../src/utils/park-match';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import {
  Customer,
  Employee,
  CustomerType,
  TimeSlot,
  EmployeeRole,
  EmployeeStatus,
  PlusLevel,
  DispatchStatus,
  InvestmentPark,
  ImportResult,
} from '../src/types';

const CITY_ID = 1;
const CITY_NAME = '上海市';
const PARK_BASE_ID = 80001;
const CUSTOMER_BASE_ID = 81001;
const EMPLOYEE_BASE_ID = 82001;

/** 20 组测试：园区名（区域-地标，须与出发地关键词对应）、出发地、客户类型、时段 */
const TEST_GROUPS: {
  park: string;
  departure: string;
  customerType: CustomerType;
  timeSlot: TimeSlot;
  role: EmployeeRole;
}[] = [
  { park: '浦东-张江', departure: '上海市浦东新区张江路100号', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.MORNING, role: EmployeeRole.FRONT },
  { park: '浦东-金桥', departure: '上海市浦东新区金桥路200号', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.MORNING, role: EmployeeRole.BACK },
  { park: '闵行-莘庄', departure: '上海市闵行区莘庄镇莘松路', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.MORNING, role: EmployeeRole.PROJECT },
  { park: '徐汇-漕河泾', departure: '上海市徐汇区漕宝路300号', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.AFTERNOON_1, role: EmployeeRole.FRONT },
  { park: '长宁-虹桥', departure: '上海市长宁区虹桥路400号', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.AFTERNOON_1, role: EmployeeRole.BACK },
  { park: '普陀-真如', departure: '上海市普陀区真如镇真北路', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_1, role: EmployeeRole.PROJECT },
  { park: '杨浦-五角场', departure: '上海市杨浦区五角场翔殷路', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.AFTERNOON_2, role: EmployeeRole.FRONT },
  { park: '虹口-北外滩', departure: '上海市虹口区北外滩东大名路', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.AFTERNOON_2, role: EmployeeRole.BACK },
  { park: '黄浦-外滩', departure: '上海市黄浦区外滩南京东路', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_2, role: EmployeeRole.PROJECT },
  { park: '宝山-顾村', departure: '上海市宝山区顾村镇沪太路', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.MORNING, role: EmployeeRole.FRONT },
  { park: '嘉定-安亭', departure: '上海市嘉定区安亭镇墨玉路', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.MORNING, role: EmployeeRole.BACK },
  { park: '松江-新城', departure: '上海市松江区新城路500号', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_1, role: EmployeeRole.PROJECT },
  { park: '青浦-徐泾', departure: '上海市青浦区徐泾镇盈港路', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.AFTERNOON_2, role: EmployeeRole.FRONT },
  { park: '奉贤-南桥', departure: '上海市奉贤区南桥镇解放路', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.MORNING, role: EmployeeRole.BACK },
  { park: '金山-亭林', departure: '上海市金山区亭林镇亭卫路', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_1, role: EmployeeRole.PROJECT },
  { park: '崇明-城桥', departure: '上海市崇明区城桥镇八一路', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.MORNING, role: EmployeeRole.FRONT },
  { park: '浦东-临港', departure: '上海市浦东新区临港新城环湖路', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.AFTERNOON_2, role: EmployeeRole.BACK },
  { park: '静安-大宁', departure: '上海市静安区大宁路600号', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.MORNING, role: EmployeeRole.PROJECT },
  { park: '闵行-紫竹', departure: '上海市闵行区紫竹高新区东川路', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.AFTERNOON_1, role: EmployeeRole.FRONT },
  { park: '浦东-惠南', departure: '上海市浦东新区惠南镇拱极路', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.AFTERNOON_2, role: EmployeeRole.BACK },
];

function buildTestData(): ImportResult {
  const parks: InvestmentPark[] = [];
  const customers: Customer[] = [];
  const employees: Employee[] = [];

  TEST_GROUPS.forEach((g, i) => {
    const parkId = PARK_BASE_ID + i;
    const customerId = CUSTOMER_BASE_ID + i;
    const employeeId = EMPLOYEE_BASE_ID + i;
    const empName = `测试员${String(i + 1).padStart(2, '0')}`;

    parks.push({
      id: parkId,
      name: g.park,
      cityId: CITY_ID,
      cityName: CITY_NAME,
    });

    customers.push({
      id: customerId,
      companyName: `测试公司-${g.park}`,
      address: `${g.departure}88号`,
      customerType: g.customerType,
      appointmentTime: new Date('2026-06-15T09:00:00'),
      timeSlot: g.timeSlot,
      cityId: CITY_ID,
      cityName: CITY_NAME,
      parkId,
      parkName: g.park,
      plusCount: 0,
      plusLevel: PlusLevel.PLUS_0,
      isHandInHand: false,
      dispatchStatus: DispatchStatus.PENDING,
    });

    employees.push({
      id: employeeId,
      name: empName,
      cityId: CITY_ID,
      cityName: CITY_NAME,
      serviceParkId: parkId,
      serviceParkName: g.park,
      roles: [g.role],
      status: EmployeeStatus.ACTIVE,
      departureAddress: g.departure,
      plusCapabilities: {
        FRONT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
      },
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1, TimeSlot.AFTERNOON_2],
    });
  });

  return {
    parks,
    customers,
    employees,
    cities: [CITY_NAME],
    stats: {
      firstVisitCount: customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length,
      projectCount: customers.filter((c) => c.customerType === CustomerType.PROJECT).length,
      followUpCount: customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length,
      employeeCount: employees.length,
      handInHandGroups: 0,
    },
  };
}

function validatePairings(
  data: ImportResult,
  pairings: Awaited<ReturnType<typeof dispatchSelectedCompanies>>['pairings']
) {
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));
  const assignments = new Map<number, number[]>();

  for (const p of pairings) {
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  const errors: string[] = [];
  for (const p of pairings) {
    const customer = customerById.get(p.customerId)!;
    const employee = employeeById.get(p.employeeId)!;
    const assignedOthers = (assignments.get(p.employeeId) || [])
      .filter((id) => id !== p.customerId)
      .map((id) => customerById.get(id)!)
      .filter(Boolean);
    const match = matchCustomerToEmployee(customer, employee, availableNames, assignedOthers, {
      requirePlus: false,
    });
    if (!match.eligible) {
      errors.push(`${customer.companyName} → ${employee.name}: ${match.details.filter((d) => !d.passed).map((d) => d.rule).join('、')}`);
    }
  }
  return errors;
}

async function runScenario(name: string, data: ImportResult, customerIds: number[]) {
  const result = await dispatchSelectedCompanies(data, customerIds, undefined, {
    commuteMode: 'local',
  });
  const ruleErrors = validatePairings(data, result.pairings);
  const ok = result.stats.unmatched === 0 && ruleErrors.length === 0;
  return { name, ok, result, ruleErrors };
}

async function main() {
  const data = buildTestData();
  const allIds = data.customers.map((c) => c.id);

  console.log('=== AI 匹配测试：20 组新园区 + 20 员工 + 20 客户 ===\n');
  console.log(`园区: ${data.parks.length}  客户: ${data.customers.length}  员工: ${data.employees.length}`);
  console.log(`  首访 ${data.stats.firstVisitCount} · 项目 ${data.stats.projectCount} · 回访 ${data.stats.followUpCount}\n`);

  // 场景1：20 家全量一次匹配
  const full = await runScenario('全量20家', data, allIds);
  printScenario(full);

  // 场景2：逐家单独匹配（各1组）
  let singleOk = 0;
  let singleFail = 0;
  const singleFails: string[] = [];
  for (const id of allIds) {
    const r = await runScenario(`单家#${id}`, data, [id]);
    if (r.ok) singleOk++;
    else {
      singleFail++;
      singleFails.push(`${id}: ${r.result.unmatchedCompanies[0]?.reason || r.ruleErrors.join('; ')}`);
    }
  }
  console.log(`\n--- 逐家单独匹配 ---`);
  console.log(`  ✓ ${singleOk}/20 成功  ✗ ${singleFail}/20 失败`);
  if (singleFails.length) singleFails.forEach((f) => console.log(`    ${f}`));

  // 场景3：按时段分批
  const morningIds = data.customers.filter((c) => c.timeSlot === TimeSlot.MORNING).map((c) => c.id);
  const aft1Ids = data.customers.filter((c) => c.timeSlot === TimeSlot.AFTERNOON_1).map((c) => c.id);
  const aft2Ids = data.customers.filter((c) => c.timeSlot === TimeSlot.AFTERNOON_2).map((c) => c.id);

  for (const [label, ids] of [
    ['上午时段', morningIds],
    ['下午1时段', aft1Ids],
    ['下午2时段', aft2Ids],
  ] as const) {
    const r = await runScenario(label, data, ids);
    console.log(`\n--- ${label} (${ids.length}家) ---`);
    console.log(`  ${r.ok ? '✓' : '✗'} 匹配 ${r.result.stats.matched}/${ids.length}  失败 ${r.result.stats.unmatched}`);
    if (r.result.unmatchedCompanies.length) {
      r.result.unmatchedCompanies.forEach((u) => console.log(`    未匹配: ${u.companyName} — ${u.reason}`));
    }
  }

  // 场景4：故意制造冲突（同员工同时段两家）— 应部分失败
  const conflictIds = [allIds[0], allIds[9]]; // 两家都是上午，各配专属员工，全量时应成功
  const conflict = await runScenario('两家同上午', data, conflictIds);
  console.log(`\n--- 两家同上午 ---`);
  console.log(`  ${conflict.ok ? '✓' : '✗'} ${conflict.result.stats.matched}/${conflictIds.length} 匹配`);

  // 场景5：旧式园区命名（测试园区-浦东张江）应能通过改进后的规则
  const legacyPark = '测试园区-浦东张江';
  const legacyDep = '上海市浦东新区张江路100号';
  const legacyOk = canDepartureServePark(legacyDep, legacyPark);
  console.log(`\n--- 旧式园区命名兼容性 ---`);
  console.log(`  园区: ${legacyPark}`);
  console.log(`  出发地: ${legacyDep}`);
  console.log(`  ${legacyOk ? '✓' : '✗'} 园区匹配 ${legacyOk ? '通过' : '失败'}`);
  if (!legacyOk) console.log(`  说明: ${explainParkMatchFailure(legacyDep, legacyPark)}`);

  // 汇总
  console.log('\n=== 汇总 ===');
  const allOk = full.ok && singleFail === 0 && legacyOk;
  if (allOk) {
    console.log('✓ AI 匹配正常：20 组新数据全量与逐家测试均通过');
    console.log(`  全量: ${full.result.stats.matched} 成功, 均通勤 ${full.result.stats.avgCommute} 分`);
    console.log('\n配对明细:');
    full.result.pairings.forEach((p) => {
      console.log(`  ${p.companyName} → ${p.employeeName} (${p.timeSlot}, ${p.commuteMinutes}分)`);
    });
  } else {
    console.log('✗ 存在问题，请检查上方失败项');
    process.exit(1);
  }
}

function printScenario(r: Awaited<ReturnType<typeof runScenario>>) {
  const flag = r.ok ? '✓' : '✗';
  console.log(`--- ${r.name} ---`);
  console.log(`  ${flag} 匹配 ${r.result.stats.matched}/${r.result.stats.selected}  失败 ${r.result.stats.unmatched}  规则违规 ${r.ruleErrors.length}`);
  console.log(`  消息: ${r.result.message}`);
  if (r.result.unmatchedCompanies.length) {
    r.result.unmatchedCompanies.forEach((u) => console.log(`    未匹配: ${u.companyName} — ${u.reason}`));
  }
  if (r.ruleErrors.length) {
    r.ruleErrors.forEach((e) => console.log(`    规则违规: ${e}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
