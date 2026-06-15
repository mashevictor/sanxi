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
let renderTablesPending = false;

document.addEventListener('DOMContentLoaded', () => {
  showPageLoader('加载公司与员工列表…');
  prefetchSampleData().then((cached) => {
    if (cached?.companies?.length) {
      allCompanies = cached.companies;
      allEmployees = cached.employees || [];
      scheduleRender(() => {
        renderManualTables();
        hidePageLoader();
      });
    }
  });
  loadData();
  document.getElementById('manual-history-btn').addEventListener('click', openManualMatchHistory);
  document.getElementById('manual-match-btn').addEventListener('click', onManualMatch);
  document.getElementById('goto-full-match-btn').addEventListener('click', () => {
    sessionStorage.setItem('dispatch-auto-full-match', '1');
    window.location.href = 'match.html';
  });
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
    const stored = loadDispatchState('manual');
    const data = await bootstrapIntegratedData({
      onCacheReady: (cached) => {
        allCompanies = cached.companies || [];
        allEmployees = cached.employees || [];
        if (stored?.selectedCompanies?.length) {
          stored.selectedCompanies.forEach((id) => manualSelectedCompanies.add(Number(id)));
        }
        if (stored?.selectedEmployees?.length) {
          stored.selectedEmployees.forEach((id) => manualSelectedEmployees.add(Number(id)));
        }
        if (stored?.assignmentMap?.length) {
          const map = deserializeAssignmentMap(stored.assignmentMap);
          for (const [k, v] of map) assignmentMap.set(k, v);
          rebuildLastMatchFromAssignment();
        }
        scheduleRender(() => {
          renderManualTables();
          renderManualResults();
          updateManualStats();
          hidePageLoader();
        });
      },
    });
    sessionId = data.sessionId;
    allCompanies = data.companies;
    allEmployees = data.employees;
    if (stored?.selectedCompanies?.length) {
      stored.selectedCompanies.forEach((id) => manualSelectedCompanies.add(Number(id)));
    }
    if (stored?.selectedEmployees?.length) {
      stored.selectedEmployees.forEach((id) => manualSelectedEmployees.add(Number(id)));
    }
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
    hidePageLoader();
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
  saveDispatchState('manual', {
    sessionId,
    selectedCompanies: Array.from(manualSelectedCompanies),
    selectedEmployees: Array.from(manualSelectedEmployees),
    assignmentMap: serializeAssignmentMap(assignmentMap),
  });
}

function saveManualMatchHistory(data, customerIds, employeePoolIds) {
  const entry = buildMatchHistoryEntry(data, {
    mode: 'manual',
    label: employeePoolIds.length
      ? `手动匹配（${customerIds.length} 家 · 员工池 ${employeePoolIds.length} 人）`
      : `手动匹配（${customerIds.length} 家）`,
    selectedCompanies: customerIds,
    selectedEmployees: employeePoolIds,
  });
  appendMatchHistory('manual', entry);
}

function restoreManualHistoryEntry(entry) {
  if (!entry) return;
  manualSelectedCompanies.clear();
  manualSelectedEmployees.clear();
  (entry.selectedCompanies || []).forEach((id) => manualSelectedCompanies.add(Number(id)));
  (entry.selectedEmployees || []).forEach((id) => manualSelectedEmployees.add(Number(id)));
  applyMatchResult({
    pairings: entry.pairings,
    unmatchedCompanies: entry.unmatchedCompanies,
    employeeSchedules: entry.employeeSchedules,
    message: entry.message,
    stats: entry.stats,
    distanceSource: entry.distanceSource,
    maxCommuteMinutes: entry.maxCommuteMinutes,
  });
  renderManualTables();
  renderManualResults();
  updateManualStats();
  showMatchSuccessBanner({
    message: entry.message,
    stats: entry.stats,
  }, entry.selectedCompanies || []);
  scrollToManualResults();
  persistState();
  showToast(`已恢复：${entry.label || entry.title}`);
}

function openManualMatchHistory() {
  openMatchHistoryModal('manual', { onRestore: restoreManualHistoryEntry });
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
  if (renderTablesPending) return;
  renderTablesPending = true;
  scheduleRender(() => {
    renderTablesPending = false;
    renderManualTablesNow();
  });
}

function renderManualTablesNow() {
  const coBody = document.getElementById('manual-co-tbody');
  const empBody = document.getElementById('manual-emp-tbody');
  if (!coBody || !empBody) return;

  const companies = filterManualCompanies();
  const employees = filterManualEmployees();

  coBody.innerHTML = companies.map((c) => {
    const on = manualSelectedCompanies.has(c.id);
    const tag = c.sourceTag ? `<span class="source-tag" style="font-size:0.58rem;margin-left:4px">${esc(c.sourceTag)}</span>` : '';
    return `
      <tr class="${on ? 'selected' : ''}" data-cid="${c.id}">
        <td><input type="checkbox" class="manual-co-cb" value="${c.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(c.companyName)}${tag}</td>
        <td class="park-cell">${esc(c.parkName || '—')}</td>
        <td class="sub-cell">${esc(c.customerType)}</td>
        <td class="sub-cell">${esc(c.timeSlot)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" class="sub-cell" style="padding:12px;text-align:center">无匹配公司</td></tr>';

  empBody.innerHTML = employees.map((e) => {
    const on = manualSelectedEmployees.has(e.id);
    const roles = (e.tags || e.roles || []).join(' · ');
    const tag = e.sourceTag ? `<span class="source-tag" style="font-size:0.58rem">${esc(e.sourceTag)}</span>` : '';
    const dep = e.departureAddress || '未填写';
    const slots = getEmpSlotLabels(e);
    return `
      <tr class="${on ? 'selected' : ''}" data-eid="${e.id}">
        <td><input type="checkbox" class="manual-emp-cb" value="${e.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(e.name)} ${tag}</td>
        <td class="sub-cell">${esc(roles)}</td>
        <td class="sub-cell">${esc(dep)}</td>
        <td class="sub-cell" style="color:#a5b4fc">${esc(slots)}</td>
        <td><button type="button" class="btn-emp-info manual-emp-info-row" data-eid="${e.id}">ⓘ</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="sub-cell" style="padding:12px;text-align:center">无匹配员工</td></tr>';

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
  resetMatchStatusIdle();
  renderManualTables();
  showToast('已清空表格选择');
}

function resetMatchStatusIdle() {
  const idle = document.getElementById('match-status-idle');
  const banner = document.getElementById('manual-success-banner');
  const progress = document.getElementById('manual-progress');
  if (banner) banner.hidden = true;
  if (progress) progress.hidden = true;
  if (idle) idle.hidden = false;
}

function showMatchProgress(total) {
  const box = document.getElementById('manual-progress');
  const fill = document.getElementById('manual-progress-fill');
  const text = document.getElementById('manual-progress-text');
  const idle = document.getElementById('match-status-idle');
  const banner = document.getElementById('manual-success-banner');
  if (!box || !fill || !text) return;
  if (idle) idle.hidden = true;
  if (banner) banner.hidden = true;
  clearInterval(progressTimer);
  box.hidden = false;
  fill.style.width = '8%';
  text.textContent = `正在智能匹配 ${total} 家公司…`;
  let pct = 8;
  progressTimer = setInterval(() => {
    pct = Math.min(pct + Math.random() * 8 + 3, 90);
    fill.style.width = `${pct}%`;
  }, 180);
}

function completeMatchProgress(matched, total) {
  clearInterval(progressTimer);
  progressTimer = null;
  const fill = document.getElementById('manual-progress-fill');
  const text = document.getElementById('manual-progress-text');
  if (fill) fill.style.width = '100%';
  if (text) text.textContent = `匹配完成：${matched}/${total}`;
}

function hideMatchProgress(delay = 400) {
  setTimeout(() => {
    const box = document.getElementById('manual-progress');
    if (box) box.hidden = true;
    const fill = document.getElementById('manual-progress-fill');
    if (fill) fill.style.width = '0';
  }, delay);
}

function showMatchSuccessBanner(data, customerIds = []) {
  const banner = document.getElementById('manual-success-banner');
  const idle = document.getElementById('match-status-idle');
  const progress = document.getElementById('manual-progress');
  if (!banner) return;

  const ok = data.stats?.matched ?? lastMatchPairings.length;
  const fail = data.stats?.unmatched ?? data.stats?.failed ?? lastMatchUnmatched.length;
  const total = customerIds.length || data.stats?.selected || ok + fail;
  const avg = data.stats?.avgCommute;

  let cls = 'match-success-banner';
  if (fail > 0 && ok > 0) cls += ' partial';
  else if (ok === 0) cls += ' fail';

  const parts = [data.message || `匹配完成：${ok}/${total} 家成功`];
  if (fail > 0) parts.push(`${fail} 家失败`);
  if (avg) parts.push(`平均通勤 ${avg} 分钟`);

  banner.className = cls;
  banner.textContent = `✓ ${parts.join(' · ')}`;
  banner.hidden = false;
  if (idle) idle.hidden = true;
  if (progress) progress.hidden = true;
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
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  const body = { sessionId, customerIds, commuteMode: 'local' };
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
    showMatchSuccessBanner(data, customerIds);
    saveManualMatchHistory(data, customerIds, employeePoolIds);
    renderManualResults();
    updateManualStats();
    persistState();
    scrollToManualResults();
    const toastMsg = data.message || `匹配完成：${data.stats?.matched ?? lastMatchPairings.length} 成功`;
    showToast(`${toastMsg} · 已保存历史`);
  } catch (err) {
    showToast(err.message);
    hideMatchProgress(0);
    resetMatchStatusIdle();
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
