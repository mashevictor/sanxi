/**
 * 公交/地铁路线磁盘缓存：避免重复调用高德 API
 */

import fs from 'fs';
import path from 'path';

interface DiskRoute {
  minutes: number;
  distanceKm?: number;
  pathSummary: string;
  source: 'transit';
  savedAt: string;
}

export interface TransitDiskCacheStats {
  hits: number;
  misses: number;
  saved: number;
  entries: number;
}

const CACHE_FILE = path.join(__dirname, '../../public/cache/transit-routes.json');
let store: Record<string, DiskRoute> = {};
let loaded = false;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const stats: TransitDiskCacheStats = {
  hits: 0,
  misses: 0,
  saved: 0,
  entries: 0,
};

export function getTransitDiskCacheStats(): TransitDiskCacheStats {
  return { ...stats, entries: Object.keys(store).length };
}

export function resetTransitDiskCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.saved = 0;
}

export function loadTransitDiskCache(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      store = {};
      return;
    }
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    store = JSON.parse(raw) as Record<string, DiskRoute>;
    stats.entries = Object.keys(store).length;
  } catch {
    store = {};
  }
}

export function getTransitFromDisk(key: string): {
  minutes: number;
  distanceKm?: number;
  pathSummary: string;
  source: 'transit';
} | undefined {
  loadTransitDiskCache();
  const hit = store[key];
  if (!hit) {
    stats.misses++;
    return undefined;
  }
  stats.hits++;
  return {
    minutes: hit.minutes,
    distanceKm: hit.distanceKm,
    pathSummary: hit.pathSummary,
    source: hit.source,
  };
}

export function saveTransitToDisk(
  key: string,
  route: { minutes: number; distanceKm?: number; pathSummary: string; source: string }
): void {
  if (route.source !== 'transit') return;
  loadTransitDiskCache();
  store[key] = {
    minutes: route.minutes,
    distanceKm: route.distanceKm,
    pathSummary: route.pathSummary,
    source: route.source,
    savedAt: new Date().toISOString(),
  };
  stats.saved++;
  dirty = true;
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushTransitDiskCache();
  }, 2000);
}

export function flushTransitDiskCache(): void {
  if (!dirty) return;
  try {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 0), 'utf-8');
    dirty = false;
    stats.entries = Object.keys(store).length;
  } catch (err) {
    console.warn('公交缓存写入失败:', err instanceof Error ? err.message : err);
  }
}
