const { request, formatStatus } = require('../../utils/api');

Page({
  data: {
    loading: true,
    apiBase: '',
    currentUserName: '-',
    borrows: [],
    applications: []
  },

  onShow() {
    const app = getApp();
    this.setData({ apiBase: app.globalData.apiBase });
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
        currentUserName: user ? user.name : `用户#${uid}`,
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
  }
});
