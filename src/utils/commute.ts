/**
 * 通勤时间估算模块
 * 实际生产环境可对接高德/百度地图 API
 */

import { Customer, Employee, TimeSlot } from '../types';

/** 拜访顺序：上午 → 下午1 → 下午2，同时段按预约时间 */
const SLOT_VISIT_ORDER: Record<TimeSlot, number> = {
  [TimeSlot.MORNING]: 0,
  [TimeSlot.AFTERNOON_1]: 1,
  [TimeSlot.AFTERNOON_2]: 2,
};

export function sortCustomersByVisitOrder(customers: Customer[]): Customer[] {
  return [...customers].sort((a, b) => {
    const slotDiff = SLOT_VISIT_ORDER[a.timeSlot] - SLOT_VISIT_ORDER[b.timeSlot];
    if (slotDiff !== 0) return slotDiff;
    return a.appointmentTime.getTime() - b.appointmentTime.getTime();
  });
}

/** 下一单出发地：首单从员工出发地，其后从行程中上一站地址 */
export function getCommuteOriginForNextStop(
  employee: Employee,
  assignedBefore: Customer[],
  next: Customer
): string {
  const route = sortCustomersByVisitOrder([...assignedBefore, next]);
  const nextIdx = route.findIndex((c) => c.id === next.id);
  if (nextIdx <= 0) return employee.departureAddress;
  return route[nextIdx - 1].address;
}

export interface ChainedRouteEstimate {
  minutes: number;
  pathSummary: string;
  source: 'deepseek' | 'local' | 'transit' | 'walking';
  fromAddress: string;
}

/** 串联本段通勤（分钟） */
export function estimateChainedLegMinutes(
  employee: Employee,
  assignedBefore: Customer[],
  next: Customer,
  departureLegCell?: { minutes: number }
): number {
  const from = getCommuteOriginForNextStop(employee, assignedBefore, next);
  if (from === employee.departureAddress && departureLegCell && departureLegCell.minutes > 0) {
    return departureLegCell.minutes;
  }
  return estimateCommuteMinutes(from, next.address);
}

export function buildChainedRouteEstimate(
  employee: Employee,
  assignedBefore: Customer[],
  next: Customer,
  departureLegCell?: { minutes: number; pathSummary?: string; source?: 'deepseek' | 'local' | 'transit' | 'walking' }
): ChainedRouteEstimate {
  const from = getCommuteOriginForNextStop(employee, assignedBefore, next);
  if (from === employee.departureAddress && departureLegCell && departureLegCell.minutes > 0) {
    return {
      minutes: departureLegCell.minutes,
      pathSummary: departureLegCell.pathSummary || `${from} → ${next.address}`,
      source: departureLegCell.source || 'local',
      fromAddress: from,
    };
  }
  const minutes = estimateCommuteMinutes(from, next.address);
  const legLabel = from === employee.departureAddress ? '出发地' : '上一单';
  return {
    minutes,
    pathSummary: `串联：${legLabel}（${from}）→ ${next.companyName}（${next.address}），约 ${minutes} 分钟`,
    source: 'local',
    fromAddress: from,
  };
}

/** 简化的地址坐标（演示用，实际应通过地理编码获取） */
const ADDRESS_COORDS: Record<string, [number, number]> = {};

/** 注册地址坐标 */
export function registerAddressCoord(address: string, lat: number, lng: number): void {
  ADDRESS_COORDS[address] = [lat, lng];
}

/** 从地址提取区域关键词用于估算 */
function extractDistrict(address: string): string {
  const districts = [
    '浦东新区', '黄浦区', '徐汇区', '长宁区', '静安区', '普陀区',
    '虹口区', '杨浦区', '闵行区', '宝山区', '嘉定区', '金山区',
    '松江区', '青浦区', '奉贤区', '崇明区',
  ];
  for (const d of districts) {
    if (address.includes(d)) return d;
  }
  return '未知';
}

/** 选择模式允许的最大单程通勤（分钟），超过仅影响排序，不导致匹配失败 */
/** 软提示上限（UI 警告） */
export const MAX_ACCEPTABLE_COMMUTE_MINUTES = 60;
/** 硬现实上限：单段串联通勤超过此值视为不可派（除非全员超标） */
export const MAX_REALISTIC_COMMUTE_MINUTES = 90;

const DISTRICT_COMMUTE: Record<string, Record<string, number>> = {
  '浦东新区': { '浦东新区': 30, '黄浦区': 40, '徐汇区': 35, '长宁区': 45, '静安区': 40, '普陀区': 50, '虹口区': 45, '杨浦区': 40, '闵行区': 35, '宝山区': 30, '嘉定区': 45, '金山区': 60, '松江区': 55, '青浦区': 60, '奉贤区': 50 },
  '黄浦区': { '浦东新区': 40, '黄浦区': 15, '徐汇区': 20, '长宁区': 25, '静安区': 15, '普陀区': 25, '虹口区': 20, '杨浦区': 25, '闵行区': 35, '宝山区': 40, '嘉定区': 45, '金山区': 70, '松江区': 50, '青浦区': 55, '奉贤区': 55 },
  '徐汇区': { '浦东新区': 35, '黄浦区': 20, '徐汇区': 15, '长宁区': 20, '静安区': 25, '普陀区': 30, '虹口区': 30, '杨浦区': 35, '闵行区': 25, '宝山区': 40, '嘉定区': 45, '金山区': 60, '松江区': 40, '青浦区': 50, '奉贤区': 45 },
  '长宁区': { '浦东新区': 45, '黄浦区': 25, '徐汇区': 20, '长宁区': 15, '静安区': 20, '普陀区': 25, '虹口区': 25, '杨浦区': 30, '闵行区': 30, '宝山区': 40, '嘉定区': 45, '金山区': 65, '松江区': 45, '青浦区': 50, '奉贤区': 50 },
  '静安区': { '浦东新区': 40, '黄浦区': 15, '徐汇区': 25, '长宁区': 20, '静安区': 15, '普陀区': 20, '虹口区': 20, '杨浦区': 25, '闵行区': 35, '宝山区': 35, '嘉定区': 40, '金山区': 65, '松江区': 45, '青浦区': 50, '奉贤区': 50 },
  '普陀区': { '浦东新区': 50, '黄浦区': 25, '徐汇区': 30, '长宁区': 25, '静安区': 20, '普陀区': 15, '虹口区': 20, '杨浦区': 25, '闵行区': 35, '宝山区': 30, '嘉定区': 35, '金山区': 55, '松江区': 40, '青浦区': 45, '奉贤区': 45 },
  '虹口区': { '浦东新区': 45, '黄浦区': 20, '徐汇区': 30, '长宁区': 25, '静安区': 20, '普陀区': 20, '虹口区': 15, '杨浦区': 15, '闵行区': 40, '宝山区': 35, '嘉定区': 35, '金山区': 60, '松江区': 45, '青浦区': 50, '奉贤区': 50 },
  '杨浦区': { '浦东新区': 40, '黄浦区': 25, '徐汇区': 35, '长宁区': 30, '静安区': 25, '普陀区': 25, '虹口区': 15, '杨浦区': 15, '闵行区': 40, '宝山区': 30, '嘉定区': 35, '金山区': 60, '松江区': 45, '青浦区': 50, '奉贤区': 50 },
  '闵行区': { '浦东新区': 35, '黄浦区': 35, '徐汇区': 25, '长宁区': 30, '静安区': 35, '普陀区': 35, '虹口区': 40, '杨浦区': 40, '闵行区': 20, '宝山区': 35, '嘉定区': 40, '金山区': 50, '松江区': 35, '青浦区': 40, '奉贤区': 35 },
  '宝山区': { '浦东新区': 30, '黄浦区': 40, '徐汇区': 40, '长宁区': 40, '静安区': 35, '普陀区': 30, '虹口区': 35, '杨浦区': 30, '闵行区': 35, '宝山区': 20, '嘉定区': 25, '金山区': 50, '松江区': 40, '青浦区': 45, '奉贤区': 45 },
  '嘉定区': { '浦东新区': 45, '黄浦区': 45, '徐汇区': 45, '长宁区': 45, '静安区': 40, '普陀区': 35, '虹口区': 35, '杨浦区': 35, '闵行区': 40, '宝山区': 25, '嘉定区': 15, '金山区': 45, '松江区': 35, '青浦区': 40, '奉贤区': 50 },
  '金山区': { '浦东新区': 60, '黄浦区': 70, '徐汇区': 60, '长宁区': 65, '静安区': 65, '普陀区': 55, '虹口区': 60, '杨浦区': 60, '闵行区': 50, '宝山区': 50, '嘉定区': 45, '金山区': 20, '松江区': 30, '青浦区': 45, '奉贤区': 35 },
  '松江区': { '浦东新区': 55, '黄浦区': 50, '徐汇区': 40, '长宁区': 45, '静安区': 45, '普陀区': 40, '虹口区': 45, '杨浦区': 45, '闵行区': 35, '宝山区': 40, '嘉定区': 35, '金山区': 30, '松江区': 15, '青浦区': 30, '奉贤区': 35 },
  '青浦区': { '浦东新区': 60, '黄浦区': 55, '徐汇区': 50, '长宁区': 50, '静安区': 50, '普陀区': 45, '虹口区': 50, '杨浦区': 50, '闵行区': 40, '宝山区': 45, '嘉定区': 40, '金山区': 45, '松江区': 30, '青浦区': 15, '奉贤区': 45 },
  '奉贤区': { '浦东新区': 50, '黄浦区': 55, '徐汇区': 45, '长宁区': 50, '静安区': 50, '普陀区': 45, '虹口区': 50, '杨浦区': 50, '闵行区': 35, '宝山区': 45, '嘉定区': 50, '金山区': 35, '松江区': 35, '青浦区': 45, '奉贤区': 15 },
};

/** 同区内根据地址差异调整估算，避免一律返回相同分钟数 */
function addressDistanceFactor(fromAddress: string, toAddress: string): number {
  const strip = (a: string) => a.replace(/^.+?(区|县)/, '').trim();
  const a = strip(fromAddress);
  const b = strip(toAddress);
  if (!a || !b) return 0.5;
  if (a === b) return 0;
  let prefix = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len && a[i] === b[i]; i++) prefix++;
  return 1 - prefix / Math.max(a.length, b.length, 1);
}

/** 同路近距离步行估算（无 API 时，如 690 号 → 699 号） */
export function estimateSameRoadWalkMinutes(fromAddress: string, toAddress: string): number | null {
  const roadRe = /([\u4e00-\u9fa5]{2,}(?:路|公路|大道|街|巷|弄))/;
  const fromRoad = fromAddress.match(roadRe)?.[1];
  if (!fromRoad || !toAddress.includes(fromRoad)) return null;

  const fromDistrict = extractDistrict(fromAddress);
  const toDistrict = extractDistrict(toAddress);
  if (fromDistrict !== '未知' && toDistrict !== '未知' && fromDistrict !== toDistrict) {
    return null;
  }

  const numFrom = fromAddress.match(/(\d+)号/)?.[1];
  const numTo = toAddress.match(/(\d+)号/)?.[1];
  if (numFrom && numTo) {
    const diff = Math.abs(Number(numFrom) - Number(numTo));
    if (diff <= 800) return Math.max(3, Math.min(12, Math.round(diff / 100 + 3)));
  }
  return 8;
}

/** 估算两点间通勤时间（分钟） */
export function estimateCommuteMinutes(fromAddress: string, toAddress: string): number {
  const walk = estimateSameRoadWalkMinutes(fromAddress, toAddress);
  if (walk != null) return walk;

  if (ADDRESS_COORDS[fromAddress] && ADDRESS_COORDS[toAddress]) {
    const [lat1, lng1] = ADDRESS_COORDS[fromAddress];
    const [lat2, lng2] = ADDRESS_COORDS[toAddress];
    const dist = haversineDistance(lat1, lng1, lat2, lng2);
    return Math.round(dist * 2.5);
  }

  const fromDistrict = extractDistrict(fromAddress);
  const toDistrict = extractDistrict(toAddress);

  const matrix = DISTRICT_COMMUTE[fromDistrict];
  const crossMinutes = matrix?.[toDistrict];

  if (fromDistrict === toDistrict && fromDistrict !== '未知') {
    const base = crossMinutes ?? 20;
    const factor = addressDistanceFactor(fromAddress, toAddress);
    return Math.max(10, Math.round(base * (0.55 + factor * 0.75)));
  }

  if (crossMinutes) return crossMinutes;

  return 45;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 计算员工一天的总通勤时间 */
export function calculateDailyCommute(
  employee: Employee,
  assignedCustomers: Customer[]
): { totalMinutes: number; segments: { from: string; to: string; minutes: number }[] } {
  const segments: { from: string; to: string; minutes: number }[] = [];
  let totalMinutes = 0;

  const sorted = sortCustomersByVisitOrder(assignedCustomers);

  if (sorted.length === 0) {
    return { totalMinutes: 0, segments: [] };
  }

  const firstCommute = estimateCommuteMinutes(employee.departureAddress, sorted[0].address);
  segments.push({
    from: employee.departureAddress,
    to: sorted[0].address,
    minutes: firstCommute,
  });
  totalMinutes += firstCommute;

  for (let i = 1; i < sorted.length; i++) {
    const commute = estimateCommuteMinutes(sorted[i - 1].address, sorted[i].address);
    segments.push({
      from: sorted[i - 1].address,
      to: sorted[i].address,
      minutes: commute,
    });
    totalMinutes += commute;
  }

  return { totalMinutes, segments };
}
