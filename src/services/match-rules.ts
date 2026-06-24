/**
 * 派单匹配规则引擎
 */

import {
  Customer,
  Employee,
  MatchDetail,
  CustomerType,
  TimeSlot,
  EmployeeRole,
  PlusLevel,
} from '../types';
import { customerTypeToRole, isFrontOrProject } from '../utils/parsers';
import { canDepartureServePark, explainParkMatchFailure } from '../utils/park-match';
import { inferProvinceFromAddress } from '../utils/address-region';

export interface MatchResult {
  employee: Employee;
  score: number;
  details: MatchDetail[];
  eligible: boolean;
}

function checkCityMatch(customer: Customer, employee: Employee): MatchDetail {
  const passed = customer.cityId === employee.cityId;
  return {
    rule: '城市匹配',
    passed,
    message: passed
      ? `城市匹配: ${customer.cityName}`
      : `城市不匹配: 客户${customer.cityName} vs 员工${employee.cityName}`,
  };
}

function checkRegionMatch(customer: Customer, employee: Employee): MatchDetail {
  const custRegion = inferProvinceFromAddress(customer.address);
  const empRegion = inferProvinceFromAddress(employee.departureAddress);
  const passed = custRegion !== '未知' && custRegion === empRegion;
  return {
    rule: '区域匹配',
    passed,
    message: passed
      ? `区域匹配: ${custRegion}（客户地址 ↔ 员工出发地）`
      : `区域不匹配: 客户地址在${custRegion}，员工出发地在${empRegion}，禁止跨省派单`,
  };
}

function checkRoleMatch(customer: Customer, employee: Employee): MatchDetail {
  const requiredRole = customerTypeToRole(customer.customerType);
  const passed = employee.roles.includes(requiredRole);
  return {
    rule: '职责匹配',
    passed,
    message: passed
      ? `职责匹配: ${requiredRole}`
      : `职责不匹配: 需要${requiredRole}, 员工职责[${employee.roles.join(',')}]`,
  };
}

function checkTimeSlotMatch(
  customer: Customer,
  employee: Employee,
  assignedCustomers: Customer[] = []
): MatchDetail {
  const hasCapacity = employee.orderCapacity.includes(customer.timeSlot);
  if (!hasCapacity) {
    return {
      rule: '时段匹配',
      passed: false,
      message: `时段不匹配: 客户${customer.timeSlot}, 员工容量[${employee.orderCapacity.join(',')}]`,
    };
  }
  const slotTaken = assignedCustomers.some((c) => c.timeSlot === customer.timeSlot);
  if (slotTaken) {
    return {
      rule: '时段匹配',
      passed: false,
      message: `时段已满: 员工${customer.timeSlot}时段已有其他派单`,
    };
  }
  return {
    rule: '时段匹配',
    passed: true,
    message: `时段匹配: ${customer.timeSlot}`,
  };
}

function checkDesignatedPerson(
  customer: Customer,
  employee: Employee,
  availableEmployeeNames: Set<string>
): MatchDetail {
  if (!customer.designatedPerson) {
    return { rule: '指定人', passed: true, message: '无指定人要求' };
  }

  if (employee.name === customer.designatedPerson) {
    return { rule: '指定人', passed: true, message: `匹配指定人: ${customer.designatedPerson}` };
  }

  if (availableEmployeeNames.has(customer.designatedPerson)) {
    return {
      rule: '指定人',
      passed: false,
      message: `指定人${customer.designatedPerson}在其他候选中，不能分配给${employee.name}`,
    };
  }

  return {
    rule: '指定人',
    passed: true,
    message: `指定人${customer.designatedPerson}不在候选列表，可分配给${employee.name}`,
  };
}

function checkRejectedPerson(customer: Customer, employee: Employee): MatchDetail {
  if (!customer.rejectedPerson) {
    return { rule: '放弃人', passed: true, message: '无放弃人限制' };
  }

  const passed = employee.name !== customer.rejectedPerson;
  return {
    rule: '放弃人',
    passed,
    message: passed
      ? `未匹配放弃人: ${customer.rejectedPerson}`
      : `员工${employee.name}是放弃人，不能分配`,
  };
}

function checkParkMatch(customer: Customer, employee: Employee): MatchDetail {
  const passed = canDepartureServePark(employee.departureAddress, customer.parkName);
  return {
    rule: '园区匹配',
    passed,
    message: passed
      ? `园区匹配: 客户园区[${customer.parkName}] ↔ 员工出发地[${employee.departureAddress}]可覆盖`
      : explainParkMatchFailure(employee.departureAddress, customer.parkName),
  };
}

function checkPlusMatch(customer: Customer, employee: Employee): MatchDetail {
  const role = customerTypeToRole(customer.customerType);
  const roleKey = role as keyof typeof employee.plusCapabilities;
  const capabilities = employee.plusCapabilities[roleKey] || [];

  const passed = capabilities.includes(customer.plusLevel);
  return {
    rule: 'Plus匹配',
    passed,
    message: passed
      ? `Plus匹配: ${customer.plusLevel}(${customer.plusCount}次)`
      : `Plus不匹配: 需要${customer.plusLevel}, 员工能力[${capabilities.join(',')}]`,
  };
}

export interface MatchOptions {
  /** 是否将 Plus 匹配计入合规，选择派单模式暂不要求 Plus */
  requirePlus?: boolean;
}

export function matchCustomerToEmployee(
  customer: Customer,
  employee: Employee,
  availableEmployeeNames: Set<string>,
  assignedCustomers: Customer[],
  options: MatchOptions = {}
): MatchResult {
  const requirePlus = options.requirePlus !== false;
  const details: MatchDetail[] = [
    checkCityMatch(customer, employee),
    checkRegionMatch(customer, employee),
    checkRoleMatch(customer, employee),
    checkTimeSlotMatch(customer, employee, assignedCustomers),
    checkDesignatedPerson(customer, employee, availableEmployeeNames),
    checkRejectedPerson(customer, employee),
    checkParkMatch(customer, employee),
    checkPlusMatch(customer, employee),
  ];

  const coreDetails = details.filter((d) => d.rule !== 'Plus匹配');
  const eligible = requirePlus ? details.every((d) => d.passed) : coreDetails.every((d) => d.passed);

  let score = 0;
  if (eligible) {
    score = 100;
    if (customer.designatedPerson === employee.name) score += 50;
    if (canDepartureServePark(employee.departureAddress, customer.parkName)) score += 10;

    const role = customerTypeToRole(customer.customerType);
    const caps = employee.plusCapabilities[role as keyof typeof employee.plusCapabilities] || [];
    if (customer.plusLevel === PlusLevel.PLUS_0 && caps.length === 2 && !caps.includes(PlusLevel.PLUS_N)) {
      score += 20;
    }
    if (customer.plusLevel === PlusLevel.PLUS_1 && caps.length === 2 && !caps.includes(PlusLevel.PLUS_N)) {
      score += 15;
    }

    score -= assignedCustomers.length * 5;
  }

  return { employee, score, details, eligible };
}

export function findEligibleEmployees(
  customer: Customer,
  employees: Employee[],
  assignments: Map<number, Customer[]>
): MatchResult[] {
  const availableNames = new Set(employees.map((e) => e.name));

  return employees
    .map((emp) => {
      const assigned = assignments.get(emp.id) || [];
      return matchCustomerToEmployee(customer, emp, availableNames, assigned);
    })
    .filter((r) => r.eligible)
    .sort((a, b) => b.score - a.score);
}

export function sortCustomersByPlusPriority(customers: Customer[]): Customer[] {
  const plusOrder = { [PlusLevel.PLUS_0]: 0, [PlusLevel.PLUS_1]: 1, [PlusLevel.PLUS_N]: 2 };
  return [...customers].sort((a, b) => {
    const plusDiff = plusOrder[a.plusLevel] - plusOrder[b.plusLevel];
    if (plusDiff !== 0) return plusDiff;
    return a.appointmentTime.getTime() - b.appointmentTime.getTime();
  });
}

/** 派单排序：指定人客户优先，再按 Plus 优先级 */
export function sortCustomersForDispatch(customers: Customer[]): Customer[] {
  const plusSorted = sortCustomersByPlusPriority(customers);
  const orderIndex = new Map(plusSorted.map((c, i) => [c.id, i]));
  return [...customers].sort((a, b) => {
    const aDes = a.designatedPerson ? 0 : 1;
    const bDes = b.designatedPerson ? 0 : 1;
    if (aDes !== bDes) return aDes - bDes;
    return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
  });
}

export function groupCustomersByDispatchType(customers: Customer[]): {
  frontProject: Customer[];
  back: Customer[];
} {
  return {
    frontProject: customers.filter((c) => isFrontOrProject(c.customerType)),
    back: customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP),
  };
}

export function groupEmployeesByRole(employees: Employee[]): {
  frontProject: Employee[];
  back: Employee[];
} {
  return {
    frontProject: employees.filter(
      (e) => e.roles.includes(EmployeeRole.FRONT) || e.roles.includes(EmployeeRole.PROJECT)
    ),
    back: employees.filter((e) => e.roles.includes(EmployeeRole.BACK) && !e.roles.includes(EmployeeRole.FRONT)),
  };
}

export function validateFrontProjectBalance(
  frontCustomers: Customer[],
  projectCustomers: Customer[],
  frontProjectEmployees: Employee[]
): { valid: boolean; message: string } {
  const morningFront = frontCustomers.filter((c) => c.timeSlot === TimeSlot.MORNING).length;
  const morningProject = projectCustomers.filter((c) => c.timeSlot === TimeSlot.MORNING).length;
  const afternoonFront = frontCustomers.filter((c) => c.timeSlot !== TimeSlot.MORNING).length;
  const afternoonProject = projectCustomers.filter((c) => c.timeSlot !== TimeSlot.MORNING).length;

  const morningEmp = frontProjectEmployees.filter((e) => e.orderCapacity.includes(TimeSlot.MORNING)).length;
  const afternoonEmp = frontProjectEmployees.filter(
    (e) => e.orderCapacity.includes(TimeSlot.AFTERNOON_1) || e.orderCapacity.includes(TimeSlot.AFTERNOON_2)
  ).length;

  const totalCustomers = frontCustomers.length + projectCustomers.length;
  const totalCapacity = frontProjectEmployees.reduce((sum, e) => sum + e.orderCapacity.length, 0);

  if (totalCustomers !== totalCapacity) {
    return {
      valid: false,
      message: `客户总数(${totalCustomers})与员工总容量(${totalCapacity})不一致`,
    };
  }

  return {
    valid: true,
    message: `前道: 上午${morningFront}单/下午${afternoonFront}单, 项目: 上午${morningProject}单/下午${afternoonProject}单, 员工: 上午${morningEmp}人/下午${afternoonEmp}人`,
  };
}
