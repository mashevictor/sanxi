/**
 * 清理公交磁盘缓存中的绕远/不合理路线
 * 运行: npx tsx scripts/purge-transit-detours.ts
 */

import fs from 'fs';
import path from 'path';
import { isSuspiciousCachedTransit } from '../src/utils/transit-reasonable';

const CACHE_FILE = path.join(__dirname, '../public/cache/transit-routes.json');

interface DiskRoute {
  minutes: number;
  distanceKm?: number;
  pathSummary: string;
  source: string;
  straightKm?: number;
  savedAt?: string;
}

function main() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.log('无 transit-routes.json');
    return;
  }

  const store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Record<string, DiskRoute>;
  const keys = Object.keys(store);
  const removed: { key: string; minutes: number; km?: number; reason: string }[] = [];
  const kept: Record<string, DiskRoute> = {};

  for (const key of keys) {
    const route = store[key];
    const [from, to] = key.split('|');
    if (!from || !to) {
      kept[key] = route;
      continue;
    }
    if (isSuspiciousCachedTransit(route, from, to)) {
      removed.push({
        key,
        minutes: route.minutes,
        km: route.distanceKm,
        reason: (route.pathSummary || '').slice(0, 80),
      });
    } else {
      kept[key] = route;
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(kept), 'utf-8');
  console.log(`\n=== 公交缓存绕远清理 ===\n`);
  console.log(`原条目: ${keys.length}  删除: ${removed.length}  保留: ${Object.keys(kept).length}`);
  removed
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 20)
    .forEach((r, i) => {
      console.log(`${i + 1}. ${r.minutes}分 ${r.km ?? '?'}km | ${r.key.slice(0, 60)}…`);
    });
  if (removed.length > 20) console.log(`… 另有 ${removed.length - 20} 条`);
}

main();
