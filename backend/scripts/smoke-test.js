const path = require('path');
const http = require('http');

process.env.PORT = process.env.SMOKE_PORT || '3900';
process.env.USE_MYSQL = process.env.USE_MYSQL || 'false';

const app = require(path.resolve(__dirname, '../src/app'));

function httpRequest(port, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, data });
          } catch (err) {
            reject(new Error(`Invalid JSON response from ${pathname}`));
          }
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(port, account, password) {
  const result = await httpRequest(port, 'POST', '/api/auth/login', {
    loginType: 'password',
    account,
    password
  });
  if (result.status !== 200 || result.data.code !== 0) {
    throw new Error(`login failed for account=${account}`);
  }
  return result.data.data;
}

async function run() {
  const port = Number(process.env.PORT || 3900);
  const server = app.listen(port);

  try {
    const health = await httpRequest(port, 'GET', '/api/health');
    if (health.status !== 200 || health.data.code !== 0) {
      throw new Error('health check failed');
    }

    const studentAuth = await login(port, 'student.wang', 'student123');
    const teacherAuth = await login(port, 'teacher.li', 'teacher123');

    const me = await httpRequest(port, 'GET', '/api/auth/me', null, {
      Authorization: `Bearer ${studentAuth.accessToken}`
    });
    if (me.status !== 200 || me.data.code !== 0) {
      throw new Error('auth/me failed');
    }

    const studentLogs = await httpRequest(port, 'GET', '/api/users/operation-logs?page=1&pageSize=5', null, {
      Authorization: `Bearer ${studentAuth.accessToken}`
    });
    if (studentLogs.status !== 403) {
      throw new Error('student permission boundary failed');
    }

    const borrowCreate = await httpRequest(
      port,
      'POST',
      '/api/borrows',
      {
        deviceId: 1,
        purpose: 'smoke-borrow',
        borrowDate: '2026-03-26',
        expectedReturnDate: '2026-03-27',
        expectedReturnTime: '18:00'
      },
      { Authorization: `Bearer ${studentAuth.accessToken}` }
    );
    if (borrowCreate.status !== 201 || borrowCreate.data.code !== 0) {
      throw new Error('borrow create failed');
    }

    const applyCreate = await httpRequest(
      port,
      'POST',
      '/api/consumable-applications',
      {
        consumableId: 1,
        warehouseId: 1,
        quantity: 1,
        purpose: 'smoke-apply'
      },
      { Authorization: `Bearer ${studentAuth.accessToken}` }
    );
    if (applyCreate.status !== 201 || applyCreate.data.code !== 0) {
      throw new Error('consumable application create failed');
    }

    const approvalsByTeacher = await httpRequest(port, 'GET', '/api/approvals?status=pending&page=1&pageSize=50', null, {
      Authorization: `Bearer ${teacherAuth.accessToken}`
    });
    if (approvalsByTeacher.status !== 200 || approvalsByTeacher.data.code !== 0) {
      throw new Error('teacher approvals list failed');
    }

    const borrowId = Number(borrowCreate.data.data.id);
    const appId = Number(applyCreate.data.data.id);
    const approvals = (approvalsByTeacher.data.data && approvalsByTeacher.data.data.items) || [];

    const borrowApproval = approvals.find((item) => item.type === 'borrow' && Number(item.businessId) === borrowId);
    const applyApproval = approvals.find(
      (item) => item.type === 'consumable_application' && Number(item.businessId) === appId
    );

    if (!borrowApproval || !applyApproval) {
      throw new Error('cannot find created approvals in pending list');
    }

    const approveBorrow = await httpRequest(
      port,
      'POST',
      `/api/approvals/${borrowApproval.id}/action`,
      { status: 'approved', remark: 'smoke pass' },
      { Authorization: `Bearer ${teacherAuth.accessToken}` }
    );
    if (approveBorrow.status !== 200 || approveBorrow.data.code !== 0) {
      throw new Error('approve borrow failed');
    }

    const rejectApply = await httpRequest(
      port,
      'POST',
      `/api/approvals/${applyApproval.id}/action`,
      { status: 'rejected', remark: 'smoke reject' },
      { Authorization: `Bearer ${teacherAuth.accessToken}` }
    );
    if (rejectApply.status !== 200 || rejectApply.data.code !== 0) {
      throw new Error('reject application failed');
    }

    const refresh = await httpRequest(port, 'POST', '/api/auth/refresh', { refreshToken: studentAuth.refreshToken });
    if (refresh.status !== 200 || refresh.data.code !== 0 || !refresh.data.data.accessToken) {
      throw new Error('refresh failed');
    }

    const invalidRefresh = await httpRequest(port, 'POST', '/api/auth/refresh', { refreshToken: 'invalid-token' });
    if (invalidRefresh.status !== 401) {
      throw new Error('invalid refresh token boundary failed');
    }

    console.log('[smoke] approvals/borrow/apply passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(`[smoke] failed: ${err.message}`);
  process.exit(1);
});
