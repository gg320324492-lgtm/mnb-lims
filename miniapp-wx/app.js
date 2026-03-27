function parseExpireToMs(input, fallbackMs) {
  const raw = String(input || '').trim();
  if (!raw) return fallbackMs;

  const m = raw.match(/^(\d+)([smhd])$/i);
  if (!m) {
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num * 1000 : fallbackMs;
  }

  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60 * 1000 : unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return value * factor;
}

App({
  globalData: {
    apiBase: 'http://localhost:3000',
    currentUserId: 3,
    users: [],
    scannedDeviceToken: '',
    scannedConsumableToken: '',
    accessToken: '',
    refreshToken: '',
    accessTokenExpiresAt: 0,
    refreshTokenExpiresAt: 0,
    me: null,
    authWarnedExpiring: false
  },

  onLaunch() {
    const savedApiBase = wx.getStorageSync('apiBase');
    const savedUserId = wx.getStorageSync('currentUserId');
    const accessToken = wx.getStorageSync('accessToken');
    const refreshToken = wx.getStorageSync('refreshToken');
    const accessTokenExpiresAt = Number(wx.getStorageSync('accessTokenExpiresAt') || 0);
    const refreshTokenExpiresAt = Number(wx.getStorageSync('refreshTokenExpiresAt') || 0);
    const me = wx.getStorageSync('authMe');

    if (savedApiBase) {
      this.globalData.apiBase = savedApiBase;
    }
    if (savedUserId) {
      this.globalData.currentUserId = Number(savedUserId);
    }
    if (accessToken) {
      this.globalData.accessToken = String(accessToken);
    }
    if (refreshToken) {
      this.globalData.refreshToken = String(refreshToken);
    }
    this.globalData.accessTokenExpiresAt = accessTokenExpiresAt;
    this.globalData.refreshTokenExpiresAt = refreshTokenExpiresAt;
    if (me) {
      this.globalData.me = me;
    }
  },

  setCurrentUser(userId) {
    const nextId = Number(userId);
    const userChanged = Number(this.globalData.currentUserId || 0) !== nextId;

    this.globalData.currentUserId = nextId;
    wx.setStorageSync('currentUserId', nextId);

    if (userChanged) {
      this.clearAuth();
      this.globalData.scannedDeviceToken = '';
      this.globalData.scannedConsumableToken = '';
    }

    return userChanged;
  },

  setApiBase(apiBase) {
    this.globalData.apiBase = String(apiBase || '').trim() || this.globalData.apiBase;
    wx.setStorageSync('apiBase', this.globalData.apiBase);
    this.clearAuth();
  },

  setAuth(authData) {
    const now = Date.now();
    const accessTtlMs = parseExpireToMs(authData.expiresIn, 15 * 60 * 1000);
    const refreshTtlMs = parseExpireToMs(authData.refreshExpiresIn || '7d', 7 * 24 * 60 * 60 * 1000);

    this.globalData.accessToken = String(authData.accessToken || '');
    this.globalData.refreshToken = String(authData.refreshToken || '');
    this.globalData.accessTokenExpiresAt = now + accessTtlMs;
    this.globalData.refreshTokenExpiresAt = now + refreshTtlMs;
    this.globalData.me = authData.user || null;
    this.globalData.authWarnedExpiring = false;

    wx.setStorageSync('accessToken', this.globalData.accessToken);
    wx.setStorageSync('refreshToken', this.globalData.refreshToken);
    wx.setStorageSync('accessTokenExpiresAt', this.globalData.accessTokenExpiresAt);
    wx.setStorageSync('refreshTokenExpiresAt', this.globalData.refreshTokenExpiresAt);
    wx.setStorageSync('authMe', this.globalData.me || null);
  },

  clearAuth() {
    this.globalData.accessToken = '';
    this.globalData.refreshToken = '';
    this.globalData.accessTokenExpiresAt = 0;
    this.globalData.refreshTokenExpiresAt = 0;
    this.globalData.me = null;
    this.globalData.authWarnedExpiring = false;
    wx.removeStorageSync('accessToken');
    wx.removeStorageSync('refreshToken');
    wx.removeStorageSync('accessTokenExpiresAt');
    wx.removeStorageSync('refreshTokenExpiresAt');
    wx.removeStorageSync('authMe');
  },

  notifyAuthExpiring(remainingMs) {
    if (this.globalData.authWarnedExpiring) return;
    this.globalData.authWarnedExpiring = true;
    const sec = Math.max(1, Math.ceil(Number(remainingMs || 0) / 1000));
    wx.showToast({
      title: `登录即将过期，正在续期（约${sec}s）`,
      icon: 'none',
      duration: 1500
    });
  },

  requestRaw(path, method = 'GET', data, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.globalData.apiBase}${path}`,
        method,
        data,
        header: {
          'Content-Type': 'application/json',
          'X-Client-Source': 'miniapp-wx',
          ...extraHeaders
        },
        success: (res) => resolve(res),
        fail: (err) => reject(new Error(err.errMsg || '网络请求失败'))
      });
    });
  },

  async loginByWechat() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: async (res) => {
          if (!res.code) {
            reject(new Error('获取微信 code 失败'));
            return;
          }
          try {
            const loginRes = await this.requestRaw('/api/auth/login', 'POST', {
              loginType: 'wechat',
              wxCode: res.code
            });
            const body = loginRes.data || {};
            if (loginRes.statusCode < 200 || loginRes.statusCode >= 300 || body.code !== 0 || !body.data) {
              reject(new Error(body.message || '微信登录失败'));
              return;
            }
            this.setAuth(body.data);
            if (body.data.user) {
              this.globalData.currentUserId = Number(body.data.user.id) || this.globalData.currentUserId;
              wx.setStorageSync('currentUserId', this.globalData.currentUserId);
            }
            resolve(body.data);
          } catch (err) {
            reject(err);
          }
        },
        fail: () => reject(new Error('微信登录接口调用失败'))
      });
    });
  },

  async loginByCurrentUser() {
    const userId = Number(this.globalData.currentUserId || 0);
    if (!userId) {
      throw new Error('缺少当前用户，无法登录');
    }

    const res = await this.requestRaw('/api/auth/login', 'POST', {
      loginType: 'userId',
      userId
    });
    const body = res.data || {};
    if (res.statusCode < 200 || res.statusCode >= 300 || body.code !== 0 || !body.data) {
      throw new Error(body.message || '登录失败');
    }

    this.setAuth(body.data);
    return body.data;
  },

  async refreshAccessToken() {
    const refreshToken = String(this.globalData.refreshToken || '');
    if (!refreshToken) {
      throw new Error('refreshToken 缺失');
    }
    if (Number(this.globalData.refreshTokenExpiresAt || 0) <= Date.now()) {
      throw new Error('refreshToken 已过期');
    }

    const res = await this.requestRaw('/api/auth/refresh', 'POST', { refreshToken });
    const body = res.data || {};
    if (res.statusCode < 200 || res.statusCode >= 300 || body.code !== 0 || !body.data) {
      throw new Error(body.message || '刷新登录态失败');
    }

    this.setAuth(body.data);
    return body.data;
  },

  async ensureAuthReady() {
    const now = Date.now();
    const remainAccessMs = Number(this.globalData.accessTokenExpiresAt || 0) - now;

    if (this.globalData.accessToken && remainAccessMs > 5000) {
      if (remainAccessMs <= 60_000) {
        this.notifyAuthExpiring(remainAccessMs);
      }
      return this.globalData.accessToken;
    }

    if (this.globalData.refreshToken && Number(this.globalData.refreshTokenExpiresAt || 0) > now + 5000) {
      const refreshed = await this.refreshAccessToken();
      return refreshed.accessToken;
    }

    const auth = await this.loginByCurrentUser();
    return auth.accessToken;
  },

  async forceRelogin() {
    this.clearAuth();
    const auth = await this.loginByCurrentUser();
    return auth.accessToken;
  }
});
