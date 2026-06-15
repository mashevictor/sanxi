/**
 * 整合数据：保留 Excel 原始样本 + 追加演示数据（带标签）
 */

import { importAllData, ImportResult } from '../services/excel-importer';
import { buildShowcaseData } from './showcase-data';
import {
  applyEmployeePatches,
  buildGapFillEmployees,
  getGapFillEmployeeIds,
  GAP_FILL_TAG,
} from './gap-fill-employees';
import { Customer, Employee, CustomerType } from '../types';

export const SHOWCASE_TAG = '演示';

/** 固定 ID，确保各环境（有无 Excel）缓存一致 */
export const SHOWCASE_EMPLOYEE_IDS = [90001, 90002, 90003, 90004, 90005];
export const SHOWCASE_CUSTOMER_ID_BASE = 90100;

export interface IntegratedData extends ImportResult {
  showcaseCustomerIds: number[];
  showcaseEmployeeIds: number[];
  gapFillEmployeeIds: number[];
  fullMatchCustomerIds: number[];
}

export function buildIntegratedData(dataDir: string): IntegratedData {
  const base = importAllData(dataDir);
  const showcase = buildShowcaseData();

  const parkIdByName = new Map(base.parks.map((p) => [p.name, p.id]));
  let nextParkId = Math.max(0, ...base.parks.map((p) => p.id)) + 1;
  for (const sp of showcase.parks) {
    if (!parkIdByName.has(sp.name)) {
      const park = { ...sp, id: nextParkId++ };
      base.parks.push(park);
      parkIdByName.set(sp.name, park.id);
    }
  }

  const maxEmpId = Math.max(0, ...base.employees.map((e) => e.id));
  const showcaseEmployeeIds: number[] = [];

  const mergedEmployees: Employee[] = [...base.employees];
  showcase.employees.forEach((se, idx) => {
    const newId = SHOWCASE_EMPLOYEE_IDS[idx] ?? maxEmpId + idx + 1;
    showcaseEmployeeIds.push(newId);
    const parkId = parkIdByName.get(se.serviceParkName || '') || se.serviceParkId;
    mergedEmployees.push({
      ...se,
      id: newId,
      serviceParkId: parkId,
      remark: se.remark ? `${se.remark} [${SHOWCASE_TAG}]` : `[${SHOWCASE_TAG}]`,
    });
  });

  const existingCustomerIds = new Set(base.customers.map((c) => c.id));
  const showcaseCustomerIds: number[] = [];

  const mergedCustomers: Customer[] = [...base.customers];
  showcase.customers.forEach((sc, idx) => {
    let newId = SHOWCASE_CUSTOMER_ID_BASE + (sc.id - 100);
    if (newId <= SHOWCASE_CUSTOMER_ID_BASE) newId = SHOWCASE_CUSTOMER_ID_BASE + idx + 1;
    while (existingCustomerIds.has(newId)) newId++;
    existingCustomerIds.add(newId);
    showcaseCustomerIds.push(newId);
    const parkId = parkIdByName.get(sc.parkName) || sc.parkId;
    mergedCustomers.push({ ...sc, id: newId, parkId });
  });

  const showcaseFirst = showcase.customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length;
  const showcaseProject = showcase.customers.filter((c) => c.customerType === CustomerType.PROJECT).length;
  const showcaseFollow = showcase.customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length;

  const gapFillEmployees = buildGapFillEmployees(parkIdByName);
  const gapFillEmployeeIds = getGapFillEmployeeIds();
  const patchedEmployees = applyEmployeePatches([...mergedEmployees, ...gapFillEmployees]);

  return {
    parks: base.parks,
    customers: mergedCustomers,
    employees: patchedEmployees,
    cities: [...new Set([...base.cities, ...showcase.cities])],
    stats: {
      firstVisitCount: base.stats.firstVisitCount + showcaseFirst,
      projectCount: base.stats.projectCount + showcaseProject,
      followUpCount: base.stats.followUpCount + showcaseFollow,
      employeeCount: patchedEmployees.length,
      handInHandGroups: base.stats.handInHandGroups,
    },
    showcaseCustomerIds,
    showcaseEmployeeIds,
    gapFillEmployeeIds,
    fullMatchCustomerIds: mergedCustomers.map((c) => c.id),
  };
}

/** 仅演示数据 + 固定 ID，用于生成跨环境一致的匹配缓存 */
export function buildShowcaseSnapshot(): IntegratedData {
  const raw = buildShowcaseData();
  const showcaseEmployeeIds: number[] = [];
  const showcaseCustomerIds: number[] = [];

  const employees = raw.employees.map((e, idx) => {
    const id = SHOWCASE_EMPLOYEE_IDS[idx];
    showcaseEmployeeIds.push(id);
    return {
      ...e,
      id,
      remark: e.remark ? `${e.remark} [${SHOWCASE_TAG}]` : `[${SHOWCASE_TAG}]`,
    };
  });

  const customers = raw.customers.map((c, idx) => {
    const id = SHOWCASE_CUSTOMER_ID_BASE + idx + 1;
    showcaseCustomerIds.push(id);
    return { ...c, id };
  });

  return {
    parks: raw.parks,
    customers,
    employees,
    cities: raw.cities,
    stats: raw.stats,
    showcaseCustomerIds,
    showcaseEmployeeIds,
    gapFillEmployeeIds: [],
    fullMatchCustomerIds: customers.map((c) => c.id),
  };
}
