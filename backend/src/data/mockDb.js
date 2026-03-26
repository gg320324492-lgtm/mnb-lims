function generateQrToken(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = prefix + '_';
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

const users = [
  {
    id: 1,
    name: "系统管理员",
    role: "super_admin",
    phone: "13800000000"
  },
  {
    id: 2,
    name: "李老师",
    role: "teacher",
    phone: "13800000001"
  },
  {
    id: 3,
    name: "王同学",
    role: "student",
    phone: "13800000002"
  }
];

const labs = [
  {
    id: 1,
    name: "化学实验室 A101",
    location: "实验楼 A101",
    capacity: 30,
    status: "available",
    managerName: "张老师"
  },
  {
    id: 2,
    name: "电子实验室 B203",
    location: "实验楼 B203",
    capacity: 24,
    status: "available",
    managerName: "刘老师"
  }
];

const devices = [
  {
    id: 1,
    name: "示波器",
    code: "DEV-001",
    category: "电子仪器",
    status: "available",
    labId: 2,
    qrToken: "dev_osc12345",
    qrEnabled: true
  },
  {
    id: 2,
    name: "恒温水浴锅",
    code: "DEV-002",
    category: "化学仪器",
    status: "available",
    labId: 1,
    qrToken: "dev_bath6789",
    qrEnabled: true
  }
];

// 仓库（实验室仓库 / 厂房仓库）
const warehouses = [
  { id: 1, name: "实验室仓库" },
  { id: 2, name: "厂房仓库" }
];

// 耗材目录（不直接存库存；库存放到 consumableStocks 按仓库拆分）
const consumables = [
  {
    id: 1,
    name: "一次性手套",
    category: "防护用品",
    unit: "盒",
    qrToken: "cons_glove123",
    qrEnabled: true
  },
  {
    id: 2,
    name: "PH 试纸",
    category: "检测耗材",
    unit: "包",
    qrToken: "cons_phtest456",
    qrEnabled: true
  }
];

// 耗材库存（按仓库拆分）
const consumableStocks = [
  // 实验室仓库
  { id: 1, warehouseId: 1, consumableId: 1, stock: 20, safeStock: 5 },
  { id: 2, warehouseId: 1, consumableId: 2, stock: 8, safeStock: 10 },
  // 厂房仓库（MVP：初始先给一个偏低库存，后续可以通过进出库维护）
  { id: 3, warehouseId: 2, consumableId: 1, stock: 2, safeStock: 5 },
  { id: 4, warehouseId: 2, consumableId: 2, stock: 12, safeStock: 10 }
];

const borrows = [
  {
    id: 1,
    deviceId: 1,
    userId: 3,
    purpose: "电子课程实验",
    borrowDate: "2026-03-20",
    expectedReturnDate: "2026-03-21",
    expectedReturnTime: "18:00",
    status: "pending"
  }
];

const consumableApplications = [
  {
    id: 1,
    consumableId: 1,
    userId: 3,
    quantity: 2,
    purpose: "课堂实验使用",
    status: "pending"
  }
];

const approvals = [
  {
    id: 1,
    type: "borrow",
    businessId: 1,
    applicantId: 3,
    status: "pending",
    remark: "",
    createdAt: "2026-03-19T00:10:00.000Z"
  },
  {
    id: 2,
    type: "consumable_application",
    businessId: 1,
    applicantId: 3,
    status: "pending",
    remark: "",
    createdAt: "2026-03-19T00:20:00.000Z"
  }
];

// 耗材库存出入库记录（进货/出货）- 按仓库拆分
const stockMovements = [
  {
    id: 1,
    consumableId: 1,
    warehouseId: 1,
    type: "in",
    quantity: 10,
    note: "开学补货",
    userId: 1,
    createdAt: "2026-03-20T09:00:00.000Z"
  },
  {
    id: 2,
    consumableId: 2,
    warehouseId: 1,
    type: "in",
    quantity: 5,
    note: "库存补充",
    userId: 1,
    createdAt: "2026-03-20T10:00:00.000Z"
  }
];

// 二维码扫描日志（用于审计）
const qrScanLogs = [
  {
    id: 1,
    type: "device",
    entityId: 1,
    entityName: "示波器",
    token: "dev_osc12345",
    userId: 3,
    userAgent: "MVP-Seed",
    ip: "127.0.0.1",
    createdAt: "2026-03-20T08:00:00.000Z"
  }
];

function nextId(list) {
  if (!Array.isArray(list) || list.length === 0) return 1;
  return Math.max(...list.map(item => Number(item.id) || 0)) + 1;
}

module.exports = {
  warehouses,
  users,
  labs,
  devices,
  consumables,
  consumableStocks,
  borrows,
  consumableApplications,
  approvals,
  stockMovements,
  qrScanLogs,
  nextId,
  generateQrToken
};
