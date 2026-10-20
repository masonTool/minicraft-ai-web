import EventTarget from './EventTarget.js';
import { isUrl, cleanUrl, btoa, getValidLocalFilePath } from './Tools.js';

const _requestHeader = new WeakMap();
const _responseHeader = new WeakMap();
const _requestTask = new WeakMap();

function _triggerEvent(type, event = {}) {
  event.target = event.target || this;

  if (typeof this[`on${type}`] === 'function') {
    this[`on${type}`].call(this, event);
  }
}

function _changeReadyState(readyState, event = {}) {
  this.readyState = readyState;

  event.readyState = readyState;

  _triggerEvent.call(this, 'readystatechange', event);
}

function _isRelativePath(url) {
  return !/^(http|https|ftp|wxfile):\/\/.*/i.test(url);
}

export default class XMLHttpRequest extends EventTarget {
  static debug = false;

  static UNSEND = 0;
  static OPENED = 1;
  static HEADERS_RECEIVED = 2;
  static LOADING = 3;
  static DONE = 4;

  constructor() {
    super();
    this.onabort = null;
    this.onerror = null;
    this.onload = null;
    this.onloadstart = null;
    this.onprogress = null;
    this.ontimeout = null;
    this.onloadend = null;

    this.onreadystatechange = null;
    this.readyState = 0;
    this.response = null;
    this.responseText = null;
    this.responseType = 'text';
    this.dataType = 'string';
    this.responseXML = null;
    this.status = 0;
    this.statusText = '';
    this.upload = {};
    this.withCredentials = false;
    this.isWasm = false; // wasm 支持

    _requestHeader.set(this, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    _responseHeader.set(this, {});
  }

  abort() {
    const myRequestTask = _requestTask.get(this);

    if (myRequestTask) {
      myRequestTask.abort();
    }
  }

  getAllResponseHeaders() {
    const responseHeader = _responseHeader.get(this);

    return Object.keys(responseHeader)
      .map((header) => {
        return `${header}: ${responseHeader[header]}`;
      })
      .join('\n');
  }

  getResponseHeader(header) {
    return _responseHeader.get(this)[header];
  }

  open(method, url, async = true) {
    this._method = method;
    this._url = cleanUrl(url);
    this._async = async;
    _changeReadyState.call(this, XMLHttpRequest.OPENED);
  }

  overrideMimeType() {}

  // 清除参数
  removeParam(value) {
    const index = value.indexOf('?');
    if (index > 0) {
      return value.substring(0, index);
    } else {
      return value;
    }
  }

  // 组装url
  composeUrl(value) {
    if (isUrl(value)) {
      return value;
    } else {
      var url = '';
      if (url.startsWith('local://')) {
        url = value.substring(8);
      } else if (!value.startsWith(window.miniprogramPath)) {
        url = `${window.miniprogramPath}${value}`;
      } else {
        url = value;
      }
      return getValidLocalFilePath(url);
    }
  }

  send(data = '') {
    if (this.readyState !== XMLHttpRequest.OPENED) {
      throw new Error("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.");
    } else {
      const url = this.composeUrl(this._url);
      const header = _requestHeader.get(this);
      const responseType = this.responseType === 'blob' ? 'arraybuffer' : this.responseType;
      const dataType = this.dataType;
      const relative = _isRelativePath(url);

      XMLHttpRequest.debug && console.log('request>>', url, this.responseType);

      delete this.response;
      this.response = null;

      const onSuccess = ({ data, statusCode, header }) => {
        XMLHttpRequest.debug && console.log('request success>>', url, statusCode);
        statusCode = statusCode === undefined ? 200 : statusCode;
        if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) {
          try {
            data = JSON.stringify(data);
          } catch (e) {}
        }
        this.status = statusCode;
        if (header) {
          _responseHeader.set(this, header);
        }
        _triggerEvent.call(this, 'loadstart');
        _changeReadyState.call(this, XMLHttpRequest.HEADERS_RECEIVED);
        _changeReadyState.call(this, XMLHttpRequest.LOADING);
        if (responseType === 'json') {
          this.response = JSON.parse(data);
        } else {
          this.response = data;
        }
        if (data instanceof ArrayBuffer) {
          Object.defineProperty(this, 'responseText', {
            enumerable: true,
            configurable: true,
            get: function () {
              throw 'InvalidStateError : responseType is ' + this.responseType;
            },
          });
        } else {
          this.responseText = data;
        }
        _changeReadyState.call(this, XMLHttpRequest.DONE);
        _triggerEvent.call(this, 'load');
        _triggerEvent.call(this, 'loadend');
      };

      const onFail = ({ errMsg }) => {
        XMLHttpRequest.debug && console.log('request fail>>', url);

        if (errMsg.indexOf('abort') !== -1) {
          _triggerEvent.call(this, 'abort');
        } else {
          _triggerEvent.call(this, 'error', {
            message: errMsg,
          });
        }
        _triggerEvent.call(this, 'loadend');

        if (relative) {
          console.warn(errMsg);
        }
      };

      if (url.endsWith('.wasm' || url.endsWith('.wasm.br'))) {
        this.isWasm = true;
        onSuccess({ data: url });
        return;
      }

      // 读取本地代码文件或者缓存
      const readRelative = (url) => {
        const fs = wx.getFileSystemManager();
        var options = {
          filePath: url,
          success: onSuccess,
          fail: onFail,
        };
        if (responseType != 'arraybuffer') {
          options['encoding'] = 'utf8';
        }
        if (this._async) {
          fs.readFile(options);
        } else {
          var result = {
            data: fs.readFileSync(options.filePath, options.encoding, 0),
            statusCode: 200,
          };
          onSuccess(result);
        }
      };

      if (!relative) {
        const cachePath = `${wx.env.USER_DATA_PATH}/${btoa(this._url)}`;
        wx.getFileSystemManager().access({
          path: cachePath,
          success: () => {
            readRelative(cachePath);
          },
          fail: () => {
            wx.downloadFile({
              url,
              header,
              filePath: cachePath,
              success: () => {
                readRelative(cachePath);
              },
              fail: onFail,
            });
          },
        });
      } else {
        readRelative(url);
      }
    }
  }

  setRequestHeader(header, value) {
    const myHeader = _requestHeader.get(this);

    myHeader[header] = value;
    _requestHeader.set(this, myHeader);
  }

  addEventListener(type, listener) {
    if (typeof listener !== 'function') {
      return;
    }

    this['on' + type] = (event = {}) => {
      event.target = event.target || this;
      listener.call(this, event);
    };
  }

  removeEventListener(type, listener) {
    if (this['on' + type] === listener) {
      this['on' + type] = null;
    }
  }
}
