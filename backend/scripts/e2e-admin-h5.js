const path = require('path');
const http = require('http');

process.env.PORT = process.env.E2E_PORT || '3901';
process.env.USE_MYSQL = process.env.USE_MYSQL || 'false';

const app = require(path.resolve(__dirname, '../src/app'));

function request(port, method, pathname, body, headers = {}) {
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
          const data = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode, data });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(port, account, password) {
  const res = await request(port, 'POST', '/api/auth/login', {
    loginType: 'password',
    account,
    password
  });
  if (res.status !== 200 || res.data.code !== 0) {
    throw new Error(`login failed for account=${account}`);
  }
  return res.data.data;
}

async function run() {
  const port = Number(process.env.PORT || 3901);
  const server = app.listen(port);

  try {
    const student = await login(port, 'student.wang', 'student123');
    const teacher = await login(port, 'teacher.li', 'teacher123');

    // H5: student creates borrow + apply
    const borrow = await request(
      port,
      'POST',
      '/api/borrows',
      {
        deviceId: 1,
        userId: 3,
        purpose: 'h5-e2e-borrow',
        borrowDate: '2026-03-26',
        expectedReturnDate: '2026-03-27',
        expectedReturnTime: '18:00'
      },
      { Authorization: `Bearer ${student.accessToken}` }
    );
    if (borrow.status !== 201 || borrow.data.code !== 0) {
      throw new Error('h5 borrow flow failed');
    }

    const apply = await request(
      port,
      'POST',
      '/api/consumable-applications',
      {
        consumableId: 1,
        warehouseId: 1,
        quantity: 1,
        purpose: 'h5-e2e-apply'
      },
      { Authorization: `Bearer ${student.accessToken}` }
    );
    if (apply.status !== 201 || apply.data.code !== 0) {
      throw new Error('h5 apply flow failed');
    }

    // Admin: teacher approves borrow, rejects apply
    const pending = await request(port, 'GET', '/api/approvals?status=pending&page=1&pageSize=100', null, {
      Authorization: `Bearer ${teacher.accessToken}`
    });
    if (pending.status !== 200 || pending.data.code !== 0) {
      throw new Error('admin approvals fetch failed');
    }

    const studentReadLogs = await request(port, 'GET', '/api/users/operation-logs?page=1&pageSize=5', null, {
      Authorization: `Bearer ${student.accessToken}`
    });
    if (studentReadLogs.status !== 403) {
      throw new Error('permission check failed: student should not read operation logs');
    }

    const hugeApply = await request(
      port,
      'POST',
      '/api/consumable-applications',
      {
        consumableId: 1,
        warehouseId: 1,
        quantity: 99999,
        purpose: 'stock-overflow-test'
      },
      { Authorization: `Bearer ${student.accessToken}` }
    );
    if (hugeApply.status !== 201 || hugeApply.data.code !== 0) {
      throw new Error('huge apply create failed');
    }

    const pendingAfterHuge = await request(port, 'GET', '/api/approvals?status=pending&page=1&pageSize=200', null, {
      Authorization: `Bearer ${teacher.accessToken}`
    });
    if (pendingAfterHuge.status !== 200 || pendingAfterHuge.data.code !== 0) {
      throw new Error('pending approvals fetch after huge apply failed');
    }

    const approvals = (pending.data.data && pending.data.data.items) || [];
    const borrowApproval = approvals.find(
      (item) => item.type === 'borrow' && Number(item.businessId) === Number(borrow.data.data.id)
    );
    const applyApproval = approvals.find(
      (item) => item.type === 'consumable_application' && Number(item.businessId) === Number(apply.data.data.id)
    );

    if (!borrowApproval || !applyApproval) {
      throw new Error('cannot find pending approvals for created records');
    }

    const passRes = await request(
      port,
      'POST',
      `/api/approvals/${borrowApproval.id}/action`,
      { status: 'approved', remark: 'admin e2e pass' },
      { Authorization: `Bearer ${teacher.accessToken}` }
    );
    if (passRes.status !== 200 || passRes.data.code !== 0) {
      throw new Error('admin approve flow failed');
    }

    const rejectRes = await request(
      port,
      'POST',
      `/api/approvals/${applyApproval.id}/action`,
      { status: 'rejected', remark: 'admin e2e reject' },
      { Authorization: `Bearer ${teacher.accessToken}` }
    );
    if (rejectRes.status !== 200 || rejectRes.data.code !== 0) {
      throw new Error('admin reject flow failed');
    }

    const approvalsAfterHuge = (pendingAfterHuge.data.data && pendingAfterHuge.data.data.items) || [];
    const hugeApplyApproval = approvalsAfterHuge.find(
      (item) => item.type === 'consumable_application' && Number(item.businessId) === Number(hugeApply.data.data.id)
    );
    if (!hugeApplyApproval) {
      throw new Error('cannot find huge apply approval');
    }

    const approveHugeRes = await request(
      port,
      'POST',
      `/api/approvals/${hugeApplyApproval.id}/action`,
      { status: 'approved', remark: 'try approve huge apply' },
      { Authorization: `Bearer ${teacher.accessToken}` }
    );
    if (approveHugeRes.status !== 400) {
      throw new Error('inventory boundary failed: huge apply should not be approved');
    }

    console.log('[e2e] admin+h5 key approval flows passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(`[e2e] failed: ${err.message}`);
  process.exit(1);
});
