import { btoa } from './Tools';

export default class FileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.result = null;
  }

  readAsText(blob) {
    blob.text().then((value) => {
      this.result = value;
      this.onload?.();
    })
  }

  readAsDataURL(arraybuffer) {
    const chunk = 8 * 1024;
    const array = new Uint8Array(arraybuffer);
    let res = '';
    let index = 0;
    for (index = 0; index < array.length / chunk; index++) {
      res += String.fromCharCode.apply(null, array.slice(index * chunk, (index + 1) * chunk));
    }
    res += String.fromCharCode.apply(null, array.slice(index * chunk));
    this.result = `data:image/jpeg;base64,${btoa(res)}`;
    this.onload?.();
  }
}
