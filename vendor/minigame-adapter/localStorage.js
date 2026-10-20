class LocalStorage {
  constructor() {
    this.onChange = null;
  }

  get keys() {
    return wx.getStorageInfoSync().keys;
  }

  get length() {
    return this.keys.length;
  }

  key(n) {
    return this.keys[n];
  }

  getItem(key) {
    if (this.keys.includes(key)) {
      const result = wx.getStorageSync(key);
      if (result != null && result != undefined) {
        return String(result);
      }
    }
    return null;
  }

  setItem(key, value) {
    value = value != null && value != undefined ? String(value) : value;
    this.onChange?.('setItem', key, value);
    return this.innerSetItem(key, value);
  }
  removeItem(key) {
    this.onChange?.('removeItem', key);
    this.innerRemoveItem(key);
  }
  clear() {
    this.onChange?.('clear');
    this.innerClear();
  }

  // 自定义方法, 内部使用
  innerSetItem(key, value) {
    return wx.setStorageSync(key, value);
  }
  innerClear() {
    wx.clearStorageSync();
  }
  innerRemoveItem(key) {
    wx.removeStorageSync(key);
  }

  getAll() {
    const data = {};
    this.keys.forEach((key) => {
      data[key] = this.getItem(key);
    });
    return data;
  }

  setAll(data) {
    this.innerClear();
    if (!data) {
      return;
    }
    for (const key in data) {
      this.innerSetItem(key, data[key]);
    }
  }
}

export default new LocalStorage();
