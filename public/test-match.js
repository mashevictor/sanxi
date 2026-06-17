const CORE_DISPLAY = ['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配'];

let report = null;
let activeScenarioId = null;
let activeSubView = 'pairings';
let activeRoleFilter = '全部';

document.getElementById('refresh-btn').addEventListener('click', loadReport);
document.getElementById('lookup-btn').addEventListener('click', runLookup);

document.addEventListener('DOMContentLoaded', () => {
  loadReport();
  prefillLookupExamples();
  document.getElementById('role-filter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-role]');
    if (!btn) return;
    activeRoleFilter = btn.dataset.role;
    document.querySelectorAll('#role-filter button[data-role]').forEach((b) => {
      b.classList.toggle('active', b.dataset.role === activeRoleFilter);
    });
    const list = filteredScenarios();
    if (!list.some((s) => s.id === activeScenarioId)) {
      activeScenarioId = list[0]?.id || null;
    }
    renderAll();
  });
});

function filteredScenarios() {
  if (!report?.scenarios) return [];
  if (activeRoleFilter === '前道') return report.scenarios.filter((s) => s.roleCategory === '前道');
  if (activeRoleFilter === '后道') return report.scenarios.filter((s) => s.roleCategory === '后道');
  return report.scenarios;
}

async function loadReport() {
  const btn = document.getElementById('refresh-btn');
  const content = document.getElementById('content');
  btn.disabled = true;
  btn.textContent = '测试中…';
  content.innerHTML = '<div class="loading">正在运行匹配测试，请稍候…</div>';

  try {
    const res = await fetch('/api/test-match-report');
    if (!res.ok) {
      const cached = await fetch('/cache/test-match-report.json');
      if (!cached.ok) throw new Error('无法获取测试报告');
      report = await cached.json();
    } else {
      report = await res.json();
    }
    activeScenarioId = report.scenarios.find((s) => s.id === 'back-jinshan-32-manual15')?.id
      || report.scenarios.find((s) => s.id === 'nationwide-multi-order')?.id
      || report.scenarios[0]?.id
      || null;
    activeSubView = 'pairings';
    const roleFilter = document.getElementById('role-filter');
    if (roleFilter) roleFilter.hidden = false;
    renderAll();
  } catch (err) {
    content.innerHTML = `<div class="loading" style="color:#fca5a5">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '重新运行测试';
  }
}

function renderAll() {
  if (!report) return;
  document.getElementById('gen-time').textContent =
    `生成时间：${formatTime(report.generatedAt)}`;

  const s = report.summary;
  document.getElementById('summary-cards').innerHTML = `
    <div class="card ${s.allPassed ? 'ok' : 'fail'}">
      <div class="n">${s.allPassed ? '通过' : '异常'}</div>
      <div class="l">总体结论</div>
    </div>
    <div class="card info">
      <div class="n">${s.passedScenarios}/${s.totalScenarios}</div>
      <div class="l">场景通过</div>
    </div>
    <div class="card ok">
      <div class="n">${countPairings()}</div>
      <div class="l">配对总数</div>
    </div>
    <div class="card warn">
      <div class="n">${countOver60()}</div>
      <div class="l">通勤&gt;60分</div>
    </div>
  `;

  document.getElementById('tabs').innerHTML = filteredScenarios().map((sc) => `
    <button type="button" class="tab ${sc.id === activeScenarioId ? 'active' : ''}" data-id="${esc(sc.id)}">
      ${esc(sc.name)}
      <span class="badge ${sc.passed ? 'ok' : 'fail'}">${sc.passed ? '✓' : '✗'}</span>
    </button>
  `).join('');

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeScenarioId = tab.dataset.id;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.id === activeScenarioId));
      renderScenario();
    });
  });

  renderScenario();
  renderRuleEngine();
  renderParkDemo();
  renderNotes();
}

function renderRuleEngine() {
  const box = document.getElementById('rule-section');
  if (!box || !report.ruleEngine) {
    if (box) box.innerHTML = '';
    return;
  }
  const r = report.ruleEngine;
  const sources = (report.dataSources || []).map((d) => `
    <div class="ds-item">
      <strong style="color:${d.touchesProductionExcel ? 'var(--warn)' : 'var(--ok)'}">${esc(d.label)}</strong>
      ${d.touchesProductionExcel ? ' · 读取 Excel' : ' · 纯模拟'}
      <div style="margin-top:4px">${esc(d.description)}</div>
    </div>
  `).join('');

  box.innerHTML = `
    <section class="rule-box">
      <h2>匹配规则引擎（所有场景相同）</h2>
      <p style="color:var(--muted);line-height:1.5">${esc(r.note)}</p>
      <div class="rule-tags">
        ${r.coreRules.map((rule) => `<span class="rule-tag">${esc(rule)}</span>`).join('')}
        ${(r.optionalRules || []).map((rule) => `<span class="rule-tag" style="opacity:.7">${esc(rule)}（软）</span>`).join('')}
      </div>
      <p style="font-size:0.74rem;color:var(--muted);margin-top:8px">
        函数 <code style="color:#a5b4fc">${esc(r.functionName)}</code>
        · 优化器 <code style="color:#a5b4fc">${esc(r.optimizer)}</code>
      </p>
      <h2 style="margin-top:14px;font-size:0.9rem">数据来源说明</h2>
      <div class="ds-grid">${sources}</div>
    </section>
  `;
}

function renderScenario() {
  const sc = filteredScenarios().find((x) => x.id === activeScenarioId)
    || report.scenarios.find((x) => x.id === activeScenarioId);
  const content = document.getElementById('content');
  if (!sc) {
    content.innerHTML = '<div class="loading">无场景数据</div>';
    return;
  }

  const roleTag = sc.roleCategory === '前道'
    ? '<span class="role-tag front">前道</span>'
    : sc.roleCategory === '后道'
      ? '<span class="role-tag back">后道</span>'
      : '';

  const unmatchedBlock = sc.unmatched.length
    ? `<div class="table-wrap" style="margin-bottom:14px">
        <table>
          <thead><tr><th>未匹配公司</th><th>园区</th><th>原因</th></tr></thead>
          <tbody>${sc.unmatched.map((u) => `
            <tr class="row-fail">
              <td>${esc(u.companyName)}</td>
              <td>${esc(u.parkName)}</td>
              <td>${esc(u.reason)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>`
    : '';

  content.innerHTML = `
    <section>
      <div class="scenario-hd">
        <div>
          <h2>${esc(sc.name)} ${roleTag} ${renderDataSourceBadge(sc)}</h2>
          <p class="desc">${esc(sc.description)}</p>
          <p class="desc" style="margin-top:6px">${esc(sc.dataSourceNote || '')}</p>
        </div>
        <span class="status-pill ${sc.passed ? 'ok' : 'fail'}">${sc.passed ? '合理' : '存在问题'}</span>
      </div>
      <div class="meta-row">
        ${renderCoverageMeta(sc)}
        <span>匹配 <strong>${sc.stats.matched}/${sc.stats.selected}</strong></span>
        <span>员工池 <strong>${sc.employeeCount || sc.employees?.length || '—'}</strong></span>
        <span>失败 <strong>${sc.stats.unmatched}</strong></span>
        <span>均通勤 <strong>${sc.stats.avgCommute} 分</strong></span>
        <span>超60分 <strong>${sc.stats.over60Commute}</strong></span>
        <span>规则违规 <strong>${sc.stats.ruleViolations}</strong></span>
        ${renderMultiOrderMeta(sc)}
      </div>
      <p class="desc" style="margin-top:10px">${esc(sc.message)}</p>

      <div class="sub-tabs">
        <button type="button" class="sub-tab ${activeSubView === 'pairings' ? 'active' : ''}" data-view="pairings">配对明细</button>
        <button type="button" class="sub-tab ${activeSubView === 'schedules' ? 'active' : ''}" data-view="schedules">一人多单行程 (${sc.schedules?.length || 0})</button>
        <button type="button" class="sub-tab ${activeSubView === 'employees' ? 'active' : ''}" data-view="employees">员工池 (${sc.employees?.length || 0})</button>
      </div>

      <div id="sub-content"></div>
    </section>
  `;

  document.querySelectorAll('.sub-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeSubView = tab.dataset.view;
      document.querySelectorAll('.sub-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === activeSubView));
      renderSubContent(sc, unmatchedBlock);
    });
  });

  renderSubContent(sc, unmatchedBlock);
}

function renderSubContent(sc, unmatchedBlock) {
  const box = document.getElementById('sub-content');
  if (!box) return;

  if (activeSubView === 'employees') {
    box.innerHTML = `
      <p class="emp-pool-note">本场景参与匹配的全部员工。对照职责、时段容量、出发地、负责园区，判断派单是否合理。</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>姓名</th>
              <th>职责</th>
              <th>时段容量</th>
              <th>出发地</th>
              <th>负责园区</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            ${(sc.employees || []).map((e) => `
              <tr>
                <td>${e.id}</td>
                <td class="emp-name">${esc(e.name)}</td>
                <td>${esc(e.roles)}</td>
                <td>${esc(e.capacity)}</td>
                <td class="addr">${esc(e.departureAddress)}</td>
                <td>${esc(e.serviceParkName)}</td>
                <td class="addr">${esc(e.remark || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (activeSubView === 'schedules') {
    const schedules = sc.schedules || [];
    if (!schedules.length) {
      box.innerHTML = '<p class="emp-pool-note">本场景无行程数据（全为一对一匹配时可看配对明细）。</p>';
      return;
    }
    box.innerHTML = `
      <p class="emp-pool-note">按员工汇总当日行程：同一时段只能 1 单；多单按上午 → 下午1 → 下午2 排序，并估算段间通勤。</p>
      <div class="schedule-grid">
        ${schedules.map((s) => renderScheduleCard(s)).join('')}
      </div>
    `;
    return;
  }

  box.innerHTML = `
    ${unmatchedBlock}
    <div class="table-wrap">
      <table id="pairing-table">
        <thead>
          <tr>
            <th>公司 / 拜访信息</th>
            <th>园区</th>
            <th>匹配员工 / 出发地</th>
            <th>通勤</th>
            <th>合理性</th>
            <th>规则</th>
          </tr>
        </thead>
        <tbody>
          ${sc.pairings.map((p, i) => renderPairingRow(p, i)).join('')}
        </tbody>
      </table>
    </div>
    <p class="desc" style="margin-top:10px">点击行可展开完整规则明细</p>
  `;

  document.querySelectorAll('.click-row').forEach((row) => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

function renderDataSourceBadge(sc) {
  const src = sc.dataSource || 'synthetic';
  const labels = {
    synthetic: '合成数据',
    production: 'Excel存量',
    'nationwide-simulation': '全国模拟',
  };
  const cls = src === 'production' ? 'production' : src === 'nationwide-simulation' ? 'nationwide' : 'synthetic';
  return `<span class="src-badge ${cls}">${esc(labels[src] || src)}</span>`;
}

function renderCoverageMeta(sc) {
  const c = sc.coverage;
  if (!c) return '';
  const parts = [];
  if (c.cities) parts.push(`<span>城市 <strong>${c.cities}</strong></span>`);
  if (c.parks) parts.push(`<span>园区 <strong>${c.parks}</strong></span>`);
  if (c.employees) parts.push(`<span>员工 <strong>${c.employees}</strong></span>`);
  if (c.customers) parts.push(`<span>客户 <strong>${c.customers}</strong></span>`);
  return parts.join('');
}

function renderMultiOrderMeta(sc) {
  const m = sc.multiOrderStats;
  if (!m) return '';
  return `
    <span>多单员工 <strong>${m.employeesWithMultipleOrders}</strong></span>
    <span>≥3单 <strong>${m.employeesWithThreePlus}</strong></span>
    <span>最高单量 <strong>${m.maxOrdersPerEmployee}</strong></span>
    <span>行程违规 <strong>${m.scheduleViolations}</strong></span>
  `;
}

function renderScheduleCard(s) {
  const cls = s.reasonable ? 'ok' : 'fail';
  const pill = s.reasonable
    ? '<span class="tag ok">行程合理</span>'
    : '<span class="tag fail">行程异常</span>';
  const orders = (s.orders || []).map((o) => `
    <div class="schedule-order">
      <span class="slot">${esc(o.timeSlot)}</span>
      · ${esc(o.customerType)} · ${esc(o.companyName)}
      <div class="addr">${esc(o.parkName)} · ${esc(o.address)}</div>
      <div class="addr">本段通勤 ${o.commuteMinutes} 分</div>
    </div>
  `).join('');
  const routes = (s.routeSegments || []).map((r) =>
    `${esc(r.from)} → ${esc(r.to)}（${r.minutes} 分）`
  ).join('<br>');
  const issues = (s.issues || []).length
    ? `<div class="issue-list">${s.issues.map((i) => `⚠ ${esc(i)}`).join('<br>')}</div>`
    : '';

  return `
    <div class="schedule-card ${cls}">
      <div class="schedule-hd">
        <div>
          <h3>${esc(s.employeeName)} <span style="color:var(--muted);font-weight:400">#${s.employeeId}</span></h3>
          <div class="schedule-meta">出发地：${esc(s.departureAddress)}</div>
        </div>
        <div>${pill}</div>
      </div>
      <div class="schedule-meta">
        共 <strong>${s.totalOrders}</strong> 单（上午 ${s.morningOrders} · 下午 ${s.afternoonOrders}）
        · 当日总通勤约 <strong>${s.totalCommuteMinutes}</strong> 分
      </div>
      <div class="schedule-orders">${orders}</div>
      ${routes ? `<div class="route-seg"><strong style="color:#a5b4fc">路线段</strong><br>${routes}</div>` : ''}
      ${issues}
    </div>
  `;
}

function renderPairingRow(p, idx) {
  const rowCls = !p.reasonable ? 'row-fail' : p.commuteMinutes > 60 ? 'row-warn' : 'row-ok';
  const coreRules = p.rules.filter((r) => CORE_DISPLAY.includes(r.rule));
  const rulesSummary = coreRules.map((r) =>
    `<span class="${r.passed ? 'r-ok' : 'r-fail'}">${esc(r.rule)}${r.passed ? '✓' : '✗'}</span>`
  ).join(' ');

  const tags = (p.reasonableTags || []).map((t) => {
    const cls = t.includes('异常') || t.includes('不匹配') ? 'fail' : t.includes('超') || t.includes('偏长') ? 'warn' : 'ok';
    return `<span class="tag ${cls}">${esc(t)}</span>`;
  }).join('');

  const detailRules = p.rules.map((r) =>
    `<div class="${r.passed ? 'r-ok' : 'r-fail'}">${esc(r.rule)}：${esc(r.message)}</div>`
  ).join('');

  const desig = p.designatedPerson ? `<div class="co-meta"><strong>指定人</strong> ${esc(p.designatedPerson)}</div>` : '';
  const reject = p.rejectedPerson ? `<div class="co-meta"><strong>放弃人</strong> ${esc(p.rejectedPerson)}</div>` : '';
  const empRoles = p.employeeRoles || '—';
  const empCap = p.employeeCapacity || '—';
  const empPark = p.employeeServicePark || '—';
  const empRemark = p.employeeRemark ? `<div class="emp-meta"><strong>备注</strong> ${esc(p.employeeRemark)}</div>` : '';

  return `
    <tr class="click-row ${rowCls}" data-idx="${idx}">
      <td>
        <div>${esc(p.companyName)}</div>
        <div class="co-meta"><strong>类型</strong> ${esc(p.customerType)} · <strong>时段</strong> ${esc(p.timeSlot)}</div>
        <div class="addr">${esc(p.address)}</div>
        ${desig}${reject}
        <div class="detail-panel">${detailRules}</div>
      </td>
      <td>${esc(p.parkName)}</td>
      <td>
        <div class="emp-name">${esc(p.employeeName)} <span style="color:var(--muted);font-weight:400">#${p.employeeId || '—'}</span></div>
        <div class="emp-meta"><strong>职责</strong> ${esc(empRoles)}</div>
        <div class="emp-meta"><strong>时段容量</strong> ${esc(empCap)}</div>
        <div class="emp-meta"><strong>负责园区</strong> ${esc(empPark)}</div>
        <div class="addr" style="margin-top:6px"><strong style="color:#a5b4fc">出发地</strong> ${esc(p.departureAddress)}</div>
        ${empRemark}
      </td>
      <td>
        <strong>${p.commuteMinutes}</strong> 分
        <div class="addr">引擎估算 · ${esc(p.commuteSource)}</div>
        <div class="addr">直连估算 ${p.directCommuteMinutes} 分</div>
      </td>
      <td>${tags}</td>
      <td class="rules-cell">${rulesSummary}</td>
    </tr>
  `;
}

function renderParkDemo() {
  const sec = document.getElementById('park-section');
  const demo = report.parkMatchDemo;
  if (!demo) { sec.hidden = true; return; }
  sec.hidden = false;
  document.getElementById('park-title').textContent = demo.title;
  document.getElementById('park-cases').innerHTML = demo.cases.map((c) => `
    <div class="park-case ${c.passed ? 'ok' : 'fail'}">
      <strong>${c.passed ? '✓' : '✗'}</strong>
      园区「${esc(c.parkName)}」 + 出发地「${esc(c.departure)}」
      <div style="margin-top:6px;color:var(--muted)">${esc(c.note)}</div>
    </div>
  `).join('');
}

function renderNotes() {
  const sec = document.getElementById('notes-section');
  if (!report.notes?.length) { sec.hidden = true; return; }
  sec.hidden = false;
  document.getElementById('notes-list').innerHTML = report.notes.map((n) => `<li>${esc(n)}</li>`).join('');
}

function countPairings() {
  return report.scenarios.reduce((n, s) => n + s.pairings.length, 0);
}

function countOver60() {
  return report.scenarios.reduce((n, s) => n + s.stats.over60Commute, 0);
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prefillLookupExamples() {
  const form = document.getElementById('lookup-form');
  if (!form) return;
  if (form.parkName.value) return;
  form.parkName.value = '杨浦-复旦';
  form.address.value = '上海市杨浦区邯郸路220号';
}

async function runLookup() {
  const form = document.getElementById('lookup-form');
  const btn = document.getElementById('lookup-btn');
  const status = document.getElementById('lookup-status');
  const box = document.getElementById('lookup-result');
  if (!form || !btn || !box) return;

  const body = {
    parkName: form.parkName.value.trim(),
    address: form.address.value.trim(),
    cityName: form.cityName.value.trim() || undefined,
    customerType: form.customerType.value,
    timeSlot: form.timeSlot.value,
  };

  btn.disabled = true;
  status.textContent = '匹配中…';
  box.innerHTML = '';

  try {
    const res = await fetch('/api/test-match-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(res.ok ? '响应格式错误' : '接口不可用，请刷新页面或重启服务后重试');
    }
    if (!res.ok) throw new Error(data.error || '试算失败');
    status.textContent = `全量员工 ${data.poolStats.totalEmployees} 人 · 合规 ${data.poolStats.eligibleCount} 人${data.poolStats.cityInferred ? ' · 城市已自动推断' : ''}`;
    box.innerHTML = renderLookupResult(data);
  } catch (err) {
    status.textContent = '';
    box.innerHTML = `<div class="loading" style="color:#fca5a5;padding:12px">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderLookupResult(data) {
  if (!data.bestMatch) {
    const hint = data.districtHint
      ? `<p style="color:#fbbf24;font-size:0.82rem;margin-bottom:10px">${esc(data.districtHint)}</p>`
      : '';
    const misses = (data.nearMisses || []).map((m) => `
      <tr>
        <td>${esc(m.employeeName)}</td>
        <td class="addr">${esc(m.departureAddress)}</td>
        <td>${m.commuteMinutes} 分</td>
        <td class="rules-cell">${m.failedRules.map((r) => `<span class="r-fail">${esc(r.rule)}</span>`).join(' ')}</td>
      </tr>
    `).join('');
    return `
      ${hint}
      <p style="color:var(--warn);font-size:0.82rem">未找到合规员工。常见原因：城市不匹配、园区名与出发地不对应、职责或时段不符。</p>
      ${misses ? `<div class="table-wrap"><table><thead><tr><th>较近但不合规</th><th>出发地</th><th>通勤</th><th>失败规则</th></tr></thead><tbody>${misses}</tbody></table></div>` : ''}
    `;
  }

  const best = data.bestMatch;
  const bestRules = best.rules.filter((r) => CORE_DISPLAY.includes(r.rule)).map((r) =>
    `<span class="${r.passed ? 'r-ok' : 'r-fail'}">${esc(r.rule)}${r.passed ? '✓' : '✗'}</span>`
  ).join(' ');

  const rows = (data.eligible || []).map((e, i) => `
    <tr class="${i === 0 ? 'row-ok' : ''}">
      <td class="emp-name">${esc(e.employeeName)} ${i === 0 ? '<span class="tag ok">推荐</span>' : ''}</td>
      <td>${esc(e.roles)}</td>
      <td>${esc(e.capacity)}</td>
      <td class="addr">${esc(e.departureAddress)}</td>
      <td>${esc(e.serviceParkName)}</td>
      <td><strong>${e.commuteMinutes}</strong> 分</td>
      <td>${e.score}</td>
    </tr>
  `).join('');

  return `
    <div class="best-card">
      <h3>推荐：${esc(best.employeeName)}</h3>
      <div class="schedule-meta">
        出发地 ${esc(best.departureAddress)} · 负责园区 ${esc(best.serviceParkName)}<br>
        职责 ${esc(best.roles)} · 时段容量 ${esc(best.capacity)} · 通勤约 <strong>${best.commuteMinutes}</strong> 分
      </div>
      <div class="rules-cell" style="margin-top:8px">${bestRules}</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>员工</th><th>职责</th><th>容量</th><th>出发地</th><th>负责园区</th><th>通勤</th><th>得分</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="desc" style="margin-top:8px">${esc(data.note)} · 查询：${esc(data.query.cityName)} / ${esc(data.query.parkName)} / ${esc(data.query.customerType)} / ${esc(data.query.timeSlot)}</p>
  `;
}
