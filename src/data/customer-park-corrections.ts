/**
 * 客户园区校正：地址在上海但 Excel 招商园区填成外埠时，按区县对齐园区名
 */

import { Customer, InvestmentPark } from '../types';
import { resolveCustomerParkName } from '../utils/address-region';

export function applyCustomerParkCorrections(
  customers: Customer[],
  parks: InvestmentPark[]
): { customers: Customer[]; parks: InvestmentPark[] } {
  const nextParks = [...parks];
  const parkIdByName = new Map(nextParks.map((p) => [p.name, p.id]));
  let nextId = Math.max(0, ...nextParks.map((p) => p.id)) + 1;

  const ensurePark = (name: string): number => {
    const existing = parkIdByName.get(name);
    if (existing != null) return existing;
    const park: InvestmentPark = {
      id: nextId++,
      name,
      cityId: 1,
      cityName: '上海市',
      address: '',
      status: 'ACTIVE',
    };
    nextParks.push(park);
    parkIdByName.set(name, park.id);
    return park.id;
  };

  const corrected = customers.map((c) => {
    const parkName = resolveCustomerParkName(c.parkName, c.address);
    if (parkName === c.parkName) return c;
    return { ...c, parkName, parkId: ensurePark(parkName) };
  });

  return { customers: corrected, parks: nextParks };
}
