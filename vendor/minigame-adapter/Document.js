import Element from './Element';
import HTMLElement from './HTMLElement';
import { HTMLCanvasElement } from './Canvas';
import { HTMLImageElement } from './Image';
import {HTMLAudioElement, HTMLVideoElement} from './HTMLMediaElement';
import HTMLScriptElement from './HTMLScriptElement';
import HTMLLinkElement from './HTMLLinkElement';
import Event from './Event';
import location from './location'

//TODO 当前faker属于简化逻辑. 后面优化添加实际情况. 如tag id等. 可在初始化时手动往body中添加element, 然后根据情况获得tag, id的element
class Document extends Element {

  constructor() {
    super();

    this.hidden = false;

    this.implementation = {
      createHTMLDocument: ()=> {
        return this;
      }
    }

    this.createEvent = function () {
      return {
        initEvent: function () {},
      };
    };

    this.createElement = function (tagName, options) {
      switch (tagName) {
        case 'canvas':
          return new HTMLCanvasElement();
        case 'img':
          return new HTMLImageElement();
        case 'video':
          return new HTMLVideoElement();
        case 'audio':
          return new HTMLAudioElement();
        case 'script':
          return new HTMLScriptElement();
        case 'link':
          return new HTMLLinkElement();
      }
      return new HTMLElement(tagName, options);
    };
    
    this.createElementNS = function (namespaceURI, tagName, options) {
      return this.createElement(tagName, options);
    }

    this.getElementsByTagName = function(tagName) {
      return [this.faker];
    }

    this.getElementsByName = function(tagName) {
      return [this.faker];
    }

    this.querySelectorAll = function() {
      return [this.faker];
    }

    this.createDocumentFragment = function() {
      return this.createElement('documentFragment')
    }

    this.getElementById = function (id) {
      return this.faker;
    }

    this.createEvent = function (type) {
      return new Event(type);
    }

    this.querySelector = function () {
      return this.body;
    }
    this.open = function() {}
    this.write = function() {}
    this.close = function() {}

    this.canvas = this.createElement('canvas');
    try {
      this.canvas.parentElement = this;
    } catch (e) {}
    this.nodeType = 9;
    this.documentElement = new HTMLElement('html');
    this.body = this.documentElement.appendChild(this.createElement('body'));
    this.head = this.documentElement.appendChild(this.createElement('head'));
    this.faker = this.documentElement.appendChild(this.createElement('faker'));
    this.appendChild(this.documentElement);
    this.referrer = '';
    this.cookie = '';
    this.readyState = 'complete';
    this.title = '';
    this.currentScript = null;
    this.dispatchEvent = this.canvas.dispatchEvent;
    this.removeEventListener = this.canvas.removeEventListener;
    this.addEventListener = this.canvas.addEventListener;

    this.location = location;
    this.domain = '127.0.0.1';
  }

  get defaultView() {
    return window;
  }

  createTextNode(data) {
    return new HTMLElement('text', data);
  }
}
const document = new Document();
export { document, Document }
