import { systemInfo } from './WxInfo';

export default class CSSStyleDeclaration {
  constructor(relative) {
    return new Proxy(new CSSStyleDeclarationInner(relative), {
      set: function (target, property, value) {
        target[property] = value;
        setRelative(relative, property, value);
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
    });
  }
}

class CSSStyleDeclarationInner {
  constructor(relative) {
    this.relative = relative;
    this.backgroundColor = "rgb(0, 0, 0)";
  }

  getPropertyValue(key) {
    this.checkDefineProperty(key);
    return this[key];
  }

  setProperty(key, value) {
    this.checkDefineProperty(key);
    this[key] = value;
  }

  checkDefineProperty(key) {
    const style = this;
    const relative = this.relative;

    if (style.hasOwnProperty(key)) {
      return;
    }

    Object.defineProperty(style, key, {
      get: function () {
        return style[`_${key}`];
      },
      set: function (v) {
        style[`_${key}`] = v;
        setRelative(relative, key, v);
      },
    });
  }
}

function setRelative(relative, property, value) {
  // TODO 这里要注意, 可能有坑
  switch (property) {
    case 'marginLeft': {
      relative.width = relative.width + extractNumberFromString(value) * systemInfo.devicePixelRatio * 2;
      break;
    }
    case 'marginTop': {
      relative.height = relative.height + extractNumberFromString(value) * systemInfo.devicePixelRatio * 2;
      break;
    }
  }
}

function extractNumberFromString(str) {
  const regex = /\d+/;
  const match = str.match(regex);
  if (match) {
    return parseInt(match[0], 10);
  }
  return null;
}
