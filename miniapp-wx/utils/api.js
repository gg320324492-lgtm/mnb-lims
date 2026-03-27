function getAppSafe() {
  return getApp();
}

function getApiBase() {
  const app = getAppSafe();
  return app.globalData.apiBase;
}

async function request(path, method = 'GET', data, options = {}) {
  const app = getAppSafe();
  const requiresAuth = options.auth !== false;

  const doRequest = async (token) => {
    const header = {
      'Content-Type': 'application/json'
    };
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }

    return app.requestRaw(path, method, data, header);
  };

  try {
    const token = requiresAuth ? await app.ensureAuthReady() : '';
    const res = await doRequest(token);
    const body = res.data || {};

    if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
      return body.data;
    }

    if (requiresAuth && res.statusCode === 401) {
      const notices = Array.isArray(body.data && body.data.notices) ? body.data.notices : [];
      if (notices.some((n) => n && n.type === 'ROLE_CHANGED')) {
        wx.showToast({ title: '检测到角色变更，正在重新登录', icon: 'none' });
      }
      if (notices.some((n) => n && n.type === 'ACCOUNT_DISABLED')) {
        app.clearAuth();
        wx.showModal({
          title: '账号已禁用',
          content: '当前账号已被禁用，请联系管理员。',
          showCancel: false
        });
        throw new Error(body.message || '账号已禁用');
      }

      const refreshed = await app.refreshAccessToken();
      const retryRes = await doRequest(refreshed.accessToken);
      const retryBody = retryRes.data || {};
      if (retryRes.statusCode >= 200 && retryRes.statusCode < 300 && retryBody.code === 0) {
        return retryBody.data;
      }
      throw new Error(retryBody.message || `请求失败(${retryRes.statusCode})`);
    }

    throw new Error(body.message || `请求失败(${res.statusCode})`);
  } catch (err) {
    if (requiresAuth && /refreshToken|401|过期|登录/.test(String(err.message || ''))) {
      try {
        const newToken = await app.forceRelogin();
        const reloginRes = await doRequest(newToken);
        const reloginBody = reloginRes.data || {};
        if (reloginRes.statusCode >= 200 && reloginRes.statusCode < 300 && reloginBody.code === 0) {
          return reloginBody.data;
        }
        throw new Error(reloginBody.message || `请求失败(${reloginRes.statusCode})`);
      } catch (reloginErr) {
        app.clearAuth();
        wx.showModal({
          title: '登录失效',
          content: '登录状态已失效，请重新进入页面重试。',
          showCancel: false
        });
        throw new Error(reloginErr.message || '重新登录失败');
      }
    }

    throw new Error(err.message || '网络请求失败');
  }
}

function formatStatus(status) {
  const map = {
    pending: '待审批',
    approved: '已通过',
    rejected: '已驳回',
    borrowed: '借出中',
    returned: '已归还',
    cancelled: '已取消',
    available: '可用'
  };
  return map[status] || status || '-';
}

function parseQrPayloadFromText(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (lower.startsWith('dev_')) {
    return { type: 'device', token: text };
  }
  if (lower.startsWith('cons_')) {
    return { type: 'consumable', token: text };
  }

  const queryIndex = text.indexOf('?');
  if (queryIndex >= 0) {
    const query = text.slice(queryIndex + 1);
    const parts = query.split('&');
    for (let i = 0; i < parts.length; i += 1) {
      const [rawKey, rawVal] = parts[i].split('=');
      const key = decodeURIComponent(String(rawKey || ''));
      const value = decodeURIComponent(String(rawVal || ''));
      if (key === 'deviceToken' && value) {
        return { type: 'device', token: value };
      }
      if (key === 'consumableToken' && value) {
        return { type: 'consumable', token: value };
      }
    }
  }

  const m1 = text.match(/\/api\/qr\/device\/([^/?#]+)/i);
  if (m1 && m1[1]) {
    return { type: 'device', token: decodeURIComponent(m1[1]) };
  }

  const m2 = text.match(/\/api\/qr\/consumable\/([^/?#]+)/i);
  if (m2 && m2[1]) {
    return { type: 'consumable', token: decodeURIComponent(m2[1]) };
  }

  return null;
}

module.exports = {
  request,
  formatStatus,
  parseQrPayloadFromText,
  getApiBase
};
