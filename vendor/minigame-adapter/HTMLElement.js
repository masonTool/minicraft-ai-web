import Element from './Element';
import CSSStyleDeclaration from './CSSStyleDeclaration';
import { systemInfo } from './WxInfo';

export default class HTMLElement extends Element {
  constructor(tagName) {
    super(tagName);
    this.hidden = false;
    this.dataset = new Map();
    this.style = new CSSStyleDeclaration(this);
    this.clientWidth = systemInfo.screenWidth;
    this.clientHeight = systemInfo.screenHeight;
  }

  get contentDocument() {
    return document;
  }

  click() {}
}
