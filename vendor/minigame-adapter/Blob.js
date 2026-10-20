export default class Blob {
  constructor(parts, options = {}) {
    this.parts = parts;
    this.type = options.type || '';
  }

  arrayBuffer() {
    return new Promise((resolve) => {
      if (this.parts instanceof ArrayBuffer) {
        resolve(this.parts);
      } else {
        resolve(this.stringToUint8Array(this.parts).buffer);
      }
    });
  }

  text() {
    return new Promise((resolve) => {
      resolve(this.parts);
    });
  }

  stream() {
    const stream = new ReadableStream({
      start(controller) {
        for (const part of this.parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });
    return stream;
  }

  stringToUint8Array(str) {
    const length = str.length;
    const arrayBuffer = new ArrayBuffer(length * 2); // 假设字符串中的每个字符占用两个字节
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < length; i++) {
      const charCode = str.charCodeAt(i);
      uint8Array[i * 2] = charCode >> 8; // 高位字节
      uint8Array[i * 2 + 1] = charCode & 0xff; // 低位字节
    }
    return uint8Array;
  }
}
