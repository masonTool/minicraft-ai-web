/**
 * 设置与暂停菜单（K3）
 *
 * 一个面板承担两件事：**暂停菜单**（继续 / 设置 / 存档信息 / 新世界）
 * 与**设置项**（视距 / 视野 / 音量 / 灵敏度 / 调试信息）。
 * 合成一个面板而不是两个：手机屏幕小，弹出两层界面既挡视野又难返回。
 *
 * 设置存在 localStorage 里（与 K1 的世界存档分开）：
 * 设置是"这台设备的偏好"，换世界也不该丢；而世界存档属于某个种子。
 */

import { CAMERA_MODES, CAMERA_MODE_LABELS, type CameraMode } from '../core/viewMode.ts';

export interface GameSettings {
  /** 视距（区块）：4~16。影响流式加载范围与雾的远近 */
  viewDistance: number;
  /** 视野角度（度）：60~110 */
  fov: number;
  /** 音量 0~1（K5 的音效会用） */
  volume: number;
  /** 鼠标/触摸灵敏度倍率：0.5~2 */
  sensitivity: number;
  /** 视角模式：第一人称 / 第三人称背后 / 第三人称正面（`V` 键循环切换） */
  cameraMode: CameraMode;
  /** 是否显示左上角调试信息（HUD） */
  showDebug: boolean;
  /**
   * 自适应视距：帧率掉下去时自动缩小视距（玩家设定的视距是**上限**，只会往下调）。
   * 移动端长时间游玩容易发热降频，这个开关能避免越玩越卡。
   */
  adaptiveViewDistance: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  viewDistance: 12,
  fov: 72,
  volume: 0.7,
  sensitivity: 1,
  cameraMode: 'first',
  showDebug: true,
  adaptiveViewDistance: true,
};

const STORAGE_KEY = 'bedrock-settings';

/** 从 localStorage 读取设置（缺字段或损坏时回退默认值） */
export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      viewDistance: clampNumber(parsed.viewDistance, 4, 16, DEFAULT_SETTINGS.viewDistance),
      fov: clampNumber(parsed.fov, 60, 110, DEFAULT_SETTINGS.fov),
      volume: clampNumber(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume),
      sensitivity: clampNumber(parsed.sensitivity, 0.5, 2, DEFAULT_SETTINGS.sensitivity),
      cameraMode: CAMERA_MODES.includes(parsed.cameraMode as CameraMode)
        ? (parsed.cameraMode as CameraMode)
        : DEFAULT_SETTINGS.cameraMode,
      showDebug: parsed.showDebug !== false,
      adaptiveViewDistance: parsed.adaptiveViewDistance !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 无痕模式下写不进去，忽略：设置只在本次会话生效
  }
}

export interface SettingsActions {
  /** 继续游戏（关闭面板） */
  onResume: () => void;
  /** 删除存档并重载（新世界） */
  onNewWorld: () => void;
  /** 设置变化：立即生效（视距/视野/调试信息都要马上看到效果） */
  onChange: (settings: GameSettings) => void;
  /** 导入资源包（.mcpack / .zip） */
  onResourcePack?: (file: File) => void;
}

export class SettingsScreen {
  readonly root: HTMLDivElement;
  private open = false;
  private readonly sliders = new Map<keyof GameSettings, HTMLInputElement>();
  private readonly metaEl: HTMLDivElement;

  constructor(
    host: HTMLElement,
    private readonly settings: GameSettings,
    private readonly actions: SettingsActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'settings-screen';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const title = document.createElement('b');
    title.textContent = '游戏暂停';

    const subtitle = document.createElement('div');
    subtitle.className = 'settings-hint';
    subtitle.textContent = '按 Esc 继续游戏';

    // ---- 操作按钮
    const buttons = document.createElement('div');
    buttons.className = 'settings-buttons';

    const resume = document.createElement('button');
    resume.type = 'button';
    resume.textContent = '继续游戏';
    resume.addEventListener('click', () => this.actions.onResume());

    const newWorld = document.createElement('button');
    newWorld.type = 'button';
    newWorld.className = 'danger';
    newWorld.textContent = '新世界（删除存档）';
    newWorld.addEventListener('click', () => {
      if (confirm('确定要删除存档并重新开始吗？此操作不可撤销。')) this.actions.onNewWorld();
    });

    buttons.append(resume, newWorld);

    // ---- 设置项
    const options = document.createElement('div');
    options.className = 'settings-options';
    options.append(
      this.makeSlider('viewDistance', '视距', ' 区块', 4, 16, 1),
      this.makeSlider('fov', '视野', '°', 60, 110, 1),
      this.makeSlider('volume', '音量', '%', 0, 100, 1, 100),
      this.makeSlider('sensitivity', '灵敏度', '×', 0.5, 2, 0.05),
    );

    this.makeToggle(options, 'showDebug', '调试信息');
    this.makeToggle(options, 'adaptiveViewDistance', '自适应视距');

    // 操作分类：视角模式（也可以随时按 V 键循环切换，两处状态同步）
    const viewLabel = document.createElement('div');
    viewLabel.className = 'settings-group';
    viewLabel.textContent = '操作';
    options.appendChild(viewLabel);
    this.makeSelect(options, 'cameraMode', '视角', CAMERA_MODES, CAMERA_MODE_LABELS);
    options.appendChild(this.makeResourcePackRow());

    this.metaEl = document.createElement('div');
    this.metaEl.className = 'settings-hint';

    this.root.append(panel);
    panel.append(title, subtitle, buttons, options, this.metaEl);
    host.appendChild(this.root);

    // 点面板外的区域 = 继续游戏（与原版"点空白关闭"一致）
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.actions.onResume();
    });
  }

  /** 造一个滑块设置项 */
  private makeSlider(
    key: keyof GameSettings,
    label: string,
    unit: string,
    min: number,
    max: number,
    step: number,
    scale = 1,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String((this.settings[key] as number) * scale);

    const value = document.createElement('i');
    value.textContent = `${input.value}${unit}`;

    input.addEventListener('input', () => {
      const raw = Number(input.value) / scale;
      (this.settings[key] as number) = raw;
      value.textContent = `${input.value}${unit}`;
      this.commit();
    });

    row.append(name, input, value);
    this.sliders.set(key, input);
    return row;
  }

  /**
   * 造一个下拉选择设置项。
   * 视角模式这种"就那么几个选项"的设置用下拉最省地方，也比滑块直观。
   */
  private makeSelect<T extends string>(
    options: HTMLElement,
    key: 'cameraMode',
    label: string,
    values: readonly T[],
    labels: Record<T, string>,
  ): HTMLSelectElement {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = label;

    const select = document.createElement('select');
    select.className = 'settings-select';
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labels[value];
      select.appendChild(option);
    }
    select.value = this.settings[key];

    select.addEventListener('change', () => {
      this.settings[key] = select.value as GameSettings[typeof key];
      this.commit();
    });

    row.append(name, select);
    options.appendChild(row);
    return select;
  }

  /** 资源包导入行（.mcpack / .zip） */
  private makeResourcePackRow(): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = '资源包';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mcpack,.zip,application/zip';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.actions.onResourcePack?.(file);
      // 清空 value：同一个文件再选一次也要能触发 change
      input.value = '';
    });

    const hint = document.createElement('i');
    hint.textContent = 'mcpack';
    row.append(name, input, hint);
    return row;
  }

  /** 造一个开关设置项 */
  private makeToggle(options: HTMLElement, key: 'showDebug' | 'adaptiveViewDistance', label: string): HTMLInputElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.settings[key];
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.commit();
    });
    row.append(name, input);
    options.appendChild(row);
    return input;
  }

  private commit(): void {
    saveSettings(this.settings);
    this.actions.onChange(this.settings);
  }

  /** 存档信息（打开时刷新） */
  setMeta(text: string): void {
    this.metaEl.textContent = text;
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** 当前设置（只读快照，调试接口用） */
  snapshot(): GameSettings {
    return { ...this.settings };
  }
}
