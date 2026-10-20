const systemInfo = wx.getSystemInfoSync();

const performance = wx.getPerformance();
const startTime = Date.now();
performance.now = function() {
  return Date.now() - startTime;
}

export {systemInfo, performance}