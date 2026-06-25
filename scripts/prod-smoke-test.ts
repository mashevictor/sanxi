/**
 * 生产环境冒烟测试：静态缓存 + API 匹配
 * 运行: npx tsx scripts/prod-smoke-test.ts [baseUrl]
 */

const BASE = process.argv[2] || 'http://101.32.209.251';

type Result = { name: string; ok: boolean; ms: number; detail?: string };

async function timed<T>(name: string, fn: () => Promise<T>): Promise<{ name: string; ok: boolean; ms: number; detail?: string; value?: T }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { name, ok: true, ms: Date.now() - t0, value };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) };
  }
}

function normalizeIdList(ids: number[]): number[] {
  return ids.map(Number).filter((id) => !Number.isNaN(id));
}

function isIdSubset(sub: number[], sup: number[]): boolean {
  const set = new Set(normalizeIdList(sup));
  return normalizeIdList(sub).every((id) => set.has(id));
}

function sliceFullMatch(
  cache: { pairings: { customerId: number; employeeName: string }[]; fullMatchCustomerIds: number[] },
  customerIds: number[]
) {
  if (!isIdSubset(customerIds, cache.fullMatchCustomerIds)) return null;
  const set = new Set(customerIds);
  return cache.pairings.filter((p) => set.has(Number(p.customerId)));
}

async function fetchJson<T>(path: string, timeoutMs = 120000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function main() {
  console.log(`\n=== 生产冒烟测试 ${BASE} ===\n`);
  const results: Result[] = [];

  const bootstrap = await timed('GET /api/bootstrap', () => fetchJson<{
    sessionId: string;
    dataVersion: string;
    manualPoolMeta?: { back: { customerIds: number[]; employeePoolIds: number[] }; front: { customerIds: number[]; employeePoolIds: number[] } };
  }>('/api/bootstrap', 30000));
  results.push({ name: bootstrap.name, ok: bootstrap.ok, ms: bootstrap.ms, detail: bootstrap.detail });
  if (!bootstrap.ok || !bootstrap.value) {
    printResults(results);
    process.exit(1);
  }
  const { sessionId, dataVersion, manualPoolMeta } = bootstrap.value;
  console.log(`  sessionId=${sessionId.slice(0, 8)}… dataVersion=${dataVersion}`);

  // 优先测 API（避免静态 JSON 下载慢导致误判）
  if (manualPoolMeta?.back) {
    const dispatchBack = await timed('POST /api/dispatch/select 后道全量', async () => {
      const { customerIds, employeePoolIds } = manualPoolMeta.back;
      const t0 = Date.now();
      const res = await fetch(`${BASE}/api/dispatch/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, customerIds, employeePoolIds, commuteMode: 'transit' }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.stats?.matched !== 41) throw new Error(`匹配 ${data.stats?.matched}/41`);
      return { ms: Date.now() - t0, message: String(data.message || '') };
    });
    results.push({
      name: dispatchBack.name,
      ok: dispatchBack.ok && (dispatchBack.value?.ms ?? 99999) < 20000,
      ms: dispatchBack.ms,
      detail: dispatchBack.ok
        ? `${dispatchBack.value!.ms}ms · ${dispatchBack.value!.message.slice(0, 36)}`
        : dispatchBack.detail,
    });
  }

  const dispatchOne = await timed('POST /api/dispatch/select 单公司[1]', async () => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/dispatch/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, customerIds: [1], commuteMode: 'transit' }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.stats?.matched !== 1) throw new Error(`匹配 ${data.stats?.matched}/1`);
    const emp = data.pairings?.[0]?.employeeName;
    return `${Date.now() - t0}ms → ${emp}`;
  });
  results.push({ name: dispatchOne.name, ok: dispatchOne.ok, ms: dispatchOne.ms, detail: String(dispatchOne.value ?? dispatchOne.detail) });

  const sample = await timed('GET /cache/sample-data.json', () => fetchJson<{ companies: unknown[]; employees: unknown[]; dataVersion: string }>('/cache/sample-data.json'));
  results.push({
    name: sample.name,
    ok: sample.ok && (sample.value?.companies?.length ?? 0) >= 55,
    ms: sample.ms,
    detail: sample.ok ? `${sample.value?.companies?.length} 公司 · ${sample.value?.employees?.length} 员工 · ver=${sample.value?.dataVersion}` : sample.detail,
  });

  const full = await timed('GET /cache/full-match.json', () => fetchJson<{
    dataVersion: string;
    fullMatchCustomerIds: number[];
    pairings: { customerId: number; employeeName: string; companyName: string }[];
    stats: { matched: number; selected: number };
    message?: string;
  }>('/cache/full-match.json'));
  results.push({
    name: full.name,
    ok: full.ok && full.value?.stats?.matched === 55,
    ms: full.ms,
    detail: full.ok ? `${full.value?.stats.matched}/${full.value?.stats.selected} · ver=${full.value?.dataVersion}` : full.detail,
  });

  if (full.ok && full.value) {
    const dispatchFull = await timed('POST /api/dispatch/select 全量55', async () => {
      const ids = full.value!.fullMatchCustomerIds;
      const t0 = Date.now();
      const res = await fetch(`${BASE}/api/dispatch/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, customerIds: ids, commuteMode: 'transit' }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.stats?.matched !== 55) throw new Error(`匹配 ${data.stats?.matched}/55`);
      return { ms: Date.now() - t0, message: String(data.message || '') };
    });
    results.push({
      name: dispatchFull.name,
      ok: dispatchFull.ok && (dispatchFull.value?.ms ?? 9999) < 20000,
      ms: dispatchFull.ms,
      detail: dispatchFull.ok
        ? `${dispatchFull.value!.ms}ms · ${dispatchFull.value!.message.slice(0, 36)}`
        : dispatchFull.detail,
    });
  }

  const back = await timed('GET /cache/manual-pool-back.json', () => fetchJson<{ dispatch: { stats: { matched: number; selected: number } }; dataVersion: string }>('/cache/manual-pool-back.json'));
  results.push({
    name: back.name,
    ok: back.ok && back.value?.dispatch?.stats?.matched === 41,
    ms: back.ms,
    detail: back.ok ? `后道 ${back.value?.dispatch.stats.matched}/${back.value?.dispatch.stats.selected}` : back.detail,
  });

  const front = await timed('GET /cache/manual-pool-front.json', () => fetchJson<{ dispatch: { stats: { matched: number; selected: number } } }>('/cache/manual-pool-front.json'));
  results.push({
    name: front.name,
    ok: front.ok && front.value?.dispatch?.stats?.matched === 6,
    ms: front.ms,
    detail: front.ok ? `前道 ${front.value?.dispatch.stats.matched}/${front.value?.dispatch.stats.selected}` : front.detail,
  });

  if (full.ok && full.value) {
    const sliced = sliceFullMatch(full.value, [1, 2]);
    const aiOk = sliced?.length === 2 && sliced.every((p) => p.employeeName);
    results.push({
      name: 'AI 缓存切片 [1,2]',
      ok: !!aiOk,
      ms: 0,
      detail: aiOk
        ? sliced!.map((p) => `${p.companyName.slice(0, 8)}→${p.employeeName}`).join(' · ')
        : `期望 2 条，实际 ${sliced?.length ?? 0}`,
    });
  }

  const verOk =
    full.value?.dataVersion === dataVersion &&
    back.value?.dataVersion === dataVersion &&
    (!sample.ok || sample.value?.dataVersion === dataVersion);
  results.push({
    name: '缓存版本与 bootstrap 一致',
    ok: !!verOk,
    ms: 0,
    detail: verOk ? dataVersion : `bootstrap=${dataVersion} sample=${sample.value?.dataVersion} full=${full.value?.dataVersion}`,
  });

  const shared = await timed('GET /match-shared.js', async () => {
    const res = await fetch(`${BASE}/match-shared.js?v=${dataVersion}`, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (!text.includes('function getManualPoolCacheUrl')) throw new Error('缺少 getManualPoolCacheUrl');
    if (!text.includes('function sliceFullMatchCacheForAi')) throw new Error('缺少 sliceFullMatchCacheForAi');
    if (!text.includes('function normalizeIdList')) throw new Error('缺少 normalizeIdList');
    return text.length;
  });
  results.push({ name: shared.name, ok: shared.ok, ms: shared.ms, detail: shared.ok ? `${shared.value} bytes OK` : shared.detail });

  for (const page of ['/manual-match.html', '/match.html']) {
    const p = await timed(`GET ${page}`, async () => {
      const res = await fetch(`${BASE}${page}`, { signal: AbortSignal.timeout(30000) });
      const html = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!html.includes(dataVersion)) throw new Error(`HTML 未含版本 ${dataVersion}`);
      if (!html.includes('match-shared.js')) throw new Error('缺少 match-shared.js');
      return html.length;
    });
    results.push({ name: p.name, ok: p.ok, ms: p.ms, detail: p.ok ? `${p.value} bytes · ver OK` : p.detail });
  }

  printResults(results);
  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
}

function printResults(results: Result[]) {
  console.log('');
  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    const ms = r.ms ? ` ${r.ms}ms` : '';
    console.log(`${mark} ${r.name}${ms}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok) allOk = false;
  }
  console.log(allOk ? '\n全部通过\n' : '\n存在失败项\n');
}

main();
