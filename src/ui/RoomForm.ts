/**
 * 加入房间 / 开房共用的表单字段（L9）。
 *
 * 为什么抽出来：两个入口收集的是同一组东西——服务器地址、房间名、密码、昵称，连
 * 「▾ 选择服务器」与「粘贴带房名的老地址自动拆开」都一模一样。以前两边各写一遍，
 * 加一个字段就要改两处；昵称就漏在开房那边（`WorldScreen` 只写了三项）。
 *
 * **只抽字段与校验，不抽布局**：加入面板是"房间 + 密码挤同一行"、开房对话框是"一行一项"，
 * 两种版式都卡在手机横屏 360~430 的高度预算上，硬统一只会更挤。所以这里返回元素本身，
 * 谁用谁排版。按钮、状态行、房间列表也不在这里——那是宿主自己的事。
 *
 * 职责边界：不发起连接、不显示错误（只把原因交给宿主），所以它在 Node 里也能测。
 */

import { t } from '../core/i18n/I18n.ts';
import { cleanPlayerName, MULTIPLAYER_NAME_MAX } from '../core/net/PlayerName.ts';
import { sanitizeRoomName } from '../core/net/RoomName.ts';
import {
  DEFAULT_NET_PORT,
  displayServerAddress,
  displayServerHost,
  formatServerUrl,
  normalizeServerUrl,
  parsePort,
  parseServerUrl,
  portOf,
  withPort,
} from '../core/net/ServerUrl.ts';
import { ServerPicker, type PickedServer } from './ServerPicker.ts';

export interface RoomFormOptions {
  /**
   * `join`：进别人的房，房间可以留空（服务端默认房间）；
   * `host`：用当前世界开房，房间**必填**——两拨人都留空会撞在同一个默认房名上，
   * 第二个开房的人只会得到一句看不懂的 `host-taken`。
   */
  mode: 'join' | 'host';
  /** 地址框初始值（显示形式，只 IP/域名；协议头由 `normalizeServerUrl` 补） */
  initialAddress?: string;
  /** 端口框初始值（用户 2026-10-27：端口可编辑，默认 8887） */
  initialPort?: number;
  /**
   * 地址框里认的"本机"别名（设计图：开房那一栏默认写「本机」）。
   * 输入框里正好等于这个词时，实际用 `localAddress()` 返回的地址。
   */
  localAlias?: string;
  /** 「本机」对应的真实地址（开房时由主程序给 `defaultHostAddress()`） */
  localAddress?: () => string;
  initialRoom?: string;
  initialPassword?: string;
  initialName?: string;
  /**
   * 房名清洗后为空时的回退值（`sanitizeRoomName` 的第二个参数）。
   * 开房时传"世界名派生的房名"，加入时留默认（服务端默认房间）。
   */
  roomFallback?: string;
  /** 是否渲染昵称输入框（加入与开房都要，默认 true） */
  withName?: boolean;
  /** 输入框的公共 class（开房对话框是 `world-input`，加入面板靠 `.mp-row input` 选中） */
  inputClass?: string;
  /** 地址行右侧「▾」的 id 与 class——两个宿主的样式不同，由它们自己给 */
  pickButtonId?: string;
  pickButtonClass?: string;
  /** 这个客户端能不能内建服务端（透传给选择服务器面板的「本机」区） */
  localServer?: boolean;
  /** 地址不合法时的文案（加入面板与开房对话框原本文案不同，保持各自主张） */
  addressError?: string;
  /** 房间为空时的文案（仅 `mode: 'host'` 用得上） */
  roomError?: string;
  /** 选中服务器/房间之后宿主要做的事（清错误、挪焦点、刷新房间列表） */
  onPick?: (picked: PickedServer) => void;
}

export interface RoomFormValues {
  /** 归一化后的裸地址；`null` = 地址不合法 */
  baseUrl: string | null;
  /** 拼上房间与密码的完整地址（`baseUrl` 为 null 时是空串） */
  url: string;
  /** 房间名（空串 = 服务端默认房间） */
  room: string;
  password: string;
  name: string;
  /** 校验失败的原因；空串 = 通过（宿主要不要显示由它自己决定） */
  error: string;
}

const PASSWORD_MAX = 32;
const ROOM_MAX = 24;

export class RoomForm {
  readonly urlInput: HTMLInputElement;
  readonly roomInput: HTMLInputElement;
  readonly passwordInput: HTMLInputElement;
  /** `withName: false` 时为 null */
  readonly nameInput: HTMLInputElement | null;
  /** 没给 `pickButtonId` 时为 null */
  readonly pickButton: HTMLButtonElement | null;
  /**
   * 端口输入框（用户 2026-10-27 改口径：**端口可编辑**，默认 8887）。
   *
   * 与地址框分开是为了照设计图的 `服务器 [IP] : [8887] [选择]` 版式；`read()` 时
   * 用 `withPort()` 把它拼回 URL。端口框留空/填坏时静默回退默认值——旁边就是地址，
   * 为一个数字弹红字不值当。
   */
  readonly portInput: HTMLInputElement;

  private picker: ServerPicker | null = null;

  constructor(private readonly options: RoomFormOptions) {
    const className = options.inputClass ?? '';

    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    if (className) this.urlInput.className = className;
    this.urlInput.id = options.mode === 'host' ? 'world-host-address' : 'mp-url';
    this.urlInput.inputMode = 'url';
    this.urlInput.autocomplete = 'off';
    this.urlInput.spellcheck = false;
    this.urlInput.placeholder = t('mp.serverHint');
    this.urlInput.value = displayServerAddress(options.initialAddress ?? '');

    this.roomInput = document.createElement('input');
    this.roomInput.type = 'text';
    if (className) this.roomInput.className = className;
    this.roomInput.id = options.mode === 'host' ? 'world-host-room' : 'mp-room';
    this.roomInput.maxLength = ROOM_MAX;
    this.roomInput.autocomplete = 'off';
    this.roomInput.spellcheck = false;
    this.roomInput.placeholder = t('mp.roomHint');
    this.roomInput.value = options.initialRoom ?? '';

    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'text';
    if (className) this.passwordInput.className = className;
    this.passwordInput.id = options.mode === 'host' ? 'world-host-password' : 'mp-password';
    this.passwordInput.maxLength = PASSWORD_MAX;
    this.passwordInput.autocomplete = 'off';
    this.passwordInput.spellcheck = false;
    this.passwordInput.placeholder = t('mp.passwordHint');
    this.passwordInput.value = options.initialPassword ?? '';

    this.nameInput =
      options.withName === false
        ? null
        : (() => {
            const input = document.createElement('input');
            input.type = 'text';
            if (className) input.className = className;
            input.id = options.mode === 'host' ? 'world-host-name' : 'mp-name';
            input.maxLength = MULTIPLAYER_NAME_MAX;
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.value = options.initialName ?? '';
            return input;
          })();

    this.pickButton = options.pickButtonId ? this.makePickButton(options.pickButtonId, options.pickButtonClass ?? '') : null;

    this.portInput = document.createElement('input');
    this.portInput.type = 'text';
    this.portInput.id = options.mode === 'host' ? 'world-host-port' : 'mp-port';
    this.portInput.className = 'mp-port-input';
    this.portInput.inputMode = 'numeric';
    this.portInput.maxLength = 5;
    this.portInput.autocomplete = 'off';
    this.portInput.spellcheck = false;
    this.portInput.title = t('mp.portHint');
    this.portInput.setAttribute('aria-label', t('mp.port'));
    this.portInput.value = String(options.initialPort ?? DEFAULT_NET_PORT);
  }

  /**
   * 地址里带了房间/密码时把它们拆到独立输入框（粘贴老格式地址的兼容）。
   *
   * 老格式 `ws://host:8887/red?pw=1234` 是"一个世界一份日志"的老习惯，直接报错太粗暴；
   * 只在**对应输入框还空着**的时候填，避免覆盖玩家已经手打的内容。
   */
  /**
   * 地址框实际代表什么：填的是「本机」别名就换成宿主给的地址，否则原样。
   *
   * 别名只在**完全等于**那个词时生效（`本机` 里带空格、带别名都不算），
   * 免得玩家手打一个含"本机"的主机名被吞掉。
   */
  private resolveAddress(): string {
    const alias = this.options.localAlias;
    if (alias !== undefined && alias.length > 0 && this.urlInput.value.trim() === alias) {
      return this.options.localAddress?.() ?? '';
    }
    return this.urlInput.value;
  }

  splitAddress(): void {
    if (this.options.localAlias !== undefined && this.urlInput.value.trim() === this.options.localAlias) {
      // 「本机」是个占位词，没有端口/房名可拆（真地址要提交时才展开）
      return;
    }
    const normalized = normalizeServerUrl(this.urlInput.value);
    if (!normalized) return;

    /*
     * 端口先"提"到独立输入框（2026-10-27）：地址栏只留主机名，端口由 `: [8887]` 那一格负责。
     * 玩家粘一条 `ws://h:9000/red?pw=1` 进来时，三个字段各归各位。
     */
    const port = portOf(normalized);
    if (this.portInput.value.trim().length === 0 || port !== DEFAULT_NET_PORT) {
      this.portInput.value = String(port);
    }

    const parsed = parseServerUrl(normalized);
    if (parsed.room.length === 0 && parsed.password.length === 0) {
      // 只有端口也要落到地址框：`ws://h:9000` → `h`
      this.urlInput.value = displayServerHost(parsed.url);
      return;
    }
    this.urlInput.value = displayServerHost(parsed.url);
    if (parsed.room.length > 0 && this.roomInput.value.trim().length === 0) {
      this.roomInput.value = parsed.room;
    }
    if (parsed.password.length > 0 && this.passwordInput.value.trim().length === 0) {
      this.passwordInput.value = parsed.password;
    }
  }

  /**
   * 读表单。地址归一化在这里做（宿主的地址框只放裸地址），房间/密码/昵称按各自规则清洗。
   *
   * 返回的 `error` 只描述"这台机器就能判定的错"（地址不合法、开房没填房名）：
   * 服务端才知道的错（重名、房名被占、密码不对）要走连接后的 `onError`。
   */
  read(): RoomFormValues {
    const normalized = normalizeServerUrl(this.resolveAddress());
    // 端口以独立输入框为准（2026-10-27）；填坏/留空就静默回退默认 8887
    const port = parsePort(this.portInput.value) ?? DEFAULT_NET_PORT;
    const baseUrl = normalized === null ? null : withPort(normalized, port);
    const rawRoom = this.roomInput.value.trim();
    const password = this.passwordInput.value.trim().slice(0, PASSWORD_MAX);
    // 空 = 进默认房间（服务端 `DEFAULT_ROOM`），不硬塞一个名字
    const room = rawRoom.length > 0 ? sanitizeRoomName(rawRoom, this.options.roomFallback) : '';
    /*
     * 昵称**不再兜底成「玩家」**（用户 2026-10-26：必须自己填一个）。
     * 空串就是"没填"，由宿主用 `nameIsBlank()` 当场拦下——默认名在多人场景里必然撞
     * `duplicate-name`，而那条错要连上之后才知道，体验是"点了加入 → 被踢"。
     */
    const name = this.nameInput ? cleanPlayerName(this.nameInput.value) : '';

    let error = '';
    if (baseUrl === null) {
      error = this.options.addressError ?? t('world.addressRequired');
    } else if (this.options.mode === 'host' && rawRoom.length === 0) {
      error = this.options.roomError ?? t('world.roomRequired');
    }

    return {
      baseUrl,
      url: baseUrl === null ? '' : formatServerUrl(baseUrl, room, password),
      room,
      password,
      name,
      error,
    };
  }

  /** 昵称是否为空（必填校验用；`withName: false` 时恒为 false） */
  nameIsBlank(): boolean {
    return this.nameInput !== null && cleanPlayerName(this.nameInput.value).length === 0;
  }

  /** 把焦点送到某个输入框（对话框打开时聚焦房名、选中服务器后回到地址） */
  focus(target: 'address' | 'port' | 'room' | 'name' | 'password'): void {
    const input =
      target === 'address'
        ? this.urlInput
        : target === 'port'
          ? this.portInput
          : target === 'room'
            ? this.roomInput
            : target === 'name'
              ? this.nameInput
              : this.passwordInput;
    input?.focus();
  }

  /**
   * 拆掉挂在 `<body>` 上的选择服务器面板。
   *
   * 必须由宿主在销毁时调用：这个面板是浮层，不比宿主活得短就会留在屏幕上压着别的东西。
   */
  dispose(): void {
    this.picker?.dispose();
    this.picker = null;
  }

  private makePickButton(id: string, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.id = id;
    // 设计图里这颗是文字「选择」（不是 ▾ 图标，也不是「选择服务器」那种长词）
    button.textContent = t('mp.pick');
    button.title = t('server.pick');
    button.setAttribute('aria-label', t('server.pick'));
    button.addEventListener('click', () => this.openPicker());
    return button;
  }

  /**
   * 「选择服务器」：第一次点才建面板，之后常驻。
   *
   * 选中的地址**只写回地址框**（协议头与端口由 `normalizeServerUrl` 补），随后跑一次
   * `splitAddress()`：面板选出来的地址本来不带房名，但走同一条路能保证"填进去的东西
   * 一定被规整过"（玩家手动粘一条老格式地址进来也一样）。
   */
  private openPicker(): void {
    if (!this.picker) {
      this.picker = new ServerPicker({
        currentAddress: () => this.urlInput.value,
        currentPort: () => parsePort(this.portInput.value) ?? DEFAULT_NET_PORT,
        // 加入 = 选房间（点房间行有意义）；开房 = 只选机器（房间由玩家自己起名）
        mode: this.options.mode === 'join' ? 'room' : 'server',
        localServer: this.options.localServer === true,
        onPick: (picked) => {
          this.urlInput.value = picked.address;
          this.portInput.value = String(picked.port);
          // 选了具体房间就覆盖房名（那是玩家刚才明确点的那一行）
          if (picked.room !== undefined) this.roomInput.value = picked.room;
          this.options.onPick?.(picked);
        },
      });
      document.body.append(this.picker.element);
    }
    // 浮窗贴着「选择」按钮弹出（用户 2026-10-27）
    this.picker.open(this.pickButton ?? this.portInput);
  }
}
