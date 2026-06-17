import { EMPLOYEE_ROLE_LABELS, Employee, CUSTOMER_TYPE_LABELS, TIME_SLOT_LABELS } from '../types';
import { MAX_ACCEPTABLE_COMMUTE_MINUTES } from '../utils/commute';
import { SHOWCASE_TAG, IntegratedData } from '../data/integrated-data';
import { GAP_FILL_TAG } from '../data/gap-fill-employees';
import { ImportResult } from './excel-importer';
import { getIntegratedDataVersion } from './integrated-cache';

export function formatEmployee(emp: Employee) {
  const roleLabels = emp.roles.map((r) => EMPLOYEE_ROLE_LABELS[r]);
  const capacityLabels = emp.orderCapacity.map((s) => TIME_SLOT_LABELS[s]);
  return {
    id: emp.id,
    name: emp.name,
    roles: roleLabels,
    capacityLabels,
    tags: [...roleLabels, ...capacityLabels],
    orderCapacity: emp.orderCapacity,
    departureAddress: emp.departureAddress,
    remark: emp.remark,
  };
}

export function buildParseMetadata(
  data: ImportResult,
  options?: {
    showcaseCustomerIds?: number[];
    showcaseEmployeeIds?: number[];
    gapFillEmployeeIds?: number[];
    fullMatchCustomerIds?: number[];
  }
) {
  const scSet = new Set(options?.showcaseCustomerIds || []);
  const seSet = new Set(options?.showcaseEmployeeIds || []);
  const gfSet = new Set(options?.gapFillEmployeeIds || []);
  const parkByName = new Map(data.parks.map((p) => [p.name, p]));
  return {
    parks: data.parks.map((p) => ({
      id: p.id,
      name: p.name,
      cityName: p.cityName,
      address: p.address || '',
    })),
    companies: data.customers.map((c) => {
      const park = parkByName.get(c.parkName);
      return {
        id: c.id,
        companyName: c.companyName,
        address: c.address,
        parkName: c.parkName,
        parkAddress: park?.address || '',
        customerType: CUSTOMER_TYPE_LABELS[c.customerType],
        timeSlot: TIME_SLOT_LABELS[c.timeSlot],
        plusCount: c.plusCount,
        designatedPerson: c.designatedPerson,
        rejectedPerson: c.rejectedPerson,
        sourceTag: scSet.has(c.id) ? SHOWCASE_TAG : undefined,
      };
    }),
    employees: data.employees.map((emp) => {
      const park = parkByName.get(emp.serviceParkName);
      return {
        ...formatEmployee(emp),
        serviceParkName: emp.serviceParkName,
        serviceParkAddress: park?.address || '',
        sourceTag: seSet.has(emp.id) ? SHOWCASE_TAG : gfSet.has(emp.id) ? GAP_FILL_TAG : undefined,
      };
    }),
    stats: data.stats,
    totalCompanies: data.customers.length,
    totalEmployees: data.employees.length,
    showcaseCustomerIds: options?.showcaseCustomerIds || [],
    showcaseEmployeeIds: options?.showcaseEmployeeIds || [],
    gapFillEmployeeIds: options?.gapFillEmployeeIds || [],
    fullMatchCustomerIds: options?.fullMatchCustomerIds || [],
  };
}

/** 静态缓存 / 首屏 payload（不含 sessionId） */
export function buildSampleDataPayload(data: IntegratedData) {
  return {
    version: 2,
    dataVersion: getIntegratedDataVersion(),
    generatedAt: new Date().toISOString(),
    ...buildParseMetadata(data, {
      showcaseCustomerIds: data.showcaseCustomerIds,
      showcaseEmployeeIds: data.showcaseEmployeeIds,
      gapFillEmployeeIds: data.gapFillEmployeeIds,
      fullMatchCustomerIds: data.fullMatchCustomerIds,
    }),
    isSample: true,
    maxCommuteMinutes: MAX_ACCEPTABLE_COMMUTE_MINUTES,
    hint: `共 ${data.customers.length} 家公司、${data.employees.length} 名员工（含 ${data.showcaseCustomerIds.length} 家演示 + ${data.gapFillEmployeeIds.length} 名补位员工，支持全量匹配）`,
  };
}
