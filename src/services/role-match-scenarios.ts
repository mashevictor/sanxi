/**
 * 前道 / 后道各 5 组生产数据测试方案（Excel 整合 + 员工补丁后）
 */

import { buildIntegratedData, IntegratedData } from '../data/integrated-data';
import { CustomerType, EmployeeRole, TimeSlot } from '../types';

export const JINSHAN_PARK = '加盟-金山资本现代产业园';
export const BAOSHAN_PARK = '宝山高新';

/** 手动派单截图常用 15 人（id 7–20 + 吴佳键） */
export const MANUAL_JINSHAN_BACK_POOL = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22];

export interface RoleScenarioDef {
  id: string;
  name: string;
  description: string;
  roleCategory: '前道' | '后道';
  customerIds: (data: IntegratedData) => number[];
  employeePoolIds?: (data: IntegratedData) => number[];
  expectMatched?: (data: IntegratedData, customerIds: number[]) => number;
  expectUnmatched?: (data: IntegratedData, customerIds: number[]) => number;
  minEmployeesWithThreePlus?: number;
}

function idsOf(
  data: IntegratedData,
  filter: (c: IntegratedData['customers'][0]) => boolean
): number[] {
  return data.customers.filter(filter).map((c) => c.id);
}

function frontPool(data: IntegratedData): number[] {
  return data.employees.filter((e) => e.roles.includes(EmployeeRole.FRONT)).map((e) => e.id);
}

function backPool(data: IntegratedData): number[] {
  return data.employees.filter((e) => e.roles.includes(EmployeeRole.BACK)).map((e) => e.id);
}

export function buildRoleScenarioDefs(data: IntegratedData): RoleScenarioDef[] {
  const jinshanFollowUp = (c: (typeof data.customers)[0]) =>
    c.parkName === JINSHAN_PARK && c.customerType === CustomerType.FOLLOW_UP;
  const jinshanFirst = (c: (typeof data.customers)[0]) =>
    c.parkName === JINSHAN_PARK && c.customerType === CustomerType.FIRST_VISIT;
  const baoshanFollowUp = (c: (typeof data.customers)[0]) =>
    c.parkName === BAOSHAN_PARK && c.customerType === CustomerType.FOLLOW_UP;

  return [
    // —— 前道 ×5 ——
    {
      id: 'front-jinshan-all',
      name: '前道 · 金山首访全量',
      description: '加盟-金山资本现代产业园全部首访客户，员工池限定前道',
      roleCategory: '前道',
      customerIds: (d) => idsOf(d, jinshanFirst),
      employeePoolIds: frontPool,
    },
    {
      id: 'front-all-slots',
      name: '前道 · 三时段首访',
      description: '金山首访按上午/下午1/下午2各选客户，验证前道时段容量',
      roleCategory: '前道',
      customerIds: (d) => {
        const list = d.customers.filter(jinshanFirst);
        const pick = (slot: TimeSlot) => list.find((c) => c.timeSlot === slot)?.id;
        return [pick(TimeSlot.MORNING), pick(TimeSlot.AFTERNOON_1), pick(TimeSlot.AFTERNOON_2)].filter(
          (id): id is number => id != null
        );
      },
      employeePoolIds: frontPool,
    },
    {
      id: 'front-afternoon2',
      name: '前道 · 金山下午2首访',
      description: '仅下午2时段金山首访（如喜福来），需前道员工含下午2档',
      roleCategory: '前道',
      customerIds: (d) =>
        idsOf(d, (c) => jinshanFirst(c) && c.timeSlot === TimeSlot.AFTERNOON_2),
      employeePoolIds: frontPool,
    },
    {
      id: 'front-regional',
      name: '前道 · 外埠园区首访',
      description: '镇江/济南等外埠园区首访客户 + 前道员工池',
      roleCategory: '前道',
      customerIds: (d) =>
        idsOf(
          d,
          (c) =>
            c.customerType === CustomerType.FIRST_VISIT &&
            (c.parkName.includes('镇江') || c.parkName.includes('济南'))
        ),
      employeePoolIds: frontPool,
    },
    {
      id: 'front-all-first',
      name: '前道 · 全量首访',
      description: 'Excel 整合数据全部首访客户 + 前道员工池',
      roleCategory: '前道',
      customerIds: (d) => idsOf(d, (c) => c.customerType === CustomerType.FIRST_VISIT),
      employeePoolIds: frontPool,
    },
    // —— 后道 ×5 ——
    {
      id: 'back-jinshan-32-manual15',
      name: '后道 · 金山32家+15人池',
      description: '金山回访32家 + 截图15人后道员工池，补丁后应 32/32',
      roleCategory: '后道',
      customerIds: (d) => idsOf(d, jinshanFollowUp),
      employeePoolIds: () => MANUAL_JINSHAN_BACK_POOL,
      expectMatched: (d, ids) => ids.length,
      expectUnmatched: () => 0,
    },
    {
      id: 'back-jinshan-morning',
      name: '后道 · 金山上午15家',
      description: '金山回访仅上午时段15家 + 15人池',
      roleCategory: '后道',
      customerIds: (d) =>
        idsOf(d, (c) => jinshanFollowUp(c) && c.timeSlot === TimeSlot.MORNING),
      employeePoolIds: () => MANUAL_JINSHAN_BACK_POOL,
      expectMatched: (d, ids) => ids.length,
    },
    {
      id: 'back-jinshan-afternoon',
      name: '后道 · 金山下午17家',
      description: '金山回访下午1+下午2共17家 + 15人池（一人多单）',
      roleCategory: '后道',
      customerIds: (d) =>
        idsOf(
          d,
          (c) =>
            jinshanFollowUp(c) &&
            (c.timeSlot === TimeSlot.AFTERNOON_1 || c.timeSlot === TimeSlot.AFTERNOON_2)
        ),
      employeePoolIds: () => MANUAL_JINSHAN_BACK_POOL,
      expectMatched: (d, ids) => ids.length,
    },
    {
      id: 'back-baoshan-follow',
      name: '后道 · 宝山高新回访',
      description: '宝山高新全部回访客户 + 后道全员池',
      roleCategory: '后道',
      customerIds: (d) => idsOf(d, baoshanFollowUp),
      employeePoolIds: backPool,
    },
    {
      id: 'back-multi-order',
      name: '后道 · 金山多单分工',
      description: '金山32家 + 15人池，验证至少2名员工接满3单（上午+下午1+下午2）',
      roleCategory: '后道',
      customerIds: (d) => idsOf(d, jinshanFollowUp),
      employeePoolIds: () => MANUAL_JINSHAN_BACK_POOL,
      expectMatched: (d, ids) => ids.length,
      minEmployeesWithThreePlus: 2,
    },
  ];
}
