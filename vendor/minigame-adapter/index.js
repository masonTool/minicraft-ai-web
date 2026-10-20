import _window from './window';
import { systemInfo } from './WxInfo';
import { compatWxEvents } from './WxEvent';

const global = GameGlobal;

function inject() {
  // 开发者工具无法重定义 window
  if (systemInfo.platform === 'devtools') {
    for (const key in _window) {
      const descriptor = Object.getOwnPropertyDescriptor(global, key);
      if (!descriptor || descriptor.configurable === true) {
        Object.defineProperty(window, key, {
          value: _window[key],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        // console.log('ignore window: ', key);
      }
    }
    window.top.postMessage = _window.postMessage;
    window.self.postMessage = _window.postMessage;

    for (const key in _window.document) {
      const descriptor = Object.getOwnPropertyDescriptor(global.document, key);
      if (!descriptor || descriptor.configurable === true) {
        Object.defineProperty(global.document, key, {
          value: _window.document[key],
          writable: true,
          enumerable: true,
          configurable: true,
        });
        console.log();
      } else {
        console.log('ignore document: ', key);
      }
    }
  } else {
    for (const key in _window) {
      global[key] = _window[key];
    }
    global.window = _window;
    global.top = _window;
    global.self = _window;
    window = global;
    self = global;
  }

  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    return parse(text.trim().replace(/^\uFEFF/, ''), reviver);
  };

  compatWxEvents();
}

if (!GameGlobal.__isAdapterInjected) {
  GameGlobal.__isAdapterInjected = true;
  inject();
}

setTimeout(() => {
  if (window.onload) {
    window.onload.apply(window);
  }
});

window.onerror = (e) => {
  console.error('window.onerror=>', e);
};
