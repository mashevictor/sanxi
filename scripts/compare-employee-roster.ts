/**
 * 对比 55 条全量匹配 vs 派单员工表 (1).xls（员工主数据 27 人）
 * 运行: npm run compare:employee
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const DATA_DIR = path.join(__dirname, '..');
const EMP_XLS = path.join(DATA_DIR, '派单员工表 (1).xls');
const CACHE_PATH = path.join(DATA_DIR, 'public', 'cache', 'full-match.json');
const OUT_HTML = path.join(DATA_DIR, 'public', 'compare-employee-roster.html');

interface RosterEmp {
  name: string;
  city: string;
  park: string;
  roles: string;
  status: string;
  departureAddress: string;
  plusCap: string;
  capacity: string;
  remark: string;
}

interface Pairing {
  customerId: number;
  companyName: string;
  timeSlot: string;
  customerType: string;
  parkName: string;
  employeeId: number;
  employeeName: string;
  departureAddress: string;
}

type MatchKind =
  | 'full_match'
  | 'addr_diff'
  | 'gap_fill'
  | 'demo_emp'
  | 'not_in_roster';

interface OrderCompare {
  pairing: Pairing;
  roster: RosterEmp | null;
  kind: MatchKind;
  reason: string;
}

function norm(s: string): string {
  return (s || '').trim().replace(/\s+/g, '');
}

function addrSame(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

function readRoster(filePath: string): RosterEmp[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const rows = raw.slice(2) as string[][];
  return rows
    .filter((r) => r[0] && String(r[0]).trim())
    .map((r) => ({
      name: String(r[0]).trim(),
      city: String(r[1] || ''),
      park: String(r[2] || ''),
      roles: String(r[3] || ''),
      status: String(r[4] || ''),
      departureAddress: String(r[5] || ''),
      plusCap: String(r[6] || ''),
      capacity: String(r[7] || ''),
      remark: r[8] ? String(r[8]) : '',
    }));
}

function loadPairings(): Pairing[] {
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  return (cache.pairings || []).map((p: Record<string, unknown>) => ({
    customerId: Number(p.customerId),
    companyName: String(p.companyName),
    timeSlot: String(p.timeSlot),
    customerType: String(p.customerType),
    parkName: String(p.parkName || ''),
    employeeId: Number(p.employeeId),
    employeeName: String(p.employeeName),
    departureAddress: String(p.departureAddress || ''),
  }));
}

function classify(pair: Pairing, rosterByName: Map<string, RosterEmp>): OrderCompare {
  if (pair.employeeId >= 90201 || pair.employeeName.startsWith('补位-')) {
    return {
      pairing: pair,
      roster: null,
      kind: 'gap_fill',
      reason: '补位员工为系统新增（ID≥90201），不在员工表 27 人中，用于下午2/外埠园区全匹配。',
    };
  }
  if (pair.employeeId >= 90001 && pair.employeeId <= 90010) {
    return {
      pairing: pair,
      roster: rosterByName.get(pair.employeeName) || null,
      kind: 'demo_emp',
      reason: '演示员工（ID 90001–90005），为 10 家演示公司专门配置，不在原始员工表。',
    };
  }

  const roster = rosterByName.get(pair.employeeName);
  if (!roster) {
    return {
      pairing: pair,
      roster: null,
      kind: 'not_in_roster',
      reason: `员工「${pair.employeeName}」不在派单员工表中。`,
    };
  }

  if (addrSame(pair.departureAddress, roster.departureAddress)) {
    return {
      pairing: pair,
      roster,
      kind: 'full_match',
      reason: '指派员工在员工表中，且出发地址与表一致。',
    };
  }

  return {
    pairing: pair,
    roster,
    kind: 'addr_diff',
    reason: `员工在表中，但出发地址已调整：表内「${roster.departureAddress}」→ 系统「${pair.departureAddress}」（全匹配 patch，满足园区/指定人/下午2）。`,
  };
}

const KIND_LABEL: Record<MatchKind, string> = {
  full_match: '一致',
  addr_diff: '员工同·地址不同',
  gap_fill: '补位员工',
  demo_emp: '演示员工',
  not_in_roster: '不在员工表',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(
  items: OrderCompare[],
  roster: RosterEmp[],
  usage: { name: string; count: number; slots: string[]; roster: RosterEmp; inRoster: boolean }[]
): string {
  const counts = {
    full_match: items.filter((i) => i.kind === 'full_match').length,
    addr_diff: items.filter((i) => i.kind === 'addr_diff').length,
    gap_fill: items.filter((i) => i.kind === 'gap_fill').length,
    demo_emp: items.filter((i) => i.kind === 'demo_emp').length,
    not_in_roster: items.filter((i) => i.kind === 'not_in_roster').length,
  };
  const inRosterOrders = counts.full_match + counts.addr_diff;

  const orderRows = items
    .sort((a, b) => {
      const order: MatchKind[] = ['addr_diff', 'gap_fill', 'demo_emp', 'not_in_roster', 'full_match'];
      return order.indexOf(a.kind) - order.indexOf(b.kind) || a.pairing.companyName.localeCompare(b.pairing.companyName, 'zh');
    })
    .map((item) => {
      const p = item.pairing;
      const rosterAddr = item.roster?.departureAddress ?? '—';
      return `<tr class="${item.kind}">
        <td>${esc(p.companyName)}</td>
        <td>${esc(p.timeSlot)}</td>
        <td>${esc(p.employeeName)}</td>
        <td>${esc(p.departureAddress)}</td>
        <td>${esc(rosterAddr)}</td>
        <td><span class="badge ${item.kind}">${KIND_LABEL[item.kind]}</span></td>
        <td class="reason">${esc(item.reason)}</td>
      </tr>`;
    })
    .join('');

  const usageRows = usage
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
    .map((u) => {
      const status = u.count === 0 ? '未派单' : `${u.count} 单`;
      const cls = u.count === 0 ? 'idle' : 'active';
      return `<tr class="${cls}">
        <td>${esc(u.name)}</td>
        <td>${esc(u.roster.park)}</td>
        <td>${esc(u.roster.capacity)}</td>
        <td>${esc(u.roster.departureAddress)}</td>
        <td><strong>${u.count}</strong></td>
        <td>${esc(u.slots.join('、') || '—')}</td>
      </tr>`;
    })
    .join('');

  const idleCount = usage.filter((u) => u.count === 0).length;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>55条匹配 vs 派单员工表 对比</title>
  <style>
    :root {
      --bg:#0f1419; --panel:#1a2332; --border:#2d3a4f; --text:#e7ecf3; --muted:#8b9cb3;
      --ok:#3dd68c; --warn:#f5a623; --diff:#ff6b6b; --info:#5b9cf5; --purple:#a78bfa;
    }
    *{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);padding:24px;line-height:1.5}
    h1{font-size:1.45rem;margin:0 0 6px}
    .sub{color:var(--muted);font-size:.9rem;margin-bottom:20px}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:20px}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center}
    .card .n{font-size:1.6rem;font-weight:700}
    .card .l{font-size:.72rem;color:var(--muted);margin-top:4px}
    .card.ok .n{color:var(--ok)} .card.warn .n{color:var(--warn)} .card.diff .n{color:var(--diff)}
    .card.info .n{color:var(--info)} .card.purple .n{color:var(--purple)}
    section{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:18px}
    section h2{font-size:1.05rem;margin:0 0 10px}
    .note{color:var(--muted);font-size:.88rem;margin:0 0 10px}
    ul.reasons{margin:0;padding-left:1.2rem;color:var(--muted);font-size:.88rem}
    ul.reasons li{margin-bottom:6px}
    ul.reasons strong{color:var(--text)}
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-size:.82rem}
    th,td{border-bottom:1px solid var(--border);padding:9px 10px;text-align:left;vertical-align:top}
    th{color:var(--muted);font-weight:600}
    tr.addr_diff{background:rgba(245,166,35,.07)}
    tr.gap_fill{background:rgba(167,139,250,.08)}
    tr.demo_emp{background:rgba(91,156,245,.08)}
    tr.full_match td:nth-child(3){color:var(--ok)}
    tr.idle{opacity:.65}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}
    .badge.full_match{background:rgba(61,214,140,.2);color:var(--ok)}
    .badge.addr_diff{background:rgba(245,166,35,.2);color:var(--warn)}
    .badge.gap_fill{background:rgba(167,139,250,.2);color:var(--purple)}
    .badge.demo_emp{background:rgba(91,156,245,.2);color:var(--info)}
    .reason{max-width:300px;color:var(--muted);font-size:.78rem}
    a{color:var(--info)}
    code{background:#0d1117;padding:2px 5px;border-radius:4px;font-size:.85em}
  </style>
</head>
<body>
  <h1>55 条全量匹配 vs 派单员工表 (1).xls</h1>
  <p class="sub">
    说明：<code>派单员工表 (1).xls</code> 是<strong>员工主数据</strong>（${roster.length} 人），不含公司派单明细。
    本报告对比「每条派单指派的员工」是否在员工表中、出发地址是否一致。
  </p>

  <div class="cards">
    <div class="card ok"><div class="n">${counts.full_match}</div><div class="l">完全一致</div></div>
    <div class="card warn"><div class="n">${counts.addr_diff}</div><div class="l">员工同·地址不同</div></div>
    <div class="card purple"><div class="n">${counts.gap_fill}</div><div class="l">补位员工</div></div>
    <div class="card info"><div class="n">${counts.demo_emp}</div><div class="l">演示员工</div></div>
    <div class="card"><div class="n">${inRosterOrders}</div><div class="l">使用表内员工</div></div>
    <div class="card"><div class="n">55</div><div class="l">派单总数</div></div>
  </div>

  <section>
    <h2>对比结论</h2>
    <ul class="reasons">
      <li><strong>一致（${counts.full_match} 条）</strong>：指派员工在 27 人表中，且出发地址与 Excel 完全相同。</li>
      <li><strong>员工同·地址不同（${counts.addr_diff} 条）</strong>：员工姓名在表中，但系统为全匹配调整了出发地（如李路路、温作良、刘帅、柴强、王睿等 patch）。</li>
      <li><strong>补位员工（${counts.gap_fill} 条）</strong>：系统新增的「补位-*」人员，不在员工表，专门承接下午2 等容量缺口。</li>
      <li><strong>演示员工（${counts.demo_emp} 条）</strong>：为 10 家演示公司配置的 5 名演示员工（ID 90001–90005），不在原始 27 人表。</li>
      <li><strong>员工表利用率</strong>：27 人中 ${27 - idleCount} 人参与了派单，${idleCount} 人未被分配到任何一单（如表中无人承接的时段/园区）。</li>
    </ul>
  </section>

  <section>
    <h2>逐条派单对比（55 条）</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>企业</th><th>时段</th><th>指派员工</th><th>系统出发地</th><th>员工表出发地</th><th>状态</th><th>说明</th>
        </tr></thead>
        <tbody>${orderRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>员工表 27 人派单统计</h2>
    <p class="note">统计每位表内员工在 55 条结果中被分配了几单、覆盖哪些时段。</p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>姓名</th><th>负责园区</th><th>表内单量</th><th>表内出发地</th><th>实际派单数</th><th>实际时段</th>
        </tr></thead>
        <tbody>${usageRows}</tbody>
      </table>
    </div>
  </section>

  <p class="note">生成时间：${new Date().toLocaleString('zh-CN')} ·
    <a href="/compare-dispatch.html">对比派单结果.xlsx</a> ·
    <a href="/match.html">匹配看板</a>
  </p>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(EMP_XLS)) {
    console.error('未找到 派单员工表 (1).xls');
    process.exit(1);
  }
  if (!fs.existsSync(CACHE_PATH)) {
    console.error('未找到 full-match.json，请先 npm run cache:showcase');
    process.exit(1);
  }

  const roster = readRoster(EMP_XLS);
  const rosterByName = new Map(roster.map((e) => [e.name, e]));
  const pairings = loadPairings();
  const items = pairings.map((p) => classify(p, rosterByName));

  const usageMap = new Map<string, { count: number; slots: Set<string> }>();
  for (const e of roster) {
    usageMap.set(e.name, { count: 0, slots: new Set() });
  }
  for (const item of items) {
    if (item.kind === 'full_match' || item.kind === 'addr_diff') {
      const u = usageMap.get(item.pairing.employeeName);
      if (u) {
        u.count++;
        u.slots.add(item.pairing.timeSlot);
      }
    }
  }

  const usage = roster.map((r) => ({
    name: r.name,
    count: usageMap.get(r.name)?.count ?? 0,
    slots: [...(usageMap.get(r.name)?.slots ?? [])],
    roster: r,
    inRoster: true,
  }));

  const html = buildHtml(items, roster, usage);
  fs.writeFileSync(OUT_HTML, html, 'utf-8');

  const c = {
    full: items.filter((i) => i.kind === 'full_match').length,
    addr: items.filter((i) => i.kind === 'addr_diff').length,
    gap: items.filter((i) => i.kind === 'gap_fill').length,
    demo: items.filter((i) => i.kind === 'demo_emp').length,
  };
  console.log(`员工表: ${roster.length} 人, 派单: ${pairings.length} 条`);
  console.log(`一致: ${c.full}, 地址不同: ${c.addr}, 补位: ${c.gap}, 演示: ${c.demo}`);
  console.log(`已生成: ${OUT_HTML}`);
}

main();
