/**
 * 测试环境：输入园区/地址，即时查找合规员工（同一套 matchCustomerToEmployee 规则）
 * 员工池固定为全量整合数据（Excel + 演示 + 补位员工）
 */

import path from 'path';
import {
  Customer,
  Employee,
  CustomerType,
  TimeSlot,
  PlusLevel,
  DispatchStatus,
  CUSTOMER_TYPE_LABELS,
  TIME_SLOT_LABELS,
  EMPLOYEE_ROLE_LABELS,
} from '../types';
import { matchCustomerToEmployee } from './match-rules';
import { estimateCommuteMinutes } from '../utils/commute';
import { getIntegratedData } from './integrated-cache';

export interface AdhocMatchRequest {
  parkName: string;
  address: string;
  cityName?: string;
  customerType?: CustomerType;
  timeSlot?: TimeSlot;
}

export interface AdhocEmployeeCandidate {
  employeeId: number;
  employeeName: string;
  departureAddress: string;
  serviceParkName: string;
  roles: string;
  capacity: string;
  score: number;
  commuteMinutes: number;
  rules: { rule: string; passed: boolean; message: string }[];
  remark?: string;
}

export interface AdhocMatchResponse {
  query: {
    parkName: string;
    address: string;
    cityName: string;
    customerType: string;
    timeSlot: string;
    poolLabel: string;
  };
  poolStats: {
    totalEmployees: number;
    eligibleCount: number;
    cityInferred: boolean;
  };
  bestMatch: AdhocEmployeeCandidate | null;
  eligible: AdhocEmployeeCandidate[];
  nearMisses: {
    employeeId: number;
    employeeName: string;
    departureAddress: string;
    failedRules: { rule: string; message: string }[];
    commuteMinutes: number;
  }[];
  districtHint?: string;
  note: string;
}

const FULL_POOL_LABEL = '全量员工数据（Excel 存量 + 演示 + 补位）';

const MUNICIPALITY_ALIASES: Record<string, string> = {
  北京: '北京市',
  上海: '上海市',
  天津: '天津市',
  重庆: '重庆市',
};

function extractDistrictFromAddress(address: string): string | null {
  const m = address.match(/上海市([\u4e00-\u9fa5]+区)/);
  return m ? m[1] : null;
}

function loadFullEmployeePool(dataDir: string): { employees: Employee[]; cities: string[] } {
  const integrated = getIntegratedData(dataDir);
  return { employees: integrated.employees, cities: integrated.cities };
}

function inferCityName(
  address: string,
  parkName: string,
  cities: string[],
  explicit?: string
): string | null {
  if (explicit?.trim()) return explicit.trim();

  const haystack = `${address} ${parkName}`;
  const sorted = [...cities].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    const short = city.replace(/市$/, '');
    if (haystack.includes(city) || haystack.includes(short)) return city;
  }

  for (const [short, full] of Object.entries(MUNICIPALITY_ALIASES)) {
    if (haystack.includes(short)) return full;
  }
  return null;
}

function buildAdhocCustomer(
  req: AdhocMatchRequest,
  cityName: string,
  cityId: number
): Customer {
  return {
    id: -1,
    companyName: '试算客户',
    address: req.address.trim(),
    customerType: req.customerType || CustomerType.FIRST_VISIT,
    appointmentTime: new Date(),
    timeSlot: req.timeSlot || TimeSlot.MORNING,
    cityId,
    cityName,
    parkId: -1,
    parkName: req.parkName.trim(),
    plusCount: 0,
    plusLevel: PlusLevel.PLUS_0,
    isHandInHand: false,
    dispatchStatus: DispatchStatus.PENDING,
  };
}

function formatRoles(emp: Employee): string {
  return emp.roles.map((r) => EMPLOYEE_ROLE_LABELS[r] || r).join('、');
}

function formatCapacity(emp: Employee): string {
  return emp.orderCapacity.map((s) => TIME_SLOT_LABELS[s] || s).join('、');
}

function toCandidate(emp: Employee, customer: Customer, match: ReturnType<typeof matchCustomerToEmployee>): AdhocEmployeeCandidate {
  const commuteMinutes = estimateCommuteMinutes(emp.departureAddress, customer.address);
  return {
    employeeId: emp.id,
    employeeName: emp.name,
    departureAddress: emp.departureAddress,
    serviceParkName: emp.serviceParkName,
    roles: formatRoles(emp),
    capacity: formatCapacity(emp),
    score: match.score,
    commuteMinutes,
    rules: match.details.map((d) => ({ rule: d.rule, passed: d.passed, message: d.message })),
    remark: emp.remark,
  };
}

export function lookupAdhocMatch(req: AdhocMatchRequest, dataDir?: string): AdhocMatchResponse {
  const root = dataDir || path.join(__dirname, '..', '..');
  const parkName = req.parkName?.trim();
  const address = req.address?.trim();

  if (!parkName) throw new Error('请填写园区名称');
  if (!address) throw new Error('请填写拜访地址');

  const { employees, cities } = loadFullEmployeePool(root);
  const cityName = inferCityName(address, parkName, cities, req.cityName);
  const cityInferred = !req.cityName?.trim() && !!cityName;

  if (!cityName) {
    throw new Error('无法从地址推断城市，请补充填写城市（如：上海市、广州市）');
  }

  const cityId = employees.find((e) => e.cityName === cityName)?.cityId ?? 1;
  const customer = buildAdhocCustomer(req, cityName, cityId);
  const availableNames = new Set(employees.map((e) => e.name));

  const eligible: AdhocEmployeeCandidate[] = [];
  const nearMisses: AdhocMatchResponse['nearMisses'] = [];

  for (const emp of employees) {
    const match = matchCustomerToEmployee(customer, emp, availableNames, [], { requirePlus: false });
    if (match.eligible) {
      eligible.push(toCandidate(emp, customer, match));
    } else {
      const failedRules = match.details
        .filter((d) => !d.passed && d.rule !== 'Plus匹配')
        .map((d) => ({ rule: d.rule, message: d.message }));
      if (failedRules.length) {
        nearMisses.push({
          employeeId: emp.id,
          employeeName: emp.name,
          departureAddress: emp.departureAddress,
          failedRules,
          commuteMinutes: estimateCommuteMinutes(emp.departureAddress, customer.address),
        });
      }
    }
  }

  eligible.sort((a, b) => {
    if (a.commuteMinutes !== b.commuteMinutes) return a.commuteMinutes - b.commuteMinutes;
    return b.score - a.score;
  });

  nearMisses.sort((a, b) => a.commuteMinutes - b.commuteMinutes);

  const districtKey = extractDistrictFromAddress(address);
  let districtHint: string | undefined;
  if (eligible.length === 0 && districtKey) {
    const districtStaff = nearMisses.filter((m) => m.departureAddress.includes(districtKey));
    const roleOnly = districtStaff.filter((m) =>
      m.failedRules.every((f) => f.rule === '职责匹配')
    );
    if (roleOnly.length) {
      districtHint = `${districtKey}有 ${roleOnly.length} 名员工出发地在本区，但职责与「${CUSTOMER_TYPE_LABELS[customer.customerType]}」不符（多为后道员工，可尝试改为回访）`;
    }
  }

  return {
    query: {
      parkName,
      address,
      cityName,
      customerType: CUSTOMER_TYPE_LABELS[customer.customerType],
      timeSlot: TIME_SLOT_LABELS[customer.timeSlot],
      poolLabel: FULL_POOL_LABEL,
    },
    poolStats: {
      totalEmployees: employees.length,
      eligibleCount: eligible.length,
      cityInferred,
    },
    bestMatch: eligible[0] || null,
    eligible: eligible.slice(0, 20),
    nearMisses: nearMisses.slice(0, 12),
    districtHint,
    note: '测试环境即时试算：使用全量员工数据 + 与正式派单相同的规则引擎，不写入任何数据。',
  };
}
