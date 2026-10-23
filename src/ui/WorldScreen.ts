/**
 * 主菜单（分层：主页 → 世界列表 / 新建世界）
 *
 * 启动时先出这个界面，而不是直接冲进世界：这样才有地方"选存档、开新世界、删世界"。
 *
 * ⚠️ **为什么是三层而不是一层**（用户反馈：原来全塞在一屏，太高太复杂）：
 * 基岩版的主菜单是"标题页几个按钮 → 点进去才是世界列表 → 再点才是新建表单"，
 * 层层进入。一层里既有存档列表又有四行新建表单再加设置按钮，一屏装不下、
 * 手机上还得滚；层与层分开之后每一屏都很矮，且"返回"的位置固定。
 * 三个视图共用同一个面板（同一份 DOM 用 `.active` 切换），不建三套 DOM——
 * 两套 DOM 迟早"一处改了、另一处没改"（这个仓库吃过几次这种亏）。
 *
 * 职责边界：只负责"列表怎么画、点了返回什么"，真实的增删改都在 `WorldRegistry` 里，
 * 进世界的动作交回给调用方（`main.ts` 的 boot）。这样这个模块在 Node 里也能测。
 */

import { t } from '../core/i18n/I18n.ts';
import {
  WORLD_TYPES,
  WORLD_TYPE_HINTS,
  worldTypeLabel,
  randomSeed,
  type WorldType,
} from '../core/gen/WorldType.ts';
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from '../core/world/Rules.ts';
import { GAME_MODES, GAME_MODE_LABELS, type GameMode } from '../core/world/GameMode.ts';
import type { WorldRegistry, WorldSummary } from '../core/save/WorldRegistry.ts';
import { BIOMES, biomeLabel } from '../core/gen/Biome.ts';
import { formatBuildInfo, readBuildInfo } from '../game/buildInfo.ts';
import { Dropdown } from './Dropdown.ts';

/** 列表里的世界类型短名（新建表单仍然用带说明的全名） */
const WORLD_TYPE_SHORT_LABELS: Record<WorldType, string> = {
  default: '默认',
  flat: '超平坦',
  large_biomes: '大型群系',
  amplified: '放大化',
  single_biome: '单一群系',
};

/** 编辑世界时允许改的三项（世界类型/种子会改变地形，不在可编辑范围） */
export interface WorldEditPatch {
  name: string;
  gameMode: GameMode;
  difficulty: Difficulty;
}

export interface WorldScreenActions {
  /** 进入世界（已有存档或刚创建的都走这里） */
  onEnter: (world: WorldSummary) => void;
  /** 删除世界（含存档数据）；调用方负责真的删库（可能是异步的） */
  onDelete: (world: WorldSummary) => void | Promise<void>;
  /**
   * 编辑世界（名称 / 模式 / 难度）。
   *
   * 主程序除了回写清单，还要把模式与难度同步进**玩家存档**——
   * 读档时 `loadPlayer().gameMode` 会覆盖清单里的模式，不同步的话
   * "在列表里改成创造，进去还是生存"。
   */
  onEdit?: (world: WorldSummary, patch: WorldEditPatch) => void | Promise<void>;
  /** 打开设置（图形/操作/声音这些是"这台设备的偏好"，与世界无关） */
  onSettings?: () => void;
  /** 导出世界（批次 591，L2）：把存档内容 + 清单项下载成一个文件 */
  onExport?: (world: WorldSummary) => void | Promise<void>;
  /** 导入世界（批次 591，L2）：选一个之前导出的文件，导入成新世界 */
  onImport?: () => void | Promise<void>;
  /**
   * 小游戏（小游戏3）：打开选择页。
   *
   * 不传就**不显示入口**——单机版 / 精简构建把它当可选能力，不需要改界面代码。
   */
  onMiniGames?: () => void;
}

/**
 * 主菜单的三个层级（对齐基岩版的"标题页 → 世界列表 → 新建世界"）。
 * 导出常量而不是写死字面量：验收脚本与断言按名字读它，改名时不会两边漂。
 */
export const WORLD_VIEWS = ['home', 'worlds', 'create'] as const;
export type WorldView = (typeof WORLD_VIEWS)[number];

export class WorldScreen {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly worldCountEl: HTMLSpanElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  /** 批次 528：三张原生 select 换成与设置页同一套下拉 */
  private readonly typeSelect: Dropdown<WorldType>;
  /** 新建世界时的难度（I7）：进世界后还能用 /difficulty 改 */
  private readonly difficultySelect: Dropdown<Difficulty>;
  /** 新建世界时的游戏模式（批次 181）：生存/创造；进世界后可在暂停菜单里改 */
  private readonly gameModeSelect: Dropdown<GameMode>;
  /** 极限模式（批次 550）：普通 / 极限；极限会锁定困难 + 生存 */
  private readonly hardcoreSelect: Dropdown<'normal' | 'hardcore'>;
  /** 单一群系世界选哪种群系（批次 533）：只在类型为 single_biome 时显示 */
  private readonly biomeSelect: Dropdown<string>;
  private readonly biomeRow: HTMLDivElement;
  /** 游戏内确认弹窗（删除世界用；批次 528 不再用 window.confirm） */
  private confirmEl: HTMLDivElement | null = null;
  /** 编辑世界弹窗（批次 529）：同一时间只开一个 */
  private editEl: HTMLDivElement | null = null;
  private editCleanup: (() => void) | null = null;
  /** 世界类型下面那行说明（批次 181：超平坦没有树/村庄/矿石要说在前面） */
  private readonly typeHintEl: HTMLDivElement;
  /** 三个视图各自的那一节（同一份 DOM 用 `.active` 切换，见文件头注释） */
  private readonly views = new Map<WorldView, HTMLElement>();
  private currentView: WorldView = 'home';
  private open = false;

  constructor(
    host: HTMLElement,
    private readonly registry: WorldRegistry,
    private readonly actions: WorldScreenActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'world-screen';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'world-panel';
    this.panel = panel;

    // ---------------------------------------------------------------- ① 主页
    const home = this.makeView('home');

    const title = document.createElement('div');
    title.className = 'world-title';
    const logo = document.createElement('strong');
    logo.className = 'world-logo';
    logo.textContent = 'MINECRAFT';
    const edition = document.createElement('span');
    edition.className = 'world-edition';
    edition.textContent = '基岩版 1.18 · WEB EDITION';
    title.append(logo, edition);

    const subtitle = document.createElement('div');
    subtitle.className = 'world-hint';
    subtitle.textContent = t('menu.tagline');

    const menu = document.createElement('div');
    menu.className = 'world-menu';

    // ⚠️ 首页**只有两颗按钮**（批次 108，对齐基岩版的标题页：一个"游戏"、一个"设置"）。
    //
    // 批次 107 这里写的是"开始游戏 / 选择世界 / 新建世界 / 设置"四颗，其中"开始游戏"
    // 点下去会直接进最近玩的那个世界——用户当场就问了一句"进入游戏，进入什么呢？"。
    // 这个反问是对的：**"进哪个世界"是个必须回答的问题，不该由程序员替玩家默认**。
    // 现在"游戏"只做一件事：进二级页面，那里才有"新建世界"和存档列表。
    //
    // ⚠️ 它仍然必须是**可见视图里的第一个 `.world-primary`**：浏览器验收脚本从这里
    // 开始"进世界"的三步（游戏 → 新建世界 → 创建并进入），少了这个语义那套脚本会全红。
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'world-primary';
    play.textContent = t('menu.play');
    play.addEventListener('click', () => this.setView('worlds'));

    menu.append(play);

    // 设置入口：这里的设置是"这台设备的偏好"（画面/操作/声音），进游戏之前也能改
    if (this.actions.onSettings) {
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'world-secondary';
      settings.textContent = t('menu.settings');
      settings.addEventListener('click', () => this.actions.onSettings?.());
      menu.append(settings);
    }

    // 小游戏入口（小游戏3）：第三颗按钮。
    // ⚠️ 必须是 `world-secondary`：浏览器验收脚本要求"可见视图里的第一颗 `.world-primary`
    // 仍是开始游戏"，把它写成 primary 会让那套脚本全红。
    if (this.actions.onMiniGames) {
      const miniGames = document.createElement('button');
      miniGames.type = 'button';
      miniGames.className = 'world-secondary';
      miniGames.id = 'world-minigames-button';
      miniGames.textContent = t('menu.minigames');
      miniGames.addEventListener('click', () => this.actions.onMiniGames?.());
      menu.append(miniGames);
    }

    const splash = document.createElement('div');
    splash.className = 'world-splash';
    splash.textContent = 'WebGL2!';
    splash.setAttribute('aria-hidden', 'true');
    // ⚠️ splash 挂在**标题块里**（批次 167）：它是 `position: absolute`，
    // 原来作为面板的直接子节点，定位基准就是那个盒子——面板从 400 宽到 760 宽之后，
    // `left: calc(50% + 92px)` 直接落到 MINECRAFT 的字母上。挂进标题块（收缩到内容宽）
    // 之后，它始终贴在主标右上角，与字号无关。
    title.append(splash);

    const footer = document.createElement('div');
    footer.className = 'world-footer';
    const footerNote = document.createElement('div');
    footerNote.textContent = t('menu.footer');
    // 批次 182：当前版本的构建时间 + 提交标题——手机上确认"是不是最新那一版"用
    const build = document.createElement('div');
    build.className = 'world-build';
    build.id = 'world-build';
    build.textContent = formatBuildInfo(readBuildInfo());
    build.title = '当前页面的构建版本';
    footer.append(footerNote, build);

    home.append(title, subtitle, menu, footer);

    // ---------------------------------------------------------------- ② 世界列表
    //
    // 用户要的"新建游戏 / 使用存档"都在这一页：新建在最上（主入口），
    // 下面就是存档列表（列表自己滚，世界再多也不撑破面板）。
    const worlds = this.makeView('worlds');
    this.listEl = document.createElement('div');
    this.listEl.className = 'world-list';
    this.listEl.id = 'world-list';

    const newEntry = document.createElement('button');
    newEntry.type = 'button';
    newEntry.className = 'world-primary';
    newEntry.id = 'world-new-button';
    newEntry.textContent = t('menu.newWorld');
    newEntry.addEventListener('click', () => this.setView('create'));

    const listLabel = document.createElement('div');
    listLabel.className = 'world-group-label';
    listLabel.append(t('world.list'));
    this.worldCountEl = document.createElement('span');
    this.worldCountEl.className = 'world-count';
    listLabel.appendChild(this.worldCountEl);

    // 导入（批次 591，L2）：入口放在世界列表标题旁，不占卡片按钮位
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'world-mini world-import';
    importButton.textContent = t('world.import');
    importButton.addEventListener('click', () => {
      void this.actions.onImport?.();
    });
    listLabel.appendChild(importButton);

    worlds.append(
      this.makeNav(t('world.list'), () => this.setView('home')),
      newEntry,
      listLabel,
      this.listEl,
    );

    // ---------------------------------------------------------------- ③ 新建世界
    const create = this.makeView('create');
    const form = document.createElement('div');
    form.className = 'world-new';

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = t('world.namePlaceholder');
    this.nameInput.maxLength = 24;
    this.nameInput.className = 'world-input';

    this.seedInput = document.createElement('input');
    this.seedInput.type = 'text';
    this.seedInput.inputMode = 'numeric';
    this.seedInput.placeholder = t('world.seedPlaceholder');
    this.seedInput.className = 'world-input';

    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'world-mini';
    reroll.textContent = t('menu.reroll');
    reroll.addEventListener('click', () => {
      this.seedInput.value = String(randomSeed());
    });

    // 世界类型 / 难度 / 模式：与设置页同一个下拉组件（批次 528，用户要求）
    this.typeSelect = new Dropdown<WorldType>(
      WORLD_TYPES,
      Object.fromEntries(WORLD_TYPES.map((type) => [type, worldTypeLabel(type)])) as Record<WorldType, string>,
      'default',
      () => this.updateTypeHint(),
      { fullWidth: true, className: 'world-dropdown' },
    );
    this.difficultySelect = new Dropdown<Difficulty>(
      DIFFICULTIES,
      DIFFICULTY_LABELS,
      'normal',
      () => this.updateTypeHint(),
      { fullWidth: true, className: 'world-dropdown' },
    );
    // 游戏模式（批次 181）：**在创建时就要选**，不要靠游戏里双击跳跃去猜
    this.gameModeSelect = new Dropdown<GameMode>(
      GAME_MODES,
      GAME_MODE_LABELS,
      'survival',
      () => this.updateTypeHint(),
      { fullWidth: true, className: 'world-dropdown' },
    );
    // 极限模式（批次 550）：与难度/模式并排；选了极限后那两个值仍会显示，
    // 但 `WorldRegistry.create` 会把它们强制成"困难 + 生存"
    this.hardcoreSelect = new Dropdown<'normal' | 'hardcore'>(
      ['normal', 'hardcore'],
      { normal: t('world.hardcoreOff'), hardcore: t('world.hardcoreOn') },
      'normal',
      () => this.updateTypeHint(),
      { fullWidth: true, className: 'world-dropdown' },
    );

    // 单一群系的群系选择（批次 533）：默认平原；列表用注册表里的全部群系
    const biomeNames = BIOMES.map((biome) => biome.name);
    const biomeLabels: Record<string, string> = {};
    for (const biome of BIOMES) biomeLabels[biome.name] = biomeLabel(biome.name);
    this.biomeSelect = new Dropdown<string>(
      biomeNames,
      biomeLabels,
      'plains',
      () => undefined,
      { fullWidth: true, className: 'world-dropdown' },
    );
    this.biomeRow = this.makeRow(t('world.biome'), this.biomeSelect.element, null);
    this.biomeRow.hidden = true;

    // 世界类型说明（批次 181）：超平坦"没有树/村庄/矿石"必须写在选之前
    this.typeHintEl = document.createElement('div');
    this.typeHintEl.className = 'world-type-hint';

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'world-primary';
    createButton.id = 'world-create-button';
    createButton.textContent = t('menu.create');
    createButton.addEventListener('click', () => this.createAndEnter());

    // 种子框里回车也直接创建（手输种子是最常见的动作）
    this.seedInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createAndEnter();
    });
    // 改了种子就把"种子要填数字"的红字恢复正常说明
    this.seedInput.addEventListener('input', () => this.updateTypeHint());
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createAndEnter();
    });

    // 批次 184：**说明放最后**（原来夹在"类型"和"难度"中间，把两列栅格切断了：
    // 第二行只剩类型一格、难度与模式被挤到下面，整张表单多出两行高度）。
    // 现在三行字段两两并排 → 一行说明 → 跨满两列的创建键，横屏手机一屏就能看全。
    form.append(
      this.makeRow(t('world.name'), this.nameInput, null),
      this.makeRow(t('world.seed'), this.seedInput, reroll),
      this.makeRow(t('world.type'), this.typeSelect.element, null),
      this.makeRow(t('world.difficulty'), this.difficultySelect.element, null),
      this.makeRow(t('world.gameMode'), this.gameModeSelect.element, null),
      this.makeRow(t('world.hardcore'), this.hardcoreSelect.element, null),
      this.biomeRow,
      this.typeHintEl,
      createButton,
    );
    this.updateTypeHint();

    const hint = document.createElement('div');
    hint.className = 'world-hint';
    hint.textContent = t('world.hint');

    create.append(this.makeNav(t('world.createTitle'), () => this.setView('worlds')), form, hint);

    panel.append(home, worlds, create);
    this.root.append(panel);
    host.appendChild(this.root);

    this.setView('home');
  }

  /** 建一个视图节，登记到 `views` 里 */
  private makeView(view: WorldView): HTMLElement {
    const element = document.createElement('section');
    element.className = 'world-view';
    element.dataset.view = view;
    this.views.set(view, element);
    return element;
  }

  /** 二级页面顶部的"‹ 返回 + 标题"那一行 */
  private makeNav(title: string, onBack: () => void): HTMLDivElement {
    const nav = document.createElement('div');
    nav.className = 'world-nav';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'world-back';
    back.textContent = t('menu.back');
    back.addEventListener('click', onBack);

    const label = document.createElement('b');
    label.className = 'world-nav-title';
    label.textContent = title;

    nav.append(back, label);
    return nav;
  }

  /** 一行"标签 + 控件（+ 右侧小按钮）" */
  private makeRow(label: string, control: HTMLElement, extra: HTMLElement | null): HTMLDivElement {
    // 用 div 而不是 label：label 会把"点标签文字"转发给下拉按钮，
    // 玩家点一下"世界类型"四个字就弹出菜单，反而是误触。
    const row = document.createElement('div');
    row.className = 'world-row';
    const name = document.createElement('span');
    name.textContent = label;
    row.append(name, control);
    if (extra) row.append(extra);
    return row;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 当前停在哪个层级（验收脚本/调试用） */
  get view(): WorldView {
    return this.currentView;
  }

  /**
   * 切层级。进"世界列表"时顺手重画列表（删除/新建之后要靠它刷新）。
   */
  setView(view: WorldView): void {
    this.currentView = view;
    this.panel.dataset.view = view;
    for (const [key, element] of this.views) element.classList.toggle('active', key === view);
    if (view === 'worlds') this.render();
    // 每次进新建页都按当前选择刷新说明（从世界列表删完回来时选择可能没变，但无害）
    if (view === 'create') this.updateTypeHint();
  }

  show(): void {
    this.open = true;
    // 每次回主菜单都落在主页：从世界里退出来时，玩家多半是要"再选一个"或"继续"
    this.setView('home');
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  /** 重画世界列表（列表变化、打开、删除后都要调） */
  render(): void {
    this.listEl.textContent = '';
    const worlds = this.registry.list();
    this.worldCountEl.textContent = String(worlds.length);

    if (worlds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'world-empty';
      empty.textContent = t('menu.empty');
      this.listEl.appendChild(empty);
      return;
    }

    for (const world of worlds) {
      this.listEl.appendChild(this.makeCard(world));
    }
  }

  private makeCard(world: WorldSummary): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'world-card';
    // 完整信息留在悬停提示里（桌面端可看；手机端不占行高）
    card.title = `种子 ${world.seed} · 改动 ${world.edits} 格`;

    const thumbnail = document.createElement('div');
    thumbnail.className = 'world-card-thumb';
    thumbnail.dataset.worldType = world.worldType;
    thumbnail.setAttribute('aria-hidden', 'true');

    const info = document.createElement('div');
    info.className = 'world-card-info';

    const name = document.createElement('div');
    name.className = 'world-card-name';
    name.textContent = world.name;

    // 三个小标签：模式 / 难度 / 世界类型。比原来那行"类型 · 难度 · 模式 · 种子"
    // 更好扫读，也不再让种子这种低频信息占掉一整行。
    const chips = document.createElement('div');
    chips.className = 'world-card-chips';
    chips.append(
      ...(world.hardcore ? [this.makeChip(t('world.hardcoreOn'), 'hardcore', 'hardcore')] : []),
      this.makeChip(GAME_MODE_LABELS[world.gameMode], 'mode', world.gameMode),
      this.makeChip(DIFFICULTY_LABELS[world.difficulty], 'difficulty', world.difficulty),
      this.makeChip(WORLD_TYPE_SHORT_LABELS[world.worldType], 'type', world.worldType),
    );

    const stats = document.createElement('div');
    stats.className = 'world-card-stats';
    const played =
      world.playTime < 60
        ? '不到 1 分钟'
        : world.playTime < 3600
          ? `${Math.round(world.playTime / 60)} 分钟`
          : `${Math.floor(world.playTime / 3600)} 小时 ${Math.round((world.playTime % 3600) / 60)} 分`;
    stats.textContent = `上次游玩 ${relativeTime(world.lastPlayed)} · 已玩 ${played}`;

    info.append(name, chips, stats);

    const buttons = document.createElement('div');
    buttons.className = 'world-card-actions';

    const enter = document.createElement('button');
    enter.type = 'button';
    // 验收脚本按这个类名找"进这张存档"（`.world-card-actions button` 会把"删除"也算进来，
    // 靠"第一个匹配"来定含义太脆）
    enter.className = 'world-enter';
    enter.textContent = t('world.enter');
    enter.addEventListener('click', () => this.actions.onEnter(world));

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'world-edit';
    edit.textContent = t('world.edit');
    edit.addEventListener('click', () => this.openEdit(world));

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'world-export';
    exportButton.textContent = t('world.export');
    exportButton.addEventListener('click', () => {
      void this.actions.onExport?.(world);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = t('world.delete');
    remove.addEventListener('click', () => {
      void this.confirmDelete(world);
    });

    buttons.append(enter, edit, exportButton, remove);
    card.append(thumbnail, info, buttons);
    return card;
  }

  /** 列表里的彩色小标签（模式 / 难度 / 类型） */
  private makeChip(text: string, kind: string, value: string): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.className = 'world-chip';
    chip.dataset.kind = kind;
    chip.dataset.value = value;
    chip.textContent = text;
    return chip;
  }

  /**
   * 编辑世界（批次 529，用户要求）：名称 / 游戏模式 / 难度。
   *
   * 世界类型与种子不在这里改——它们决定地形，改了就不是同一个世界了。
   * 模式与难度同时回写玩家存档，否则读档时会被存档里的旧值覆盖。
   */
  private openEdit(world: WorldSummary): void {
    this.editCleanup?.();
    const overlay = document.createElement('div');
    overlay.className = 'world-modal';
    const panel = document.createElement('div');
    panel.className = 'world-modal-panel';

    const header = document.createElement('div');
    header.className = 'world-modal-header';
    const title = document.createElement('b');
    title.textContent = t('world.editTitle');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'world-modal-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', '关闭');
    header.append(title, close);

    const form = document.createElement('div');
    form.className = 'world-edit-form';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'world-input';
    nameInput.maxLength = 24;
    nameInput.value = world.name;

    const mode = new Dropdown<GameMode>(
      GAME_MODES,
      GAME_MODE_LABELS,
      world.gameMode,
      () => undefined,
      { fullWidth: true, className: 'world-dropdown' },
    );
    const difficulty = new Dropdown<Difficulty>(
      DIFFICULTIES,
      DIFFICULTY_LABELS,
      world.difficulty,
      () => undefined,
      { fullWidth: true, className: 'world-dropdown' },
    );

    const hint = document.createElement('div');
    hint.className = 'world-edit-hint';
    hint.textContent = t('world.editHint');
    const error = document.createElement('div');
    error.className = 'world-edit-error hidden';

    const actions = document.createElement('div');
    actions.className = 'world-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('menu.cancel');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'world-edit-save';
    save.textContent = t('world.save');
    actions.append(cancel, save);

    form.append(
      this.makeRow(t('world.name'), nameInput, null),
      this.makeRow(t('world.gameMode'), mode.element, null),
      this.makeRow(t('world.difficulty'), difficulty.element, null),
      hint,
      error,
    );
    panel.append(header, form, actions);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);
    this.editEl = overlay;

    const cleanup = (): void => {
      document.removeEventListener('keydown', onKey, true);
      mode.dispose();
      difficulty.dispose();
      overlay.remove();
      if (this.editEl === overlay) this.editEl = null;
      if (this.editCleanup === cleanup) this.editCleanup = null;
    };
    this.editCleanup = cleanup;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    };
    document.addEventListener('keydown', onKey, true);
    close.addEventListener('click', cleanup);
    cancel.addEventListener('click', cleanup);
    save.addEventListener('click', () => {
      void (async () => {
        const name = nameInput.value.trim() || '未命名世界';
        save.disabled = true;
        try {
          const patch: WorldEditPatch = {
            name,
            gameMode: mode.value,
            difficulty: difficulty.value,
          };
          if (this.actions.onEdit) await this.actions.onEdit(world, patch);
          else this.registry.update(world.id, patch);
          cleanup();
          this.render();
        } catch (saveError) {
          console.error('[world] 保存编辑失败', saveError);
          error.textContent = '保存失败，请重试';
          error.classList.remove('hidden');
          save.disabled = false;
        }
      })();
    });

    requestAnimationFrame(() => {
      nameInput.focus();
      nameInput.select();
    });
  }

  /**
   * 删除世界：游戏内确认弹窗（批次 528，用户要求不要 `window.confirm`）。
   *
   * 删除是异步的（先删 IndexedDB 再删清单），所以等 `onDelete` 真正完成再重画列表；
   * 否则确认之后卡片还会留在原地几百毫秒。
   */
  private async confirmDelete(world: WorldSummary): Promise<void> {
    const ok = await this.confirm({
      title: t('world.delete'),
      message: `删除「${world.name}」？该世界的存档会一起删掉，无法恢复。`,
      confirmText: t('world.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.actions.onDelete(world);
    } catch (error) {
      console.error('[world] 删除失败', error);
    } finally {
      this.render();
    }
  }

  /** 游戏内的小型确认弹窗（只有确认 / 取消两个出口，点遮罩不关） */
  private confirm(options: {
    title: string;
    message: string;
    confirmText: string;
    danger?: boolean;
  }): Promise<boolean> {
    // 同一时间只留一个
    this.confirmEl?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'world-confirm';
    const panel = document.createElement('div');
    panel.className = 'world-confirm-panel';
    const title = document.createElement('b');
    title.className = 'world-confirm-title';
    title.textContent = options.title;
    const message = document.createElement('div');
    message.className = 'world-confirm-message';
    message.textContent = options.message;
    const actions = document.createElement('div');
    actions.className = 'world-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('menu.cancel');
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.textContent = options.confirmText;
    if (options.danger) accept.className = 'danger';
    actions.append(cancel, accept);
    panel.append(title, message, actions);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);
    this.confirmEl = overlay;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (this.confirmEl === overlay) this.confirmEl = null;
        resolve(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      };
      cancel.addEventListener('click', () => finish(false));
      accept.addEventListener('click', () => finish(true));
      document.addEventListener('keydown', onKey, true);
    });
  }

  /** 读取表单 → 新建世界 → 进入 */
  private createAndEnter(): void {
    const raw = this.seedInput.value.trim();
    let seed: number | undefined;
    if (raw.length > 0) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        this.typeHintEl.textContent = '种子要填数字，或者留空用随机种子。';
        this.typeHintEl.classList.add('bad');
        return;
      }
      seed = Math.floor(parsed);
    }

    const world = this.registry.create({
      name: this.nameInput.value,
      seed,
      worldType: this.typeSelect.value as WorldType,
      difficulty: this.difficultySelect.value as Difficulty,
      gameMode: this.gameModeSelect.value as GameMode,
      hardcore: this.hardcoreSelect.value === 'hardcore',
      ...(this.typeSelect.value === 'single_biome' ? { singleBiome: this.biomeSelect.value } : {}),
    });
    // 清空表单：下次再新建时不会带上一次的名字与种子
    this.nameInput.value = '';
    this.seedInput.value = '';
    this.actions.onEnter(world);
  }

  /** 当前选中的世界类型（验收脚本用） */
  get selectedType(): WorldType {
    return this.typeSelect.value as WorldType;
  }

  /** 验收脚本用：填表但不提交（顺带切到新建页，否则填的是看不见的表单） */
  fillNewWorldForm(
    name: string,
    seed: string,
    worldType: WorldType,
    difficulty: Difficulty = 'normal',
    gameMode: GameMode = 'survival',
    singleBiome = 'plains',
    hardcore: 'normal' | 'hardcore' = 'normal',
  ): void {
    this.setView('create');
    this.nameInput.value = name;
    this.seedInput.value = seed;
    this.typeSelect.setValue(worldType);
    this.difficultySelect.setValue(difficulty);
    this.gameModeSelect.setValue(gameMode);
    this.hardcoreSelect.setValue(hardcore);
    this.biomeSelect.setValue(singleBiome);
    this.updateTypeHint();
  }

  /** 世界类型说明 + "超平坦 + 生存"的警告（批次 181） */
  private updateTypeHint(): void {
    const type = this.typeSelect.value as WorldType;
    const survival = this.gameModeSelect.value === 'survival';
    const base = WORLD_TYPE_HINTS[type] ?? '';
    const warn = type === 'flat' && survival;
    // 只有单一群系世界才显示"选群系"这一行
    this.biomeRow.hidden = type !== 'single_biome';
    this.typeHintEl.textContent = warn ? `${base} —— 生存模式建议改选默认世界，或改用创造模式` : base;
    this.typeHintEl.classList.toggle('bad', warn);
  }

  /** 验收脚本用：等价于点"创建并进入" */
  submitNewWorld(): void {
    this.createAndEnter();
  }
}

/** "3 分钟前"这种人话时间 */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}
