/**
 * 微信小游戏平台实现（WX-011）
 *
 * 前提：调用前必须已经 import `./bootstrap.ts`（它会注入 vendored 适配器）。
 * 这里只做“平台能力适配”，不碰游戏逻辑与 UI。
 *
 * 说明：
 *   - `files` 用 FileSystemManager 同步 API 包一层 async；WX-016 再做原子写/性能优化。
 *   - `workers` 目前一对一直接映射 `wx.createWorker`；两套池子的合并放 WX-018。
 *   - `sockets/keyboard` 是 WX-019 / WX-01A 的占位实现。
 */

import { platformDocument } from './bootstrap.ts';
import { PlatformNotImplementedError } from '../errors.ts';
import type {
  AudioContextLike,
  AudioFactory,
  CanvasFactory,
  CanvasLike,
  FileStore,
  InputSource,
  KeyboardController,
  KeyboardShowOptions,
  KeyValueStore,
  Lifecycle,
  Platform,
  PointerLike,
  PointerPhase,
  SocketFactory,
  SocketLike,
  SystemInfo,
  WorkerFactory,
  WorkerHost,
} from '../types.ts';
import { getWxApi } from './api.ts';

export function wxSystemInfo(): SystemInfo {
  const wx = getWxApi();
  const info = wx.getSystemInfoSync() ?? {};
  const device =
    typeof wx.getDeviceInfo === 'function' ? (wx.getDeviceInfo() ?? {}) : {};
  const safe = info.safeArea ?? {};
  return {
    kind: 'wx',
    width: Number(info.windowWidth || info.screenWidth || 0),
    height: Number(info.windowHeight || info.screenHeight || 0),
    dpr: Number(info.pixelRatio || 1),
    safeArea: {
      top: Number(safe.top ?? 0),
      right: Number(safe.right ?? 0),
      bottom: Number(safe.bottom ?? 0),
      left: Number(safe.left ?? 0),
    },
    isTouch: true,
    model: String(info.model ?? ''),
    system: String(info.system ?? ''),
    platform: String(device.platform ?? info.platform ?? ''),
    ...(typeof info.benchmarkLevel === 'number' ? { benchmarkLevel: info.benchmarkLevel } : {}),
    ...(typeof info.SDKVersion === 'string' ? { sdkVersion: info.SDKVersion } : {}),
  };
}

function wxCanvasFactory(): CanvasFactory {
  const doc = platformDocument;
  const canvas = doc.canvas as CanvasLike | undefined;
  if (!canvas) {
    throw new PlatformNotImplementedError('CanvasFactory.screen', 'wx');
  }
  return {
    screen: () => canvas,
    offscreen(width: number, height: number): CanvasLike {
      const created = doc.createElement('canvas') as CanvasLike;
      created.width = Math.max(1, Math.floor(width));
      created.height = Math.max(1, Math.floor(height));
      return created;
    },
  };
}

function wxStorage(): KeyValueStore {
  const wx = getWxApi();
  return {
    get(key: string): string | null {
      const value = wx.getStorageSync(key);
      if (value === '' || value === null || value === undefined) return null;
      return String(value);
    },
    set(key: string, value: string): void {
      wx.setStorageSync(key, value);
    },
    remove(key: string): void {
      wx.removeStorageSync(key);
    },
    keys(): readonly string[] {
      return wx.getStorageInfoSync()?.keys ?? [];
    },
    clear(): void {
      wx.clearStorageSync();
    },
  };
}

function wxFiles(): FileStore {
  const wx = getWxApi();
  const fs = wx.getFileSystemManager();
  const root = String(wx.env?.USER_DATA_PATH ?? '');
  const full = (path: string): string =>
    path.startsWith(root) ? path : `${root}/${path.replace(/^\/+/, '')}`;

  return {
    async mkdir(path: string): Promise<void> {
      try {
        fs.mkdirSync(full(path), true);
      } catch {
        /* 已存在/并发创建：忽略 */
      }
    },
    async write(path: string, data: ArrayBuffer | string): Promise<void> {
      const target = full(path);
      const temp = `${target}.tmp`;
      try {
        fs.unlinkSync(temp);
      } catch {
        /* 临时文件不存在是正常情况 */
      }
      fs.writeFileSync(temp, data);
      try {
        fs.unlinkSync(target);
      } catch {
        /* 目标不存在是正常情况 */
      }
      fs.renameSync(temp, target);
    },
    async read(path: string): Promise<ArrayBuffer> {
      return fs.readFileSync(full(path)) as ArrayBuffer;
    },
    async remove(path: string): Promise<void> {
      try {
        fs.unlinkSync(full(path));
      } catch {
        /* 删除不存在的文件不报错 */
      }
    },
    async exists(path: string): Promise<boolean> {
      try {
        fs.accessSync(full(path));
        return true;
      } catch {
        return false;
      }
    },
    async list(dir: string): Promise<readonly string[]> {
      try {
        const names = (fs.readdirSync(full(dir)) ?? []) as string[];
        const base = dir.replace(/\/+$/, '');
        // wx readdirSync 只返回文件名；FileStore.list 的契约是“可直接 read 的路径”，
        // 所以这里补上目录。否则 FileSaveGame 会去读 wxfile://usr/overworld|0,0.bin。
        return names.map((name) =>
          name.startsWith(base) || name.startsWith(root) ? name : `${base}/${name}`,
        );
      } catch {
        return [];
      }
    },
  };
}

function wxLifecycle(): Lifecycle {
  const wx = getWxApi();
  const showListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();
  let hidden = false;

  const onShow = (): void => {
    hidden = false;
    for (const listener of showListeners) listener();
  };
  const onHide = (): void => {
    hidden = true;
    for (const listener of hideListeners) listener();
  };
  wx.onShow(onShow);
  wx.onHide(onHide);

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
      try {
        wx.offShow?.(onShow);
        wx.offHide?.(onHide);
      } catch {
        /* 低版本没有 off*：忽略 */
      }
      showListeners.clear();
      hideListeners.clear();
    },
  };
}

function wxInput(): InputSource {
  const canvas = platformDocument.canvas as
    | (CanvasLike & {
        addEventListener?: (type: string, listener: (event: any) => void) => void;
        removeEventListener?: (type: string, listener: (event: any) => void) => void;
      })
    | undefined;
  if (!canvas?.addEventListener) {
    throw new PlatformNotImplementedError('InputSource', 'wx');
  }
  const phaseToType: Record<PointerPhase, string> = {
    down: 'pointerdown',
    move: 'pointermove',
    up: 'pointerup',
    cancel: 'pointercancel',
  };

  return {
    onPointer(phase: PointerPhase, callback: (event: PointerLike) => void): () => void {
      const type = phaseToType[phase];
      const listener = (event: any): void => callback(event as PointerLike);
      canvas.addEventListener?.(type, listener);
      return () => canvas.removeEventListener?.(type, listener);
    },
    onWheel(): () => void {
      // 小游戏没有滚轮；列表滚动由触摸手势实现
      return () => {};
    },
  };
}

function wxAudio(): AudioFactory {
  const wx = getWxApi();
  return {
    createContext(): AudioContextLike {
      if (typeof wx.createWebAudioContext !== 'function') {
        throw new PlatformNotImplementedError('AudioFactory', 'wx');
      }
      return wx.createWebAudioContext() as AudioContextLike;
    },
  };
}

function wxWorkers(): WorkerFactory {
  const wx = getWxApi();
  // 微信同时只允许一个 worker；同一 scriptPath 复用一个 host，
  // 让 World（地形生成）与 MeshWorkerPool（网格化）共享同一条消息通道。
  const hosts = new Map<string, WorkerHost>();
  return {
    create(scriptPath: string): WorkerHost {
      const existing = hosts.get(scriptPath);
      if (existing) return existing;
      if (typeof wx.createWorker !== 'function') {
        throw new PlatformNotImplementedError('WorkerFactory', 'wx');
      }
      const worker = wx.createWorker(scriptPath);
      if (!worker) {
        throw new Error(`创建 worker 失败：${scriptPath}`);
      }
      console.log('[wx-worker] create', scriptPath);
      const subscribers = new Set<(data: any) => void>();
      let loggedFirstMessage = false;
      const unwrap = (res: any): any => {
        if (!res || typeof res !== 'object') return res;
        const keys = Object.keys(res);
        if (keys.length === 1 && 'message' in res) return res.message;
        if (keys.length === 1 && 'data' in res) return res.data;
        return res;
      };
      worker.onMessage((res: any) => {
        const data = unwrap(res);
        if (!loggedFirstMessage) {
          loggedFirstMessage = true;
          console.log('[wx-worker] first message', data);
        }
        for (const callback of subscribers) callback(data);
      });
      if (typeof worker.onError === 'function') {
        worker.onError((error: unknown) => {
          console.error('[wx-worker] error', error);
        });
      }
      const host: WorkerHost = {
        post(message: unknown): void {
          worker.postMessage(message);
        },
        onMessage(callback: (data: any) => void): () => void {
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        },
        terminate(): void {
          subscribers.clear();
          hosts.delete(scriptPath);
          worker.terminate();
        },
      };
      hosts.set(scriptPath, host);
      return host;
    },
  };
}

function wxSockets(): SocketFactory {
  const wx = getWxApi();
  return {
    connect(url: string, protocols?: string | string[]): SocketLike {
      if (typeof wx.connectSocket !== 'function') {
        throw new PlatformNotImplementedError('SocketFactory', 'wx');
      }
      const socket = wx.connectSocket({ url, protocols });
      return {
        send: (data) => socket.send({ data }),
        close: () => socket.close({}),
        onOpen(callback: () => void): () => void {
          socket.onOpen(callback);
          return () => {};
        },
        onMessage(callback: (data: string | ArrayBuffer) => void): () => void {
          socket.onMessage((event: any) => callback(event.data));
          return () => {};
        },
        onClose(callback: () => void): () => void {
          socket.onClose(callback);
          return () => {};
        },
        onError(callback: (error: unknown) => void): () => void {
          socket.onError(callback);
          return () => {};
        },
      };
    },
  };
}

function wxKeyboard(): KeyboardController {
  const wx = getWxApi();
  return {
    show(options: KeyboardShowOptions = {}): Promise<string | null> {
      return new Promise((resolve, reject) => {
        const cleanup = (): void => {
          try {
            wx.offKeyboardConfirm?.(onConfirm);
            wx.offKeyboardComplete?.(onComplete);
          } catch {
            /* 低版本没有 off*：忽略 */
          }
        };
        const onConfirm = (event: any): void => {
          cleanup();
          resolve(String(event?.value ?? ''));
        };
        const onComplete = (event: any): void => {
          cleanup();
          resolve(event?.value === undefined ? null : String(event.value));
        };
        wx.onKeyboardConfirm(onConfirm);
        wx.onKeyboardComplete(onComplete);
        try {
          wx.showKeyboard({
            defaultValue: options.defaultValue ?? '',
            ...(options.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
            ...(options.multiple !== undefined ? { multiple: options.multiple } : {}),
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },
    hide(): void {
      try {
        wx.hideKeyboard({});
      } catch {
        /* 键盘未弹出时忽略 */
      }
    },
  };
}

/** 微信小游戏整体实现；调用前必须已经执行 bootstrap */
export function wxPlatform(): Platform {
  return {
    kind: 'wx',
    system: wxSystemInfo(),
    canvas: wxCanvasFactory(),
    storage: wxStorage(),
    files: wxFiles(),
    lifecycle: wxLifecycle(),
    input: wxInput(),
    audio: wxAudio(),
    workers: wxWorkers(),
    sockets: wxSockets(),
    keyboard: wxKeyboard(),
  };
}
