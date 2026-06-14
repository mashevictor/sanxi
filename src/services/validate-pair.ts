/**
 * 单条公司-员工配对校验（用于手动调整）
 */

import { CUSTOMER_TYPE_LABELS, TIME_SLOT_LABELS } from '../types';
import { ImportResult } from './excel-importer';
import { matchCustomerToEmployee } from './match-rules';
import { estimateRoute } from './distance-service';

export interface PairValidationResponse {
  eligible: boolean;
  customerId: number;
  employeeId: number;
  companyName: string;
  employeeName: string;
  address: string;
  parkName: string;
  customerType: string;
  timeSlot: string;
  departureAddress: string;
  score: number;
  commuteMinutes: number;
  route: {
    minutes: number;
    distanceKm?: number;
    pathSummary: string;
    source: 'deepseek' | 'local';
  };
  rules: { rule: string; passed: boolean; message: string }[];
  failedRules: { rule: string; message: string }[];
}

export async function validatePair(
  data: ImportResult,
  customerId: number,
  employeeId: number,
  existingPairings: { customerId: number; employeeId: number }[] = []
): Promise<PairValidationResponse> {
  const customer = data.customers.find((c) => c.id === customerId);
  const employee = data.employees.find((e) => e.id === employeeId);
  if (!customer) throw new Error('公司不存在');
  if (!employee) throw new Error('员工不存在');

  const assigned = existingPairings
    .filter((p) => p.employeeId === employeeId && p.customerId !== customerId)
    .map((p) => data.customers.find((c) => c.id === p.customerId))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const availableNames = new Set(data.employees.map((e) => e.name));
  const match = matchCustomerToEmployee(customer, employee, availableNames, assigned, {
    requirePlus: false,
  });
  const route = await estimateRoute(
    employee.departureAddress,
    customer.address,
    customer.parkName,
    customer.companyName
  );

  const rules = match.details.map((d) => ({
    rule: d.rule,
    passed: d.passed,
    message: d.message,
  }));
  const failedRules = rules.filter((r) => !r.passed && r.rule !== 'Plus匹配');

  return {
    eligible: match.eligible,
    customerId,
    employeeId,
    companyName: customer.companyName,
    employeeName: employee.name,
    address: customer.address,
    parkName: customer.parkName,
    customerType: CUSTOMER_TYPE_LABELS[customer.customerType],
    timeSlot: TIME_SLOT_LABELS[customer.timeSlot],
    departureAddress: employee.departureAddress,
    score: match.score,
    commuteMinutes: route.minutes,
    route,
    rules,
    failedRules,
  };
}
