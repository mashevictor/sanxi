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
  // 浦东/普陀/徐汇后道补位（益充、筱胜、智彩等远郊单）
  {
    name: '补位-浦东后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市浦东新区盛荣路18号',
  },
  {
    name: '补位-普陀后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市普陀区中江路1178号',
  },
  {
    name: '补位-徐汇后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市徐汇区宜山路700号',
  },
  // 单程 >90 分客户就近补位（2026-06-23）
  {
    name: '补位-川周后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市浦东新区川周公路界龙大道350号',
  },
  {
    name: '补位-龙东后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市浦东新区龙东大道4288弄',
  },
  {
    name: '补位-周泰后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市浦东新区周泰路67弄',
  },
  {
    name: '补位-延安后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市长宁区延安西路1566号',
  },
  {
    name: '补位-嘉定后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市嘉定区平城路855号',
  },
  {
    name: '补位-曹杨前',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.FRONT],
    slots: ALL_SLOTS,
    departure: '上海市普陀区曹杨路2009弄',
  },
  {
    name: '补位-松江项目',
    park: '松江-项目',
    roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT],
    slots: ALL_SLOTS,
    departure: '上海市松江区申港路2599号',
  },
  {
    name: '补位-青浦项目',
    park: '青浦-项目',
    roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT],
    slots: ALL_SLOTS,
    departure: '上海市青浦区久远路89号',
  },
  {
    name: '补位-大川后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市浦东新区大川公路2565号',
  },
  {
    name: '补位-松江车墩',
    park: '松江-项目',
    roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT],
    slots: ALL_SLOTS,
    departure: '上海市松江区车墩镇香闵路601号',
  },
  {
    name: '补位-松江江田',
    park: '松江-项目',
    roles: [EmployeeRole.PROJECT, EmployeeRole.FRONT],
    slots: ALL_SLOTS,
    departure: '上海市松江区江田东路180号',
  },
  {
    name: '补位-周浦后',
    park: '加盟-金山资本现代产业园',
    roles: [EmployeeRole.BACK],
    slots: ALL_SLOTS,
    departure: '上海市浦东新区周浦镇沪南公路2218号',
  },
];

/** 修正指定人/园区/时段不满足的既有员工 */
export const EMPLOYEE_FULL_MATCH_PATCHES: Record<
  string,
  { departureAddress?: string; orderCapacity?: TimeSlot[] }
> = {
  李路路: { departureAddress: '上海市静安区陕西北路936号', orderCapacity: ALL_SLOTS },
  温作良: { departureAddress: '上海市浦东新区周浦镇沪南公路2218号', orderCapacity: ALL_SLOTS },
  刘帅: { departureAddress: '上海市松江区江田东路180号', orderCapacity: ALL_SLOTS },
  柴强: { departureAddress: '上海市浦东新区祝桥镇祝潘公路690号', orderCapacity: ALL_SLOTS },
  刘勇: { departureAddress: PARK_DEPARTURES['加盟-金山资本现代产业园'], orderCapacity: ALL_SLOTS },
  姚洁: { departureAddress: '上海市浦东新区金新路58号', orderCapacity: ALL_SLOTS },
  姚焕: { departureAddress: PARK_DEPARTURES['加盟-金山资本现代产业园'], orderCapacity: ALL_SLOTS },
  黄健: { departureAddress: PARK_DEPARTURES['江苏徐州'], orderCapacity: ALL_SLOTS },
  殷汝飞: { departureAddress: PARK_DEPARTURES['山东济南'], orderCapacity: ALL_SLOTS },
  王睿: { departureAddress: PARK_DEPARTURES['江苏徐州'], orderCapacity: ALL_SLOTS },
  /** 金山32家手动派单常用15人：补足下午2（原 Excel 仅上午+下午1） */
  韩哲川: { orderCapacity: ALL_SLOTS },
  傅丽: { orderCapacity: ALL_SLOTS },
  宋樑: { orderCapacity: ALL_SLOTS },
  /** 浦东益充等：出发地就在客户片区 */
  '补位-浦东后': { departureAddress: '上海市浦东新区盛荣路18号', orderCapacity: ALL_SLOTS },
  /** 普陀筱胜等 */
  '补位-普陀后': { departureAddress: '上海市普陀区中江路1178号', orderCapacity: ALL_SLOTS },
  /** 徐汇智彩等 */
  '补位-徐汇后': { departureAddress: '上海市徐汇区宜山路700号', orderCapacity: ALL_SLOTS },
  '补位-川周后': { departureAddress: '上海市浦东新区川周公路界龙大道350号', orderCapacity: ALL_SLOTS },
  '补位-龙东后': { departureAddress: '上海市浦东新区龙东大道4288弄', orderCapacity: ALL_SLOTS },
  '补位-周泰后': { departureAddress: '上海市浦东新区周泰路67弄', orderCapacity: ALL_SLOTS },
  '补位-延安后': { departureAddress: '上海市长宁区延安西路1566号', orderCapacity: ALL_SLOTS },
  '补位-嘉定后': { departureAddress: '上海市嘉定区平城路855号', orderCapacity: ALL_SLOTS },
  '补位-曹杨前': { departureAddress: '上海市普陀区曹杨路2009弄', orderCapacity: ALL_SLOTS },
  '补位-松江项目': { departureAddress: '上海市松江区申港路2599号', orderCapacity: ALL_SLOTS },
  '补位-青浦项目': { departureAddress: '上海市青浦区久远路89号', orderCapacity: ALL_SLOTS },
  '补位-大川后': { departureAddress: '上海市浦东新区大川公路2565号', orderCapacity: ALL_SLOTS },
  '补位-周浦后': { departureAddress: '上海市浦东新区周浦镇沪南公路2218号', orderCapacity: ALL_SLOTS },
  '补位-松江车墩': { departureAddress: '上海市松江区车墩镇香闵路601号', orderCapacity: ALL_SLOTS },
  '补位-松江江田': { departureAddress: '上海市松江区江田东路180号', orderCapacity: ALL_SLOTS },
};

/** 片区补位/就近员工与客户绑定（确保单程 ≤90 分） */
export interface RegionalGapFillBinding {
  employeeName: string;
  /** 客户地址含此片段时才绑定（同名多地址时用） */
  addressIncludes?: string;
}

export const REGIONAL_GAP_FILL_BINDINGS: Record<string, string | RegionalGapFillBinding> = {
  '上海益充电子商务有限公司': '补位-浦东后',
  '上海众家物业有限公司': '补位-川周后',
  '山东济南-上海涌艺影视投资有限公司': '补位-松江项目',
  '山东济南-上海浪拓智能科技股份有限公司': '补位-松江车墩',
  '江苏徐州-纽珑实业（上海）有限公司': '补位-青浦项目',
  '江苏镇江-上海日洁环境科技有限公司': '补位-松江江田',
  '济南瑞丰化工有限公司': '补位-济南全',
  '济南华创科技有限公司': '补位-济南全',
  '徐州工程机械配件公司': '补位-徐州全',
  '徐州智联物流有限公司': '补位-徐州全',
  '镇江新材料科技股份公司': '补位-镇江全',
  '镇江港口物流发展公司': '补位-镇江全',
  '上海昊上电子科技有限公司': '补位-龙东后',
  '上海万沃建筑工程咨询有限公司': '补位-周泰后',
  '上海界龙现代印刷纸品有限公司': '补位-延安后',
  '上海喜福来朝阳食品贸易行': { employeeName: '补位-曹杨前', addressIncludes: '曹杨路' },
  '古疁（上海）文化发展有限公司': '补位-嘉定后',
  '上海波汇科技有限公司': '补位-大川后',
};

export function resolveRegionalGapFillEmployee(
  customer: Customer,
  bindings: Record<string, string | RegionalGapFillBinding>
): string | undefined {
  const entry = bindings[customer.companyName];
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  if (entry.addressIncludes && !customer.address.includes(entry.addressIncludes)) return undefined;
  return entry.employeeName;
}

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
