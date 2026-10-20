/**
 * 平台能力接口（WX-011）
 *
 * 这一层是游戏/UI 与宿主之间的**唯一契约**：
 *   - `src/platform/web/**` 用浏览器实现（Web 版继续用）
 *   - `src/platform/wx/**` 用微信小游戏实现（适配器已 vendored）
 *   - `src/platform/tt/**` 为抖音预留（M6）
 *
 * 约束：
 *   1. 这里**只放类型**，不 import DOM / wx / three，保证 Node 测试可加载。
 *   2. canvas 用结构化的 `CanvasLike`，不绑死 `HTMLCanvasElement`；
 *      真正的渲染器在边界处 cast。
 *   3. 所有能力都按“可替换”设计：UI/游戏代码拿到的永远是 `Platform`，
 *      不直接摸 `document` / `wx`。
 */

export type PlatformKind = 'web' | 'wx' | 'tt';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** 安全区（刘海屏/手势条）；Web 端通常全 0 */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SystemInfo {
  readonly kind: PlatformKind;
  /** 逻辑分辨率（CSS px），横屏下就是横屏后的宽高 */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly safeArea: SafeArea;
  readonly isTouch: boolean;
  readonly model: string;
  readonly system: string;
  /** 微信小游戏才有；用于低端机降级判断 */
  readonly benchmarkLevel?: number;
  /** 微信基础库版本 */
  readonly sdkVersion?: string;
}

/**
 * Canvas 的最小结构。
 *
 * 故意不写 `HTMLCanvasElement`：微信小游戏的 canvas 是宿主对象，
 * 只保证 width/height/getContext 这几个成员。
 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: string, attributes?: Record<string, unknown>): any;
  addEventListener?(type: string, listener: (event: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
  getBoundingClientRect?(): Rect;
  style?: Record<string, string | number>;
}

export interface CanvasFactory {
  /** 上屏画布（小游戏只有一个；Web 端通常是渲染器创建的那一块） */
  screen(): CanvasLike;
  /** 离屏画布（图集、图标、告示牌文字等） */
  offscreen(width: number, height: number): CanvasLike;
}

/** 同步键值存储：设置、世界清单、诊断日志 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): readonly string[];
  clear(): void;
}

/** 文件存储：存档（区块增量、容器、成就等） */
export interface FileStore {
  /** 递归创建目录；已存在时应静默成功 */
  mkdir(path: string): Promise<void>;
  write(path: string, data: ArrayBuffer | string): Promise<void>;
  read(path: string): Promise<ArrayBuffer>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<readonly string[]>;
}

export interface Lifecycle {
  onShow(callback: () => void): () => void;
  onHide(callback: () => void): () => void;
  isHidden(): boolean;
  dispose(): void;
}

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

/** 统一后的指针事件；微信端由 touch 合成 */
export interface PointerLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly button: number;
  readonly buttons: number;
  readonly isPrimary: boolean;
  readonly target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface WheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
}

export interface InputSource {
  onPointer(phase: PointerPhase, callback: (event: PointerLike) => void): () => void;
  onWheel(callback: (event: WheelLike) => void): () => void;
}

/**
 * WebAudio 上下文的最小结构。
 *
 * 具体节点（Oscillator/Gain/Biquad/Delay/Compressor）由 `AudioEngine` 自己用；
 * 这里只约束“能拿到一个 AudioContext 风格的上下文”。
 */
export interface AudioContextLike {
  readonly state?: string;
  readonly sampleRate?: number;
  readonly currentTime?: number;
  resume?(): Promise<void> | void;
  close?(): Promise<void> | void;
  createGain(): any;
  createOscillator(): any;
  createBiquadFilter(): any;
  createBufferSource(): any;
  createBuffer(channels: number, length: number, sampleRate: number): any;
  createDynamicsCompressor?(): any;
  createDelay?(maxDelayTime?: number): any;
  createStereoPanner?(): any;
  createAnalyser?(): any;
}

export interface AudioFactory {
  createContext(): AudioContextLike;
}

/** Worker 的最小封装；微信端只有单个 worker，Web 端可多个 */
export interface WorkerHost {
  post(message: unknown, transfer?: Transferable[]): void;
  onMessage(callback: (data: any) => void): () => void;
  terminate(): void;
}

export interface WorkerFactory {
  create(scriptPath: string): WorkerHost;
}

export interface SocketLike {
  send(data: string | ArrayBuffer): void;
  close(): void;
  onOpen(callback: () => void): () => void;
  onMessage(callback: (data: string | ArrayBuffer) => void): () => void;
  onClose(callback: () => void): () => void;
  onError(callback: (error: unknown) => void): () => void;
}

export interface SocketFactory {
  connect(url: string, protocols?: string | string[]): SocketLike;
}

export interface KeyboardShowOptions {
  defaultValue?: string;
  maxLength?: number;
  multiple?: boolean;
}

/** 小游戏没有 DOM input，只能用 wx.showKeyboard 弹系统键盘 */
export interface KeyboardController {
  show(options?: KeyboardShowOptions): Promise<string | null>;
  hide(): void;
}

/**
 * 游戏/UI 唯一的平台入口。
 *
 * 注意：`files/audio/workers/sockets/keyboard` 在 WX-011 先给接口，
 * 具体实现分别在 WX-014~019 / WX-01A 逐步补齐。
 */
export interface Platform {
  readonly kind: PlatformKind;
  readonly system: SystemInfo;
  readonly canvas: CanvasFactory;
  readonly storage: KeyValueStore;
  readonly files: FileStore;
  readonly lifecycle: Lifecycle;
  readonly input: InputSource;
  readonly audio: AudioFactory;
  readonly workers: WorkerFactory;
  readonly sockets: SocketFactory;
  readonly keyboard: KeyboardController;
}
