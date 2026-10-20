let touchEnabled = true;

function setTouchEnabled(enabled) {
  touchEnabled = enabled;
}

/**
 * 兼容触摸事件
 */
function compatTouchEvent() {
  const startTime = Date.now();
  const pointerNames = {
    touchstart: 'pointerdown',
    touchmove: 'pointermove',
    touchend: 'pointerup',
    touchcancel: 'pointercancel',
  };
  // touche event 适配
  const touchHandler = function (type) {
    return (event) => {
      if (!touchEnabled) {
        return;
      }
      const touchEvent = new TouchEvent(document.canvas, type);
      const handleTouch = (item) => ({
        target: document.canvas, // 原生无, 这里一定要有
        identifier: item.identifier,
        screenX: item.pageX,
        screenY: item.pageY,
        clientX: item.clientX,
        clientY: item.clientY,
        pageX: item.pageX,
        pageY: item.pageY,
      });

      touchEvent.touches = event.touches.map(handleTouch);
      touchEvent.targetTouches = event.touches.map(handleTouch);
      touchEvent.changedTouches = event.changedTouches.map(handleTouch);
      touchEvent.timeStamp = Date.now() - startTime;
      document.canvas.dispatchEvent(touchEvent);

      // 本分支改动：现有 TouchControls 用的是 pointer 事件，这里由 touch 合成。
      const pointerName = pointerNames[type];
      if (pointerName) {
        const changed = touchEvent.changedTouches.length
          ? touchEvent.changedTouches
          : touchEvent.touches;
        changed.forEach((touch) => {
          document.canvas.dispatchEvent({
            type: pointerName,
            target: document.canvas,
            currentTarget: document.canvas,
            pointerId: touch.identifier,
            pointerType: 'touch',
            isPrimary: true,
            button: type === 'touchmove' ? -1 : 0,
            buttons: type === 'touchend' || type === 'touchcancel' ? 0 : 1,
            clientX: touch.clientX,
            clientY: touch.clientY,
            pageX: touch.pageX,
            pageY: touch.pageY,
            screenX: touch.screenX,
            screenY: touch.screenY,
            timeStamp: touchEvent.timeStamp,
            preventDefault() {},
            stopPropagation() {},
            stopImmediatePropagation() {},
          });
        });
      }

      const windowHandler = window[`on${type}`];
      windowHandler && windowHandler(touchEvent);
    };
  };
  wx.onTouchStart(touchHandler('touchstart'));
  wx.onTouchMove(touchHandler('touchmove'));
  wx.onTouchEnd(touchHandler('touchend'));
  wx.onTouchCancel(touchHandler('touchcancel'));
}

/**
 * 兼容显示隐藏事件
 */
function dispatchVisibility(state) {
  document.hidden = state === 'hidden';
  document.visibilityState = state;
  // document.addEventListener 在适配器里绑到 canvas 上，所以派发到 canvas
  document.canvas.dispatchEvent({
    type: 'visibilitychange',
    target: document,
    currentTarget: document,
  });
}

function compatShowHideEvent() {
  document.visibilityState = 'visible';
  wx.onShow(() => {
    window.dispatchEvent({ type: 'focus', target: window });
    window.dispatchEvent({ type: 'resume' });
    dispatchVisibility('visible');
  });
  wx.onHide(() => {
    window.dispatchEvent({ type: 'blur', target: window });
    window.dispatchEvent({ type: 'pause' });
    dispatchVisibility('hidden');
  });
}

function deviceMotionCallback(res) {
  const event = new DeviceOrientationEvent('deviceorientation', res);
  event.target = window;
  window.dispatchEvent(event);
}

/**
 * 开始监听设备方向
 */
function startMotionListening() {
  wx.startDeviceMotionListening({ interval: 'game' });
  wx.onDeviceMotionChange(deviceMotionCallback);
}

/**
 * 关闭监听设备方向
 */
function stopMotionListening() {
  wx.offDeviceMotionChange(deviceMotionCallback);
  wx.stopDeviceMotionListening();
}

/**
 * 所有事件兼容
 */
function compatWxEvents() {
  compatTouchEvent();
  compatShowHideEvent();
}

export { compatWxEvents, startMotionListening, stopMotionListening, setTouchEnabled };
