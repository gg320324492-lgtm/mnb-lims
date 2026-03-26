function getAppSafe() {
  return getApp();
}

function getApiBase() {
  const app = getAppSafe();
  return app.globalData.apiBase;
}

function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBase()}${path}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json'
      },
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data);
          return;
        }
        reject(new Error(body.message || `请求失败(${res.statusCode})`));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败'));
      }
    });
  });
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
  parseQrPayloadFromText
};
