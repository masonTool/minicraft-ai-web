import CSSStyleDeclaration from './CSSStyleDeclaration';
import HTMLElement from './HTMLElement';
import { document } from './Document';
import { systemInfo } from './WxInfo';

let index = 0;
const event = new HTMLElement();
export class Canvas {
  // 调试信息
  static debug = false;

  constructor() {
    const canvas = wx.createCanvas();
    canvas.width = canvas.width * systemInfo.devicePixelRatio;
    canvas.height = canvas.height * systemInfo.devicePixelRatio;
    canvas.isCanvas = true;
    canvas.index = ++index;
    Canvas.debug && console.trace('Canvas ccccc>>', canvas.index);

    Object.defineProperty(canvas, 'ownerDocument', {
      get: function () {
        return document;
      },
    });

    Object.defineProperty(canvas, 'offsetParent', {
      get: function () {
        return document.body;
      },
    });

    // 添加样式. 解决 canvas.style只读, 不能赋值的情况
    const style = new CSSStyleDeclaration(canvas);
    const descriptor = Object.getOwnPropertyDescriptor(canvas, 'style');
    if (descriptor && !descriptor.writable) {
      canvas.style.setProperty = function (key, value) {
        style.setProperty(key, value);
      };
    } else {
      canvas.style = style;
    }
    canvas.getBoundingClientRect = function () {
      return {
        get left() {
          return parseInt(canvas.style.left, 10) || 0;
        },
        get top() {
          return parseInt(canvas.style.top, 10) || 0;
        },
        get width() {
          return parseInt(canvas.style.width, 10) || systemInfo.screenWidth;
        },
        get height() {
          return parseInt(canvas.style.height, 10) || systemInfo.screenHeight;
        },
      };
    };

    // 添加事件
    canvas.addEventListener = function () {
      event.addEventListener(...arguments);
    };
    canvas.removeEventListener = function () {
      event.removeEventListener(...arguments);
    };
    canvas.dispatchEvent = function () {
      return event.dispatchEvent(...arguments);
    };

    // 代理参数的处理 (Image)
    const getContext = canvas.getContext.bind(canvas);
    canvas.getContext = function () {
      Canvas.debug && console.trace('Canvas ggggg>>', canvas.index, arguments);
      const context = getContext(...arguments);
      if (!context.injected) {
        context.injected = true;
        for (const key in context) {
          if (typeof context[key] === 'function') {
            const original = context[key].bind(context);
            context[key] = function () {
              for (var i = 0; i < arguments.length; ++i) {
                const target = arguments[i]?.$proxyTarget;
                target && (arguments[i] = target);
              }
              return original(...arguments);
            };
          }
        }
      }
      return context;
    };

    canvas.setAttribute = function (key, value) {
      try {
        canvas[key] = value;
      } catch (e) {
        console.warn('Adapter canvas.setAttribute', key, value);
      }
    };
    try {
      canvas.tagName = 'CANVAS';
    } catch (e) {}
    try {
      canvas.className = '';
    } catch (e) {}
    try {
      canvas.focus = function () {};
    } catch (e) {}
    return canvas;
  }
}

export class HTMLCanvasElement {
  constructor() {
    return new Canvas();
  }
}

export class OffscreenCanvas {
  constructor() {
    return new Canvas();
  }
}
