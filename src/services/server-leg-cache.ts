/**
 * 服务端全局公交/步行 leg 磁盘缓存（dispatch 热路径复用，避免重复读盘）
 */

import { LegCache } from './distance-service';
import { hydrateLegCacheFromDisk } from './transit-disk-cache';

let serverLegCache: LegCache | null = null;

export function getServerLegCache(): LegCache {
  if (!serverLegCache) {
    serverLegCache = new Map();
    const n = hydrateLegCacheFromDisk(serverLegCache);
    console.log(`[leg-cache] 磁盘灌入 ${n} 条公交/步行路线`);
  }
  return serverLegCache;
}

export function resetServerLegCache(): void {
  serverLegCache = null;
}
