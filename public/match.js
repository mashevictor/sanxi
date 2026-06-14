const CORE_RULES = new Set(['城市匹配', '职责匹配', '时段匹配', '指定人', '放弃人', '园区匹配']);

let sessionId = null;
let allCompanies = [];
let allEmployees = [];
let previewPairings = [];
let previewUnmatched = [];
let employeeSchedules = [];
let assignmentMap = new Map();
let expandedRows = new Set();
let expandedRules = new Set();
const selectedCompanies = new Set();
let previewTimer = null;
let isMatching = false;
let distanceSource = '';
let maxCommuteMinutes = 60;
let openPickerId = null;
let pickerSearch = '';
let activeView = 'results';

let showcaseCustomerIds = [];
let showcaseMatchCache = null;

const SHOWCASE_CACHE_URL = '/cache/showcase-match.json';

const dispatchBtn = document.getElementById('dispatch-btn');
const pageLoader = document.getElementById('page-loader');

dispatchBtn.addEventListener('click', runDispatch);
document.getElementById('sel-all-co').addEventListener('click', toggleAllCompanies);
document.getElementById('showcase-btn').addEventListener('click', loadShowcaseAndMatch);

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

document.addEventListener('DOMContentLoaded', () => {
  loadIntegratedData();
  preloadShowcaseCache();
  document.getElementById('dispatch-board').addEventListener('click', handleBoardClick);
  document.addEventListener('click', (e) => {
    if (openPickerId !== null && !e.target.closest('.emp-picker')) {
      openPickerId = null;
      pickerSearch = '';
      renderBoard({ animate: false });
    }
  });
});

function handleBoardClick(e) {
  const detailBtn = e.target.closest('.btn-detail');
  if (detailBtn) {
    e.stopPropagation();
    toggleRowDetail(parseInt(detailBtn.dataset.cid, 10));
    return;
  }
  const rulesBtn = e.target.closest('.btn-rules');
  if (rulesBtn) {
    e.stopPropagation();
    toggleRowRules(parseInt(rulesBtn.dataset.cid, 10));
    return;
  }
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll('.view-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  const resultsBoard = document.getElementById('dispatch-board');
  const scheduleBoard = document.getElementById('schedule-board');
  if (view === 'results') {
    resultsBoard.hidden = false;
    scheduleBoard.hidden = true;
    resultsBoard.style.animation = 'fadeUp .35s ease';
  } else {
    resultsBoard.hidden = true;
    scheduleBoard.hidden = false;
    scheduleBoard.style.animation = 'fadeUp .35s ease';
    renderSchedules();
  }
}

async function loadIntegratedData() {
  try {
    const res = await fetch('/api/sample-data');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败');
    applySessionData(data);
    renderCompanies();
    renderBoard();
    updateStats();
  } catch (err) {
    showToast(err.message);
  } finally {
    pageLoader.classList.add('hide');
  }
}

async function preloadShowcaseCache() {
  try {
    await fetchShowcaseCache();
  } catch {
    /* 缓存可选，失败时一键演示会提示 */
  }
}

async function fetchShowcaseCache() {
  if (showcaseMatchCache) return showcaseMatchCache;
  const res = await fetch(SHOWCASE_CACHE_URL);
  if (!res.ok) throw new Error('演示缓存未找到，请运行 npm run cache:showcase');
  showcaseMatchCache = await res.json();
  return showcaseMatchCache;
}

async function loadShowcaseAndMatch() {
  if (!sessionId) {
    await loadIntegratedData();
  }

  try {
    const cache = await fetchShowcaseCache();
    const remapped = remapCacheResult(cache);
    const ids = resolveShowcaseSelectIds(remapped);

    if (!ids.length) {
      showToast('未找到演示公司数据');
      return;
    }

    selectedCompanies.clear();
    ids.forEach((id) => selectedCompanies.add(id));

    if (!document.querySelector('#company-list input')) {
      renderCompanies();
    } else {
      syncCompanySelectionUI();
    }
    scrollToFirstSelectedCompany();
    updateStats();

    activeView = 'results';
    switchView('results');

    applyDispatchResult({
      pairings: remapped.pairings || [],
      unmatchedCompanies: remapped.unmatchedCompanies || [],
      employeeSchedules: remapped.employeeSchedules || [],
      message: (remapped.message || '演示匹配完成') + '（缓存）',
      distanceSource: remapped.distanceSource || 'local',
      maxCommuteMinutes: remapped.maxCommuteMinutes || 60,
    });
    renderBoard({ animate: true });
    renderSchedules();
    updateStats();
    showToast((remapped.message || '演示匹配完成') + '（缓存）');
  } catch (err) {
    showToast(err.message);
  }
}

function resolveShowcaseSelectIds(cache) {
  const byTag = allCompanies.filter((c) => c.sourceTag === '演示').map((c) => c.id);
  if (byTag.length) return byTag;
  if (cache?.showcaseCustomerIds?.length) return cache.showcaseCustomerIds;
  return showcaseCustomerIds;
}

function findEmployeeInSession(name, departureAddress, preferDemo = false) {
  if (preferDemo) {
    const demo = allEmployees.find((e) => e.name === name && e.sourceTag === '演示');
    if (demo) return demo;
  }
  return (
    allEmployees.find((e) => e.name === name && departureAddress && e.departureAddress === departureAddress)
    || allEmployees.find((e) => e.name === name)
  );
}

function remapCacheResult(cache) {
  const companyByName = new Map(allCompanies.map((c) => [c.companyName, c]));
  const pairings = (cache.pairings || []).map((p) => {
    const company = companyByName.get(p.companyName);
    const emp = findEmployeeInSession(p.employeeName, p.departureAddress, true);
    return {
      ...p,
      customerId: company?.id ?? p.customerId,
      employeeId: emp?.id ?? p.employeeId,
      employeeName: emp?.name ?? p.employeeName,
      departureAddress: emp?.departureAddress ?? p.departureAddress,
      locked: true,
    };
  });
  const employeeSchedules = (cache.employeeSchedules || []).map((s) => {
    const emp = findEmployeeInSession(s.employeeName, s.departureAddress, true);
    return {
      ...s,
      employeeId: emp?.id ?? s.employeeId,
      orders: (s.orders || []).map((o) => {
        const company = companyByName.get(o.companyName);
        return { ...o, customerId: company?.id ?? o.customerId };
      }),
    };
  });
  return { ...cache, pairings, employeeSchedules };
}

function syncCompanySelectionUI() {
  document.querySelectorAll('#company-list input[type="checkbox"]').forEach((cb) => {
    const id = parseInt(cb.value, 10);
    const on = selectedCompanies.has(id);
    cb.checked = on;
    cb.closest('.co-item')?.classList.toggle('checked', on);
  });
}

function scrollToFirstSelectedCompany() {
  const first = document.querySelector('#company-list .co-item.checked');
  if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function toggleRowDetail(customerId) {
  if (expandedRows.has(customerId)) expandedRows.delete(customerId);
  else expandedRows.add(customerId);

  const row = document.querySelector(`.dispatch-row[data-cid="${customerId}"]`);
  if (!row) return;

  const entry = assignmentMap.get(customerId);
  const expand = row.querySelector(':scope > .row-expand');
  const btn = row.querySelector('.btn-detail');
  if (!expand || !btn) return;

  const isOpen = expandedRows.has(customerId);
  expand.hidden = !isOpen;
  btn.textContent = isOpen ? '收起' : (entry?.type === 'ok' ? '详情' : '原因');
  btn.classList.toggle('open', isOpen);
}

function toggleRowRules(customerId) {
  if (expandedRules.has(customerId)) expandedRules.delete(customerId);
  else expandedRules.add(customerId);

  const row = document.querySelector(`.dispatch-row[data-cid="${customerId}"]`);
  if (!row) return;

  const rulesBody = row.querySelector('.rules-body');
  const rulesBtn = row.querySelector(`.btn-rules[data-cid="${customerId}"]`);
  if (!rulesBody || !rulesBtn) return;

  const isOpen = expandedRules.has(customerId);
  rulesBody.hidden = !isOpen;
  const arrow = rulesBtn.querySelector('.arrow');
  if (arrow) arrow.textContent = isOpen ? '▲ 收起' : '▼ 展开';
}

function applySessionData(data) {
  sessionId = data.sessionId;
  allCompanies = data.companies;
  allEmployees = data.employees;
  showcaseCustomerIds = data.showcaseCustomerIds || [];
  maxCommuteMinutes = data.maxCommuteMinutes || 60;
  selectedCompanies.clear();
  assignmentMap.clear();
  previewPairings = [];
  previewUnmatched = [];
  employeeSchedules = [];
  distanceSource = '';
}

function renderCompanies() {
  const list = document.getElementById('company-list');
  list.innerHTML = allCompanies.map((c) => `
    <label class="co-item ${selectedCompanies.has(c.id) ? 'checked' : ''}">
      <input type="checkbox" value="${c.id}" ${selectedCompanies.has(c.id) ? 'checked' : ''}>
      <div style="min-width:0">
        <div class="co-name">
          ${esc(c.companyName)}
          ${c.sourceTag ? `<span class="source-tag">${esc(c.sourceTag)}</span>` : ''}
        </div>
        <div class="co-meta">${esc(c.customerType)} · ${esc(c.timeSlot)}</div>
        <div class="co-meta">${esc(c.parkName)}</div>
      </div>
    </label>
  `).join('');

  list.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.value, 10);
      if (cb.checked) selectedCompanies.add(id);
      else {
        selectedCompanies.delete(id);
        assignmentMap.delete(id);
        expandedRows.delete(id);
        expandedRules.delete(id);
      }
      cb.closest('.co-item').classList.toggle('checked', cb.checked);
      updateStats();
      schedulePreview();
    });
  });
}

function getSelectedIds() {
  return Array.from(selectedCompanies);
}

function getCompanyTimeSlot(customerId) {
  const entry = assignmentMap.get(customerId);
  if (entry?.data?.timeSlot) return entry.data.timeSlot;
  const company = allCompanies.find((c) => c.id === customerId);
  return company?.timeSlot || '';
}

function getLockedPairings() {
  const locked = [];
  for (const [cid, entry] of assignmentMap) {
    if (entry.type === 'ok' && selectedCompanies.has(Number(cid))) {
      locked.push({ customerId: Number(cid), employeeId: entry.data.employeeId });
    }
  }
  return locked;
}

function getMatchOnlyIds() {
  const lockedIds = new Set(getLockedPairings().map((p) => p.customerId));
  return getSelectedIds().filter((id) => !lockedIds.has(id));
}

function syncAssignmentFromApi(pairings, unmatched) {
  const lockedIds = new Set(getLockedPairings().map((p) => p.customerId));

  for (const id of [...assignmentMap.keys()]) {
    if (!selectedCompanies.has(Number(id))) assignmentMap.delete(id);
  }

  for (const p of pairings) {
    const existing = assignmentMap.get(p.customerId);
    if (lockedIds.has(p.customerId) && existing?.type === 'ok' && existing.manual) {
      continue;
    }
    assignmentMap.set(p.customerId, {
      type: 'ok',
      data: p,
      manual: existing?.manual && lockedIds.has(p.customerId) ? true : false,
    });
  }

  for (const u of unmatched) {
    if (lockedIds.has(u.customerId) && assignmentMap.get(u.customerId)?.type === 'ok') continue;
    assignmentMap.set(u.customerId, { type: 'fail', data: u, manual: false });
  }
}

function getExistingPairings(excludeCustomerId) {
  const pairings = [];
  for (const [cid, entry] of assignmentMap) {
    if (entry.type === 'ok' && Number(cid) !== excludeCustomerId) {
      pairings.push({ customerId: Number(cid), employeeId: entry.data.employeeId });
    }
  }
  return pairings;
}

function getUsedEmployeeIds(excludeCustomerId) {
  const slot = getCompanyTimeSlot(excludeCustomerId);
  const used = [];
  for (const [cid, entry] of assignmentMap) {
    if (entry.type !== 'ok' || Number(cid) === excludeCustomerId) continue;
    if (getCompanyTimeSlot(Number(cid)) === slot) {
      used.push(entry.data.employeeId);
    }
  }
  return used;
}

function renderEmployeePicker(customerId, currentEmployeeId, disabled) {
  const used = getUsedEmployeeIds(customerId);
  const current = allEmployees.find((e) => e.id === currentEmployeeId);
  const isOpen = openPickerId === customerId;

  const filtered = allEmployees.filter((e) => {
    if (!pickerSearch || !isOpen) return true;
    const q = pickerSearch.toLowerCase();
    const tags = (e.tags || e.roles || []).join(' ');
    const hay = `${e.name} ${e.departureAddress || ''} ${tags}`.toLowerCase();
    return hay.includes(q);
  });

  const items = filtered.map((e) => {
    const taken = used.includes(e.id) && e.id !== currentEmployeeId;
    const tags = e.tags || [...(e.roles || []), ...(e.capacityLabels || [])];
    const showcaseTag = e.sourceTag ? `<span class="source-tag">${esc(e.sourceTag)}</span>` : '';
    return `
      <div class="emp-option ${taken ? 'disabled' : ''} ${e.id === currentEmployeeId ? 'selected' : ''}"
           data-cid="${customerId}" data-eid="${e.id}" data-taken="${taken ? '1' : '0'}">
        <div class="emp-option-top">
          <span class="emp-option-name">${esc(e.name)} ${showcaseTag}</span>
          ${taken ? '<span class="emp-taken">同时段已占用</span>' : ''}
        </div>
        <div class="emp-option-tags">${tags.map((t) => `<span class="etag">${esc(t)}</span>`).join('')}</div>
        <div class="emp-option-dep">出发：${esc(e.departureAddress || '未填写')}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="emp-picker ${isOpen ? 'open' : ''}" data-cid="${customerId}">
      <button type="button" class="emp-picker-btn" data-cid="${customerId}" ${disabled ? 'disabled' : ''}>
        <span>
          <div class="picker-name">${current ? esc(current.name) : '选择员工'}</div>
          ${current ? `<div class="picker-sub">${esc((current.tags || current.roles || []).slice(0, 2).join(' · '))}${current.sourceTag ? ` · ${esc(current.sourceTag)}` : ''}</div>` : ''}
        </span>
        <span class="picker-arrow">▼</span>
      </button>
      <div class="emp-picker-panel" ${isOpen ? '' : 'hidden'} data-cid="${customerId}">
        <input type="text" class="emp-search" placeholder="搜索姓名 / 出发地 / 标签" value="${esc(pickerSearch)}" data-cid="${customerId}">
        <div class="emp-picker-list">${items || '<div style="padding:12px;color:var(--muted);font-size:0.8rem">无匹配员工</div>'}</div>
      </div>
    </div>
  `;
}

function renderCommuteCell(minutes, route) {
  if (!minutes && minutes !== 0) {
    return `<div class="cell-commute"><span class="commute-none">—</span></div>`;
  }
  const src = route?.source === 'deepseek' ? 'AI' : '本地';
  const km = route?.distanceKm ? `<div class="commute-src">${route.distanceKm} km</div>` : '';
  const within = minutes <= maxCommuteMinutes;
  const cls = within ? 'commute-ok' : 'commute-warn';
  const hint = within ? '≤60分可派' : '超60分仍可选';
  return `
    <div class="cell-commute">
      <span class="commute-big ${cls}">${minutes}</span><span class="commute-unit">分</span>
      <div class="commute-src">${src}</div>
      <div class="commute-hint">${hint}</div>
      ${km}
    </div>
  `;
}

function renderRulesCollapse(customerId, rules, label) {
  const corePass = (rules || []).filter((r) => CORE_RULES.has(r.rule) && r.passed).length;
  const open = expandedRules.has(customerId);
  const chips = (rules || []).map((r) => {
    const isPlus = r.rule === 'Plus匹配';
    const cls = r.passed ? 'pass' : (isPlus ? 'ref' : 'fail');
    const icon = r.passed ? '✓' : (isPlus ? '○' : '✗');
    return `<span class="chip ${cls}">${icon} ${esc(r.rule)}</span>`;
  }).join('');
  return `
    <div class="rules-collapse">
      <button type="button" class="rules-toggle btn-rules" data-cid="${customerId}">
        <span>${label || '匹配规则'}（${corePass}/6 通过）</span>
        <span class="arrow">${open ? '▲ 收起' : '▼ 展开'}</span>
      </button>
      <div class="rules-body" ${open ? '' : 'hidden'}><div class="rule-chips">${chips}</div></div>
    </div>
  `;
}

function renderExpandContent(entry) {
  const cid = entry.data.customerId;
  if (entry.type === 'ok') {
    const p = entry.data;
    const lockTag = p.locked ? ' · 已锁定不重算' : '';
    return `
      <div class="route-line">${p.route?.pathSummary ? esc(p.route.pathSummary) : `${esc(p.departureAddress)} → ${esc(p.address)}`}</div>
      <div style="color:var(--muted);font-size:0.72rem">园区 ${esc(p.parkName)} · ${esc(p.customerType)} · ${esc(p.timeSlot)} · 出发 ${esc(p.departureAddress)}${lockTag}</div>
      ${renderRulesCollapse(cid, p.rules, '匹配规则')}
    `;
  }
  const u = entry.data;
  let html = `<div class="fail-reason">${esc(u.reason)}</div>`;
  if (u.nearestAttempt) {
    html += `<div style="margin-top:6px;color:var(--muted)">最近候选 <strong>${esc(u.nearestAttempt.employeeName)}</strong>（${esc(u.nearestAttempt.departureAddress)}）</div>`;
    if (u.nearestAttempt.route?.pathSummary) {
      html += `<div class="route-line">${esc(u.nearestAttempt.route.pathSummary)}</div>`;
    }
    if (u.nearestAttempt.failedRules?.length) {
      const failRules = u.nearestAttempt.failedRules.map((r) => ({
        rule: r.rule,
        passed: false,
        message: r.message,
      }));
      html += renderRulesCollapse(cid, failRules, '未通过规则');
    }
  }
  if (u.conflictWith) {
    html += `<div style="margin-top:4px;color:var(--muted)">员工 ${esc(u.conflictWith.employeeName)} 已派给 ${esc(u.conflictWith.takenByCompany)}</div>`;
  }
  return html;
}

function renderDispatchRow(customerId, entry, animIndex = 0, animate = true) {
  const company = allCompanies.find((c) => c.id === customerId);
  const expanded = expandedRows.has(customerId);
  const used = getUsedEmployeeIds(customerId);
  const isDup = entry.type === 'ok' && used.filter((id) => id === entry.data.employeeId).length > 0;

  if (entry.type === 'ok') {
    const p = entry.data;
    const rowCls = ['dispatch-row', 'row-ok', animate ? 'row-enter' : '', entry.manual ? 'row-manual' : '', isDup ? 'row-dup' : ''].filter(Boolean).join(' ');
    const animStyle = animate ? `style="animation-delay:${animIndex * 0.06}s"` : '';
    return `
      <div class="${rowCls}" data-cid="${customerId}" ${animStyle}>
        <div class="row-grid">
          <div class="status-dot ok"></div>
          <div class="cell-company">
            <div class="name" title="${esc(p.companyName)}">${esc(p.companyName)}</div>
            <div class="sub">${esc(p.customerType)} · ${esc(p.parkName)} · ${esc(p.timeSlot)}</div>
          </div>
          <div class="cell-arrow">→</div>
          <div class="cell-employee">
            ${renderEmployeePicker(customerId, p.employeeId, isMatching)}
            ${entry.manual ? '<span class="manual-tag">手动调整</span>' : ''}
            ${p.locked ? '<span class="manual-tag" style="background:rgba(99,102,241,.2);color:#c4b5fd">已锁定</span>' : ''}
            ${isDup ? '<span class="manual-tag" style="background:rgba(239,68,68,.2);color:#fca5a5">同时段冲突</span>' : ''}
          </div>
          ${renderCommuteCell(p.commuteMinutes, p.route)}
          <div class="cell-action">
            <button class="btn-ghost btn-detail ${expanded ? 'open' : ''}" data-cid="${customerId}">${expanded ? '收起' : '详情'}</button>
          </div>
        </div>
        <div class="row-expand" ${expanded ? '' : 'hidden'}>${renderExpandContent(entry)}</div>
      </div>
    `;
  }

  const u = entry.data;
  const animStyle = animate ? `style="animation-delay:${animIndex * 0.06}s"` : '';
  return `
    <div class="dispatch-row row-fail${animate ? ' row-enter' : ''}" data-cid="${customerId}" ${animStyle}>
      <div class="row-grid">
        <div class="status-dot fail"></div>
        <div class="cell-company">
          <div class="name" title="${esc(u.companyName)}">${esc(u.companyName)}</div>
          <div class="sub">${esc(u.customerType || company?.customerType || '')} · ${esc(u.parkName)} · ${esc(company?.timeSlot || '')}</div>
        </div>
        <div class="cell-arrow">→</div>
        <div class="cell-employee">
          ${renderEmployeePicker(customerId, null, isMatching)}
          <span class="manual-tag" style="background:rgba(239,68,68,.2);color:#fca5a5">待指派</span>
        </div>
        <div class="cell-commute"><span class="commute-none">—</span></div>
        <div class="cell-action">
          <button class="btn-ghost btn-detail ${expanded ? 'open' : ''}" data-cid="${customerId}">${expanded ? '收起' : '原因'}</button>
        </div>
      </div>
      <div class="row-expand" ${expanded ? '' : 'hidden'}>${renderExpandContent(entry)}</div>
    </div>
  `;
}

function renderBoard(options = {}) {
  const animate = options.animate !== false;
  const board = document.getElementById('dispatch-board');
  const selectedIds = getSelectedIds();

  if (isMatching) {
    board.innerHTML = `
      <div class="thinking">
        <div class="ai-orbit"></div>
        <div>AI 正在匹配并计算通勤<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>
      </div>`;
    return;
  }

  if (selectedIds.length === 0) {
    board.innerHTML = '<div class="empty">勾选左侧公司，AI 将自动匹配并在此展示结果（已匹配的不会重复计算）</div>';
    return;
  }

  const okRows = [];
  const failRows = [];

  selectedIds.forEach((id) => {
    const entry = assignmentMap.get(id);
    if (!entry) {
      const company = allCompanies.find((c) => c.id === id);
      failRows.push(`
        <div class="dispatch-row">
          <div class="row-grid">
            <div class="status-dot" style="background:#64748b"></div>
            <div class="cell-company"><div class="name">${esc(company?.companyName || '')}</div></div>
            <div class="cell-arrow">→</div>
            <div class="cell-employee"><span style="color:var(--muted);font-size:0.82rem">等待匹配...</span></div>
            <div class="cell-commute"><span class="commute-none">—</span></div>
            <div></div>
          </div>
        </div>
      `);
      return;
    }
    const animIndex = okRows.length + failRows.length;
    const html = renderDispatchRow(id, entry, animIndex, animate);
    if (entry.type === 'ok') okRows.push(html);
    else failRows.push(html);
  });

  let html = '';

  if (okRows.length > 0) {
    html += `
      <div class="board-section">
        <div class="section-hd ok">
          <span>✓ 匹配成功</span>
          <span class="section-count">${okRows.length} 家</span>
        </div>
        <div class="section-body">${okRows.join('')}</div>
      </div>
    `;
  }

  if (failRows.length > 0) {
    html += `
      <div class="board-section">
        <div class="section-hd fail">
          <span>✗ 匹配失败 / 待匹配</span>
          <span class="section-count">${failRows.length} 家</span>
        </div>
        <div class="section-body">${failRows.join('')}</div>
      </div>
    `;
  }

  board.innerHTML = html || '<div class="empty">暂无结果</div>';
  bindBoardEvents();
}

function renderSchedules() {
  const board = document.getElementById('schedule-board');
  if (!employeeSchedules.length) {
    board.innerHTML = '<div class="empty">匹配成功后，可在此查看每位员工的当日行程（支持上午+下午多单）</div>';
    return;
  }

  board.innerHTML = employeeSchedules.map((s, idx) => {
    const orders = s.orders.map((o) => `
      <div class="schedule-order">
        <span class="slot-tag">${esc(o.timeSlot)}</span>
        <div>
          <div style="font-weight:600;font-size:0.84rem">${esc(o.companyName)}</div>
          <div class="schedule-meta">${esc(o.customerType)} · ${esc(o.parkName)}</div>
          <div class="schedule-meta">${esc(o.address)}</div>
        </div>
        <div style="text-align:right">
          <div class="commute-big commute-ok" style="font-size:1.1rem">${o.commuteMinutes}</div>
          <div class="commute-unit">分钟</div>
        </div>
      </div>
    `).join('');

    const routes = (s.routeSegments || []).map((seg) => `
      <div class="route-seg"><span>${esc(seg.from)}</span> → <span>${esc(seg.to)}</span> · ${seg.minutes} 分</div>
    `).join('');

    return `
      <div class="schedule-card" style="animation-delay:${idx * 0.08}s">
        <div class="schedule-hd">
          <div>
            <div class="schedule-name">${esc(s.employeeName)}</div>
            <div class="schedule-meta">出发地：${esc(s.departureAddress)}</div>
          </div>
          <div class="schedule-stats">
            <span>${s.totalOrders} 单</span>
            <span>上午 ${s.morningOrders}</span>
            <span>下午 ${s.afternoonOrders}</span>
            <span>总通勤 ${s.totalCommuteMinutes} 分</span>
          </div>
        </div>
        ${orders}
        ${routes}
      </div>
    `;
  }).join('');
}

function bindBoardEvents() {
  document.querySelectorAll('.emp-picker-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const cid = parseInt(btn.dataset.cid, 10);
      if (openPickerId === cid) {
        openPickerId = null;
        pickerSearch = '';
      } else {
        openPickerId = cid;
        pickerSearch = '';
      }
      renderBoard({ animate: false });
      if (openPickerId) {
        const input = document.querySelector(`.emp-search[data-cid="${openPickerId}"]`);
        if (input) input.focus();
      }
    });
  });

  document.querySelectorAll('.emp-search').forEach((input) => {
    input.addEventListener('input', () => {
      pickerSearch = input.value;
      renderBoard({ animate: false });
      const el = document.querySelector(`.emp-search[data-cid="${openPickerId}"]`);
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  document.querySelectorAll('.emp-option:not(.disabled)').forEach((opt) => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const customerId = parseInt(opt.dataset.cid, 10);
      const employeeId = parseInt(opt.dataset.eid, 10);
      openPickerId = null;
      pickerSearch = '';
      await applyEmployeeChange(customerId, employeeId);
    });
  });
}

async function applyEmployeeChange(customerId, employeeId) {
  if (!employeeId) {
    const entry = assignmentMap.get(customerId);
    if (entry?.type === 'ok' && entry.manual) {
      assignmentMap.set(customerId, { type: 'fail', data: buildFailFromCompany(customerId, '已取消指派'), manual: true });
    }
    syncPreviewFromAssignment();
    renderBoard();
    updateStats();
    return;
  }

  if (getUsedEmployeeIds(customerId).includes(employeeId)) {
    showToast('该员工在此时段已被其他公司占用');
    renderBoard();
    return;
  }

  try {
    const res = await fetch('/api/dispatch/validate-pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        customerId,
        employeeId,
        existingPairings: getExistingPairings(customerId),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.eligible) {
      assignmentMap.set(customerId, {
        type: 'ok',
        data: {
          customerId: data.customerId,
          companyName: data.companyName,
          employeeId: data.employeeId,
          employeeName: data.employeeName,
          address: data.address,
          parkName: data.parkName,
          customerType: data.customerType,
          timeSlot: data.timeSlot,
          departureAddress: data.departureAddress,
          score: data.score,
          commuteMinutes: data.commuteMinutes,
          route: data.route,
          rules: data.rules,
          locked: true,
        },
        manual: true,
      });
      const commuteNote = data.commuteMinutes > maxCommuteMinutes ? `（通勤${data.commuteMinutes}分，超过${maxCommuteMinutes}分但仍可派单）` : `通勤 ${data.commuteMinutes} 分钟`;
      showToast(`${data.companyName} → ${data.employeeName} · ${commuteNote}`);
    } else {
      assignmentMap.set(customerId, {
        type: 'fail',
        data: {
          customerId,
          companyName: data.companyName,
          parkName: data.parkName,
          address: data.address,
          customerType: data.customerType,
          reason: `手动指派不合规（${data.failedRules.map((r) => r.rule).join('、')} 不满足）`,
          nearestAttempt: {
            employeeName: data.employeeName,
            departureAddress: data.departureAddress,
            failedRules: data.failedRules,
            route: data.route,
          },
        },
        manual: true,
      });
      showToast(`不合规：${data.failedRules.map((r) => r.rule).join('、')}`);
    }

    syncPreviewFromAssignment();
    renderBoard();
    renderSchedules();
    updateStats();
  } catch (err) {
    showToast(err.message);
    renderBoard();
  }
}

function buildFailFromCompany(customerId, reason) {
  const c = allCompanies.find((x) => x.id === customerId);
  return {
    customerId,
    companyName: c?.companyName || '',
    parkName: c?.parkName || '',
    address: c?.address || '',
    customerType: c?.customerType || '',
    reason,
  };
}

function syncPreviewFromAssignment() {
  previewPairings = [];
  previewUnmatched = [];
  for (const [, entry] of assignmentMap) {
    if (entry.type === 'ok') previewPairings.push(entry.data);
    else previewUnmatched.push(entry.data);
  }
}

function applyDispatchResult(data) {
  previewPairings = (data.pairings || []).filter((p) => p.eligible !== false);
  previewUnmatched = data.unmatchedCompanies || [];
  employeeSchedules = data.employeeSchedules || [];
  distanceSource = data.distanceSource || '';
  if (data.maxCommuteMinutes) maxCommuteMinutes = data.maxCommuteMinutes;
  syncAssignmentFromApi(previewPairings, previewUnmatched);
  syncPreviewFromAssignment();
}

function updateStats() {
  const selected = getSelectedIds().length;
  const matched = previewPairings.length;
  const failed = previewUnmatched.length;

  document.getElementById('stat-selected').textContent = selected;
  document.getElementById('stat-matched').textContent = matched;
  document.getElementById('stat-failed').textContent = failed;

  const commutes = previewPairings.map((p) => p.commuteMinutes).filter((m) => m > 0);
  document.getElementById('stat-commute').textContent =
    commutes.length ? Math.round(commutes.reduce((a, b) => a + b, 0) / commutes.length) : '—';

  const tag = document.getElementById('distance-tag');
  if (distanceSource) {
    const label = distanceSource === 'deepseek' ? 'DeepSeek' : distanceSource === 'mixed' ? 'AI+本地' : '本地估算';
    tag.textContent = `通勤来源: ${label}`;
  }

  dispatchBtn.disabled = selected === 0 || isMatching;
}

function toggleAllCompanies() {
  const boxes = document.querySelectorAll('#company-list input');
  const allOn = Array.from(boxes).every((cb) => cb.checked);
  boxes.forEach((cb) => {
    cb.checked = !allOn;
    const id = parseInt(cb.value, 10);
    if (cb.checked) selectedCompanies.add(id);
    else {
      selectedCompanies.delete(id);
      assignmentMap.delete(id);
    }
    cb.closest('.co-item').classList.toggle('checked', cb.checked);
  });
  updateStats();
  schedulePreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  if (!sessionId || getSelectedIds().length === 0) {
    previewPairings = [];
    previewUnmatched = [];
    employeeSchedules = [];
    assignmentMap.clear();
    isMatching = false;
    renderBoard();
    renderSchedules();
    updateStats();
    return;
  }

  const matchOnly = getMatchOnlyIds();
  if (matchOnly.length === 0 && getLockedPairings().length > 0) {
    syncPreviewFromAssignment();
    renderBoard();
    updateStats();
    return;
  }

  isMatching = true;
  renderBoard();
  updateStats();
  previewTimer = setTimeout(fetchPreview, 400);
}

async function fetchPreview() {
  if (!sessionId || getSelectedIds().length === 0) return;
  try {
    const data = await callSelectApi();
    applyDispatchResult(data);
    isMatching = false;
    renderBoard();
    renderSchedules();
    updateStats();
  } catch (err) {
    isMatching = false;
    showToast(err.message);
    renderBoard();
    updateStats();
  }
}

async function runDispatch() {
  if (!sessionId || getSelectedIds().length === 0) return;
  dispatchBtn.disabled = true;
  dispatchBtn.classList.add('loading');
  dispatchBtn.textContent = '匹配中...';
  isMatching = true;
  renderBoard();
  updateStats();

  try {
    const data = await callSelectApi({ fullMatch: false });
    applyDispatchResult(data);
    expandedRows.clear();
    expandedRules.clear();
    showToast(data.message);
    renderSchedules();
  } catch (err) {
    showToast(err.message);
  } finally {
    isMatching = false;
    dispatchBtn.classList.remove('loading');
    dispatchBtn.textContent = '重新 AI 匹配';
    renderBoard();
    updateStats();
  }
}

async function callSelectApi(opts = {}) {
  const selectedIds = getSelectedIds();
  const lockedPairings = opts.fullMatch ? [] : getLockedPairings();
  const matchOnlyCustomerIds = opts.fullMatch ? undefined : getMatchOnlyIds();

  const body = {
    sessionId,
    customerIds: selectedIds,
    lockedPairings: lockedPairings.length ? lockedPairings : undefined,
    matchOnlyCustomerIds: matchOnlyCustomerIds?.length ? matchOnlyCustomerIds : undefined,
  };

  const res = await fetch('/api/dispatch/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 350);
  }, 2800);
}
