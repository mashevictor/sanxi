/**
 * 生成整合数据缓存（原始样本 + 演示数据）
 * 运行: npm run cache:showcase
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData, SHOWCASE_TAG } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { CUSTOMER_TYPE_LABELS, TIME_SLOT_LABELS, EMPLOYEE_ROLE_LABELS } from '../src/types';

const DATA_DIR = path.join(__dirname, '..');

function formatEmployee(emp: ReturnType<typeof buildIntegratedData>['employees'][0], showcaseIds: Set<number>) {
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
    serviceParkName: emp.serviceParkName,
    serviceParkId: emp.serviceParkId,
    sourceTag: showcaseIds.has(emp.id) ? SHOWCASE_TAG : undefined,
  };
}

async function main() {
  const data = buildIntegratedData(DATA_DIR);
  const scSet = new Set(data.showcaseCustomerIds);
  const seSet = new Set(data.showcaseEmployeeIds);

  const dispatch = await dispatchSelectedCompanies(data, data.showcaseCustomerIds);

  const metadata = {
    isIntegrated: true,
    hint: `共 ${data.customers.length} 家公司、${data.employees.length} 名员工（含 ${data.showcaseCustomerIds.length} 家演示）`,
    showcaseCustomerIds: data.showcaseCustomerIds,
    showcaseEmployeeIds: data.showcaseEmployeeIds,
    companies: data.customers.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      address: c.address,
      parkName: c.parkName,
      customerType: CUSTOMER_TYPE_LABELS[c.customerType],
      timeSlot: TIME_SLOT_LABELS[c.timeSlot],
      plusCount: c.plusCount,
      sourceTag: scSet.has(c.id) ? SHOWCASE_TAG : undefined,
    })),
    employees: data.employees.map((e) => formatEmployee(e, seSet)),
    stats: data.stats,
    totalCompanies: data.customers.length,
    totalEmployees: data.employees.length,
    maxCommuteMinutes: 60,
  };

  const root = path.join(__dirname, '..');
  fs.writeFileSync(path.join(root, '_integrated.json'), JSON.stringify(metadata, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(root, '_showcase_match.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        showcaseOnly: true,
        stats: dispatch.stats,
        message: dispatch.message,
        pairings: dispatch.pairings,
        unmatchedCompanies: dispatch.unmatchedCompanies,
        employeeSchedules: dispatch.employeeSchedules,
      },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`✓ _integrated.json (${metadata.totalCompanies} 公司, ${metadata.totalEmployees} 员工)`);
  console.log(`  原始 ${metadata.totalCompanies - data.showcaseCustomerIds.length} + 演示 ${data.showcaseCustomerIds.length}`);
  console.log(`✓ _showcase_match.json (${dispatch.stats.matched}/${dispatch.stats.selected} 演示匹配)`);
  console.log(dispatch.message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
