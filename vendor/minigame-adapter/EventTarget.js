import { startMotionListening, stopMotionListening } from './WxEvent';

export default class EventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    if (!type || !callback) {
      return;
    }
    const callbacks = this.listeners.get(type) || [];
    this.listeners.set(type, callbacks);

    if (type === 'deviceorientation' && callbacks.length === 0) {
      startMotionListening();
    }
    callbacks.push(callback);
  }

  removeEventListener(type, callback) {
    if (!type || !callback || !this.listeners.has(type)) {
      return;
    }
    const callbacks = this.listeners.get(type);
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
      if (type === 'deviceorientation' && callbacks.length === 0) {
        stopMotionListening();
      }
    }
  }

  dispatchEvent(event) {
    const { type, target } = event;
    if (!this.listeners.has(type)) {
      return true;
    }

    const callbacks = this.listeners.get(type).slice();
    for (let callback of callbacks) {
      callback.call(target || this, event);
    }
    return !event.defaultPrevented;
  }
}
