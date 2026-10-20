import Node from './Node';
import { document } from './Document';

export default class Element extends Node {
  constructor(tagName) {
    super();
    this.tagName = tagName;
    this.className = '';
    this.attributes = new Map();

    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientTop = 0;
    this.clientLeft = 0;

    // todo
    this.ontouchstart = function() {};
  }

  get children() {
    return this.childNodes;
  }

  get childElementCount() {
    return this.childNodes.length;
  }

  get firstElementChild() {
    return this.firstChild;
  }

  get lastElementChild() {
    return this.lastChild;
  }

  get nextElementSibling() {
    return this.nextSibling;
  }

  get previousElementSibling() {
    return this.previousSibling;
  }

  setAttribute(key, value) {
    this.attributes.set(key, value);
  }

  getAttribute(key) {
    return this.attributes.get(key);
  }
  removeAttribute(key) {
    this.attributes.delete(key);
  }

  getElementsByTagName(tag) {
    return document.getElementsByTagName(tag);
  }
}
