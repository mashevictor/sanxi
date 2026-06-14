/**
 * 整合数据：保留 Excel 原始样本 + 追加演示数据（带标签）
 */

import { importAllData, ImportResult } from '../services/excel-importer';
import { buildShowcaseData } from './showcase-data';
import { Customer, Employee, CustomerType } from '../types';

export const SHOWCASE_TAG = '演示';

export interface IntegratedData extends ImportResult {
  showcaseCustomerIds: number[];
  showcaseEmployeeIds: number[];
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
  const showcaseEmpIdMap = new Map<number, number>();

  const mergedEmployees: Employee[] = [...base.employees];
  showcase.employees.forEach((se, idx) => {
    const newId = maxEmpId + idx + 1;
    showcaseEmpIdMap.set(se.id, newId);
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
  let nextCustomerId = Math.max(0, ...base.customers.map((c) => c.id)) + 1;

  const mergedCustomers: Customer[] = [...base.customers];
  for (const sc of showcase.customers) {
    let newId = sc.id;
    if (existingCustomerIds.has(newId)) {
      newId = nextCustomerId++;
    }
    existingCustomerIds.add(newId);
    showcaseCustomerIds.push(newId);
    const parkId = parkIdByName.get(sc.parkName) || sc.parkId;
    mergedCustomers.push({ ...sc, id: newId, parkId });
  }

  const showcaseFirst = showcase.customers.filter((c) => c.customerType === CustomerType.FIRST_VISIT).length;
  const showcaseProject = showcase.customers.filter((c) => c.customerType === CustomerType.PROJECT).length;
  const showcaseFollow = showcase.customers.filter((c) => c.customerType === CustomerType.FOLLOW_UP).length;

  return {
    parks: base.parks,
    customers: mergedCustomers,
    employees: mergedEmployees,
    cities: [...new Set([...base.cities, ...showcase.cities])],
    stats: {
      firstVisitCount: base.stats.firstVisitCount + showcaseFirst,
      projectCount: base.stats.projectCount + showcaseProject,
      followUpCount: base.stats.followUpCount + showcaseFollow,
      employeeCount: mergedEmployees.length,
      handInHandGroups: base.stats.handInHandGroups,
    },
    showcaseCustomerIds,
    showcaseEmployeeIds,
  };
}
