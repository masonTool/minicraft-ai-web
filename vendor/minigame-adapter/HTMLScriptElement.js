import HTMLElement from './HTMLElement';
import URL from './URL';
import { isUrl } from './Tools';

export default class HTMLScriptElement extends HTMLElement {
  // 用于在外部静态设置require, 解决打包问题.
  static onRequire = null;

  constructor(tagName) {
    super(tagName);
    this._src = undefined;
    this._onload = undefined;
  }

  set src(value) {
    if (!value) return;

    this._src = isUrl(value) ? value : `${window.miniprogramPath}${value}`;
    console.log('HTMLScriptElement>>>origin:', this._src);
    try {
      window.document.currentScript = this;
      if (HTMLScriptElement.onRequire) {
        HTMLScriptElement.onRequire(value);
      } else {
        const url = new URL(this._src);
        console.log('HTMLScriptElement>>>filter:', url.host + url.pathname);
        // 本分支改动：小游戏用打包期静态入口，不存在运行时 require；
        // 保留原来的动态 require 会让 esbuild 把整个 references 目录当依赖扫描。
        throw new Error(`运行时不支持动态脚本加载：${url.host}${url.pathname}`);
      }
      window.document.currentScript = null;
      this._onload && this._onload.apply(window);
    } catch (e) {
      this.dispatchEvent({ type: 'error' });
      console.error(e);
    }
  }

  get src() {
    return this._src;
  }

  set onload(value) {
    if (this._src) {
      value && value.apply(window);
    } else {
      this._onload = value;
    }
  }

  onParentChanged(parent) {
    if (!this.parentNode && parent) {
      !this.src && this.dispatchEvent({ type: 'error' });
    }
  }
}
