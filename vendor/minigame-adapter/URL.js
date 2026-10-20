export default class URL {
  constructor(url, base) {
    this.href = `${base || ''}${url || ''}`;
    this.parseURL(this.href);
    this.origin = location.origin;
  }

  parseURL(url) {
    const regex = /^(?:(.*?):\/\/)?([^/?#:]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/;
    const matches = url.match(regex);
    if (!matches) {
      throw new Error('Invalid URL');
    }

    // 解析各个部分
    this.protocol = matches[1] || ''; // 协议
    this.hostname = matches[2] || ''; // 主机名
    this.port = matches[3] || ''; // 端口
    this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname; // 主机（包含端口）
    this.pathname = matches[4] || ''; // 路径
    this.search = matches[5] || ''; // 查询字符串
    this.hash = matches[6] || ''; // 哈希
    this.origin = this.protocol ? `${this.protocol}://${this.host}` : this.host;
  }

  toString() {
    return this.href;
  }
}

URL.createObjectURL = function(object) {
    const chunk = 8 * 1024;
    const array = new Uint8Array(object.parts);
    let res = '';
    let index = 0;
    for (index = 0; index < array.length / chunk; index++) {
      res += String.fromCharCode.apply(null, array.slice(index * chunk, (index + 1) * chunk));
    }
    res += String.fromCharCode.apply(null, array.slice(index * chunk));
    return `data:image/jpeg;base64,${btoa(res)}`;
}

URL.revokeObjectURL = function(object) {
  // do nothing
}
