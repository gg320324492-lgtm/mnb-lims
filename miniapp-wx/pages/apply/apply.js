const { request, formatStatus, parseQrPayloadFromText } = require('../../utils/api');

Page({
  data: {
    loading: true,
    warehouses: [],
    selectedWarehouseIndex: 0,
    consumables: [],
    selectedConsumableIndex: 0,
    quantity: 1,
    purpose: '',
    matchedConsumableName: ''
  },

  onLoad(options = {}) {
    const parsed = parseQrPayloadFromText(options.consumableToken || options.qr || '');
    if (parsed && parsed.type === 'consumable') {
      getApp().globalData.scannedConsumableToken = parsed.token;
    }
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true, matchedConsumableName: '' });
    try {
      const warehouses = await request('/api/warehouses');
      const selectedWarehouse = warehouses[0] || { id: 1 };
      const consumables = await request(`/api/consumables?warehouseId=${selectedWarehouse.id}`);

      this.setData({
        warehouses,
        selectedWarehouseIndex: 0,
        consumables,
        selectedConsumableIndex: 0,
        loading: false
      });

      await this.tryApplyScannedConsumable(warehouses, consumables, 0);
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async onWarehouseChange(e) {
    const index = Number(e.detail.value);
    const warehouse = this.data.warehouses[index];
    this.setData({ selectedWarehouseIndex: index, matchedConsumableName: '' });

    try {
      const consumables = await request(`/api/consumables?warehouseId=${warehouse.id}`);
      this.setData({ consumables, selectedConsumableIndex: 0 });
      await this.tryApplyScannedConsumable(this.data.warehouses, consumables, index);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async tryApplyScannedConsumable(warehouses, consumables, warehouseIndex) {
    const app = getApp();
    const token = String(app.globalData.scannedConsumableToken || '').trim();
    if (!token) return;

    const warehouse = warehouses[warehouseIndex] || warehouses[0] || { id: 1 };
    app.globalData.scannedConsumableToken = '';

    try {
      const uid = Number(app.globalData.currentUserId || 0);
      const data = await request(`/api/qr/consumable/${encodeURIComponent(token)}?warehouseId=${warehouse.id}&userId=${uid}`);
      const index = consumables.findIndex(item => Number(item.id) === Number(data.id));
      if (index >= 0) {
        this.setData({ selectedConsumableIndex: index, matchedConsumableName: data.name || '' });
        wx.showToast({ title: '已匹配耗材', icon: 'success' });
      } else {
        wx.showToast({ title: '耗材不在当前仓库列表', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message || '耗材二维码无效', icon: 'none' });
    }
  },

  onScanQr() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: async (res) => {
        const parsed = parseQrPayloadFromText(res.result);
        if (!parsed || parsed.type !== 'consumable') {
          wx.showToast({ title: '请扫描耗材二维码', icon: 'none' });
          return;
        }

        getApp().globalData.scannedConsumableToken = parsed.token;
        await this.tryApplyScannedConsumable(
          this.data.warehouses,
          this.data.consumables,
          this.data.selectedWarehouseIndex
        );
      },
      fail: () => {
        wx.showToast({ title: '扫码已取消', icon: 'none' });
      }
    });
  },

  onConsumableChange(e) {
    this.setData({ selectedConsumableIndex: Number(e.detail.value), matchedConsumableName: '' });
  },

  onQuantityInput(e) {
    const val = Math.max(1, Number(e.detail.value || 1));
    this.setData({ quantity: val });
  },

  onPurposeInput(e) {
    this.setData({ purpose: e.detail.value });
  },

  async submitApply() {
    const { warehouses, selectedWarehouseIndex, consumables, selectedConsumableIndex, quantity, purpose } = this.data;
    const warehouse = warehouses[selectedWarehouseIndex];
    const consumable = consumables[selectedConsumableIndex];
    if (!warehouse || !consumable) {
      wx.showToast({ title: '请选择仓库和耗材', icon: 'none' });
      return;
    }

    try {
      await request('/api/consumable-applications', 'POST', {
        consumableId: consumable.id,
        warehouseId: warehouse.id,
        quantity,
        purpose
      });
      wx.showToast({ title: '申领申请已提交', icon: 'success' });
      this.setData({ quantity: 1, purpose: '', matchedConsumableName: '' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  formatStatusText(status) {
    return formatStatus(status);
  }
});
