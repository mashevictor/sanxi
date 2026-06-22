/**
 * 后道下午捆绑：同一园区内，下午1 + 下午2 必须派给同一名员工（下午跑 2 单）
 */

import { Customer, CustomerType, TimeSlot } from '../types';
import { sortCustomersForDispatch } from './match-rules';

export interface AfternoonParkPair {
  /** 稳定分组键，同园区同批下午对共享 */
  groupId: string;
  parkName: string;
  afternoon1: Customer;
  afternoon2: Customer;
}

export function isBackAfternoonSlotCustomer(customer: Customer): boolean {
  return (
    customer.customerType === CustomerType.FOLLOW_UP &&
    (customer.timeSlot === TimeSlot.AFTERNOON_1 || customer.timeSlot === TimeSlot.AFTERNOON_2)
  );
}

/** 两名后道下午客户能否由同一员工承接（指定人不可冲突） */
export function canShareAfternoonEmployee(c1: Customer, c2: Customer): boolean {
  const d1 = c1.designatedPerson?.trim();
  const d2 = c2.designatedPerson?.trim();
  if (d1 && d2 && d1 !== d2) return false;
  return true;
}

function pairAfternoonLists(a1: Customer[], a2: Customer[]): {
  pairs: { afternoon1: Customer; afternoon2: Customer }[];
  unpaired: Customer[];
} {
  const sorted1 = sortCustomersForDispatch([...a1]);
  const remaining2 = sortCustomersForDispatch([...a2]);
  const used2 = new Set<number>();
  const pairs: { afternoon1: Customer; afternoon2: Customer }[] = [];
  const unpaired: Customer[] = [];

  for (const c1 of sorted1) {
    const idx = remaining2.findIndex((c2) => !used2.has(c2.id) && canShareAfternoonEmployee(c1, c2));
    if (idx >= 0) {
      const c2 = remaining2[idx];
      used2.add(c2.id);
      pairs.push({ afternoon1: c1, afternoon2: c2 });
    } else {
      unpaired.push(c1);
    }
  }
  for (const c2 of remaining2) {
    if (!used2.has(c2.id)) unpaired.push(c2);
  }
  return { pairs, unpaired };
}

/** 从待匹配客户中提取「同园区后道下午1+下午2」绑定对（按派单优先级排序后 zip） */
export function buildAfternoonParkPairs(customers: Customer[]): {
  pairs: AfternoonParkPair[];
  /** 未凑成对的下午单（数量不等时剩余） */
  unpairedAfternoon: Customer[];
  /** 不参与下午捆绑的客户（上午 / 非后道） */
  otherCustomers: Customer[];
} {
  const otherCustomers: Customer[] = [];
  const byPark = new Map<string, { a1: Customer[]; a2: Customer[] }>();

  for (const c of customers) {
    if (!isBackAfternoonSlotCustomer(c)) {
      otherCustomers.push(c);
      continue;
    }
    let bucket = byPark.get(c.parkName);
    if (!bucket) {
      bucket = { a1: [], a2: [] };
      byPark.set(c.parkName, bucket);
    }
    if (c.timeSlot === TimeSlot.AFTERNOON_1) bucket.a1.push(c);
    else bucket.a2.push(c);
  }

  const pairs: AfternoonParkPair[] = [];
  const unpairedAfternoon: Customer[] = [];

  for (const [parkName, { a1, a2 }] of byPark) {
    const { pairs: parkPairs, unpaired } = pairAfternoonLists(a1, a2);
    for (const { afternoon1, afternoon2 } of parkPairs) {
      pairs.push({
        groupId: `APM_${parkName}_${afternoon1.id}_${afternoon2.id}`,
        parkName,
        afternoon1,
        afternoon2,
      });
    }
    unpairedAfternoon.push(...unpaired);
  }

  return { pairs, unpairedAfternoon, otherCustomers };
}
