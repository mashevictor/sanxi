const files = {};

const uploadBoxes = document.querySelectorAll('.upload-box');
const dispatchBtn = document.getElementById('dispatch-btn');
const errorToast = document.getElementById('error-toast');

uploadBoxes.forEach((box) => {
  const input = box.querySelector('input[type="file"]');
  const field = box.dataset.field;
  const fileNameEl = box.querySelector('.file-name');

  box.addEventListener('click', () => input.click());

  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.style.borderColor = '#2563eb';
  });

  box.addEventListener('dragleave', () => {
    if (!files[field]) box.style.borderColor = '';
  });

  box.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) setFile(field, file, box, fileNameEl);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) setFile(field, input.files[0], box, fileNameEl);
  });
});

function setFile(field, file, box, fileNameEl) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls'].includes(ext)) {
    showError('仅支持 .xlsx / .xls 文件');
    return;
  }
  files[field] = file;
  box.classList.add('has-file');
  fileNameEl.textContent = file.name;
  updateButtonState();
}

function updateButtonState() {
  const hasEmployee = !!files.employees;
  const hasCustomer = !!(files.firstVisit || files.project || files.followUp);
  dispatchBtn.disabled = !(hasEmployee && hasCustomer);

  const empBox = document.querySelector('[data-field="employees"]');
  if (!hasEmployee) {
    empBox.classList.add('required-missing');
  } else {
    empBox.classList.remove('required-missing');
  }
}

dispatchBtn.addEventListener('click', async () => {
  const btnText = dispatchBtn.querySelector('.btn-text');
  const btnLoading = dispatchBtn.querySelector('.btn-loading');

  dispatchBtn.disabled = true;
  btnText.hidden = true;
  btnLoading.hidden = false;

  try {
    const formData = new FormData();
    if (files.employees) formData.append('employees', files.employees);
    if (files.firstVisit) formData.append('firstVisit', files.firstVisit);
    if (files.project) formData.append('project', files.project);
    if (files.followUp) formData.append('followUp', files.followUp);
    formData.append('frontProjectMode', document.getElementById('frontProjectMode').value);
    formData.append('enableDistanceOptimization', document.getElementById('enableDistance').checked);

    const res = await fetch('/api/dispatch', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || '派单失败');
    }

    renderResults(data);
  } catch (err) {
    showToast(err.message);
  } finally {
    dispatchBtn.disabled = false;
    btnText.hidden = false;
    btnLoading.hidden = true;
    updateButtonState();
  }
});

setupTabs();
setupExport();

// 保留本地 showError 别名
function showError(msg) { showToast(msg); }
