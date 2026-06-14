const files = {};
let sessionId = null;
let metadata = null;
const selectedParks = new Set();
const selectedEmployees = new Set();

const parseBtn = document.getElementById('parse-btn');
const dispatchBtn = document.getElementById('dispatch-btn');
const loadDemoBtn = document.getElementById('load-demo-btn');
const loadSampleBtn = document.getElementById('load-sample-btn');

document.querySelectorAll('.upload-box').forEach((box) => {
  const input = box.querySelector('input[type="file"]');
  const field = box.dataset.field;
  const fileNameEl = box.querySelector('.file-name');

  box.addEventListener('click', () => input.click());
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.style.borderColor = '#2563eb'; });
  box.addEventListener('dragleave', () => { if (!files[field]) box.style.borderColor = ''; });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) setFile(field, e.dataTransfer.files[0], box, fileNameEl);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) setFile(field, input.files[0], box, fileNameEl);
  });
});

function setFile(field, file, box, fileNameEl) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls'].includes(ext)) { showToast('仅支持 .xlsx / .xls 文件'); return; }
  files[field] = file;
  box.classList.add('has-file');
  fileNameEl.textContent = file.name;
  updateParseBtn();
}

function updateParseBtn() {
  parseBtn.disabled = !(files.employees && (files.firstVisit || files.project || files.followUp));
}

async function loadData(url, isForm = false) {
  setLoading(parseBtn, true);
  try {
    let res;
    if (isForm) {
      const formData = new FormData();
      if (files.parks) formData.append('parks', files.parks);
      if (files.employees) formData.append('employees', files.employees);
      if (files.firstVisit) formData.append('firstVisit', files.firstVisit);
      if (files.project) formData.append('project', files.project);
      if (files.followUp) formData.append('followUp', files.followUp);
      res = await fetch(url, { method: 'POST', body: formData });
    } else {
      res = await fetch(url);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败');

    sessionId = data.sessionId;
    metadata = data;
    selectedParks.clear();
    selectedEmployees.clear();

    renderParkList(data.parks);
    renderEmployeeList(data.employees);
    document.getElementById('step-select').hidden = false;
    document.getElementById('result-section').hidden = true;
    updateSelectStatus();

    showToast(data.hint || (data.isDemo ? '演示数据加载成功' : data.isSample ? '完整数据加载成功' : '数据解析成功'));
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(parseBtn, false);
  }
}

/** 一键选中全部园区和员工（演示用） */
function autoSelectAll() {
  document.querySelectorAll('#park-list input[data-type="park"]').forEach((cb) => {
    cb.checked = true;
    selectedParks.add(cb.value);
  });
  document.querySelectorAll('#employee-list input[data-type="employee"]').forEach((cb) => {
    cb.checked = true;
    selectedEmployees.add(parseInt(cb.value, 10));
  });
  updateSelectStatus();
}

// 演示数据加载后自动全选
const origLoadData = loadData;
loadData = async function(url, isForm) {
  await origLoadData(url, isForm);
  if (url.includes('demo-data') && metadata) {
    autoSelectAll();
  }
};

parseBtn.addEventListener('click', () => loadData('/api/parse-data', true));
loadDemoBtn.addEventListener('click', () => loadData('/api/demo-data'));
loadSampleBtn.addEventListener('click', () => loadData('/api/sample-data'));

function renderParkList(parks) {
  const list = document.getElementById('park-list');
  list.innerHTML = parks.map((p) => `
    <label class="select-item">
      <input type="checkbox" value="${p.name}" data-type="park">
      <div class="select-item-body">
        <div class="select-item-title">${p.name}</div>
        <div class="select-item-meta">${p.customerCount} 个待派单客户 · ${p.cityName || ''}</div>
        <div class="select-item-sub">${p.address || '（园区地址待补充）'}</div>
        <div class="select-item-sub">
          ${p.firstVisit ? '首访' + p.firstVisit + ' ' : ''}
          ${p.project ? '项目' + p.project + ' ' : ''}
          ${p.followUp ? '回访' + p.followUp : ''}
        </div>
      </div>
    </label>
  `).join('');

  list.querySelectorAll('input[data-type="park"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedParks.add(cb.value);
      else selectedParks.delete(cb.value);
      updateSelectStatus();
    });
  });
}

function renderEmployeeList(employees) {
  const list = document.getElementById('employee-list');
  list.innerHTML = employees.map((e) => `
    <label class="select-item">
      <input type="checkbox" value="${e.id}" data-type="employee">
      <div class="select-item-body">
        <div class="select-item-title">${e.name}</div>
        <div class="select-item-meta">服务园区：${e.serviceParkName || e.parkName || '未设置'} · ${(e.roles || []).join('/')}</div>
        <div class="select-item-sub">出发：${e.departureAddress || ''}</div>
      </div>
    </label>
  `).join('');

  list.querySelectorAll('input[data-type="employee"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.value, 10);
      if (cb.checked) selectedEmployees.add(id);
      else selectedEmployees.delete(id);
      updateSelectStatus();
    });
  });
}

document.getElementById('select-all-parks').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('#park-list input[data-type="park"]');
  const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
  checkboxes.forEach((cb) => {
    cb.checked = !allChecked;
    if (cb.checked) selectedParks.add(cb.value);
    else selectedParks.delete(cb.value);
  });
  updateSelectStatus();
});

document.getElementById('select-all-employees').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('#employee-list input[data-type="employee"]');
  const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
  checkboxes.forEach((cb) => {
    cb.checked = !allChecked;
    const id = parseInt(cb.value, 10);
    if (cb.checked) selectedEmployees.add(id);
    else selectedEmployees.delete(id);
  });
  updateSelectStatus();
});

function updateSelectStatus() {
  const parkCount = selectedParks.size;
  const empCount = selectedEmployees.size;
  const matched = parkCount > 0 && parkCount === empCount;

  document.getElementById('park-count').textContent = parkCount;
  document.getElementById('emp-count').textContent = empCount;

  const statusEl = document.getElementById('pairing-status');
  const hintEl = document.getElementById('pairing-hint');

  if (matched) {
    statusEl.className = 'pairing-status matched';
    statusEl.querySelector('.status-icon').textContent = '✅';
    hintEl.textContent = '园区与员工数量一致，可以派单';
    dispatchBtn.disabled = false;
  } else {
    statusEl.className = 'pairing-status';
    statusEl.querySelector('.status-icon').textContent = '⚠️';
    if (parkCount === 0 && empCount === 0) {
      hintEl.textContent = '请分别选择园区和员工';
    } else if (parkCount > empCount) {
      hintEl.textContent = `还需选择 ${parkCount - empCount} 名员工`;
    } else if (empCount > parkCount) {
      hintEl.textContent = `还需选择 ${empCount - parkCount} 个园区`;
    } else {
      hintEl.textContent = '数量需保持一致';
    }
    dispatchBtn.disabled = true;
  }
}

dispatchBtn.addEventListener('click', async () => {
  if (!sessionId) { showToast('请先加载数据'); return; }

  setLoading(dispatchBtn, true);
  try {
    const res = await fetch('/api/dispatch/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        parkNames: Array.from(selectedParks),
        employeeIds: Array.from(selectedEmployees),
        frontProjectMode: document.getElementById('frontProjectMode').value,
        enableDistanceOptimization: document.getElementById('enableDistance').checked,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '派单失败');

    renderResults(data);
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(dispatchBtn, false);
  }
});

function setLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const load = btn.querySelector('.btn-loading');
  btn.disabled = loading;
  if (text) text.hidden = loading;
  if (load) load.hidden = !loading;
  if (!loading) updateSelectStatus();
}

setupTabs();
setupExport();
