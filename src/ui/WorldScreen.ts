/**
 * 主菜单（世界列表 + 新建世界）
 *
 * 启动时先出这个界面，而不是直接冲进世界：这样才有地方"选存档、开新世界、删世界"。
 * 界面刻意做得很朴素（一列卡片 + 一个新建表单），因为它是**进游戏之前唯一必须过的一道门**，
 * 手机上也要能单手点。
 *
 * 职责边界：只负责"列表怎么画、点了返回什么"，真实的增删改都在 `WorldRegistry` 里，
 * 进世界的动作交回给调用方（`main.ts` 的 boot）。这样这个模块在 Node 里也能测。
 */

import { WORLD_TYPES, WORLD_TYPE_LABELS, randomSeed, type WorldType } from '../core/gen/WorldType.ts';
import type { WorldRegistry, WorldSummary } from '../core/save/WorldRegistry.ts';

export interface WorldScreenActions {
  /** 进入世界（已有存档或刚创建的都走这里） */
  onEnter: (world: WorldSummary) => void;
  /** 删除世界（含存档数据）；调用方负责真的删库 */
  onDelete: (world: WorldSummary) => void;
}

export class WorldScreen {
  readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private readonly typeSelect: HTMLSelectElement;
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

    const title = document.createElement('b');
    title.textContent = 'Bedrock 1.18 Web';

    const subtitle = document.createElement('div');
    subtitle.className = 'world-hint';
    subtitle.textContent = '选择世界继续游玩，或者新建一个';

    // ---- 世界列表
    this.listEl = document.createElement('div');
    this.listEl.className = 'world-list';

    // ---- 新建世界
    const form = document.createElement('div');
    form.className = 'world-new';

    const formTitle = document.createElement('div');
    formTitle.className = 'settings-group';
    formTitle.textContent = '新建世界';

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = '留空则自动命名';
    this.nameInput.maxLength = 24;
    this.nameInput.className = 'world-input';

    this.seedInput = document.createElement('input');
    this.seedInput.type = 'text';
    this.seedInput.inputMode = 'numeric';
    this.seedInput.placeholder = '留空 = 随机';
    this.seedInput.className = 'world-input';

    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'world-mini';
    reroll.textContent = '随机';
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

    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'world-primary';
    create.textContent = '创建并进入';
    create.addEventListener('click', () => this.createAndEnter());

    // 种子框里回车也直接创建（手输种子是最常见的动作）
    this.seedInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createAndEnter();
    });
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createAndEnter();
    });

    form.append(
      formTitle,
      this.makeRow('世界名称', this.nameInput, null),
      this.makeRow('世界种子', this.seedInput, reroll),
      this.makeRow('世界类型', this.typeSelect, null),
      create,
    );

    const hint = document.createElement('div');
    hint.className = 'world-hint';
    hint.textContent = '相同的种子会生成相同的地形；超平坦世界只有一层草地。';

    panel.append(title, subtitle, this.listEl, form, hint);
    this.root.append(panel);
    host.appendChild(this.root);
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

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  /** 重画世界列表（列表变化、打开、删除后都要调） */
  render(): void {
    this.listEl.textContent = '';
    const worlds = this.registry.list();

    if (worlds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'world-empty';
      empty.textContent = '还没有世界——在下面新建一个就能开始。';
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

    const name = document.createElement('div');
    name.className = 'world-card-name';
    name.textContent = world.name;

    const meta = document.createElement('div');
    meta.className = 'world-card-meta';
    meta.textContent = `${WORLD_TYPE_LABELS[world.worldType]} · 种子 ${world.seed}`;

    const stats = document.createElement('div');
    stats.className = 'world-card-meta';
    const played = world.playTime >= 60 ? `${Math.round(world.playTime / 60)} 分钟` : `${Math.round(world.playTime)} 秒`;
    stats.textContent = `上次游玩 ${relativeTime(world.lastPlayed)} · 已游玩 ${played} · 改动 ${world.edits} 格`;

    info.append(name, meta, stats);

    const buttons = document.createElement('div');
    buttons.className = 'world-card-actions';

    const enter = document.createElement('button');
    enter.type = 'button';
    enter.textContent = '进入';
    enter.addEventListener('click', () => this.actions.onEnter(world));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      if (confirm(`删除「${world.name}」？该世界的存档会一起删掉，无法恢复。`)) {
        this.actions.onDelete(world);
        this.render();
      }
    });

    buttons.append(enter, remove);
    card.append(info, buttons);
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

  /** 验收脚本用：填表但不提交 */
  fillNewWorldForm(name: string, seed: string, worldType: WorldType): void {
    this.nameInput.value = name;
    this.seedInput.value = seed;
    this.typeSelect.value = worldType;
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
