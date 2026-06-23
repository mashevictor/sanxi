/**
 * 通勤距离估算：高德公交/地铁（默认）→ DeepSeek 驾车 → 本地矩阵
 *
 * QPS 应对策略：
 * 1. 全局限流队列（GAODE_QPS，默认 1 次/秒）
 * 2. 磁盘持久缓存 public/cache/transit-routes.json
 * 3. 内存缓存 + 进行中请求合并（dedupe）
 * 4. QPS 超限指数退避重试
 * 5. 按需请求（仅合规员工→客户 + 实际串联段）
 * 6. 失败降级本地矩阵
 */

import fs from 'fs';
import path from 'path';
import { estimateCommuteMinutes } from '../utils/commute';
import {
  configureGaodeLimiter,
  enqueueGaodeRequest,
  getGaodeLimiterStats,
  isGaodeRateLimitError,
  withGaodeRetry,
} from './gaode-rate-limiter';
import {
  flushTransitDiskCache,
  getTransitDiskCacheStats,
  getTransitFromDisk,
  loadTransitDiskCache,
  saveTransitToDisk,
} from './transit-disk-cache';

export type RouteSource = 'deepseek' | 'local' | 'transit';
export type CommuteMode = 'local' | 'deepseek' | 'transit';
export type DistanceSource = 'deepseek' | 'local' | 'transit' | 'mixed';

export interface RouteEstimate {
  minutes: number;
  distanceKm?: number;
  pathSummary: string;
  source: RouteSource;
}

export type LegCache = Map<string, RouteEstimate>;

export interface GaodeCommuteStats {
  memoryHits: number;
  diskHits: number;
  apiCalls: number;
  localFallbacks: number;
  limiter: ReturnType<typeof getGaodeLimiterStats>;
  disk: ReturnType<typeof getTransitDiskCacheStats>;
}

const routeCache = new Map<string, RouteEstimate>();
const pending = new Map<string, Promise<RouteEstimate>>();

let memoryHits = 0;
let diskHits = 0;
let apiCalls = 0;
let localFallbacks = 0;

interface GeoPoint {
  lng: number;
  lat: number;
  city: string;
}

const geocodeCache = new Map<string, GeoPoint>();

function routeCacheKey(from: string, to: string, mode: CommuteMode): string {
  return `${mode}|${from}|${to}`;
}

export function legCacheKey(from: string, to: string): string {
  return `${from}|${to}`;
}

export function getLegFromCache(
  from: string,
  to: string,
  legCache?: LegCache
): RouteEstimate | undefined {
  return legCache?.get(legCacheKey(from, to));
}

export function getGaodeCommuteStats(): GaodeCommuteStats {
  return {
    memoryHits,
    diskHits,
    apiCalls,
    localFallbacks,
    limiter: getGaodeLimiterStats(),
    disk: getTransitDiskCacheStats(),
  };
}

export function resetGaodeCommuteStats(): void {
  memoryHits = 0;
  diskHits = 0;
  apiCalls = 0;
  localFallbacks = 0;
}

function localFallback(from: string, to: string, parkName: string): RouteEstimate {
  localFallbacks++;
  const minutes = estimateCommuteMinutes(from, to);
  const parkHint = parkName ? `（园区 ${parkName}）` : '';
  return {
    minutes,
    pathSummary: `本地估算：${from} → ${to}${parkHint}，约 ${minutes} 分钟`,
    source: 'local',
  };
}

function getDeepSeekKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}

function getGaodeKey(): string | undefined {
  return process.env.GAODE_API_KEY;
}

/** 有高德 Key 时默认公交/地铁，否则本地矩阵 */
export function getDefaultCommuteMode(): CommuteMode {
  if (getGaodeKey()) return 'transit';
  if (getDeepSeekKey()) return 'deepseek';
  return 'local';
}

export function resolveCommuteMode(requested?: string): CommuteMode {
  if (requested === 'local' || requested === 'deepseek' || requested === 'transit') {
    return requested;
  }
  return getDefaultCommuteMode();
}

function inferCity(address: string): string {
  const m = address.match(/(北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|郑州|长沙|青岛|大连|厦门|宁波|无锡|佛山|东莞|合肥|昆明|沈阳|哈尔滨|长春|石家庄|太原|济南|福州|南昌|贵阳|南宁|海口|兰州|银川|西宁|乌鲁木齐|拉萨|呼和浩特|徐州|镇江|常州|嘉兴|绍兴|温州|金华|台州|珠海|中山|惠州|烟台|潍坊|临沂|洛阳|唐山|保定|邯郸|秦皇岛|沧州|廊坊|张家口|承德|泰州|扬州|盐城|淮安|连云港|宿迁|南通|芜湖|蚌埠|马鞍山|安庆|滁州|阜阳|宿州|六安|亳州|池州|宣城|泉州|漳州|龙岩|三明|莆田|南平|宁德|株洲|湘潭|衡阳|岳阳|常德|益阳|郴州|永州|怀化|娄底|湛江|茂名|肇庆|江门|阳江|韶关|清远|潮州|揭阳|云浮|梅州|汕尾|河源|三亚|绵阳|德阳|南充|宜宾|遵义|曲靖|柳州|桂林|北海|钦州|玉林|大庆|齐齐哈尔|吉林|包头|鄂尔多斯|遵义)/);
  if (m) return m[1];
  if (/江苏/.test(address)) return '南京';
  if (/浙江/.test(address)) return '杭州';
  if (/广东/.test(address)) return '广州';
  if (/山东/.test(address)) return '济南';
  return '上海';
}

async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const cached = geocodeCache.get(address);
  if (cached) return cached;

  const apiKey = getGaodeKey();
  if (!apiKey) return null;

  const city = inferCity(address);
  const url =
    `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}` +
    `&city=${encodeURIComponent(city)}&key=${apiKey}`;

  try {
    apiCalls++;
    const data = await withGaodeRetry(
      async () => {
        const res = await fetch(url);
        return (await res.json()) as {
          status?: string;
          info?: string;
          infocode?: string;
          geocodes?: { location?: string; city?: string }[];
        };
      },
      (payload) =>
        typeof payload === 'object' &&
        payload !== null &&
        isGaodeRateLimitError(
          (payload as { info?: string }).info,
          (payload as { infocode?: string }).infocode
        )
    );

    if (
      isGaodeRateLimitError(data.info, data.infocode) ||
      data.status !== '1' ||
      !data.geocodes?.[0]?.location
    ) {
      return null;
    }
    const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const point: GeoPoint = { lng, lat, city: data.geocodes[0].city || city };
    geocodeCache.set(address, point);
    return point;
  } catch {
    return null;
  }
}

function summarizeTransitLines(segments: unknown[]): string {
  const lines: string[] = [];
  for (const seg of segments) {
    const s = seg as { bus?: { buslines?: { name?: string }[] } };
    if (s.bus?.buslines?.length) {
      for (const bl of s.bus.buslines) {
        if (bl.name) lines.push(bl.name.replace(/\(.*\)$/, '').trim());
      }
    }
  }
  return lines.length ? lines.join(' → ') : '公交/地铁';
}

async function fetchGaodeTransitRaw(
  fromGeo: GeoPoint,
  toGeo: GeoPoint,
  fromAddress: string
): Promise<{
  minutes: number;
  distanceKm?: number;
  pathSummary: string;
} | null> {
  const apiKey = getGaodeKey();
  if (!apiKey) return null;

  const city = fromGeo.city || toGeo.city || inferCity(fromAddress);
  const url =
    `https://restapi.amap.com/v3/direction/transit/integrated?origin=${fromGeo.lng},${fromGeo.lat}` +
    `&destination=${toGeo.lng},${toGeo.lat}&city=${encodeURIComponent(city)}&key=${apiKey}`;

  apiCalls++;
  const data = await withGaodeRetry(
    async () => {
      const res = await fetch(url);
      return (await res.json()) as {
        status?: string;
        info?: string;
        infocode?: string;
        route?: {
          transits?: {
            duration?: string | number;
            distance?: string | number;
            segments?: unknown[];
          }[];
        };
      };
    },
    (payload) =>
      typeof payload === 'object' &&
      payload !== null &&
      isGaodeRateLimitError(
        (payload as { info?: string }).info,
        (payload as { infocode?: string }).infocode
      )
  );

  if (isGaodeRateLimitError(data.info, data.infocode)) return null;
  if (data.status !== '1' || !data.route?.transits?.length) return null;

  const best = data.route.transits.reduce((a, b) =>
    Number(a.duration || 0) <= Number(b.duration || 0) ? a : b
  );
  const seconds = Number(best.duration || 0);
  const minutes = Math.max(5, Math.round(seconds / 60));
  if (!minutes || minutes > 600) return null;

  const lineSummary = summarizeTransitLines(best.segments || []);
  const distanceKm = best.distance ? Math.round(Number(best.distance) / 100) / 10 : undefined;
  return {
    minutes,
    distanceKm,
    pathSummary: `公交/地铁：${lineSummary}，约 ${minutes} 分钟`,
  };
}

async function callGaodeTransit(
  fromAddress: string,
  toAddress: string,
  parkName: string
): Promise<RouteEstimate> {
  if (!getGaodeKey()) return localFallback(fromAddress, toAddress, parkName);

  const fromGeo = await geocodeAddress(fromAddress);
  const toGeo = await geocodeAddress(toAddress);
  if (!fromGeo || !toGeo) {
    return localFallback(fromAddress, toAddress, parkName);
  }

  const raw = await fetchGaodeTransitRaw(fromGeo, toGeo, fromAddress);
  if (!raw) return localFallback(fromAddress, toAddress, parkName);

  return {
    minutes: raw.minutes,
    distanceKm: raw.distanceKm,
    pathSummary: `公交/地铁：${fromAddress} → ${toAddress}，${raw.pathSummary.replace(/^公交\/地铁：/, '')}`,
    source: 'transit',
  };
}

async function callDeepSeek(
  departureAddress: string,
  customerAddress: string,
  parkName: string,
  companyName?: string
): Promise<RouteEstimate> {
  const apiKey = getDeepSeekKey();
  if (!apiKey) return localFallback(departureAddress, customerAddress, parkName);

  const prompt = `你是中国交通通勤估算助手。请估算员工从出发地驾车到客户拜访地址的单程通勤时间。

员工出发地：${departureAddress}
客户公司：${companyName || '未知'}
客户拜访地址：${customerAddress}
客户所属招商园区：${parkName}

请结合园区地理位置与出发地，给出合理的驾车通勤估算（工作日非高峰）。只返回 JSON：
{
  "minutes": 数字（整数，单程分钟数）,
  "distanceKm": 数字（可选，公里数）,
  "pathSummary": "一句话说明路线合理性，含出发地→园区/拜访地址"
}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '只输出合法 JSON，不要 markdown。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`DeepSeek API 失败 ${res.status}: ${errText.slice(0, 200)}`);
    return localFallback(departureAddress, customerAddress, parkName);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return localFallback(departureAddress, customerAddress, parkName);

  try {
    const parsed = JSON.parse(content) as {
      minutes?: number;
      distanceKm?: number;
      pathSummary?: string;
    };
    const minutes = Math.max(5, Math.round(Number(parsed.minutes) || 0));
    if (!minutes || minutes > 600) {
      return localFallback(departureAddress, customerAddress, parkName);
    }
    return {
      minutes,
      distanceKm: parsed.distanceKm ? Number(parsed.distanceKm) : undefined,
      pathSummary: parsed.pathSummary || `${departureAddress} → ${customerAddress}，约 ${minutes} 分钟`,
      source: 'deepseek',
    };
  } catch {
    return localFallback(departureAddress, customerAddress, parkName);
  }
}

/** 按模式估算单条路线（内存 → 磁盘 → API → 本地降级） */
export async function estimateRouteWithMode(
  fromAddress: string,
  toAddress: string,
  parkName: string,
  companyName?: string,
  mode: CommuteMode = getDefaultCommuteMode()
): Promise<RouteEstimate> {
  if (mode === 'local') return localFallback(fromAddress, toAddress, parkName);

  const key = routeCacheKey(fromAddress, toAddress, mode);
  const mem = routeCache.get(key);
  if (mem) {
    memoryHits++;
    return mem;
  }

  if (mode === 'transit') {
    const diskKey = legCacheKey(fromAddress, toAddress);
    const disk = getTransitFromDisk(diskKey);
    if (disk) {
      diskHits++;
      routeCache.set(key, disk);
      return disk;
    }
  }

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const promise = (mode === 'transit'
    ? callGaodeTransit(fromAddress, toAddress, parkName)
    : callDeepSeek(fromAddress, toAddress, parkName, companyName)
  )
    .then((result) => {
      routeCache.set(key, result);
      if (result.source === 'transit') {
        saveTransitToDisk(legCacheKey(fromAddress, toAddress), result);
      }
      pending.delete(key);
      return result;
    })
    .catch(() => {
      const fallback = localFallback(fromAddress, toAddress, parkName);
      routeCache.set(key, fallback);
      pending.delete(key);
      return fallback;
    });

  pending.set(key, promise);
  return promise;
}

export async function estimateRoute(
  departureAddress: string,
  customerAddress: string,
  parkName: string,
  companyName?: string,
  mode?: CommuteMode
): Promise<RouteEstimate> {
  return estimateRouteWithMode(
    departureAddress,
    customerAddress,
    parkName,
    companyName,
    mode ?? getDefaultCommuteMode()
  );
}

export type CommuteMatrix = RouteEstimate[][];

export function buildLocalCommuteMatrix(
  customers: { address: string; parkName: string; companyName: string }[],
  employees: { departureAddress: string }[],
  eligibleMask: boolean[][]
): CommuteMatrix {
  const matrix: CommuteMatrix = customers.map(() =>
    employees.map(() => ({ minutes: 0, pathSummary: '', source: 'local' as const }))
  );

  for (let i = 0; i < customers.length; i++) {
    for (let j = 0; j < employees.length; j++) {
      if (!eligibleMask[i]?.[j]) continue;
      const c = customers[i];
      const e = employees[j];
      matrix[i][j] = localFallback(e.departureAddress, c.address, c.parkName);
    }
  }

  return matrix;
}

/** 仅为合规候选对批量估算通勤（按需 + 限流 + 缓存） */
export async function buildCommuteMatrix(
  customers: { address: string; parkName: string; companyName: string }[],
  employees: { departureAddress: string }[],
  eligibleMask: boolean[][],
  mode: CommuteMode = 'local',
  legCache?: LegCache
): Promise<CommuteMatrix> {
  if (mode === 'local') {
    return buildLocalCommuteMatrix(customers, employees, eligibleMask);
  }

  const matrix: CommuteMatrix = customers.map(() =>
    employees.map(() => ({ minutes: 0, pathSummary: '', source: 'local' as const }))
  );

  const tasks: { i: number; j: number }[] = [];
  for (let i = 0; i < customers.length; i++) {
    for (let j = 0; j < employees.length; j++) {
      if (eligibleMask[i]?.[j]) tasks.push({ i, j });
    }
  }

  if (mode === 'transit' && tasks.length > 0) {
    loadTransitDiskCache();
    console.log(
      `  [transit] 按需计算 ${tasks.length} 条路线（QPS=${process.env.GAODE_QPS || 1}，磁盘缓存 ${getTransitDiskCacheStats().entries} 条）`
    );
  }

  for (const { i, j } of tasks) {
    const c = customers[i];
    const e = employees[j];
    const cached = getLegFromCache(e.departureAddress, c.address, legCache);
    matrix[i][j] =
      cached ||
      (await estimateRouteWithMode(
        e.departureAddress,
        c.address,
        c.parkName,
        c.companyName,
        mode
      ));
    if (legCache) legCache.set(legCacheKey(e.departureAddress, c.address), matrix[i][j]);
  }

  if (mode === 'transit') flushTransitDiskCache();
  return matrix;
}

/** 预热串联段公交/地铁（客户↔客户），优先磁盘缓存，按需调 API */
export async function warmChainedTransitLegs(
  addresses: string[],
  legCache: LegCache,
  maxNewFetches = 500
): Promise<void> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const missing: { from: string; to: string }[] = [];

  for (const from of unique) {
    for (const to of unique) {
      if (from === to) continue;
      if (getLegFromCache(from, to, legCache)) continue;
      const disk = getTransitFromDisk(legCacheKey(from, to));
      if (disk) {
        legCache.set(legCacheKey(from, to), disk);
        continue;
      }
      missing.push({ from, to });
    }
  }

  if (missing.length === 0) return;

  const toFetch = missing.slice(0, maxNewFetches);
  console.log(
    `  [transit] 串联预热 ${toFetch.length}/${missing.length} 条（已有磁盘/内存 ${unique.length * (unique.length - 1) - missing.length} 条）`
  );

  for (const { from, to } of toFetch) {
    const est = await estimateRouteWithMode(from, to, '', undefined, 'transit');
    legCache.set(legCacheKey(from, to), est);
  }
  flushTransitDiskCache();
}

export function resolveDistanceSource(commuteMatrix?: CommuteMatrix): DistanceSource {
  if (!commuteMatrix) return 'local';
  let hasDeepseek = false;
  let hasTransit = false;
  let hasLocal = false;
  for (const row of commuteMatrix) {
    for (const cell of row) {
      if (cell.source === 'deepseek') hasDeepseek = true;
      if (cell.source === 'transit') hasTransit = true;
      if (cell.source === 'local') hasLocal = true;
    }
  }
  const kinds = [hasDeepseek, hasTransit, hasLocal].filter(Boolean).length;
  if (kinds > 1) return 'mixed';
  if (hasTransit) return 'transit';
  if (hasDeepseek) return 'deepseek';
  return 'local';
}

/** 启动时加载 .env 与磁盘公交缓存 */
export function loadEnvFile(): void {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
    configureGaodeLimiter(Number(process.env.GAODE_QPS) || 1);
    loadTransitDiskCache();
  } catch {
    /* ignore */
  }
}

loadEnvFile();
