console.log('Admin app.js loaded - version with login screen');

const state = {
  stats: null,
  auth: {
    accessToken: "",
    refreshToken: "",
    user: null,
    loginType: localStorage.getItem("adminLoginType") || "password",
    account: localStorage.getItem("adminLoginAccount") || "admin",
    password: "",
    ssoProvider: localStorage.getItem("adminLoginSsoProvider") || "feishu",
    ssoSubject: localStorage.getItem("adminLoginSsoSubject") || "admin@lab.local"
  },
  users: [],
  operationLogs: [],
  approvals: [],
  approvalsPagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1
  },
  devices: [],
  consumables: [],
  warehouses: [],
  selectedWarehouseId: 1,
  stockAlerts: null,
  stockMovements: [],
  borrows: [],
  borrowFilters: {
    status: "",
    userId: ""
  },
  borrowPagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1
  },
  applications: [],
  applicationFilters: {
    status: "",
    userId: ""
  },
  applicationPagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1
  },
  qrScanLogs: [],
  qrLogPagination: {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
  },
  qrLogFilters: {
    type: "",
    entityId: ""
  }
};

const sectionMeta = {
  dashboard: {
    title: "数据概览",
    desc: "查看当前待审批、台账和记录概况"
  },
  approvals: {
    title: "审批中心",
    desc: "统一处理借用、申领审批"
  },
  devices: {
    title: "设备台账",
    desc: "查看设备分类、编号与借用状态"
  },
  consumables: {
    title: "耗材台账",
    desc: "查看库存与安全库存预警"
  },
  inventory: {
    title: "库存出入库",
    desc: "进货/出货清单 + 安全库存多/少洞察"
  },
  borrows: {
    title: "借用记录",
    desc: "查看设备借用申请和状态"
  },
  applications: {
    title: "申领记录",
    desc: "查看耗材申领申请和状态"
  },
  qrLogs: {
    title: "扫码日志",
    desc: "查看设备/耗材二维码的扫码审计记录"
  },
  userOps: {
    title: "用户与权限",
    desc: "账号禁用、角色变更与操作日志审计"
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusLabel(status) {
  const map = {
    pending: "待处理",
    approved: "已通过",
    rejected: "已驳回",
    available: "可用",
    borrowed: "借出中",
    enabled: "启用",
    disabled: "禁用"
  };
  return map[status] || status || "-";
}

function badge(status, extraClass) {
  const cls = extraClass || status || "";
  return `<span class="badge ${escapeHtml(cls)}">${escapeHtml(statusLabel(status))}</span>`;
}

function authHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "X-Client-Source": "admin-web"
  };
  if (state.auth.accessToken) {
    headers.Authorization = `Bearer ${state.auth.accessToken}`;
  }
  return headers;
}

function setAuthFromPayload(payload) {
  state.auth.accessToken = String((payload && payload.accessToken) || "");
  state.auth.refreshToken = String((payload && payload.refreshToken) || "");
  state.auth.user = (payload && payload.user) || null;
}

function renderAuthSummary() {
  const el = document.getElementById("auth-summary");
  if (!el) return;

  if (!state.auth.user) {
    const modeText = state.auth.loginType === "sso" ? "SSO" : "账号密码";
    const idText = state.auth.loginType === "sso"
      ? `${state.auth.ssoProvider || "-"} / ${state.auth.ssoSubject || "-"}`
      : state.auth.account || "-";
    el.textContent = `未登录（${modeText}：${idText}）`;
    return;
  }

  const enabledText = state.auth.user.enabled === false ? "已禁用" : "启用";
  el.textContent = `已登录：${state.auth.user.name || "-"} / 角色：${state.auth.user.role || "-"} / 状态：${enabledText}`;
}

function renderUserOpNotices(notices = [], isError = false) {
  const el = document.getElementById("user-op-notices");
  if (!el) return;

  if (!Array.isArray(notices) || notices.length === 0) {
    el.className = "message hidden";
    el.textContent = "";
    return;
  }

  const text = notices.map((item) => item && item.message ? item.message : "").filter(Boolean).join("；");
  if (!text) {
    el.className = "message hidden";
    el.textContent = "";
    return;
  }

  el.className = `message ${isError ? "error" : ""}`.trim();
  el.textContent = text;
}

function renderUsers() {
  renderTable(
    "users-table",
    [
      { title: "ID", key: "id" },
      { title: "姓名", key: "name" },
      { title: "账号", key: "account" },
      {
        title: "SSO",
        render: (row) =>
          row.ssoProvider && row.ssoSubject
            ? `${escapeHtml(row.ssoProvider)} / ${escapeHtml(row.ssoSubject)}`
            : '<span class="muted">-</span>'
      },
      { title: "角色", render: (row) => escapeHtml(row.rawRole || row.role || "-") },
      {
        title: "账号状态",
        render: (row) => badge(row.enabled === false ? "disabled" : "enabled")
      },
      {
        title: "角色更新时间",
        render: (row) => row.roleUpdatedAt ? escapeHtml(row.roleUpdatedAt) : '<span class="muted">-</span>'
      },
      {
        title: "操作",
        render: (row) => {
          const enableAction = row.enabled === false ? "enable" : "disable";
          const enableText = row.enabled === false ? "启用账号" : "禁用账号";
          return `
            <div class="action-group">
              <button class="action-btn" onclick="handleUserEnableToggle(${row.id}, '${enableAction}')">${enableText}</button>
              <button class="action-btn approve" onclick="handleUserRoleChange(${row.id}, '${escapeHtml(row.rawRole || row.role || "student")}')">变更角色</button>
            </div>
          `;
        }
      }
    ],
    state.users,
    "暂无用户数据"
  );
}

function renderOperationLogs() {
  renderTable(
    "operation-logs-table",
    [
      { title: "日志ID", key: "id" },
      { title: "类型", key: "type" },
      {
        title: "目标用户",
        render: (row) => `${escapeHtml(row.targetUserName || "-")} (#${escapeHtml(row.targetUserId || "-")})`
      },
      {
        title: "变更详情",
        render: (row) => {
          const roleText = row.beforeRole || row.afterRole
            ? `角色：${escapeHtml(row.beforeRole || "-")} -> ${escapeHtml(row.afterRole || "-")}`
            : '<span class="muted">角色无变化</span>';
          const enabledText = typeof row.beforeEnabled === "boolean" || typeof row.afterEnabled === "boolean"
            ? `状态：${statusLabel(row.beforeEnabled === false ? "disabled" : "enabled")} -> ${statusLabel(row.afterEnabled === false ? "disabled" : "enabled")}`
            : '<span class="muted">状态无变化</span>';
          return `<div>${roleText}</div><div class="muted">${enabledText}</div>`;
        }
      },
      { title: "说明", key: "message" },
      {
        title: "操作人",
        render: (row) => `${escapeHtml(row.operatorName || "-")} (${escapeHtml(row.operatorRole || "-")})`
      },
      { title: "时间", key: "createdAt" }
    ],
    state.operationLogs,
    "暂无操作日志"
  );
}

async function loadUserOps() {
  const [users, logsResp] = await Promise.all([
    apiRequest("/api/users"),
    apiRequest("/api/users/operation-logs?page=1&pageSize=20")
  ]);
  state.users = users || [];
  state.operationLogs = (logsResp && logsResp.items) || [];
  renderUsers();
  renderOperationLogs();
}

async function loginAdmin() {
  const payload = state.auth.loginType === "sso"
    ? {
        loginType: "sso",
        ssoProvider: state.auth.ssoProvider,
        ssoSubject: state.auth.ssoSubject
      }
    : {
        loginType: "password",
        account: state.auth.account,
        password: state.auth.password
      };

  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Source": "admin-web"
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok || json.code !== 0 || !json.data) {
    const notices = json && json.data && Array.isArray(json.data.notices) ? json.data.notices : [];
    if (notices.length > 0) {
      renderUserOpNotices(notices, true);
    }
    throw new Error(json.message || "管理员登录失败");
  }

  const role = String((json.data.user && json.data.user.role) || "");
  const enabled = json.data.user && json.data.user.enabled !== false;
  const notices = Array.isArray(json.data.notices) ? json.data.notices : [];
  if (!enabled) {
    throw new Error("当前账号已禁用");
  }
  if (!["admin", "teacher"].includes(role)) {
    throw new Error("当前账号无管理端访问权限");
  }

  if (notices.some((item) => item && item.type === "ACCOUNT_DISABLED")) {
    throw new Error("账号已禁用，请联系管理员");
  }
  if (notices.some((item) => item && item.type === "ROLE_CHANGED")) {
    setMessage("提示：检测到角色变更，已按最新角色登录");
  }

  setAuthFromPayload(json.data);
  renderAuthSummary();
}

let _refreshPromise = null;
async function refreshAdminToken() {
  if (_refreshPromise) return _refreshPromise;
  if (!state.auth.refreshToken) {
    throw new Error("refreshToken 缺失，请重新登录");
  }
  _refreshPromise = _doRefreshAdminToken().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}
async function _doRefreshAdminToken() {
  if (!state.auth.refreshToken) {
    throw new Error("refreshToken 缺失，请重新登录");
  }

  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Source": "admin-web"
    },
    body: JSON.stringify({ refreshToken: state.auth.refreshToken })
  });

  const json = await response.json();
  if (!response.ok || json.code !== 0 || !json.data) {
    const notices = json && json.data && Array.isArray(json.data.notices) ? json.data.notices : [];
    if (notices.length > 0) {
      renderUserOpNotices(notices, true);
    }
    const hasRoleChanged = notices.some((n) => n && n.type === 'ROLE_CHANGED');
    const hasDisabled = notices.some((n) => n && n.type === 'ACCOUNT_DISABLED');
    if (hasRoleChanged) {
      setMessage('角色已变更，请重新登录', true);
      state.auth.accessToken = '';
      state.auth.refreshToken = '';
      state.auth.user = null;
      renderAuthSummary();
      showLoginScreen();
      throw new Error('角色已变更，请重新登录');
    }
    if (hasDisabled) {
      setMessage('账号已禁用，请联系管理员', true);
      state.auth.accessToken = '';
      state.auth.refreshToken = '';
      state.auth.user = null;
      renderAuthSummary();
      showLoginScreen();
      throw new Error('账号已禁用');
    }
    throw new Error(json.message || '刷新登录态失败');
  }

  setAuthFromPayload(json.data);
  renderAuthSummary();
}

async function apiRequest(url, options = {}) {
  const doFetch = async () =>
    fetch(url, {
      headers: authHeaders(),
      ...options
    });

  let response = await doFetch();
  let json = await response.json();

  if (response.status === 401) {
    const notices = json && json.data && Array.isArray(json.data.notices) ? json.data.notices : [];
    if (notices.length > 0) {
      renderUserOpNotices(notices, true);
    }

    await refreshAdminToken();
    response = await doFetch();
    json = await response.json();
  }

  if (!response.ok || json.code !== 0) {
    const notices = json && json.data && Array.isArray(json.data.notices) ? json.data.notices : [];
    if (notices.length > 0) {
      renderUserOpNotices(notices, true);
    }
    throw new Error(json.message || "请求失败");
  }

  return json.data;
}

function setMessage(text, isError = false) {
  const el = document.getElementById("global-message");
  if (!el) return;
  if (!text) {
    el.className = "message hidden";
    el.textContent = "";
    return;
  }
  el.className = `message ${isError ? "error" : ""}`.trim();
  el.textContent = text;
}

function renderStats() {
  const container = document.getElementById("stats-cards");
  if (!container) return;
  const stats = state.stats;
  if (!stats) {
    container.innerHTML = "";
    return;
  }

  const cards = [
    ["待审批", stats.pendingApprovals],
    ["设备数量", stats.devicesCount],
    ["耗材数量", stats.consumablesCount],
    ["借用记录", stats.borrowsCount],
    ["低库存预警", stats.lowStockCount]
  ];

  container.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="stat-card">
          <div class="stat-label">${escapeHtml(label)}</div>
          <div class="stat-value">${escapeHtml(value)}</div>
        </div>
      `
    )
    .join("");
}

function renderTable(containerId, columns, rows, emptyText = "暂无数据") {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  const header = columns
    .map((col) => `<th>${escapeHtml(col.title)}</th>`)
    .join("");

  const body = rows
    .map(
      (row) => `
        <tr>
          ${columns
            .map((col) => `<td>${col.render ? col.render(row) : escapeHtml(row[col.key])}</td>`)
            .join("")}
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>${header}</tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>
  `;
}

function renderPaginationBar(prefix, pagination) {
  const infoEl = document.getElementById(`${prefix}-page-info`);
  const prevBtn = document.getElementById(`${prefix}-prev-btn`);
  const nextBtn = document.getElementById(`${prefix}-next-btn`);

  if (infoEl) {
    infoEl.textContent = `第 ${pagination.page} / ${pagination.totalPages} 页，共 ${pagination.total} 条`;
  }
  if (prevBtn) {
    prevBtn.disabled = pagination.page <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = pagination.page >= pagination.totalPages;
  }
}

function renderApprovals() {
  renderTable(
    "approvals-table",
    [
      { title: "审批ID", key: "id" },
      { title: "申请人", key: "applicantName" },
      { title: "类型", render: (row) => escapeHtml(row.type) },
      {
        title: "业务内容",
        render: (row) => `<div>${escapeHtml(row.title)}</div><div class="muted">${escapeHtml(row.description)}</div>`
      },
      { title: "审批状态", render: (row) => badge(row.status) },
      { title: "业务状态", render: (row) => badge(row.businessStatus) },
      {
        title: "审批备注",
        render: (row) => (row.remark ? escapeHtml(row.remark) : '<span class="muted">-</span>')
      },
      {
        title: "操作",
        render: (row) => {
          if (row.status !== "pending") {
            return '<span class="muted">已处理</span>';
          }
          return `
            <div class="action-group">
              <button class="action-btn approve" onclick="handleApprovalAction(${row.id}, 'approved')">通过</button>
              <button class="action-btn reject" onclick="handleApprovalAction(${row.id}, 'rejected')">驳回</button>
            </div>
          `;
        }
      }
    ],
    state.approvals,
    "暂无待审批或审批记录"
  );

  renderPaginationBar("approvals", state.approvalsPagination);
}

function renderLedgers() {
  const borrowStatusFilterEl = document.getElementById("borrow-status-filter");
  const borrowUserFilterEl = document.getElementById("borrow-user-filter");
  const appStatusFilterEl = document.getElementById("application-status-filter");
  const appUserFilterEl = document.getElementById("application-user-filter");

  if (borrowStatusFilterEl) {
    borrowStatusFilterEl.value = state.borrowFilters.status || "";
  }
  if (borrowUserFilterEl) {
    borrowUserFilterEl.value = state.borrowFilters.userId || "";
  }
  if (appStatusFilterEl) {
    appStatusFilterEl.value = state.applicationFilters.status || "";
  }
  if (appUserFilterEl) {
    appUserFilterEl.value = state.applicationFilters.userId || "";
  }

  renderTable(
    "devices-table",
    [
      { title: "ID", key: "id" },
      { title: "设备名称", key: "name" },
      { title: "编号", key: "code" },
      { title: "分类", key: "category" },
      { title: "状态", render: (row) => badge(row.status) },
      {
        title: "二维码链接",
        render: (row) => {
          if (!row.qrToken || row.qrEnabled === false) {
            return '<span class="muted">不可用</span>';
          }
          const qrUrl = `${window.location.origin}/miniapp/?deviceToken=${encodeURIComponent(row.qrToken)}`;
          return `<a href="${escapeHtml(qrUrl)}" target="_blank" rel="noopener noreferrer">打开</a>`;
        }
      },
      {
        title: "二维码管理",
        render: (row) => `
          <div class="action-group">
            <button class="action-btn approve" onclick="handleDeviceQrAction(${row.id}, 'reset')">重置</button>
            <button class="action-btn" onclick="handleDeviceQrAction(${row.id}, '${row.qrEnabled === false ? "enable" : "disable"}')">${row.qrEnabled === false ? "启用" : "禁用"}</button>
            <button class="action-btn" onclick="handleDeviceQrExport(${row.id}, 'pdf')">导出PDF</button>
            <button class="action-btn" onclick="handleDeviceQrExport(${row.id}, 'image')">保存图片</button>
          </div>
        `
      }
    ],
    state.devices,
    "暂无设备数据"
  );

  renderTable(
    "consumables-table",
    [
      { title: "ID", key: "id" },
      {
        title: "照片",
        render: (row) =>
          row.photoDataUrl
            ? `<img src="${escapeHtml(row.photoDataUrl)}" alt="${escapeHtml(row.name || "耗材")}" class="thumb" />`
            : '<span class="muted">未上传</span>'
      },
      { title: "耗材名称", key: "name" },
      { title: "分类", key: "category" },
      { title: "单位", key: "unit" },
      { title: "当前库存", key: "stock" },
      { title: "安全库存", key: "safeStock" },
      {
        title: "库存预警",
        render: (row) =>
          Number(row.stock) <= Number(row.safeStock)
            ? '<span class="badge low">低库存</span>'
            : '<span class="muted">正常</span>'
      },
      {
        title: "二维码链接",
        render: (row) => {
          if (!row.qrToken || row.qrEnabled === false) {
            return '<span class="muted">不可用</span>';
          }
          const qrUrl = `${window.location.origin}/miniapp/?consumableToken=${encodeURIComponent(row.qrToken)}`;
          return `<a href="${escapeHtml(qrUrl)}" target="_blank" rel="noopener noreferrer">打开</a>`;
        }
      },
      {
        title: "二维码管理",
        render: (row) => `
          <div class="action-group">
            <button class="action-btn approve" onclick="handleConsumableQrAction(${row.id}, 'reset')">重置</button>
            <button class="action-btn" onclick="handleConsumableQrAction(${row.id}, '${row.qrEnabled === false ? "enable" : "disable"}')">${row.qrEnabled === false ? "启用" : "禁用"}</button>
            <button class="action-btn" onclick="handleConsumablePhotoUpload(${row.id})">更新照片</button>
            <button class="action-btn" onclick="handleConsumableQrExport(${row.id}, 'pdf')">导出PDF</button>
            <button class="action-btn" onclick="handleConsumableQrExport(${row.id}, 'image')">保存图片</button>
          </div>
        `
      }
    ],
    state.consumables,
    "暂无耗材数据"
  );

  renderTable(
    "borrows-table",
    [
      { title: "ID", key: "id" },
      { title: "申请人", key: "applicantName" },
      { title: "设备", key: "deviceName" },
      {
        title: "借用周期",
        render: (row) => `${escapeHtml(row.borrowDate)} ~ ${escapeHtml(row.expectedReturnDate)}`
      },
      { title: "用途", key: "purpose" },
      { title: "状态", render: (row) => badge(row.status) }
    ],
    state.borrows,
    "暂无借用记录"
  );

  renderTable(
    "applications-table",
    [
      { title: "ID", key: "id" },
      { title: "申请人", key: "applicantName" },
      { title: "耗材", key: "consumableName" },
      { title: "数量", key: "quantity" },
      { title: "用途", key: "purpose" },
      { title: "状态", render: (row) => badge(row.status) }
    ],
    state.applications,
    "暂无申领记录"
  );

  renderPaginationBar("borrows", state.borrowPagination);
  renderPaginationBar("applications", state.applicationPagination);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  const escaped = text.replaceAll("\"", "\"\"");
  return `"${escaped}"`;
}

async function exportQrLogsCsv() {
  const query = new URLSearchParams();
  if (state.qrLogFilters.type) {
    query.set("type", state.qrLogFilters.type);
  }
  if (state.qrLogFilters.entityId) {
    query.set("entityId", state.qrLogFilters.entityId);
  }
  query.set("all", "1");

  const url = `/api/qr-scan-logs?${query.toString()}`;
  const resp = await apiRequest(url);
  const rows = (resp && resp.items) || [];

  const headers = ["ID", "类型", "对象", "对象ID", "Token", "扫码人", "IP", "时间"];

  const csvLines = [
    headers.map((h) => toCsvCell(h)).join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.type,
        row.entityName,
        row.entityId,
        row.token,
        row.userName,
        row.ip,
        row.createdAt
      ]
        .map((cell) => toCsvCell(cell))
        .join(",")
    )
  ];

  const blob = new Blob([`\ufeff${csvLines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const blobUrl = URL.createObjectURL(blob);

  const typePart = state.qrLogFilters.type ? state.qrLogFilters.type : "all-type";
  const entityPart = state.qrLogFilters.entityId ? `entity-${state.qrLogFilters.entityId}` : "all-entity";
  const timePart = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const filename = `qr-scan-logs-${typePart}-${entityPart}-${timePart}.csv`;

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function renderQrLogs() {
  const typeSelect = document.getElementById("qr-log-type-filter");
  const entityInput = document.getElementById("qr-log-entity-id-filter");

  if (typeSelect) {
    typeSelect.value = state.qrLogFilters.type || "";
  }
  if (entityInput) {
    entityInput.value = state.qrLogFilters.entityId || "";
  }

  const summaryEl = document.getElementById("qr-log-filter-summary");
  if (summaryEl) {
    const typeLabel = state.qrLogFilters.type
      ? state.qrLogFilters.type === "device"
        ? "设备"
        : state.qrLogFilters.type === "consumable"
          ? "耗材"
          : state.qrLogFilters.type
      : "全部";
    const entityLabel = state.qrLogFilters.entityId ? `对象ID=${state.qrLogFilters.entityId}` : "全部对象";
    summaryEl.textContent = `当前筛选：类型=${typeLabel}；${entityLabel}`;
  }

  renderTable(
    "qr-logs-table",
    [
      { title: "ID", key: "id" },
      { title: "类型", key: "type" },
      { title: "对象", key: "entityName" },
      { title: "对象ID", key: "entityId" },
      { title: "Token", key: "token" },
      { title: "扫码人", key: "userName" },
      { title: "IP", key: "ip" },
      { title: "时间", key: "createdAt" }
    ],
    state.qrScanLogs,
    "暂无扫码日志"
  );

  const pageInfo = document.getElementById("qr-log-page-info");
  if (pageInfo) {
    pageInfo.textContent = `第 ${state.qrLogPagination.page} / ${state.qrLogPagination.totalPages} 页，共 ${state.qrLogPagination.total} 条`;
  }

  const prevBtn = document.getElementById("qr-log-prev-btn");
  const nextBtn = document.getElementById("qr-log-next-btn");
  if (prevBtn) {
    prevBtn.disabled = state.qrLogPagination.page <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = state.qrLogPagination.page >= state.qrLogPagination.totalPages;
  }
}

function renderInventory() {
  const alerts = state.stockAlerts || { low: [], surplus: [], normal: [] };
  const currentWarehouse =
    state.warehouses.find((w) => Number(w.id) === Number(state.selectedWarehouseId)) || null;

  const summaryEl = document.getElementById("stock-summary");
  if (summaryEl) {
    const widName = currentWarehouse ? currentWarehouse.name : `仓库#${state.selectedWarehouseId}`;
    summaryEl.textContent = `当前仓库：${widName}；当前耗材：共 ${
      alerts.low.length + alerts.surplus.length + alerts.normal.length
    } 项；低库存 ${alerts.low.length} 项；库存过多 ${alerts.surplus.length} 项；正常区间 ${
      alerts.normal.length
    } 项。`;
  }

  const warehouseSelect = document.getElementById("inventory-warehouse");
  if (warehouseSelect) {
    warehouseSelect.innerHTML = state.warehouses
      .map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
      .join("");
    warehouseSelect.value = String(state.selectedWarehouseId);
  }

  renderTable(
    "stock-low-table",
    [
      { title: "ID", key: "id" },
      { title: "耗材名称", key: "name" },
      { title: "库存", key: "stock" },
      { title: "安全库存", key: "safeStock" },
      { title: "缺口", render: (row) => `${row.needToSafeStock}` }
    ],
    alerts.low,
    "暂无低库存耗材"
  );

  renderTable(
    "stock-surplus-table",
    [
      { title: "ID", key: "id" },
      { title: "耗材名称", key: "name" },
      { title: "库存", key: "stock" },
      { title: "安全库存", key: "safeStock" },
      { title: "富余", render: (row) => `${row.surplusOverSafeStock}` }
    ],
    alerts.surplus,
    "暂无库存过多耗材"
  );

  renderTable(
    "movements-table",
    [
      { title: "ID", key: "id" },
      {
        title: "类型",
        render: (row) =>
          row.type === "in"
            ? '<span class="badge available">进货</span>'
            : row.type === "out"
              ? '<span class="badge low">出货</span>'
              : '<span class="muted">-</span>'
      },
      { title: "耗材", key: "consumableName" },
      { title: "数量", key: "quantity" },
      { title: "备注", key: "note" },
      { title: "操作人", key: "operatorName" },
      { title: "时间", key: "createdAt" }
    ],
    state.stockMovements,
    "暂无出入库记录"
  );

  // 填充出入库表单耗材下拉
  const select = document.getElementById("movement-consumable");
  if (select) {
    select.innerHTML = state.consumables
      .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
      .join("");
  }
}

async function loadAll() {
  setMessage("正在刷新后台数据...");
  try {
    if (!state.auth.accessToken) {
      await loginAdmin();
    }
    const selectedWarehouseId = state.selectedWarehouseId || 1;
    const qrQuery = new URLSearchParams();
    if (state.qrLogFilters.type) {
      qrQuery.set("type", state.qrLogFilters.type);
    }
    if (state.qrLogFilters.entityId) {
      qrQuery.set("entityId", state.qrLogFilters.entityId);
    }
    qrQuery.set("page", String(state.qrLogPagination.page || 1));
    qrQuery.set("pageSize", String(state.qrLogPagination.pageSize || 20));
    const qrLogsUrl = `/api/qr-scan-logs${qrQuery.toString() ? `?${qrQuery.toString()}` : ""}`;

    const approvalQuery = new URLSearchParams({
      page: String(state.approvalsPagination.page || 1),
      pageSize: String(state.approvalsPagination.pageSize || 10)
    });

    const borrowQuery = new URLSearchParams({
      page: String(state.borrowPagination.page || 1),
      pageSize: String(state.borrowPagination.pageSize || 10)
    });
    if (state.borrowFilters.status) {
      borrowQuery.set("status", state.borrowFilters.status);
    }
    if (state.borrowFilters.userId) {
      borrowQuery.set("userId", state.borrowFilters.userId);
    }

    const appQuery = new URLSearchParams({
      page: String(state.applicationPagination.page || 1),
      pageSize: String(state.applicationPagination.pageSize || 10)
    });
    if (state.applicationFilters.status) {
      appQuery.set("status", state.applicationFilters.status);
    }
    if (state.applicationFilters.userId) {
      appQuery.set("userId", state.applicationFilters.userId);
    }

    const canViewUserOps = state.auth.user && state.auth.user.role === "admin";
    const [
      stats,
      approvalsResp,
      devices,
      consumables,
      warehouses,
      borrowsResp,
      applicationsResp,
      stockAlerts,
      stockMovements,
      qrLogsResp,
      users,
      operationLogsResp
    ] = await Promise.all([
      apiRequest("/api/dashboard/stats"),
      apiRequest(`/api/approvals?${approvalQuery.toString()}`),
      apiRequest("/api/devices"),
      apiRequest("/api/consumables"),
      apiRequest("/api/warehouses"),
      apiRequest(`/api/borrows?${borrowQuery.toString()}`),
      apiRequest(`/api/consumable-applications?${appQuery.toString()}`),
      apiRequest(`/api/consumables/stock-alerts?warehouseId=${selectedWarehouseId}`),
      apiRequest(`/api/stock-movements?warehouseId=${selectedWarehouseId}`),
      apiRequest(qrLogsUrl),
      canViewUserOps ? apiRequest("/api/users") : Promise.resolve([]),
      canViewUserOps
        ? apiRequest("/api/users/operation-logs?page=1&pageSize=20")
        : Promise.resolve({ items: [] })
    ]);

    state.stats = stats;
    state.approvals = (approvalsResp && approvalsResp.items) || [];
    state.approvalsPagination.total = Number((approvalsResp && approvalsResp.total) || 0);
    state.approvalsPagination.page = Number((approvalsResp && approvalsResp.page) || state.approvalsPagination.page || 1);
    state.approvalsPagination.pageSize = Number((approvalsResp && approvalsResp.pageSize) || state.approvalsPagination.pageSize || 10);
    state.approvalsPagination.totalPages = Number((approvalsResp && approvalsResp.totalPages) || 1);
    state.devices = devices;
    state.consumables = consumables;
    state.warehouses = warehouses;
    state.selectedWarehouseId = selectedWarehouseId;
    state.stockAlerts = stockAlerts;
    state.stockMovements = stockMovements;
    state.borrows = (borrowsResp && borrowsResp.items) || [];
    state.borrowPagination.total = Number((borrowsResp && borrowsResp.total) || 0);
    state.borrowPagination.page = Number((borrowsResp && borrowsResp.page) || state.borrowPagination.page || 1);
    state.borrowPagination.pageSize = Number((borrowsResp && borrowsResp.pageSize) || state.borrowPagination.pageSize || 10);
    state.borrowPagination.totalPages = Number((borrowsResp && borrowsResp.totalPages) || 1);
    state.applications = (applicationsResp && applicationsResp.items) || [];
    state.applicationPagination.total = Number((applicationsResp && applicationsResp.total) || 0);
    state.applicationPagination.page = Number((applicationsResp && applicationsResp.page) || state.applicationPagination.page || 1);
    state.applicationPagination.pageSize = Number((applicationsResp && applicationsResp.pageSize) || state.applicationPagination.pageSize || 10);
    state.applicationPagination.totalPages = Number((applicationsResp && applicationsResp.totalPages) || 1);
    state.qrScanLogs = (qrLogsResp && qrLogsResp.items) || [];
    state.qrLogPagination.total = Number((qrLogsResp && qrLogsResp.total) || 0);
    state.qrLogPagination.page = Number((qrLogsResp && qrLogsResp.page) || state.qrLogPagination.page || 1);
    state.qrLogPagination.pageSize = Number((qrLogsResp && qrLogsResp.pageSize) || state.qrLogPagination.pageSize || 20);
    state.qrLogPagination.totalPages = Number((qrLogsResp && qrLogsResp.totalPages) || 1);
    state.users = users || [];
    state.operationLogs = (operationLogsResp && operationLogsResp.items) || [];

    const userOpsMenu = document.querySelector('.menu-item[data-section="userOps"]');
    if (userOpsMenu) {
      userOpsMenu.style.display = canViewUserOps ? "" : "none";
    }
    const userOpsSection = document.querySelector('.section[data-name="userOps"]');
    if (userOpsSection) {
      userOpsSection.style.display = canViewUserOps ? "" : "none";
    }

    renderStats();
    renderApprovals();
    renderLedgers();
    renderInventory();
    renderQrLogs();
    renderUsers();
    renderOperationLogs();
    setMessage("后台数据已刷新");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    if (!/角色已变更|账号已禁用|refreshToken/.test(error.message || '')) {
      setMessage(error.message || "加载失败", true);
    }
  }
}

async function handleMovementSubmit(event) {
  event.preventDefault();
  try {
    setMessage("正在提交库存操作...");

    const type = document.getElementById("movement-type").value;
    const consumableId = document.getElementById("movement-consumable").value;
    const quantity = Number(document.getElementById("movement-quantity").value);
    const note = document.getElementById("movement-note").value;
    const warehouseId = Number(document.getElementById("inventory-warehouse").value);

    await apiRequest("/api/stock-movements", {
      method: "POST",
      body: JSON.stringify({
        type,
        consumableId: Number(consumableId),
        quantity,
        note,
        warehouseId,
        // MVP：未接真实登录，默认用系统管理员来记账
        userId: 1
      })
    });

    await loadAll();
    setMessage("库存操作已提交并刷新完成");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "库存操作失败", true);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxEdge = 1200;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("图片压缩失败"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const type = String(file.type || "").toLowerCase();
        const outputType = type === "image/png" ? "image/png" : "image/jpeg";
        const quality = outputType === "image/jpeg" ? 0.82 : undefined;
        const compressed = quality ? canvas.toDataURL(outputType, quality) : canvas.toDataURL(outputType);
        resolve(compressed);
      };
      img.onerror = () => reject(new Error("读取图片失败"));
      img.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function handleConsumableCreateSubmit(event) {
  event.preventDefault();
  try {
    setMessage("正在创建耗材...");

    const name = document.getElementById("consumable-create-name").value.trim();
    const category = document.getElementById("consumable-create-category").value.trim();
    const unit = document.getElementById("consumable-create-unit").value.trim() || "个";
    const stock = Number(document.getElementById("consumable-create-stock").value || 0);
    const safeStock = Number(document.getElementById("consumable-create-safe-stock").value || 0);
    const photoInput = document.getElementById("consumable-create-photo");

    let photoDataUrl = "";
    if (photoInput && photoInput.files && photoInput.files[0]) {
      photoDataUrl = await readFileAsDataUrl(photoInput.files[0]);
    }

    await apiRequest("/api/consumables", {
      method: "POST",
      body: JSON.stringify({
        name,
        category,
        unit,
        stock,
        safeStock,
        warehouseId: state.selectedWarehouseId || 1,
        photoDataUrl
      })
    });

    const form = document.getElementById("consumable-create-form");
    if (form) form.reset();

    await loadAll();
    setMessage("耗材已创建，二维码已自动绑定");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "新增耗材失败", true);
  }
}

async function handleDeviceCreateSubmit(event) {
  event.preventDefault();
  try {
    setMessage("正在创建设备...");

    const name = document.getElementById("device-create-name").value.trim();
    const code = document.getElementById("device-create-code").value.trim();
    const category = document.getElementById("device-create-category").value.trim();
    const status = document.getElementById("device-create-status").value;

    await apiRequest("/api/devices", {
      method: "POST",
      body: JSON.stringify({
        name,
        code,
        category,
        status
      })
    });

    const form = document.getElementById("device-create-form");
    if (form) form.reset();

    await loadAll();
    setMessage("设备已创建，二维码已自动绑定");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "新增设备失败", true);
  }
}

function triggerFileDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) {
    a.download = filename;
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function handleDeviceQrExport(id, format) {
  const query = format === "image" ? "format=image" : "format=pdf";
  const ext = format === "image" ? "png" : "pdf";
  triggerFileDownload(`/api/devices/${id}/qr/export?${query}`, `device-qr-${id}.${ext}`);
  setMessage(`设备二维码${format === "image" ? "图片" : "PDF"}导出中`);
  setTimeout(() => setMessage(""), 1800);
}

function handleConsumableQrExport(id, format) {
  const query = new URLSearchParams();
  query.set("warehouseId", String(state.selectedWarehouseId || 1));
  query.set("format", format === "image" ? "image" : "pdf");
  const ext = format === "image" ? "png" : "pdf";
  triggerFileDownload(`/api/consumables/${id}/qr/export?${query.toString()}`, `consumable-qr-${id}.${ext}`);
  setMessage(`耗材二维码${format === "image" ? "图片" : "PDF"}导出中`);
  setTimeout(() => setMessage(""), 1800);
}

async function handleApprovalAction(id, status) {
  try {
    const defaultRemark = status === "approved" ? "同意" : "驳回";
    const remark = window.prompt("请输入审批备注（可留空）", defaultRemark);
    if (remark === null) {
      return;
    }

    setMessage(`正在处理审批 #${id} ...`);
    await apiRequest(`/api/approvals/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ status, remark })
    });
    await loadAll();
    setMessage(`审批 #${id} 已${status === "approved" ? "通过" : "驳回"}`);
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "审批失败", true);
  }
}

async function handleDeviceQrAction(id, action) {
  try {
    setMessage(`正在更新设备 #${id} 二维码...`);
    await apiRequest(`/api/devices/${id}/qr`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    await loadAll();
    setMessage("设备二维码已更新");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "设备二维码操作失败", true);
  }
}

async function handleConsumableQrAction(id, action) {
  try {
    setMessage(`正在更新耗材 #${id} 二维码...`);
    await apiRequest(`/api/consumables/${id}/qr`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    await loadAll();
    setMessage("耗材二维码已更新");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "耗材二维码操作失败", true);
  }
}

async function handleConsumablePhotoUpload(id) {
  try {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";

    const file = await new Promise((resolve) => {
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });

    if (!file) {
      return;
    }

    setMessage(`正在上传耗材 #${id} 照片...`);
    const photoDataUrl = await readFileAsDataUrl(file);

    await apiRequest(`/api/consumables/${id}/photo`, {
      method: "POST",
      body: JSON.stringify({ photoDataUrl })
    });

    await loadAll();
    setMessage("耗材照片已更新");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "上传耗材照片失败", true);
  }
}

async function handleQrLogFilter() {
  const typeEl = document.getElementById("qr-log-type-filter");
  const entityEl = document.getElementById("qr-log-entity-id-filter");

  state.qrLogFilters.type = typeEl ? String(typeEl.value || "") : "";
  state.qrLogFilters.entityId = entityEl ? String(entityEl.value || "").trim() : "";
  state.qrLogPagination.page = 1;

  await loadAll();
}

async function handleQrLogReset() {
  state.qrLogFilters.type = "";
  state.qrLogFilters.entityId = "";
  state.qrLogPagination.page = 1;
  await loadAll();
}

async function handleQrLogPrevPage() {
  if (state.qrLogPagination.page <= 1) return;
  state.qrLogPagination.page -= 1;
  await loadAll();
}

async function handleQrLogNextPage() {
  if (state.qrLogPagination.page >= state.qrLogPagination.totalPages) return;
  state.qrLogPagination.page += 1;
  await loadAll();
}

async function handleQrLogExport() {
  await exportQrLogsCsv();
  setMessage("扫码日志 CSV 已导出（按当前筛选导出全部）");
  setTimeout(() => setMessage(""), 1800);
}

async function handleBorrowFilter() {
  const statusEl = document.getElementById("borrow-status-filter");
  const userIdEl = document.getElementById("borrow-user-filter");
  state.borrowFilters.status = statusEl ? String(statusEl.value || "") : "";
  state.borrowFilters.userId = userIdEl ? String(userIdEl.value || "") : "";
  state.borrowPagination.page = 1;
  await loadAll();
}

async function handleBorrowReset() {
  state.borrowFilters.status = "";
  state.borrowFilters.userId = "";
  state.borrowPagination.page = 1;
  await loadAll();
}

async function handleBorrowPrevPage() {
  if (state.borrowPagination.page <= 1) return;
  state.borrowPagination.page -= 1;
  await loadAll();
}

async function handleBorrowNextPage() {
  if (state.borrowPagination.page >= state.borrowPagination.totalPages) return;
  state.borrowPagination.page += 1;
  await loadAll();
}

async function handleApplicationFilter() {
  const statusEl = document.getElementById("application-status-filter");
  const userIdEl = document.getElementById("application-user-filter");
  state.applicationFilters.status = statusEl ? String(statusEl.value || "") : "";
  state.applicationFilters.userId = userIdEl ? String(userIdEl.value || "") : "";
  state.applicationPagination.page = 1;
  await loadAll();
}

async function handleApplicationReset() {
  state.applicationFilters.status = "";
  state.applicationFilters.userId = "";
  state.applicationPagination.page = 1;
  await loadAll();
}

async function handleApplicationPrevPage() {
  if (state.applicationPagination.page <= 1) return;
  state.applicationPagination.page -= 1;
  await loadAll();
}

async function handleApplicationNextPage() {
  if (state.applicationPagination.page >= state.applicationPagination.totalPages) return;
  state.applicationPagination.page += 1;
  await loadAll();
}

async function handleApprovalsPrevPage() {
  if (state.approvalsPagination.page <= 1) return;
  state.approvalsPagination.page -= 1;
  await loadAll();
}

async function handleApprovalsNextPage() {
  if (state.approvalsPagination.page >= state.approvalsPagination.totalPages) return;
  state.approvalsPagination.page += 1;
  await loadAll();
}

window.handleApprovalAction = handleApprovalAction;
window.handleDeviceQrAction = handleDeviceQrAction;
window.handleConsumableQrAction = handleConsumableQrAction;
window.handleConsumablePhotoUpload = handleConsumablePhotoUpload;
window.handleDeviceQrExport = handleDeviceQrExport;
window.handleConsumableQrExport = handleConsumableQrExport;
window.handleUserEnableToggle = handleUserEnableToggle;
window.handleUserRoleChange = handleUserRoleChange;

function switchSection(name) {
  document.querySelectorAll(".menu-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === name);
  });

  document.querySelectorAll(".section").forEach((section) => {
    section.classList.toggle("active", section.dataset.name === name);
  });

  const meta = sectionMeta[name];
  if (meta) {
    document.getElementById("page-title").textContent = meta.title;
    document.getElementById("page-desc").textContent = meta.desc;
  }
}

function initLoginFields() {
  const loginTypeEl = document.getElementById("auth-login-type");
  const accountEl = document.getElementById("auth-account");
  const passwordEl = document.getElementById("auth-password");
  const ssoProviderEl = document.getElementById("auth-sso-provider");
  const ssoSubjectEl = document.getElementById("auth-sso-subject");

  if (loginTypeEl) loginTypeEl.value = state.auth.loginType || "password";
  if (accountEl) accountEl.value = state.auth.account || "";
  if (passwordEl) passwordEl.value = "";
  if (ssoProviderEl) ssoProviderEl.value = state.auth.ssoProvider || "";
  if (ssoSubjectEl) ssoSubjectEl.value = state.auth.ssoSubject || "";

  const isSso = state.auth.loginType === "sso";
  if (accountEl) accountEl.style.display = isSso ? "none" : "";
  if (passwordEl) passwordEl.style.display = isSso ? "none" : "";
  if (ssoProviderEl) ssoProviderEl.style.display = isSso ? "" : "none";
  if (ssoSubjectEl) ssoSubjectEl.style.display = isSso ? "" : "none";
}

function syncLoginFieldsToState() {
  const loginTypeEl = document.getElementById("auth-login-type");
  const accountEl = document.getElementById("auth-account");
  const passwordEl = document.getElementById("auth-password");
  const ssoProviderEl = document.getElementById("auth-sso-provider");
  const ssoSubjectEl = document.getElementById("auth-sso-subject");

  state.auth.loginType = loginTypeEl ? String(loginTypeEl.value || "password") : "password";
  state.auth.account = accountEl ? String(accountEl.value || "").trim() : "";
  state.auth.password = passwordEl ? String(passwordEl.value || "") : "";
  state.auth.ssoProvider = ssoProviderEl ? String(ssoProviderEl.value || "").trim() : "";
  state.auth.ssoSubject = ssoSubjectEl ? String(ssoSubjectEl.value || "").trim() : "";

  localStorage.setItem("adminLoginType", state.auth.loginType);
  localStorage.setItem("adminLoginAccount", state.auth.account);
  localStorage.setItem("adminLoginSsoProvider", state.auth.ssoProvider);
  localStorage.setItem("adminLoginSsoSubject", state.auth.ssoSubject);
}

async function handleManualLogin() {
  syncLoginFieldsToState();
  state.auth.accessToken = "";
  state.auth.refreshToken = "";
  state.auth.user = null;
  renderAuthSummary();
  await loginAdmin();
  await loadAll();
}

async function handleUserEnableToggle(userId, action) {
  const isDisable = action === "disable";
  const okText = isDisable ? "禁用" : "启用";
  const confirmed = window.confirm(`确定要${okText}用户 #${userId} 吗？`);
  if (!confirmed) return;

  try {
    renderUserOpNotices([]);
    const data = await apiRequest(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !isDisable })
    });

    const notices = data && Array.isArray(data.notices) ? data.notices : [];
    if (notices.length > 0) {
      renderUserOpNotices(notices);
    }

    await loadUserOps();
    setMessage(`用户 #${userId} 已${okText}`);
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    renderUserOpNotices([{ message: error.message || `${okText}失败` }], true);
  }
}

async function handleUserRoleChange(userId, currentRole) {
  const role = window.prompt(
    `请输入新角色（super_admin/admin/teacher/student），当前：${currentRole}`,
    currentRole || "teacher"
  );
  if (role === null) return;

  const nextRole = String(role || "").trim();
  if (!nextRole) return;

  try {
    renderUserOpNotices([]);
    const data = await apiRequest(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: nextRole })
    });

    const notices = data && Array.isArray(data.notices) ? data.notices : [];
    if (notices.length > 0) {
      renderUserOpNotices(notices);
    }

    await loadUserOps();
    setMessage(`用户 #${userId} 角色已更新`);
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    renderUserOpNotices([{ message: error.message || "角色变更失败" }], true);
  }
}

function bindEvents() {
  document.querySelectorAll(".menu-item").forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
  });

  initLoginFields();
  renderAuthSummary();

  const loginTypeEl = document.getElementById("auth-login-type");
  if (loginTypeEl) {
    loginTypeEl.addEventListener("change", () => {
      syncLoginFieldsToState();
      initLoginFields();
      renderAuthSummary();
    });
  }

  const authLoginBtn = document.getElementById("auth-login-btn");
  if (authLoginBtn) {
    authLoginBtn.addEventListener("click", () => {
      handleManualLogin().catch((error) => setMessage(error.message || "登录失败", true));
    });
  }

  document.getElementById("refresh-btn").addEventListener("click", loadAll);

  const movementForm = document.getElementById("movement-form");
  if (movementForm) {
    movementForm.addEventListener("submit", handleMovementSubmit);
  }

  const consumableCreateForm = document.getElementById("consumable-create-form");
  if (consumableCreateForm) {
    consumableCreateForm.addEventListener("submit", handleConsumableCreateSubmit);
  }

  const deviceCreateForm = document.getElementById("device-create-form");
  if (deviceCreateForm) {
    deviceCreateForm.addEventListener("submit", handleDeviceCreateSubmit);
  }

  const warehouseSelect = document.getElementById("inventory-warehouse");
  if (warehouseSelect) {
    warehouseSelect.addEventListener("change", () => {
      state.selectedWarehouseId = Number(warehouseSelect.value);
      loadAll();
    });
  }

  const qrFilterBtn = document.getElementById("qr-log-filter-btn");
  if (qrFilterBtn) {
    qrFilterBtn.addEventListener("click", () => {
      handleQrLogFilter().catch((error) => setMessage(error.message || "筛选失败", true));
    });
  }

  const qrResetBtn = document.getElementById("qr-log-reset-btn");
  if (qrResetBtn) {
    qrResetBtn.addEventListener("click", () => {
      handleQrLogReset().catch((error) => setMessage(error.message || "重置失败", true));
    });
  }

  const qrExportBtn = document.getElementById("qr-log-export-btn");
  if (qrExportBtn) {
    qrExportBtn.addEventListener("click", () => {
      handleQrLogExport().catch((error) => setMessage(error.message || "导出失败", true));
    });
  }

  const qrPrevBtn = document.getElementById("qr-log-prev-btn");
  if (qrPrevBtn) {
    qrPrevBtn.addEventListener("click", () => {
      handleQrLogPrevPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const qrNextBtn = document.getElementById("qr-log-next-btn");
  if (qrNextBtn) {
    qrNextBtn.addEventListener("click", () => {
      handleQrLogNextPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const borrowFilterBtn = document.getElementById("borrow-filter-btn");
  if (borrowFilterBtn) {
    borrowFilterBtn.addEventListener("click", () => {
      handleBorrowFilter().catch((error) => setMessage(error.message || "筛选失败", true));
    });
  }

  const borrowResetBtn = document.getElementById("borrow-reset-btn");
  if (borrowResetBtn) {
    borrowResetBtn.addEventListener("click", () => {
      handleBorrowReset().catch((error) => setMessage(error.message || "重置失败", true));
    });
  }

  const borrowPrevBtn = document.getElementById("borrows-prev-btn");
  if (borrowPrevBtn) {
    borrowPrevBtn.addEventListener("click", () => {
      handleBorrowPrevPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const borrowPageNextBtn = document.getElementById("borrows-next-btn");
  if (borrowPageNextBtn) {
    borrowPageNextBtn.addEventListener("click", () => {
      handleBorrowNextPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const appFilterBtn = document.getElementById("application-filter-btn");
  if (appFilterBtn) {
    appFilterBtn.addEventListener("click", () => {
      handleApplicationFilter().catch((error) => setMessage(error.message || "筛选失败", true));
    });
  }

  const appResetBtn = document.getElementById("application-reset-btn");
  if (appResetBtn) {
    appResetBtn.addEventListener("click", () => {
      handleApplicationReset().catch((error) => setMessage(error.message || "重置失败", true));
    });
  }

  const appPrevBtn = document.getElementById("applications-prev-btn");
  if (appPrevBtn) {
    appPrevBtn.addEventListener("click", () => {
      handleApplicationPrevPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const appNextBtn = document.getElementById("applications-next-btn");
  if (appNextBtn) {
    appNextBtn.addEventListener("click", () => {
      handleApplicationNextPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const approvalsPrevBtn = document.getElementById("approvals-prev-btn");
  if (approvalsPrevBtn) {
    approvalsPrevBtn.addEventListener("click", () => {
      handleApprovalsPrevPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const approvalsNextBtn = document.getElementById("approvals-next-btn");
  if (approvalsNextBtn) {
    approvalsNextBtn.addEventListener("click", () => {
      handleApprovalsNextPage().catch((error) => setMessage(error.message || "翻页失败", true));
    });
  }

  const usersRefreshBtn = document.getElementById("users-refresh-btn");
  if (usersRefreshBtn) {
    usersRefreshBtn.addEventListener("click", () => {
      loadUserOps().catch((error) => renderUserOpNotices([{ message: error.message || "刷新用户失败" }], true));
    });
  }

  const logsRefreshBtn = document.getElementById("logs-refresh-btn");
  if (logsRefreshBtn) {
    logsRefreshBtn.addEventListener("click", () => {
      loadUserOps().catch((error) => renderUserOpNotices([{ message: error.message || "刷新日志失败" }], true));
    });
  }

  // 退出登录
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      state.auth.accessToken = "";
      state.auth.refreshToken = "";
      state.auth.user = null;
      renderAuthSummary();
      showLoginScreen();
    });
  }
}

// ===== 登录屏逻辑 =====

function showLoginScreen() {
  const screen = document.getElementById("login-screen");
  const app = document.getElementById("main-app");
  if (screen) {
    screen.style.display = "flex";
    screen.classList.remove("leaving");
  }
  if (app) app.style.display = "none";
  startLoginCanvas();
}

function hideLoginScreen() {
  const screen = document.getElementById("login-screen");
  const app = document.getElementById("main-app");
  if (!screen) return;
  screen.classList.add("leaving");
  setTimeout(() => {
    screen.style.display = "none";
    if (app) app.style.display = "flex";
    stopLoginCanvas();
  }, 380);
}

// 粒子动画
let _canvasAnimId = null;
let _canvasRunning = false;

function startLoginCanvas() {
  const canvas = document.getElementById("login-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  _canvasRunning = true;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const PARTICLE_COUNT = 72;
  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.8 + 0.4,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    alpha: Math.random() * 0.5 + 0.15,
    color: Math.random() > 0.5 ? "79,142,247" : "34,211,238"
  }));

  const CONNECTION_DIST = 140;

  function draw() {
    if (!_canvasRunning) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          const opacity = (1 - dist / CONNECTION_DIST) * 0.18;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(79,142,247,${opacity})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Draw particles
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();
    });

    _canvasAnimId = requestAnimationFrame(draw);
  }

  draw();
}

function stopLoginCanvas() {
  _canvasRunning = false;
  if (_canvasAnimId) {
    cancelAnimationFrame(_canvasAnimId);
    _canvasAnimId = null;
  }
}

function setLoginError(msg) {
  const el = document.getElementById("login-error");
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = "block";
  } else {
    el.style.display = "none";
    el.textContent = "";
  }
}

function setLoginBtnLoading(formId, loading) {
  const form = document.getElementById(formId);
  if (!form) return;
  const btn = form.querySelector(".login-btn");
  if (!btn) return;
  const textEl = btn.querySelector(".login-btn-text");
  const spinnerEl = btn.querySelector(".login-btn-spinner");
  btn.disabled = loading;
  if (textEl) textEl.style.display = loading ? "none" : "";
  if (spinnerEl) spinnerEl.style.display = loading ? "" : "none";
}

async function handleLoginScreenSubmit(loginType) {
  const formId = loginType === "sso" ? "login-form-sso" : "login-form-password";
  setLoginError("");
  setLoginBtnLoading(formId, true);

  try {
    if (loginType === "sso") {
      state.auth.loginType = "sso";
      state.auth.ssoProvider = String((document.getElementById("auth-sso-provider") || {}).value || "").trim();
      state.auth.ssoSubject = String((document.getElementById("auth-sso-subject") || {}).value || "").trim();
    } else {
      state.auth.loginType = "password";
      state.auth.account = String((document.getElementById("auth-account") || {}).value || "").trim();
      state.auth.password = String((document.getElementById("auth-password") || {}).value || "");
    }

    state.auth.accessToken = "";
    state.auth.refreshToken = "";
    state.auth.user = null;

    await loginAdmin();
    hideLoginScreen();
    await loadAll();
  } catch (err) {
    setLoginError(err.message || "登录失败，请检查账号密码");
  } finally {
    setLoginBtnLoading(formId, false);
  }
}

function initLoginScreen() {
  // Tab 切换
  document.querySelectorAll(".login-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".login-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".login-form").forEach((f) => f.classList.remove("active"));
      tab.classList.add("active");
      const formId = `login-form-${tab.dataset.type}`;
      const form = document.getElementById(formId);
      if (form) form.classList.add("active");
      setLoginError("");
    });
  });

  // 密码可见切换
  const toggleBtn = document.getElementById("toggle-password");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const input = document.getElementById("auth-password");
      const eyeOpen = document.getElementById("eye-open");
      const eyeClosed = document.getElementById("eye-closed");
      if (!input) return;
      const isText = input.type === "text";
      input.type = isText ? "password" : "text";
      if (eyeOpen) eyeOpen.style.display = isText ? "" : "none";
      if (eyeClosed) eyeClosed.style.display = isText ? "none" : "";
    });
  }

  // 密码表单提交
  const pwForm = document.getElementById("login-form-password");
  if (pwForm) {
    pwForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleLoginScreenSubmit("password");
    });
  }

  // SSO 表单提交
  const ssoForm = document.getElementById("login-form-sso");
  if (ssoForm) {
    ssoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleLoginScreenSubmit("sso");
    });
  }

  // 预填上次登录的账号
  const savedAccount = localStorage.getItem("adminLoginAccount");
  if (savedAccount) {
    const el = document.getElementById("auth-account");
    if (el) el.value = savedAccount;
  }
  const savedSsoProvider = localStorage.getItem("adminLoginSsoProvider");
  if (savedSsoProvider) {
    const el = document.getElementById("auth-sso-provider");
    if (el) el.value = savedSsoProvider;
  }
  const savedSsoSubject = localStorage.getItem("adminLoginSsoSubject");
  if (savedSsoSubject) {
    const el = document.getElementById("auth-sso-subject");
    if (el) el.value = savedSsoSubject;
  }
}

// ===== 启动 =====
bindEvents();
initLoginScreen();

// 总是显示登录屏
showLoginScreen();
