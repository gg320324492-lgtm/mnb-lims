const { request, formatStatus, parseQrPayloadFromText } = require('../../utils/api');

Page({
  data: {
    loading: true,
    devices: [],
    selectedDeviceIndex: 0,
    purpose: '',
    borrowDate: '',
    expectedReturnDate: '',
    matchedDeviceName: ''
  },

  onLoad(options = {}) {
    const parsed = parseQrPayloadFromText(options.deviceToken || options.qr || '');
    if (parsed && parsed.type === 'device') {
      getApp().globalData.scannedDeviceToken = parsed.token;
    }
  },

  onShow() {
    this.initDates();
    this.loadData();
  },

  initDates() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 1);

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    this.setData({
      borrowDate: fmt(now),
      expectedReturnDate: fmt(next)
    });
  },

  async loadData() {
    this.setData({ loading: true, matchedDeviceName: '' });
    try {
      const devices = await request('/api/devices');
      const list = devices.map(d => ({
        ...d,
        statusText: formatStatus(d.status)
      }));

      this.setData({ devices: list, loading: false, selectedDeviceIndex: 0 });
      await this.tryApplyScannedDevice(list);
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async tryApplyScannedDevice(devices) {
    const app = getApp();
    const token = String(app.globalData.scannedDeviceToken || '').trim();
    if (!token) return;

    app.globalData.scannedDeviceToken = '';

    try {
      const uid = Number(app.globalData.currentUserId || 0);
      const device = await request(`/api/qr/device/${encodeURIComponent(token)}?userId=${uid}`);
      const index = devices.findIndex(item => Number(item.id) === Number(device.id));
      if (index >= 0) {
        this.setData({ selectedDeviceIndex: index, matchedDeviceName: device.name || '' });
        wx.showToast({ title: '已匹配设备', icon: 'success' });
      } else {
        wx.showToast({ title: '设备不在当前列表', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message || '设备二维码无效', icon: 'none' });
    }
  },

  onScanQr() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: async (res) => {
        const parsed = parseQrPayloadFromText(res.result);
        if (!parsed || parsed.type !== 'device') {
          wx.showToast({ title: '请扫描设备二维码', icon: 'none' });
          return;
        }

        getApp().globalData.scannedDeviceToken = parsed.token;
        await this.tryApplyScannedDevice(this.data.devices || []);
      },
      fail: () => {
        wx.showToast({ title: '扫码已取消', icon: 'none' });
      }
    });
  },

  onDeviceChange(e) {
    this.setData({ selectedDeviceIndex: Number(e.detail.value), matchedDeviceName: '' });
  },

  onPurposeInput(e) {
    this.setData({ purpose: e.detail.value });
  },

  onBorrowDateChange(e) {
    this.setData({ borrowDate: e.detail.value });
  },

  onReturnDateChange(e) {
    this.setData({ expectedReturnDate: e.detail.value });
  },

  async submitBorrow() {
    const { devices, selectedDeviceIndex, purpose, borrowDate, expectedReturnDate } = this.data;
    const selected = devices[selectedDeviceIndex];
    if (!selected) {
      wx.showToast({ title: '请选择设备', icon: 'none' });
      return;
    }

    try {
      await request('/api/borrows', 'POST', {
        deviceId: selected.id,
        purpose,
        borrowDate,
        expectedReturnDate,
        expectedReturnTime: '18:00'
      });
      wx.showToast({ title: '借用申请已提交', icon: 'success' });
      this.setData({ purpose: '', matchedDeviceName: '' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  }
});
