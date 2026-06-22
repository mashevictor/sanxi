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
let pickerPortalBound = false;
let activeView = 'results';

let showcaseCustomerIds = [];
let fullMatchCustomerIds = [];
let fullMatchCache = null;
let integratedDataVersion = '';

const fullMatchBtn = document.getElementById('full-match-btn');

let aiHistorySaveTimer = null;

fullMatchBtn.addEventListener('click', loadFullMatchAndMatch);
document.getElementById('ai-history-btn').addEventListener('click', openAiMatchHistory);
document.getElementById('sel-all-co').addEventListener('click', toggleAllCompanies);

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

document.addEventListener('DOMContentLoaded', () => {
  showPageLoader('加载派单数据...', '正在读取公司与员工列表');
  prefetchFullMatchCache().then((cache) => {
    if (cache) fullMatchCache = cache;
  });
  prefetchSampleData().then((cached) => {
    if (cached?.companies?.length) {
      allCompanies = cached.companies;
      allEmployees = cached.employees || [];
      showcaseCustomerIds = cached.showcaseCustomerIds || [];
      fullMatchCustomerIds = cached.fullMatchCustomerIds || [];
      maxCommuteMinutes = cached.maxCommuteMinutes || 60;
      scheduleRender(() => {
        renderCompanies();
        renderBoard();
        updateStats();
        hidePageLoader();
      });
    }
  });
  loadIntegratedData().then(() => {
    if (sessionStorage.getItem('dispatch-auto-full-match') === '1') {
      sessionStorage.removeItem('dispatch-auto-full-match');
      loadFullMatchAndMatch();
    }
  });
  document.getElementById('dispatch-board').addEventListener('click', handleBoardClick);
  document.getElementById('emp-modal-close').addEventListener('click', () => {
    document.getElementById('emp-modal').hidden = true;
  });
  document.getElementById('emp-modal').addEventListener('click', (e) => {
    if (e.target.id === 'emp-modal') document.getElementById('emp-modal').hidden = true;
  });
  window.addEventListener('resize', positionOpenPicker);
  window.addEventListener('scroll', positionOpenPicker, true);
  document.addEventListener('click', (e) => {
    if (openPickerId !== null && !e.target.closest('.emp-picker') && !e.target.closest('#emp-picker-portal')) {
      openPickerId = null;
      pickerSearch = '';
      renderBoard({ animate: false });
      renderPickerPortal();
    }
  });
});

function handleBoardClick(e) {
  const infoBtn = e.target.closest('.btn-emp-info');
  if (infoBtn) {
    e.stopPropagation();
    const eid = parseInt(infoBtn.dataset.eid, 10);
    if (eid) showEmployeeModal(eid, allEmployees);
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
    const stored = loadDispatchState('ai');
    showPageLoader('连接服务器...', '正在创建匹配会话');
    const data = await bootstrapIntegratedData({
      prefetchFullMatch: true,
      onCacheReady: (cached) => {
        allCompanies = cached.companies || [];
        allEmployees = cached.employees || [];
        showcaseCustomerIds = cached.showcaseCustomerIds || [];
        fullMatchCustomerIds = cached.fullMatchCustomerIds || [];
        integratedDataVersion = cached.dataVersion || '';
        maxCommuteMinutes = cached.maxCommuteMinutes || 60;
        renderCompanies();
        renderBoard();
        updateStats();
        hidePageLoader();
      },
    });
    applySessionMeta(data);
    if (stored?.selectedCompanies?.length) {
      stored.selectedCompanies.forEach((id) => selectedCompanies.add(id));
    }
    if (stored?.assignmentMap?.length) {
      assignmentMap = deserializeAssignmentMap(stored.assignmentMap);
      syncPreviewFromAssignment();
    }
    renderCompanies();
    renderBoard();
    updateStats();
    persistDispatchState();
  } catch (err) {
    showToast(err.message);
  } finally {
    hidePageLoader();
  }
}

/** 仅更新会话元数据，不清空已选公司与匹配结果 */
function applySessionMeta(data) {
  sessionId = data.sessionId;
  allCompanies = data.companies;
  allEmployees = data.employees;
  showcaseCustomerIds = data.showcaseCustomerIds || [];
  fullMatchCustomerIds = data.fullMatchCustomerIds || [];
  integratedDataVersion = data.dataVersion || integratedDataVersion || '';
  maxCommuteMinutes = data.maxCommuteMinutes || 60;
}

function isFullMatchCacheUsable(cache) {
  if (!cache?.pairings?.length) return false;
  if (integratedDataVersion && cache.dataVersion && cache.dataVersion !== integratedDataVersion) {
    return false;
  }
  return true;
}

async function ensureSessionReady() {
  if (sessionId) return true;
  await loadIntegratedData();
  return !!sessionId;
}

async function resolveFullMatchCache() {
  if (fullMatchCache && isFullMatchCacheUsable(fullMatchCache)) return fullMatchCache;
  const cache = await prefetchFullMatchCache();
  if (cache && isFullMatchCacheUsable(cache)) {
    fullMatchCache = cache;
    return cache;
  }
  return null;
}

function getRemapMissingIds(remapped, expectedIds) {
  const pairedIds = new Set((remapped.pairings || []).map((p) => p.customerId));
  return expectedIds.filter((id) => !pairedIds.has(id));
}

async function loadFullMatchAndMatch() {
  if (!sessionId) {
    await loadIntegratedData();
  }

  fullMatchBtn.disabled = true;
  fullMatchBtn.classList.add('loading');
  const prevLabel = fullMatchBtn.textContent;
  fullMatchBtn.textContent = '匹配中...';

  try {
    const ids = resolveFullMatchSelectIds(fullMatchCache || {});
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

    let resultPayload = null;
    let usedLiveMatch = false;

    const cache = await resolveFullMatchCache();
    if (cache) {
      const remapped = remapCacheResult(cache, { preferDemo: false });
      const missing = getRemapMissingIds(remapped, ids);
      const cacheOk = missing.length === 0 && !(remapped.unmatchedCompanies || []).length;

      if (cacheOk) {
        resultPayload = {
          pairings: remapped.pairings || [],
          unmatchedCompanies: remapped.unmatchedCompanies || [],
          employeeSchedules: remapped.employeeSchedules || [],
          message: remapped.message || `已为 ${ids.length} 家公司完成全量匹配（缓存）`,
          distanceSource: remapped.distanceSource || 'local',
          maxCommuteMinutes: remapped.maxCommuteMinutes || 60,
        };
      } else if (missing.length) {
        console.warn('[全量匹配] 缓存映射缺', missing.length, '家，改用实时匹配');
      }
    } else {
      console.warn('[全量匹配] 缓存不可用（未部署或版本不一致），改用实时匹配');
    }

    if (!resultPayload) {
      usedLiveMatch = true;
      fullMatchBtn.textContent = '实时匹配中...';
      if (!(await ensureSessionReady())) {
        showToast('会话未就绪，请刷新页面后重试');
        return;
      }
      resultPayload = await callSelectApi({ fullMatch: true });
    }

    applyDispatchResult(resultPayload, { historyLabel: '全量匹配', immediate: true, showToast: true });
    renderBoard({ animate: true });
    renderSchedules();
    updateStats();
    showToast(
      usedLiveMatch
        ? (resultPayload.message || '全量匹配完成（实时计算）')
        : (resultPayload.message || '全量匹配完成（缓存）')
    );
  } catch (err) {
    showToast(err.message);
  } finally {
    fullMatchBtn.disabled = false;
    fullMatchBtn.classList.remove('loading');
    fullMatchBtn.textContent = prevLabel || '全量匹配';
  }
}

function resolveFullMatchSelectIds(cache) {
  if (fullMatchCustomerIds.length) return fullMatchCustomerIds;
  if (cache?.fullMatchCustomerIds?.length) return cache.fullMatchCustomerIds;
  if (allCompanies.length) return allCompanies.map((c) => c.id);
  return [];
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

function findCompanyInSession(pairing, preferDemo = false) {
  const byId = allCompanies.find((c) => c.id === pairing.customerId);
  if (byId) return byId;

  const sameName = allCompanies.filter((c) => c.companyName === pairing.companyName);
  if (!sameName.length) return null;
  if (sameName.length === 1) return sameName[0];

  const byParkSlot = sameName.find(
    (c) => c.parkName === pairing.parkName && c.timeSlot === pairing.timeSlot
  );
  if (byParkSlot) return byParkSlot;

  if (preferDemo) {
    const demo = sameName.find((c) => c.sourceTag === '演示');
    if (demo) return demo;
  }

  return sameName.find((c) => c.id < 90100) || sameName[0];
}

function remapCacheResult(cache, options = {}) {
  const preferDemo = options.preferDemo ?? false;
  const pairings = (cache.pairings || []).map((p) => {
    const company = findCompanyInSession(p, preferDemo);
    const useDemoEmp = preferDemo || company?.sourceTag === '演示' || (company?.id >= 90100);
    const emp = findEmployeeInSession(p.employeeName, p.departureAddress, useDemoEmp);
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
        const company = findCompanyInSession(
          { customerId: o.customerId, companyName: o.companyName, parkName: o.parkName, timeSlot: o.timeSlot },
          preferDemo
        );
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

function persistDispatchState() {
  saveDispatchState('ai', {
    sessionId,
    selectedCompanies: Array.from(selectedCompanies),
    assignmentMap: serializeAssignmentMap(assignmentMap),
  });
}

function scheduleAiHistorySave(data, options = {}) {
  clearTimeout(aiHistorySaveTimer);
  const run = () => {
    const pairings = (data.pairings || []).filter((p) => p.eligible !== false);
    const unmatched = data.unmatchedCompanies || [];
    if (!pairings.length && !unmatched.length) return;
    const entry = buildMatchHistoryEntry(data, {
      mode: 'ai',
      label: options.historyLabel || 'AI 匹配',
      selectedCompanies: getSelectedIds(),
    });
    if (appendMatchHistory('ai', entry) && options.showToast) {
      showToast('已保存到 AI 匹配历史');
    }
  };
  if (options.immediate) run();
  else aiHistorySaveTimer = setTimeout(run, 1200);
}

function restoreAiHistoryEntry(entry) {
  if (!entry) return;
  selectedCompanies.clear();
  (entry.selectedCompanies || []).forEach((id) => selectedCompanies.add(Number(id)));
  applyDispatchResult({
    pairings: entry.pairings,
    unmatchedCompanies: entry.unmatchedCompanies,
    employeeSchedules: entry.employeeSchedules,
    message: entry.message,
    distanceSource: entry.distanceSource,
    maxCommuteMinutes: entry.maxCommuteMinutes,
    stats: entry.stats,
  }, { skipHistory: true });
  renderCompanies();
  renderBoard({ animate: true });
  renderSchedules();
  updateStats();
  activeView = 'results';
  switchView('results');
  showToast(`已恢复：${entry.label || entry.title}`);
}

function openAiMatchHistory() {
  openMatchHistoryModal('ai', { onRestore: restoreAiHistoryEntry });
}

function updateManualHint() {
  /* AI 页使用静态提示 */
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

function buildPickerListHtml(customerId, currentEmployeeId) {
  const used = getUsedEmployeeIds(customerId);
  const filtered = allEmployees.filter((e) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    const tags = (e.tags || e.roles || []).join(' ');
    const hay = `${e.name} ${e.departureAddress || ''} ${tags} ${getEmpSlotLabels(e)}`.toLowerCase();
    return hay.includes(q);
  });

  const clearOption = currentEmployeeId
    ? `<div class="emp-option clear-option" data-cid="${customerId}" data-eid="0" data-clear="1">
         <div class="emp-option-top"><span class="emp-option-name">✕ 清除指派</span></div>
       </div>`
    : '';

  const items = filtered.map((e) => {
    const taken = used.includes(e.id) && e.id !== currentEmployeeId;
    const tags = e.tags || [...(e.roles || []), ...(e.capacityLabels || [])];
    const showcaseTag = e.sourceTag ? `<span class="source-tag">${esc(e.sourceTag)}</span>` : '';
    return `
      <div class="emp-option ${taken ? 'disabled' : ''} ${e.id === currentEmployeeId ? 'selected' : ''}"
           data-cid="${customerId}" data-eid="${e.id}">
        <div class="emp-option-top">
          <span class="emp-option-name">${esc(e.name)} ${showcaseTag}</span>
          <button type="button" class="btn-emp-info" data-eid="${e.id}" title="查看员工信息">ⓘ</button>
        </div>
        <div class="emp-option-tags">${tags.map((t) => `<span class="etag">${esc(t)}</span>`).join('')}</div>
        ${renderEmpDepSlots(e)}
      </div>
    `;
  }).join('');

  return `${clearOption}${items || (allEmployees.length
    ? '<div style="padding:12px;color:var(--muted);font-size:0.8rem">无匹配员工</div>'
    : '<div style="padding:12px;color:var(--muted);font-size:0.8rem">员工数据未加载</div>')}`;
}

function renderEmployeePicker(customerId, currentEmployeeId, disabled) {
  const current = allEmployees.find((e) => e.id === currentEmployeeId);
  const isOpen = openPickerId === customerId;
  return `
    <div class="emp-picker ${isOpen ? 'open' : ''}" data-cid="${customerId}">
      <button type="button" class="emp-picker-btn" data-cid="${customerId}" ${disabled ? 'disabled' : ''}>
        <span>
          <div class="picker-name">${current ? esc(current.name) : '选择员工'}</div>
          ${current ? `<div class="picker-sub">${renderEmpDepSlots(current)}</div>` : ''}
        </span>
        <span class="picker-arrow">▼</span>
      </button>
    </div>
  `;
}

function ensurePickerPortal() {
  let portal = document.getElementById('emp-picker-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'emp-picker-portal';
    portal.className = 'emp-picker-panel';
    portal.hidden = true;
    document.body.appendChild(portal);
    bindPickerPortalEvents(portal);
  }
  return portal;
}

function bindPickerPortalEvents(portal) {
  if (pickerPortalBound) return;
  pickerPortalBound = true;

  portal.addEventListener('click', (e) => e.stopPropagation());

  portal.addEventListener('input', (e) => {
    const input = e.target.closest('.emp-search');
    if (!input || openPickerId === null) return;
    pickerSearch = input.value;
    renderPickerPortal();
    const el = portal.querySelector('.emp-search');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  portal.addEventListener('click', async (e) => {
    const infoBtn = e.target.closest('.btn-emp-info');
    if (infoBtn) {
      e.stopPropagation();
      showEmployeeModal(parseInt(infoBtn.dataset.eid, 10), allEmployees);
      return;
    }
    const opt = e.target.closest('.emp-option:not(.disabled)');
    if (!opt) return;
    e.stopPropagation();
    const customerId = parseInt(opt.dataset.cid, 10);
    openPickerId = null;
    pickerSearch = '';
    renderPickerPortal();
    if (opt.dataset.clear === '1') {
      await clearEmployeeAssignment(customerId);
      return;
    }
    await applyEmployeeChange(customerId, parseInt(opt.dataset.eid, 10));
  });
}

function renderPickerPortal() {
  const portal = ensurePickerPortal();
  if (openPickerId === null) {
    portal.hidden = true;
    return;
  }
  const customerId = openPickerId;
  let currentEmployeeId = null;
  const entry = assignmentMap.get(customerId);
  if (entry?.type === 'ok') currentEmployeeId = entry.data.employeeId;

  portal.hidden = false;
  portal.innerHTML = `
    <input type="text" class="emp-search" placeholder="搜索姓名 / 出发地 / 时段 / 标签" value="${esc(pickerSearch)}">
    <div class="emp-picker-list">${buildPickerListHtml(customerId, currentEmployeeId)}</div>
  `;
  requestAnimationFrame(() => positionOpenPicker());
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
    html += `<div style="margin-top:6px;color:var(--muted)">最近候选 <strong>${esc(u.nearestAttempt.employeeName)}</strong></div>`;
    const nearEmp = allEmployees.find((e) => e.name === u.nearestAttempt.employeeName);
    html += `<div style="margin-top:4px">${nearEmp ? renderEmpDepSlots(nearEmp) : esc(u.nearestAttempt.departureAddress)}</div>`;
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
            ? `<span class="manual-tag fail-reason-tag">${esc(extractFailReason(entry))}</span>`
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
  renderPickerPortal();
  updateManualHint();
}

function positionOpenPicker() {
  if (openPickerId === null) return;
  const btn = document.querySelector(`.emp-picker[data-cid="${openPickerId}"] .emp-picker-btn`);
  const portal = document.getElementById('emp-picker-portal');
  if (!btn || !portal || portal.hidden) return;

  const rect = btn.getBoundingClientRect();
  const gap = 4;
  const panelMax = 320;
  const spaceBelow = window.innerHeight - rect.bottom - gap - 12;
  const spaceAbove = rect.top - gap - 12;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;

  portal.style.width = `${Math.max(rect.width, 280)}px`;
  portal.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - Math.max(rect.width, 280) - 8)}px`;

  if (openUp) {
    const h = Math.min(panelMax, spaceAbove);
    portal.style.top = `${rect.top - gap - h}px`;
    portal.style.maxHeight = `${h}px`;
  } else {
    portal.style.top = `${rect.bottom + gap}px`;
    portal.style.maxHeight = `${Math.min(panelMax, Math.max(spaceBelow, 120))}px`;
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
      renderPickerPortal();
      if (openPickerId) {
        requestAnimationFrame(() => {
          const input = document.getElementById('emp-picker-portal')?.querySelector('.emp-search');
          if (input) input.focus();
        });
      }
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
  persistDispatchState();
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
          reason: data.failedRules?.map((r) => `${r.rule}不匹配`).join('、') || '不合规',
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
    persistDispatchState();
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

function applyDispatchResult(data, options = {}) {
  previewPairings = (data.pairings || []).filter((p) => p.eligible !== false);
  previewUnmatched = data.unmatchedCompanies || [];
  employeeSchedules = data.employeeSchedules || [];
  distanceSource = data.distanceSource || '';
  if (data.maxCommuteMinutes) maxCommuteMinutes = data.maxCommuteMinutes;
  syncAssignmentFromApi(previewPairings, previewUnmatched);
  syncPreviewFromAssignment();
  persistDispatchState();
  if (!options.skipHistory) {
    scheduleAiHistorySave(data, {
      historyLabel: options.historyLabel,
      immediate: options.immediate,
      showToast: options.showToast,
    });
  }
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
  if (getSelectedIds().length === 0) {
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

  if (!sessionId) {
    ensureSessionReady().then((ok) => {
      if (ok && getSelectedIds().length) schedulePreview();
    });
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
  if (getSelectedIds().length === 0) return;
  if (!(await ensureSessionReady())) {
    isMatching = false;
    showToast('会话未就绪，请稍候或刷新页面');
    renderBoard();
    updateStats();
    return;
  }
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

async function callSelectApi(opts = {}) {
  const selectedIds = getSelectedIds();
  const lockedPairings = opts.fullMatch ? [] : getLockedPairings();
  const matchOnlyCustomerIds = opts.fullMatch ? undefined : getMatchOnlyIds();

  const body = {
    sessionId,
    customerIds: selectedIds,
    commuteMode: 'local',
    lockedPairings: lockedPairings.length ? lockedPairings : undefined,
    matchOnlyCustomerIds: matchOnlyCustomerIds?.length ? matchOnlyCustomerIds : undefined,
  };

  return fetchJsonWithTimeout('/api/dispatch/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 90000);
}
