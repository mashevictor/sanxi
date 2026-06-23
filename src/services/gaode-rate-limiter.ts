/**
 * 高德 API 全局限流队列：所有 geocode / transit 请求串行过队，避免 QPS 超限
 */

export interface GaodeLimiterStats {
  queued: number;
  completed: number;
  rateLimited: number;
  retries: number;
}

let minIntervalMs = 600;
let lastCallAt = 0;
let chain: Promise<void> = Promise.resolve();

const stats: GaodeLimiterStats = {
  queued: 0,
  completed: 0,
  rateLimited: 0,
  retries: 0,
};

export function configureGaodeLimiter(qps?: number): void {
  const n = Number(qps ?? process.env.GAODE_QPS ?? 1);
  const safe = Number.isFinite(n) && n > 0 ? n : 1;
  minIntervalMs = Math.ceil(1000 / Math.min(safe, 5));
}

export function getGaodeLimiterStats(): GaodeLimiterStats {
  return { ...stats };
}

export function resetGaodeLimiterStats(): void {
  stats.queued = 0;
  stats.completed = 0;
  stats.rateLimited = 0;
  stats.retries = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 将高德 HTTP 请求排入全局队列 */
export function enqueueGaodeRequest<T>(fn: () => Promise<T>): Promise<T> {
  stats.queued++;
  const run = async (): Promise<T> => {
    const wait = minIntervalMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    const result = await fn();
    stats.completed++;
    return result;
  };

  const resultPromise = chain.then(run);
  chain = resultPromise.then(
    () => undefined,
    () => undefined
  );
  return resultPromise;
}

export function isGaodeRateLimitError(info?: string, infocode?: string): boolean {
  const text = (info || '').toUpperCase();
  return (
    text.includes('EXCEEDED') ||
    text.includes('QPS') ||
    text.includes('OVER') ||
    infocode === '10021' ||
    infocode === '10003'
  );
}

/** QPS 超限时指数退避重试（根据响应内容判断） */
export async function withGaodeRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  maxRetries = 5
): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await enqueueGaodeRequest(fn);
    if (!shouldRetry(last) || attempt >= maxRetries) return last;
    stats.rateLimited++;
    stats.retries++;
    const backoff = 800 + attempt * 500 + Math.floor(Math.random() * 200);
    await sleep(backoff);
  }
  return last as T;
}

configureGaodeLimiter();
