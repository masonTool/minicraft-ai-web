class MessagePort {
  constructor(channelCallback) {
    this.channelCallback = channelCallback;
    this.listener = null;
  }

  postMessage(message) {
    this.channelCallback(this, {
        type: 'event',
        data: message,
    });
  }

  set onmessage(callback) {
    this.listener = callback;
  }

  dispatchMessage(message) {
    this.listener && this.listener(message);
  }
}

export default class MessageChannel {
  constructor() {
    this.port1 = new MessagePort(this.postMessageToPort2.bind(this));
    this.port2 = new MessagePort(this.postMessageToPort1.bind(this));
  }

  postMessage(port, message) {
    if (port === this.port1) {
      this.port1.dispatchMessage(message);
    } else if (port === this.port2) {
      this.port2.dispatchMessage(message);
    }
  }

  postMessageToPort2(port, message) {
    this.postMessage(this.port2, message);
  }

  postMessageToPort1(port, message) {
    this.postMessage(this.port1, message);
  }
}
