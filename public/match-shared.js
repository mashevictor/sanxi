/** 派单看板共享工具 */
const DISPATCH_STORE_KEY = 'dispatch-board-state';
const SAMPLE_DATA_CACHE_URL = '/cache/sample-data.json';

let _sampleDataPrefetch = null;
let _bootstrapPrefetch = null;

function prefetchSampleData() {
  if (!_sampleDataPrefetch) {
    _sampleDataPrefetch = fetch(SAMPLE_DATA_CACHE_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _sampleDataPrefetch;
}

function prefetchBootstrap() {
  if (!_bootstrapPrefetch) {
    _bootstrapPrefetch = fetch('/api/bootstrap')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _bootstrapPrefetch;
}

/** 脚本加载时立即预取静态数据与会话 */
prefetchSampleData();
prefetchBootstrap();

function showPageLoader(message) {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  loader.classList.remove('hide');
  const text = loader.querySelector('.loader-text');
  if (text && message) text.textContent = message;
}

function hidePageLoader() {
  document.getElementById('page-loader')?.classList.add('hide');
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getEmpSlotLabels(emp) {
  if (!emp) return '—';
  const labels = emp.capacityLabels || [];
  if (labels.length) return labels.join('、');
  if (emp.orderCapacity?.length) return emp.orderCapacity.join('、');
  return '—';
}

function renderEmpDepSlots(emp) {
  const dep = emp?.departureAddress || '未填写';
  const slots = getEmpSlotLabels(emp);
  return `<span class="emp-dep-line"><span class="emp-dep">${esc(dep)}</span><span class="emp-slot">${esc(slots)}</span></span>`;
}

function extractFailReason(entry) {
  if (!entry || entry.type !== 'fail') return '匹配失败';
  const u = entry.data || {};
  if (u.nearestAttempt?.failedRules?.length) {
    return u.nearestAttempt.failedRules.map((r) => `${r.rule}不匹配`).join('、');
  }
  const m = (u.reason || '').match(/（([^）]+) 不满足）/);
  if (m) return m[1].split('、').map((x) => `${x.trim()}不匹配`).join('、');
  if ((u.reason || '').includes('时段')) return '时段不匹配';
  return u.reason || '匹配失败';
}

function saveDispatchState(payload) {
  try {
    sessionStorage.setItem(DISPATCH_STORE_KEY, JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch (_) { /* ignore */ }
}

function loadDispatchState() {
  try {
    const raw = sessionStorage.getItem(DISPATCH_STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - (data.savedAt || 0) > 30 * 60 * 1000) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function serializeAssignmentMap(map) {
  return Array.from(map.entries());
}

function deserializeAssignmentMap(entries) {
  const map = new Map();
  if (!entries) return map;
  for (const [k, v] of entries) map.set(Number(k), v);
  return map;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
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

function showEmployeeModal(employeeId, allEmployees) {
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
  const capacity = getEmpSlotLabels(emp);
  const tags = (emp.tags || []).join('、');
  const dep = emp.departureAddress || '未填写';

  title.textContent = emp.name;
  body.innerHTML = `
    <div class="info-row"><span class="k">姓名</span><span class="v">${esc(emp.name)}</span></div>
    <div class="info-row"><span class="k">出发地</span><span class="v">${esc(dep)} <span class="emp-slot" style="margin-left:8px">${esc(capacity)}</span></span></div>
    <div class="info-row"><span class="k">职责</span><span class="v">${esc(roles)}</span></div>
    ${tags ? `<div class="info-row"><span class="k">标签</span><span class="v">${esc(tags)}</span></div>` : ''}
    ${emp.sourceTag ? `<div class="info-row"><span class="k">来源</span><span class="v">${esc(emp.sourceTag)}</span></div>` : ''}
    ${emp.remark ? `<div class="info-row"><span class="k">备注</span><span class="v">${esc(emp.remark)}</span></div>` : ''}
  `;
  modal.hidden = false;
}

/**
 * 首屏加速：静态 JSON 立即渲染 + 并行获取 sessionId
 * @param {{ onCacheReady?: (data: object) => void }} [options]
 */
async function bootstrapIntegratedData(options = {}) {
  const [cached, boot] = await Promise.all([prefetchSampleData(), prefetchBootstrap()]);

  if (cached && typeof options.onCacheReady === 'function') {
    options.onCacheReady(cached);
  }

  if (cached && boot?.sessionId) {
    return { ...cached, sessionId: boot.sessionId };
  }

  const res = await fetch('/api/sample-data');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '加载失败');
  return data;
}
