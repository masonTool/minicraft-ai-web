import { atob, btoa } from './Tools';
import { document } from './Document';
import { Image, HTMLImageElement } from './Image';
import { Canvas, HTMLCanvasElement, OffscreenCanvas } from './Canvas';
import XMLHttpRequest from './XMLHttpRequest';
import FileReader from './FileReader';
import HTMLElement from './HTMLElement';
import TouchEvent from './TouchEvent';
import CSSStyleDeclaration from './CSSStyleDeclaration';
import { navigator, Navigator } from './navigator';
import localStorage from './localStorage';
import location from './location';
import { Audio, AudioContext } from './Audio';
import Screen from './Screen';
import MessageChannel from './MessageChannel';
import URL from './URL';
import Worker from './Worker';
import Response from './Response';
import Blob from './Blob';
import HTMLScriptElement from './HTMLScriptElement';
import { systemInfo, performance } from './WxInfo';
import DeviceOrientationEvent from './DeviceOrientationEvent';
import XMLDocument from './XMLDocument';
import { Request, fetch, Headers } from './FetchAPI';
import { HTMLAudioElement, HTMLVideoElement, HTMLMediaElement } from './HTMLMediaElement';
import { WebAssembly } from './WebAssembly.js';

const w = {
  ...GameGlobal,
  miniprogram: {}, // 是否是小游戏
  miniprogramPath: '', // 资源加载的相对路径
  Navigator,
  navigator,
  atob,
  btoa,
  document,
  Image,
  HTMLImageElement,
  Canvas,
  canvas: document.canvas,
  HTMLCanvasElement,
  OffscreenCanvas,
  XMLHttpRequest,
  createjs: {},
  FileReader,
  TouchEvent,
  localStorage,
  location,
  Audio,
  AudioContext,
  MouseEvent: function () {},
  WebGLRenderingContext: function () {},
  ImageData: function () {},
  scrollTo: function () {},
  focus: function () {},
  ontouchstart: function () {},
  ontouchmove: function () {},
  ontouchend: function () {},
  ontouchcancel: function () {},
  eval: function (script) {
    console.error('Not support eval: ', script);
  },

  devicePixelRatio: systemInfo.devicePixelRatio,
  innerWidth: systemInfo.screenWidth,
  innerHeight: systemInfo.screenHeight,
  getComputedStyle: function () {
    return new CSSStyleDeclaration();
  },
  // 本分支改动：小游戏没有 matchMedia；现有 isTouchDevice 依赖它判断 pointer: coarse
  matchMedia: function (query) {
    const media = String(query || '');
    return {
      matches: /pointer\s*:\s*coarse|hover\s*:\s*none/.test(media),
      media,
      onchange: null,
      addListener: function () {},
      removeListener: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () {
        return false;
      },
    };
  },
  addEventListener: function () {
    document.canvas.addEventListener(...arguments);
  },
  removeEventListener: function () {
    document.canvas.removeEventListener(...arguments);
  },
  dispatchEvent: function () {
    return document.canvas.dispatchEvent(...arguments);
  },
  screen: new Screen(systemInfo.screenWidth, systemInfo.screenHeight),
  MessageChannel,
  URL,
  Worker,
  Response,
  Blob,
  HTMLScriptElement,
  performance,
  //
  Object,
  String,
  Number,
  Date,
  SyntaxError,
  TypeError,
  Math,
  JSON,
  postMessage: function () {},
  DeviceOrientationEvent,
  HTMLElement,
  pageXOffset: 0,
  pageYOffset: 0,
  XMLDocument,
  Request,
  fetch,
  Headers,
  HTMLAudioElement,
  HTMLVideoElement,
  HTMLMediaElement,
  onerror: wx.onError,
  WebAssembly,
};

w.top = w;
w.self = w;
export default w;
