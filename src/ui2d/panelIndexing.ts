/**
 * 版面下标 → 玩家库存下标（**纯映射**）
 *
 * 自绘面板的槽位顺序是定死的：
 *
 *     extra（工作站那几格 + 结果格） → side（盔甲 + 副手） → main（27 主背包） → hotbar（9 快捷栏）
 *
 * 而 `Inventory` 的下标是另一套：`0..8` 是快捷栏、`9..35` 是主背包（原版就这么存的）。
 * 两者之间必须有一层显式映射 —— 之前它是 `main.ts` 里的一行三元表达式：
 *
 * ```ts
 * const toInvIndex = (display) => (display < 27 ? 9 + display : display - 27);
 * ```
 *
 * 那一行**只在"纯背包"前提下成立**：一旦打开熔炉（多 3 格）或装备列（多 5 格），
 * `display < 27` 这个判据就把工作站格子当成主背包了 —— 表现是"把煤放进背包第 9 格"，
 * 而且不会报错。所以抽成函数 + 按区域判断。
 *
 * ⚠️ 这里只回答"这个显示下标对应玩家库存的哪一格"；工作站与装备列的槽位**不在**
 * `Inventory` 里，返回 `null`（由调用方去查对应的容器/装备表）。
 */

/**
 * 版面规格（**可变**：换容器时游戏侧直接改这几个字段）。
 *
 * 为什么不做成 readonly：`SlotAccess` 的闭包捕获的是这个对象本身，改字段下一帧就生效；
 * 若每次换容器都新建对象，闭包还指着旧的 —— 那样"打开熔炉后玩家背包错位"会变成
 * 一个非常难查的问题（看起来像映射函数算错了）。
 */
export interface PanelIndexSpec {
  /** 工作站那几格 + 结果格的总数（0 = 纯背包） */
  extraCount?: number;
  /** 装备列格数（4 盔甲 + 1 副手 = 5；0 = 没有这一列） */
  sideCount?: number;
  /** 主背包行数（默认 3 行 = 27 格） */
  mainRows?: number;
  /** 快捷栏行数（默认 1 行 = 9 格） */
  hotbarRows?: number;
}

export interface PanelRegion {
  /** 这一区域的起始显示下标 */
  readonly start: number;
  /** 这一区域的格数 */
  readonly count: number;
}

export interface PanelRegions {
  readonly extra: PanelRegion;
  readonly side: PanelRegion;
  readonly main: PanelRegion;
  readonly hotbar: PanelRegion;
  /** 总格数 */
  readonly total: number;
}

/** 各区在显示下标上的范围（顺序就是槽位顺序） */
export function panelRegions(spec: PanelIndexSpec = {}): PanelRegions {
  const extraCount = Math.max(0, spec.extraCount ?? 0);
  const sideCount = Math.max(0, spec.sideCount ?? 0);
  const mainCount = Math.max(0, spec.mainRows ?? 3) * 9;
  const hotbarCount = Math.max(0, spec.hotbarRows ?? 1) * 9;
  const extra = { start: 0, count: extraCount };
  const side = { start: extra.start + extra.count, count: sideCount };
  const main = { start: side.start + side.count, count: mainCount };
  const hotbar = { start: main.start + main.count, count: hotbarCount };
  return { extra, side, main, hotbar, total: hotbar.start + hotbar.count };
}

export type PanelRegionName = 'extra' | 'side' | 'main' | 'hotbar';

/** 这个显示下标落在哪个区（越界返回 `null`） */
export function regionOfDisplayIndex(spec: PanelIndexSpec, display: number): PanelRegionName | null {
  const regions = panelRegions(spec);
  if (!Number.isInteger(display) || display < 0 || display >= regions.total) return null;
  for (const name of ['extra', 'side', 'main', 'hotbar'] as const) {
    const region = regions[name];
    if (display >= region.start && display < region.start + region.count) return name;
  }
  return null;
}

/**
 * 显示下标 → 玩家库存下标（不是玩家库存的格子返回 `null`）。
 *
 * 映射规则来自 `Inventory` 自己的布局：**快捷栏在前（0..8）、主背包在后（9..35）**，
 * 而面板把主背包排在上面、快捷栏排在下面 —— 所以这里是两段"反向"换算。
 */
export function inventoryIndexAt(spec: PanelIndexSpec, display: number): number | null {
  const regions = panelRegions(spec);
  const region = regionOfDisplayIndex(spec, display);
  if (region === 'main') return 9 + (display - regions.main.start);
  if (region === 'hotbar') return display - regions.hotbar.start;
  return null;
}

/**
 * 反过来：玩家库存下标 → 显示下标（找不到返回 `null`）。
 *
 * 用于"玩家按数字键选了第 N 格快捷栏，要高亮版面上的哪一格"这类反查。
 */
export function displayIndexForInventory(spec: PanelIndexSpec, invIndex: number): number | null {
  const regions = panelRegions(spec);
  if (!Number.isInteger(invIndex) || invIndex < 0) return null;
  if (invIndex < 9) {
    const offset = invIndex;
    return offset < regions.hotbar.count ? regions.hotbar.start + offset : null;
  }
  const offset = invIndex - 9;
  return offset < regions.main.count ? regions.main.start + offset : null;
}
