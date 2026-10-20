import HTMLElement from './HTMLElement';

export default class HTMLLinkElement extends HTMLElement {

  constructor(tagName) {
    super(tagName);
    this._href = undefined
    this._onload = undefined;
    this._onerror = undefined;
  }

  set href(value) {
    this._href = value;
    if (value) {
      try {
        this._onload && this._onload.apply(window);
      } catch (e) {
        this._onerror && this._onerror.apply(window);
        this.dispatchEvent({type: 'error'});
        console.error(e);
      }
    }
  }

  setAttribute(key, value) {
    if (key === 'href') {
      this.href = value;
    } else {
      this[key] = value;
    }
  } 

  get href() {
    return this._href;
  }

  set onload(value) {
    if (this._href) {
      value && value.apply(window);
    } else {
      this._onload = value;
    }
  }

  onParentChanged(parent) {
    if (!this.parentNode && parent) {
      !this.src && this.dispatchEvent({type: 'error'});
    }
  }
}
