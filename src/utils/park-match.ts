/**
 * 园区匹配：员工出发地是否地理上能覆盖客户所属园区
 * 业务含义：员工从该出发地出发，能否合理服务该园区的客户
 */

/** 已知园区的覆盖关键词（优先精确配置） */
const PARK_REGION_KEYS: Record<string, string[]> = {
  '加盟-金山资本现代产业园': ['上海', '金山'],
  '宝山高新': ['上海', '宝山'],
  '山东济南': ['济南', '山东', '上海', '松江'],
  '江苏徐州': ['徐州', '上海', '青浦'],
  '江苏镇江': ['镇江', '上海', '松江'],
};

/** 园区名拆分时忽略的通用词（不含地理信息） */
const NOISE_SEGMENTS = new Set([
  '测试园区',
  '加盟',
  '现代产业园',
  '产业园',
  '资本',
  '新片区',
  '高新',
]);

/** 区县简称 → 地址中常见完整写法 */
const DISTRICT_ALIASES: Record<string, string[]> = {
  浦东: ['浦东', '浦东新区'],
  黄浦: ['黄浦', '黄浦区'],
  徐汇: ['徐汇', '徐汇区'],
  长宁: ['长宁', '长宁区'],
  静安: ['静安', '静安区'],
  普陀: ['普陀', '普陀区'],
  虹口: ['虹口', '虹口区'],
  杨浦: ['杨浦', '杨浦区'],
  闵行: ['闵行', '闵行区'],
  宝山: ['宝山', '宝山区'],
  嘉定: ['嘉定', '嘉定区'],
  金山: ['金山', '金山区'],
  松江: ['松江', '松江区'],
  青浦: ['青浦', '青浦区'],
  奉贤: ['奉贤', '奉贤区'],
  崇明: ['崇明', '崇明区'],
  张江: ['张江'],
  金桥: ['金桥'],
  莘庄: ['莘庄'],
  漕河泾: ['漕河泾', '漕宝路'],
  虹桥: ['虹桥'],
  真如: ['真如'],
  复旦: ['复旦', '邯郸路'],
  五角场: ['五角场'],
  北外滩: ['北外滩'],
  外滩: ['外滩', '南京东路'],
  顾村: ['顾村'],
  安亭: ['安亭'],
  新城: ['新城'],
  徐泾: ['徐泾'],
  南桥: ['南桥'],
  亭林: ['亭林'],
  城桥: ['城桥'],
  临港: ['临港'],
  大宁: ['大宁'],
  紫竹: ['紫竹'],
  惠南: ['惠南'],
};

/** 从园区名提取地域关键词 */
export function extractParkKeywords(parkName: string): string[] {
  const segments = parkName
    .split(/[-·（）()\/]/)
    .map((s) => s.trim())
    .filter((p) => p.length >= 2 && !NOISE_SEGMENTS.has(p));

  const keywords = new Set<string>();

  for (const segment of segments) {
    keywords.add(segment);

    for (const [short, aliases] of Object.entries(DISTRICT_ALIASES)) {
      if (segment.startsWith(short) && segment.length > short.length) {
        keywords.add(short);
        const rest = segment.slice(short.length);
        if (rest.length >= 2) keywords.add(rest);
      }
    }

    if (DISTRICT_ALIASES[segment]) {
      DISTRICT_ALIASES[segment].forEach((a) => keywords.add(a));
    }
  }

  return [...keywords];
}

function addressContainsKeyword(address: string, keyword: string): boolean {
  if (!keyword) return false;
  if (address.includes(keyword)) return true;
  const aliases = DISTRICT_ALIASES[keyword];
  return aliases ? aliases.some((a) => address.includes(a)) : false;
}

/** 员工出发地能否覆盖客户所属园区 */
export function canDepartureServePark(departureAddress: string, parkName: string): boolean {
  if (!departureAddress || !parkName) return false;

  const keys = PARK_REGION_KEYS[parkName];
  if (keys) {
    return keys.some((k) => departureAddress.includes(k));
  }

  const keywords = extractParkKeywords(parkName);
  if (keywords.length === 0) return false;
  return keywords.some((kw) => addressContainsKeyword(departureAddress, kw));
}

/** 匹配失败时的可读说明（用于提示录入） */
export function explainParkMatchFailure(departureAddress: string, parkName: string): string {
  const keys = PARK_REGION_KEYS[parkName];
  if (keys) {
    const missing = keys.filter((k) => !departureAddress.includes(k));
    return `园区「${parkName}」要求出发地含 ${keys.join(' 或 ')}，当前「${departureAddress}」缺少 ${missing.join('、')}`;
  }
  const keywords = extractParkKeywords(parkName);
  const missing = keywords.filter((kw) => !addressContainsKeyword(departureAddress, kw));
  if (keywords.length === 0) {
    return `园区名「${parkName}」未提取到有效地域关键词，请使用如「浦东-张江」或在园区表中配置`;
  }
  return `园区「${parkName}」要求出发地覆盖地域词 ${keywords.join(' / ')}，当前「${departureAddress}」未匹配到 ${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}`;
}
