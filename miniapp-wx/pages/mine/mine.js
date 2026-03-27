const { request, formatStatus } = require('../../utils/api');

Page({
  data: {
    loading: true,
    apiBase: '',
    currentUserName: '-',
    currentUserRole: '',
    isLoggedIn: false,
    wxLoginLoading: false,
    borrows: [],
    applications: []
  },

  onShow() {
    const app = getApp();
    this.setData({
      apiBase: app.globalData.apiBase,
      isLoggedIn: !!app.globalData.accessToken,
      currentUserName: app.globalData.me ? (app.globalData.me.name || '-') : '-',
      currentUserRole: app.globalData.me ? (app.globalData.me.role || '') : ''
    });
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    const app = getApp();
    const uid = Number(app.globalData.currentUserId || 0);

    try {
      const [users, borrows, applications] = await Promise.all([
        request('/api/users'),
        request('/api/borrows'),
        request('/api/consumable-applications')
      ]);

      const user = users.find(u => Number(u.id) === uid);
      this.setData({
        currentUserName: user ? user.name : (app.globalData.me ? app.globalData.me.name : `用户#${uid}`),
        currentUserRole: user ? user.role : (app.globalData.me ? app.globalData.me.role : ''),
        isLoggedIn: !!app.globalData.accessToken,
        borrows: borrows
          .filter(item => Number(item.userId) === uid)
          .map(item => ({ ...item, statusText: formatStatus(item.status) })),
        applications: applications
          .filter(item => Number(item.userId) === uid)
          .map(item => ({ ...item, statusText: formatStatus(item.status) })),
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onApiInput(e) {
    this.setData({ apiBase: e.detail.value });
  },

  saveApiBase() {
    const api = String(this.data.apiBase || '').trim();
    if (!api) {
      wx.showToast({ title: '请输入后端地址', icon: 'none' });
      return;
    }
    getApp().setApiBase(api);
    wx.showToast({ title: '后端地址已保存', icon: 'success' });
  },

  async onWxLogin() {
    if (this.data.wxLoginLoading) return;
    this.setData({ wxLoginLoading: true });
    const app = getApp();
    try {
      const data = await app.loginByWechat();
      const user = data.user || {};
      this.setData({
        isLoggedIn: true,
        currentUserName: user.name || '-',
        currentUserRole: user.role || '',
        wxLoginLoading: false
      });
      wx.showToast({
        title: data.isNewUser ? '注册并登录成功' : '微信登录成功',
        icon: 'success'
      });
      this.loadData();
    } catch (err) {
      this.setData({ wxLoginLoading: false });
      wx.showToast({ title: err.message || '微信登录失败', icon: 'none' });
    }
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          getApp().clearAuth();
          this.setData({
            isLoggedIn: false,
            currentUserName: '-',
            currentUserRole: '',
            borrows: [],
            applications: []
          });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        }
      }
    });
  }
});
