/** 共享结果渲染与导出 */

let _lastResults = null;

function renderResults(data, containerPrefix = '') {
  _lastResults = data;
  const { stats, byEmployee, results, failedCustomers, pairings, selectedEmployees } = data;

  const statsEl = document.getElementById('stats-grid');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-item"><div class="stat-value">${stats.totalCustomers}</div><div class="stat-label">客户总数</div></div>
      <div class="stat-item success"><div class="stat-value">${stats.assigned}</div><div class="stat-label">成功派单</div></div>
      <div class="stat-item ${stats.failed > 0 ? 'danger' : ''}"><div class="stat-value">${stats.failed}</div><div class="stat-label">未派单</div></div>
      <div class="stat-item"><div class="stat-value">${stats.totalEmployees}</div><div class="stat-label">参与员工</div></div>
      <div class="stat-item"><div class="stat-value">${stats.avgCommute}</div><div class="stat-label">平均通勤(分)</div></div>
      <div class="stat-item"><div class="stat-value">${stats.handInHandGroups}</div><div class="stat-label">牵手单组</div></div>
    `;
  }

  const summaryEl = document.getElementById('pairing-summary');
  if (summaryEl && (pairings || selectedEmployees)) {
    let tags = '';
    if (pairings) {
      tags = pairings.map((p) => `<span class="pairing-tag">${p.parkName} → ${p.employeeName}</span>`).join('');
    } else if (selectedEmployees) {
      const parkTags = (stats.selectedParks || []).map((p) => `<span class="pairing-tag park-tag">${p}</span>`).join('');
      const empTags = selectedEmployees.map((e) => `<span class="pairing-tag emp-tag">${e.name}（服务：${e.serviceParkName}）</span>`).join('');
      tags = `<div class="summary-group"><span class="summary-label">园区：</span>${parkTags}</div>
              <div class="summary-group"><span class="summary-label">员工：</span>${empTags}</div>`;
    }
    summaryEl.innerHTML = `<h4>本次选择</h4><div class="pairing-tags">${tags}</div>`;
    summaryEl.hidden = false;
  } else if (summaryEl) {
    summaryEl.hidden = true;
  }

  const employeeHtml = Object.entries(byEmployee)
    .map(([name, orders]) => `
      <div class="employee-card">
        <div class="employee-header"><span>${name}</span><span>${orders.length} 单</span></div>
        <div class="employee-orders">
          ${orders.map((o) => `
            <div class="order-item">
              <span class="tag ${getTimeSlotClass(o.timeSlot)}">${o.timeSlot}</span>
              <span class="tag ${getTypeClass(o.customerType)}">${o.customerType}</span>
              <span>${o.companyName}</span>
              <span>${o.commuteMinutes ? o.commuteMinutes + '分钟' : ''}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

  const tabEmployee = document.getElementById('tab-by-employee');
  if (tabEmployee) tabEmployee.innerHTML = employeeHtml;

  const tabAll = document.getElementById('tab-all-results');
  if (tabAll) {
    tabAll.innerHTML = `
      <table>
        <thead><tr><th>员工</th><th>时段</th><th>类型</th><th>企业</th><th>园区</th><th>通勤</th></tr></thead>
        <tbody>
          ${results.map((r) => `
            <tr>
              <td>${r.employeeName}</td><td>${r.timeSlot}</td><td>${r.customerType}</td>
              <td>${r.companyName}</td><td>${r.parkName}</td>
              <td>${r.commuteMinutes ? r.commuteMinutes + '分' : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  const failedTab = document.getElementById('failed-tab');
  const tabFailed = document.getElementById('tab-failed');
  if (failedTab && tabFailed) {
    if (failedCustomers.length > 0) {
      failedTab.hidden = false;
      tabFailed.innerHTML = failedCustomers.map((c) => `
        <div class="failed-item">
          <strong>${c.companyName}</strong><br>
          ${c.customerType} · ${c.timeSlot} · ${c.parkName}
          ${c.designatedPerson ? ' · 指定:' + c.designatedPerson : ''}
          ${c.rejectedPerson ? ' · 放弃:' + c.rejectedPerson : ''}
        </div>
      `).join('');
    } else {
      failedTab.hidden = true;
    }
  }

  const resultSection = document.getElementById('result-section');
  if (resultSection) {
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: 'smooth' });
  }
}

function getTimeSlotClass(slot) {
  if (slot === '上午') return 'tag-morning';
  if (slot === '下午1') return 'tag-afternoon1';
  return 'tag-afternoon2';
}

function getTypeClass(type) {
  if (type.includes('首访') || type.includes('前道')) return 'tag-front';
  if (type.includes('项目')) return 'tag-project';
  return 'tag-back';
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById('tab-' + tab.dataset.tab);
      if (content) content.classList.add('active');
    });
  });
}

function setupExport(btnId = 'export-btn') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!_lastResults) return;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: _lastResults.results }),
      });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `派单结果_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message);
    }
  });
}

function showToast(msg) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 4000);
}

function getLastResults() { return _lastResults; }
