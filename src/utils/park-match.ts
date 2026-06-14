/**
 * 园区匹配：以员工出发地是否覆盖客户园区为准（不再使用员工服务园区字段）
 */

const PARK_REGION_KEYS: Record<string, string[]> = {
  '加盟-金山资本现代产业园': ['上海', '金山'],
  '宝山高新': ['上海', '宝山'],
  '山东济南': ['济南', '山东'],
  '江苏徐州': ['徐州'],
  '江苏镇江': ['镇江'],
};

/** 员工出发地能否覆盖客户所属园区 */
export function canDepartureServePark(departureAddress: string, parkName: string): boolean {
  if (!departureAddress || !parkName) return false;

  const keys = PARK_REGION_KEYS[parkName];
  if (keys) {
    return keys.some((k) => departureAddress.includes(k));
  }

  // 未知园区：园区名中的地域关键词是否出现在出发地址中
  const parts = parkName.split(/[-·（）()]/).filter((p) => p.length >= 2);
  return parts.some((part) => departureAddress.includes(part));
}
