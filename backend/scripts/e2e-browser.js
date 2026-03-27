const path = require('path');
const { chromium } = require('playwright');

process.env.PORT = process.env.E2E_BROWSER_PORT || '3903';
process.env.USE_MYSQL = process.env.USE_MYSQL || 'false';

const app = require(path.resolve(__dirname, '../src/app'));
const mysqlStore = require(path.resolve(__dirname, '../src/data/mysqlStore'));

async function request(baseUrl, method, pathname, body, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function loginByPassword(baseUrl, account, password) {
  const result = await request(baseUrl, 'POST', '/api/auth/login', {
    loginType: 'password',
    account,
    password
  });
  if (result.status !== 200 || result.data.code !== 0 || !result.data.data) {
    throw new Error(`login failed for ${account}`);
  }
  return result.data.data;
}

async function setUserRole(baseUrl, adminToken, userId, role) {
  const result = await request(baseUrl, 'PATCH', `/api/users/${userId}`, { role }, adminToken);
  if (result.status !== 200 || result.data.code !== 0) {
    throw new Error(`set user role failed: userId=${userId}, role=${role}`);
  }
}

async function setUserEnabled(baseUrl, adminToken, userId, enabled) {
  const result = await request(baseUrl, 'PATCH', `/api/users/${userId}`, { enabled }, adminToken);
  if (result.status !== 200 || result.data.code !== 0) {
    throw new Error(`set user enabled failed: userId=${userId}, enabled=${enabled}`);
  }
}

async function run() {
  const port = Number(process.env.PORT || 3903);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = app.listen(port);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let teacherRoleChanged = false;
  let teacherDisabled = false;

  try {
    // H5 提交流程
    await page.goto(`${baseUrl}/miniapp/legacy-h5/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#borrow-form', { state: 'attached' });
    await page.waitForFunction(() => typeof window.handleBorrowReturn === 'function');

    await page.click('.tab-item[data-page="borrow"]');
    await page.waitForSelector('#borrow-form', { state: 'visible' });
    await page.selectOption('#borrow-device', { index: 1 }).catch(async () => {
      const options = await page.locator('#borrow-device option').count();
      if (options > 0) await page.selectOption('#borrow-device', { index: 0 });
    });
    await page.fill('#borrow-form textarea[name="purpose"]', 'playwright-h5-borrow');
    await page.fill('#borrow-form input[name="borrowDate"]', '2026-03-26');
    await page.fill('#borrow-form input[name="expectedReturnDate"]', '2026-03-27');
    await page.fill('#borrow-form input[name="expectedReturnTime"]', '18:00');
    await page.click('#borrow-form button[type="submit"]');

    await page.click('.tab-item[data-page="apply"]');
    await page.waitForSelector('#apply-form', { state: 'visible' });
    await page.selectOption('#apply-warehouse', { index: 0 });
    await page.selectOption('#apply-consumable', { index: 0 });
    await page.fill('#apply-form input[name="quantity"]', '1');
    await page.fill('#apply-form textarea[name="purpose"]', 'playwright-h5-apply');
    await page.click('#apply-form button[type="submit"]');

    // Admin 正常审批流程
    await page.goto(`${baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#auth-login-type');
    await page.selectOption('#auth-login-type', 'password');
    await page.fill('#auth-account', 'teacher.li');
    await page.fill('#auth-password', 'teacher123');
    await page.click('#auth-login-btn');

    await page.click('.menu-item[data-section="approvals"]');
    await page.waitForSelector('#approvals-table table');

    const approveBtn = page.locator('#approvals-table .action-btn.approve').first();
    const rejectBtn = page.locator('#approvals-table .action-btn.reject').first();

    if ((await approveBtn.count()) === 0 || (await rejectBtn.count()) === 0) {
      throw new Error('approvals action buttons not found');
    }

    page.once('dialog', (dialog) => dialog.accept('playwright approve'));
    await approveBtn.click();

    await page.waitForTimeout(300);
    page.once('dialog', (dialog) => dialog.accept('playwright reject'));
    await rejectBtn.click();

    // 异常场景1：模拟 access token 过期（首个接口401，触发 refresh 后恢复）
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      let injected = false;
      window.fetch = async (...args) => {
        const url = String(args[0] || '');
        if (!injected && url.includes('/api/dashboard/stats')) {
          injected = true;
          return new Response(JSON.stringify({ code: 401, message: 'mock expired access token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return original(...args);
      };
    });

    const refreshPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/auth/refresh') && resp.request().method() === 'POST',
      { timeout: 5000 }
    );
    await page.click('#refresh-btn');
    await refreshPromise;
    await page.waitForTimeout(400);

    const adminAuth = await loginByPassword(baseUrl, 'admin', 'admin123');

    // 异常场景2：角色变更（teacher -> student）后，前端刷新应提示重新登录
    await setUserRole(baseUrl, adminAuth.accessToken, 2, 'student');
    teacherRoleChanged = true;

    await page.click('#refresh-btn');
    await page.waitForTimeout(800);
    const roleChangedMsg = await page.locator('#global-message').innerText();
    if (!/角色已变更|重新登录/.test(String(roleChangedMsg))) {
      throw new Error('role-changed scenario not handled in browser flow');
    }

    // 恢复教师角色并重新登录 teacher
    await setUserRole(baseUrl, adminAuth.accessToken, 2, 'teacher');
    teacherRoleChanged = false;

    await page.fill('#auth-account', 'teacher.li');
    await page.fill('#auth-password', 'teacher123');
    await page.click('#auth-login-btn');
    await page.waitForTimeout(500);

    // 异常场景3：账号禁用后刷新，前端应提示账号禁用
    await setUserEnabled(baseUrl, adminAuth.accessToken, 2, false);
    teacherDisabled = true;

    await page.click('#refresh-btn');
    await page.waitForTimeout(800);
    const disabledMsg = await page.locator('#global-message').innerText();
    if (!/禁用/.test(String(disabledMsg))) {
      throw new Error('account-disabled scenario not handled in browser flow');
    }

    console.log('[e2e-browser] normal + exception scenarios passed');
  } finally {
    try {
      const adminAuth = await loginByPassword(baseUrl, 'admin', 'admin123');
      if (teacherRoleChanged) {
        await setUserRole(baseUrl, adminAuth.accessToken, 2, 'teacher');
      }
      if (teacherDisabled) {
        await setUserEnabled(baseUrl, adminAuth.accessToken, 2, true);
      }
    } catch (recoverErr) {
      console.error(`[e2e-browser] recover warning: ${recoverErr.message}`);
    }

    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await mysqlStore.closePool();
  }
}

run().catch((err) => {
  console.error(`[e2e-browser] failed: ${err.message}`);
  process.exit(1);
});
