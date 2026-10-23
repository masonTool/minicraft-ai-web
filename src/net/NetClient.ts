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
import { NetSession, type NetSessionState } from '../core/net/NetSession.ts';
import type { RemoteAppearanceInput } from '../core/net/RemoteAppearance.ts';

export interface NetPlayerState {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dimension: string;
  /**
   * 外观（联机17）：都可缺省——老客户端不带这些字段，渲染就按"空手站立"画。
   * 服务端原样转发，不做语义校验（数字/布尔由客户端自己收口）。
   */
  held?: number;
  offhand?: number;
  armor?: number[];
  sneak?: boolean;
  swing?: boolean;
  hurt?: boolean;
  fire?: boolean;
  ride?: boolean;
  sleep?: boolean;
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

/** 一块牌子的字（联机16）：全是空串 = 擦掉 */
export interface NetSignState {
  dimension: string;
  x: number;
  y: number;
  z: number;
  lines: string[];
}

/** 一张展示框里的东西（联机16）：`item` 为 null = 空框 */
export interface NetFrameState {
  dimension: string;
  x: number;
  y: number;
  z: number;
  item: { id: number; count: number } | null;
  rotation: number;
}

export interface NetHandlers {
  /** 连接成功并拿到世界快照（种子 + 已有玩家 + 已有方块改动 + 已有掉落物） */
  onWelcome: (
    seed: number,
    selfId: number,
    players: NetPlayerState[],
    edits: number[][],
    items: NetItemState[],
    /** 容器快照（联机13）：服务端落盘的内容，重启后也能带回来 */
    containers?: NetContainerState[],
    /** 牌子与展示框的内容（联机16），同样是落盘带回来的 */
    signs?: NetSignState[],
    frames?: NetFrameState[],
  ) => void;
  onPlayer: (player: NetPlayerState) => void;
  onLeave: (id: number) => void;
  onBlock: (x: number, y: number, z: number, id: number, state: number, dimension: string) => void;
  /** 别人改了箱子/木桶的内容（L4，批次 611；联机15 扩到全部工作站） */
  onContainer?: (container: NetContainerState) => void;
  /** 别人写了/擦了牌子上的字（联机16） */
  onSign?: (sign: NetSignState) => void;
  /** 别人往展示框里放了/取了东西（联机16） */
  onFrame?: (frame: NetFrameState) => void;
  /** 别人那边生成了一堆掉落物（本地只渲染，不拾取） */
  onItemSpawn: (item: NetItemState) => void;
  /** 别人那边那堆没了（被捡走/烧掉/过期） */
  onItemRemove: (owner: number, localId: number) => void;
  onChat: (id: number, name: string, text: string) => void;
  /**
   * 服务端时间（联机10）：0..1 的一天。
   *
   * 主线不是"每帧都发"——服务端 2 秒一条，客户端按 4 倍速往它靠（`core/net/NetTime.ts`）。
   */
  onTime?: (timeOfDay: number, snap: boolean) => void;
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
  /** 会话状态机（联机7）：迁移与"要不要重连"只在它里面判 */
  private readonly session = new NetSession();
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
  /**
   * 最近一帧的位置与维度。
   *
   * `join` 要带"我此刻在哪"：不带的话，队友会在 `(0, 80, 0)` 看到你闪一下
   * （要等入服后第一条 `move` 才纠正）。掉线重连时也用这份最新值。
   */
  private readonly position = { x: 0, y: 80, z: 0, dimension: 'overworld' };
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
    this.session.connect();
    this.open();
  }

  /** 会话状态（联机7）：`idle|connecting|connected|reconnecting|offline` */
  get sessionState(): NetSessionState {
    return this.session.state;
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
      this.session.opened();
      this.status = `已连接 ${this.url}`;
      this.handlers.onStatus(true, this.status);
      socket.send(
        JSON.stringify({
          t: 'join',
          // 版本与服务端不一致时会被拒（error.code = 'version'），不会静默错乱
          v: NET_PROTOCOL_VERSION,
          name: this.name,
          clientId: this.clientId,
          x: Number(this.position.x.toFixed(3)),
          y: Number(this.position.y.toFixed(3)),
          z: Number(this.position.z.toFixed(3)),
          dimension: this.position.dimension,
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
      // 状态迁移与"要不要重连"只有一个出口（联机7）：主动断开 / 致命错误 → stop
      const action = this.session.closed({ intentional: this.disposed, fatal: this.fatal });
      this.handlers.onStatus(false, this.status);
      // 非主动断开就等一会儿重连：家里的 wifi 抖一下不该直接退出联机
      if (action === 'reconnect') {
        this.reconnectTimer = window.setTimeout(() => this.open(), RECONNECT_DELAY_MS);
      }
    };

    socket.onerror = () => {
      this.status = `无法连接到 ${this.url}（服务端没启动？）`;
      this.handlers.onStatus(false, this.status);
    };
  }

  /** `welcome` 与 `time` 共用：非法值直接丢（服务端时钟算错也不该把本地时间变成 NaN） */
  private deliverTime(message: Record<string, unknown>): void {
    const timeOfDay = Number(message.timeOfDay);
    if (!Number.isFinite(timeOfDay)) return;
    // `snap` = 有人睡满跳夜了（联机11）：本地要**立刻**对齐，不能 4 倍速慢慢追
    this.handlers.onTime?.(timeOfDay, message.snap === true);
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
        const containers = (message.containers as NetContainerState[] | undefined) ?? [];
        const signs = (message.signs as NetSignState[] | undefined) ?? [];
        const frames = (message.frames as NetFrameState[] | undefined) ?? [];
        this.handlers.onWelcome(this.worldSeed, this.selfId, players, edits, items, containers, signs, frames);
        // 时间权威（联机10）：进服先对齐一次，之后靠 `time` 广播校正
        this.deliverTime(message);
        break;
      }
      case 'time': {
        this.deliverTime(message);
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
      case 'blocks': {
        // 批量版本（联机12）：合帧后一包多条，逐条喂同一个回调，顺序即服务端记录顺序
        const blocks = Array.isArray(message.blocks) ? (message.blocks as unknown[]) : [];
        for (const raw of blocks) {
          if (!Array.isArray(raw)) continue;
          const [x, y, z, id, state, dimension] = raw as [unknown, unknown, unknown, unknown, unknown, unknown];
          this.handlers.onBlock(
            Number(x),
            Number(y),
            Number(z),
            Number(id),
            Number(state ?? 0),
            String(dimension ?? 'overworld'),
          );
        }
        break;
      }
      /*
       * 牌子与展示框（联机16）：与方块、容器同理——服务端只转发 + 留一份给快照，
       * 内容按坐标存，不关心渲染。
       */
      case 'sign': {
        this.handlers.onSign?.({
          dimension: String(message.dimension ?? 'overworld'),
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
          lines: Array.isArray(message.lines) ? (message.lines as unknown[]).map((line) => String(line)) : [],
        });
        break;
      }
      case 'frame': {
        const item = message.item as { id?: unknown; count?: unknown } | null | undefined;
        this.handlers.onFrame?.({
          dimension: String(message.dimension ?? 'overworld'),
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
          item: item ? { id: Number(item.id ?? 0), count: Number(item.count ?? 1) } : null,
          rotation: Number(message.rotation ?? 0),
        });
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

  /**
   * 每帧调用：按间隔把自己的位置 + 外观发出去（联机17）。
   *
   * 外观跟 `move` 一起走而不是单独一条：它同样"变了才值得知道"，而 100ms 一条
   * 已经足够（挥手 0.25 秒会被收到 2~3 次；客户端那边靠边沿触发补成动画）。
   */
  tick(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    dimension: string,
    appearance: RemoteAppearanceInput = {},
    now = performance.now(),
  ): void {
    // 位置快照要在 connected 检查**之前**更新：连接可能发生在「暂停菜单里点连接」，
    // 那一刻上一帧的 tick 已经跑过（主循环暂停时也照样调这个），这份值就是最新的。
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.position.dimension = dimension;
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
        // 外观（联机17）：字段短、都可缺省；空手/没盔甲就不带，省字节
        ...(appearance.held ? { held: appearance.held } : {}),
        ...(appearance.offhand ? { offhand: appearance.offhand } : {}),
        ...(appearance.armor && appearance.armor.some((id) => id > 0) ? { armor: appearance.armor } : {}),
        ...(appearance.sneak ? { sneak: 1 } : {}),
        ...(appearance.swing ? { swing: 1 } : {}),
        ...(appearance.hurt ? { hurt: 1 } : {}),
        ...(appearance.fire ? { fire: 1 } : {}),
        ...(appearance.ride ? { ride: 1 } : {}),
        ...(appearance.sleep ? { sleep: 1 } : {}),
      }),
    );
  }

  /** 本地改了方块：广播出去 */
  sendBlock(x: number, y: number, z: number, id: number, state: number, dimension: string): void {
    this.sendBlocks([{ x, y, z, id, state, dimension }]);
  }

  /**
   * 一批方块改动（联机12）。
   *
   * 合帧在 `core/net/BlockFunnel.ts` 里做：100ms 一次、同格只留最后一稿。这里只负责
   * 打包——数组比逐条对象省一半以上字节，红石连锁那种"一次几十格"全靠它。
   */
  sendBlocks(batch: readonly { x: number; y: number; z: number; id: number; state: number; dimension: string }[]): void {
    if (!this.connected || batch.length === 0) return;
    this.socket?.send(
      JSON.stringify({
        t: 'blocks',
        blocks: batch.map((edit) => [edit.x, edit.y, edit.z, edit.id, edit.state, edit.dimension]),
      }),
    );
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

  /** 我写了/擦了牌子上的字（联机16）。全空 = 擦掉 */
  sendSign(x: number, y: number, z: number, dimension: string, lines: readonly string[]): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'sign', x, y, z, dimension, lines }));
  }

  /** 我往展示框里放了/取了东西，或转了方向（联机16） */
  sendFrame(
    x: number,
    y: number,
    z: number,
    dimension: string,
    item: { id: number; count: number } | null,
    rotation: number,
  ): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'frame', x, y, z, dimension, item, rotation }));
  }

  /**
   * 我睡满跳夜了（联机11）：让服务端把大家的时间一起跳到黎明。
   *
   * 只发"我睡了"这一个事实，不带时间——服务端才是权威（它决定跳到几点、要不要清天气）。
   */
  sendSleep(): void {
    if (!this.connected) return;
    this.socket?.send(JSON.stringify({ t: 'sleep' }));
  }

  disconnect(): void {
    this.disposed = true;
    this.session.disconnect();
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
