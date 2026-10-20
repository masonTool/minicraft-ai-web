import XMLHttpRequest from './XMLHttpRequest';
import Response from './Response';

class Request {
  constructor(url, options = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this.headers = options.headers || {};
    this.responseType = options.responseType || 'text';
    console.warn('Mason Request: need set responseType');
    // 其他属性，如 body、credentials 等
  }

  send() {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(this.method, this.url);
      xhr.responseType = this.responseType;
      // 设置请求头部信息
      for (const [header, value] of Object.entries(this.headers)) {
        xhr.setRequestHeader(header, value);
      }
      xhr.onload = function () {
        const response = new Response(xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: xhr.getAllResponseHeaders(),
          isWasm: xhr.isWasm, // 拓展支持
        });
        resolve(response);
      };
      xhr.onerror = function () {
        reject(new Error('Network error'));
      };
      xhr.send();
    });
  }
}

function fetch(request, options = {}) {
  if (typeof request === 'string') {
    return new Request(request, options).send();
  } else if (request instanceof Request) {
    return request.send();
  } else {
    throw 'unknown fetch >>>>>';
  }
}

class Headers {
  constructor(init = {}) {
    this.headers = init;
  }

  // 添加头部信息
  append(name, value) {
    name = name.toLowerCase();
    if (this.headers[name]) {
      this.headers[name] += `, ${value}`;
    } else {
      this.headers[name] = value;
    }
  }

  // 获取头部信息
  get(name) {
    name = name.toLowerCase();
    return this.headers[name];
  }

  // 删除头部信息
  delete(name) {
    name = name.toLowerCase();
    delete this.headers[name];
  }

  // 将头部信息转换为对象
  toObject() {
    return { ...this.headers };
  }
}

export { Request, fetch, Headers };
