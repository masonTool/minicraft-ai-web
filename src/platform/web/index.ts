/**
 * Web 平台实现（WX-011）
 *
 * 保持现有 Web 版行为：localStorage / PointerEvent / WebAudio / Worker / WebSocket。
 * 这些函数都是**调用时**才碰 DOM，模块本身在 Node 里可安全 import（测试用）。
 */

import { PlatformNotImplementedError } from '../errors.ts';
import { createMemoryFiles, createMemoryStorage } from '../memory.ts';
import type {
  AudioFactory,
  AudioContextLike,
  CanvasFactory,
  CanvasLike,
  FileStore,
  InputSource,
  KeyboardController,
  KeyValueStore,
  Lifecycle,
  Platform,
  PointerLike,
  PointerPhase,
  SocketFactory,
  SocketLike,
  SystemInfo,
  WheelLike,
  WorkerFactory,
  WorkerHost,
} from '../types.ts';

function currentWindow(): Window | null {
  return typeof window === 'undefined' ? null : window;
}

function currentDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

export function webSystemInfo(): SystemInfo {
  const win = currentWindow();
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const width = win?.innerWidth ?? 0;
  const height = win?.innerHeight ?? 0;
  const dpr = win?.devicePixelRatio ?? 1;
  const coarse = win?.matchMedia?.('(pointer: coarse)').matches ?? false;
  return {
    kind: 'web',
    width,
    height,
    dpr,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    isTouch: coarse || (nav?.maxTouchPoints ?? 0) > 0,
    model: nav?.userAgent ?? 'web',
    system: nav?.platform ?? 'web',
  };
}

function webCanvasFactory(): CanvasFactory {
  let screenCanvas: HTMLCanvasElement | null = null;
  return {
    screen(): CanvasLike {
      const doc = currentDocument();
      if (!doc) throw new PlatformNotImplementedError('CanvasFactory.screen', 'web');
      if (!screenCanvas) {
        screenCanvas = doc.createElement('canvas');
        const info = webSystemInfo();
        screenCanvas.width = Math.max(1, Math.floor(info.width * info.dpr));
        screenCanvas.height = Math.max(1, Math.floor(info.height * info.dpr));
      }
      return screenCanvas as unknown as CanvasLike;
    },
    offscreen(width: number, height: number): CanvasLike {
      const doc = currentDocument();
      if (!doc) throw new PlatformNotImplementedError('CanvasFactory.offscreen', 'web');
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      return canvas as unknown as CanvasLike;
    },
  };
}

function webStorage(): KeyValueStore {
  const win = currentWindow();
  try {
    const storage = win?.localStorage;
    if (!storage) return createMemoryStorage();
    const probe = '__mc_platform_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => storage.setItem(key, value),
      remove: (key) => storage.removeItem(key),
      keys: () =>
        Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
          (key): key is string => key !== null,
        ),
      clear: () => storage.clear(),
    };
  } catch {
    // 无痕模式/被禁用：退化成内存，至少本次会话可用
    return createMemoryStorage();
  }
}

function webFiles(): FileStore {
  return createMemoryFiles();
}

function webLifecycle(): Lifecycle {
  const doc = currentDocument();
  const win = currentWindow();
  const showListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();
  let hidden = doc?.hidden ?? false;

  const emitShow = (): void => {
    hidden = false;
    for (const listener of showListeners) listener();
  };
  const emitHide = (): void => {
    hidden = true;
    for (const listener of hideListeners) listener();
  };
  const onVisibility = (): void => {
    if (doc?.hidden) emitHide();
    else emitShow();
  };

  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('focus', emitShow);
  win?.addEventListener('blur', emitHide);

  return {
    onShow(callback: () => void): () => void {
      showListeners.add(callback);
      return () => showListeners.delete(callback);
    },
    onHide(callback: () => void): () => void {
      hideListeners.add(callback);
      return () => hideListeners.delete(callback);
    },
    isHidden: () => hidden,
    dispose(): void {
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('focus', emitShow);
      win?.removeEventListener('blur', emitHide);
      showListeners.clear();
      hideListeners.clear();
    },
  };
}

function normalizePointer(event: PointerEvent): PointerLike {
  return {
    pointerId: event.pointerId ?? 1,
    pointerType: event.pointerType || 'mouse',
    clientX: event.clientX,
    clientY: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
    button: event.button,
    buttons: event.buttons,
    isPrimary: event.isPrimary ?? true,
    target: event.target,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
  };
}

function webInput(): InputSource {
  const target: EventTarget | null = currentWindow();
  const phaseToType: Record<PointerPhase, string> = {
    down: 'pointerdown',
    move: 'pointermove',
    up: 'pointerup',
    cancel: 'pointercancel',
  };

  return {
    onPointer(phase: PointerPhase, callback: (event: PointerLike) => void): () => void {
      if (!target) return () => {};
      const type = phaseToType[phase];
      const listener = (event: Event): void => callback(normalizePointer(event as PointerEvent));
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    },
    onWheel(callback: (event: WheelLike) => void): () => void {
      if (!target) return () => {};
      const listener = (event: Event): void => {
        const wheel = event as WheelEvent;
        callback({ deltaX: wheel.deltaX, deltaY: wheel.deltaY });
      };
      target.addEventListener('wheel', listener, { passive: true });
      return () => target.removeEventListener('wheel', listener);
    },
  };
}

function webAudio(): AudioFactory {
  return {
    createContext(): AudioContextLike {
      const win = currentWindow() as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      } | null;
      const Ctor = win?.AudioContext ?? win?.webkitAudioContext;
      if (!Ctor) throw new PlatformNotImplementedError('AudioFactory', 'web');
      return new Ctor() as unknown as AudioContextLike;
    },
  };
}

function webWorkers(): WorkerFactory {
  return {
    create(scriptPath: string): WorkerHost {
      if (typeof Worker === 'undefined') {
        throw new PlatformNotImplementedError('WorkerFactory', 'web');
      }
      const worker = new Worker(scriptPath, { type: 'module' });
      return {
        post(message: unknown, transfer?: Transferable[]): void {
          worker.postMessage(message, transfer ?? []);
        },
        onMessage(callback: (data: any) => void): () => void {
          const listener = (event: MessageEvent): void => callback(event.data);
          worker.addEventListener('message', listener);
          return () => worker.removeEventListener('message', listener);
        },
        terminate: () => worker.terminate(),
      };
    },
  };
}

function webSockets(): SocketFactory {
  return {
    connect(url: string, protocols?: string | string[]): SocketLike {
      if (typeof WebSocket === 'undefined') {
        throw new PlatformNotImplementedError('SocketFactory', 'web');
      }
      const socket = new WebSocket(url, protocols);
      return {
        send: (data) => socket.send(data),
        close: () => socket.close(),
        onOpen(callback: () => void): () => void {
          socket.addEventListener('open', callback);
          return () => socket.removeEventListener('open', callback);
        },
        onMessage(callback: (data: string | ArrayBuffer) => void): () => void {
          const listener = (event: MessageEvent): void => {
            callback(event.data as string | ArrayBuffer);
          };
          socket.addEventListener('message', listener);
          return () => socket.removeEventListener('message', listener);
        },
        onClose(callback: () => void): () => void {
          socket.addEventListener('close', callback);
          return () => socket.removeEventListener('close', callback);
        },
        onError(callback: (error: unknown) => void): () => void {
          const listener = (event: Event): void => callback(event);
          socket.addEventListener('error', listener);
          return () => socket.removeEventListener('error', listener);
        },
      };
    },
  };
}

function webKeyboard(): KeyboardController {
  return {
    show(): Promise<string | null> {
      return Promise.reject(new PlatformNotImplementedError('KeyboardController', 'web'));
    },
    hide(): void {
      /* no-op */
    },
  };
}

/** Web 端整体实现；Web 版现有代码继续走自己的 DOM，这里供新平台层使用 */
export function webPlatform(): Platform {
  return {
    kind: 'web',
    system: webSystemInfo(),
    canvas: webCanvasFactory(),
    storage: webStorage(),
    files: webFiles(),
    lifecycle: webLifecycle(),
    input: webInput(),
    audio: webAudio(),
    workers: webWorkers(),
    sockets: webSockets(),
    keyboard: webKeyboard(),
  };
}
