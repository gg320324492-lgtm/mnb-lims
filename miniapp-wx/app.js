App({
  globalData: {
    apiBase: 'http://localhost:3000',
    currentUserId: 3,
    users: [],
    scannedDeviceToken: '',
    scannedConsumableToken: ''
  },

  onLaunch() {
    const savedApiBase = wx.getStorageSync('apiBase');
    const savedUserId = wx.getStorageSync('currentUserId');

    if (savedApiBase) {
      this.globalData.apiBase = savedApiBase;
    }
    if (savedUserId) {
      this.globalData.currentUserId = Number(savedUserId);
    }
  },

  setCurrentUser(userId) {
    this.globalData.currentUserId = Number(userId);
    wx.setStorageSync('currentUserId', Number(userId));
  },

  setApiBase(apiBase) {
    this.globalData.apiBase = String(apiBase || '').trim() || this.globalData.apiBase;
    wx.setStorageSync('apiBase', this.globalData.apiBase);
  }
});
