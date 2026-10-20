import HTMLElement from './HTMLElement';
import { isBase64, isUrl } from './Tools';

export class Image {
  constructor() {
    const image = wx.createImage();
    image.removeAttribute = (value) => (image[value] = '');
    image.removeAttribute('crossOrigin');

    const event = new HTMLElement();
    image.addEventListener = function () {
      event.addEventListener(...arguments);
    };
    image.removeEventListener = function () {
      event.removeEventListener(...arguments);
    };
    image.dispatchEvent = function () {
      return event.dispatchEvent(...arguments);
    };
    image.onload = function() {
      image.dispatchEvent({type: 'load', target: image})
    }
    image.onerror = function() {
      image.dispatchEvent({type: 'error', target: image})
    }

    // 代理Image的src设置, 解决兼容性问题. 需与canvas配合使用.
    const proxy = new Proxy(image, {
      set: function(target, property, value) {
        if (property === 'src' && value) {
          if (isUrl(value) || isBase64(value)) {
            target[property] = value;
          } else if (value.startsWith('local://')) {
            target[property] = value.substring(8);
          } else {
            target[property] = `${window.miniprogramPath}${value}`;
          }
        } else {
          target[property] = value;
        }
        return true;
      },
      get: function(target, property) {
        const result = target[property];
        if (typeof result === 'function') {
          return result.bind(target);
        } else {
          return result;
        }
      },
      getPrototypeOf: function(target) {
        return HTMLImageElement.prototype;
      }
    })
    proxy.$proxyTarget = image;
    return proxy;
  }
}

export class HTMLImageElement {
  constructor() {
    return new Image();
  }
}
