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
const manualSelectedCompanies = new Set();
const manualSelectedEmployees = new Set();
let manualCoSearch = '';
let manualEmpSearch = '';
let manualTablesBound = false;
let activeView = 'results';

let showcaseCustomerIds = [];
let fullMatchCustomerIds = [];
let showcaseMatchCache = null;
let fullMatchCache = null;

const SHOWCASE_CACHE_URL = '/cache/showcase-match.json';
const FULL_MATCH_CACHE_URL = '/cache/full-match.json';

const dispatchBtn = document.getElementById('dispatch-btn');
const pageLoader = document.getElementById('page-loader');

dispatchBtn.addEventListener('click', runDispatch);
document.getElementById('sel-all-co').addEventListener('click', toggleAllCompanies);
document.getElementById('showcase-btn').addEventListener('click', loadShowcaseAndMatch);
document.getElementById('full-match-btn').addEventListener('click', loadFullMatchAndMatch);

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

document.addEventListener('DOMContentLoaded', () => {
  loadIntegratedData();
  preloadShowcaseCache();
  preloadFullMatchCache();
  document.getElementById('dispatch-board').addEventListener('click', handleBoardClick);
  document.getElementById('manual-assign-btn').addEventListener('click', onManualAssign);
  document.getElementById('manual-clear-btn').addEventListener('click', clearManualSelection);
  document.getElementById('manual-emp-info-btn').addEventListener('click', () => {
    const ids = Array.from(manualSelectedEmployees);
    if (ids.length === 1) showEmployeeModal(ids[0]);
    else if (ids.length > 1) showToast('已选多名员工，请只勾选 1 人查看详情');
    else showToast('请先在表格中勾选员工');
  });
  document.getElementById('emp-modal-close').addEventListener('click', () => {
    document.getElementById('emp-modal').hidden = true;
  });
  document.getElementById('emp-modal').addEventListener('click', (e) => {
    if (e.target.id === 'emp-modal') document.getElementById('emp-modal').hidden = true;
  });
  window.addEventListener('resize', positionOpenPicker);
  document.getElementById('dispatch-board').closest('.scroll')?.addEventListener('scroll', positionOpenPicker);
  document.addEventListener('click', (e) => {
    if (openPickerId !== null && !e.target.closest('.emp-picker')) {
      openPickerId = null;
      pickerSearch = '';
      renderBoard({ animate: false });
    }
  });
});

function handleBoardClick(e) {
  const infoBtn = e.target.closest('.btn-emp-info');
  if (infoBtn) {
    e.stopPropagation();
    const eid = parseInt(infoBtn.dataset.eid, 10);
    if (eid) showEmployeeModal(eid);
    return;
  }
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
    renderManualTables();
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

async function preloadFullMatchCache() {
  try {
    await fetchFullMatchCache();
  } catch {
    /* 缓存可选 */
  }
}

async function fetchFullMatchCache() {
  if (fullMatchCache) return fullMatchCache;
  const res = await fetch(FULL_MATCH_CACHE_URL);
  if (!res.ok) throw new Error('全量匹配缓存未找到，请运行 npm run cache:showcase');
  fullMatchCache = await res.json();
  return fullMatchCache;
}

async function loadFullMatchAndMatch() {
  if (!sessionId) {
    await loadIntegratedData();
  }

  try {
    const cache = await fetchFullMatchCache();
    const remapped = remapCacheResult(cache, { preferDemo: false });
    const ids = resolveFullMatchSelectIds(remapped);

    if (!ids.length) {
      showToast('未找到公司数据');
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
      message: (remapped.message || '全量匹配完成') + '（缓存）',
      distanceSource: remapped.distanceSource || 'local',
      maxCommuteMinutes: remapped.maxCommuteMinutes || 60,
    });
    renderBoard({ animate: true });
    renderSchedules();
    updateStats();
    showToast((remapped.message || '全量匹配完成') + '（缓存）');
  } catch (err) {
    showToast(err.message);
  }
}

function resolveFullMatchSelectIds(cache) {
  if (fullMatchCustomerIds.length) return fullMatchCustomerIds;
  if (cache?.fullMatchCustomerIds?.length) return cache.fullMatchCustomerIds;
  if (allCompanies.length) return allCompanies.map((c) => c.id);
  return [];
}

async function loadShowcaseAndMatch() {
  if (!sessionId) {
    await loadIntegratedData();
  }

  try {
    const cache = await fetchShowcaseCache();
    const remapped = remapCacheResult(cache, { preferDemo: true });
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

function remapCacheResult(cache, options = {}) {
  const preferDemo = options.preferDemo ?? false;
  const companyByName = new Map(allCompanies.map((c) => [c.companyName, c]));
  const pairings = (cache.pairings || []).map((p) => {
    const company = companyByName.get(p.companyName);
    const emp = findEmployeeInSession(p.employeeName, p.departureAddress, preferDemo);
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
    const emp = findEmployeeInSession(s.employeeName, s.departureAddress, preferDemo);
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
  fullMatchCustomerIds = data.fullMatchCustomerIds || [];
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

function countManualAssignments() {
  let n = 0;
  for (const [, entry] of assignmentMap) {
    if (entry.manual && (entry.type === 'ok' || entry.type === 'fail')) n++;
  }
  return n;
}

function updateManualHint() {
  const hint = document.getElementById('manual-hint');
  const el = document.getElementById('manual-hint-text');
  if (!el || !hint) return;
  if (getSelectedIds().length === 0 || isMatching) {
    hint.hidden = true;
    return;
  }
  hint.hidden = false;
  const manual = countManualAssignments();
  const base = '在上方<strong>表格</strong>多选公司与员工后点「确认指派」（1 名员工可派多家，或等数量一一配对），也可点击每行员工下拉改派；合规指派将<strong>锁定</strong>。';
  if (manual > 0) {
    el.innerHTML = `${base} <span class="manual-count">（已手动调整 ${manual} 条）</span>`;
  } else {
    el.innerHTML = base;
  }
}

function getMatchOnlyIds() {
  const lockedIds = new Set(getLockedPairings().map((p) => p.customerId));
  return getSelectedIds().filter((id) => !lockedIds.has(id));
}

function syncAssignmentFromApi(pairings, unmatched) {
  for (const id of [...assignmentMap.keys()]) {
    if (!selectedCompanies.has(Number(id))) assignmentMap.delete(id);
  }

  for (const p of pairings) {
    const existing = assignmentMap.get(p.customerId);
    if (existing?.type === 'ok' && existing.manual) {
      continue;
    }
    assignmentMap.set(p.customerId, {
      type: 'ok',
      data: p,
      manual: false,
    });
  }

  for (const u of unmatched) {
    const existing = assignmentMap.get(u.customerId);
    if (existing?.type === 'ok' && existing.manual) continue;
    assignmentMap.set(u.customerId, { type: 'fail', data: u, manual: false });
  }

  for (const id of selectedCompanies) {
    if (!assignmentMap.has(Number(id))) {
      assignmentMap.set(Number(id), {
        type: 'fail',
        data: buildFailFromCompany(Number(id), 'AI 未匹配，请手动选择员工或点击下方「确认指派」'),
        manual: false,
      });
    }
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
    if (!isOpen) return false;
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    const tags = (e.tags || e.roles || []).join(' ');
    const hay = `${e.name} ${e.departureAddress || ''} ${tags}`.toLowerCase();
    return hay.includes(q);
  });

  const clearOption = currentEmployeeId
    ? `<div class="emp-option clear-option" data-cid="${customerId}" data-eid="0" data-clear="1">
         <div class="emp-option-top"><span class="emp-option-name">✕ 清除指派</span></div>
         <div class="emp-option-dep">清除后可重新选择员工或让 AI 再次匹配</div>
       </div>`
    : '';

  const items = filtered.map((e) => {
    const taken = used.includes(e.id) && e.id !== currentEmployeeId;
    const tags = e.tags || [...(e.roles || []), ...(e.capacityLabels || [])];
    const showcaseTag = e.sourceTag ? `<span class="source-tag">${esc(e.sourceTag)}</span>` : '';
    return `
      <div class="emp-option ${taken ? 'disabled' : ''} ${e.id === currentEmployeeId ? 'selected' : ''}"
           data-cid="${customerId}" data-eid="${e.id}" data-taken="${taken ? '1' : '0'}">
        <div class="emp-option-top">
          <span class="emp-option-name">${esc(e.name)} ${showcaseTag}</span>
          <button type="button" class="btn-emp-info" data-eid="${e.id}" title="查看员工信息">ⓘ</button>
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
        <div class="emp-picker-list">${clearOption}${items || (isOpen ? (allEmployees.length ? '<div style="padding:12px;color:var(--muted);font-size:0.8rem">无匹配员工</div>' : '<div style="padding:12px;color:var(--muted);font-size:0.8rem">员工数据未加载</div>') : '')}</div>
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

  if (entry.type === 'pending') {
    const p = entry.data;
    const animStyle = animate ? `style="animation-delay:${animIndex * 0.06}s"` : '';
    return `
      <div class="dispatch-row row-pending${animate ? ' row-enter' : ''}" data-cid="${customerId}" ${animStyle}>
        <div class="row-grid">
          <div class="status-dot" style="background:#64748b"></div>
          <div class="cell-company">
            <div class="name" title="${esc(p.companyName)}">${esc(p.companyName)}</div>
            <div class="sub">${esc(p.customerType)} · ${esc(p.parkName)} · ${esc(p.timeSlot)}</div>
          </div>
          <div class="cell-arrow">→</div>
          <div class="cell-employee">
            ${renderEmployeePicker(customerId, null, isMatching)}
            <span class="manual-tag hint-tag">可手动指派</span>
          </div>
          <div class="cell-commute"><span class="commute-none">—</span></div>
          <div class="cell-action">
            <button class="btn-ghost btn-detail ${expanded ? 'open' : ''}" data-cid="${customerId}">提示</button>
          </div>
        </div>
        <div class="row-expand" ${expanded ? '' : 'hidden'}>
          <div style="color:var(--muted);font-size:0.78rem">等待 AI 匹配中，或点击上方<strong>员工下拉框</strong>直接手动指派。</div>
        </div>
      </div>
    `;
  }

  if (entry.type === 'ok') {
    const p = entry.data;
    const rowCls = ['dispatch-row', 'row-ok', animate ? 'row-enter' : '', entry.manual ? 'row-manual' : ''].filter(Boolean).join(' ');
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
            ${entry.manual ? '<span class="manual-tag">手动调整</span>' : '<span class="manual-tag hint-tag">点击可改派</span>'}
            ${entry.manual ? '<span class="manual-tag" style="background:rgba(99,102,241,.2);color:#c4b5fd">已锁定</span>' : ''}
          </div>
          ${renderCommuteCell(p.commuteMinutes, p.route)}
          <div class="cell-action">
            <button type="button" class="btn-emp-info" data-eid="${p.employeeId}" title="查看员工信息">员工</button>
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
          ${entry.manual
            ? '<span class="manual-tag">手动不合规</span>'
            : '<span class="manual-tag hint-tag">可手动改派</span>'}
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
      const animIndex = okRows.length + failRows.length;
      const pending = renderDispatchRow(id, buildPendingEntry(id), animIndex, animate);
      failRows.push(pending);
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
          <span>✗ 匹配失败 / 待指派</span>
          <span class="section-count">${failRows.length} 家</span>
        </div>
        <div class="section-body">${failRows.join('')}</div>
      </div>
    `;
  }

  board.innerHTML = html || '<div class="empty">暂无结果</div>';
  bindBoardEvents();
  renderManualTables();
  updateManualHint();
}

function filterManualCompanies() {
  const q = manualCoSearch.toLowerCase();
  if (!q) return allCompanies;
  return allCompanies.filter((c) => {
    const hay = `${c.companyName} ${c.customerType} ${c.timeSlot} ${c.parkName}`.toLowerCase();
    return hay.includes(q);
  });
}

function filterManualEmployees() {
  const q = manualEmpSearch.toLowerCase();
  if (!q) return allEmployees;
  return allEmployees.filter((e) => {
    const tags = (e.tags || e.roles || []).join(' ');
    const hay = `${e.name} ${e.departureAddress || ''} ${tags}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderManualTables() {
  const coBody = document.getElementById('manual-co-tbody');
  const empBody = document.getElementById('manual-emp-tbody');
  const coCount = document.getElementById('manual-co-count');
  const empCount = document.getElementById('manual-emp-count');
  if (!coBody || !empBody) return;

  const companies = filterManualCompanies();
  const employees = filterManualEmployees();

  coBody.innerHTML = companies.map((c) => {
    const on = manualSelectedCompanies.has(c.id);
    const mark = selectedCompanies.has(c.id) ? '<span class="source-tag" style="font-size:0.58rem">已勾选</span>' : '';
    return `
      <tr class="${on ? 'selected' : ''}" data-cid="${c.id}">
        <td><input type="checkbox" class="manual-co-cb" value="${c.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(c.companyName)} ${mark}</td>
        <td class="sub-cell">${esc(c.customerType)}</td>
        <td class="sub-cell">${esc(c.timeSlot)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" class="sub-cell" style="padding:12px;text-align:center">无匹配公司</td></tr>';

  empBody.innerHTML = employees.map((e) => {
    const on = manualSelectedEmployees.has(e.id);
    const roles = (e.tags || e.roles || []).slice(0, 2).join(' · ');
    const tag = e.sourceTag ? `<span class="source-tag" style="font-size:0.58rem">${esc(e.sourceTag)}</span>` : '';
    return `
      <tr class="${on ? 'selected' : ''}" data-eid="${e.id}">
        <td><input type="checkbox" class="manual-emp-cb" value="${e.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(e.name)} ${tag}</td>
        <td class="sub-cell">${esc(roles)}</td>
        <td class="sub-cell">${esc((e.departureAddress || '').slice(0, 18))}</td>
        <td><button type="button" class="btn-emp-info manual-emp-info-row" data-eid="${e.id}">ⓘ</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" class="sub-cell" style="padding:12px;text-align:center">无匹配员工</td></tr>';

  if (coCount) coCount.textContent = `已选 ${manualSelectedCompanies.size}`;
  if (empCount) empCount.textContent = `已选 ${manualSelectedEmployees.size}`;

  syncManualTableSelectAll('manual-co-all', companies, manualSelectedCompanies);
  syncManualTableSelectAll('manual-emp-all', employees, manualSelectedEmployees);
  bindManualTableEvents();
}

function syncManualTableSelectAll(allId, visibleItems, selectedSet) {
  const allCb = document.getElementById(allId);
  if (!allCb) return;
  const visibleIds = visibleItems.map((x) => x.id);
  const selectedVisible = visibleIds.filter((id) => selectedSet.has(id)).length;
  allCb.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  allCb.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
}

function bindManualTableEvents() {
  if (manualTablesBound) return;
  manualTablesBound = true;

  document.getElementById('manual-co-search')?.addEventListener('input', (e) => {
    manualCoSearch = e.target.value;
    renderManualTables();
  });
  document.getElementById('manual-emp-search')?.addEventListener('input', (e) => {
    manualEmpSearch = e.target.value;
    renderManualTables();
  });

  document.getElementById('manual-co-all')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    filterManualCompanies().forEach((c) => {
      if (on) manualSelectedCompanies.add(c.id);
      else manualSelectedCompanies.delete(c.id);
    });
    renderManualTables();
  });
  document.getElementById('manual-emp-all')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    filterManualEmployees().forEach((emp) => {
      if (on) manualSelectedEmployees.add(emp.id);
      else manualSelectedEmployees.delete(emp.id);
    });
    renderManualTables();
  });

  document.getElementById('manual-co-tbody')?.addEventListener('change', (e) => {
    const cb = e.target.closest('.manual-co-cb');
    if (!cb) return;
    const id = parseInt(cb.value, 10);
    if (cb.checked) manualSelectedCompanies.add(id);
    else manualSelectedCompanies.delete(id);
    cb.closest('tr')?.classList.toggle('selected', cb.checked);
    document.getElementById('manual-co-count').textContent = `已选 ${manualSelectedCompanies.size}`;
    syncManualTableSelectAll('manual-co-all', filterManualCompanies(), manualSelectedCompanies);
  });

  document.getElementById('manual-emp-tbody')?.addEventListener('change', (e) => {
    const cb = e.target.closest('.manual-emp-cb');
    if (!cb) return;
    const id = parseInt(cb.value, 10);
    if (cb.checked) manualSelectedEmployees.add(id);
    else manualSelectedEmployees.delete(id);
    cb.closest('tr')?.classList.toggle('selected', cb.checked);
    document.getElementById('manual-emp-count').textContent = `已选 ${manualSelectedEmployees.size}`;
    syncManualTableSelectAll('manual-emp-all', filterManualEmployees(), manualSelectedEmployees);
  });

  document.getElementById('manual-co-tbody')?.addEventListener('click', (e) => {
    if (e.target.closest('input, button')) return;
    const row = e.target.closest('tr[data-cid]');
    if (!row) return;
    const cb = row.querySelector('.manual-co-cb');
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  document.getElementById('manual-emp-tbody')?.addEventListener('click', (e) => {
    const infoBtn = e.target.closest('.manual-emp-info-row');
    if (infoBtn) {
      e.stopPropagation();
      showEmployeeModal(parseInt(infoBtn.dataset.eid, 10));
      return;
    }
    if (e.target.closest('input, button')) return;
    const row = e.target.closest('tr[data-eid]');
    if (!row) return;
    const cb = row.querySelector('.manual-emp-cb');
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

function clearManualSelection() {
  manualSelectedCompanies.clear();
  manualSelectedEmployees.clear();
  renderManualTables();
  showToast('已清空表格选择');
}

function ensureCompaniesInSelection(companyIds) {
  for (const id of companyIds) {
    if (!selectedCompanies.has(id)) {
      selectedCompanies.add(id);
      const cb = document.querySelector(`#company-list input[value="${id}"]`);
      if (cb) {
        cb.checked = true;
        cb.closest('.co-item')?.classList.add('checked');
      }
    }
  }
  if (companyIds.some((id) => !document.querySelector(`#company-list input[value="${id}"]`))) {
    renderCompanies();
  }
  updateStats();
}

function buildManualAssignPairs() {
  const coIds = Array.from(manualSelectedCompanies).sort((a, b) => a - b);
  const empIds = Array.from(manualSelectedEmployees).sort((a, b) => a - b);
  if (!coIds.length || !empIds.length) return null;

  if (empIds.length === 1) {
    return coIds.map((cid) => ({ customerId: cid, employeeId: empIds[0] }));
  }
  if (coIds.length === empIds.length) {
    return coIds.map((cid, i) => ({ customerId: cid, employeeId: empIds[i] }));
  }
  if (coIds.length === 1 && empIds.length > 1) {
    return null;
  }
  return null;
}

async function onManualAssign() {
  const pairs = buildManualAssignPairs();
  const coN = manualSelectedCompanies.size;
  const empN = manualSelectedEmployees.size;

  if (!coN) {
    showToast('请先在表格中勾选公司');
    return;
  }
  if (!empN) {
    showToast('请先在表格中勾选员工');
    return;
  }
  if (!pairs) {
    showToast('请选 1 名员工派给多家公司，或等数量的公司与员工一一配对');
    return;
  }

  ensureCompaniesInSelection(pairs.map((p) => p.customerId));
  openPickerId = null;
  pickerSearch = '';

  let ok = 0;
  let fail = 0;
  for (const { customerId, employeeId } of pairs) {
    const before = assignmentMap.get(customerId);
    await applyEmployeeChange(customerId, employeeId, { silent: true });
    const after = assignmentMap.get(customerId);
    if (after?.type === 'ok' && after.manual) ok++;
    else fail++;
    void before;
  }

  renderBoard({ animate: false });
  renderSchedules();
  updateStats();

  if (fail === 0) {
    showToast(`✓ 手动指派完成：${ok} 条全部合规`);
  } else if (ok === 0) {
    showToast(`✗ ${fail} 条均不合规，请查看失败原因`);
  } else {
    showToast(`手动指派：${ok} 条成功，${fail} 条不合规`);
  }
}

function showEmployeeModal(employeeId) {
  const emp = allEmployees.find((e) => e.id === employeeId);
  if (!emp) {
    showToast('未找到该员工');
    return;
  }
  const modal = document.getElementById('emp-modal');
  const title = document.getElementById('emp-modal-title');
  const body = document.getElementById('emp-modal-body');
  if (!modal || !title || !body) return;

  const roles = (emp.roles || emp.tags || []).join('、') || '—';
  const capacity = (emp.capacityLabels || emp.orderCapacity || []).join('、') || '—';
  const tags = (emp.tags || []).join('、');

  title.textContent = emp.name;
  body.innerHTML = `
    <div class="info-row"><span class="k">姓名</span><span class="v">${esc(emp.name)}</span></div>
    <div class="info-row"><span class="k">出发地</span><span class="v">${esc(emp.departureAddress || '未填写')}</span></div>
    <div class="info-row"><span class="k">职责</span><span class="v">${esc(roles)}</span></div>
    <div class="info-row"><span class="k">接单时段</span><span class="v">${esc(capacity)}</span></div>
    ${tags ? `<div class="info-row"><span class="k">标签</span><span class="v">${esc(tags)}</span></div>` : ''}
    ${emp.sourceTag ? `<div class="info-row"><span class="k">来源</span><span class="v">${esc(emp.sourceTag)}</span></div>` : ''}
    ${emp.remark ? `<div class="info-row"><span class="k">备注</span><span class="v">${esc(emp.remark)}</span></div>` : ''}
  `;
  modal.hidden = false;
}

function positionOpenPicker() {
  if (openPickerId === null) return;
  const picker = document.querySelector(`.emp-picker[data-cid="${openPickerId}"]`);
  const panel = document.querySelector(`.emp-picker-panel[data-cid="${openPickerId}"]`);
  if (!picker || !panel || panel.hidden) return;

  const rect = picker.getBoundingClientRect();
  const gap = 4;
  const panelMax = 320;
  const spaceBelow = window.innerHeight - rect.bottom - gap - 12;
  const spaceAbove = rect.top - gap - 12;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;

  panel.style.width = `${Math.max(rect.width, 220)}px`;
  panel.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - Math.max(rect.width, 220) - 8)}px`;

  if (openUp) {
    const h = Math.min(panelMax, spaceAbove);
    panel.style.top = `${rect.top - gap - h}px`;
    panel.style.maxHeight = `${h}px`;
  } else {
    panel.style.top = `${rect.bottom + gap}px`;
    panel.style.maxHeight = `${Math.min(panelMax, spaceBelow)}px`;
  }
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
        requestAnimationFrame(() => {
          positionOpenPicker();
          const input = document.querySelector(`.emp-search[data-cid="${openPickerId}"]`);
          if (input) input.focus();
        });
      }
    });
  });

  document.querySelectorAll('.emp-search').forEach((input) => {
    input.addEventListener('input', () => {
      pickerSearch = input.value;
      renderBoard({ animate: false });
      requestAnimationFrame(() => {
        positionOpenPicker();
        const el = document.querySelector(`.emp-search[data-cid="${openPickerId}"]`);
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  document.querySelectorAll('.emp-option .btn-emp-info').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEmployeeModal(parseInt(btn.dataset.eid, 10));
    });
  });

  document.querySelectorAll('.emp-option:not(.disabled)').forEach((opt) => {
    opt.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-emp-info')) return;
      e.stopPropagation();
      const customerId = parseInt(opt.dataset.cid, 10);
      openPickerId = null;
      pickerSearch = '';
      if (opt.dataset.clear === '1') {
        await clearEmployeeAssignment(customerId);
        return;
      }
      const employeeId = parseInt(opt.dataset.eid, 10);
      await applyEmployeeChange(customerId, employeeId);
    });
  });
}

async function clearEmployeeAssignment(customerId) {
  assignmentMap.set(customerId, {
    type: 'fail',
    data: buildFailFromCompany(customerId, '已清除指派，可手动选择员工或点击「重新 AI 匹配」'),
    manual: false,
  });
  syncPreviewFromAssignment();
  renderBoard({ animate: false });
  renderSchedules();
  updateStats();
  showToast('已清除指派，可重新选择员工');
}

async function applyEmployeeChange(customerId, employeeId, options = {}) {
  const silent = options.silent === true;
  if (getUsedEmployeeIds(customerId).includes(employeeId)) {
    if (!silent) {
      showToast('该员工在此时段已被其他公司占用');
      renderBoard();
    }
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
      const commuteNote = data.commuteMinutes > maxCommuteMinutes
        ? `（通勤${data.commuteMinutes}分，超过${maxCommuteMinutes}分但仍可派单）`
        : `通勤 ${data.commuteMinutes} 分钟`;
      if (!silent) showToast(`✓ 手动改派成功：${data.companyName} → ${data.employeeName} · ${commuteNote} · 已锁定`);
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
      const detail = data.failedRules.map((r) => `${r.rule}: ${r.message}`).join('；');
      if (!silent) showToast(`✗ 不合规，请换其他员工：${data.failedRules.map((r) => r.rule).join('、')}（${detail}）`);
    }

    syncPreviewFromAssignment();
    if (!silent) {
      renderBoard();
      renderSchedules();
      updateStats();
    }
  } catch (err) {
    if (!silent) showToast(err.message);
    if (!silent) renderBoard();
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

function buildPendingEntry(customerId) {
  const c = allCompanies.find((x) => x.id === customerId);
  return {
    type: 'pending',
    data: {
      customerId,
      companyName: c?.companyName || '',
      parkName: c?.parkName || '',
      customerType: c?.customerType || '',
      timeSlot: c?.timeSlot || '',
    },
    manual: false,
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
  const duration = msg.length > 40 ? 4500 : 2800;
  showToast._timer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 350);
  }, duration);
}
