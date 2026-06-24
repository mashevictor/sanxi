/**
 * 匹配测试报告：合成 20 组 + 存量 55 家，生成可展示的合理性分析
 */

import path from 'path';
import { buildIntegratedData } from '../data/integrated-data';
import { buildNationwideSimulationData } from '../data/nationwide-simulation';
import { ImportResult } from './excel-importer';
import { dispatchSelectedCompanies } from './select-dispatch';
import { matchCustomerToEmployee } from './match-rules';
import { canDepartureServePark, explainParkMatchFailure } from '../utils/park-match';
import { estimateCommuteMinutes } from '../utils/commute';
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
  CUSTOMER_TYPE_LABELS,
  TIME_SLOT_LABELS,
  EMPLOYEE_ROLE_LABELS,
} from '../types';
import { SelectDispatchResponse } from './select-dispatch';
import { buildRoleScenarioDefs } from './role-match-scenarios';
import { getIntegratedDataVersion } from './integrated-cache';
import type { LegCache } from './distance-service';

function formatEmployeeRoles(emp: Employee): string {
  return emp.roles.map((r) => EMPLOYEE_ROLE_LABELS[r] || r).join('、');
}

function formatEmployeeCapacity(emp: Employee): string {
  return emp.orderCapacity.map((s) => TIME_SLOT_LABELS[s] || s).join('、');
}

function buildEmployeePool(data: ImportResult): MatchTestEmployeeRow[] {
  return data.employees.map((e) => ({
    id: e.id,
    name: e.name,
    departureAddress: e.departureAddress,
    serviceParkName: e.serviceParkName,
    roles: formatEmployeeRoles(e),
    capacity: formatEmployeeCapacity(e),
    remark: e.remark,
  }));
}

const CORE_RULES = ['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配', '下午捆绑'];
const MAX_COMMUTE = 60;

export interface MatchTestRuleRow {
  rule: string;
  passed: boolean;
  message: string;
}

export interface MatchTestEmployeeRow {
  id: number;
  name: string;
  departureAddress: string;
  serviceParkName: string;
  roles: string;
  capacity: string;
  remark?: string;
}

export interface MatchTestPairingRow {
  companyName: string;
  parkName: string;
  address: string;
  customerType: string;
  timeSlot: string;
  designatedPerson?: string;
  rejectedPerson?: string;
  employeeId: number;
  employeeName: string;
  employeeRoles: string;
  employeeCapacity: string;
  employeeServicePark: string;
  departureAddress: string;
  employeeRemark?: string;
  commuteMinutes: number;
  commuteSource: string;
  directCommuteMinutes: number;
  reasonable: boolean;
  reasonableTags: string[];
  rules: MatchTestRuleRow[];
}

export interface MatchTestUnmatchedRow {
  companyName: string;
  parkName: string;
  reason: string;
}

export interface MatchTestScheduleOrder {
  companyName: string;
  timeSlot: string;
  customerType: string;
  parkName: string;
  address: string;
  commuteMinutes: number;
}

export interface MatchTestScheduleRow {
  employeeId: number;
  employeeName: string;
  departureAddress: string;
  totalOrders: number;
  morningOrders: number;
  afternoonOrders: number;
  totalCommuteMinutes: number;
  orders: MatchTestScheduleOrder[];
  routeSegments: { from: string; to: string; minutes: number }[];
  reasonable: boolean;
  issues: string[];
}

export interface MatchTestMultiOrderStats {
  employeesWithMultipleOrders: number;
  employeesWithThreePlus: number;
  maxOrdersPerEmployee: number;
  scheduleViolations: number;
}

export interface MatchTestScenario {
  id: string;
  name: string;
  description: string;
  roleCategory?: '前道' | '后道' | '综合';
  dataSource: 'synthetic' | 'production' | 'nationwide-simulation';
  dataSourceNote: string;
  coverage?: {
    cities?: number;
    parks?: number;
    employees?: number;
    customers?: number;
  };
  passed: boolean;
  stats: {
    selected: number;
    matched: number;
    unmatched: number;
    avgCommute: number;
    over60Commute: number;
    ruleViolations: number;
  };
  message: string;
  employeeCount: number;
  employees: MatchTestEmployeeRow[];
  pairings: MatchTestPairingRow[];
  unmatched: MatchTestUnmatchedRow[];
  schedules?: MatchTestScheduleRow[];
  multiOrderStats?: MatchTestMultiOrderStats;
}

export interface MatchTestReport {
  version: 2;
  dataVersion: string;
  generatedAt: string;
  ruleEngine: {
    sameForAllScenarios: boolean;
    functionName: string;
    coreRules: string[];
    optionalRules: string[];
    optimizer: string;
    note: string;
  };
  dataSources: {
    id: string;
    label: string;
    description: string;
    touchesProductionExcel: boolean;
  }[];
  summary: {
    totalScenarios: number;
    passedScenarios: number;
    failedScenarios: number;
    allPassed: boolean;
  };
  scenarios: MatchTestScenario[];
  parkMatchDemo: {
    title: string;
    cases: { parkName: string; departure: string; passed: boolean; note: string }[];
  };
  notes: string[];
}

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

export function buildSyntheticTestData(): ImportResult {
  const parks: InvestmentPark[] = [];
  const customers: Customer[] = [];
  const employees: Employee[] = [];

  TEST_GROUPS.forEach((g, i) => {
    const parkId = 80001 + i;
    const customerId = 81001 + i;
    const employeeId = 82001 + i;
    const empName = `测试员${String(i + 1).padStart(2, '0')}`;

    parks.push({ id: parkId, name: g.park, cityId: 1, cityName: '上海市' });
    customers.push({
      id: customerId,
      companyName: `测试公司-${g.park}`,
      address: `${g.departure}88号`,
      customerType: g.customerType,
      appointmentTime: new Date('2026-06-15T09:00:00'),
      timeSlot: g.timeSlot,
      cityId: 1,
      cityName: '上海市',
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
      cityId: 1,
      cityName: '上海市',
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
    cities: ['上海市'],
    stats: {
      firstVisitCount: customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length,
      projectCount: customers.filter((c) => c.customerType === CustomerType.PROJECT).length,
      followUpCount: customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length,
      employeeCount: employees.length,
      handInHandGroups: 0,
    },
  };
}

/** 一人多单专用：2 名全能员工各接 3 单（上午/下午1/下午2），1 名区域员工接 2 单 */
export function buildMultiOrderTestData(): ImportResult {
  const parkZhangjiang: InvestmentPark = { id: 83001, name: '浦东-张江', cityId: 1, cityName: '上海市' };
  const parkMinhang: InvestmentPark = { id: 83002, name: '闵行-莘庄', cityId: 1, cityName: '上海市' };
  const parks = [parkZhangjiang, parkMinhang];

  const employees: Employee[] = [
    {
      id: 83101,
      name: '张全能',
      cityId: 1,
      cityName: '上海市',
      serviceParkId: parkZhangjiang.id,
      serviceParkName: parkZhangjiang.name,
      roles: [EmployeeRole.FRONT, EmployeeRole.BACK, EmployeeRole.PROJECT],
      status: EmployeeStatus.ACTIVE,
      departureAddress: '上海市浦东新区张江路100号',
      plusCapabilities: {
        FRONT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
      },
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1, TimeSlot.AFTERNOON_2],
      remark: '浦东主力，可接上午首访+下午项目+下午首访',
    },
    {
      id: 83102,
      name: '李备岗',
      cityId: 1,
      cityName: '上海市',
      serviceParkId: parkZhangjiang.id,
      serviceParkName: parkZhangjiang.name,
      roles: [EmployeeRole.BACK, EmployeeRole.PROJECT, EmployeeRole.FRONT],
      status: EmployeeStatus.ACTIVE,
      departureAddress: '上海市浦东新区金科路200号',
      plusCapabilities: {
        FRONT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
      },
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1, TimeSlot.AFTERNOON_2],
      remark: '浦东备岗，与张全能分工不同时段职责',
    },
    {
      id: 83103,
      name: '王闵行',
      cityId: 1,
      cityName: '上海市',
      serviceParkId: parkMinhang.id,
      serviceParkName: parkMinhang.name,
      roles: [EmployeeRole.PROJECT],
      status: EmployeeStatus.ACTIVE,
      departureAddress: '上海市闵行区莘庄镇莘松路',
      plusCapabilities: {
        FRONT: [PlusLevel.PLUS_0],
        PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1],
        BACK: [PlusLevel.PLUS_0],
      },
      orderCapacity: [TimeSlot.MORNING, TimeSlot.AFTERNOON_1],
      remark: '闵行项目专员，不接下午2',
    },
  ];

  type CustDef = {
    id: number;
    companyName: string;
    park: InvestmentPark;
    address: string;
    customerType: CustomerType;
    timeSlot: TimeSlot;
  };

  const custDefs: CustDef[] = [
    { id: 83201, companyName: '多单测试-A公司', park: parkZhangjiang, address: '上海市浦东新区张江路188号', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.MORNING },
    { id: 83202, companyName: '多单测试-B公司', park: parkZhangjiang, address: '上海市浦东新区金科路288号', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.MORNING },
    { id: 83203, companyName: '多单测试-C公司', park: parkZhangjiang, address: '上海市浦东新区祖冲之路388号', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_1 },
    { id: 83204, companyName: '多单测试-D公司', park: parkZhangjiang, address: '上海市浦东新区碧波路488号', customerType: CustomerType.FOLLOW_UP, timeSlot: TimeSlot.AFTERNOON_1 },
    { id: 83205, companyName: '多单测试-E公司', park: parkZhangjiang, address: '上海市浦东新区哈雷路588号', customerType: CustomerType.FIRST_VISIT, timeSlot: TimeSlot.AFTERNOON_2 },
    { id: 83206, companyName: '多单测试-F公司', park: parkZhangjiang, address: '上海市浦东新区郭守敬路688号', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_2 },
    { id: 83207, companyName: '多单测试-G公司', park: parkMinhang, address: '上海市闵行区莘庄镇莘松路100号', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.MORNING },
    { id: 83208, companyName: '多单测试-H公司', park: parkMinhang, address: '上海市闵行区莘庄镇莘浜路200号', customerType: CustomerType.PROJECT, timeSlot: TimeSlot.AFTERNOON_1 },
  ];

  const customers: Customer[] = custDefs.map((d) => ({
    id: d.id,
    companyName: d.companyName,
    address: d.address,
    customerType: d.customerType,
    appointmentTime: new Date('2026-06-15T09:00:00'),
    timeSlot: d.timeSlot,
    cityId: 1,
    cityName: '上海市',
    parkId: d.park.id,
    parkName: d.park.name,
    plusCount: 0,
    plusLevel: PlusLevel.PLUS_0,
    isHandInHand: false,
    dispatchStatus: DispatchStatus.PENDING,
  }));

  return {
    parks,
    customers,
    employees,
    cities: ['上海市'],
    stats: {
      firstVisitCount: customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length,
      projectCount: customers.filter((c) => c.customerType === CustomerType.PROJECT).length,
      followUpCount: customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length,
      employeeCount: employees.length,
      handInHandGroups: 0,
    },
  };
}

/** 时段冲突：1 名员工 + 2 个同上午客户，应只匹配 1 家 */
export function buildMultiOrderConflictData(): ImportResult {
  const base = buildMultiOrderTestData();
  const park = base.parks[0];
  const employee = base.employees[0];
  const customers: Customer[] = [
    {
      id: 83301,
      companyName: '冲突测试-上午甲',
      address: '上海市浦东新区张江路301号',
      customerType: CustomerType.FIRST_VISIT,
      appointmentTime: new Date('2026-06-15T09:00:00'),
      timeSlot: TimeSlot.MORNING,
      cityId: 1,
      cityName: '上海市',
      parkId: park.id,
      parkName: park.name,
      plusCount: 0,
      plusLevel: PlusLevel.PLUS_0,
      isHandInHand: false,
      dispatchStatus: DispatchStatus.PENDING,
    },
    {
      id: 83302,
      companyName: '冲突测试-上午乙',
      address: '上海市浦东新区张江路302号',
      customerType: CustomerType.FIRST_VISIT,
      appointmentTime: new Date('2026-06-15T09:00:00'),
      timeSlot: TimeSlot.MORNING,
      cityId: 1,
      cityName: '上海市',
      parkId: park.id,
      parkName: park.name,
      plusCount: 0,
      plusLevel: PlusLevel.PLUS_0,
      isHandInHand: false,
      dispatchStatus: DispatchStatus.PENDING,
    },
  ];
  return {
    ...base,
    customers,
    employees: [employee],
    stats: {
      firstVisitCount: 2,
      projectCount: 0,
      followUpCount: 0,
      employeeCount: 1,
      handInHandGroups: 0,
    },
  };
}

const SLOT_LABEL_TO_ENUM = Object.fromEntries(
  Object.entries(TIME_SLOT_LABELS).map(([k, v]) => [v, k as TimeSlot])
) as Record<string, TimeSlot>;

function buildScheduleRows(
  data: ImportResult,
  result: SelectDispatchResponse
): { rows: MatchTestScheduleRow[]; violations: number } {
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));

  let violations = 0;
  const rows: MatchTestScheduleRow[] = [];

  for (const sched of result.employeeSchedules) {
    const employee = employeeById.get(sched.employeeId);
    if (!employee) continue;

    const issues: string[] = [];
    const assignedCustomers = sched.orders
      .map((o) => customerById.get(o.customerId))
      .filter((c): c is Customer => !!c);

    const slotCounts = new Map<string, number>();
    for (const o of sched.orders) {
      slotCounts.set(o.timeSlot, (slotCounts.get(o.timeSlot) || 0) + 1);
    }
    for (const [slot, count] of slotCounts) {
      if (count > 1) {
        issues.push(`时段「${slot}」重复 ${count} 次`);
      }
    }

    for (const o of sched.orders) {
      const slotEnum = SLOT_LABEL_TO_ENUM[o.timeSlot];
      if (slotEnum && !employee.orderCapacity.includes(slotEnum)) {
        issues.push(`${o.companyName} 时段「${o.timeSlot}」超出员工容量`);
      }
    }

    for (const customer of assignedCustomers) {
      const others = assignedCustomers.filter((c) => c.id !== customer.id);
      const match = matchCustomerToEmployee(customer, employee, availableNames, others, {
        requirePlus: false,
      });
      const failedCore = match.details.filter((d) => CORE_RULES.includes(d.rule) && !d.passed);
      if (!match.eligible || failedCore.length) {
        issues.push(`${customer.companyName} 在已接单上下文中规则不合规`);
      }
    }

    if (issues.length) violations++;

    rows.push({
      employeeId: sched.employeeId,
      employeeName: sched.employeeName,
      departureAddress: sched.departureAddress,
      totalOrders: sched.totalOrders,
      morningOrders: sched.morningOrders,
      afternoonOrders: sched.afternoonOrders,
      totalCommuteMinutes: sched.totalCommuteMinutes,
      orders: sched.orders.map((o) => ({
        companyName: o.companyName,
        timeSlot: o.timeSlot,
        customerType: o.customerType,
        parkName: o.parkName,
        address: o.address,
        commuteMinutes: o.commuteMinutes,
      })),
      routeSegments: sched.routeSegments,
      reasonable: issues.length === 0,
      issues,
    });
  }

  rows.sort((a, b) => b.totalOrders - a.totalOrders || a.employeeName.localeCompare(b.employeeName, 'zh'));
  return { rows, violations };
}

function buildPairingRows(
  data: ImportResult,
  result: SelectDispatchResponse
): { rows: MatchTestPairingRow[]; ruleViolations: number } {
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));
  const assignments = new Map<number, number[]>();

  for (const p of result.pairings) {
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  let ruleViolations = 0;
  const rows: MatchTestPairingRow[] = [];

  for (const p of result.pairings) {
    const customer = customerById.get(p.customerId);
    const employee = employeeById.get(p.employeeId);
    if (!customer || !employee) continue;

    const assignedOthers = (assignments.get(p.employeeId) || [])
      .filter((id) => id !== p.customerId)
      .map((id) => customerById.get(id))
      .filter((c): c is Customer => !!c);

    const match = matchCustomerToEmployee(customer, employee, availableNames, assignedOthers, {
      requirePlus: false,
    });

    const failedCore = match.details.filter((d) => CORE_RULES.includes(d.rule) && !d.passed);
    if (!match.eligible || failedCore.length) ruleViolations++;

    const tags: string[] = [];
    if (match.eligible && failedCore.length === 0) tags.push('规则合规');
    else tags.push('规则异常');

    const directCommute = estimateCommuteMinutes(employee.departureAddress, customer.address);
    if (p.commuteMinutes > MAX_COMMUTE) {
      tags.push(customer.designatedPerson === employee.name ? '通勤偏长(指定人)' : '通勤超60分');
    } else if (p.commuteMinutes <= 30) {
      tags.push('通勤较近');
    }

    const parkOk = canDepartureServePark(employee.departureAddress, customer.parkName);
    if (!parkOk) tags.push('园区不匹配');

    rows.push({
      companyName: p.companyName,
      parkName: p.parkName,
      address: p.address,
      customerType: p.customerType,
      timeSlot: p.timeSlot,
      designatedPerson: customer.designatedPerson,
      rejectedPerson: customer.rejectedPerson,
      employeeId: employee.id,
      employeeName: p.employeeName,
      employeeRoles: formatEmployeeRoles(employee),
      employeeCapacity: formatEmployeeCapacity(employee),
      employeeServicePark: employee.serviceParkName,
      departureAddress: p.departureAddress,
      employeeRemark: employee.remark,
      commuteMinutes: p.commuteMinutes,
      commuteSource: p.route?.source || 'local',
      directCommuteMinutes: directCommute,
      reasonable: match.eligible && failedCore.length === 0,
      reasonableTags: tags,
      rules: match.details.map((d) => ({ rule: d.rule, passed: d.passed, message: d.message })),
    });
  }

  return { rows, ruleViolations };
}

interface ScenarioExpectations {
  minEmployeesWithThreePlus?: number;
  expectMatched?: number;
  expectUnmatched?: number;
}

function dispatchOptionsForScenario(
  meta: { dataSource?: MatchTestScenario['dataSource'] } | undefined,
  legCache?: LegCache
) {
  if (meta?.dataSource === 'production') {
    return {
      commuteMode: 'transit' as const,
      preferShortestCommute: true,
      legCache,
      transitWarmMaxFetches: 0,
    };
  }
  return {
    commuteMode: 'local' as const,
    preferShortestCommute: false,
  };
}

async function runScenarioReport(
  id: string,
  name: string,
  description: string,
  data: ImportResult,
  customerIds: number[],
  expectations?: ScenarioExpectations,
  meta?: {
    dataSource: MatchTestScenario['dataSource'];
    dataSourceNote: string;
    coverage?: MatchTestScenario['coverage'];
    roleCategory?: MatchTestScenario['roleCategory'];
    employeePoolIds?: number[];
  },
  legCache?: LegCache
): Promise<MatchTestScenario> {
  const dispatchOpts = dispatchOptionsForScenario(meta, legCache);
  const result = await dispatchSelectedCompanies(data, customerIds, undefined, {
    ...dispatchOpts,
    employeePoolIds: meta?.employeePoolIds,
  });
  const { rows, ruleViolations } = buildPairingRows(data, result);
  const { rows: scheduleRows, violations: scheduleViolations } = buildScheduleRows(data, result);
  const over60 = rows.filter((r) => r.commuteMinutes > MAX_COMMUTE).length;

  const multiOrderStats: MatchTestMultiOrderStats = {
    employeesWithMultipleOrders: scheduleRows.filter((s) => s.totalOrders >= 2).length,
    employeesWithThreePlus: scheduleRows.filter((s) => s.totalOrders >= 3).length,
    maxOrdersPerEmployee: scheduleRows.reduce((m, s) => Math.max(m, s.totalOrders), 0),
    scheduleViolations,
  };

  const expectAllMatched = expectations?.expectMatched == null && expectations?.expectUnmatched == null;

  let passed = ruleViolations === 0 && scheduleViolations === 0;

  if (expectAllMatched) {
    passed =
      passed &&
      result.stats.matched === customerIds.length &&
      result.stats.unmatched === 0;
  }

  if (expectations?.expectMatched != null) {
    passed = passed && result.stats.matched === expectations.expectMatched;
  }
  if (expectations?.expectUnmatched != null) {
    passed = passed && result.stats.unmatched === expectations.expectUnmatched;
  }
  if (expectations?.minEmployeesWithThreePlus != null) {
    passed = passed && multiOrderStats.employeesWithThreePlus >= expectations.minEmployeesWithThreePlus;
  }

  return {
    id,
    name,
    description,
    roleCategory: meta?.roleCategory || '综合',
    dataSource: meta?.dataSource || 'synthetic',
    dataSourceNote: meta?.dataSourceNote || '纯合成测试数据，与服务器 Excel 无关',
    coverage: meta?.coverage,
    passed,
    stats: {
      selected: customerIds.length,
      matched: result.stats.matched,
      unmatched: result.stats.unmatched,
      avgCommute: result.stats.avgCommute,
      over60Commute: over60,
      ruleViolations,
    },
    message: result.message,
    employeeCount: data.employees.length,
    employees: buildEmployeePool(data),
    pairings: rows,
    unmatched: result.unmatchedCompanies.map((u) => ({
      companyName: u.companyName,
      parkName: u.parkName,
      reason: u.reason,
    })),
    schedules: scheduleRows,
    multiOrderStats,
  };
}

export async function buildMatchTestReport(dataDir?: string, legCache?: LegCache): Promise<MatchTestReport> {
  const root = dataDir || path.join(__dirname, '..', '..');
  const synthetic = buildSyntheticTestData();
  const integrated = buildIntegratedData(root);
  const syntheticIds = synthetic.customers.map((c) => c.id);

  const scenarios: MatchTestScenario[] = [];

  scenarios.push(
    await runScenarioReport(
      'synthetic-20',
      '新数据 · 20 组全量',
      '20 个新园区 + 20 员工 + 20 客户，一次性 AI 匹配',
      synthetic,
      syntheticIds,
      undefined,
      {
        dataSource: 'synthetic',
        dataSourceNote: '程序生成的上海 20 区合成数据，ID 段 80xxx，不读取 Excel',
      }
    )
  );

  scenarios.push(
    await runScenarioReport(
      'production-55',
      '存量 · 55 家全量',
      'Excel 整合数据全量匹配（含补位员工）',
      integrated,
      integrated.fullMatchCustomerIds,
      undefined,
      {
        dataSource: 'production',
        dataSourceNote: '读取项目 data/ 目录 Excel + 演示/补位员工，与线上一致的数据管线',
        coverage: {
          parks: integrated.parks.length,
          employees: integrated.employees.length,
          customers: integrated.customers.length,
        },
      },
      legCache
    )
  );

  const morningIds = synthetic.customers
    .filter((c) => c.timeSlot === TimeSlot.MORNING)
    .map((c) => c.id);
  scenarios.push(
    await runScenarioReport(
      'synthetic-morning',
      '新数据 · 上午 8 家',
      '仅上午时段客户批量匹配',
      synthetic,
      morningIds,
      undefined,
      { dataSource: 'synthetic', dataSourceNote: '同上 20 组合成数据的子集' }
    )
  );

  const multiOrder = buildMultiOrderTestData();
  const multiOrderIds = multiOrder.customers.map((c) => c.id);
  scenarios.push(
    await runScenarioReport(
      'multi-order-8',
      '一人多单 · 8 家合理分工',
      '3 名员工、8 客户：张全能/李备岗各接上午+下午1+下午2共 3 单，王闵行接闵行 2 单；验证时段不冲突',
      multiOrder,
      multiOrderIds,
      { minEmployeesWithThreePlus: 2 },
      { dataSource: 'synthetic', dataSourceNote: '上海多单专用合成数据，ID 段 83xxx' }
    )
  );

  const conflict = buildMultiOrderConflictData();
  scenarios.push(
    await runScenarioReport(
      'multi-order-conflict',
      '一人多单 · 时段冲突',
      '仅 1 名员工 + 2 个同上午客户：应匹配 1 家，另 1 家因时段已满未匹配',
      conflict,
      conflict.customers.map((c) => c.id),
      { expectMatched: 1, expectUnmatched: 1 },
      { dataSource: 'synthetic', dataSourceNote: '冲突验证用合成数据' }
    )
  );

  const nationwide = buildNationwideSimulationData();
  scenarios.push(
    await runScenarioReport(
      'nationwide-multi-order',
      '全国模拟 · 一人多单大压测',
      `${nationwide.meta.cityCount} 城 · ${nationwide.meta.parkCount} 园区 · ${nationwide.meta.employeeCount} 员工 · ${nationwide.meta.customerCount} 客户，同一套 matchCustomerToEmployee 规则全量匹配`,
      nationwide,
      nationwide.customers.map((c) => c.id),
      { minEmployeesWithThreePlus: Math.floor(nationwide.meta.employeeCount * 0.3) },
      {
        dataSource: 'nationwide-simulation',
        dataSourceNote: '全国省市园区纯模拟数据（ID 96xxx），与服务器 Excel 存量完全隔离',
        roleCategory: '综合',
        coverage: {
          cities: nationwide.meta.cityCount,
          parks: nationwide.meta.parkCount,
          employees: nationwide.meta.employeeCount,
          customers: nationwide.meta.customerCount,
        },
      }
    )
  );

  // 前道 / 后道各 5 组（Excel 整合 + 员工补丁）
  const roleDefs = buildRoleScenarioDefs(integrated);
  for (const def of roleDefs) {
    const customerIds = def.customerIds(integrated);
    if (!customerIds.length) continue;
    const poolIds = def.employeePoolIds?.(integrated);
    const expectations: ScenarioExpectations = {};
    if (def.expectMatched) expectations.expectMatched = def.expectMatched(integrated, customerIds);
    if (def.expectUnmatched != null) {
      expectations.expectUnmatched = def.expectUnmatched(integrated, customerIds);
    }
    if (def.minEmployeesWithThreePlus != null) {
      expectations.minEmployeesWithThreePlus = def.minEmployeesWithThreePlus;
    }
    scenarios.push(
      await runScenarioReport(
        def.id,
        def.name,
        def.description,
        integrated,
        customerIds,
        Object.keys(expectations).length ? expectations : undefined,
        {
          dataSource: 'production',
          dataSourceNote: 'Excel 整合 + 演示/补位/员工补丁，与手动派单一致',
          roleCategory: def.roleCategory,
          employeePoolIds: poolIds,
          coverage: {
            parks: integrated.parks.length,
            employees: poolIds?.length ?? integrated.employees.length,
            customers: customerIds.length,
          },
        },
        legCache
      )
    );
  }

  const passed = scenarios.filter((s) => s.passed).length;

  const parkCases = [
    {
      parkName: '浦东-张江',
      departure: '上海市浦东新区张江路100号',
      passed: canDepartureServePark('上海市浦东新区张江路100号', '浦东-张江'),
      note: '推荐命名：区域-地标',
    },
    {
      parkName: '测试园区-浦东张江',
      departure: '上海市浦东新区张江路100号',
      passed: canDepartureServePark('上海市浦东新区张江路100号', '测试园区-浦东张江'),
      note: '旧式命名，改进后应能通过',
    },
    {
      parkName: '浦东-张江',
      departure: '上海市闵行区莘庄镇',
      passed: canDepartureServePark('上海市闵行区莘庄镇', '浦东-张江'),
      note: '出发地不在园区范围，应失败',
    },
  ].map((c) => ({
    ...c,
    note: c.passed
      ? c.note
      : `${c.note} · ${explainParkMatchFailure(c.departure, c.parkName)}`,
  }));

  return {
    version: 2,
    dataVersion: getIntegratedDataVersion(),
    generatedAt: new Date().toISOString(),
    ruleEngine: {
      sameForAllScenarios: true,
      functionName: 'matchCustomerToEmployee',
      coreRules: CORE_RULES,
      optionalRules: ['Plus匹配'],
      optimizer: 'findCapacitatedMatching / findOptimalAutoPairingAsync',
      note: '所有场景（含全国模拟、Excel 存量、上海合成）共用同一套规则引擎与派单优化器；测试页仅切换输入数据，不切换规则。',
    },
    dataSources: [
      {
        id: 'synthetic',
        label: '合成测试数据',
        description: '程序生成，ID 80xxx/83xxx，不触碰 Excel',
        touchesProductionExcel: false,
      },
      {
        id: 'nationwide-simulation',
        label: '全国模拟数据',
        description: '覆盖主要省市的园区/员工/客户，ID 96xxx，完全隔离',
        touchesProductionExcel: false,
      },
      {
        id: 'production',
        label: 'Excel 整合存量',
        description: '读取 data/ 目录 Excel + 演示/补位员工，与线上一致',
        touchesProductionExcel: true,
      },
    ],
    summary: {
      totalScenarios: scenarios.length,
      passedScenarios: passed,
      failedScenarios: scenarios.length - passed,
      allPassed: passed === scenarios.length,
    },
    scenarios,
    parkMatchDemo: {
      title: '园区匹配 vs 地址距离（说明）',
      cases: parkCases,
    },
    notes: [
      '【规则统一】所有场景调用同一 matchCustomerToEmployee：城市、职责、时段（含一人多单时段占用）、指定人、放弃人、园区匹配；Plus 在测试模式不计入硬约束。',
      '【数据隔离】全国模拟与 20 组合成数据均为纯模拟，不会修改或覆盖服务器 Excel 存量；仅「存量·55家」场景读取 Excel。',
      '园区匹配：判断员工出发地能否覆盖客户所属园区（业务分工规则）。',
      '通勤分钟：员工出发地 → 公司拜访地址 的估算距离，用于选最优员工；超过 60 分为软约束，不导致匹配失败。',
      '一人多单：同一员工可接多单，但同一时段只能接 1 单；行程表按上午→下午1→下午2排序并汇总当日通勤。',
    ],
  };
}
