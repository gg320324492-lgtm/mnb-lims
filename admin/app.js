const state = {
  stats: null,
  approvals: [],
  devices: [],
  consumables: [],
  warehouses: [],
  selectedWarehouseId: 1,
  stockAlerts: null,
  stockMovements: [],
  borrows: [],
  applications: [],
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

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(json.message || "请求失败");
  }
  return json.data;
}

function setMessage(text, isError = false) {
  const el = document.getElementById("global-message");
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
}

function renderLedgers() {
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

    const [
      stats,
      approvals,
      devices,
      consumables,
      warehouses,
      borrows,
      applications,
      stockAlerts,
      stockMovements,
      qrLogsResp
    ] = await Promise.all([
      apiRequest("/api/dashboard/stats"),
      apiRequest("/api/approvals"),
      apiRequest("/api/devices"),
      apiRequest("/api/consumables"),
      apiRequest("/api/warehouses"),
      apiRequest("/api/borrows"),
      apiRequest("/api/consumable-applications"),
      apiRequest(`/api/consumables/stock-alerts?warehouseId=${selectedWarehouseId}`),
      apiRequest(`/api/stock-movements?warehouseId=${selectedWarehouseId}`),
      apiRequest(qrLogsUrl)
    ]);

    state.stats = stats;
    state.approvals = approvals;
    state.devices = devices;
    state.consumables = consumables;
    state.warehouses = warehouses;
    state.selectedWarehouseId = selectedWarehouseId;
    state.stockAlerts = stockAlerts;
    state.stockMovements = stockMovements;
    state.qrScanLogs = (qrLogsResp && qrLogsResp.items) || [];
    state.qrLogPagination.total = Number((qrLogsResp && qrLogsResp.total) || 0);
    state.qrLogPagination.page = Number((qrLogsResp && qrLogsResp.page) || state.qrLogPagination.page || 1);
    state.qrLogPagination.pageSize = Number((qrLogsResp && qrLogsResp.pageSize) || state.qrLogPagination.pageSize || 20);
    state.qrLogPagination.totalPages = Number((qrLogsResp && qrLogsResp.totalPages) || 1);
    state.borrows = borrows;
    state.applications = applications;

    renderStats();
    renderApprovals();
    renderLedgers();
    renderInventory();
    renderQrLogs();
    setMessage("后台数据已刷新");
    setTimeout(() => setMessage(""), 1800);
  } catch (error) {
    setMessage(error.message || "加载失败", true);
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
    setMessage(`正在处理审批 #${id} ...`);
    await apiRequest(`/api/approvals/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ status })
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

window.handleApprovalAction = handleApprovalAction;
window.handleDeviceQrAction = handleDeviceQrAction;
window.handleConsumableQrAction = handleConsumableQrAction;
window.handleConsumablePhotoUpload = handleConsumablePhotoUpload;
window.handleDeviceQrExport = handleDeviceQrExport;
window.handleConsumableQrExport = handleConsumableQrExport;

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

function bindEvents() {
  document.querySelectorAll(".menu-item").forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
  });

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
}

bindEvents();
loadAll();
