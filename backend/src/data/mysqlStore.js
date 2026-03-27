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
  return query(
    `SELECT id, name, account, sso_provider AS ssoProvider, sso_subject AS ssoSubject,
            role, enabled, role_updated_at AS roleUpdatedAt, phone
     FROM users
     ORDER BY id ASC`
  );
}

async function getUserById(id) {
  const rows = await query(
    `SELECT id, name, account, sso_provider AS ssoProvider, sso_subject AS ssoSubject,
            role, enabled, role_updated_at AS roleUpdatedAt, phone
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function getUserByAccount(account) {
  const rows = await query(
    `SELECT id, name, account, password, sso_provider AS ssoProvider, sso_subject AS ssoSubject,
            role, enabled, role_updated_at AS roleUpdatedAt, phone
     FROM users
     WHERE account = ?
     LIMIT 1`,
    [String(account || '').trim()]
  );
  return rows[0] || null;
}

async function getUserBySso(ssoProvider, ssoSubject) {
  const rows = await query(
    `SELECT id, name, account, sso_provider AS ssoProvider, sso_subject AS ssoSubject,
            role, enabled, role_updated_at AS roleUpdatedAt, phone
     FROM users
     WHERE sso_provider = ? AND sso_subject = ?
     LIMIT 1`,
    [String(ssoProvider || '').trim(), String(ssoSubject || '').trim()]
  );
  return rows[0] || null;
}

async function getWarehouses() {
  return query('SELECT id, name FROM warehouses ORDER BY id ASC');
}

async function getDashboardStats() {
  const results = await Promise.all([
    query("SELECT COUNT(*) AS value FROM approvals WHERE status = 'pending'"),
    query('SELECT COUNT(*) AS value FROM devices'),
    query('SELECT COUNT(*) AS value FROM consumables'),
    query('SELECT COUNT(*) AS value FROM borrows'),
    query('SELECT COUNT(*) AS value FROM consumable_stocks WHERE safe_stock > 0 AND stock <= safe_stock')
  ]);

  return {
    pendingApprovals: Number(results[0][0].value || 0),
    devicesCount: Number(results[1][0].value || 0),
    consumablesCount: Number(results[2][0].value || 0),
    borrowsCount: Number(results[3][0].value || 0),
    lowStockCount: Number(results[4][0].value || 0)
  };
}

async function getDevices() {
  return query('SELECT id, name, code, category, status, lab_id AS labId, qr_token AS qrToken, qr_enabled AS qrEnabled FROM devices ORDER BY id ASC');
}

async function createDevice(payload) {
  const qrToken = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const code = payload.code || `DEV-${Date.now()}`;
  const [result] = await query(
    `INSERT INTO devices (name, code, category, status, lab_id, qr_token, qr_enabled) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [
      String(payload.name || '').trim(),
      code,
      String(payload.category || '未分类').trim(),
      String(payload.status || 'available'),
      payload.labId || null,
      qrToken
    ]
  );
  const [rows] = await query('SELECT id, name, code, category, status, lab_id AS labId, qr_token AS qrToken, qr_enabled AS qrEnabled FROM devices WHERE id = ?', [result.insertId]);
  return rows;
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

async function createConsumable(payload) {
  const qrToken = `cons-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO consumables (name, category, unit, qr_token, qr_enabled) VALUES (?, ?, ?, ?, 1)`,
      [
        String(payload.name || '').trim(),
        String(payload.category || '未分类').trim(),
        String(payload.unit || '个').trim(),
        qrToken
      ]
    );
    const consumableId = result.insertId;
    const stock = Number(payload.stock || 0);
    const safeStock = Number(payload.safeStock || 0);
    const warehouseId = Number(payload.warehouseId || 1);
    const [warehouses] = await conn.query('SELECT id FROM warehouses');
    for (const w of warehouses) {
      const isPrimary = Number(w.id) === warehouseId;
      await conn.query(
        `INSERT INTO consumable_stocks (consumable_id, warehouse_id, stock, safe_stock) VALUES (?, ?, ?, ?)`,
        [consumableId, Number(w.id), isPrimary ? stock : 0, safeStock]
      );
    }
    await conn.commit();
    const [[row]] = await conn.query(
      `SELECT c.id, c.name, c.category, c.unit, c.qr_token AS qrToken, c.qr_enabled AS qrEnabled,
              COALESCE(s.stock, 0) AS stock, COALESCE(s.safe_stock, 0) AS safeStock
       FROM consumables c
       LEFT JOIN consumable_stocks s ON s.consumable_id = c.id AND s.warehouse_id = ?
       WHERE c.id = ?`,
      [warehouseId, consumableId]
    );
    return row;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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

async function createOperationLog(payload) {
  const result = await query(
    `INSERT INTO operation_logs (
      type, target_user_id, target_user_name, before_role, after_role,
      before_enabled, after_enabled, message,
      operator_id, operator_name, operator_role,
      request_id, trace_id, source, ip, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      String(payload.type || ''),
      payload.targetUserId ? Number(payload.targetUserId) : null,
      String(payload.targetUserName || ''),
      payload.beforeRole || null,
      payload.afterRole || null,
      typeof payload.beforeEnabled === 'boolean' ? (payload.beforeEnabled ? 1 : 0) : null,
      typeof payload.afterEnabled === 'boolean' ? (payload.afterEnabled ? 1 : 0) : null,
      String(payload.message || ''),
      payload.audit ? Number(payload.audit.operatorId || 0) : null,
      String(payload.operatorName || ''),
      payload.audit ? String(payload.audit.operatorRole || '') : '',
      payload.audit ? String(payload.audit.requestId || '') : '',
      payload.audit ? String(payload.audit.traceId || '') : '',
      payload.audit ? String(payload.audit.source || '') : '',
      payload.audit ? String(payload.audit.ip || '') : ''
    ]
  );

  const id = Number(result.insertId);
  const rows = await query(
    `SELECT id, type, target_user_id AS targetUserId, target_user_name AS targetUserName,
            before_role AS beforeRole, after_role AS afterRole,
            before_enabled AS beforeEnabled, after_enabled AS afterEnabled,
            message, operator_id AS operatorId, operator_name AS operatorName,
            operator_role AS operatorRole, request_id AS requestId, trace_id AS traceId,
            source, ip, created_at AS createdAt
     FROM operation_logs
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getOperationLogs() {
  return query(
    `SELECT id, type, target_user_id AS targetUserId, target_user_name AS targetUserName,
            before_role AS beforeRole, after_role AS afterRole,
            before_enabled AS beforeEnabled, after_enabled AS afterEnabled,
            message, operator_id AS operatorId, operator_name AS operatorName,
            operator_role AS operatorRole, request_id AS requestId, trace_id AS traceId,
            source, ip, created_at AS createdAt
     FROM operation_logs
     ORDER BY id DESC`
  );
}

async function updateUserById(id, payload = {}) {
  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    updates.push('enabled = ?');
    params.push(payload.enabled ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'role')) {
    updates.push('role = ?');
    params.push(String(payload.role));
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'roleUpdatedAt')) {
    updates.push('role_updated_at = ?');
    params.push(payload.roleUpdatedAt ? new Date(payload.roleUpdatedAt) : null);
  }

  if (updates.length === 0) {
    return getUserById(id);
  }

  params.push(Number(id));
  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  return getUserById(id);
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

function closePool() {
  if (!pool) return Promise.resolve();
  const current = pool;
  pool = null;
  return current.end();
}

module.exports = {
  useMySql,
  getUsers,
  getUserById,
  getUserByAccount,
  getUserBySso,
  updateUserById,
  createOperationLog,
  getOperationLogs,
  getWarehouses,
  getDashboardStats,
  getDevices,
  createDevice,
  getConsumables,
  createConsumable,
  getBorrows,
  getBorrowById,
  createBorrow,
  getConsumableApplications,
  getConsumableApplicationById,
  createConsumableApplication,
  getApprovals,
  applyApprovalAction,
  toApprovalView,
  closePool
};
