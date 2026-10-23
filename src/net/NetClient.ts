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

import { browserClientId } from '../core/net/ClientId.ts';
import { NET_PROTOCOL_VERSION, isFatalProtocolError } from '../core/net/Protocol.ts';

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

/**
 * 一条掉落物（L7 第一刀）。
 *
 * `owner + localId` 是全局唯一键：服务端不接受客户端自带 owner，
 * 一律用连接自己的 id 拼——否则谁都能删别人的东西。
 */
export interface NetItemState {
  owner: number;
  localId: number;
  itemId: number;
  count: number;
  x: number;
  y: number;
  z: number;
}

export interface NetContainerState {
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** 27 格槽位（null 或 ItemStack 形状）；由客户端 `restoreStacks` 清洗 */
  slots: unknown[];
}

export interface NetHandlers {
  /** 连接成功并拿到世界快照（种子 + 已有玩家 + 已有方块改动 + 已有掉落物） */
  onWelcome: (
    seed: number,
    selfId: number,
    players: NetPlayerState[],
    edits: number[][],
    items: NetItemState[],
  ) => void;
  onPlayer: (player: NetPlayerState) => void;
  onLeave: (id: number) => void;
  onBlock: (x: number, y: number, z: number, id: number, state: number, dimension: string) => void;
  /** 别人改了箱子/木桶的内容（L4，批次 611） */
  onContainer?: (container: NetContainerState) => void;
  /** 别人那边生成了一堆掉落物（本地只渲染，不拾取） */
  onItemSpawn: (item: NetItemState) => void;
  /** 别人那边那堆没了（被捡走/烧掉/过期） */
  onItemRemove: (owner: number, localId: number) => void;
  onChat: (id: number, name: string, text: string) => void;
  /**
   * 服务端回了 `error`。
   *
   * 与 `onStatus(false, …)` 分开：`bad-json`/`unknown` 是消息级错误，连接还好好的，
   * 不该触发"清空远端玩家"那一套。致命错误（版本/身份/重复连接）由 `NetClient`
   * 自己置 `fatal`，随后的 `onStatus(false, …)` 才表示真的断了。
   */
  onError?: (code: string, message: string) => void;
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
  /**
   * 致命错误（协议版本/身份/重复连接）：**不再自动重连**。
   *
   * 这几种错误重连多少次结果都一样，3 秒一次的循环只会把服务端日志刷满、
   * 玩家还看不出到底哪里错了（状态一路在"连接中"与"已断开"之间跳）。
   */
  private fatal = false;
  /** 本机的稳定标识（见 `core/net/ClientId.ts`），首次 connect 时生成 */
  private clientId = '';
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
    // 重新发起连接 = 玩家明确想再试一次，清掉上一次的致命错误标记
    this.fatal = false;
    this.url = url;
    this.name = name;
    // 只生成一次：同一次会话里的自动重连必须还是同一个身份（联机8 要靠它认回玩家）
    if (this.clientId.length === 0) this.clientId = browserClientId();
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
          // 版本与服务端不一致时会被拒（error.code = 'version'），不会静默错乱
          v: NET_PROTOCOL_VERSION,
          name: this.name,
          clientId: this.clientId,
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
      // 致命错误时保留原因（"协议版本不匹配"比"连接已断开"有用得多）
      if (!this.fatal) this.status = '连接已断开';
      this.remote.clear();
      this.selfId = 0;
      this.handlers.onStatus(false, this.status);
      // 非主动断开就等一会儿重连：家里的 wifi 抖一下不该直接退出联机
      if (this.disposed) return;
      if (this.fatal) return;
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
        /*
         * 兜住"新客户端连老服务端"：老服务端不校验 v，也不会回 v。
         * 这时如果直接进游戏，字段差异会在之后的每条消息上零星炸开，很难归因；
         * 在门口停下来，玩家至少能看到一句人话。
         */
        const version = Number(message.v ?? 0);
        if (version !== NET_PROTOCOL_VERSION) {
          this.fatal = true;
          this.status = `协议版本不匹配：服务端 ${version || '旧版'}，客户端 ${NET_PROTOCOL_VERSION}`;
          this.handlers.onError?.('version', this.status);
          this.socket?.close();
          break;
        }
        this.selfId = Number(message.id ?? 0);
        this.worldSeed = Number(message.seed ?? 0);
        const players = (message.players as NetPlayerState[] | undefined) ?? [];
        for (const player of players) {
          if (player.id === this.selfId) continue;
          this.remote.set(player.id, player);
        }
        const edits = (message.edits as number[][] | undefined) ?? [];
        const items = (message.items as NetItemState[] | undefined) ?? [];
        this.handlers.onWelcome(this.worldSeed, this.selfId, players, edits, items);
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
      case 'container': {
        const slots = Array.isArray(message.slots) ? (message.slots as unknown[]) : [];
        this.handlers.onContainer?.({
          dimension: String(message.dimension ?? 'overworld'),
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
          slots,
        });
        break;
      }
      case 'item-spawn': {
        const item: NetItemState = {
          owner: Number(message.owner ?? 0),
          localId: Number(message.localId ?? 0),
          itemId: Number(message.itemId ?? 0),
          count: Number(message.count ?? 1),
          x: Number(message.x ?? 0),
          y: Number(message.y ?? 0),
          z: Number(message.z ?? 0),
        };
        // 自己的生成也会被服务端回传（快照路径），别把自己那边再镜像一份
        if (item.owner === this.selfId) break;
        this.handlers.onItemSpawn(item);
        break;
      }
      case 'item-remove': {
        const owner = Number(message.owner ?? 0);
        if (owner === this.selfId) break;
        this.handlers.onItemRemove(owner, Number(message.localId ?? 0));
        break;
      }
      case 'chat': {
        const text = String(message.text ?? '');
        this.lastChat = `<${String(message.name ?? '?')}> ${text}`;
        this.handlers.onChat(Number(message.id ?? 0), String(message.name ?? '?'), text);
        break;
      }
      case 'error': {
        const code = String(message.code ?? 'unknown');
        const text = String(message.message ?? '联机出错');
        this.status = text;
        /*
         * 致命错误只置标记、**不在这里 close**：服务端拒绝 join 时已经在关连接，
         * 客户端再 close 一次会提前把还没送达的 error 帧吞掉（测试里表现为"没收到 error"）。
         */
        if (isFatalProtocolError(code)) this.fatal = true;
        this.handlers.onError?.(code, text);
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

  /** 本地改了箱子/木桶：广播整份槽位（L4，批次 611） */
  sendContainer(
    x: number,
    y: number,
    z: number,
    dimension: string,
    slots: readonly unknown[],
  ): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'container', x, y, z, dimension, slots }));
  }

  /**
   * 本地生成了一堆掉落物 → 广播（L7 第一刀）。
   *
   * `localId` 由生成方自己分配，服务端拼上玩家 id 当全局键；坐标保留两位小数，
   * 镜像本来就不跑物理，多出来的精度没有意义。
   */
  sendItemSpawn(localId: number, itemId: number, count: number, x: number, y: number, z: number): void {
    if (!this.connected) return;
    this.socket?.send(
      JSON.stringify({
        t: 'item-spawn',
        localId: Math.trunc(localId),
        itemId: Math.trunc(itemId),
        count: Math.trunc(count),
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        z: Number(z.toFixed(2)),
      }),
    );
  }

  /** 本地那堆没了（被捡走/烧掉/过期）→ 让所有人删掉镜像 */
  sendItemRemove(localId: number): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'item-remove', localId: Math.trunc(localId) }));
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
