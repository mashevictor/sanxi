let sessionId = null;
let allCompanies = [];
let allEmployees = [];
const manualSelectedCompanies = new Set();
const manualSelectedEmployees = new Set();
const assignmentMap = new Map();
let manualCoSearch = '';
let manualEmpSearch = '';
let manualTablesBound = false;
let isMatching = false;
let progressTimer = null;
let lastMatchPairings = [];
let lastMatchUnmatched = [];

const pageLoader = document.getElementById('page-loader');

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  document.getElementById('manual-match-btn').addEventListener('click', onManualMatch);
  document.getElementById('manual-clear-btn').addEventListener('click', clearManualSelection);
  document.getElementById('manual-emp-info-btn').addEventListener('click', () => {
    const ids = Array.from(manualSelectedEmployees);
    if (ids.length === 1) showEmployeeModal(ids[0], allEmployees);
    else if (ids.length > 1) showToast('请只勾选 1 名员工查看详情');
    else showToast('请先在表格中勾选员工');
  });
  document.getElementById('emp-modal-close').addEventListener('click', () => {
    document.getElementById('emp-modal').hidden = true;
  });
  document.getElementById('emp-modal').addEventListener('click', (e) => {
    if (e.target.id === 'emp-modal') document.getElementById('emp-modal').hidden = true;
  });
});

async function loadData() {
  try {
    const stored = loadDispatchState();
    const data = await bootstrapIntegratedData({
      onCacheReady: (cached) => {
        allCompanies = cached.companies || [];
        allEmployees = cached.employees || [];
        if (stored?.assignmentMap?.length) {
          const map = deserializeAssignmentMap(stored.assignmentMap);
          for (const [k, v] of map) assignmentMap.set(k, v);
          rebuildLastMatchFromAssignment();
        }
        renderManualTables();
        renderManualResults();
        updateManualStats();
        pageLoader.classList.add('hide');
      },
    });
    sessionId = data.sessionId;
    allCompanies = data.companies;
    allEmployees = data.employees;
    if (stored?.assignmentMap?.length) {
      const map = deserializeAssignmentMap(stored.assignmentMap);
      for (const [k, v] of map) assignmentMap.set(k, v);
      rebuildLastMatchFromAssignment();
    }
    renderManualTables();
    renderManualResults();
    updateManualStats();
    persistState();
  } catch (err) {
    showToast(err.message);
  } finally {
    pageLoader.classList.add('hide');
  }
}

function rebuildLastMatchFromAssignment() {
  lastMatchPairings = [];
  lastMatchUnmatched = [];
  for (const [cid, entry] of assignmentMap) {
    if (entry.type === 'ok') lastMatchPairings.push(entry.data);
    else if (entry.type === 'fail') lastMatchUnmatched.push(entry.data);
  }
}

function persistState() {
  saveDispatchState({
    sessionId,
    selectedCompanies: Array.from(manualSelectedCompanies),
    assignmentMap: serializeAssignmentMap(assignmentMap),
  });
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
    const hay = `${e.name} ${e.departureAddress || ''} ${tags} ${getEmpSlotLabels(e)}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderManualTables() {
  const coBody = document.getElementById('manual-co-tbody');
  const empBody = document.getElementById('manual-emp-tbody');
  if (!coBody || !empBody) return;

  const companies = filterManualCompanies();
  const employees = filterManualEmployees();

  coBody.innerHTML = companies.map((c) => {
    const on = manualSelectedCompanies.has(c.id);
    return `
      <tr class="${on ? 'selected' : ''}" data-cid="${c.id}">
        <td><input type="checkbox" class="manual-co-cb" value="${c.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(c.companyName)}</td>
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
        <td class="sub-cell">${renderEmpDepSlots(e)}</td>
        <td><button type="button" class="btn-emp-info manual-emp-info-row" data-eid="${e.id}">ⓘ</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" class="sub-cell" style="padding:12px;text-align:center">无匹配员工</td></tr>';

  document.getElementById('manual-co-count').textContent = `已选 ${manualSelectedCompanies.size}`;
  document.getElementById('manual-emp-count').textContent = `已选 ${manualSelectedEmployees.size}`;
  syncManualTableSelectAll('manual-co-all', companies, manualSelectedCompanies);
  syncManualTableSelectAll('manual-emp-all', employees, manualSelectedEmployees);
  bindManualTableEvents();
  updateManualStats();
  updateMatchButton();
}

function updateMatchButton() {
  const btn = document.getElementById('manual-match-btn');
  if (!btn) return;
  btn.disabled = isMatching || manualSelectedCompanies.size === 0;
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
    renderManualTables();
  });
  document.getElementById('manual-emp-tbody')?.addEventListener('change', (e) => {
    const cb = e.target.closest('.manual-emp-cb');
    if (!cb) return;
    const id = parseInt(cb.value, 10);
    if (cb.checked) manualSelectedEmployees.add(id);
    else manualSelectedEmployees.delete(id);
    renderManualTables();
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
      showEmployeeModal(parseInt(infoBtn.dataset.eid, 10), allEmployees);
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

function showMatchProgress(total) {
  const box = document.getElementById('manual-progress');
  const fill = document.getElementById('manual-progress-fill');
  const text = document.getElementById('manual-progress-text');
  if (!box || !fill || !text) return;
  clearInterval(progressTimer);
  box.hidden = false;
  fill.style.width = '4%';
  text.textContent = `正在智能匹配 ${total} 家公司…`;
  let pct = 4;
  progressTimer = setInterval(() => {
    pct = Math.min(pct + Math.random() * 6 + 2, 92);
    fill.style.width = `${pct}%`;
  }, 220);
}

function completeMatchProgress(matched, total) {
  clearInterval(progressTimer);
  progressTimer = null;
  const fill = document.getElementById('manual-progress-fill');
  const text = document.getElementById('manual-progress-text');
  if (fill) fill.style.width = '100%';
  if (text) text.textContent = `匹配完成：${matched}/${total}`;
}

function hideMatchProgress(delay = 600) {
  setTimeout(() => {
    const box = document.getElementById('manual-progress');
    if (box) box.hidden = true;
    const fill = document.getElementById('manual-progress-fill');
    if (fill) fill.style.width = '0';
  }, delay);
}

function applyMatchResult(data) {
  lastMatchPairings = data.pairings || [];
  lastMatchUnmatched = data.unmatchedCompanies || [];
  assignmentMap.clear();

  for (const p of lastMatchPairings) {
    assignmentMap.set(p.customerId, { type: 'ok', data: p, manual: false });
  }
  for (const u of lastMatchUnmatched) {
    assignmentMap.set(u.customerId, { type: 'fail', data: u, manual: false });
  }
}

function renderManualResults() {
  const box = document.getElementById('manual-result');
  const summary = document.getElementById('manual-result-summary');
  if (!box) return;

  const ok = lastMatchPairings.length;
  const fail = lastMatchUnmatched.length;
  if (summary) {
    summary.textContent = ok + fail > 0 ? `${ok} 成功 · ${fail} 失败` : '';
  }

  if (!ok && !fail) {
    box.innerHTML = '<div class="empty" style="padding:24px">匹配结果将显示在这里</div>';
    return;
  }

  const okRows = lastMatchPairings.map((p, i) => `
    <div class="manual-result-row ok" style="animation-delay:${i * 0.03}s">
      <div>
        <div class="co-line">${esc(p.companyName)}</div>
        <div class="sub-line">${esc(p.customerType)} · ${esc(p.timeSlot)} · ${esc(p.parkName)}</div>
      </div>
      <div class="arrow">→</div>
      <div>
        <div class="emp-line">${esc(p.employeeName)}</div>
        <div class="sub-line">${esc(p.departureAddress || '')}</div>
      </div>
      <div class="commute">${p.commuteMinutes ? `${p.commuteMinutes} 分` : '—'}</div>
    </div>
  `).join('');

  const failRows = lastMatchUnmatched.map((u, i) => {
    const reason = extractFailReason({ type: 'fail', data: u });
    return `
      <div class="manual-result-row fail" style="animation-delay:${(ok + i) * 0.03}s">
        <div>
          <div class="co-line">${esc(u.companyName)}</div>
          <div class="sub-line">${esc(u.customerType || '')} · ${esc(u.parkName || '')}</div>
        </div>
        <div class="arrow">✕</div>
        <div class="fail-tag" style="grid-column:3/5">${esc(reason)}</div>
      </div>
    `;
  }).join('');

  box.innerHTML = (failRows ? `<div style="margin-bottom:10px;font-size:0.72rem;color:#fca5a5;font-weight:600">匹配失败 / 待处理</div>${failRows}` : '')
    + (okRows ? `<div style="margin:${failRows ? '14px' : '0'} 0 10px;font-size:0.72rem;color:#6ee7b7;font-weight:600">匹配成功</div>${okRows}` : '');
}

function scrollToManualResults() {
  const section = document.getElementById('manual-result-section');
  if (!section) return;
  requestAnimationFrame(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function onManualMatch() {
  if (!sessionId) {
    showToast('数据未加载，请刷新页面');
    return;
  }
  const customerIds = Array.from(manualSelectedCompanies).sort((a, b) => a - b);
  if (!customerIds.length) {
    showToast('请先在表格中勾选公司');
    return;
  }

  const employeePoolIds = Array.from(manualSelectedEmployees);
  const btn = document.getElementById('manual-match-btn');
  isMatching = true;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = '匹配中...';
  showMatchProgress(customerIds.length);

  const body = { sessionId, customerIds };
  if (employeePoolIds.length) body.employeePoolIds = employeePoolIds;

  try {
    const res = await fetch('/api/dispatch/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '匹配失败');

    applyMatchResult(data);
    completeMatchProgress(data.stats?.matched ?? lastMatchPairings.length, customerIds.length);
    renderManualResults();
    updateManualStats();
    persistState();
    scrollToManualResults();
    showToast(data.message || '匹配完成');
  } catch (err) {
    showToast(err.message);
    hideMatchProgress(0);
  } finally {
    isMatching = false;
    btn.classList.remove('loading');
    btn.textContent = '确认匹配';
    updateMatchButton();
    hideMatchProgress();
  }
}

function updateManualStats() {
  document.getElementById('stat-co-picked').textContent = manualSelectedCompanies.size;
  document.getElementById('stat-emp-picked').textContent = manualSelectedEmployees.size;
  document.getElementById('stat-manual-ok').textContent = lastMatchPairings.length;
  document.getElementById('stat-manual-fail').textContent = lastMatchUnmatched.length;
}
