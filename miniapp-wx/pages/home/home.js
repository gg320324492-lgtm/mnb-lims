const { request, formatStatus, parseQrPayloadFromText } = require('../../utils/api');

Page({
  data: {
    loading: true,
    users: [],
    currentUserId: 3,
    currentUserIndex: 0,
    currentUserName: '加载中',
    stats: {
      devicesCount: 0,
      consumablesCount: 0,
      pendingApprovals: 0,
      lowStockCount: 0
    },
    myTodos: []
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    const app = getApp();

    try {
      const [users, stats, borrows, applications] = await Promise.all([
        request('/api/users'),
        request('/api/dashboard/stats'),
        request('/api/borrows'),
        request('/api/consumable-applications')
      ]);

      app.globalData.users = users;
      const uid = Number(app.globalData.currentUserId || 3);
      const userIndex = users.findIndex(item => Number(item.id) === uid);
      const safeIndex = userIndex >= 0 ? userIndex : 0;
      const userName = users[safeIndex] ? users[safeIndex].name : '未选择';
      const safeUid = users[safeIndex] ? Number(users[safeIndex].id) : uid;
      app.setCurrentUser(safeUid);
      const myBorrowTodos = borrows
        .filter(item => Number(item.userId) === safeUid && item.status === 'pending')
        .map(item => ({
          id: `b-${item.id}`,
          title: `借用：${item.deviceName || '设备'}`,
          desc: `${item.borrowDate} ~ ${item.expectedReturnDate}`,
          statusText: formatStatus(item.status),
          statusClass: item.status
        }));

      const myApplyTodos = applications
        .filter(item => Number(item.userId) === safeUid && item.status === 'pending')
        .map(item => ({
          id: `a-${item.id}`,
          title: `申领：${item.consumableName || '耗材'}`,
          desc: `数量 ${item.quantity} / ${item.purpose || '未填写用途'}`,
          statusText: formatStatus(item.status),
          statusClass: item.status
        }));

      this.setData({
        users,
        currentUserId: safeUid,
        currentUserIndex: safeIndex,
        currentUserName: userName,
        stats,
        myTodos: [...myBorrowTodos, ...myApplyTodos],
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onUserChange(e) {
    const index = Number(e.detail.value);
    const user = this.data.users[index];
    if (!user) return;

    const userId = Number(user.id);
    const app = getApp();
    app.setCurrentUser(userId);
    this.setData({
      currentUserId: userId,
      currentUserIndex: index,
      currentUserName: user.name
    });
    this.loadData();
  },

  onScanQr() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const parsed = parseQrPayloadFromText(res.result);
        if (!parsed) {
          wx.showToast({ title: '无法识别二维码内容', icon: 'none' });
          return;
        }

        if (parsed.type === 'device') {
          wx.switchTab({
            url: '/pages/borrow/borrow',
            success: () => {
              getApp().globalData.scannedDeviceToken = parsed.token;
            }
          });
          return;
        }

        if (parsed.type === 'consumable') {
          wx.switchTab({
            url: '/pages/apply/apply',
            success: () => {
              getApp().globalData.scannedConsumableToken = parsed.token;
            }
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '扫码已取消', icon: 'none' });
      }
    });
  }
});
