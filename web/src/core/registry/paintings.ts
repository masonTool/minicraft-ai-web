/**
 * 画（B14，批次 86；素材在批次 20261025-0117 整体换成自创）
 *
 * **画名与画面全部自创**。上一版这 10 幅一一对应 Zetterstrand 为原版画的署名作品
 * （Kebab / Aztec / Alban / Aztec2 / Bomb / Plant / Wasteland / Donkey Kong /
 * Skeleton / Match，名字也照抄），虽然贴图是代码画的、没有打包任何素材，但"构图能认出
 * 是哪一幅"属于改编；`大金刚` 还叠了一层任天堂的形象。上架商店前整体换掉。
 *
 * 保留的是**机制**，不是内容：
 *  - 尺寸档位照旧（1×1 七幅 + 4×4 / 4×3 / 2×2 各一幅）——尺寸决定"放得下才挂得上"，
 *    是玩法，不属于任何人的表达；
 *  - 1×1 的七幅**顺序也不动**：变体号存在方块状态 bit3-5 里，换顺序会让老存档里
 *    已经挂好的画集体变成另一幅（不崩，但玩家会以为自己的画被换了）；
 *  - 多格画的**名字**会进存档（`world/Paintings.ts` 按名字存），所以旧名字保留成
 *    `LEGACY_MULTI_NAMES` 别名，读档时仍能找回对应的那一幅。
 *
 * 其余说明见 `render/TextureAtlas.ts` 里每幅的构图注释。
 */

/** 一幅画（本项目里"一幅"= 一个方块 + 一个状态位变体） */
export interface PaintingVariant {
  /** 自创的英文名（只用于贴图命名与调试，不对外展示） */
  readonly name: string;
  /** 中文名（提示框 / 调试用） */
  readonly cn: string;
  /** 图集里的贴图名（16×16，整幅画就是这一张） */
  readonly tile: string;
  /** 尺寸：宽 × 高（单位是**方块格**）—— 本项目里 1×1 这一档共 7 幅 */
  readonly width: number;
  readonly height: number;
}

/**
 * 1×1 的七幅（自创画面：日出 / 河谷 / 远山 / 夜空 / 篝火 / 孤树 / 沙丘）。
 *
 * **顺序不能改**：变体号存在方块状态 bit3-5 里，调序会让老存档里挂好的画换脸。
 *
 * 贴图名一律 `painting_<name>`：与图集名单（`atlasLayout.ts`）里的写法对应，
 * 名字写错的表现是整幅画回退成 tile 0（一张石头），非常难查——
 * 所以测试里逐条反查 `TILE_ORDER`。
 */
export const PAINTING_VARIANTS: readonly PaintingVariant[] = [
  { name: 'dawn', cn: '日出', tile: 'painting_dawn', width: 1, height: 1 },
  { name: 'river', cn: '河谷', tile: 'painting_river', width: 1, height: 1 },
  { name: 'hill', cn: '远山', tile: 'painting_hill', width: 1, height: 1 },
  { name: 'night', cn: '夜空', tile: 'painting_night', width: 1, height: 1 },
  { name: 'campfire', cn: '篝火', tile: 'painting_campfire', width: 1, height: 1 },
  { name: 'tree', cn: '孤树', tile: 'painting_tree', width: 1, height: 1 },
  { name: 'desert', cn: '沙丘', tile: 'painting_desert', width: 1, height: 1 },
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
 *
 * 画面全部自创（壁画 / 挂毯 / 旧海图），尺寸档位保持不变（4×4 / 4×3 / 2×2）：
 * 尺寸决定"能挂在多大的墙上"，是玩法，不是素材。
 */
export interface MultiPainting {
  readonly name: string;
  readonly cn: string;
  readonly width: number;
  readonly height: number;
}

export const MULTI_PAINTINGS: readonly MultiPainting[] = [
  { name: 'mural', cn: '壁画', width: 4, height: 4 },
  { name: 'banner', cn: '挂毯', width: 4, height: 3 },
  { name: 'chart', cn: '旧海图', width: 2, height: 2 },
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

/**
 * 旧画名 → 现画名（批次 20261025-0117 整体换素材时留下）。
 *
 * 多格画的**名字会进存档**（`world/Paintings.ts` 按名字存"墙上这一片是哪一幅"），
 * 所以改名等于让老存档里的大画读不回来——不崩，但那面墙会空掉。
 * 尺寸档位没变（4×4 / 4×3 / 2×2），旧名字按尺寸一一对上即可。
 *
 * ⚠️ 只用于**读**：写存档一律写 `MULTI_PAINTINGS` 里的新名字。
 */
export const LEGACY_MULTI_NAMES: Readonly<Record<string, string>> = {
  donkey_kong: 'mural',
  skeleton: 'banner',
  match: 'chart',
};

/** 按名字找一幅多格画；认旧名字（见 `LEGACY_MULTI_NAMES`），认不出返回 undefined */
export function multiPaintingByName(name: string): MultiPainting | undefined {
  const resolved = LEGACY_MULTI_NAMES[name] ?? name;
  return MULTI_PAINTINGS.find((painting) => painting.name === resolved);
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

/**
 * **多格画的哨兵档位**（批次 495）。
 *
 * 1×1 的 7 幅占 0~6，7 是这一族里唯一的空档——于是"这一格属于一幅多格画"
 * 用它表示，具体是哪一幅、占在第几格去 `world/Paintings.ts` 的表里查。
 *
 * 哨兵格的方块贴图是**全透明**（`painting_multi`）：画面由 `ArmorStandRenderer`
 * 那条路单独画，方块自己不该再画一遍（否则会盖住或与它 z-fighting）。
 */
export const MULTI_PAINTING_VARIANT = 7;

/** 第 index 幅画；越界（脏存档/脏状态）返回 undefined */
export function paintingVariant(index: number): PaintingVariant | undefined {
  return Number.isInteger(index) ? PAINTING_VARIANTS[index] : undefined;
}

/** 第 index 幅画的贴图名；越界时回退到第 0 幅（渲染路径不该因为脏数据整块消失） */
export function paintingTile(index: number): string {
  // 哨兵档位（多格画）：方块本身透明，画面由渲染器画（批次 495）
  if (index === MULTI_PAINTING_VARIANT) return 'painting_multi';
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
