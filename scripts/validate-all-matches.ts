/**
 * 全量匹配结果合理性校验
 * 运行: npm run validate:matches
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import { CUSTOMER_TYPE_LABELS, TIME_SLOT_LABELS } from '../src/types';

const DATA_DIR = path.join(__dirname, '..');
const CORE_RULES = ['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配'];
const MAX_COMMUTE = 60;

interface Issue {
  level: 'error' | 'warn' | 'info';
  company: string;
  employee: string;
  message: string;
}

async function main() {
  const data = buildIntegratedData(DATA_DIR);
  const ids = data.fullMatchCustomerIds;
  const result = await dispatchSelectedCompanies(data, ids);

  const issues: Issue[] = [];
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const employeeById = new Map(data.employees.map((e) => [e.id, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));

  console.log(`\n=== 全量匹配合理性校验 (${ids.length} 家) ===\n`);
  console.log(`匹配: ${result.stats.matched}/${result.stats.selected}  未匹配: ${result.unmatchedCompanies.length}`);

  if (result.unmatchedCompanies.length) {
    for (const u of result.unmatchedCompanies) {
      issues.push({ level: 'error', company: u.companyName, employee: '—', message: `未匹配: ${u.reason}` });
    }
  }

  const assignments = new Map<number, number[]>();
  for (const p of result.pairings) {
    const list = assignments.get(p.employeeId) || [];
    list.push(p.customerId);
    assignments.set(p.employeeId, list);
  }

  for (const p of result.pairings) {
    const customer = customerById.get(p.customerId);
    const employee = employeeById.get(p.employeeId);
    if (!customer || !employee) {
      issues.push({
        level: 'error',
        company: p.companyName,
        employee: p.employeeName,
        message: '客户或员工 ID 不存在',
      });
      continue;
    }

    const otherIds = (assignments.get(p.employeeId) || []).filter((id) => id !== p.customerId);
    const assignedOthers = otherIds
      .map((id) => customerById.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c);

    const match = matchCustomerToEmployee(customer, employee, availableNames, assignedOthers, {
      requirePlus: false,
    });

    const failedCore = match.details.filter((d) => CORE_RULES.includes(d.rule) && !d.passed);
    if (!match.eligible || failedCore.length) {
      issues.push({
        level: 'error',
        company: customer.companyName,
        employee: employee.name,
        message: `规则不合规: ${failedCore.map((d) => `${d.rule}(${d.message})`).join('; ')}`,
      });
    }

    if (p.commuteMinutes > MAX_COMMUTE) {
      const designatedOk = customer.designatedPerson === employee.name;
      issues.push({
        level: designatedOk ? 'info' : 'warn',
        company: customer.companyName,
        employee: employee.name,
        message: designatedOk
          ? `指定人单通勤 ${p.commuteMinutes} 分（指定人优先，合理）`
          : `通勤 ${p.commuteMinutes} 分超过 ${MAX_COMMUTE} 分上限（软约束，仍合规）`,
      });
    }

    if (customer.designatedPerson && customer.designatedPerson !== employee.name) {
      const desEmp = data.employees.find((e) => e.name === customer.designatedPerson);
      if (desEmp) {
        issues.push({
          level: 'error',
          company: customer.companyName,
          employee: employee.name,
          message: `指定人应为「${customer.designatedPerson}」，实际派给「${employee.name}」`,
        });
      }
    }
  }

  for (const [empId, custIds] of assignments) {
    const employee = employeeById.get(empId);
    if (!employee) continue;
    const slotMap = new Map<string, string[]>();
    for (const cid of custIds) {
      const c = customerById.get(cid);
      if (!c) continue;
      const slot = TIME_SLOT_LABELS[c.timeSlot];
      const arr = slotMap.get(slot) || [];
      arr.push(c.companyName);
      slotMap.set(slot, arr);
    }
    for (const [slot, companies] of slotMap) {
      if (companies.length > 1) {
        issues.push({
          level: 'error',
          company: companies.join(' + '),
          employee: employee.name,
          message: `同时段冲突: ${slot} 被派了 ${companies.length} 单`,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const infos = issues.filter((i) => i.level === 'info');

  console.log(`\n核心规则复核: ${result.pairings.length - errors.length}/${result.pairings.length} 合规`);
  console.log(`错误: ${errors.length}  警告: ${warns.length}  说明: ${infos.length}`);

  if (errors.length) {
    console.log('\n--- 不合规明细 ---');
    errors.forEach((e, i) => {
      console.log(`${i + 1}. [${e.company}] → ${e.employee}: ${e.message}`);
    });
  }
  if (warns.length) {
    console.log('\n--- 警告（通勤超限等）---');
    warns.slice(0, 15).forEach((w, i) => {
      console.log(`${i + 1}. [${w.company}] → ${w.employee}: ${w.message}`);
    });
    if (warns.length > 15) console.log(`... 另有 ${warns.length - 15} 条警告`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    total: result.pairings.length,
    matched: result.stats.matched,
    unmatched: result.unmatchedCompanies.length,
    errors: errors.length,
    warnings: warns.length,
    allReasonable: errors.length === 0 && result.unmatchedCompanies.length === 0,
    issues,
    pairings: result.pairings.map((p) => ({
      company: p.companyName,
      employee: p.employeeName,
      type: p.customerType,
      slot: p.timeSlot,
      commute: p.commuteMinutes,
      corePass: (p.rules || []).filter((r) => CORE_RULES.includes(r.rule) && r.passed).length,
    })),
  };

  const outPath = path.join(DATA_DIR, 'public', 'cache', 'validate-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n报告已写入 public/cache/validate-report.json`);

  if (errors.length || result.unmatchedCompanies.length) {
    console.log('\n✗ 存在不合理匹配，需补充模拟员工或修正数据');
    process.exit(1);
  }
  console.log('\n✓ 全部 55 条匹配结果合理（6 项核心规则 + 时段无冲突）');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
