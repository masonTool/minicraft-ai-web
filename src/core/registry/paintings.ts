/**
 * 画（B14，批次 86）
 *
 * 原版 1.18 一共 **26 幅**画，按尺寸分七档（1×1 / 2×1 / 1×2 / 2×2 / 4×2 / 4×3 / 4×4）。
 * 放置时游戏会从**放得下**的那些里随机挑一幅——"墙上挂一幅大画"这件事的乐趣
 * 一半来自这个"随尺寸自适应"。
 *
 * ⚠️ 本项目这一批**只做 1×1 的那 7 幅**（Kebab / Aztec / Alban / Aztec2 / Bomb /
 * Plant / Wasteland）。理由写在下面这条：
 * **多格拼贴要跨格占用**（一幅 4×4 的画占 16 个方块，拆任意一格要带走整幅），
 * 而本项目的方块状态只有一个字节——"哪一幅 + 占在第几格"塞不进一格状态，
 * 得再开一条"按坐标存画"的通道（像告示牌文字那样），并把贴图拆成每格的子图。
 * 那是下一批的量级，所以这一批先落"单格画"，把**表结构**（名字 / 尺寸 / 贴图）
 * 按原版摆好：以后加多格画时，只要给这张表补 `width/height > 1` 的行、
 * 再把放置逻辑从"单格"扩成"按尺寸找空地"即可。
 *
 * 名字与尺寸都是**原版事实**（不是自创），所以尺寸声明在这里、并由测试钉住
 * "表里每一幅的 size 与本文件声明的原版尺寸一致"——以后误改一行不会静默生效。
 */

/** 一幅画（本项目里"一幅"= 一个方块 + 一个状态位变体） */
export interface PaintingVariant {
  /** 原版命名（`minecraft:painting` 的变体名，用来对照 wiki） */
  readonly name: string;
  /** 原版中文名（基岩版） */
  readonly cn: string;
  /** 图集里的贴图名（16×16，整幅画就是这一张） */
  readonly tile: string;
  /** 原版尺寸：宽 × 高（单位是**方块格**） */
  readonly width: number;
  readonly height: number;
}

/**
 * 原版 1.18 的 26 幅画里 **1×1** 的那 7 幅（顺序照原版注册顺序）。
 *
 * 贴图名一律 `painting_<name>`：与图集名单（`atlasLayout.ts`）里的写法对应，
 * 名字写错的表现是整幅画回退成 tile 0（一张石头），非常难查——
 * 所以测试里逐条反查 `TILE_ORDER`。
 */
export const PAINTING_VARIANTS: readonly PaintingVariant[] = [
  { name: 'kebab', cn: '烤肉串', tile: 'painting_kebab', width: 1, height: 1 },
  { name: 'aztec', cn: '阿兹特克', tile: 'painting_aztec', width: 1, height: 1 },
  { name: 'alban', cn: '阿尔班', tile: 'painting_alban', width: 1, height: 1 },
  { name: 'aztec2', cn: '阿兹特克II', tile: 'painting_aztec2', width: 1, height: 1 },
  { name: 'bomb', cn: '炸弹', tile: 'painting_bomb', width: 1, height: 1 },
  { name: 'plant', cn: '植物', tile: 'painting_plant', width: 1, height: 1 },
  { name: 'wasteland', cn: '荒地', tile: 'painting_wasteland', width: 1, height: 1 },
];

/**
 * 多格画（批次 494，B51 的 ②）：**占多格**，一幅画跨 w×h 个方块。
 *
 * 与上面那 7 幅 1×1 的画是两条路：
 *  - 1×1 的变体号存在**方块状态**里（bit3-5，7 档够用）；
 *  - 多格的塞不进状态位（"哪一幅 + 占在第几格"要两个数），所以**存在按坐标的表**里
 *    （`world/Paintings.ts`），方块状态一律 0。
 *
 * 贴图按格切成 `w×h` 张子图（`paintingSubTile`）：图集里每格仍是 16×16，
 * 拼起来才是整幅画——这样不需要"跨瓦片大图"那套基础设施。
 * 尺寸与名字都是**原版事实**（donkey_kong 4×4、skeleton 4×3、match 2×2）。
 */
export interface MultiPainting {
  readonly name: string;
  readonly cn: string;
  readonly width: number;
  readonly height: number;
}

export const MULTI_PAINTINGS: readonly MultiPainting[] = [
  { name: 'donkey_kong', cn: '大金刚', width: 4, height: 4 },
  { name: 'skeleton', cn: '骷髅', width: 4, height: 3 },
  { name: 'match', cn: '火柴', width: 2, height: 2 },
];

/** 多格画的子图贴图名：`painting_<name>_<col>_<row>`（col 从左、row 从上） */
export function paintingSubTile(painting: MultiPainting, col: number, row: number): string {
  return `painting_${painting.name}_${col}_${row}`;
}

/** 这幅画一共几张子图 */
export function paintingSubTileCount(painting: MultiPainting): number {
  return painting.width * painting.height;
}

/** 按面积从大到小排好的多格画（放置时"能放多大的就先放多大的"） */
export const MULTI_PAINTINGS_LARGE_FIRST: readonly MultiPainting[] = [...MULTI_PAINTINGS].sort(
  (a, b) => b.width * b.height - a.width * a.height,
);

/** 按名字找一幅多格画（存档里存的是名字，改名会让它读不回来——所以名字要稳定） */
export function multiPaintingByName(name: string): MultiPainting | undefined {
  return MULTI_PAINTINGS.find((painting) => painting.name === name);
}

/** 原版 1.18 的画作总幅数（本项目只做其中 1×1 的 7 幅，差异记在 TASKS B14） */
export const VANILLA_PAINTING_COUNT = 26;

/**
 * 状态里能给画作留几档（bit3-5 共 3 位）。
 *
 * 7 幅用不满 8 档，但不能省这位数：状态位是**按形状族复用**的，
 * 表长到 8 以上时改写函数会自动夹住（见 `withPaintingVariant`），
 * 而不是溢出到别的字段上。
 */
export const PAINTING_VARIANT_LIMIT = 8;

/** 第 index 幅画；越界（脏存档/脏状态）返回 undefined */
export function paintingVariant(index: number): PaintingVariant | undefined {
  return Number.isInteger(index) ? PAINTING_VARIANTS[index] : undefined;
}

/** 第 index 幅画的贴图名；越界时回退到第 0 幅（渲染路径不该因为脏数据整块消失） */
export function paintingTile(index: number): string {
  return (PAINTING_VARIANTS[index] ?? PAINTING_VARIANTS[0]!).tile;
}

/** 这幅画的中文名（提示框/调试用）；越界时给一个明确的"未知" */
export function paintingName(index: number): string {
  return PAINTING_VARIANTS[index]?.cn ?? '未知的画';
}

/**
 * 放置时选哪一幅：单格画只有"在放得下的 7 幅里随机挑一幅"这一条规则。
 *
 * 随机源**注入**（本项目的既有做法，见钓鱼那批的经验）：这样"挑出来的编号一定在
 * 合法范围内""同一个 random 序列给出确定结果"都能离线断言。
 * 返回**状态里要写的变体编号**。
 */
export function pickPaintingVariant(random: () => number): number {
  const roll = random();
  const clamped = Number.isFinite(roll) ? Math.min(0.999999, Math.max(0, roll)) : 0;
  return Math.floor(clamped * PAINTING_VARIANTS.length);
}
