/**
 * 分析超 60 分派单：是否存在通勤更短的合规替代员工（仅用磁盘缓存，不调 API）
 * 运行: npx tsx scripts/analyze-over60-alternatives.ts
 */

process.env.GAODE_API_KEY = '';

import fs from 'fs';
import path from 'path';
import { buildIntegratedData } from '../src/data/integrated-data';
import { matchCustomerToEmployee } from '../src/services/match-rules';
import { legCacheKey, LegCache } from '../src/services/distance-service';
import { loadTransitDiskCache, getTransitFromDisk } from '../src/services/transit-disk-cache';
import { getCommuteOriginForNextStop, estimateCommuteMinutes } from '../src/utils/commute';
import { Customer, Employee } from '../src/types';

const MAX = 60;
const DATA_DIR = path.join(__dirname, '..');

interface ReportPairing {
  company: string;
  employee: string;
  slot: string;
  commute: number;
}

function preloadLegCache(): LegCache {
  loadTransitDiskCache();
  const cache: LegCache = new Map();
  const file = path.join(DATA_DIR, 'public/cache/transit-routes.json');
  if (fs.existsSync(file)) {
    const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
      string,
      { minutes: number; pathSummary: string; source: 'transit' }
    >;
    for (const [k, v] of Object.entries(store)) {
      cache.set(k, { minutes: v.minutes, pathSummary: v.pathSummary, source: 'transit' });
    }
  }
  return cache;
}

function legMinutes(from: string, to: string, legCache: LegCache): number {
  const key = legCacheKey(from, to);
  const hit = legCache.get(key) || getTransitFromDisk(key);
  if (hit) return hit.minutes;
  return estimateCommuteMinutes(from, to);
}

function chainedMinutes(
  customer: Customer,
  employee: Employee,
  assignedOthers: Customer[],
  legCache: LegCache
): number {
  const from = getCommuteOriginForNextStop(employee, assignedOthers, customer);
  return legMinutes(from, customer.address, legCache);
}

function main() {
  const legCache = preloadLegCache();
  const data = buildIntegratedData(DATA_DIR);

  const reportPath = path.join(DATA_DIR, 'public/cache/validate-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as {
    pairings: ReportPairing[];
    issues: { level: string; company: string; employee: string; message: string }[];
  };

  const customerByName = new Map(data.customers.map((c) => [c.companyName, c]));
  const employeeByName = new Map(data.employees.map((e) => [e.name, e]));
  const availableNames = new Set(data.employees.map((e) => e.name));

  const pairings = report.pairings.map((p) => {
    const customer = customerByName.get(p.company)!;
    const employee = employeeByName.get(p.employee)!;
    return { customer, employee, slot: p.slot, commute: p.commute };
  });

  const assignments = new Map<number, number[]>();
  for (const p of pairings) {
    const list = assignments.get(p.employee.id) || [];
    list.push(p.customer.id);
    assignments.set(p.employee.id, list);
  }

  const over60 = pairings.filter((p) => p.commute > MAX);
  console.log(`\n已加载公交缓存 ${legCache.size} 条`);
  console.log(`=== 超 ${MAX} 分派单替代分析（共 ${over60.length} 条，来自 validate-report）===\n`);

  let alreadyBest = 0;
  let hasBetter = 0;
  let allOver60 = 0;
  let slotBlocked = 0;

  for (const p of over60.sort((a, b) => b.commute - a.commute)) {
    const { customer, employee: chosen } = p;
    console.log(`【${customer.companyName}】${p.slot} → ${chosen.name}（${p.commute} 分）`);
    if (customer.designatedPerson) console.log(`  指定人: ${customer.designatedPerson}`);
    if (customer.rejectedPerson) console.log(`  放弃人: ${customer.rejectedPerson}`);

    const alternatives: { name: string; minutes: number; slotBusy?: string }[] = [];

    for (const emp of data.employees) {
      const empAssigned = (assignments.get(emp.id) || [])
        .filter((id) => id !== customer.id)
        .map((id) => data.customers.find((c) => c.id === id)!)
        .filter(Boolean);

      const match = matchCustomerToEmployee(customer, emp, availableNames, empAssigned, {
        requirePlus: false,
      });
      if (!match.eligible) continue;

      const minutes = chainedMinutes(customer, emp, empAssigned, legCache);
      const slotBlock = empAssigned.find((c) => c.timeSlot === customer.timeSlot);
      alternatives.push({ name: emp.name, minutes, slotBusy: slotBlock?.companyName });
    }

    alternatives.sort((a, b) => a.minutes - b.minutes);
    const best = alternatives[0];
    const within60 = alternatives.filter((a) => a.minutes <= MAX);

    if (customer.designatedPerson) {
      console.log(`  → 指定人「${customer.designatedPerson}」优先，通勤为硬约束让位`);
    } else if (best?.name === chosen.name) {
      alreadyBest++;
      if (within60.length === 0) {
        allOver60++;
        console.log(`  ✓ 已是合规候选中最短，但全员超 60（共 ${alternatives.length} 人）`);
        console.log(`  次优: ${alternatives.slice(1, 4).map((x) => `${x.name}(${x.minutes}分)`).join('、') || '无'}`);
      } else {
        console.log(`  ✓ 已是合规候选中通勤最短（${best.minutes} 分）`);
      }
    } else if (best && best.minutes < p.commute) {
      hasBetter++;
      console.log(
        `  ⚠ 有更短候选: ${best.name} ${best.minutes} 分（可省 ${p.commute - best.minutes} 分）`
      );
      if (within60.length) {
        console.log(
          `  ✓ 60 分内: ${within60.slice(0, 3).map((x) => `${x.name}(${x.minutes}分)`).join('、')}`
        );
      }
      console.log(
        `  合规 TOP5: ${alternatives.slice(0, 5).map((x) => `${x.name}(${x.minutes}分)`).join(' · ')}`
      );
      if (best.slotBusy) {
        slotBlocked++;
        console.log(`  原因: ${best.name} 同时段已被「${best.slotBusy}」占用`);
      } else {
        console.log(`  原因: 贪心派单顺序 / 下午捆绑 / Plus 分，未全局最优`);
      }
    }

    if (alternatives.length <= 4) {
      console.log(`  合规池仅 ${alternatives.length} 人: ${alternatives.map((a) => a.name).join('、')}`);
    }
    console.log('');
  }

  console.log('--- 汇总 ---');
  console.log(`超 60 分: ${over60.length} 条（其中 info 指定人约 5 条不计入 warn）`);
  console.log(`已是候选中最短: ${alreadyBest} 条`);
  console.log(`存在更短合规人但未选: ${hasBetter} 条（同时段冲突 ${slotBlocked} 条）`);
  console.log(`全员超 60、无 60 分内人选: ${allOver60} 条`);
}

main();
