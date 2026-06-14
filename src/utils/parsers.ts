/**
 * 数据解析工具函数
 */

import {
  CustomerType,
  TimeSlot,
  EmployeeRole,
  EmployeeStatus,
  PlusLevel,
  PlusCapabilities,
  DispatchStatus,
} from '../types';

/** 解析预约时间，判断时段 */
export function parseTimeSlot(dateTimeStr: string): TimeSlot {
  const time = dateTimeStr.includes(' ')
    ? dateTimeStr.split(' ')[1]
    : dateTimeStr;

  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr || '0', 10);
  const totalMinutes = hour * 60 + minute;

  // 上午: 12:00 之前
  if (totalMinutes < 12 * 60) {
    return TimeSlot.MORNING;
  }
  // 下午1: 12:00 - 14:30
  if (totalMinutes < 14 * 60 + 30) {
    return TimeSlot.AFTERNOON_1;
  }
  // 下午2: 14:30 之后
  return TimeSlot.AFTERNOON_2;
}

/** 解析 Plus 次数 */
export function parsePlusCount(plusStr: string): number {
  const match = plusStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** 根据 Plus 次数确定 Plus 等级 */
export function getPlusLevel(plusCount: number): PlusLevel {
  if (plusCount === 0) return PlusLevel.PLUS_0;
  if (plusCount === 1) return PlusLevel.PLUS_1;
  return PlusLevel.PLUS_N;
}

/** 解析员工职责字符串 */
export function parseEmployeeRoles(rolesStr: string): EmployeeRole[] {
  const roleMap: Record<string, EmployeeRole> = {
    '前道': EmployeeRole.FRONT,
    '项目': EmployeeRole.PROJECT,
    '后道': EmployeeRole.BACK,
  };

  return rolesStr
    .split(/[,，]/)
    .map((r) => r.trim())
    .filter((r) => roleMap[r])
    .map((r) => roleMap[r]);
}

/** 解析员工状态 */
export function parseEmployeeStatus(statusStr: string): EmployeeStatus {
  if (statusStr === '正常') return EmployeeStatus.ACTIVE;
  if (statusStr === '停用') return EmployeeStatus.INACTIVE;
  if (statusStr === '请假') return EmployeeStatus.LEAVE;
  return EmployeeStatus.ACTIVE;
}

/** 解析 Plus 能力字符串，如 "前道:Plus0,项目:Plus0,Plus1,PlusN" */
export function parsePlusCapabilities(capStr: string): PlusCapabilities {
  const result: PlusCapabilities = {};
  const roleMap: Record<string, keyof PlusCapabilities> = {
    '前道': 'FRONT',
    '项目': 'PROJECT',
    '后道': 'BACK',
  };

  const parts = capStr.split(/[,，]/);
  let currentRole: keyof PlusCapabilities | null = null;

  for (const part of parts) {
    const trimmed = part.trim();
    const colonIdx = trimmed.indexOf(':');

    if (colonIdx > 0) {
      const roleName = trimmed.substring(0, colonIdx).trim();
      const plusPart = trimmed.substring(colonIdx + 1).trim();
      currentRole = roleMap[roleName] || null;

      if (currentRole) {
        result[currentRole] = parsePlusLevels(plusPart);
      }
    } else if (currentRole) {
      const existing = result[currentRole] || [];
      result[currentRole] = [...existing, ...parsePlusLevels(trimmed)];
    }
  }

  return result;
}

function parsePlusLevels(str: string): PlusLevel[] {
  const levels: PlusLevel[] = [];
  if (str.includes('Plus0')) levels.push(PlusLevel.PLUS_0);
  if (str.includes('Plus1')) levels.push(PlusLevel.PLUS_1);
  if (str.includes('PlusN')) levels.push(PlusLevel.PLUS_N);
  return levels;
}

/** 解析单量容量，如 "上午单,下午单-1" 或 "上午单,下午单-1,下午单-2" */
export function parseOrderCapacity(capStr: string): TimeSlot[] {
  const slots: TimeSlot[] = [];
  if (capStr.includes('上午单')) slots.push(TimeSlot.MORNING);
  if (capStr.includes('下午单-1') || (capStr.includes('下午单') && !capStr.includes('下午单-2'))) {
    slots.push(TimeSlot.AFTERNOON_1);
  }
  if (capStr.includes('下午单-2')) slots.push(TimeSlot.AFTERNOON_2);
  return slots;
}

/** 客户类型对应的员工职责 */
export function customerTypeToRole(type: CustomerType): EmployeeRole {
  switch (type) {
    case CustomerType.FIRST_VISIT:
      return EmployeeRole.FRONT;
    case CustomerType.PROJECT:
      return EmployeeRole.PROJECT;
    case CustomerType.FOLLOW_UP:
      return EmployeeRole.BACK;
  }
}

/** 判断客户类型是否属于前道+项目合并组 */
export function isFrontOrProject(type: CustomerType): boolean {
  return type === CustomerType.FIRST_VISIT || type === CustomerType.PROJECT;
}

/** 解析日期时间字符串 */
export function parseDateTime(dateTimeStr: string): Date {
  const normalized = dateTimeStr.replace(/\//g, '-');
  return new Date(normalized);
}

/** 检测牵手单备注 */
export function detectHandInHand(remark?: string): boolean {
  if (!remark) return false;
  return remark.includes('牵手单') || remark.includes('同一个人');
}

/** 生成牵手单组ID */
export function generateHandInHandGroupId(customers: { companyName: string }[]): string {
  const names = customers.map((c) => c.companyName).sort().join('|');
  return `HIH_${Buffer.from(names).toString('base64').substring(0, 16)}`;
}
