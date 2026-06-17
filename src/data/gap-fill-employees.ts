/**
 * 补位员工：保证 55 家公司全量可匹配（含下午2时段、外埠园区、指定人）
 */

import {
  Employee,
  EmployeeRole,
  EmployeeStatus,
  TimeSlot,
  PlusLevel,
  PlusCapabilities,
  Customer,
} from '../types';

export const GAP_FILL_TAG = '补位';
export const GAP_FILL_EMPLOYEE_ID_START = 90201;

const FULL_PLUS: PlusCapabilities = {
  BACK: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
  FRONT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
  PROJECT: [PlusLevel.PLUS_0, PlusLevel.PLUS_1, PlusLevel.PLUS_N],
};

const ALL_SLOTS = [TimeSlot.MORNING, TimeSlot.AFTERNOON_1, TimeSlot.AFTERNOON_2];

const PARK_DEPARTURES: Record<string, string> = {
  '加盟-金山资本现代产业园': '上海市金山区亭林镇',
  '宝山高新': '上海市宝山区淞发路',
  '山东济南': '山东省济南市历下区经十路',
  '江苏徐州': '江苏省徐州市云龙区淮海路',
  '江苏镇江': '江苏省镇江市京口区中山东路',
};

interface GapTemplate {
  name: string;
  park: string;
  roles: EmployeeRole[];
  slots: TimeSlot[];
  departure?: string;
}

const GAP_TEMPLATES: GapTemplate[] = [
  // 下午2 — 金山后道
  { name: '补位-韩金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-孙金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-周金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-吴金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-郑金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-冯金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-陈金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  // 下午2 — 金山后道（加 1 人兜底指定人冲突）
  { name: '补位-朱金山', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-卫金山前', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.FRONT], slots: [TimeSlot.AFTERNOON_2] },
  // 下午2 — 宝山后道
  { name: '补位-蒋宝山', park: '宝山高新', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-沈宝山', park: '宝山高新', roles: [EmployeeRole.BACK], slots: [TimeSlot.AFTERNOON_2] },
  // 下午2 — 外埠项目
  { name: '补位-济南项目', park: '山东济南', roles: [EmployeeRole.PROJECT], slots: [TimeSlot.AFTERNOON_2] },
  { name: '补位-镇江项目', park: '江苏镇江', roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT], slots: [TimeSlot.AFTERNOON_2] },
  // 全时段外埠覆盖（园区匹配缺口）
  { name: '补位-济南全', park: '山东济南', roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT], slots: ALL_SLOTS },
  { name: '补位-徐州全', park: '江苏徐州', roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT], slots: ALL_SLOTS },
  { name: '补位-金山全1', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: ALL_SLOTS },
  { name: '补位-金山全2', park: '加盟-金山资本现代产业园', roles: [EmployeeRole.BACK], slots: ALL_SLOTS },
  { name: '补位-宝山全', park: '宝山高新', roles: [EmployeeRole.BACK], slots: ALL_SLOTS },
  { name: '补位-镇江全', park: '江苏镇江', roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT], slots: ALL_SLOTS },
  // 杨浦区域前道（出发地在杨浦，可覆盖 杨浦-* 园区试算/派单）
  {
    name: '补位-杨浦前',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.FRONT, EmployeeRole.PROJECT],
    slots: ALL_SLOTS,
    departure: '上海市杨浦区邯郸路',
  },
];

/** 修正指定人/园区/时段不满足的既有员工 */
export const EMPLOYEE_FULL_MATCH_PATCHES: Record<
  string,
  { departureAddress?: string; orderCapacity?: TimeSlot[] }
> = {
  李路路: { departureAddress: PARK_DEPARTURES['加盟-金山资本现代产业园'], orderCapacity: ALL_SLOTS },
  温作良: { departureAddress: '上海市金山区朱泾镇', orderCapacity: ALL_SLOTS },
  刘帅: { departureAddress: PARK_DEPARTURES['江苏镇江'], orderCapacity: ALL_SLOTS },
  柴强: { departureAddress: PARK_DEPARTURES['宝山高新'], orderCapacity: ALL_SLOTS },
  刘勇: { departureAddress: PARK_DEPARTURES['加盟-金山资本现代产业园'], orderCapacity: ALL_SLOTS },
  姚洁: { departureAddress: PARK_DEPARTURES['加盟-金山资本现代产业园'], orderCapacity: ALL_SLOTS },
  姚焕: { departureAddress: PARK_DEPARTURES['加盟-金山资本现代产业园'], orderCapacity: ALL_SLOTS },
  黄健: { departureAddress: PARK_DEPARTURES['江苏徐州'], orderCapacity: ALL_SLOTS },
  殷汝飞: { departureAddress: PARK_DEPARTURES['山东济南'], orderCapacity: ALL_SLOTS },
  王睿: { departureAddress: PARK_DEPARTURES['江苏徐州'], orderCapacity: ALL_SLOTS },
  /** 金山32家手动派单常用15人：补足下午2（原 Excel 仅上午+下午1） */
  韩哲川: { orderCapacity: ALL_SLOTS },
  傅丽: { orderCapacity: ALL_SLOTS },
  宋樑: { orderCapacity: ALL_SLOTS },
  舒立旻: { departureAddress: '上海市长宁区宣化路', orderCapacity: ALL_SLOTS },
};

export function applyEmployeePatches(employees: Employee[]): Employee[] {
  return employees.map((e) => {
    const patch = EMPLOYEE_FULL_MATCH_PATCHES[e.name];
    if (!patch) return e;
    return {
      ...e,
      departureAddress: patch.departureAddress ?? e.departureAddress,
      orderCapacity: patch.orderCapacity ?? e.orderCapacity,
    };
  });
}

export function buildGapFillEmployees(parkIdByName: Map<string, number>): Employee[] {
  return GAP_TEMPLATES.map((t, idx) => {
    const id = GAP_FILL_EMPLOYEE_ID_START + idx;
    const parkId = parkIdByName.get(t.park) || 0;
    return {
      id,
      name: t.name,
      cityId: 1,
      cityName: '上海市',
      roles: t.roles,
      status: EmployeeStatus.ACTIVE,
      departureAddress: t.departure || PARK_DEPARTURES[t.park],
      orderCapacity: t.slots,
      plusCapabilities: FULL_PLUS,
      serviceParkId: parkId,
      serviceParkName: t.park,
      remark: `[${GAP_FILL_TAG}]`,
    };
  });
}

export function getGapFillEmployeeIds(): number[] {
  return GAP_TEMPLATES.map((_, idx) => GAP_FILL_EMPLOYEE_ID_START + idx);
}

export function getAllCustomerIds(customers: Customer[]): number[] {
  return customers.map((c) => c.id);
}
