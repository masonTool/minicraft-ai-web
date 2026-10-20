export default class TouchEvent {
  target = null;
  currentTarget = null;
  touches = [];
  targetTouches = [];
  changedTouches = [];
  preventDefault = function () {};
  stopPropagation = function () {};
  constructor(target, type) {
    this.target = target;
    this.currentTarget = target;
    this.type = type;
  }
}
