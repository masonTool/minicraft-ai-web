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
  WORLD_TYPE_LABELS,
  randomSeed,
  type WorldType,
} from '../core/gen/WorldType.ts';
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from '../core/world/Rules.ts';
import { GAME_MODES, GAME_MODE_LABELS, type GameMode } from '../core/world/GameMode.ts';
import type { WorldRegistry, WorldSummary } from '../core/save/WorldRegistry.ts';
import { formatBuildInfo, readBuildInfo } from '../game/buildInfo.ts';

export interface WorldScreenActions {
  /** 进入世界（已有存档或刚创建的都走这里） */
  onEnter: (world: WorldSummary) => void;
  /** 删除世界（含存档数据）；调用方负责真的删库 */
  onDelete: (world: WorldSummary) => void;
  /** 打开设置（图形/操作/声音这些是"这台设备的偏好"，与世界无关） */
  onSettings?: () => void;
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
  private readonly typeSelect: HTMLSelectElement;
  /** 新建世界时的难度（I7）：进世界后还能用 /difficulty 改 */
  private readonly difficultySelect: HTMLSelectElement;
  /** 新建世界时的游戏模式（批次 181）：生存/创造；进世界后可在暂停菜单里改 */
  private readonly gameModeSelect: HTMLSelectElement;
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

    worlds.append(
      this.makeNav(t('menu.play'), () => this.setView('home')),
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

    this.typeSelect = document.createElement('select');
    this.typeSelect.className = 'world-input';
    for (const type of WORLD_TYPES) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = WORLD_TYPE_LABELS[type];
      this.typeSelect.appendChild(option);
    }

    this.difficultySelect = document.createElement('select');
    this.difficultySelect.className = 'world-input';
    for (const value of DIFFICULTIES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${DIFFICULTY_LABELS[value]}（${value}）`;
      this.difficultySelect.appendChild(option);
    }
    this.difficultySelect.value = 'normal';

    // 游戏模式（批次 181）：**在创建时就要选**，不要靠游戏里双击跳跃去猜
    this.gameModeSelect = document.createElement('select');
    this.gameModeSelect.className = 'world-input';
    for (const value of GAME_MODES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = GAME_MODE_LABELS[value];
      this.gameModeSelect.appendChild(option);
    }
    this.gameModeSelect.value = 'survival';

    // 世界类型说明（批次 181）：超平坦"没有树/村庄/矿石"必须写在选之前
    this.typeHintEl = document.createElement('div');
    this.typeHintEl.className = 'world-type-hint';
    this.typeSelect.addEventListener('change', () => this.updateTypeHint());
    this.gameModeSelect.addEventListener('change', () => this.updateTypeHint());

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
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createAndEnter();
    });

    // 批次 184：**说明放最后**（原来夹在"类型"和"难度"中间，把两列栅格切断了：
    // 第二行只剩类型一格、难度与模式被挤到下面，整张表单多出两行高度）。
    // 现在三行字段两两并排 → 一行说明 → 跨满两列的创建键，横屏手机一屏就能看全。
    form.append(
      this.makeRow(t('world.name'), this.nameInput, null),
      this.makeRow(t('world.seed'), this.seedInput, reroll),
      this.makeRow(t('world.type'), this.typeSelect, null),
      this.makeRow(t('world.difficulty'), this.difficultySelect, null),
      this.makeRow(t('world.gameMode'), this.gameModeSelect, null),
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
  private makeRow(label: string, control: HTMLElement, extra: HTMLElement | null): HTMLLabelElement {
    const row = document.createElement('label');
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
    this.worldCountEl.textContent = ` ${worlds.length}`;

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

    const info = document.createElement('div');
    info.className = 'world-card-info';

    const thumbnail = document.createElement('div');
    thumbnail.className = 'world-card-thumb';
    thumbnail.dataset.worldType = world.worldType;
    thumbnail.setAttribute('aria-hidden', 'true');

    const name = document.createElement('div');
    name.className = 'world-card-name';
    name.textContent = world.name;

    const meta = document.createElement('div');
    meta.className = 'world-card-meta';
    meta.textContent = `${WORLD_TYPE_LABELS[world.worldType]} · ${DIFFICULTY_LABELS[world.difficulty]} · ${GAME_MODE_LABELS[world.gameMode]} · 种子 ${world.seed}`;

    const stats = document.createElement('div');
    stats.className = 'world-card-meta';
    const played = world.playTime >= 60 ? `${Math.round(world.playTime / 60)} 分钟` : `${Math.round(world.playTime)} 秒`;
    stats.textContent = `上次游玩 ${relativeTime(world.lastPlayed)} · 已游玩 ${played} · 改动 ${world.edits} 格`;

    info.append(name, meta, stats);

    const buttons = document.createElement('div');
    buttons.className = 'world-card-actions';

    const enter = document.createElement('button');
    enter.type = 'button';
    // 验收脚本按这个类名找"进这张存档"（`.world-card-actions button` 会把"删除"也算进来，
    // 靠"第一个匹配"来定含义太脆）
    enter.className = 'world-enter';
    enter.textContent = t('world.enter');
    enter.addEventListener('click', () => this.actions.onEnter(world));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = t('world.delete');
    remove.addEventListener('click', () => {
      if (confirm(`删除「${world.name}」？该世界的存档会一起删掉，无法恢复。`)) {
        this.actions.onDelete(world);
        this.render();
      }
    });

    buttons.append(enter, remove);
    card.append(thumbnail, info, buttons);
    return card;
  }

  /** 读取表单 → 新建世界 → 进入 */
  private createAndEnter(): void {
    const raw = this.seedInput.value.trim();
    let seed: number | undefined;
    if (raw.length > 0) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        alert('种子要填数字，或者留空用随机种子。');
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
  ): void {
    this.setView('create');
    this.nameInput.value = name;
    this.seedInput.value = seed;
    this.typeSelect.value = worldType;
    this.difficultySelect.value = difficulty;
    this.gameModeSelect.value = gameMode;
    this.updateTypeHint();
  }

  /** 世界类型说明 + "超平坦 + 生存"的警告（批次 181） */
  private updateTypeHint(): void {
    const type = this.typeSelect.value as WorldType;
    const survival = this.gameModeSelect.value === 'survival';
    const base = WORLD_TYPE_HINTS[type] ?? '';
    const warn = type === 'flat' && survival;
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
