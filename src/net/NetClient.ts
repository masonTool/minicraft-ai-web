/**
 * 联机客户端（K2）
 *
 * 与 `server/index.mjs` 配套。这里只做"连接 + 协议编解码 + 重连"，
 * 不碰世界与渲染——调用方（main）通过回调把消息接进游戏：
 *
 *   位置：60Hz 的游戏里每 50ms 发一次自己的位置（与触摸/键盘走同一套 yaw/pitch）
 *   方块：本地改方块时发一条；收到别人的改动时**直接写进世界**（也会进 K1 的增量存档）
 *   玩家：维护一份 `remote` 表，main 每帧把它同步成世界里的实体
 *
 * 一个重要约定：**地形由种子重现**，服务端只发种子与方块增量，
 * 因此进入服务器时不需要下载任何区块数据（这是本项目生成器确定性的直接红利）。
 */

export interface NetPlayerState {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dimension: string;
}

export interface NetHandlers {
  /** 连接成功并拿到世界快照（种子 + 已有玩家 + 已有方块改动） */
  onWelcome: (seed: number, selfId: number, players: NetPlayerState[], edits: number[][]) => void;
  onPlayer: (player: NetPlayerState) => void;
  onLeave: (id: number) => void;
  onBlock: (x: number, y: number, z: number, id: number, state: number, dimension: string) => void;
  onChat: (id: number, name: string, text: string) => void;
  /** 连接状态变化（用于 HUD 提示） */
  onStatus: (connected: boolean, detail: string) => void;
}

/** 发送位置的间隔（毫秒）：服务端也会限频，这里先自己节制 */
const MOVE_SEND_INTERVAL_MS = 100;
/** 断线重连的等待时间（毫秒） */
const RECONNECT_DELAY_MS = 3000;

export class NetClient {
  /** 自己的玩家 id（未连接时为 0） */
  selfId = 0;
  /** 服务端指定的世界种子（未连接时为 null） */
  worldSeed: number | null = null;
  /** 其它玩家（不含自己） */
  readonly remote = new Map<number, NetPlayerState>();
  /** 最近一条聊天（HUD 显示用） */
  lastChat = '';

  private socket: WebSocket | null = null;
  private url = '';
  private name = '';
  private lastMoveSent = 0;
  private reconnectTimer: number | null = null;
  /** 主动断开时不再重连 */
  private disposed = false;
  /** 连接状态文本（HUD 显示用） */
  status = '未连接';

  constructor(private readonly handlers: NetHandlers) {}

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  get playerCount(): number {
    return this.remote.size + (this.selfId > 0 ? 1 : 0);
  }

  connect(url: string, name: string): void {
    this.disposed = false;
    this.url = url;
    this.name = name;
    this.open();
  }

  private open(): void {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        // 已经关掉的 socket 再 close 会抛，忽略
      }
      this.socket = null;
    }

    this.status = `连接中 ${this.url}`;
    this.handlers.onStatus(false, this.status);

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.status = `已连接 ${this.url}`;
      this.handlers.onStatus(true, this.status);
      socket.send(
        JSON.stringify({
          t: 'join',
          name: this.name,
        }),
      );
    };

    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handleMessage(message);
    };

    socket.onclose = () => {
      this.status = '连接已断开';
      this.remote.clear();
      this.selfId = 0;
      this.handlers.onStatus(false, this.status);
      // 非主动断开就等一会儿重连：家里的 wifi 抖一下不该直接退出联机
      if (this.disposed) return;
      this.reconnectTimer = window.setTimeout(() => this.open(), RECONNECT_DELAY_MS);
    };

    socket.onerror = () => {
      this.status = `无法连接到 ${this.url}（服务端没启动？）`;
      this.handlers.onStatus(false, this.status);
    };
  }

  private handleMessage(message: Record<string, unknown>): void {
    switch (message.t) {
      case 'welcome': {
        this.selfId = Number(message.id ?? 0);
        this.worldSeed = Number(message.seed ?? 0);
        const players = (message.players as NetPlayerState[] | undefined) ?? [];
        for (const player of players) {
          if (player.id === this.selfId) continue;
          this.remote.set(player.id, player);
        }
        const edits = (message.edits as number[][] | undefined) ?? [];
        this.handlers.onWelcome(this.worldSeed, this.selfId, players, edits);
        break;
      }
      case 'player': {
        const state = message as unknown as NetPlayerState;
        if (state.id === this.selfId) break;
        this.remote.set(state.id, state);
        this.handlers.onPlayer(state);
        break;
      }
      case 'leave': {
        const id = Number(message.id ?? 0);
        this.remote.delete(id);
        this.handlers.onLeave(id);
        break;
      }
      case 'block': {
        this.handlers.onBlock(
          Number(message.x),
          Number(message.y),
          Number(message.z),
          Number(message.id),
          Number(message.state ?? 0),
          String(message.dimension ?? 'overworld'),
        );
        break;
      }
      case 'chat': {
        const text = String(message.text ?? '');
        this.lastChat = `<${String(message.name ?? '?')}> ${text}`;
        this.handlers.onChat(Number(message.id ?? 0), String(message.name ?? '?'), text);
        break;
      }
      default:
        break;
    }
  }

  /** 每帧调用：按间隔把自己的位置发出去 */
  tick(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    dimension: string,
    now = performance.now(),
  ): void {
    if (!this.connected || this.selfId === 0) return;
    if (now - this.lastMoveSent < MOVE_SEND_INTERVAL_MS) return;
    this.lastMoveSent = now;
    this.socket?.send(
      JSON.stringify({
        t: 'move',
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
        z: Number(z.toFixed(3)),
        // 角度保留 3 位小数：1e-3 弧度已经远小于一像素
        yaw: Number(yaw.toFixed(3)),
        pitch: Number(pitch.toFixed(3)),
        dimension,
      }),
    );
  }

  /** 本地改了方块：广播出去 */
  sendBlock(x: number, y: number, z: number, id: number, state: number, dimension: string): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'block', x, y, z, id, state, dimension }));
  }

  sendChat(text: string): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'chat', text }));
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.remote.clear();
    this.selfId = 0;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // 忽略
      }
      this.socket = null;
    }
    this.status = '未连接';
    this.handlers.onStatus(false, this.status);
  }
}

/** 默认的服务端地址（本地开发用） */
export function defaultServerUrl(): string {
  // 与服务端默认端口一致；换成局域网地址就能和朋友联机
  return `ws://${window.location.hostname}:8787`;
}
