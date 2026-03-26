const mysql = require('mysql2/promise');

const useMySql = String(process.env.USE_MYSQL || '').toLowerCase() === 'true';

let pool = null;

function getPool() {
  if (!useMySql) return null;
  if (pool) return pool;

  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'lab_miniapp',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  return pool;
}

async function query(sql, params = []) {
  const p = getPool();
  if (!p) {
    throw new Error('MySQL is disabled. Set USE_MYSQL=true to enable.');
  }
  const [rows] = await p.query(sql, params);
  return rows;
}

async function getUsers() {
  return query('SELECT id, name, role, phone FROM users ORDER BY id ASC');
}

async function getWarehouses() {
  return query('SELECT id, name FROM warehouses ORDER BY id ASC');
}

async function getDashboardStats() {
  const [rows] = await Promise.all([
    query("SELECT COUNT(*) AS value FROM approvals WHERE status = 'pending'"),
    query('SELECT COUNT(*) AS value FROM devices'),
    query('SELECT COUNT(*) AS value FROM consumables'),
    query('SELECT COUNT(*) AS value FROM borrows'),
    query('SELECT COUNT(*) AS value FROM consumable_stocks WHERE safe_stock > 0 AND stock <= safe_stock')
  ]);

  return {
    pendingApprovals: Number(rows[0][0].value || 0),
    devicesCount: Number(rows[1][0].value || 0),
    consumablesCount: Number(rows[2][0].value || 0),
    borrowsCount: Number(rows[3][0].value || 0),
    lowStockCount: Number(rows[4][0].value || 0)
  };
}

async function getDevices() {
  return query('SELECT id, name, code, category, status, lab_id AS labId, qr_token AS qrToken, qr_enabled AS qrEnabled FROM devices ORDER BY id ASC');
}

async function getConsumables(warehouseId = 1) {
  return query(
    `SELECT c.id, c.name, c.category, c.unit, c.photo_data_url AS photoDataUrl, c.qr_token AS qrToken, c.qr_enabled AS qrEnabled,
            COALESCE(s.stock, 0) AS stock, COALESCE(s.safe_stock, 0) AS safeStock
     FROM consumables c
     LEFT JOIN consumable_stocks s ON s.consumable_id = c.id AND s.warehouse_id = ?
     ORDER BY c.id ASC`,
    [Number(warehouseId)]
  );
}

async function getBorrowById(id) {
  const rows = await query(
    `SELECT id, device_id AS deviceId, user_id AS userId, purpose, borrow_date AS borrowDate,
            expected_return_date AS expectedReturnDate, expected_return_time AS expectedReturnTime, status
     FROM borrows WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function getBorrows() {
  return query(
    `SELECT b.id, b.device_id AS deviceId, b.user_id AS userId, b.purpose, b.borrow_date AS borrowDate,
            b.expected_return_date AS expectedReturnDate, b.expected_return_time AS expectedReturnTime, b.status,
            d.name AS deviceName, u.name AS borrowerName
     FROM borrows b
     LEFT JOIN devices d ON d.id = b.device_id
     LEFT JOIN users u ON u.id = b.user_id
     ORDER BY b.id DESC`
  );
}

async function createBorrow(payload) {
  const result = await query(
    `INSERT INTO borrows (device_id, user_id, purpose, borrow_date, expected_return_date, expected_return_time, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      Number(payload.deviceId),
      Number(payload.userId),
      payload.purpose || '',
      payload.borrowDate,
      payload.expectedReturnDate,
      payload.expectedReturnTime || '18:00'
    ]
  );

  const id = Number(result.insertId);

  await query(
    `INSERT INTO approvals (type, business_id, applicant_id, status, created_at)
     VALUES ('borrow', ?, ?, 'pending', NOW())`,
    [id, Number(payload.userId)]
  );

  const rows = await query(
    `SELECT id, device_id AS deviceId, user_id AS userId, purpose, borrow_date AS borrowDate,
            expected_return_date AS expectedReturnDate, expected_return_time AS expectedReturnTime, status
     FROM borrows WHERE id = ? LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

async function getConsumableApplicationById(id) {
  const rows = await query(
    `SELECT id, consumable_id AS consumableId, warehouse_id AS warehouseId, user_id AS userId,
            quantity, purpose, status
     FROM consumable_applications WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function getConsumableApplications() {
  return query(
    `SELECT a.id, a.consumable_id AS consumableId, a.warehouse_id AS warehouseId, a.user_id AS userId,
            a.quantity, a.purpose, a.status,
            c.name AS consumableName, w.name AS warehouseName, u.name AS applicantName
     FROM consumable_applications a
     LEFT JOIN consumables c ON c.id = a.consumable_id
     LEFT JOIN warehouses w ON w.id = a.warehouse_id
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC`
  );
}

async function createConsumableApplication(payload) {
  const result = await query(
    `INSERT INTO consumable_applications (consumable_id, warehouse_id, user_id, quantity, purpose, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [
      Number(payload.consumableId),
      Number(payload.warehouseId || 1),
      Number(payload.userId),
      Number(payload.quantity),
      payload.purpose || ''
    ]
  );

  const id = Number(result.insertId);

  await query(
    `INSERT INTO approvals (type, business_id, applicant_id, status, created_at)
     VALUES ('consumable_application', ?, ?, 'pending', NOW())`,
    [id, Number(payload.userId)]
  );

  const rows = await query(
    `SELECT id, consumable_id AS consumableId, warehouse_id AS warehouseId, user_id AS userId,
            quantity, purpose, status
     FROM consumable_applications WHERE id = ? LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

async function getApprovals(filters = {}) {
  const where = [];
  const params = [];

  if (filters.status) {
    where.push('a.status = ?');
    params.push(String(filters.status));
  }
  if (filters.type) {
    where.push('a.type = ?');
    params.push(String(filters.type));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return query(
    `SELECT
        a.id,
        a.type,
        a.business_id AS businessId,
        a.applicant_id AS applicantId,
        a.status,
        a.created_at AS createdAt,
        a.updated_at AS updatedAt,
        u.name AS applicantName,
        b.status AS borrowStatus,
        b.borrow_date AS borrowDate,
        b.expected_return_date AS expectedReturnDate,
        b.expected_return_time AS expectedReturnTime,
        b.purpose AS borrowPurpose,
        d.name AS deviceName,
        ca.status AS applicationStatus,
        ca.quantity AS applicationQuantity,
        ca.purpose AS applicationPurpose,
        c.name AS consumableName,
        w.name AS warehouseName
     FROM approvals a
     LEFT JOIN users u ON u.id = a.applicant_id
     LEFT JOIN borrows b ON a.type = 'borrow' AND b.id = a.business_id
     LEFT JOIN devices d ON d.id = b.device_id
     LEFT JOIN consumable_applications ca ON a.type = 'consumable_application' AND ca.id = a.business_id
     LEFT JOIN consumables c ON c.id = ca.consumable_id
     LEFT JOIN warehouses w ON w.id = ca.warehouse_id
     ${whereSql}
     ORDER BY a.id DESC`,
    params
  );
}

function getPoolRequired() {
  const p = getPool();
  if (!p) {
    throw new Error('MySQL is disabled. Set USE_MYSQL=true to enable.');
  }
  return p;
}

function formatDateOnly(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function applyApprovalAction(approvalId, nextStatus, remark = '') {
  const p = getPoolRequired();
  const conn = await p.getConnection();

  try {
    await conn.beginTransaction();

    const [approvalRows] = await conn.query(
      `SELECT id, type, business_id AS businessId, applicant_id AS applicantId, status
       FROM approvals
       WHERE id = ?
       FOR UPDATE`,
      [Number(approvalId)]
    );

    const approval = approvalRows[0];
    if (!approval) {
      throw new Error('审批记录不存在');
    }

    if (approval.type === 'borrow') {
      const [borrowRows] = await conn.query(
        `SELECT id, device_id AS deviceId, user_id AS userId, purpose,
                borrow_date AS borrowDate, expected_return_date AS expectedReturnDate,
                expected_return_time AS expectedReturnTime, status
         FROM borrows
         WHERE id = ?
         FOR UPDATE`,
        [Number(approval.businessId)]
      );
      const record = borrowRows[0];
      if (!record) {
        throw new Error('审批关联业务不存在');
      }

      const [deviceRows] = await conn.query(
        `SELECT id, status, name FROM devices WHERE id = ? FOR UPDATE`,
        [Number(record.deviceId)]
      );
      const device = deviceRows[0];
      if (!device) {
        throw new Error('关联设备不存在');
      }

      const prevStatus = String(record.status || '');
      if (
        ['approved', 'borrowed'].includes(nextStatus) &&
        !['approved', 'borrowed'].includes(prevStatus) &&
        String(device.status) === 'borrowed'
      ) {
        throw new Error('设备已借出，无法重复审批');
      }

      let deviceStatus = device.status;
      if (['approved', 'borrowed'].includes(nextStatus)) {
        deviceStatus = 'borrowed';
      }
      if (['rejected', 'returned', 'cancelled'].includes(nextStatus)) {
        deviceStatus = 'available';
      }

      await conn.query(`UPDATE borrows SET status = ? WHERE id = ?`, [nextStatus, Number(record.id)]);
      await conn.query(`UPDATE devices SET status = ? WHERE id = ?`, [deviceStatus, Number(device.id)]);
    } else if (approval.type === 'consumable_application') {
      const [appRows] = await conn.query(
        `SELECT id, consumable_id AS consumableId, warehouse_id AS warehouseId,
                user_id AS userId, quantity, purpose, status
         FROM consumable_applications
         WHERE id = ?
         FOR UPDATE`,
        [Number(approval.businessId)]
      );
      const record = appRows[0];
      if (!record) {
        throw new Error('审批关联业务不存在');
      }

      const [stockRows] = await conn.query(
        `SELECT id, warehouse_id AS warehouseId, consumable_id AS consumableId, stock, safe_stock AS safeStock
         FROM consumable_stocks
         WHERE warehouse_id = ? AND consumable_id = ?
         FOR UPDATE`,
        [Number(record.warehouseId || 1), Number(record.consumableId)]
      );
      const stock = stockRows[0];
      if (!stock) {
        throw new Error('关联耗材库存不存在');
      }

      const prevStatus = String(record.status || '');
      if (prevStatus !== 'approved' && nextStatus === 'approved') {
        if (Number(stock.stock) < Number(record.quantity)) {
          throw new Error('库存不足，无法审批通过');
        }
        await conn.query(
          `UPDATE consumable_stocks SET stock = stock - ? WHERE id = ?`,
          [Number(record.quantity), Number(stock.id)]
        );
      }

      if (prevStatus === 'approved' && nextStatus !== 'approved') {
        await conn.query(
          `UPDATE consumable_stocks SET stock = stock + ? WHERE id = ?`,
          [Number(record.quantity), Number(stock.id)]
        );
      }

      await conn.query(`UPDATE consumable_applications SET status = ? WHERE id = ?`, [nextStatus, Number(record.id)]);
    } else {
      throw new Error('暂不支持的审批类型');
    }

    await conn.query(
      `UPDATE approvals SET status = ?, updated_at = NOW() WHERE id = ?`,
      [nextStatus, Number(approval.id)]
    );

    await conn.commit();

    const [rows] = await conn.query(
      `SELECT
          a.id,
          a.type,
          a.business_id AS businessId,
          a.applicant_id AS applicantId,
          a.status,
          a.remark,
          a.created_at AS createdAt,
          a.updated_at AS updatedAt,
          u.name AS applicantName,
          b.status AS borrowStatus,
          b.borrow_date AS borrowDate,
          b.expected_return_date AS expectedReturnDate,
          b.expected_return_time AS expectedReturnTime,
          b.purpose AS borrowPurpose,
          d.name AS deviceName,
          ca.status AS applicationStatus,
          ca.quantity AS applicationQuantity,
          ca.purpose AS applicationPurpose,
          c.name AS consumableName,
          w.name AS warehouseName
       FROM approvals a
       LEFT JOIN users u ON u.id = a.applicant_id
       LEFT JOIN borrows b ON a.type = 'borrow' AND b.id = a.business_id
       LEFT JOIN devices d ON d.id = b.device_id
       LEFT JOIN consumable_applications ca ON a.type = 'consumable_application' AND ca.id = a.business_id
       LEFT JOIN consumables c ON c.id = ca.consumable_id
       LEFT JOIN warehouses w ON w.id = ca.warehouse_id
       WHERE a.id = ?
       LIMIT 1`,
      [Number(approval.id)]
    );

    return rows[0] || null;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function toApprovalView(row) {
  if (!row) return null;

  if (row.type === 'borrow') {
    const borrowDate = formatDateOnly(row.borrowDate);
    const expectedReturnDate = formatDateOnly(row.expectedReturnDate);
    return {
      id: Number(row.id),
      type: row.type,
      businessId: Number(row.businessId),
      applicantId: Number(row.applicantId),
      applicantName: row.applicantName || `用户#${row.applicantId}`,
      status: row.status,
      remark: row.remark || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      title: `${row.deviceName || '设备'}借用申请`,
      description: `${borrowDate} ~ ${expectedReturnDate} ${row.expectedReturnTime || ''} / ${row.borrowPurpose || '未填写用途'}`.trim(),
      businessStatus: row.borrowStatus || 'unknown'
    };
  }

  if (row.type === 'consumable_application') {
    return {
      id: Number(row.id),
      type: row.type,
      businessId: Number(row.businessId),
      applicantId: Number(row.applicantId),
      applicantName: row.applicantName || `用户#${row.applicantId}`,
      status: row.status,
      remark: row.remark || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      title: `${row.consumableName || '耗材'}申领申请`,
      description: `仓库：${row.warehouseName || '-'} / 数量：${Number(row.applicationQuantity || 0)} / ${row.applicationPurpose || '未填写用途'}`,
      businessStatus: row.applicationStatus || 'unknown'
    };
  }

  return {
    id: Number(row.id),
    type: row.type,
    businessId: Number(row.businessId),
    applicantId: Number(row.applicantId),
    applicantName: row.applicantName || `用户#${row.applicantId}`,
    status: row.status,
    remark: row.remark || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.type,
    description: '未知业务类型',
    businessStatus: 'unknown'
  };
}

module.exports = {
  useMySql,
  getUsers,
  getWarehouses,
  getDashboardStats,
  getDevices,
  getConsumables,
  getBorrows,
  getBorrowById,
  createBorrow,
  getConsumableApplications,
  getConsumableApplicationById,
  createConsumableApplication,
  getApprovals,
  applyApprovalAction,
  toApprovalView
};
