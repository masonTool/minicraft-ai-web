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
import { parseServerUrl, resolveDefaultServerUrl } from '../core/net/ServerUrl.ts';
import { NetStats } from '../core/net/NetStats.ts';

export interface NetPlayerState {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dimension: string;
  /** 队伍名（联机22）：空/缺省 = 没队伍。用来判友伤，也用于联机18 的名字牌颜色 */
  team?: string;
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
  /**
   * 这一堆在哪个维度（联机31）。
   *
   * 没有它的时候，队友在下界丢的东西会画在主世界同坐标——镜像只按坐标建，
   * 而坐标在两个维度里是同一套数。
   */
  dimension: string;
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

/**
 * 一次生物命中（联机19）。
 *
 * 两端生物各自随机生成、服务端没有实体 id，所以这里**不带 id**——接收方按
 * `typeId + 坐标邻域` 找自己世界里那只（`core/net/MobMatch.ts`）。找不到就直接
 * 忽略（不要凭空生成，否则会双份怪物）。
 */
export interface NetMobHit {
  typeId: string;
  dimension: string;
  x: number;
  y: number;
  z: number;
  damage: number;
  /** 着火秒数（火焰附加）；0 = 不点火 */
  fire: number;
}

/** 有人打了我（联机22） */
export interface NetPlayerHit {
  fromId: number;
  fromName: string;
  /** 对方的队伍名（空串 = 没队伍） */
  fromTeam: string;
  damage: number;
}

/** 一支箭（联机23）：位置 + 速度 + 伤害，物理由各端自己跑 */
export interface NetArrowState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
}

/** 一格格 TNT 被点燃（联机23）：坐标就是 key，天然幂等 */
export interface NetTntState {
  x: number;
  y: number;
  z: number;
  dimension: string;
}

/** 捡别人那堆掉落物的仲裁结果（联机21） */
export interface NetItemTakeResult {
  ok: boolean;
  owner: number;
  localId: number;
  itemId: number;
  count: number;
  /** 失败原因：`gone` = 已经被别人先拿走了 */
  reason: string;
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
  /** 别人打了一只生物（联机19）：按类型 + 邻域认到自己世界里那只 */
  onMobHit?: (hit: NetMobHit) => void;
  /**
   * 有人打了我（联机22）。`fromTeam` 是对方的队伍名（空串 = 没队伍），
   * 被击者要再判一次友伤——不能只信攻击者那边的判定。
   */
  onPlayerHit?: (hit: NetPlayerHit) => void;
  /** 别人射了一支箭（联机23）：在本地也生成一支，物理各端自己跑 */
  onArrow?: (arrow: NetArrowState) => void;
  /** 别人点燃了一格 TNT（联机23）：坐标即 key，直接在本地点燃 */
  onTnt?: (tnt: NetTntState) => void;
  /**
   * 捡别人的掉落物的仲裁结果（联机21）。
   *
   * `ok` 时把 `itemId/count` 加进背包并删掉镜像；失败（`gone` = 被别人先抢了）
   * 也要删镜像——它已经不在了。
   */
  onItemTake?: (result: NetItemTakeResult) => void;
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
/** 应用层 ping 的间隔（联机29）：浏览器不允许我们发协议层 ping 帧，只能自己定一条 */
const PING_INTERVAL_MS = 2000;
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
  /** 上一次发 ping 的时刻（联机29） */
  private lastPingAt = 0;
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
  /** 运行统计（联机29）：延迟 / 丢包 / 上下行，F3 面板读它 */
  readonly stats = new NetStats();
  /** 房间码（联机26）：空串 = 服务端默认房间；同一房间的人才互相可见 */
  private room = '';
  /** 房间口令（联机26）：空串 = 不发送（服务端没设密码时也不需要） */
  private password = '';
  /**
   * 我所在的队伍名（联机22）：空串 = 没队伍。
   *
   * 随 `move` 一起发出去，队友据此判"是不是自己人"——队伍表本身各端各存一份，
   * 不同步（用同一条 `/team join` 才会一致）。
   */
  private myTeam = '';
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
    // 房间/口令从地址里拆（联机26）：`ws://host:8787/red?pw=1234`
    const parsed = parseServerUrl(url);
    this.url = parsed.url;
    this.room = parsed.room;
    this.password = parsed.password;
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
          // 房间与口令（联机26）：没填就不带
          ...(this.room ? { room: this.room } : {}),
          ...(this.password ? { password: this.password } : {}),
        }),
      );
    };

    socket.onmessage = (event) => {
      // 下行速率（联机29）：收包时按原始文本长度记账
      this.stats.recordReceived(String(event.data).length);
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
      // 统计归零（联机29）：重连之后是一条新连接，延迟/速率都该重新算
      this.stats.reset();
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
      case 'pong': {
        // 延迟样本（联机29）：与最早那条未回的 ping 配对
        this.stats.ackPing();
        break;
      }
      case 'item-take': {
        this.handlers.onItemTake?.({
          ok: message.ok === true,
          owner: Number(message.owner ?? 0),
          localId: Number(message.localId ?? 0),
          itemId: Number(message.itemId ?? 0),
          count: Number(message.count ?? 0),
          reason: String(message.reason ?? ''),
        });
        break;
      }
      case 'arrow': {
        this.handlers.onArrow?.({
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
          vx: Number(message.vx),
          vy: Number(message.vy),
          vz: Number(message.vz),
          damage: Number(message.damage ?? 0),
        });
        break;
      }
      case 'tnt': {
        this.handlers.onTnt?.({
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
          dimension: String(message.dimension ?? 'overworld'),
        });
        break;
      }
      case 'player-hit': {
        this.handlers.onPlayerHit?.({
          fromId: Number(message.fromId ?? 0),
          fromName: String(message.fromName ?? ''),
          fromTeam: String(message.fromTeam ?? ''),
          damage: Number(message.damage ?? 0),
        });
        break;
      }
      case 'mob-hit': {
        this.handlers.onMobHit?.({
          typeId: String(message.typeId ?? ''),
          dimension: String(message.dimension ?? 'overworld'),
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
          damage: Number(message.damage ?? 0),
          fire: Number(message.fire ?? 0),
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
          dimension: String(message.dimension ?? 'overworld'),
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
    // 统计推进（联机29）：清过期的速率桶与超时的 ping
    this.stats.tick(now);
    if (!this.connected || this.selfId === 0) return;
    // 延迟探测：每 2 秒一条应用层 ping（协议层 ping 帧浏览器发不了）
    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now;
      this.stats.sentPing(now);
      this.sendRaw(JSON.stringify({ t: 'ping' }));
    }
    if (now - this.lastMoveSent < MOVE_SEND_INTERVAL_MS) return;
    this.lastMoveSent = now;
    this.sendRaw(
      JSON.stringify({
        t: 'move',
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
        z: Number(z.toFixed(3)),
        // 角度保留 3 位小数：1e-3 弧度已经远小于一像素
        yaw: Number(yaw.toFixed(3)),
        pitch: Number(pitch.toFixed(3)),
        dimension,
        // 队伍（联机22）：没队伍就不带，省字节
        ...(this.myTeam ? { team: this.myTeam } : {}),
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
    this.sendRaw(
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
    this.sendRaw(JSON.stringify({ t: 'container', x, y, z, dimension, slots }));
  }

  /**
   * 本地生成了一堆掉落物 → 广播（L7 第一刀）。
   *
   * `localId` 由生成方自己分配，服务端拼上玩家 id 当全局键；坐标保留两位小数，
   * 镜像本来就不跑物理，多出来的精度没有意义。
   */
  sendItemSpawn(localId: number, itemId: number, count: number, x: number, y: number, z: number): void {
    if (!this.connected) return;
    this.sendRaw(
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

  /**
   * 我要捡别人那堆掉落物（联机21）：请服务端仲裁"谁先拿到"。
   *
   * `owner/localId` 就是镜像表的键（服务端那侧 key 是 `owner:localId`）。
   * **本地先不加进背包**——要等服务端回 `ok`，否则两个人都会各拿一份。
   */
  sendItemTake(owner: number, localId: number): void {
    if (!this.connected) return;
    this.sendRaw(JSON.stringify({ t: 'item-take', owner: Math.trunc(owner), localId: Math.trunc(localId) }));
  }

  /** 本地那堆没了（被捡走/烧掉/过期）→ 让所有人删掉镜像 */
  sendItemRemove(localId: number): void {
    if (!this.connected) return;
    this.sendRaw(JSON.stringify({ t: 'item-remove', localId: Math.trunc(localId) }));
  }

  /**
   * 唯一的发送出口（联机29）：顺手按**载荷长度**记账，供 F3 面板显示上行速率。
   *
   * 收所有发送走这里而不是各处 `socket.send`：浏览器没有任何"已发送字节数"的读数，
   * 漏一处，上行速率就永远偏低。
   */
  private sendRaw(payload: string): void {
    const socket = this.socket;
    // 没连上就什么都不做，也**不记账**：否则上行速率会因为"发了但没发出去"偏高
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(payload);
    this.stats.recordSent(payload.length);
  }

  sendChat(text: string): void {
    if (!this.connected) return;
    this.sendRaw(JSON.stringify({ t: 'chat', text }));
  }

  /** 我写了/擦了牌子上的字（联机16）。全空 = 擦掉 */
  sendSign(x: number, y: number, z: number, dimension: string, lines: readonly string[]): void {
    if (!this.connected) return;
    this.sendRaw(JSON.stringify({ t: 'sign', x, y, z, dimension, lines }));
  }

  /**
   * 我射了一支箭（联机23）：发位置/速度/伤害，**不发 id**。
   *
   * 各端收到后自己在本地生成一支箭跑物理——落点会有几厘米差异，但"看到队友在射箭"
   * 这件事成立，而且不需要为飞行体维护全局 id 与生命周期。
   */
  sendArrow(arrow: NetArrowState): void {
    if (!this.connected) return;
    this.sendRaw(
      JSON.stringify({
        t: 'arrow',
        x: Number(arrow.x.toFixed(2)),
        y: Number(arrow.y.toFixed(2)),
        z: Number(arrow.z.toFixed(2)),
        vx: Number(arrow.vx.toFixed(2)),
        vy: Number(arrow.vy.toFixed(2)),
        vz: Number(arrow.vz.toFixed(2)),
        damage: Number(arrow.damage.toFixed(1)),
      }),
    );
  }

  /** 我点燃了一格 TNT（联机23）：坐标即 key，对方那边 `prime` 是幂等的 */
  sendTnt(x: number, y: number, z: number, dimension: string): void {
    if (!this.connected) return;
    this.sendRaw(JSON.stringify({ t: 'tnt', x, y, z, dimension }));
  }

  /** 我所在的队伍名（联机22）：空串 = 没队伍；随 `move` 一起发，供对方判友伤 */
  setTeam(team: string): void {
    this.myTeam = team;
  }

  /** 我打了一名玩家（联机22）：服务端只转发给被击者，再由他那边判一次友伤 */
  sendPlayerHit(targetId: number, damage: number, team: string): void {
    if (!this.connected) return;
    this.sendRaw(
      JSON.stringify({ t: 'player-hit', targetId: Math.trunc(targetId), damage: Number(damage.toFixed(1)), team }),
    );
  }

  /**
   * 我打了一只生物（联机19）：发的是"类型 + 坐标 + 伤害"，不是 id。
   *
   * 队友那边用它找自己世界里最近的那只同类怪扣血。**对方找不到就忽略**——
   * 两端生物是各自生成的，不能为了"看起来同步"凭空造一只出来。
   */
  sendMobHit(typeId: string, dimension: string, x: number, y: number, z: number, damage: number, fire = 0): void {
    if (!this.connected) return;
    this.sendRaw(
      JSON.stringify({
        t: 'mob-hit',
        typeId,
        dimension,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        z: Number(z.toFixed(2)),
        damage: Number(damage.toFixed(1)),
        fire: Number(fire.toFixed(1)),
      }),
    );
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
    this.sendRaw(JSON.stringify({ t: 'frame', x, y, z, dimension, item, rotation }));
  }

  /**
   * 我睡满跳夜了（联机11）：让服务端把大家的时间一起跳到黎明。
   *
   * 只发"我睡了"这一个事实，不带时间——服务端才是权威（它决定跳到几点、要不要清天气）。
   */
  sendSleep(): void {
    if (!this.connected) return;
    this.sendRaw(JSON.stringify({ t: 'sleep' }));
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
  // 显式指定优先（部署到子路径/别的主机时用）：`?server=wss://mc.example.com/ws`
  const override = new URLSearchParams(window.location.search).get('server');
  if (override) return override;
  // 同源 https 页面走 `wss://<host>/ws`（混合内容会被浏览器拦），http 页面走本地默认端口
  return resolveDefaultServerUrl(window.location.protocol, window.location.host, window.location.hostname);
}
