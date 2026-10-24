/**
 * 「本局房间」信息卡（L9）
 *
 * 暂停菜单里那颗键原来叫「多人游戏」、点开是"填地址去连"——可一旦已经联机了，
 * 玩家想要的完全不是"再连一次"，而是：**我在哪个房间、谁是房主、几个人、怎么把朋友叫进来**。
 * 所以联机中它显示这张卡；没联机时仍然是"去联机"（那条路留给 `MultiplayerScreen`）。
 *
 * 为什么不做成一颗"复制房间号"的小按钮：手机上把邀请发给朋友是最常见的动作，
 * 而邀请必须带上**服务器地址**（浏览器发不了局域网广播，朋友没法"搜到"你）——
 * 一段现成的文本比让朋友自己拼地址靠谱得多。
 */

import { t, tp } from '../core/i18n/I18n.ts';
import type { NetRole } from '../core/net/NetRole.ts';
import { formatServerUrl } from '../core/net/ServerUrl.ts';

export interface RoomCardInfo {
  /** 房间名（空串 = 服务端默认房间） */
  room: string;
  /** 我的角色：`solo` = 还没联机（这时卡片不该出现） */
  role: NetRole;
  /** 在线人数（含自己） */
  players: number;
  /** 房间的世界名（房主没上报时为空） */
  worldName: string;
  /** 房间的世界种子 */
  worldSeed: number;
  /** 服务端裸地址（`ws://192.168.1.5:8787`），拼邀请时用 */
  baseUrl: string;
  /** 房间口令（空 = 没有） */
  password: string;
}

export interface RoomCardActions {
  onDisconnect: () => void;
  onClose: () => void;
}

export class RoomCard {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly inviteInput: HTMLInputElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly hint: HTMLDivElement;
  private openState = false;

  constructor(
    host: HTMLElement,
    private readonly actions: RoomCardActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'room-card';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'room-panel';

    const title = document.createElement('b');
    title.className = 'room-title';
    title.textContent = t('room.title');

    this.body = document.createElement('div');
    this.body.className = 'room-body';

    // 邀请地址：只读输入框，点一下全选（剪贴板被拦时玩家还能手动复制）
    this.inviteInput = document.createElement('input');
    this.inviteInput.type = 'text';
    this.inviteInput.id = 'room-invite';
    this.inviteInput.className = 'room-invite';
    this.inviteInput.readOnly = true;
    this.inviteInput.spellcheck = false;
    this.inviteInput.addEventListener('focus', () => this.inviteInput.select());

    this.hint = document.createElement('div');
    this.hint.className = 'room-hint';

    const copyRow = document.createElement('div');
    copyRow.className = 'room-actions';
    this.copyButton = document.createElement('button');
    this.copyButton.type = 'button';
    this.copyButton.id = 'room-copy';
    this.copyButton.className = 'room-action primary';
    this.copyButton.textContent = t('room.copy');
    this.copyButton.addEventListener('click', () => void this.copyInvite());
    copyRow.append(this.copyButton);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'room-actions';
    const disconnect = document.createElement('button');
    disconnect.type = 'button';
    disconnect.id = 'room-disconnect';
    disconnect.className = 'room-action';
    disconnect.textContent = t('mp.disconnect');
    disconnect.addEventListener('click', () => {
      this.actions.onDisconnect();
      this.hide();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'room-close';
    close.className = 'room-action';
    close.textContent = t('mp.close');
    close.addEventListener('click', () => this.actions.onClose());
    actionsRow.append(disconnect, close);

    panel.append(title, this.body, this.inviteInput, copyRow, this.hint, actionsRow);
    this.root.append(panel);
    host.append(this.root);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  show(info: RoomCardInfo): void {
    this.openState = true;
    this.body.replaceChildren(
      this.makeRow(t('world.roomName'), info.room.length > 0 ? info.room : t('room.defaultRoom')),
      this.makeRow(
        t('room.role'),
        info.role === 'host' ? t('mp.role.host') : t('mp.role.client'),
      ),
      this.makeRow(t('room.players'), tp('mp.roomsPlayers', { n: info.players })),
      this.makeRow(
        t('room.world'),
        info.worldName.length > 0
          ? `${info.worldName} · ${tp('room.seed', { seed: info.worldSeed })}`
          : tp('room.seed', { seed: info.worldSeed }),
      ),
    );
    this.inviteInput.value = this.buildInvite(info);
    this.hint.textContent = t('room.inviteHint');
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.openState = false;
    this.root.classList.add('hidden');
  }

  /** 邀请文本：朋友只需要照着这一行填地址与房间（浏览器发不了局域网广播） */
  buildInvite(info: RoomCardInfo): string {
    const url = formatServerUrl(info.baseUrl, info.room, info.password);
    return tp('room.invite', {
      world: info.worldName.length > 0 ? info.worldName : info.room,
      url,
    });
  }

  /**
   * 复制邀请。
   *
   * `navigator.clipboard` **只在安全上下文**（https / localhost）可用，而局域网里手机
   * 连的是 `http://192.168.x.x:5173`——那里它是 `undefined`。所以留一条老路：
   * 选中输入框内容用 `execCommand('copy')`，再不行就只把文字选中，让玩家自己长按复制。
   */
  private async copyInvite(): Promise<void> {
    const text = this.inviteInput.value;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        this.hint.textContent = t('room.copied');
        return;
      }
      this.inviteInput.focus();
      this.inviteInput.select();
      const ok = document.execCommand('copy');
      this.hint.textContent = ok ? t('room.copied') : t('room.copyManual');
    } catch {
      this.inviteInput.focus();
      this.inviteInput.select();
      this.hint.textContent = t('room.copyManual');
    }
  }

  private makeRow(label: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'room-row';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('b');
    val.textContent = value;
    row.append(key, val);
    return row;
  }
}
