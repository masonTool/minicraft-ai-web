import { systemInfo } from "./WxInfo"

const IOS_appVersion = '5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML; like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const IOS_userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML; like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const Andorid_appVersion = '5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML; like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
const Android_userAgent = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML; like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';

class Navigator {
  constructor() {
    this.mockIOS = false;
    this.platform = systemInfo.platform;
    this.language = 'zh-cn';
    this.onLine = true; // TODO 用 wx.getNetworkStateChange 和 wx.onNetworkStateChange 来返回真实的状态
  
    // TODO 用 wx.getLocation 来封装 geolocation
    this.geolocation = {
      getCurrentPosition: ()=>{},
      watchPosition: ()=>{},
      clearWatch: ()=>{}
    };
    this.isCocoonJS = false;
    this.maxTouchPoints = 1;
    this.vibrate = function(){};//TODO 添加震动
  }

  get appVersion() {
    return this.mockIOS ? IOS_appVersion: Andorid_appVersion;
  }

  get userAgent() {
    return this.mockIOS ? IOS_userAgent: Android_userAgent;
  }

  get vendor() {
    return this.mockIOS ? 'Apple' : 'Google Inc.';
  } 
}

const navigator = new Navigator();
export { navigator, Navigator };
