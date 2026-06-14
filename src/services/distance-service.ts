/**
 * 通勤距离估算：优先 DeepSeek API，失败时降级到区域矩阵
 */

import fs from 'fs';
import path from 'path';
import { estimateCommuteMinutes } from '../utils/commute';

export interface RouteEstimate {
  minutes: number;
  distanceKm?: number;
  pathSummary: string;
  source: 'deepseek' | 'local';
}

const cache = new Map<string, RouteEstimate>();
const pending = new Map<string, Promise<RouteEstimate>>();

function cacheKey(from: string, to: string, parkName: string): string {
  return `${from}|${to}|${parkName}`;
}

function localFallback(from: string, to: string, parkName: string): RouteEstimate {
  const minutes = estimateCommuteMinutes(from, to);
  return {
    minutes,
    pathSummary: `本地估算：${from} → ${to}（园区 ${parkName}），约 ${minutes} 分钟`,
    source: 'local',
  };
}

function getApiKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}

async function callDeepSeek(
  departureAddress: string,
  customerAddress: string,
  parkName: string,
  companyName?: string
): Promise<RouteEstimate> {
  const apiKey = getApiKey();
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

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
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

/** 单条路线估算（带缓存） */
export async function estimateRoute(
  departureAddress: string,
  customerAddress: string,
  parkName: string,
  companyName?: string
): Promise<RouteEstimate> {
  const key = cacheKey(departureAddress, customerAddress, parkName);
  const cached = cache.get(key);
  if (cached) return cached;

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const promise = callDeepSeek(departureAddress, customerAddress, parkName, companyName)
    .then((result) => {
      cache.set(key, result);
      pending.delete(key);
      return result;
    })
    .catch(() => {
      const fallback = localFallback(departureAddress, customerAddress, parkName);
      cache.set(key, fallback);
      pending.delete(key);
      return fallback;
    });

  pending.set(key, promise);
  return promise;
}

export type CommuteMatrix = RouteEstimate[][];

/** 仅为合规候选对批量估算通勤（限制并发） */
export async function buildCommuteMatrix(
  customers: { address: string; parkName: string; companyName: string }[],
  employees: { departureAddress: string }[],
  eligibleMask: boolean[][]
): Promise<CommuteMatrix> {
  const tasks: { i: number; j: number }[] = [];
  for (let i = 0; i < customers.length; i++) {
    for (let j = 0; j < employees.length; j++) {
      if (eligibleMask[i]?.[j]) tasks.push({ i, j });
    }
  }

  const matrix: CommuteMatrix = customers.map(() =>
    employees.map(() => ({ minutes: 0, pathSummary: '', source: 'local' as const }))
  );

  const concurrency = 5;
  for (let k = 0; k < tasks.length; k += concurrency) {
    const batch = tasks.slice(k, k + concurrency);
    await Promise.all(
      batch.map(async ({ i, j }) => {
        const c = customers[i];
        const e = employees[j];
        matrix[i][j] = await estimateRoute(
          e.departureAddress,
          c.address,
          c.parkName,
          c.companyName
        );
      })
    );
  }

  return matrix;
}

/** 启动时加载 .env（不依赖 dotenv 包） */
export function loadEnvFile(): void {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;
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
  } catch {
    /* ignore */
  }
}
