import Blob from './Blob';
export default class Response {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status || 200;
    this.statusText = options.statusText || 'OK';
    if (typeof options.headers === 'string') {
      this.headers = options.headers.split('↵').map((pair) => pair.split(': '));
    } else {
      this.headers = new Map(options.headers || []);
    }
    this.ok = this.status >= 200 && this.status <= 299;
    this.isWasm = options.isWasm;
  }

  text() {
    return Promise.resolve(this.body.toString());
  }

  blob() {
    return Promise.resolve(new Blob(this.body));
  }

  json() {
    let parsedBody;
    try {
      parsedBody = JSON.parse(this.body);
    } catch (error) {
      return Promise.reject(new Error('Invalid JSON response'));
    }
    return Promise.resolve(parsedBody);
  }

  arrayBuffer() {
    if (this.isWasm) {
      return this.text();
    } else if (this.body instanceof ArrayBuffer) {
      return Promise.resolve(this.body);
    } else {
      const str = this.body.toString();
      const buffer = new ArrayBuffer(str.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < str.length; i++) {
        view[i] = str.charCodeAt(i) & 0xff;
      }
      return Promise.resolve(buffer);
    }
  }

  getHeaders() {
    const headers = {};
    for (const [key, value] of this.headers.entries()) {
      headers[key] = value;
    }
    return headers;
  }

  getHeader(name) {
    return this.headers.get(name);
  }
}
