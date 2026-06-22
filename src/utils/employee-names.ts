import { Employee } from '../types';

export interface DuplicateNameGroup {
  name: string;
  employees: { id: number; remark?: string; sourceTag?: string }[];
}

/** 找出姓名重复的员工（trim 后精确匹配） */
export function findDuplicateEmployeeNames(employees: Employee[]): DuplicateNameGroup[] {
  const byName = new Map<string, DuplicateNameGroup['employees']>();
  for (const e of employees) {
    const name = e.name.trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ id: e.id, remark: e.remark });
  }
  return [...byName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, employees: list }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function formatDuplicateNamesError(groups: DuplicateNameGroup[]): string {
  const detail = groups
    .map((g) => `「${g.name}」(${g.employees.map((e) => `id=${e.id}`).join('、')})`)
    .join('；');
  return `员工姓名不能重复：${detail}`;
}

/** 整合数据构建时校验：Excel + 演示 + 补位 全员姓名唯一 */
export function assertUniqueEmployeeNames(employees: Employee[]): void {
  const dups = findDuplicateEmployeeNames(employees);
  if (dups.length) throw new Error(formatDuplicateNamesError(dups));
}

/** 手动选池校验：所选员工姓名不能重复 */
export function validateEmployeePoolNames(employees: Employee[]): string | null {
  const dups = findDuplicateEmployeeNames(employees);
  return dups.length ? formatDuplicateNamesError(dups) : null;
}
