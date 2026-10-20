import EventTarget from './EventTarget.js';
import { isUrl } from './Tools.js';

const HAVE_NOTHING = 0;
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;
const HAVE_ENOUGH_DATA = 4;

const _innerAudioContext = new WeakMap();
const _src = new WeakMap();
const _loop = new WeakMap();
const _autoplay = new WeakMap();

export class Audio extends EventTarget {
  HAVE_NOTHING = HAVE_NOTHING;
  HAVE_METADATA = HAVE_METADATA;
  HAVE_CURRENT_DATA = HAVE_CURRENT_DATA;
  HAVE_FUTURE_DATA = HAVE_FUTURE_DATA;
  HAVE_ENOUGH_DATA = HAVE_ENOUGH_DATA;
  readyState = HAVE_NOTHING;

  constructor(url) {
    super();
    _src.set(this, '');

    const innerAudioContext = wx.createInnerAudioContext();

    _innerAudioContext.set(this, innerAudioContext);

    innerAudioContext.onCanplay(() => {
      this.dispatchEvent({ type: 'load' });
      this.dispatchEvent({ type: 'loadend' });
      this.dispatchEvent({ type: 'canplay' });
      this.dispatchEvent({ type: 'canplaythrough' });
      this.dispatchEvent({ type: 'loadedmetadata' });
      this.readyState = HAVE_CURRENT_DATA;
    });
    innerAudioContext.onPlay(() => {
      this.dispatchEvent({ type: 'play' });
    });
    innerAudioContext.onPause(() => {
      this.dispatchEvent({ type: 'pause' });
    });
    innerAudioContext.onEnded(() => {
      this.dispatchEvent({ type: 'ended' });
      this.readyState = HAVE_ENOUGH_DATA;
    });
    innerAudioContext.onError(() => {
      this.dispatchEvent({ type: 'error' });
    });

    if (url) {
      _innerAudioContext.get(this).src = url;
    }
  }

  load() {
    this.dispatchEvent({ type: 'canplay' });
  }

  play() {
    _innerAudioContext.get(this).play();
  }

  pause() {
    _innerAudioContext.get(this).pause();
  }

  canPlayType(mediaType = '') {
    if (typeof mediaType !== 'string') {
      return '';
    }
    return 'probably';
  }

  get currentTime() {
    return _innerAudioContext.get(this).currentTime;
  }

  set currentTime(value) {
    _innerAudioContext.get(this).seek(value);
  }

  get src() {
    return _src.get(this);
  }

  set src(value) {
    _src.set(this, value);

    _innerAudioContext.get(this).src = isUrl(value) ? value : `${window.miniprogramPath}${value}`;
  }

  get loop() {
    return _innerAudioContext.get(this).loop;
  }

  set loop(value) {
    _innerAudioContext.get(this).loop = value;
  }

  get autoplay() {
    return _innerAudioContext.get(this).autoplay;
  }

  set autoplay(value) {
    _innerAudioContext.get(this).autoplay = value;
  }

  get paused() {
    return _innerAudioContext.get(this).paused;
  }

  cloneNode() {
    const newAudio = new Audio();
    newAudio.loop = _innerAudioContext.get(this).loop;
    newAudio.autoplay = _innerAudioContext.get(this).autoplay;
    newAudio.src = this.src;
    return newAudio;
  }
}

export class AudioContext {
  constructor() {
    const context = wx.createWebAudioContext();
    // context.suspend();
    const decodeAudioData = context.decodeAudioData.bind(context);
    // 兼容没有failCallback就不回调的问题, 兼容最新的promise模式.
    context.decodeAudioData = function (audioData, successCallback) {
      return new Promise((resolve, reject) => {
        decodeAudioData(
          audioData,
          (decodedData) => {
            successCallback(decodedData);
            resolve(decodedData);
          },
          reject
        );
      });
    };
    const createBufferSource = context.createBufferSource.bind(context);
    context.createBufferSource = function () {
      const bs = createBufferSource();
      try {
        // 兼容 bufferSource没有context的问题
        bs.context = context;
      } catch (e) {}
      return bs;
    };

    context.createMediaElementSource = function () {
      return context.createBufferSource();
    };

    const setOrientation = context.listener.setOrientation;
    context.listener.setOrientation = function () {
      for (var i = 0; i < arguments.length; ++i) {
        arguments[i] = Math.max(arguments[i], 0);
      }
      setOrientation.apply(context.listener, arguments);
    };

    const compatAudioParam = (param) => {
      const linearRampToValueAtTime = param?.linearRampToValueAtTime;
      if (linearRampToValueAtTime) {
        param.linearRampToValueAtTime = function (value, endTime) {
          return linearRampToValueAtTime.call(param, Math.max(value, 0), endTime);
        };
      }
    };
    compatAudioParam(context.listener.positionX);
    compatAudioParam(context.listener.positionY);
    compatAudioParam(context.listener.positionZ);
    compatAudioParam(context.listener.forwardX);
    compatAudioParam(context.listener.forwardY);
    compatAudioParam(context.listener.forwardZ);
    compatAudioParam(context.listener.upX);
    compatAudioParam(context.listener.upY);
    compatAudioParam(context.listener.upZ);

    const createPanner = context.createPanner;
    context.createPanner = function () {
      const panner = createPanner.apply(context, arguments);
      compatAudioParam(panner.positionX);
      compatAudioParam(panner.positionY);
      compatAudioParam(panner.positionZ);
      compatAudioParam(panner.orientationX);
      compatAudioParam(panner.orientationY);
      compatAudioParam(panner.orientationY);
      return panner;
    };

    context.resume();
    return context;
  }
}
