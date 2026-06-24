/**
 * 全量审计：整合数据所有地址对的磁盘公交缓存 + 匹配结果中的串联段
 * 运行: npx tsx scripts/audit-transit-detours.ts
 */

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import {
  isSuspiciousCachedTransit,
  reasonableTransitCapMinutes,
  sameShanghaiDistrict,
} from '../src/utils/transit-reasonable';

const DATA_DIR = path.join(__dirname, '..');
const CACHE_FILE = path.join(DATA_DIR, 'public/cache/transit-routes.json');
const OUT_FILE = path.join(DATA_DIR, 'public/cache/transit-detour-audit.json');

function main() {
  const integrated = buildIntegratedData(DATA_DIR);
  const addresses = [
    ...new Set([
      ...integrated.customers.map((c) => c.address),
      ...integrated.employees.map((e) => e.departureAddress),
    ]),
  ].filter(Boolean);

  const cache = fs.existsSync(CACHE_FILE)
    ? (JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Record<
        string,
        {
          minutes: number;
          distanceKm?: number;
          pathSummary?: string;
          source?: string;
          straightKm?: number;
        }
      >)
    : {};

  const usedKeys = new Set<string>();
  for (const p of integrated.customers) {
    for (const e of integrated.employees) {
      usedKeys.add(`${e.departureAddress}|${p.address}`);
    }
    for (const c2 of integrated.customers) {
      if (c2.id === p.id) continue;
      usedKeys.add(`${p.address}|${c2.address}`);
    }
  }

  const suspicious: {
    key: string;
    minutes: number;
    distanceKm?: number;
    straightKm?: number;
    cap?: number;
    sameDistrict: boolean;
    path: string;
  }[] = [];

  for (const key of usedKeys) {
    const hit = cache[key];
    if (!hit || hit.source !== 'transit') continue;
    const [from, to] = key.split('|');
    if (!isSuspiciousCachedTransit(hit, from, to)) continue;
    const sk = hit.straightKm;
    suspicious.push({
      key,
      minutes: hit.minutes,
      distanceKm: hit.distanceKm,
      straightKm: sk,
      cap: sk != null ? reasonableTransitCapMinutes(sk) : undefined,
      sameDistrict: sameShanghaiDistrict(from, to),
      path: (hit.pathSummary || '').slice(0, 120),
    });
  }

  suspicious.sort((a, b) => b.minutes - a.minutes);

  const report = {
    generatedAt: new Date().toISOString(),
    addressCount: addresses.length,
    cacheEntries: Object.keys(cache).length,
    relevantKeys: usedKeys.size,
    suspiciousInUse: suspicious.length,
    top: suspicious.slice(0, 40),
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n=== 公交绕远审计（业务相关 ${usedKeys.size} 对）===\n`);
  console.log(`可疑缓存: ${suspicious.length} 条`);
  suspicious.slice(0, 15).forEach((s, i) => {
    console.log(
      `${i + 1}. ${s.minutes}分 ${s.distanceKm ?? '?'}km 同区=${s.sameDistrict} | ${s.key.slice(0, 55)}…`
    );
  });
  console.log(`\n报告: ${OUT_FILE}`);
}

main();
