/**
 * 公交/地铁路线合理性：剔除绕远方案，按直线距离约束时长与路径长度
 */

export function extractShanghaiDistrict(address: string): string | null {
  const m = address.match(/上海市(\S+?)区/);
  return m?.[1] ?? null;
}

export function sameShanghaiDistrict(a: string, b: string): boolean {
  const d1 = extractShanghaiDistrict(a);
  const d2 = extractShanghaiDistrict(b);
  return !!(d1 && d2 && d1 === d2);
}

/** 按直线距离估算合理公交/地铁上限（分钟） */
export function reasonableTransitCapMinutes(straightKm: number): number {
  if (straightKm <= 0.5) return 15;
  return Math.min(90, Math.max(15, Math.round(straightKm * 7 + 15)));
}

/** 路径距离相对直线的最大允许倍数 */
export function maxPathDistanceKm(straightKm: number): number {
  if (straightKm < 1) return Math.max(2, straightKm * 3);
  if (straightKm < 3) return straightKm * 2.8;
  return straightKm * 2.5;
}

export interface RawTransitOption {
  duration?: string | number;
  distance?: string | number;
  segments?: unknown[];
}

/** 短途不应出现的绕远线路关键词 */
export function transitHasDetourLines(lineSummary: string, straightKm: number): boolean {
  if (/市域机场线|机场联络线|磁浮/.test(lineSummary)) {
    return straightKm < 30;
  }
  if (straightKm > 12) return false;
  if (straightKm < 8 && /枢纽\d*路.*→.*地铁1号线.*→.*地铁9号线/.test(lineSummary)) return true;
  return false;
}

export function isReasonableTransitOption(
  transit: RawTransitOption,
  straightKm: number,
  lineSummary: string
): boolean {
  const minutes = Math.round(Number(transit.duration || 0) / 60);
  const distKm = Number(transit.distance || 0) / 1000;
  const cap = reasonableTransitCapMinutes(straightKm);

  if (minutes <= 0 || minutes > 600) return false;
  if (minutes > cap) return false;
  if (transitHasDetourLines(lineSummary, straightKm)) return false;
  if (straightKm >= 0.8 && distKm > 0 && distKm > maxPathDistanceKm(straightKm)) return false;
  return true;
}

export function pickBestReasonableTransit(
  transits: RawTransitOption[],
  straightKm: number,
  summarizeLines: (segments: unknown[]) => string
): { minutes: number; distanceKm?: number; pathSummary: string; lineSummary: string } | null {
  type Scored = {
    minutes: number;
    distanceKm?: number;
    lineSummary: string;
    reasonable: boolean;
    duration: number;
  };

  const scored: Scored[] = transits.map((t) => {
    const lineSummary = summarizeLines(t.segments || []);
    const duration = Number(t.duration || 0);
    const minutes = Math.max(5, Math.round(duration / 60));
    const distKm = t.distance ? Number(t.distance) / 1000 : undefined;
    return {
      minutes,
      distanceKm: distKm,
      lineSummary,
      reasonable: isReasonableTransitOption(t, straightKm, lineSummary),
      duration,
    };
  });

  const pool = scored.filter((s) => s.reasonable);
  if (pool.length === 0) return null;

  const best = pool.reduce((a, b) => (a.duration <= b.duration ? a : b));
  return {
    minutes: best.minutes,
    distanceKm: best.distanceKm != null ? Math.round(best.distanceKm * 10) / 10 : undefined,
    lineSummary: best.lineSummary,
    pathSummary: `公交/地铁：${best.lineSummary}，约 ${best.minutes} 分钟`,
  };
}

export function estimateReasonableTransitFallback(
  straightKm: number,
  fromAddress: string,
  toAddress: string
): { minutes: number; distanceKm?: number; pathSummary: string } {
  const minutes = reasonableTransitCapMinutes(straightKm);
  const distHint = straightKm > 0 ? `直线约 ${straightKm.toFixed(1)} km，` : '';
  return {
    minutes,
    distanceKm: straightKm > 0 ? Math.round(straightKm * 10) / 10 : undefined,
    pathSummary: `公交/地铁：${fromAddress} → ${toAddress}，${distHint}区域合理估算约 ${minutes} 分钟（绕远方案已剔除）`,
  };
}

/** 无 geocode 时按地址粗估直线距离（km） */
export function estimateStraightKmHeuristic(from: string, to: string): number {
  if (sameShanghaiDistrict(from, to)) {
    const strip = (a: string) => a.replace(/^.+?(区|县)/, '').trim();
    const a = strip(from);
    const b = strip(to);
    let prefix = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len && a[i] === b[i]; i++) prefix++;
    const factor = 1 - prefix / Math.max(a.length, b.length, 1);
    return Math.max(1.5, Math.min(8, 2 + factor * 7));
  }
  const d1 = extractShanghaiDistrict(from);
  const d2 = extractShanghaiDistrict(to);
  if (d1 && d2) return 12;
  return 8;
}

export function isSuspiciousCachedTransit(
  route: {
    minutes: number;
    distanceKm?: number;
    pathSummary?: string;
    source?: string;
    straightKm?: number;
  },
  from: string,
  to: string
): boolean {
  if (route.source !== 'transit') return false;

  const sk = route.straightKm;
  if (sk != null && sk > 0) {
    if (route.distanceKm != null && route.distanceKm > maxPathDistanceKm(sk)) return true;
    if (route.minutes > reasonableTransitCapMinutes(sk) + 5) return true;
    if (transitHasDetourLines(route.pathSummary || '', sk)) return true;
  }

  if (sameShanghaiDistrict(from, to)) {
    if (route.minutes >= 58) return true;
    if (route.distanceKm != null && route.distanceKm > 15) return true;
    if (/市域机场线|机场联络线|磁浮/.test(route.pathSummary || '')) return true;
  }

  const d1 = extractShanghaiDistrict(from);
  const d2 = extractShanghaiDistrict(to);
  if (d1 && d2 && d1 !== d2 && /市域机场线|机场联络线|磁浮/.test(route.pathSummary || '')) {
    if (route.minutes >= 70) return true;
    if (route.distanceKm != null && route.distanceKm > 22) return true;
  }

  return false;
}
