/**
 * 派单引擎核心
 * 整合匹配规则、距离优化、牵手单处理
 */

import {
  Customer,
  Employee,
  DispatchResult,
  DispatchBatch,
  DispatchStatistics,
  DispatchConfig,
  DispatchContext,
  DEFAULT_DISPATCH_CONFIG,
  FrontProjectMode,
  CustomerType,
  TimeSlot,
  MatchDetail,
  CUSTOMER_TYPE_LABELS,
  TIME_SLOT_LABELS,
} from '../types';
import {
  findEligibleEmployees,
  sortCustomersByPlusPriority,
  groupCustomersByDispatchType,
  groupEmployeesByRole,
  validateFrontProjectBalance,
  MatchResult,
} from './match-rules';
import { calculateDailyCommute, estimateCommuteMinutes } from '../utils/commute';
import { isFrontOrProject } from '../utils/parsers';

export class DispatchEngine {
  private config: DispatchConfig;

  constructor(config: Partial<DispatchConfig> = {}) {
    this.config = { ...DEFAULT_DISPATCH_CONFIG, ...config };
  }

  /** 执行派单 */
  dispatch(customers: Customer[], employees: Employee[]): DispatchBatch {
    const activeEmployees = employees.filter((e) => e.status === 'ACTIVE');

    const ctx: DispatchContext = {
      customers,
      employees: activeEmployees,
      config: this.config,
      assignments: new Map(),
      pendingCustomers: [...customers],
      availableEmployees: [...activeEmployees],
      results: [],
    };

    for (const emp of activeEmployees) {
      ctx.assignments.set(emp.id, []);
    }

    const { frontProject, back } = groupCustomersByDispatchType(customers);
    const { frontProject: fpEmployees, back: backEmployees } = groupEmployeesByRole(activeEmployees);

    const frontCustomers = frontProject.filter((c) => c.customerType === CustomerType.FIRST_VISIT);
    const projectCustomers = frontProject.filter((c) => c.customerType === CustomerType.PROJECT);

    if (frontCustomers.length > 0 || projectCustomers.length > 0) {
      const validation = validateFrontProjectBalance(frontCustomers, projectCustomers, fpEmployees);
      if (!validation.valid) {
        console.warn(`[派单警告] 前道+项目: ${validation.message}`);
      }
      this.dispatchFrontProject(ctx, frontProject, fpEmployees);
    }

    if (back.length > 0) {
      this.dispatchBack(ctx, back, backEmployees);
    }

    const statistics = this.calculateStatistics(ctx.results, customers);

    return {
      id: 1,
      batchDate: new Date(),
      frontProjectMode: this.config.frontProjectMode,
      totalCustomers: customers.length,
      totalEmployees: activeEmployees.length,
      results: ctx.results,
      statistics,
    };
  }

  /** 前道+项目合并派单 */
  private dispatchFrontProject(
    ctx: DispatchContext,
    customers: Customer[],
    employees: Employee[]
  ): void {
    const handInHandGroups = this.groupHandInHand(customers);
    const regularCustomers = customers.filter((c) => !c.isHandInHand);
    const sorted = sortCustomersByPlusPriority(regularCustomers);

    for (const [, groupCustomers] of handInHandGroups) {
      this.assignHandInHandGroup(ctx, groupCustomers, employees);
    }

    for (const customer of sorted) {
      if (ctx.results.some((r) => r.customerId === customer.id)) continue;
      this.assignCustomer(ctx, customer, employees);
    }
  }

  /** 后道单独派单 */
  private dispatchBack(ctx: DispatchContext, customers: Customer[], employees: Employee[]): void {
    const handInHandGroups = this.groupHandInHand(customers);
    const regularCustomers = customers.filter((c) => !c.isHandInHand);
    const sorted = sortCustomersByPlusPriority(regularCustomers);

    for (const [, groupCustomers] of handInHandGroups) {
      this.assignHandInHandGroup(ctx, groupCustomers, employees);
    }

    for (const customer of sorted) {
      if (ctx.results.some((r) => r.customerId === customer.id)) continue;
      this.assignCustomer(ctx, customer, employees);
    }
  }

  /** 分配单个客户 */
  private assignCustomer(
    ctx: DispatchContext,
    customer: Customer,
    candidateEmployees: Employee[]
  ): boolean {
    const eligible = findEligibleEmployees(customer, candidateEmployees, ctx.assignments);

    if (eligible.length === 0) {
      console.warn(`[派单失败] 客户 ${customer.companyName} 无匹配员工`);
      return false;
    }

    let bestMatch = eligible[0];

    if (this.config.enableDistanceOptimization) {
      bestMatch = this.optimizeByCommute(customer, eligible, ctx);
    }

    const employee = bestMatch.employee;
    const assigned = ctx.assignments.get(employee.id) || [];
    assigned.push(customer);
    ctx.assignments.set(employee.id, assigned);

    const commute = assigned.length === 1
      ? estimateCommuteMinutes(employee.departureAddress, customer.address)
      : estimateCommuteMinutes(assigned[assigned.length - 2].address, customer.address);

    ctx.results.push({
      customerId: customer.id,
      customerName: customer.companyName,
      employeeId: employee.id,
      employeeName: employee.name,
      timeSlot: customer.timeSlot,
      customerType: customer.customerType,
      commuteMinutes: commute,
      matchScore: bestMatch.score,
      matchDetails: bestMatch.details,
    });

    customer.dispatchStatus = 'ASSIGNED' as Customer['dispatchStatus'];
    return true;
  }

  /** 牵手单整组分配 */
  private assignHandInHandGroup(
    ctx: DispatchContext,
    groupCustomers: Customer[],
    candidateEmployees: Employee[]
  ): boolean {
    if (groupCustomers.length === 0) return false;

    const firstCustomer = groupCustomers[0];
    const eligible = findEligibleEmployees(firstCustomer, candidateEmployees, ctx.assignments);

    if (eligible.length === 0) {
      console.warn(`[牵手单失败] 组 ${firstCustomer.handInHandGroup} 无匹配员工`);
      return false;
    }

    const employee = eligible[0].employee;

    for (const customer of groupCustomers) {
      const assigned = ctx.assignments.get(employee.id) || [];
      assigned.push(customer);
      ctx.assignments.set(employee.id, assigned);

      ctx.results.push({
        customerId: customer.id,
        customerName: customer.companyName,
        employeeId: employee.id,
        employeeName: employee.name,
        timeSlot: customer.timeSlot,
        customerType: customer.customerType,
        commuteMinutes: 0,
        matchScore: eligible[0].score,
        matchDetails: [
          ...eligible[0].details,
          { rule: '牵手单', passed: true, message: `牵手单组 ${customer.handInHandGroup}` },
        ],
      });

      customer.dispatchStatus = 'ASSIGNED' as Customer['dispatchStatus'];
    }

    return true;
  }

  /** 按通勤时间优化选择 */
  private optimizeByCommute(
    customer: Customer,
    eligible: { employee: Employee; score: number; details: MatchDetail[] }[],
    ctx: DispatchContext
  ): MatchResult {
    let best = eligible[0];
    let bestCommute = Infinity;

    for (const match of eligible) {
      const assigned = ctx.assignments.get(match.employee.id) || [];
      const fromAddress = assigned.length > 0
        ? assigned[assigned.length - 1].address
        : match.employee.departureAddress;

      const commute = estimateCommuteMinutes(fromAddress, customer.address);

      if (assigned.length > 0) {
        const daily = calculateDailyCommute(match.employee, [...assigned, customer]);
        if (daily.totalMinutes > this.config.maxTotalCommuteMinutes) continue;
      } else {
        const maxSingle = customer.timeSlot === TimeSlot.MORNING
          ? this.config.maxMorningCommuteMinutes
          : this.config.maxAfternoonCommuteMinutes;
        if (commute > maxSingle) continue;
      }

      if (commute < bestCommute) {
        bestCommute = commute;
        best = match;
      }
    }

    return { ...best, eligible: true };
  }
  private groupHandInHand(customers: Customer[]): Map<string, Customer[]> {
    const groups = new Map<string, Customer[]>();
    for (const c of customers.filter((c) => c.isHandInHand && c.handInHandGroup)) {
      const key = c.handInHandGroup!;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return groups;
  }

  /** 计算派单统计 */
  private calculateStatistics(results: DispatchResult[], allCustomers: Customer[]): DispatchStatistics {
    const byTimeSlot: Record<TimeSlot, number> = {
      [TimeSlot.MORNING]: 0,
      [TimeSlot.AFTERNOON_1]: 0,
      [TimeSlot.AFTERNOON_2]: 0,
    };
    const byCustomerType: Record<CustomerType, number> = {
      [CustomerType.FIRST_VISIT]: 0,
      [CustomerType.PROJECT]: 0,
      [CustomerType.FOLLOW_UP]: 0,
    };

    let totalCommute = 0;
    let maxCommute = 0;

    for (const r of results) {
      byTimeSlot[r.timeSlot]++;
      byCustomerType[r.customerType]++;
      if (r.commuteMinutes) {
        totalCommute += r.commuteMinutes;
        maxCommute = Math.max(maxCommute, r.commuteMinutes);
      }
    }

    const handInHandGroups = new Set(
      allCustomers.filter((c) => c.handInHandGroup).map((c) => c.handInHandGroup)
    ).size;

    return {
      totalAssigned: results.length,
      byTimeSlot,
      byCustomerType,
      avgCommuteMinutes: results.length > 0 ? Math.round(totalCommute / results.length) : 0,
      maxCommuteMinutes: maxCommute,
      handInHandGroups,
    };
  }
}

/** 格式化派单结果为可读文本 */
export function formatDispatchReport(batch: DispatchBatch): string {
  const lines: string[] = [
    '═══════════════════════════════════════════',
    '           派 单 结 果 报 告',
    '═══════════════════════════════════════════',
    `派单日期: ${batch.batchDate.toLocaleDateString('zh-CN')}`,
    `派单模式: ${batch.frontProjectMode}`,
    `客户总数: ${batch.totalCustomers}  员工总数: ${batch.totalEmployees}`,
    `成功派单: ${batch.statistics.totalAssigned}`,
    '',
    '── 按类型统计 ──',
    `  首访(前道): ${batch.statistics.byCustomerType[CustomerType.FIRST_VISIT]} 单`,
    `  项目:       ${batch.statistics.byCustomerType[CustomerType.PROJECT]} 单`,
    `  回访(后道): ${batch.statistics.byCustomerType[CustomerType.FOLLOW_UP]} 单`,
    '',
    '── 按时段统计 ──',
    `  上午:   ${batch.statistics.byTimeSlot[TimeSlot.MORNING]} 单`,
    `  下午1:  ${batch.statistics.byTimeSlot[TimeSlot.AFTERNOON_1]} 单`,
    `  下午2:  ${batch.statistics.byTimeSlot[TimeSlot.AFTERNOON_2]} 单`,
    '',
    `平均通勤: ${batch.statistics.avgCommuteMinutes} 分钟`,
    `最大通勤: ${batch.statistics.maxCommuteMinutes} 分钟`,
    `牵手单组: ${batch.statistics.handInHandGroups} 组`,
    '',
    '── 派单明细 ──',
  ];

  const byEmployee = new Map<string, DispatchResult[]>();
  for (const r of batch.results) {
    if (!byEmployee.has(r.employeeName)) byEmployee.set(r.employeeName, []);
    byEmployee.get(r.employeeName)!.push(r);
  }

  for (const [empName, results] of byEmployee) {
    lines.push(`\n【${empName}】`);
    for (const r of results.sort((a, b) => {
      const order = { MORNING: 0, AFTERNOON_1: 1, AFTERNOON_2: 2 };
      return order[a.timeSlot] - order[b.timeSlot];
    })) {
      lines.push(
        `  ${TIME_SLOT_LABELS[r.timeSlot]} | ${CUSTOMER_TYPE_LABELS[r.customerType]} | ${r.customerName}` +
        (r.commuteMinutes ? ` | 通勤${r.commuteMinutes}分钟` : '')
      );
    }
  }

  lines.push('\n═══════════════════════════════════════════');
  return lines.join('\n');
}
