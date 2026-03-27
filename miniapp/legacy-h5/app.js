const state = {
  currentUserId: 3,
  auth: {
    accessToken: '',
    refreshToken: '',
    user: null,
    accessTokenExpiresAt: 0,
    loginPromise: null,
    refreshPromise: null,
    warnedExpiring: false
  },
  users: [],
  devices: [],
  consumables: [],
  warehouses: [],
  selectedWarehouseId: 1,
  stockAlerts: null,
  borrows: [],
  applications: [],
  approvals: [],
  myApprovals: [],
  aiResponseText: "",
  qrSelectedDeviceId: null,
  qrSelectedConsumableId: null
};

const pageTitles = {
  home: "首页",
  borrow: "设备借用",
  apply: "耗材申领",
  mine: "我的",
  assistant: "AI 助手"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(text, duration = 1800) {
  const toast = document.getElementById("global-toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), duration);
}

function badge(status, lowStock = false) {
  const labels = {
    pending: "待审批",
    approved: "已通过",
    rejected: "已驳回",
    available: "可用",
    borrowed: "借出中",
    cancelled: "已取消",
    returned: "已归还"
  };
  const cls = lowStock ? "low" : status;
  const text = lowStock ? "低库存" : labels[status] || status || "-";
  return `<span class="badge ${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
}

function parseExpireMs(input, fallbackMs = 15 * 60 * 1000) {
  const raw = String(input || '').trim();
  if (!raw) return fallbackMs;
  const m = raw.match(/^(\d+)([smhd])$/i);
  if (!m) {
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num * 1000 : fallbackMs;
  }

  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

function setAuth(authData) {
  state.auth.accessToken = String((authData && authData.accessToken) || '');
  state.auth.refreshToken = String((authData && authData.refreshToken) || '');
  state.auth.user = (authData && authData.user) || null;
  state.auth.accessTokenExpiresAt = Date.now() + parseExpireMs(authData && authData.expiresIn);
  state.auth.warnedExpiring = false;
}

async function ensureLogin() {
  if (state.auth.accessToken) return;
  if (state.auth.loginPromise) {
    await state.auth.loginPromise;
    return;
  }

  state.auth.loginPromise = (async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Source': 'legacy-h5'
      },
      body: JSON.stringify({
        loginType: 'userId',
        userId: state.currentUserId
      })
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0) {
      throw new Error(json.message || '登录失败');
    }
    setAuth(json.data);
  })();

  try {
    await state.auth.loginPromise;
  } finally {
    state.auth.loginPromise = null;
  }
}

async function refreshLogin() {
  if (!state.auth.refreshToken) {
    throw new Error('登录已失效');
  }
  if (state.auth.refreshPromise) {
    await state.auth.refreshPromise;
    return;
  }

  state.auth.refreshPromise = (async () => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Source': 'legacy-h5'
      },
      body: JSON.stringify({ refreshToken: state.auth.refreshToken })
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0) {
      throw new Error(json.message || '刷新登录失败');
    }
    setAuth(json.data);
  })();

  try {
    await state.auth.refreshPromise;
  } finally {
    state.auth.refreshPromise = null;
  }
}

async function api(url, options = {}) {
  await ensureLogin();

  const remainMs = Number(state.auth.accessTokenExpiresAt || 0) - Date.now();
  if (remainMs > 0 && remainMs <= 60_000 && !state.auth.warnedExpiring) {
    state.auth.warnedExpiring = true;
    showToast('登录即将过期，正在自动续期...', 1800);
  }

  const doFetch = () =>
    fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Source': 'legacy-h5',
        Authorization: `Bearer ${state.auth.accessToken}`
      },
      ...options
    });

  let res = await doFetch();
  let json = await res.json();

  if (res.status === 401) {
    await refreshLogin();
    res = await doFetch();
    json = await res.json();
  }

  if (!res.ok || json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data;
}

function getCurrentUser() {
  return state.users.find((item) => item.id === Number(state.currentUserId)) || null;
}

function parseQrParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    deviceToken: params.get("deviceToken"),
    consumableToken: params.get("consumableToken")
  };
}

async function handleQrRedirect() {
  const { deviceToken, consumableToken } = parseQrParams();

  if (deviceToken) {
    const device = await api(`/api/qr/device/${encodeURIComponent(deviceToken)}`);
    state.qrSelectedDeviceId = Number(device.id);
    setPage("borrow");
    showToast(`已通过扫码选择设备：${device.name}`);
    return;
  }

  if (consumableToken) {
    const consumable = await api(
      `/api/qr/consumable/${encodeURIComponent(consumableToken)}?warehouseId=${state.selectedWarehouseId}`
    );
    state.qrSelectedConsumableId = Number(consumable.id);
    setPage("apply");
    showToast(`已通过扫码选择耗材：${consumable.name}`);
  }
}

function setPage(page) {
  document.querySelectorAll('.page').forEach((node) => {
    node.classList.toggle('active', node.dataset.page === page);
  });
  document.querySelectorAll('.tab-item').forEach((node) => {
    node.classList.toggle('active', node.dataset.page === page);
  });
  document.getElementById('page-title').textContent = pageTitles[page] || '首页';
}

function renderUserSelect() {
  const select = document.getElementById('user-select');
  select.innerHTML = state.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`)
    .join('');
  select.value = String(state.currentUserId);
}

function renderHome() {
  const stats = [
    ['设备', state.devices.length],
    ['耗材', state.consumables.length],
    ['我的待办', [...state.borrows, ...state.applications].filter((item) => Number(item.userId) === Number(state.currentUserId) && item.status === 'pending').length]
  ];

  document.getElementById('home-stats').innerHTML = stats
    .map(([label, value]) => `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(value)}</div>
      </div>
    `)
    .join('');

  const todos = [];
  state.borrows.filter((item) => Number(item.userId) === Number(state.currentUserId)).slice(-2).forEach((item) => {
    todos.push({
      title: `借用：${item.deviceName || '设备'}`,
      desc: `${item.borrowDate} ~ ${item.expectedReturnDate}`,
      status: item.status
    });
  });
  state.applications.filter((item) => Number(item.userId) === Number(state.currentUserId)).slice(-2).forEach((item) => {
    todos.push({
      title: `申领：${item.consumableName || '耗材'}`,
      desc: `数量 ${item.quantity} / ${item.purpose || '未填写用途'}`,
      status: item.status
    });
  });

  document.getElementById('todo-list').innerHTML = todos.length
    ? todos.map((item) => `
        <div class="list-card">
          <div class="list-title">${escapeHtml(item.title)}</div>
          <div class="list-desc">${escapeHtml(item.desc)}</div>
          <div class="meta-row"><span>${badge(item.status)}</span></div>
        </div>
      `).join('')
    : '<div class="empty">当前没有待办，去发起一个申请吧</div>';
}

function renderBorrow() {
  const select = document.getElementById('borrow-device');
  select.innerHTML = state.devices.map((device) => `<option value="${device.id}">${escapeHtml(device.name)}（${escapeHtml(device.status)}）</option>`).join('');

  if (state.qrSelectedDeviceId) {
    select.value = String(state.qrSelectedDeviceId);
    state.qrSelectedDeviceId = null;
  }

  const activeBorrows = state.borrows.filter((item) => ['approved', 'borrowed'].includes(String(item.status || '')));

  document.getElementById('device-cards').innerHTML = state.devices.map((device) => {
    const activeBorrow = activeBorrows.find((item) => Number(item.deviceId) === Number(device.id));
    const useInfo = activeBorrow
      ? `当前使用人 ${activeBorrow.borrowerName || activeBorrow.applicantName || '未知'}，预计用到 ${activeBorrow.expectedReturnAt || activeBorrow.expectedReturnDate || '-'}`
      : '当前无人使用';

    return `
      <div class="list-card">
        <div class="list-title">${escapeHtml(device.name)}</div>
        <div class="list-desc">编号 ${escapeHtml(device.code)}  分类 ${escapeHtml(device.category)}</div>
        <div class="list-desc">${escapeHtml(useInfo)}</div>
        <div class="meta-row"><span>${badge(device.status)}</span></div>
      </div>
    `;
  }).join('');
}

function renderApply() {
  const warehouseSelect = document.getElementById('apply-warehouse');
  if (warehouseSelect) {
    warehouseSelect.innerHTML = state.warehouses
      .map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
      .join('');
    warehouseSelect.value = String(state.selectedWarehouseId);
  }

  const select = document.getElementById('apply-consumable');
  select.innerHTML = state.consumables.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');

  if (state.qrSelectedConsumableId) {
    select.value = String(state.qrSelectedConsumableId);
    state.qrSelectedConsumableId = null;
  }

  const currentWarehouse = state.warehouses.find((w) => Number(w.id) === Number(state.selectedWarehouseId));
  document.getElementById('consumable-cards').innerHTML = state.consumables.map((item) => {
    const low = Number(item.stock) <= Number(item.safeStock);
    return `
      <div class="list-card">
        <div class="list-title">${escapeHtml(item.name)}</div>
        ${item.photoDataUrl ? `<img src="${escapeHtml(item.photoDataUrl)}" alt="${escapeHtml(item.name)}" class="consumable-photo" />` : ''}
        <div class="list-desc">仓库 ${escapeHtml(currentWarehouse ? currentWarehouse.name : `#${state.selectedWarehouseId}`)}  分类 ${escapeHtml(item.category)}  库存 ${escapeHtml(item.stock)} ${escapeHtml(item.unit)}  安全库存 ${escapeHtml(item.safeStock)}</div>
        <div class="meta-row"><span>${low ? badge('', true) : '<span class="badge available">库存正常</span>'}</span></div>
      </div>
    `;
  }).join('');
}

function renderMine() {
  const user = getCurrentUser();
  document.getElementById('profile-card').innerHTML = user ? `
    <div class="profile-name">${escapeHtml(user.name)}</div>
    <div class="profile-meta">角色：${escapeHtml(user.role)}<br/>手机号：${escapeHtml(user.phone)}</div>
  ` : '<div class="empty">未找到当前用户</div>';

  const borrowList = state.borrows.filter((item) => Number(item.userId) === Number(state.currentUserId));
  const applicationList = state.applications.filter((item) => Number(item.userId) === Number(state.currentUserId));

  document.getElementById('my-borrows').innerHTML = renderRecordCards(borrowList, (item) => `
    <div class="list-title">${escapeHtml(item.deviceName || '设备借用')}</div>
    <div class="list-desc">${escapeHtml(item.borrowDate)} ~ ${escapeHtml(item.expectedReturnDate)} ${escapeHtml(item.expectedReturnTime || '')}<br/>${escapeHtml(item.purpose || '未填写用途')}</div>
    <div class="meta-row"><span>${badge(item.status)}</span></div>
    ${item.status === 'pending' ? `
      <div class="action-row">
        <button type="button" class="action-btn danger" onclick="window.handleBorrowReturn(${item.id})">归还设备</button>
      </div>
    ` : ''}
  `, '暂无借用记录');

  document.getElementById('my-applications').innerHTML = renderRecordCards(applicationList, (item) => `
    <div class="list-title">${escapeHtml(item.consumableName || '耗材申领')}</div>
    <div class="list-desc">仓库 ${escapeHtml(item.warehouseName || '实验室仓库')} / 数量 ${escapeHtml(item.quantity)}<br/>${escapeHtml(item.purpose || '未填写用途')}</div>
    <div class="meta-row"><span>${badge(item.status)}</span></div>
    ${item.status === 'pending' ? `
      <div class="action-row">
        <button type="button" class="action-btn danger" onclick="window.handleApplicationCancel(${item.id})">取消申领</button>
      </div>
    ` : ''}
  `, '暂无申领记录');

  const myApprovals = (state.myApprovals || []).slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  document.getElementById('my-approval-timeline').innerHTML = renderRecordCards(myApprovals, (item) => {
    const finishedAt = item.updatedAt || item.createdAt || '';
    return `
      <div class="list-title">审批 #${escapeHtml(item.id)} · ${escapeHtml(item.title || item.type || '审批')}</div>
      <div class="list-desc">${escapeHtml(item.description || '')}</div>
      <div class="meta-row"><span>${badge(item.status)}</span><span class="muted">${escapeHtml(finishedAt)}</span></div>
      ${item.remark ? `<div class="list-desc">审批备注：${escapeHtml(item.remark)}</div>` : ''}
    `;
  }, '暂无审批进度记录');

  renderTeacherApprovals();
}

function renderAssistant() {
  const el = document.getElementById("ai-stock-summary");
  const respEl = document.getElementById("ai-response-text");

  if (!el || !respEl) return;

  if (!state.stockAlerts) {
    el.textContent = "等待数据加载...";
  } else {
    const lowNames = state.stockAlerts.low.slice(0, 3).map((i) => i.name).join("、");
    const surplusNames = state.stockAlerts.surplus.slice(0, 3).map((i) => i.name).join("、");
    el.innerHTML = `低库存：${state.stockAlerts.low.length}${lowNames ? `（${lowNames}）` : ""}；库存过多：${state.stockAlerts.surplus.length}${surplusNames ? `（${surplusNames}）` : ""}。`;
  }

  respEl.style.whiteSpace = "pre-wrap";
  respEl.textContent = state.aiResponseText || "输入问题后点击“开始分析”。";
}

function renderRecordCards(list, renderer, emptyText) {
  return list.length ? list.map((item) => `<div class="list-card">${renderer(item)}</div>`).join('') : `<div class="empty">${escapeHtml(emptyText)}</div>`;
}

function isTeacher(user) {
  return !!user && (user.role === 'teacher' || user.role === 'super_admin');
}

function renderTeacherApprovals() {
  const panel = document.getElementById('teacher-approvals-panel');
  const listEl = document.getElementById('teacher-approvals-list');
  if (!panel || !listEl) return;

  const user = getCurrentUser();
  const canApprove = isTeacher(user);
  panel.style.display = canApprove ? 'block' : 'none';
  if (!canApprove) return;

  const approvals = state.approvals || [];
  listEl.innerHTML = approvals.length
    ? approvals.map((item) => `
      <div class="list-card">
        <div class="list-title">审批 #${item.id}（${escapeHtml(item.type)}）</div>
        <div class="list-desc">
          <div>申请人：${escapeHtml(item.applicantName || '-')}</div>
          <div>业务：${escapeHtml(item.title || '-')}</div>
          <div>${escapeHtml(item.description || '')}</div>
        </div>
        <div class="meta-row">
          <span>${badge(item.status)}</span>
          <span>${badge(item.businessStatus)}</span>
        </div>
        ${item.remark ? `<div class="list-desc">审批备注：${escapeHtml(item.remark)}</div>` : ''}
        ${item.status === 'pending' ? `
          <div class="action-row">
            <button type="button" class="action-btn primary" onclick="window.handleTeacherApprovalAction(${item.id}, 'approved')">通过</button>
            <button type="button" class="action-btn danger" onclick="window.handleTeacherApprovalAction(${item.id}, 'rejected')">驳回</button>
          </div>
        ` : ''}
      </div>
    `).join('')
    : '<div class="empty">暂无待处理审批</div>';
}

function renderAll() {
  renderUserSelect();
  renderHome();
  renderBorrow();
  renderApply();
  renderMine();
  renderAssistant();
}

async function refreshData(silent = false) {
  if (!silent) showToast('正在刷新数据...');
  const selectedWarehouseId = Number(state.selectedWarehouseId || 1);
  const currentUserId = Number(state.currentUserId || 0);
  const [users, devices, warehouses, consumables, stockAlerts, borrowsResp, applicationsResp, approvalsResp, myApprovalsResp] = await Promise.all([
    api('/api/users'),
    api('/api/devices'),
    api('/api/warehouses'),
    api(`/api/consumables?warehouseId=${selectedWarehouseId}`),
    api(`/api/consumables/stock-alerts?warehouseId=${selectedWarehouseId}`),
    api('/api/borrows?page=1&pageSize=200'),
    api('/api/consumable-applications?page=1&pageSize=200'),
    api('/api/approvals?status=pending&page=1&pageSize=200'),
    api(`/api/approvals?applicantId=${currentUserId}&page=1&pageSize=200`)
  ]);

  state.users = users;
  state.devices = devices;
  state.warehouses = warehouses;
  if (!state.warehouses.find((w) => Number(w.id) === selectedWarehouseId) && state.warehouses.length) {
    state.selectedWarehouseId = Number(state.warehouses[0].id);
  }
  state.consumables = consumables;
  state.stockAlerts = stockAlerts;
  state.borrows = (borrowsResp && borrowsResp.items) || [];
  state.applications = (applicationsResp && applicationsResp.items) || [];
  state.approvals = (approvalsResp && approvalsResp.items) || [];
  state.myApprovals = (myApprovalsResp && myApprovalsResp.items) || [];
  renderAll();
  if (!silent) showToast('数据已更新');
}

async function handleBorrowSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  await api('/api/borrows', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  event.target.reset();
  showToast('借用申请已提交');
  await refreshData(true);
  setPage('mine');
}

async function handleApplySubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  payload.warehouseId = Number(payload.warehouseId || state.selectedWarehouseId || 1);
  payload.quantity = Number(payload.quantity || 1);
  await api('/api/consumable-applications', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  event.target.reset();
  showToast('申领申请已提交');
  await refreshData(true);
  setPage('mine');
}

async function handleAiAsk() {
  const questionEl = document.getElementById("ai-question");
  if (!questionEl) return;

  const question = String(questionEl.value || "").trim();
  if (!question) {
    showToast("请输入问题后再分析", 2200);
    return;
  }

  showToast("AI 正在分析中...", 2200);
  const result = await api("/api/ai/ask", {
    method: "POST",
    body: JSON.stringify({
      question,
      userId: state.currentUserId,
      warehouseId: state.selectedWarehouseId
    })
  });

  state.aiResponseText = String(result.answer || "");
  renderAssistant();

  const operation = result.operation || {};
  if (operation.handled && operation.success) {
    await refreshData(true);
    setPage("mine");
    showToast("AI 已按你的身份提交申请", 2200);
    return;
  }

  showToast("分析完成", 1800);
}

async function handleBorrowReturn(id) {
  try {
    showToast('正在归还设备...', 1800);
    await api(`/api/borrows/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'returned' })
    });
    showToast('设备已归还');
    await refreshData(true);
  } catch (error) {
    showToast(error.message || '归还设备失败', 2200);
  }
}

async function handleApplicationCancel(id) {
  try {
    showToast('正在取消申领...', 1800);
    await api(`/api/consumable-applications/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' })
    });
    showToast('申领已取消');
    await refreshData(true);
  } catch (error) {
    showToast(error.message || '取消申领失败', 2200);
  }
}

async function handleTeacherApprovalAction(id, status) {
  try {
    const defaultRemark = status === 'approved' ? '同意' : '驳回';
    const remark = window.prompt('请输入审批备注（可留空）', defaultRemark);
    if (remark === null) {
      return;
    }

    showToast('正在处理审批...', 1800);
    await api(`/api/approvals/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ status, remark })
    });
    showToast(status === 'approved' ? '审批已通过' : '审批已驳回');
    await refreshData(true);
  } catch (error) {
    showToast(error.message || '审批处理失败', 2200);
  }
}

window.handleBorrowReturn = handleBorrowReturn;
window.handleApplicationCancel = handleApplicationCancel;
window.handleTeacherApprovalAction = handleTeacherApprovalAction;

function bindEvents() {
  document.querySelectorAll('.tab-item').forEach((button) => {
    button.addEventListener('click', () => setPage(button.dataset.page));
  });

  document.querySelectorAll('.quick-card').forEach((button) => {
    button.addEventListener('click', () => setPage(button.dataset.target));
  });

  document.getElementById('user-select').addEventListener('change', async (event) => {
    state.currentUserId = Number(event.target.value);
    state.auth.accessToken = '';
    state.auth.refreshToken = '';
    state.auth.user = null;
    state.auth.accessTokenExpiresAt = 0;
    state.auth.warnedExpiring = false;
    state.auth.loginPromise = null;
    state.auth.refreshPromise = null;
    state.qrSelectedDeviceId = null;
    state.qrSelectedConsumableId = null;
    state.aiResponseText = '';
    await refreshData(true);
    renderAll();
    showToast('已切换当前用户，登录态与页面状态已重置');
  });

  document.getElementById('device-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await ensureLogin();
      const name = document.getElementById('device-create-name').value.trim();
      const code = document.getElementById('device-create-code').value.trim();
      const category = document.getElementById('device-create-category').value.trim();
      if (!name) { showToast('请输入设备名称'); return; }
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.accessToken}`, 'X-Client-Source': 'legacy-h5' },
        body: JSON.stringify({ name, code: code || undefined, category: category || undefined, status: 'available' })
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) throw new Error(json.message || '新增设备失败');
      document.getElementById('device-create-form').reset();
      await refreshData(true);
      renderAll();
      showToast(`设备「${name}」已添加成功`);
      // 显示二维码
      const deviceId = json.data && json.data.id;
      if (deviceId) {
        const qrResult = document.getElementById('device-qr-result');
        const qrImg = document.getElementById('device-qr-img');
        const qrName = document.getElementById('device-qr-name');
        // 用 fetch+blob 显示二维码图片
        try {
          const qrRes = await fetch(`/api/devices/${deviceId}/qr/export?format=image`, {
            headers: { 'Authorization': `Bearer ${state.auth.accessToken}` }
          });
          if (qrRes.ok) {
            const blob = await qrRes.blob();
            qrImg.src = URL.createObjectURL(blob);
          }
        } catch (_) {}
        qrName.textContent = `${name}${code ? ' · ' + code : ''}`;
        qrResult.classList.remove('hidden');
        document.getElementById('device-qr-print-btn').onclick = () => {
          const win = window.open('', '_blank');
          win.document.write(`<html><head><title>打印二维码 - ${name}</title><style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}img{width:220px;height:220px;}p{margin-top:12px;font-size:16px;font-weight:bold;text-align:center;}</style></head><body><img src="${qrImg.src}" /><p>${name}${code ? ' · ' + code : ''}</p><script>window.onload=()=>window.print()</script></body></html>`);
          win.document.close();
        };
      }
    } catch (err) {
      showToast(err.message || '新增设备失败', 2200);
    }
  });

  document.getElementById('borrow-form').addEventListener('submit', async (event) => {
    try {
      await handleBorrowSubmit(event);
    } catch (error) {
      showToast(error.message || '借用提交失败', 2200);
    }
  });

  document.getElementById('apply-form').addEventListener('submit', async (event) => {
    try {
      await handleApplySubmit(event);
    } catch (error) {
      showToast(error.message || '申领提交失败', 2200);
    }
  });

  const applyWarehouse = document.getElementById('apply-warehouse');
  if (applyWarehouse) {
    applyWarehouse.addEventListener('change', async (event) => {
      state.selectedWarehouseId = Number(event.target.value || 1);
      try {
        await refreshData(true);
        showToast('已切换耗材仓库');
      } catch (error) {
        showToast(error.message || '切换仓库失败', 2200);
      }
    });
  }

  const aiAskBtn = document.getElementById("ai-ask-btn");
  if (aiAskBtn) {
    aiAskBtn.addEventListener("click", async () => {
      try {
        await handleAiAsk();
      } catch (error) {
        showToast(error.message || "AI 分析失败", 2600);
      }
    });
  }
}

bindEvents();
refreshData(true)
  .then(() => handleQrRedirect())
  .catch((error) => showToast(error.message || '初始化失败', 2600));
