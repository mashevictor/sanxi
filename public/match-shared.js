/** 派单看板共享工具 */
const LEGACY_DISPATCH_STORE_KEY = 'dispatch-board-state';
const DISPATCH_STATE_KEYS = { ai: 'dispatch-ai-state', manual: 'dispatch-manual-state' };
const DISPATCH_HISTORY_KEYS = { ai: 'dispatch-ai-history', manual: 'dispatch-manual-history' };
const MAX_MATCH_HISTORY = 40;
/** 与 integrated-cache.ts INTEGRATED_DATA_VERSION 保持一致，用于静态 JSON 缓存穿透 */
const STATIC_CACHE_BUST = '20260624-manual-pool-71';

function getSampleDataCacheUrl() {
  return `/cache/sample-data.json?v=${STATIC_CACHE_BUST}`;
}

function getFullMatchCacheUrl() {
  return `/cache/full-match.json?v=${STATIC_CACHE_BUST}`;
}

function getManualPoolCacheUrl(kind) {
  return `/cache/manual-pool-${kind}.json?v=${STATIC_CACHE_BUST}`;
}

/** 通勤路线来源标签（公交 / 步行 / 本地） */
function formatCommuteSource(source) {
  if (source === 'walking') return '步行';
  if (source === 'transit') return '公交';
  if (source === 'deepseek') return 'AI';
  return '本地';
}

function isWalkingRoute(route) {
  return route?.source === 'walking' || /^步行/.test(route?.pathSummary || '');
}

let _sampleDataPrefetch = null;
let _bootstrapPrefetch = null;
let _fullMatchPrefetch = null;
const _manualPoolPrefetch = { back: null, front: null };

function resetStaticCachePrefetch() {
  _sampleDataPrefetch = null;
  _fullMatchPrefetch = null;
  _manualPoolPrefetch.back = null;
  _manualPoolPrefetch.front = null;
}

function prefetchSampleData(force = false) {
  if (force) _sampleDataPrefetch = null;
  if (!_sampleDataPrefetch) {
    _sampleDataPrefetch = fetch(getSampleDataCacheUrl())
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _sampleDataPrefetch;
}

function prefetchFullMatchCache(force = false) {
  if (force) _fullMatchPrefetch = null;
  if (!_fullMatchPrefetch) {
    _fullMatchPrefetch = fetch(getFullMatchCacheUrl())
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _fullMatchPrefetch;
}

function prefetchBootstrap() {
  if (!_bootstrapPrefetch) {
    _bootstrapPrefetch = fetch('/api/bootstrap')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _bootstrapPrefetch;
}

function prefetchManualPoolCache(kind, force = false) {
  if (force) _manualPoolPrefetch[kind] = null;
  if (!_manualPoolPrefetch[kind]) {
    _manualPoolPrefetch[kind] = fetch(getManualPoolCacheUrl(kind))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _manualPoolPrefetch[kind];
}

function prefetchAllManualPoolCaches() {
  return Promise.all([prefetchManualPoolCache('back'), prefetchManualPoolCache('front')]);
}

function sameIdSet(a, b) {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  if (sa.length !== sb.length) return false;
  return sa.every((v, i) => v === sb[i]);
}

/** 脚本加载时立即预取静态数据与会话 */
prefetchSampleData();
prefetchBootstrap();
prefetchAllManualPoolCaches();

function showPageLoader(message, subMessage) {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  loader.classList.remove('hide');
  const text = loader.querySelector('.loader-text');
  if (text && message) text.textContent = message;
  const sub = loader.querySelector('.loader-sub');
  if (sub) sub.textContent = subMessage || '正在读取缓存数据';
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

function saveDispatchState(mode, payload) {
  try {
    const key = DISPATCH_STATE_KEYS[mode];
    if (!key) return;
    sessionStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch (_) { /* ignore */ }
}

function loadDispatchState(mode) {
  try {
    migrateLegacyDispatchState();
    const key = DISPATCH_STATE_KEYS[mode];
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - (data.savedAt || 0) > 30 * 60 * 1000) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function migrateLegacyDispatchState() {
  try {
    const legacy = sessionStorage.getItem(LEGACY_DISPATCH_STORE_KEY);
    if (legacy && !sessionStorage.getItem(DISPATCH_STATE_KEYS.ai)) {
      sessionStorage.setItem(DISPATCH_STATE_KEYS.ai, legacy);
    }
  } catch (_) { /* ignore */ }
}

function formatHistoryTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function calcAvgCommute(pairings) {
  const mins = (pairings || []).map((p) => p.commuteMinutes).filter((m) => m > 0);
  return mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0;
}

function buildMatchHistoryEntry(data, options = {}) {
  const pairings = (data.pairings || []).filter((p) => p.eligible !== false);
  const unmatched = data.unmatchedCompanies || [];
  const selected = options.selectedCompanies || [];
  const stats = data.stats || {
    selected: selected.length || pairings.length + unmatched.length,
    matched: pairings.length,
    unmatched: unmatched.length,
    avgCommute: calcAvgCommute(pairings),
  };
  const title = options.title
    || `${stats.matched} 成功 · ${stats.failed ?? stats.unmatched ?? unmatched.length} 失败`;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    title,
    label: options.label || (options.mode === 'manual' ? '手动匹配' : 'AI 匹配'),
    message: data.message || '',
    stats: {
      selected: stats.selected,
      matched: stats.matched ?? pairings.length,
      failed: stats.unmatched ?? stats.failed ?? unmatched.length,
      avgCommute: stats.avgCommute ?? calcAvgCommute(pairings),
    },
    distanceSource: data.distanceSource || '',
    maxCommuteMinutes: data.maxCommuteMinutes || 60,
    selectedCompanies: selected,
    selectedEmployees: options.selectedEmployees || [],
    pairings,
    unmatchedCompanies: unmatched,
    employeeSchedules: data.employeeSchedules || [],
  };
}

function listMatchHistory(mode) {
  try {
    const key = DISPATCH_HISTORY_KEYS[mode];
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function appendMatchHistory(mode, entry) {
  try {
    const key = DISPATCH_HISTORY_KEYS[mode];
    if (!key || !entry) return false;
    const list = listMatchHistory(mode);
    const fp = `${entry.stats?.matched}:${entry.stats?.failed}:${(entry.selectedCompanies || []).join(',')}`;
    if (list[0] && list[0]._fp === fp && Date.now() - list[0].savedAt < 5000) return false;
    entry._fp = fp;
    list.unshift(entry);
    if (list.length > MAX_MATCH_HISTORY) list.length = MAX_MATCH_HISTORY;
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch (_) {
    return false;
  }
}

function deleteMatchHistoryEntry(mode, id) {
  try {
    const key = DISPATCH_HISTORY_KEYS[mode];
    if (!key) return;
    const next = listMatchHistory(mode).filter((e) => e.id !== id);
    localStorage.setItem(key, JSON.stringify(next));
  } catch (_) { /* ignore */ }
}

function clearMatchHistory(mode) {
  try {
    const key = DISPATCH_HISTORY_KEYS[mode];
    if (key) localStorage.removeItem(key);
  } catch (_) { /* ignore */ }
}

function ensureHistoryModalStyles() {
  if (document.getElementById('history-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'history-modal-styles';
  style.textContent = `
    .history-modal-overlay {
      position: fixed; inset: 0; z-index: 10002;
      background: rgba(8,12,24,.72); backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .history-modal-overlay[hidden] { display: none; }
    .history-modal {
      width: min(720px, 96vw); max-height: 82vh; overflow: hidden;
      background: linear-gradient(160deg, #141c30, #0f1524);
      border: 1px solid rgba(99,102,241,.35); border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,.45); display: flex; flex-direction: column;
    }
    .history-modal-hd {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 18px; border-bottom: 1px solid rgba(99,102,241,.2);
    }
    .history-modal-hd h3 { margin: 0; font-size: 1rem; color: #e0e7ff; }
    .history-modal-bd { overflow-y: auto; padding: 12px 14px 16px; flex: 1; }
    .history-item {
      padding: 12px 14px; margin-bottom: 8px; border-radius: 12px;
      border: 1px solid rgba(99,102,241,.22); background: rgba(15,23,42,.55);
    }
    .history-item-hd { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
    .history-item-title { font-weight: 700; font-size: 0.86rem; color: #e0e7ff; }
    .history-item-time { font-size: 0.7rem; color: var(--muted, #94a3b8); white-space: nowrap; }
    .history-item-meta { font-size: 0.72rem; color: #a5b4fc; margin-top: 6px; }
    .history-item-actions { display: flex; gap: 8px; margin-top: 10px; }
    .history-btn {
      padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(99,102,241,.35);
      background: rgba(99,102,241,.12); color: #c4b5fd; font-size: 0.72rem; font-weight: 600; cursor: pointer;
    }
    .history-btn:hover { background: rgba(99,102,241,.25); }
    .history-btn.danger { border-color: rgba(248,113,113,.35); color: #fca5a5; background: rgba(248,113,113,.1); }
    .history-empty { text-align: center; color: var(--muted, #94a3b8); padding: 32px 16px; font-size: 0.86rem; }
  `;
  document.head.appendChild(style);
}

function openMatchHistoryModal(mode, options = {}) {
  ensureHistoryModalStyles();
  let modal = document.getElementById('match-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'match-history-modal';
    modal.className = 'history-modal-overlay';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="history-modal" role="dialog">
        <div class="history-modal-hd">
          <h3 id="history-modal-title">匹配历史</h3>
          <button type="button" class="history-btn" id="history-modal-close">关闭</button>
        </div>
        <div class="history-modal-bd" id="history-modal-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
    modal.querySelector('#history-modal-close').addEventListener('click', () => {
      modal.hidden = true;
    });
  }

  const modeLabel = mode === 'manual' ? '手动派单' : 'AI 匹配';
  modal.querySelector('#history-modal-title').textContent = `${modeLabel} · 匹配历史`;
  const body = modal.querySelector('#history-modal-body');
  const list = listMatchHistory(mode);

  if (!list.length) {
    body.innerHTML = '<div class="history-empty">暂无历史记录<br>完成一次匹配后会自动保存</div>';
  } else {
    body.innerHTML = list.map((entry) => `
      <div class="history-item" data-id="${esc(entry.id)}">
        <div class="history-item-hd">
          <div class="history-item-title">${esc(entry.label || entry.title)}</div>
          <div class="history-item-time">${esc(formatHistoryTime(entry.savedAt))}</div>
        </div>
        <div class="history-item-meta">
          ${entry.stats.matched} 成功 · ${entry.stats.failed} 失败 · 共 ${entry.stats.selected} 家
          ${entry.stats.avgCommute ? ` · 均 ${entry.stats.avgCommute} 分` : ''}
        </div>
        ${entry.message ? `<div class="history-item-meta" style="margin-top:4px;color:#94a3b8">${esc(entry.message)}</div>` : ''}
        <div class="history-item-actions">
          <button type="button" class="history-btn" data-action="restore" data-id="${esc(entry.id)}">恢复查看</button>
          <button type="button" class="history-btn danger" data-action="delete" data-id="${esc(entry.id)}">删除</button>
        </div>
      </div>
    `).join('');

    body.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = list.find((e) => e.id === btn.dataset.id);
        if (entry && typeof options.onRestore === 'function') {
          options.onRestore(entry);
          modal.hidden = true;
        }
      });
    });
    body.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteMatchHistoryEntry(mode, btn.dataset.id);
        openMatchHistoryModal(mode, options);
        showToast('已删除该条历史');
      });
    });
  }

  modal.hidden = false;
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
 * 首屏加速：静态 JSON 立即渲染 + 轻量 bootstrap 仅取 sessionId
 * @param {{ onCacheReady?: (data: object) => void, prefetchFullMatch?: boolean }} [options]
 */
async function bootstrapIntegratedData(options = {}) {
  if (options.prefetchFullMatch !== false) {
    prefetchFullMatchCache();
  }

  const cached = await prefetchSampleData();
  if (cached && typeof options.onCacheReady === 'function') {
    options.onCacheReady(cached);
  }

  let boot = await prefetchBootstrap();
  if (!boot?.sessionId) {
    try {
      boot = await fetchJsonWithTimeout('/api/bootstrap', {}, 15000);
    } catch {
      boot = null;
    }
  }

  if (cached && boot?.sessionId) {
    const serverVersion = boot.dataVersion || cached.dataVersion;
    if (serverVersion && cached.dataVersion && cached.dataVersion !== serverVersion) {
      // 版本不一致：首屏仍用静态缓存 + session，后台拉最新数据不阻塞
      fetchJsonWithTimeout('/api/sample-data', {}, 30000)
        .then((fresh) => {
          if (fresh?.companies?.length) {
            _sampleDataPrefetch = Promise.resolve({
              ...fresh,
              dataVersion: serverVersion,
            });
          }
        })
        .catch(() => {});
      return {
        ...cached,
        sessionId: boot.sessionId,
        dataVersion: serverVersion,
      };
    }
    return {
      ...cached,
      sessionId: boot.sessionId,
      dataVersion: serverVersion,
    };
  }

  const res = await fetchJsonWithTimeout('/api/sample-data', {}, 30000);
  if (!res?.sessionId) throw new Error('服务器未返回会话（请检查 pm2 是否运行）');
  return res;
}

function scheduleRender(fn) {
  if (typeof fn !== 'function') return;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 0);
  }
}

/** 带超时的 fetch JSON，避免匹配请求无限 loading */
async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `请求失败 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查服务器是否正常运行`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
