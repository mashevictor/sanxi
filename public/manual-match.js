let sessionId = null;
let allCompanies = [];
let allEmployees = [];
const manualSelectedCompanies = new Set();
const manualSelectedEmployees = new Set();
const assignmentMap = new Map();
let manualCoSearch = '';
let manualEmpSearch = '';
let manualTablesBound = false;
const manualResults = [];

const pageLoader = document.getElementById('page-loader');

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  document.getElementById('manual-assign-btn').addEventListener('click', onManualAssign);
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
    const res = await fetch('/api/sample-data');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败');
    sessionId = data.sessionId;
    allCompanies = data.companies;
    allEmployees = data.employees;
    if (stored?.assignmentMap?.length) {
      const map = deserializeAssignmentMap(stored.assignmentMap);
      for (const [k, v] of map) assignmentMap.set(k, v);
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

function buildManualAssignPairs() {
  const coIds = Array.from(manualSelectedCompanies).sort((a, b) => a - b);
  const empIds = Array.from(manualSelectedEmployees).sort((a, b) => a - b);
  if (!coIds.length || !empIds.length) return null;
  if (empIds.length === 1) return coIds.map((cid) => ({ customerId: cid, employeeId: empIds[0] }));
  if (coIds.length === empIds.length) return coIds.map((cid, i) => ({ customerId: cid, employeeId: empIds[i] }));
  return null;
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

async function validateAndAssign(customerId, employeeId) {
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

  const company = allCompanies.find((c) => c.id === customerId);
  const employee = allEmployees.find((e) => e.id === employeeId);

  if (data.eligible) {
    assignmentMap.set(customerId, {
      type: 'ok',
      data: {
        customerId: data.customerId,
        companyName: data.companyName,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        commuteMinutes: data.commuteMinutes,
        timeSlot: data.timeSlot,
        customerType: data.customerType,
      },
      manual: true,
    });
    return {
      ok: true,
      text: `${data.companyName} → ${data.employeeName}（${data.commuteMinutes} 分）`,
    };
  }

  assignmentMap.set(customerId, {
    type: 'fail',
    data: {
      customerId,
      companyName: data.companyName || company?.companyName,
      reason: data.failedRules?.map((r) => `${r.rule}不匹配`).join('、') || '不合规',
      nearestAttempt: {
        employeeName: data.employeeName,
        departureAddress: data.departureAddress,
        failedRules: data.failedRules,
      },
    },
    manual: true,
  });
  return {
    ok: false,
    text: `${data.companyName || company?.companyName} → ${employee?.name || data.employeeName}：${extractFailReason(assignmentMap.get(customerId))}`,
  };
}

async function onManualAssign() {
  const pairs = buildManualAssignPairs();
  if (!manualSelectedCompanies.size) { showToast('请先在表格中勾选公司'); return; }
  if (!manualSelectedEmployees.size) { showToast('请先在表格中勾选员工'); return; }
  if (!pairs) { showToast('请选 1 名员工派给多家，或等数量一一配对'); return; }

  manualResults.length = 0;
  let ok = 0;
  let fail = 0;

  for (const { customerId, employeeId } of pairs) {
    try {
      const r = await validateAndAssign(customerId, employeeId);
      manualResults.unshift(r);
      if (r.ok) ok++;
      else fail++;
    } catch (err) {
      manualResults.unshift({ ok: false, text: err.message });
      fail++;
    }
  }

  renderManualResults();
  updateManualStats();
  persistState();

  if (fail === 0) showToast(`✓ ${ok} 条全部指派成功`);
  else if (ok === 0) showToast(`✗ ${fail} 条不合规`);
  else showToast(`${ok} 条成功，${fail} 条不合规`);
}

function renderManualResults() {
  const box = document.getElementById('manual-result');
  if (!box) return;
  if (!manualResults.length) {
    box.innerHTML = '<div class="empty" style="padding:24px">指派结果将显示在这里</div>';
    return;
  }
  box.innerHTML = manualResults.map((r) =>
    `<div class="manual-result-item ${r.ok ? 'ok' : 'fail'}">${esc(r.text)}</div>`
  ).join('');
}

function updateManualStats() {
  document.getElementById('stat-co-picked').textContent = manualSelectedCompanies.size;
  document.getElementById('stat-emp-picked').textContent = manualSelectedEmployees.size;
  let ok = 0;
  let fail = 0;
  for (const [, e] of assignmentMap) {
    if (e.manual && e.type === 'ok') ok++;
    if (e.manual && e.type === 'fail') fail++;
  }
  document.getElementById('stat-manual-ok').textContent = ok;
  document.getElementById('stat-manual-fail').textContent = fail;
}
