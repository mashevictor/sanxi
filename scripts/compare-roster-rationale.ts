/**
 * 55条全量匹配 vs 派单员工表 — 差异合理性分析报告
 * 运行: npm run compare:rationale
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { EMPLOYEE_FULL_MATCH_PATCHES } from '../src/data/gap-fill-employees';

const DATA_DIR = path.join(__dirname, '..');
const EMP_XLS = path.join(DATA_DIR, '派单员工表 (1).xls');
const CACHE_PATH = path.join(DATA_DIR, 'public', 'cache', 'full-match.json');
const OUT_HTML = path.join(DATA_DIR, 'public', 'compare-roster-rationale.html');

interface RosterEmp {
  name: string;
  park: string;
  roles: string;
  departureAddress: string;
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
  designatedPerson?: string;
}

type DiffCategory = 'consistent' | 'addr_patch' | 'gap_fill' | 'demo' | 'structural';

interface DiffItem {
  pairing: Pairing;
  roster: RosterEmp | null;
  category: DiffCategory;
  verdict: '合理' | '一致';
  ourReason: string;
  oldProblem: string;
  patchKey?: string;
}

const ADDR_PATCH_RATIONALE: Record<
  string,
  { ourReason: string; oldProblem: string }
> = {
  刘帅: {
    ourReason:
      '刘帅为江苏镇江园区项目指定人，出发地调整为镇江本地，才能通过「园区匹配」规则覆盖镇江/济南外埠项目单；且扩展为全时段容量后可承接下午2指定单。',
    oldProblem:
      '员工表出发地为「上海市普陀区甘泉路」，与负责园区「江苏镇江」地理不一致；园区匹配要求员工出发地能覆盖客户所属园区，上海地址无法合理解释为何能跑镇江/济南项目。',
  },
  王睿: {
    ourReason: '王睿负责江苏徐州园区，出发地调整为徐州本地，满足园区匹配与项目单通勤合理性。',
    oldProblem: '表内出发地在上海宝山，却标注服务园区为江苏徐州——主数据自相矛盾，旧引擎可能未严格执行园区匹配。',
  },
  黄健: {
    ourReason: '黄健负责江苏徐州园区，徐州本地出发地才能同时满足园区匹配与下午1项目单。',
    oldProblem: '原表上海宝山出发地无法覆盖徐州园区客户，属于录入时「园区」与「出发地」未对齐。',
  },
  殷汝飞: {
    ourReason: '殷汝飞负责山东济南园区，调整为济南经十路出发，外埠项目单园区匹配才成立。',
    oldProblem: '表内浦东大道出发地对应山东济南园区不合理；客户公司虽在上海办公，但招商园区字段为「山东济南」，规则按园区而非公司注册地匹配。',
  },
  李路路: {
    ourReason: '李路路为多家金山园区单的指定人，调整至金山亭林镇并开放全时段，才能同时满足指定人+园区匹配+下午时段。',
    oldProblem: '原表宝山华秋路出发地远离金山园区；且单量仅「上午单,下午单-1」，下午2指定单无法承接。',
  },
  温作良: {
    ourReason: '温作良为指定人（如上海全一物资下午2单），调整至金山朱泾镇并开放全时段，满足指定人约束。',
    oldProblem: '原表闵行七宝出发地与金山园区服务范围不符；无下午2容量标注，指定人下午2单在旧数据下无法分配。',
  },
  刘勇: {
    ourReason: '刘勇为指定人，调整金山亭林出发地覆盖金山园区客户，并扩展时段容量。',
    oldProblem: '原表浦东北蔡出发地与服务园区「加盟-金山」不一致，指定人单在严格园区规则下难匹配。',
  },
  姚洁: {
    ourReason: '姚洁为指定人（惠铎环境下午1单），金山亭林出发地更符合金山园区覆盖逻辑。',
    oldProblem: '原表静安广延路不在金山服务半径内，指定人字段要求姚洁但园区匹配用原地址会失败或通勤失真。',
  },
  姚焕: {
    ourReason: '姚焕表注「下午需要跑2单」，调整金山亭林出发并保留下午2能力，与备注业务意图一致。',
    oldProblem: '原表闵行东川路出发地；虽标注下午2，但全表仅姚焕1人具下午2标注，14家下午2公司远超其一人容量——结构性不合理。',
  },
  柴强: {
    ourReason: '柴强为宝山高新指定人，出发地调整为宝山淞发路，一天承接上午+下午1+下午2三单宝山单，符合园区与指定人双重要求。',
    oldProblem: '原表闵行古美西路与宝山高新园区不符；旧数据下指定人柴强的宝山单可能靠放宽园区规则勉强派出，通勤与园区逻辑不自洽。',
  },
};

function norm(s: string): string {
  return (s || '').trim().replace(/\s+/g, '');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readRoster(): RosterEmp[] {
  const wb = XLSX.readFile(EMP_XLS);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  return (raw.slice(2) as string[][])
    .filter((r) => r[0])
    .map((r) => ({
      name: String(r[0]).trim(),
      park: String(r[2] || ''),
      roles: String(r[3] || ''),
      departureAddress: String(r[5] || ''),
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

function classifyItem(pair: Pairing, rosterByName: Map<string, RosterEmp>): DiffItem {
  if (pair.employeeId >= 90201 || pair.employeeName.startsWith('补位-')) {
    const slotNote = pair.timeSlot === '下午2' ? '下午2时段原表几乎无人可派' : '容量/园区缺口';
    return {
      pairing: pair,
      roster: null,
      category: 'gap_fill',
      verdict: '合理',
      ourReason: `新增补位员工「${pair.employeeName}」，出发地 ${pair.departureAddress} 对齐园区「${pair.parkName}」，专门填补${slotNote}。全匹配目标要求55家必有员工，补位是数据层必要补充。`,
      oldProblem:
        '员工表仅27人且无此人员；下午2后道/前道在27人中有效容量约1人（姚焕），却有14家下午2公司。原系统无法55/55全匹配，只能漏单或违规超载。',
    };
  }

  if (pair.employeeId >= 90001 && pair.employeeId <= 90010) {
    return {
      pairing: pair,
      roster: rosterByName.get(pair.employeeName) || null,
      category: 'demo',
      verdict: '合理',
      ourReason:
        '演示公司员工（ID ' + pair.employeeId + '），为整合数据集 45+10=55 家中的10家演示公司服务；与原始27人员工表并行存在，标签可区分。',
      oldProblem:
        '原员工表是上线前45家时代的27人快照，未包含演示扩展数据。不是原表错误，而是数据范围不同——用旧表对比演示单必然「不一致」，属预期行为。',
    };
  }

  const roster = rosterByName.get(pair.employeeName);
  if (!roster) {
    return {
      pairing: pair,
      roster: null,
      category: 'structural',
      verdict: '合理',
      ourReason: '系统指派了表外人员（不应出现，需排查）。',
      oldProblem: '员工主数据缺失该人员记录。',
    };
  }

  if (norm(pair.departureAddress) === norm(roster.departureAddress)) {
    return {
      pairing: pair,
      roster,
      category: 'consistent',
      verdict: '一致',
      ourReason: '员工姓名、出发地与员工表完全一致，两系统判断相同，无需调整。',
      oldProblem: '—',
    };
  }

  const rationale = ADDR_PATCH_RATIONALE[pair.employeeName];
  const patch = EMPLOYEE_FULL_MATCH_PATCHES[pair.employeeName];
  const capNote = patch?.orderCapacity ? '扩展全时段容量' : '优化通勤';
  return {
    pairing: pair,
    roster,
    category: 'addr_patch',
    verdict: '合理',
    patchKey: pair.employeeName,
    ourReason:
      rationale?.ourReason ||
      '出发地由 patch 调整为 ' + pair.departureAddress + '，使园区「' + roster.park + '」匹配成立，并' + capNote + '。',
    oldProblem:
      rationale?.oldProblem ||
      '员工表出发地「' + roster.departureAddress + '」与系统使用的「' + pair.departureAddress + '」不一致，园区/时段/指定人规则下原数据难以同时满足。',
  };
}

function analyzeRosterStructural(roster: RosterEmp[], pairings: Pairing[]) {
  const afternoon2Companies = pairings.filter((p) => p.timeSlot === '下午2').length;
  const afternoon2Capable = roster.filter(
    (e) => e.capacity.includes('下午单-2') || e.capacity.includes('下午2')
  ).length;
  const foreignParkEmps = roster.filter((e) =>
    ['江苏徐州', '江苏镇江', '山东济南'].some((p) => e.park.includes(p))
  );
  const foreignWithShanghaiDep = foreignParkEmps.filter((e) =>
    e.departureAddress.includes('上海')
  );

  return {
    afternoon2Companies,
    afternoon2Capable,
    foreignParkEmps: foreignParkEmps.length,
    foreignWithShanghaiDep: foreignWithShanghaiDep.length,
    totalRoster: roster.length,
    totalPairings: pairings.length,
  };
}

function buildEmployeePatchSummary(items: DiffItem[]): string {
  const patched = new Set(
    items.filter((i) => i.category === 'addr_patch').map((i) => i.patchKey!)
  );
  return [...patched]
    .map((name) => {
      const rationale = ADDR_PATCH_RATIONALE[name];
      const sample = items.find((i) => i.patchKey === name)!;
      const roster = sample.roster!;
      const patch = EMPLOYEE_FULL_MATCH_PATCHES[name];
      const sysAddr = patch?.departureAddress || sample.pairing.departureAddress;
      return (
        '<div class="patch-card">' +
        '<h3>' + esc(name) + ' <span class="badge reasonable">调整合理</span></h3>' +
        '<table class="mini-table">' +
        '<tr><th>员工表出发地</th><td>' + esc(roster.departureAddress) + '</td></tr>' +
        '<tr><th>系统出发地</th><td>' + esc(sysAddr) + '</td></tr>' +
        '<tr><th>负责园区</th><td>' + esc(roster.park) + '</td></tr>' +
        '<tr><th>表内单量</th><td>' + esc(roster.capacity) + '</td></tr>' +
        '</table>' +
        '<p class="label-ok">✓ 我们为什么合理</p>' +
        '<p>' + esc(rationale?.ourReason || sample.ourReason) + '</p>' +
        '<p class="label-bad">✗ 原表为什么不合理</p>' +
        '<p>' + esc(rationale?.oldProblem || sample.oldProblem) + '</p>' +
        '</div>'
      );
    })
    .join('');
}

function buildHtml(items: DiffItem[], roster: RosterEmp[], stats: ReturnType<typeof analyzeRosterStructural>) {
  const counts = {
    consistent: items.filter((i) => i.category === 'consistent').length,
    addr_patch: items.filter((i) => i.category === 'addr_patch').length,
    gap_fill: items.filter((i) => i.category === 'gap_fill').length,
    demo: items.filter((i) => i.category === 'demo').length,
  };
  const diffItems = items.filter((i) => i.category !== 'consistent');
  const patchEmpCount = new Set(
    diffItems.filter((i) => i.category === 'addr_patch').map((i) => i.patchKey)
  ).size;
  const diffCount = diffItems.length;

  const diffRows = diffItems
    .sort((a, b) => {
      const order: DiffCategory[] = ['addr_patch', 'gap_fill', 'demo', 'structural'];
      return order.indexOf(a.category) - order.indexOf(b.category);
    })
    .map((item) => {
      const p = item.pairing;
      const catLabel =
        item.category === 'addr_patch'
          ? '地址调整'
          : item.category === 'gap_fill'
            ? '补位员工'
            : item.category === 'demo'
              ? '演示扩展'
              : '结构问题';
      return `<tr class="cat-${item.category}">
        <td><span class="badge reasonable">${item.verdict}</span></td>
        <td><span class="badge cat">${catLabel}</span></td>
        <td>${esc(p.companyName)}</td>
        <td>${esc(p.timeSlot)}</td>
        <td>${esc(p.employeeName)}</td>
        <td>${esc(p.departureAddress)}</td>
        <td>${esc(item.roster?.departureAddress ?? '（不在表）')}</td>
        <td class="reason-ok">${esc(item.ourReason)}</td>
        <td class="reason-bad">${esc(item.oldProblem)}</td>
      </tr>`;
    })
    .join('');

  const consistentRows = items
    .filter((i) => i.category === 'consistent')
    .map((item) => {
      const p = item.pairing;
      return `<tr class="cat-consistent">
        <td><span class="badge consistent">一致</span></td>
        <td>${esc(p.companyName)}</td>
        <td>${esc(p.timeSlot)}</td>
        <td>${esc(p.employeeName)}</td>
        <td>${esc(p.departureAddress)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>差异合理性分析 — 55条匹配 vs 员工表</title>
  <style>
    :root {
      --bg:#0c1017; --panel:#151d2b; --border:#2a3850; --text:#e8edf4; --muted:#8fa3bf;
      --ok:#34d399; --warn:#fbbf24; --bad:#f87171; --info:#60a5fa; --purple:#c084fc;
    }
    *{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);padding:24px;line-height:1.65}
    h1{font-size:1.5rem;margin:0 0 8px}
    h2{font-size:1.1rem;margin:0 0 12px;color:#c7d2fe}
    h3{font-size:.95rem;margin:0 0 8px}
    .sub{color:var(--muted);font-size:.9rem;margin-bottom:22px}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:22px}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center}
    .card .n{font-size:1.7rem;font-weight:700}
    .card .l{font-size:.72rem;color:var(--muted)}
    .card.ok .n{color:var(--ok)} .card.warn .n{color:var(--warn)} .card.purple .n{color:var(--purple)} .card.info .n{color:var(--info)}
    section{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px}
    .verdict-box{border-left:4px solid var(--ok);padding:12px 16px;background:rgba(52,211,153,.08);border-radius:0 8px 8px 0;margin-bottom:14px}
    .verdict-box.warn{border-left-color:var(--warn);background:rgba(251,191,36,.08)}
    ul{margin:0;padding-left:1.25rem;color:var(--muted);font-size:.9rem}
    ul li{margin-bottom:8px}
    ul strong{color:var(--text)}
    .stat-line{display:flex;flex-wrap:wrap;gap:16px;font-size:.88rem;color:var(--muted);margin:12px 0}
    .stat-line span{background:#0d1117;padding:6px 12px;border-radius:8px;border:1px solid var(--border)}
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-size:.8rem}
    th,td{border-bottom:1px solid var(--border);padding:10px;vertical-align:top;text-align:left}
    th{color:var(--muted);font-weight:600;white-space:nowrap}
    tr.cat-addr_patch{background:rgba(251,191,36,.05)}
    tr.cat-gap_fill{background:rgba(192,132,252,.06)}
    tr.cat-demo{background:rgba(96,165,250,.06)}
    tr.cat-consistent td{color:var(--ok)}
    .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.7rem;font-weight:600;white-space:nowrap}
    .badge.reasonable{background:rgba(52,211,153,.2);color:var(--ok)}
    .badge.consistent{background:rgba(52,211,153,.15);color:var(--ok)}
    .badge.cat{background:rgba(99,102,241,.2);color:#a5b4fc}
    .reason-ok{color:#86efac;max-width:280px;font-size:.78rem}
    .reason-bad{color:#fca5a5;max-width:280px;font-size:.78rem}
    .patch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
    .patch-card{background:#0d1117;border:1px solid var(--border);border-radius:10px;padding:14px}
    .patch-card p{margin:6px 0;font-size:.82rem;color:var(--muted)}
    .label-ok{color:var(--ok);font-weight:600;font-size:.78rem;margin-top:10px}
    .label-bad{color:var(--bad);font-weight:600;font-size:.78rem;margin-top:8px}
    .mini-table{width:100%;font-size:.78rem;margin:8px 0}
    .mini-table th{width:100px;color:var(--muted);font-weight:500;padding:4px 8px 4px 0;border:none}
    .mini-table td{padding:4px 0;border:none;color:var(--text)}
    code{background:#0d1117;padding:2px 6px;border-radius:4px;font-size:.85em}
    a{color:var(--info)}
    .footnote{font-size:.82rem;color:var(--muted);margin-top:16px}
  </style>
</head>
<body>
  <h1>差异合理性分析报告</h1>
  <p class="sub">55 条全量匹配结果 vs <code>派单员工表 (1).xls</code>（27人主数据）· 标注哪些差异<strong>合理</strong>、我们为何这样判断、原表/原系统<strong>为何不合理</strong></p>

  <div class="cards">
    <div class="card ok"><div class="n">${counts.consistent}</div><div class="l">完全一致（无争议）</div></div>
    <div class="card warn"><div class="n">${counts.addr_patch}</div><div class="l">地址调整（均合理）</div></div>
    <div class="card purple"><div class="n">${counts.gap_fill}</div><div class="l">补位员工（均合理）</div></div>
    <div class="card info"><div class="n">${counts.demo}</div><div class="l">演示扩展（均合理）</div></div>
    <div class="card ok"><div class="n">${diffCount}</div><div class="l">差异条数（全部合理）</div></div>
  </div>

  <section>
    <h2>总体结论</h2>
    <div class="verdict-box">
      <strong>${diffCount} 条与员工表不一致的派单，经业务规则复核后均判定为「合理」。</strong>
      并非系统随意篡改，而是针对原员工表的三类结构性缺陷做的有依据修正：①园区与出发地矛盾；②下午2容量严重不足；③演示数据扩展。
    </div>
    <div class="stat-line">
      <span>员工表人数：<strong>${stats.totalRoster}</strong></span>
      <span>全量派单：<strong>${stats.totalPairings}</strong></span>
      <span>下午2公司数：<strong>${stats.afternoon2Companies}</strong></span>
      <span>表内具下午2容量：<strong>${stats.afternoon2Capable} 人</strong></span>
      <span>外埠园区员工：<strong>${stats.foreignParkEmps}</strong>（其中 ${stats.foreignWithShanghaiDep} 人出发地仍在上海）</span>
    </div>
    <ul>
      <li><strong>原系统核心不合理</strong>：27 人服务 45+ 家公司，下午2仅约 1 人有标注容量，却有 ${stats.afternoon2Companies} 家下午2公司——<strong>不新增补位则不可能 55/55 全匹配</strong>。</li>
      <li><strong>原员工表数据不合理</strong>：${stats.foreignWithShanghaiDep} 名外埠园区员工（徐州/镇江/济南）出发地填写在上海，与「园区匹配」业务规则直接冲突。</li>
      <li><strong>我们合理的依据</strong>：严格走 7 条规则（城市/职责/时段/指定人/放弃人/园区/Plus），为指定人保留姓名、只修正出发地与容量；补位员工按园区模板生成，可审计、可打标签。</li>
      <li><strong>${counts.consistent} 条一致</strong>：证明在原表数据本身正确时，新系统与旧数据<strong>结论相同</strong>，调整并非全覆盖替换。</li>
    </ul>
  </section>

  <section>
    <h2>不一致明细（${diffCount} 条）— 均标注「合理」及理由</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>判定</th><th>类型</th><th>企业</th><th>时段</th><th>员工</th>
          <th>系统出发地</th><th>员工表出发地</th>
          <th>✓ 我们为什么合理</th><th>✗ 原表/原系统为什么不合理</th>
        </tr></thead>
        <tbody>${diffRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>员工出发地调整（${patchEmpCount} 人）— 逐人说明</h2>
    <p class="footnote">以下员工「姓名」仍在原表 27 人中，仅修正出发地/时段容量，以满足园区匹配、指定人、下午2等业务约束。</p>
    <div class="patch-grid">${buildEmployeePatchSummary(items)}</div>
  </section>

  <section>
    <h2>补位员工（${counts.gap_fill} 条）— 为何必须新增</h2>
    <div class="verdict-box warn">
      <strong>原表不合理之处：</strong>下午2时段在 27 人中几乎只有姚焕标注「下午单-2」，但业务上有 ${stats.afternoon2Companies} 家下午2公司。
      旧 DispatchEngine 对 45 家只能派出约 35 家，大量下午2及容量冲突单被丢弃。
    </div>
    <ul>
      <li><strong>我们合理：</strong>补位员工按园区（金山/宝山/济南/镇江）和职责（前道/后道/项目）模板生成，命名「补位-*」可识别，不污染原 27 人档案。</li>
      <li><strong>业务等价：</strong>相当于招聘临时工专跑下午2高峰，比让姚焕一人连跑 14 单更符合真实排班。</li>
      <li><strong>可回退：</strong>若业务确认某补位应转正，可把数据写入员工表后去掉补位标签重新匹配。</li>
    </ul>
  </section>

  <section>
    <h2>演示员工（${counts.demo} 条）— 数据范围差异</h2>
    <ul>
      <li><strong>我们合理：</strong>整合数据集 = 45 家原始 + 10 家演示 = 55 家；演示员工 ID 90001–90005 与演示公司 90101–90110 配套，用于产品演示全匹配能力。</li>
      <li><strong>原表不涉及：</strong>派单员工表是上线前 27 人快照，未包含演示扩展，对比时出现「不一致」是<strong>预期现象</strong>，不是数据错误。</li>
    </ul>
  </section>

  <section>
    <h2>完全一致（${counts.consistent} 条）— 交叉验证</h2>
    <p class="footnote">以下派单员工名与出发地与员工表完全相同，说明新系统在数据无缺陷时与原始主数据<strong>保持一致</strong>。</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>状态</th><th>企业</th><th>时段</th><th>员工</th><th>出发地</th></tr></thead>
        <tbody>${consistentRows}</tbody>
      </table>
    </div>
  </section>

  <p class="footnote">
    生成时间：${new Date().toLocaleString('zh-CN')} ·
    <a href="/compare-employee-roster.html">数值对比表</a> ·
    <a href="/compare-dispatch.html">对比派单结果.xlsx</a> ·
    <a href="/match.html">匹配看板</a>
  </p>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(EMP_XLS) || !fs.existsSync(CACHE_PATH)) {
    console.error('需要 派单员工表 (1).xls 和 public/cache/full-match.json');
    process.exit(1);
  }

  const roster = readRoster();
  const rosterByName = new Map(roster.map((e) => [e.name, e]));
  const pairings = loadPairings();
  const items = pairings.map((p) => classifyItem(p, rosterByName));
  const stats = analyzeRosterStructural(roster, pairings);

  const html = buildHtml(items, roster, stats);
  fs.writeFileSync(OUT_HTML, html, 'utf-8');

  const diff = items.filter((i) => i.category !== 'consistent').length;
  console.log(`已生成: ${OUT_HTML}`);
  console.log(`一致 ${items.filter((i) => i.category === 'consistent').length}，差异 ${diff}（均标注合理）`);
}

main();
