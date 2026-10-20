import EventTarget from './EventTarget.js';
import { document } from './Document';

export default class Node extends EventTarget {
  constructor() {
    super();
    this.childNodes = [];
    this._parentNode = null;
    this.nodeName;
  }

  get ownerDocument() {
    return document;
  }

  appendChild(node) {
    if (node instanceof Node) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      node.parentNode = this;
    } else {
      try { 
        node.parentNode = this;
        node.parentElement = this; 
      } catch (e) {}
      console.warn('Append a non-Node object as a child', node, node?.index);
    }
    this.childNodes.push(node);
    return node;
  }

  cloneNode(deep) {
    const node = new Node();
    if (deep) {
      Object.assign(node, this);
    }
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
  }

  insertBefore(node, referenceNode) {
    if (node instanceof Node) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      node.parentNode = this;
    } else {
      try { 
        node.parentNode = this;
        node.parentElement = this; 
      } catch (e) {}
      console.warn('Insert a non-Node object as a child', node, node?.index);
    }
    const index = this.childNodes.indexOf(referenceNode);
    if (index != -1) {
      this.childNodes.splice( index+ 1, 0, node);
    } else {
      this.childNodes.push(node);
    }
    return node;
  }

  remove() {
    // 移除自身
  }

  // 当父新变化时
  onParentChanged(parent) {}

  get parentNode() {
    return this._parentNode || document?.body;
  }

  set parentNode(value) {
    this.onParentChanged(value);
    this._parentNode = value;
  }

  get firstChild() {
    return this.childNodes[0];
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1];
  }

  get nextSibling() {
    if (!this.parentNode) {
      return null;
    }
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] || null;
  }

  get previousSibling() {
    if (!this.parentNode) {
      return null;
    }
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index - 1] || null;
  }
}
