/**
 * 19 种工作站的**槽位预设**（纯数据）
 *
 * 为什么集中成一张表：自绘面板的排版只需要知道"上方那组格子是几行几列、有没有结果格"，
 * 而这正好是每个工作站的差别所在。散在宿主里写 `if (kind === 'furnace') …` 的话，
 * 每加一个工作站都要动宿主，也永远没办法一次性看完"到底支持了哪些"。
 *
 * 数值来源是 DOM 版的构造（`InventoryScreen` 里每种模式的右栏），逐条对着抄：
 *  - 工作台 3×3 有结果格；熔炉 1×2（原料 + 燃料）有结果格；
 *  - 铁砧 / 磨石 / 织布机 / 制图台 都是 2 格 + 结果格；
 *  - 锻造台 3 格（模板 + 两件材料）+ 结果格；
 *  - 切石机 1 格 + 结果格；酿造台竖排 4 格（3 瓶 + 1 材料）+ 结果格；
 *  - 附魔台 2 格、营火 4 格，都没有结果格；
 *  - 纯存储（箱子 27 / 木桶 27 / 潜影盒 27 / 漏斗 5 / 投掷器与发射器 9）没有结果格。
 *
 * ⚠️ 这里只管**排版**（几行几列、有没有结果格、要不要进度箭头），不管配方匹配与槽位来源 ——
 * 后者是游戏逻辑，由调用方按 `SlotAccess` 下标接。
 */

/**
 * 支持的容器/工作站种类。
 *
 * ⚠️ 名字**必须与 `InventoryPanelMode` 逐字一致**（`shulker_box` 不是 `shulker`）：
 * 游戏侧直接用 `currentMode` 查表，差一个字母就是"打开潜影盒时版面还是纯背包"，
 * 而且不报错。
 */
export type StationKind =
  | 'crafting'
  | 'furnace'
  | 'smoker'
  | 'blast_furnace'
  | 'smithing'
  | 'anvil'
  | 'grindstone'
  | 'stonecutter'
  | 'loom'
  | 'cartography'
  | 'brewing'
  | 'enchanting'
  | 'campfire'
  | 'chest'
  | 'barrel'
  | 'shulker_box'
  | 'ender_chest'
  | 'hopper'
  | 'dispenser'
  | 'dropper';

export interface StationSpec {
  /** 上方那组格子的列数 */
  readonly cols: number;
  /** 上方那组格子的行数 */
  readonly rows: number;
  /** 有没有结果格（右侧单独一格） */
  readonly result: boolean;
  /** 结果格左边要不要"进度箭头"（熔炉/烟熏炉/高炉/酿造台有） */
  readonly progress?: boolean;
  /** 箭头下方要不要"火焰"（只有烧燃料的那三种） */
  readonly flame?: boolean;
  /** 人类可读的名字（日志/调试用，不进 UI —— UI 名字走 i18n） */
  readonly label: string;
}

export const STATION_SPECS: Readonly<Record<StationKind, StationSpec>> = {
  crafting: { cols: 3, rows: 3, result: true, label: '工作台' },
  furnace: { cols: 1, rows: 2, result: true, progress: true, flame: true, label: '熔炉' },
  smoker: { cols: 1, rows: 2, result: true, progress: true, flame: true, label: '烟熏炉' },
  blast_furnace: { cols: 1, rows: 2, result: true, progress: true, flame: true, label: '高炉' },
  smithing: { cols: 3, rows: 1, result: true, label: '锻造台' },
  anvil: { cols: 2, rows: 1, result: true, label: '铁砧' },
  grindstone: { cols: 2, rows: 1, result: true, label: '磨石' },
  stonecutter: { cols: 1, rows: 1, result: true, label: '切石机' },
  loom: { cols: 2, rows: 1, result: true, label: '织布机' },
  cartography: { cols: 2, rows: 1, result: true, label: '制图台' },
  brewing: { cols: 1, rows: 4, result: true, progress: true, label: '酿造台' },
  enchanting: { cols: 2, rows: 1, result: false, label: '附魔台' },
  campfire: { cols: 4, rows: 1, result: false, label: '营火' },
  chest: { cols: 9, rows: 3, result: false, label: '箱子' },
  barrel: { cols: 9, rows: 3, result: false, label: '木桶' },
  shulker_box: { cols: 9, rows: 3, result: false, label: '潜影盒' },
  ender_chest: { cols: 9, rows: 3, result: false, label: '末影箱' },
  hopper: { cols: 5, rows: 1, result: false, label: '漏斗' },
  dispenser: { cols: 3, rows: 3, result: false, label: '发射器' },
  dropper: { cols: 3, rows: 3, result: false, label: '投掷器' },
};

/** 全部支持的种类（顺序即 `STATION_SPECS` 的书写顺序，便于测试与文档对齐） */
export const STATION_KINDS = Object.keys(STATION_SPECS) as StationKind[];

/** 取某个工作站的槽位预设（未知种类返回 `null` —— 调用方据此退回"纯背包"） */
export function stationSpec(kind: string): StationSpec | null {
  return (STATION_SPECS as Record<string, StationSpec | undefined>)[kind] ?? null;
}

/** 这个工作站上方那组格子有多少格（不含结果格） */
export function stationSlotCount(kind: string): number {
  const spec = stationSpec(kind);
  return spec ? spec.cols * spec.rows : 0;
}

/**
 * 转成 `layoutInventoryPanel` 需要的 `extra`。
 *
 * 未知种类返回 `undefined`（而不是"0 行 0 列"）：后者会让布局凭空多算一块 0 宽的区域，
 * 在居中对齐里留下 0.5px 的偏移，排查起来很费劲。
 */
export function stationExtra(
  kind: string,
): { cols: number; rows: number; result?: boolean; flame?: boolean } | undefined {
  const spec = stationSpec(kind);
  if (!spec) return undefined;
  return {
    cols: spec.cols,
    rows: spec.rows,
    ...(spec.result ? { result: true } : {}),
    // 火焰是**版面块**（`groups.flame` 只在 `extra.flame` 时才排出来），所以这一层也要带上；
    // 早期版本只传了行列，结果预览里"火焰"永远不出现 —— 表里写着 flame: true 却没人用。
    ...(spec.flame ? { flame: true } : {}),
  };
}

/**
 * 工作站那几格里，第 `offset` 格（0 起）能不能放东西。
 *
 * 规则：**结果格只出不进**（原版里合成台/熔炉的产物格塞不进任何东西）。
 * 结果格排在额外槽位的**最后一格** —— 这是布局的约定（`extra` 之后紧跟 `result`），
 * 也是容器的下标约定（熔炉 0=原料 1=燃料 2=产物）。
 *
 * ⚠️ 这条约定对"产物不在最后"的容器要单独处理；目前 19 种里没有反例，
 * 但接新容器时值得先看一眼它的下标表。
 */
export function extraSlotWritable(spec: StationSpec | null, offset: number): boolean {
  if (!spec) return false;
  const slots = spec.cols * spec.rows;
  if (offset < 0) return false;
  if (!spec.result) return offset < slots;
  return offset < slots; // 第 `slots` 格（结果格）不可写
}
