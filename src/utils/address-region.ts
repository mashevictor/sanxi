/**
 * 从地址推断省/市，用于园区校正与跨省拦截
 */

/** 外埠园区名（仅当客户地址也在对应省份时才合法） */
export const REMOTE_PARK_NAMES = new Set(['山东济南', '江苏徐州', '江苏镇江']);

export function inferProvinceFromAddress(address: string): string {
  if (!address) return '未知';
  if (address.includes('上海市') || /^上海/.test(address)) return '上海';
  if (address.includes('山东省') || address.includes('济南市')) return '山东';
  if (address.includes('江苏省') || address.includes('徐州市') || address.includes('镇江市')) {
    return '江苏';
  }
  const m = address.match(/^(.{2,3}?)省/);
  if (m) return m[1];
  return '未知';
}

/** 上海地址 → 与区县对齐的园区名（如 松江-项目） */
export function inferShanghaiDistrictPark(address: string): string {
  const m = address.match(/上海市(\S+?)区/);
  if (m) return `${m[1]}-项目`;
  return '加盟-金山资本现代产业园';
}

/** 客户地址与园区名是否地理一致（Excel 招商园区列填错时返回 false） */
export function isParkAlignedWithAddress(parkName: string, address: string): boolean {
  const province = inferProvinceFromAddress(address);
  if (province === '上海') {
    return !REMOTE_PARK_NAMES.has(parkName);
  }
  if (province === '山东') return parkName === '山东济南';
  if (province === '江苏') {
    if (address.includes('徐州市')) return parkName === '江苏徐州';
    if (address.includes('镇江市')) return parkName === '江苏镇江';
    return parkName === '江苏徐州' || parkName === '江苏镇江';
  }
  return true;
}

export function resolveCustomerParkName(parkName: string, address: string): string {
  const province = inferProvinceFromAddress(address);
  if (province === '上海' && REMOTE_PARK_NAMES.has(parkName)) {
    return inferShanghaiDistrictPark(address);
  }
  return parkName;
}
