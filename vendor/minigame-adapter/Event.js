export default class Event {
  constructor(type, options = null) {
    this.type = type;
    this.target = null;
  }

  initEvent(type, bubbles, cancelable) {
    this.type = type;
  }
}
