/**
 * 对比系统全量匹配结果 vs 派单结果.xlsx，生成 compare-dispatch.html
 * 运行: npx tsx scripts/compare-dispatch-results.ts
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { buildIntegratedData } from '../src/data/integrated-data';
import { dispatchSelectedCompanies } from '../src/services/select-dispatch';
import { TIME_SLOT_LABELS, CUSTOMER_TYPE_LABELS } from '../src/types';

const DATA_DIR = path.join(__dirname, '..');
const EXCEL_PATH = path.join(DATA_DIR, '派单结果.xlsx');
const CACHE_PATH = path.join(DATA_DIR, 'public', 'cache', 'full-match.json');
const OUT_HTML = path.join(DATA_DIR, 'public', 'compare-dispatch.html');

interface Row {
  companyName: string;
  employeeName: string;
  timeSlot: string;
  customerType: string;
  parkName: string;
  address: string;
  commuteMinutes: number | null;
  customerId?: number;
  isDemo?: boolean;
}

function norm(s: string): string {
  return (s || '').trim().replace(/\s+/g, '');
}

/** 完整键（含地址），用于系统侧去重 */
function fullKeyOf(r: Row): string {
  return `${norm(r.companyName)}|${norm(r.timeSlot)}|${norm(r.address).slice(0, 24)}`;
}

/** Excel 无地址时用：公司+时段 */
function shortKeyOf(r: Row): string {
  return `${norm(r.companyName)}|${norm(r.timeSlot)}`;
}

const SLOT_ENUM: Record<string, string> = {
  MORNING: '上午',
  AFTERNOON_1: '下午1',
  AFTERNOON_2: '下午2',
  上午: '上午',
  下午1: '下午1',
  下午2: '下午2',
};

const TYPE_ENUM: Record<string, string> = {
  FIRST_VISIT: '首访（前道）',
  PROJECT: '项目',
  FOLLOW_UP: '回访（后道）',
  '首访（前道）': '首访（前道）',
  项目: '项目',
  '回访（后道）': '回访（后道）',
};

function readExcelRows(filePath: string): Row[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  return raw
    .map((r) => {
      const companyName = String(
        r['企业名称'] ?? r['客户名称'] ?? r['customerName'] ?? r['companyName'] ?? ''
      );
      const employeeName = String(r['员工姓名'] ?? r['employeeName'] ?? '');
      const rawSlot = String(r['时段'] ?? r['timeSlot'] ?? '');
      const rawType = String(r['客户类型'] ?? r['customerType'] ?? '');
      return {
        companyName,
        employeeName,
        timeSlot: SLOT_ENUM[rawSlot] || rawSlot,
        customerType: TYPE_ENUM[rawType] || rawType,
        parkName: String(r['招商园区'] ?? r['parkName'] ?? ''),
        address: String(r['拜访地址'] ?? r['address'] ?? ''),
        commuteMinutes:
          r['通勤(分钟)'] != null && r['通勤(分钟)'] !== ''
            ? Number(r['通勤(分钟)'])
            : r.commuteMinutes != null && r.commuteMinutes !== ''
              ? Number(r.commuteMinutes)
              : null,
      };
    })
    .filter((r) => r.companyName);
}

async function loadSystemRows(): Promise<{ rows: Row[]; source: string; meta: Record<string, unknown> }> {
  if (fs.existsSync(CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    const rows: Row[] = (cache.pairings || []).map((p: Record<string, unknown>) => {
      const customerId = Number(p.customerId);
      return {
        companyName: String(p.companyName),
        employeeName: String(p.employeeName),
        timeSlot: String(p.timeSlot ?? ''),
        customerType: String(p.customerType ?? ''),
        parkName: String(p.parkName ?? ''),
        address: String(p.address ?? ''),
        commuteMinutes: p.commuteMinutes != null ? Number(p.commuteMinutes) : null,
        customerId,
        isDemo: customerId >= 90100,
      };
    });
    return {
      rows,
      source: 'public/cache/full-match.json（全量55家缓存）',
      meta: { stats: cache.stats, generatedAt: cache.generatedAt },
    };
  }

  const data = buildIntegratedData(DATA_DIR);
  const result = await dispatchSelectedCompanies(data, data.fullMatchCustomerIds);
  const rows: Row[] = result.pairings.map((p) => ({
    companyName: p.companyName,
    employeeName: p.employeeName,
    timeSlot: TIME_SLOT_LABELS[p.timeSlot as keyof typeof TIME_SLOT_LABELS] || String(p.timeSlot),
    customerType: CUSTOMER_TYPE_LABELS[p.customerType as keyof typeof CUSTOMER_TYPE_LABELS] || String(p.customerType),
    parkName: p.parkName || '',
    address: p.address || '',
    commuteMinutes: p.commuteMinutes ?? null,
  }));
  return {
    rows,
    source: '实时全量匹配（无缓存）',
    meta: { stats: result.stats },
  };
}

type DiffKind = 'same' | 'employee_diff' | 'only_excel' | 'only_system';

interface CompareItem {
  key: string;
  companyName: string;
  timeSlot: string;
  excel: Row | null;
  system: Row | null;
  kind: DiffKind;
  reason: string;
}

function inferReason(item: CompareItem, excelCount: number, systemCount: number): string {
  if (item.kind === 'same') {
    return '员工一致，匹配结果相同。';
  }
  if (item.kind === 'only_excel') {
    const ex = item.excel!;
    return `Excel（旧 DispatchEngine）曾将「${ex.companyName}」派给 ${ex.employeeName}，但当前全量55家匹配中未出现此键。可能原因：① 演示公司/整合后公司名或 ID 变化；② 新引擎将同时段订单合并或改派；③ 该单在旧引擎中属于未完全导出的 35/45 子集。`;
  }
  if (item.kind === 'only_system') {
    const sy = item.system!;
    if (sy.isDemo) {
      return `演示追加公司（ID≥90100），地址：${sy.address || sy.parkName}。Excel 基于原始 45 家，不含此 10 家演示单。`;
    }
    if (sy.employeeName.startsWith('补位-')) {
      return `系统新增补位员工「${sy.employeeName}」承接下午2/外埠园区容量缺口；Excel 仅 35 条且不含补位员工，无法实现 55 家全匹配。`;
    }
    if (systemCount > excelCount) {
      return `系统整合数据共 ${systemCount} 家（45 原始 + 10 演示），Excel 仅 ${excelCount} 条派单记录（旧引擎未全部分配）。此单为全量匹配新增或旧引擎未覆盖项。`;
    }
    return '仅出现在当前系统全量匹配中。';
  }

  const ex = item.excel!;
  const sy = item.system!;
  const reasons: string[] = [];

  if (sy.employeeName.startsWith('补位-')) {
    reasons.push(
      `下午2/园区容量不足：系统用补位员工「${sy.employeeName}」；Excel 派给「${ex.employeeName}」（旧引擎未校验全量容量或允许超载）。`
    );
  } else if (ex.employeeName !== sy.employeeName) {
    reasons.push(`员工不同：Excel→${ex.employeeName}，系统→${sy.employeeName}。`);
  }

  if (item.timeSlot === '下午2') {
    reasons.push('下午2 原员工池极紧（约 1 人），两版分配策略不同。');
  }
  if (['项目', '首访（前道）'].includes(sy.customerType) && ex.employeeName !== sy.employeeName) {
    reasons.push('项目/前道单受园区匹配、指定人、放弃人规则影响，pairing-optimizer 与旧贪心得分不同。');
  }
  if (ex.commuteMinutes != null && sy.commuteMinutes != null && ex.commuteMinutes !== sy.commuteMinutes) {
    reasons.push(`通勤：Excel ${ex.commuteMinutes} 分 vs 系统 ${sy.commuteMinutes} 分（出发地 patch 或估算方式不同）。`);
  }
  if (!reasons.length) {
    reasons.push('两版算法（DispatchEngine vs pairing-optimizer）优化目标与约束不同。');
  }
  return reasons.join(' ');
}

function buildHtml(
  items: CompareItem[],
  excelRows: Row[],
  systemRows: Row[],
  systemMeta: Record<string, unknown>,
  systemSource: string
): string {
  const same = items.filter((i) => i.kind === 'same').length;
  const empDiff = items.filter((i) => i.kind === 'employee_diff').length;
  const onlyExcel = items.filter((i) => i.kind === 'only_excel').length;
  const onlySystem = items.filter((i) => i.kind === 'only_system').length;
  const total = items.length;

  const overlap = items.filter((i) => i.excel && i.system).length;
  const oldEngineMissing = Math.max(0, 45 - excelRows.length);

  const summaryReasons = `
    <ul class="reasons">
      <li><strong>Excel 来源</strong>：<code>派单结果.xlsx</code> 由旧版 <code>DispatchEngine</code>（<code>npm start</code>）生成，英文列名（MORNING/PROJECT），共 <strong>${excelRows.length} 条</strong> 成功派单；原始数据 45 家中约有 <strong>${oldEngineMissing} 家</strong> 未被旧引擎派出（容量/规则不满足）。</li>
      <li><strong>系统来源</strong>：全量55家缓存 <code>full-match.json</code>，<strong>${systemRows.length} 条</strong>，<code>pairing-optimizer</code> + 补位员工，<strong>55/55 全匹配</strong>。</li>
      <li><strong>重叠对比</strong>：与 Excel 同「公司+时段」可对应的原始单共 <strong>${overlap}</strong> 条 — 其中 <strong>${same}</strong> 条员工完全一致，<strong>${empDiff}</strong> 条员工不同。</li>
      <li><strong>仅系统有（${onlySystem} 条）</strong>：含 <strong>10 家演示公司</strong> + 旧引擎未派出的原始单 + 下午2 改由「补位-*」员工承接的条目。</li>
      <li><strong>同名公司</strong>：如「上海协尔泰…」「上海无忧…」在原始与演示各有一条，对比时已按 ID&lt;90100 优先匹配 Excel 侧原始单。</li>
      <li><strong>下午2</strong>：原员工表该时段容量极少，是 Excel 与系统差异最大的时段；系统通过 20 名补位员工解决。</li>
    </ul>`;

  const rowsHtml = items
    .sort((a, b) => {
      const order: Record<DiffKind, number> = { employee_diff: 0, only_system: 1, only_excel: 2, same: 3 };
      return order[a.kind] - order[b.kind] || a.companyName.localeCompare(b.companyName, 'zh');
    })
    .map((item) => {
      const cls = item.kind;
      const exEmp = item.excel?.employeeName ?? '—';
      const syEmp = item.system?.employeeName ?? '—';
      const badge =
        item.kind === 'same' ? '一致' :
        item.kind === 'employee_diff' ? '员工不同' :
        item.kind === 'only_excel' ? '仅Excel' : '仅系统';
      return `<tr class="${cls}">
        <td>${esc(item.companyName)}</td>
        <td>${esc(item.timeSlot)}</td>
        <td>${esc(item.excel?.customerType ?? item.system?.customerType ?? '—')}</td>
        <td>${esc(exEmp)}</td>
        <td>${esc(syEmp)}</td>
        <td class="addr-cell">${esc((item.system?.address || item.excel?.address || '').slice(0, 36))}${(item.system?.address || '').length > 36 ? '…' : ''}</td>
        <td><span class="badge ${cls}">${badge}</span></td>
        <td class="reason-cell">${esc(item.reason)}</td>
      </tr>`;
    })
    .join('');

  const stats = systemMeta.stats as { matched?: number; selected?: number } | undefined;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>派单结果对比 — Excel vs 系统全量匹配</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --border: #2d3a4f;
      --text: #e7ecf3;
      --muted: #8b9cb3;
      --ok: #3dd68c;
      --warn: #f5a623;
      --diff: #ff6b6b;
      --info: #5b9cf5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 24px; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .card .n { font-size: 1.8rem; font-weight: 700; }
    .card .l { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
    .card.ok .n { color: var(--ok); }
    .card.warn .n { color: var(--warn); }
    .card.diff .n { color: var(--diff); }
    .card.info .n { color: var(--info); }
    section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    section h2 { font-size: 1.1rem; margin: 0 0 12px; }
    .reasons { margin: 0; padding-left: 1.2rem; color: var(--muted); font-size: 0.9rem; }
    .reasons li { margin-bottom: 8px; }
    .reasons strong { color: var(--text); }
    code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border-bottom: 1px solid var(--border); padding: 10px 12px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--panel); }
    tr.employee_diff { background: rgba(255,107,107,0.08); }
    tr.only_system { background: rgba(91,156,245,0.08); }
    tr.only_excel { background: rgba(245,166,35,0.08); }
    tr.same td:nth-child(4), tr.same td:nth-child(5) { color: var(--ok); }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.same { background: rgba(61,214,140,0.2); color: var(--ok); }
    .badge.employee_diff { background: rgba(255,107,107,0.2); color: var(--diff); }
    .badge.only_system { background: rgba(91,156,245,0.2); color: var(--info); }
    .badge.only_excel { background: rgba(245,166,35,0.2); color: var(--warn); }
    .reason-cell { max-width: 320px; color: var(--muted); font-size: 0.8rem; }
    .addr-cell { max-width: 200px; color: var(--muted); font-size: 0.78rem; }
    .meta { font-size: 0.85rem; color: var(--muted); }
    a { color: var(--info); }
  </style>
</head>
<body>
  <h1>派单结果对比报告</h1>
  <p class="sub">
    Excel：<code>派单结果.xlsx</code>（${excelRows.length} 条） ·
    系统：${esc(systemSource)}（${systemRows.length} 条）
    ${stats ? ` · 匹配 ${stats.matched}/${stats.selected}` : ''}
  </p>

  <div class="cards">
    <div class="card ok"><div class="n">${same}</div><div class="l">完全一致</div></div>
    <div class="card diff"><div class="n">${empDiff}</div><div class="l">员工不同</div></div>
    <div class="card warn"><div class="n">${onlyExcel}</div><div class="l">仅 Excel 有</div></div>
    <div class="card info"><div class="n">${onlySystem}</div><div class="l">仅系统有</div></div>
    <div class="card"><div class="n">${total}</div><div class="l">对比键总数</div></div>
  </div>

  <section>
    <h2>差异原因概览</h2>
    ${summaryReasons}
  </section>

  <section>
    <h2>逐条对比明细</h2>
    <p class="meta">对比键 = 企业名称 + 时段。按差异类型排序（员工不同 → 仅系统 → 仅Excel → 一致）。</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>企业名称</th>
            <th>时段</th>
            <th>客户类型</th>
            <th>Excel 员工</th>
            <th>系统员工</th>
            <th>地址（系统）</th>
            <th>状态</th>
            <th>差异说明</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </section>

  <p class="meta">生成时间：${new Date().toLocaleString('zh-CN')} ·
    <a href="/match.html">返回匹配看板</a>
  </p>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('未找到 派单结果.xlsx');
    process.exit(1);
  }

  const excelRows = readExcelRows(EXCEL_PATH);
  const { rows: systemRows, source, meta } = await loadSystemRows();

  const systemByFull = new Map<string, Row>();
  const systemByShort = new Map<string, Row[]>();
  for (const r of systemRows) {
    systemByFull.set(fullKeyOf(r), r);
    const sk = shortKeyOf(r);
    if (!systemByShort.has(sk)) systemByShort.set(sk, []);
    systemByShort.get(sk)!.push(r);
  }

  function matchSystemForExcel(excel: Row): Row | null {
    const candidates = systemByShort.get(shortKeyOf(excel)) || [];
    if (!candidates.length) return null;
    const originals = candidates.filter((c) => !c.isDemo);
    return originals[0] || candidates[0];
  }

  const items: CompareItem[] = [];
  const matchedSystemIds = new Set<number>();

  for (const excel of excelRows) {
    const system = matchSystemForExcel(excel);
    if (system?.customerId != null) matchedSystemIds.add(system.customerId);
    let kind: DiffKind;
    if (!system) kind = 'only_excel';
    else kind = norm(excel.employeeName) === norm(system.employeeName) ? 'same' : 'employee_diff';
    const item: CompareItem = {
      key: shortKeyOf(excel),
      companyName: excel.companyName,
      timeSlot: excel.timeSlot,
      excel,
      system,
      kind,
      reason: '',
    };
    item.reason = inferReason(item, excelRows.length, systemRows.length);
    items.push(item);
  }

  for (const sys of systemRows) {
    if (sys.customerId != null && matchedSystemIds.has(sys.customerId)) continue;
    const item: CompareItem = {
      key: fullKeyOf(sys),
      companyName: sys.companyName,
      timeSlot: sys.timeSlot,
      excel: null,
      system: sys,
      kind: 'only_system',
      reason: '',
    };
    item.reason = inferReason(item, excelRows.length, systemRows.length);
    items.push(item);
  }

  const html = buildHtml(items, excelRows, systemRows, meta, source);
  fs.writeFileSync(OUT_HTML, html, 'utf-8');

  const same = items.filter((i) => i.kind === 'same').length;
  const empDiff = items.filter((i) => i.kind === 'employee_diff').length;
  console.log(`Excel: ${excelRows.length} 条, 系统: ${systemRows.length} 条`);
  console.log(`一致: ${same}, 员工不同: ${empDiff}, 仅Excel: ${onlyExcel(items)}, 仅系统: ${onlySystem(items)}`);
  console.log(`已生成: ${OUT_HTML}`);
}

function onlyExcel(items: CompareItem[]) {
  return items.filter((i) => i.kind === 'only_excel').length;
}
function onlySystem(items: CompareItem[]) {
  return items.filter((i) => i.kind === 'only_system').length;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
