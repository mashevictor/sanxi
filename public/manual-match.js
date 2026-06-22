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
let lastEmployeeSchedules = [];
let manualResultView = 'companies';
let manualCompanySort = 'slot';
let renderTablesPending = false;
let sessionLoadError = '';

async function ensureManualSession() {
  if (sessionId) return true;
  showToast('正在连接服务器…');
  await loadData();
  return !!sessionId;
}

document.addEventListener('DOMContentLoaded', () => {
  showPageLoader('加载公司与员工列表…', '正在连接服务器…');
  prefetchSampleData().then((cached) => {
    if (cached?.companies?.length) {
      allCompanies = cached.companies;
      allEmployees = cached.employees || [];
      scheduleRender(() => renderManualTables());
    }
  });
  loadData();
  document.getElementById('manual-history-btn').addEventListener('click', openManualMatchHistory);
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
  document.getElementById('manual-tab-companies')?.addEventListener('click', () => setManualResultView('companies'));
  document.getElementById('manual-tab-schedules')?.addEventListener('click', () => setManualResultView('schedules'));
  document.querySelectorAll('#manual-company-sort .manual-sort-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort;
      if (!sort || sort === manualCompanySort) return;
      manualCompanySort = sort;
      document.querySelectorAll('#manual-company-sort .manual-sort-chip').forEach((b) => {
        b.classList.toggle('active', b.dataset.sort === sort);
      });
      renderManualResults();
    });
  });
});

function buildDuplicateNameIds(employees) {
  const byName = new Map();
  for (const e of employees) {
    const n = (e.name || '').trim();
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(e.id);
  }
  const dupIds = new Set();
  for (const ids of byName.values()) {
    if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
  }
  return dupIds;
}

function getManualEmployeeById(id) {
  return allEmployees.find((e) => e.id === id);
}

function findDuplicateNameInPool(selectedIds) {
  const byName = new Map();
  for (const id of selectedIds) {
    const e = getManualEmployeeById(id);
    if (!e) continue;
    const n = (e.name || '').trim();
    if (byName.has(n)) return { name: n, ids: [byName.get(n), id] };
    byName.set(n, id);
  }
  return null;
}

function trySelectManualEmployee(id, on) {
  if (!on) {
    manualSelectedEmployees.delete(id);
    return true;
  }
  const emp = getManualEmployeeById(id);
  if (!emp) return false;
  const name = (emp.name || '').trim();
  for (const existingId of manualSelectedEmployees) {
    const existing = getManualEmployeeById(existingId);
    if (existing && (existing.name || '').trim() === name) {
      showToast(`员工「${name}」已在池中，不能选同名员工`);
      return false;
    }
  }
  manualSelectedEmployees.add(id);
  return true;
}

async function loadData() {
  sessionLoadError = '';
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
        });
      },
    });
    if (!data?.sessionId) {
      throw new Error('服务器未返回会话（请检查 pm2 是否运行）');
    }
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
    sessionLoadError = err.message || '加载失败';
    sessionId = null;
    showToast(sessionLoadError);
  } finally {
    hidePageLoader();
    updateMatchButton();
    updateManualStats();
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

function resolveCompanyAddress(customerId, pairingAddress) {
  if (pairingAddress) return pairingAddress;
  const c = allCompanies.find((x) => x.id === customerId);
  return c?.address || c?.parkAddress || '';
}

function formatCommuteLabel(p) {
  const min = p.commuteMinutes;
  if (!min) return '—';
  return `单程 ${min} 分`;
}

const MANUAL_SLOT_RANK = { 上午: 0, 下午1: 1, 下午2: 2 };

function sortPairingsForDisplay(pairings) {
  const list = [...pairings];
  if (manualCompanySort === 'employee') {
    return list.sort((a, b) => {
      const nameCmp = (a.employeeName || '').localeCompare(b.employeeName || '', 'zh-CN');
      if (nameCmp !== 0) return nameCmp;
      return (MANUAL_SLOT_RANK[a.timeSlot] ?? 9) - (MANUAL_SLOT_RANK[b.timeSlot] ?? 9);
    });
  }
  return list.sort((a, b) => {
    const slotCmp = (MANUAL_SLOT_RANK[a.timeSlot] ?? 9) - (MANUAL_SLOT_RANK[b.timeSlot] ?? 9);
    if (slotCmp !== 0) return slotCmp;
    return (a.companyName || '').localeCompare(b.companyName || '', 'zh-CN');
  });
}

function countPairingsByEmployee(name) {
  return lastMatchPairings.filter((p) => p.employeeName === name).length;
}

function filterManualCompanies() {
  const q = manualCoSearch.toLowerCase();
  if (!q) return allCompanies;
  return allCompanies.filter((c) => {
    const hay = `${c.companyName} ${c.customerType} ${c.timeSlot} ${c.parkName} ${c.address || ''} ${c.parkAddress || ''}`.toLowerCase();
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

function formatParkCell(c) {
  const park = esc(c.parkName || '—');
  const addr = c.address || c.parkAddress;
  const addrLine = addr
    ? `<span class="park-addr" title="${esc(addr)}">${esc(addr)}</span>`
    : '<span class="park-addr muted">未填写拜访地址</span>';
  return `<span class="park-name">${park}</span>${addrLine}`;
}

function renderManualTablesNow() {
  const coBody = document.getElementById('manual-co-tbody');
  const empBody = document.getElementById('manual-emp-tbody');
  if (!coBody || !empBody) return;

  const companies = filterManualCompanies();
  const employees = filterManualEmployees();
  const duplicateNameIds = buildDuplicateNameIds(allEmployees);

  coBody.innerHTML = companies.map((c) => {
    const on = manualSelectedCompanies.has(c.id);
    const tag = c.sourceTag ? `<span class="source-tag" style="font-size:0.58rem;margin-left:4px">${esc(c.sourceTag)}</span>` : '';
    return `
      <tr class="${on ? 'selected' : ''}" data-cid="${c.id}">
        <td><input type="checkbox" class="manual-co-cb" value="${c.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(c.companyName)}${tag}</td>
        <td class="park-cell">${formatParkCell(c)}</td>
        <td class="sub-cell">${esc(c.customerType)}</td>
        <td class="sub-cell">${esc(c.timeSlot)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" class="sub-cell" style="padding:12px;text-align:center">无匹配公司</td></tr>';

  empBody.innerHTML = employees.map((e) => {
    const on = manualSelectedEmployees.has(e.id);
    const roles = (e.tags || e.roles || []).join(' · ');
    const tag = e.sourceTag ? `<span class="source-tag" style="font-size:0.58rem">${esc(e.sourceTag)}</span>` : '';
    const dupTag = duplicateNameIds.has(e.id)
      ? '<span class="source-tag" style="font-size:0.58rem;background:#7f1d1d;color:#fecaca;margin-left:4px">同名</span>'
      : '';
    const dep = e.departureAddress || '未填写';
    const slots = getEmpSlotLabels(e);
    return `
      <tr class="${on ? 'selected' : ''}" data-eid="${e.id}">
        <td><input type="checkbox" class="manual-emp-cb" value="${e.id}" ${on ? 'checked' : ''}></td>
        <td class="co-name-cell">${esc(e.name)} ${tag}${dupTag}</td>
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
  const noSession = !sessionId;
  btn.disabled = isMatching || manualSelectedCompanies.size === 0 || noSession;
  btn.title = noSession ? '等待服务器连接，请稍后或刷新页面' : '';
}

function updateSessionHint() {
  const capEl = document.getElementById('manual-capacity-hint');
  if (!capEl) return;
  if (sessionId) return;
  capEl.hidden = false;
  capEl.className = 'capacity-hint warn';
  capEl.textContent = sessionLoadError
    ? `服务器未连接：${sessionLoadError}（当前列表来自缓存，无法匹配。请检查 pm2 后刷新）`
    : '正在连接服务器…（列表可先勾选，连接成功后即可匹配）';
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
    if (on) {
      manualSelectedEmployees.clear();
      const seen = new Set();
      filterManualEmployees().forEach((emp) => {
        const name = (emp.name || '').trim();
        if (seen.has(name)) return;
        seen.add(name);
        manualSelectedEmployees.add(emp.id);
      });
    } else {
      filterManualEmployees().forEach((emp) => manualSelectedEmployees.delete(emp.id));
    }
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
    if (!trySelectManualEmployee(id, cb.checked)) cb.checked = false;
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
  const startedAt = Date.now();
  text.textContent = `正在智能匹配 ${total} 家公司…`;
  let pct = 8;
  progressTimer = setInterval(() => {
    pct = Math.min(pct + Math.random() * 8 + 3, 90);
    fill.style.width = `${pct}%`;
    const sec = Math.round((Date.now() - startedAt) / 1000);
    text.textContent = `正在智能匹配 ${total} 家公司…（已 ${sec} 秒，本地模式通常 5–20 秒）`;
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

function setManualResultView(view) {
  manualResultView = view;
  document.getElementById('manual-tab-companies')?.classList.toggle('active', view === 'companies');
  document.getElementById('manual-tab-schedules')?.classList.toggle('active', view === 'schedules');
  const resultBox = document.getElementById('manual-result');
  const scheduleBoard = document.getElementById('manual-schedule-board');
  const sortBar = document.getElementById('manual-company-sort');
  if (resultBox) resultBox.hidden = view !== 'companies';
  if (scheduleBoard) scheduleBoard.hidden = view !== 'schedules';
  if (sortBar) sortBar.hidden = view !== 'companies';
}

function sortEmployeeSchedules(schedules) {
  return [...schedules].sort((a, b) => {
    if (b.totalOrders !== a.totalOrders) return b.totalOrders - a.totalOrders;
    return (a.employeeName || '').localeCompare(b.employeeName || '', 'zh-CN');
  });
}

function renderManualScheduleBoard() {
  const board = document.getElementById('manual-schedule-board');
  if (!board) return;

  if (!lastEmployeeSchedules.length) {
    board.innerHTML = '<div class="empty" style="padding:24px">匹配成功后，可在此查看所有员工的当日行程（同一员工多单合并显示）</div>';
    return;
  }

  const schedules = sortEmployeeSchedules(lastEmployeeSchedules);
  board.innerHTML = schedules.map((s, idx) => {
    const orders = s.orders.map((o, oi) => `
      <div class="schedule-order">
        <span class="slot-tag">${esc(o.timeSlot)}</span>
        <div>
          <div class="order-name">${esc(o.companyName)}</div>
          <div class="schedule-meta">${esc(o.customerType || '')} · ${esc(o.parkName || '')}</div>
          <div class="order-addr">📍 ${esc(o.address || '—')}</div>
        </div>
        <div class="commute-leg">${o.commuteMinutes ? `单程 ${o.commuteMinutes} 分` : '—'}</div>
      </div>
    `).join('');

    const routes = (s.routeSegments || []).map((seg) => `
      <div class="route-seg"><span>${esc(seg.from)}</span> → <span>${esc(seg.to)}</span> · ${seg.minutes} 分</div>
    `).join('');

    return `
      <div class="schedule-card" style="animation-delay:${idx * 0.04}s">
        <div class="schedule-hd">
          <div>
            <div class="schedule-name">${esc(s.employeeName)}</div>
            <div class="schedule-meta">出发地：${esc(s.departureAddress || '—')}</div>
          </div>
          <div class="schedule-stats">
            <span>${s.totalOrders} 单</span>
            <span>上午 ${s.morningOrders}</span>
            <span>下午 ${s.afternoonOrders}</span>
            <span>总通勤 ${s.totalCommuteMinutes} 分</span>
          </div>
        </div>
        ${orders}
        ${routes ? `<div class="schedule-routes"><div class="schedule-routes-title">段间串联路线</div>${routes}</div>` : ''}
      </div>
    `;
  }).join('');
}

function applyMatchResult(data) {
  lastMatchPairings = data.pairings || [];
  lastMatchUnmatched = data.unmatchedCompanies || [];
  lastEmployeeSchedules = data.employeeSchedules || [];
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
  const tabs = document.getElementById('manual-result-tabs');
  if (!box) return;

  const ok = lastMatchPairings.length;
  const fail = lastMatchUnmatched.length;
  if (summary) {
    const schedCount = lastEmployeeSchedules.length;
    summary.textContent = ok + fail > 0
      ? `${ok} 成功 · ${fail} 失败${schedCount ? ` · ${schedCount} 人有行程` : ''}`
      : '';
  }

  if (!ok && !fail) {
    if (tabs) tabs.hidden = true;
    const sortBar = document.getElementById('manual-company-sort');
    if (sortBar) sortBar.hidden = true;
    setManualResultView('companies');
    box.innerHTML = '<div class="empty" style="padding:24px">匹配结果将显示在这里</div>';
    renderManualScheduleBoard();
    return;
  }

  if (tabs) tabs.hidden = false;
  const sortBar = document.getElementById('manual-company-sort');
  if (sortBar) sortBar.hidden = false;

  const sortedOk = sortPairingsForDisplay(lastMatchPairings);
  let lastEmpName = '';
  const okRows = sortedOk.map((p, i) => {
    const addr = resolveCompanyAddress(p.customerId, p.address);
    const route = p.route?.pathSummary
      || (p.departureAddress && addr ? `${p.departureAddress} → ${addr}` : '');
    let groupHd = '';
    if (manualCompanySort === 'employee' && p.employeeName !== lastEmpName) {
      const cnt = countPairingsByEmployee(p.employeeName);
      groupHd = `<div class="emp-group-hd">${esc(p.employeeName)}${cnt > 1 ? ` · ${cnt} 单` : ''}</div>`;
      lastEmpName = p.employeeName;
    }
    return `${groupHd}
    <div class="manual-result-row ok" style="animation-delay:${i * 0.03}s">
      <div class="row-main">
        <div>
          <div class="co-line">${esc(p.companyName)}</div>
          <div class="sub-line">${esc(p.customerType)} · ${esc(p.timeSlot)} · ${esc(p.parkName)}</div>
          ${addr ? `<div class="addr-line">📍 ${esc(addr)}</div>` : ''}
        </div>
        <div class="arrow">→</div>
        <div>
          <div class="emp-line">${esc(p.employeeName)}</div>
          <div class="sub-line">出发 ${esc(p.departureAddress || '—')}</div>
        </div>
        <div class="commute">${formatCommuteLabel(p)}</div>
      </div>
      ${route ? `<div class="route-line">${esc(route)}</div>` : ''}
    </div>
  `;
  }).join('');

  const failRows = lastMatchUnmatched.map((u, i) => {
    const reason = extractFailReason({ type: 'fail', data: u });
    const addr = resolveCompanyAddress(u.customerId, u.address);
    return `
      <div class="manual-result-row fail" style="animation-delay:${(ok + i) * 0.03}s">
        <div class="row-main">
          <div>
            <div class="co-line">${esc(u.companyName)}</div>
            <div class="sub-line">${esc(u.customerType || '')} · ${esc(u.parkName || '')}</div>
            ${addr ? `<div class="addr-line">📍 ${esc(addr)}</div>` : ''}
          </div>
          <div class="arrow">✕</div>
          <div class="fail-tag" style="grid-column:3/5">${esc(reason)}</div>
        </div>
      </div>
    `;
  }).join('');

  box.innerHTML = (failRows ? `<div style="margin-bottom:10px;font-size:0.72rem;color:#fca5a5;font-weight:600">匹配失败 / 待处理</div>${failRows}` : '')
    + (okRows ? `<div style="margin:${failRows ? '14px' : '0'} 0 10px;font-size:0.72rem;color:#6ee7b7;font-weight:600">匹配成功</div>${okRows}` : '');

  renderManualScheduleBoard();
  setManualResultView(manualResultView);
}

function scrollToManualResults() {
  const section = document.getElementById('manual-result-section');
  if (!section) return;
  requestAnimationFrame(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

async function onManualMatch() {
  if (!(await ensureManualSession())) {
    showToast(sessionLoadError || '无法连接服务器，请确认 pm2 已启动后刷新页面');
    updateSessionHint();
    return;
  }
  const customerIds = Array.from(manualSelectedCompanies).sort((a, b) => a - b);
  if (!customerIds.length) {
    showToast('请先在表格中勾选公司');
    return;
  }

  const employeePoolIds = Array.from(manualSelectedEmployees);
  const dupInPool = findDuplicateNameInPool(employeePoolIds);
  if (dupInPool) {
    showToast(`员工池存在同名「${dupInPool.name}」，请只保留其中一人`);
    return;
  }
  const capacityHint = summarizePoolCapacity(employeePoolIds);
  if (capacityHint && customerIds.length) {
    console.info('[手动派单] 员工池容量:', capacityHint);
  }

  const btn = document.getElementById('manual-match-btn');
  isMatching = true;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = '匹配中...';
  showMatchProgress(customerIds.length);

  const body = { sessionId, customerIds, commuteMode: 'local' };
  if (employeePoolIds.length) body.employeePoolIds = employeePoolIds;

  try {
    const data = await fetchJsonWithTimeout('/api/dispatch/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 90000);

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

function summarizePoolCapacity(employeePoolIds) {
  if (!employeePoolIds.length) return null;
  let morning = 0;
  let afternoon1 = 0;
  let afternoon2 = 0;
  for (const id of employeePoolIds) {
    const e = allEmployees.find((x) => x.id === id);
    if (!e?.orderCapacity) continue;
    if (e.orderCapacity.includes('MORNING')) morning++;
    if (e.orderCapacity.includes('AFTERNOON_1')) afternoon1++;
    if (e.orderCapacity.includes('AFTERNOON_2')) afternoon2++;
  }
  return { morning, afternoon1, afternoon2, total: morning + afternoon1 + afternoon2 };
}

function countSelectedBySlot() {
  const counts = { morning: 0, afternoon1: 0, afternoon2: 0 };
  for (const id of manualSelectedCompanies) {
    const c = allCompanies.find((x) => x.id === id);
    if (!c) continue;
    if (c.timeSlot === '上午') counts.morning++;
    else if (c.timeSlot === '下午1') counts.afternoon1++;
    else if (c.timeSlot === '下午2') counts.afternoon2++;
  }
  return counts;
}

function updateManualStats() {
  document.getElementById('stat-co-picked').textContent = manualSelectedCompanies.size;
  document.getElementById('stat-emp-picked').textContent = manualSelectedEmployees.size;
  document.getElementById('stat-manual-ok').textContent = lastMatchPairings.length;
  document.getElementById('stat-manual-fail').textContent = lastMatchUnmatched.length;

  updateSessionHint();
  if (!sessionId) return;

  const capEl = document.getElementById('manual-capacity-hint');
  if (!capEl) return;
  const pool = summarizePoolCapacity(Array.from(manualSelectedEmployees));
  const need = countSelectedBySlot();
  if (!manualSelectedCompanies.size) {
    capEl.textContent = '';
    capEl.hidden = true;
    return;
  }
  capEl.hidden = false;
  const dupInPool = findDuplicateNameInPool(Array.from(manualSelectedEmployees));
  if (dupInPool) {
    capEl.className = 'capacity-hint warn';
    capEl.textContent = `员工池存在同名「${dupInPool.name}」，请只保留其中一人后再匹配`;
    return;
  }
  if (!pool) {
    capEl.textContent = `已选公司：上午 ${need.morning} · 下午1 ${need.afternoon1} · 下午2 ${need.afternoon2}（未限定员工池，使用全员）`;
    capEl.className = 'capacity-hint';
    return;
  }
  const warn =
    need.morning > pool.morning || need.afternoon1 > pool.afternoon1 || need.afternoon2 > pool.afternoon2;
  capEl.className = warn ? 'capacity-hint warn' : 'capacity-hint ok';
  capEl.textContent =
    `需求 上午${need.morning}/下午1 ${need.afternoon1}/下午2 ${need.afternoon2} · ` +
    `员工池容量 上午${pool.morning}/下午1 ${pool.afternoon1}/下午2 ${pool.afternoon2}` +
    (warn ? ' · 容量可能不足' : '');
}
