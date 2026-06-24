/**
 * 预加载 public/cache/transit-routes.json 到内存（对比/校验脚本用，不调高德 API）
 */

import fs from 'fs';
import path from 'path';
import { LegCache } from '../src/services/distance-service';
import { loadTransitDiskCache } from '../src/services/transit-disk-cache';

export function preloadTransitLegCache(dataDir: string): LegCache {
  loadTransitDiskCache();
  const cache: LegCache = new Map();
  const file = path.join(dataDir, 'public/cache/transit-routes.json');
  if (!fs.existsSync(file)) return cache;
  const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
    string,
    { minutes: number; pathSummary: string; source: 'transit' }
  >;
  for (const [k, v] of Object.entries(store)) {
    cache.set(k, { minutes: v.minutes, pathSummary: v.pathSummary, source: 'transit' });
  }
  return cache;
}

/** 禁用高德 API，仅用磁盘缓存 + 本地降级（避免对比脚本长时间阻塞） */
export function useDiskTransitOnly(): void {
  delete process.env.GAODE_API_KEY;
}
