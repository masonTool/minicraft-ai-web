export default class Screen {
  constructor(width, height) {
    this.width = width;
    this.height = height;

    this.availTop = 0;
    this.availLeft = 0;
    this.availHeight = 0;
    this.availWidth = 0;
    this.colorDepth = 0;
    this.left = 0;
    this.orientation = 0;
    this.pixelDepth = 0;
    this.top = 0;
    this.mozEnabled = 0;
    this.mozBrightness = 0;
  }
}
