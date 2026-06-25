/**
 * 服务启动时预热派单磁盘缓存（full-match / manual-pool / leg）
 */

import { loadFullMatchCacheFile } from './full-match-cache';
import { loadManualPoolCacheFile, loadManualPoolPresetFile } from './manual-pool-cache';
import { getServerLegCache } from './server-leg-cache';

export function warmDispatchCaches(dataDir: string): void {
  const full = loadFullMatchCacheFile(dataDir);
  const back = loadManualPoolCacheFile(dataDir, 'back');
  const front = loadManualPoolCacheFile(dataDir, 'front');
  const jinshanPreset = loadManualPoolPresetFile(dataDir, 'back-jinshan-32-manual15');
  const backAll15 = loadManualPoolPresetFile(dataDir, 'back-all-manual15');
  const legs = getServerLegCache();
  console.log(
    `[warm] 派单缓存: full-match ${full?.pairings?.length ?? 0} 条 · 后道 ${back?.dispatch?.stats?.matched ?? 0} · 前道 ${front?.dispatch?.stats?.matched ?? 0} · 金山32+15 ${jinshanPreset?.dispatch?.stats?.matched ?? '—'} · 全量41+15 ${backAll15?.dispatch?.stats?.matched ?? '—'}/${backAll15?.customerIds?.length ?? '—'} · 公交 ${legs.size} 条`
  );
}
