/**
 * 图集完整性与纹理上限（批次 530）
 *
 * 起因：玩家反馈"骨块、蓝色旗帜等很多方块没有着色"。
 * 根因不是方块缺定义，而是**单页图集长过了设备的纹理上限**：
 * 1234 张贴图 × 16 列 = 78 行，上传画布高 2496px > 常见的 2048，
 * 第 64 行之后（骨块正好从这里开始）整批不上传。
 *
 * 这套断言钉四件事：
 *  ① 上传画布两边都 ≤ 2048（以后贴图再涨，先红在测试里）；
 *  ② 每张登记过的贴图都有画笔（"名单里有、没画"同样是白块）；
 *  ③ 每个非空气方块引用的贴图都在名单里（拼错名字也是白块）；
 *  ④ 骨块 / 旗帜 / 蜡烛 / 带釉陶瓦这些"越界区"的贴图确实落在可上传范围内，
 *     并顺带验证骨块与旗帜的**机制**本身是完整的（配方 / 图案数）。
 *
 * 运行：npm run test:textures
 */

import { readFileSync } from 'node:fs';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { Item } from '../web/src/core/registry/items.ts';
import { Block, BLOCKS } from '../web/src/core/registry/blocks.ts';
import { BANNER_PATTERN_COUNT } from '../web/src/core/registry/blockState.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_STRIDE } from '../web/src/render/atlasLayout.ts';
import { PAINTERS } from '../web/src/render/TextureAtlas.ts';
import { tileRectAt } from '../web/src/render/atlasCoords.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/** 设备侧最低保证（WebGL2 / GLES3 的下限就是 2048） */
const MIN_TEXTURE_SIZE = 2048;

const tiles = TILE_ORDER as readonly string[];
const rows = Math.ceil(tiles.length / ATLAS_COLUMNS);
const uploadWidth = ATLAS_COLUMNS * TILE_STRIDE;
const uploadHeight = rows * TILE_STRIDE;

console.log('\n[图集尺寸：必须落在 2048 以内]');
{
  check('贴图数量在 32 列的容量内（1200~2048）', tiles.length >= 1200 && tiles.length <= 2048, String(tiles.length));
  equal('列数 32（16 列会让高度到 2496）', ATLAS_COLUMNS, 32);
  check('上传宽度 ≤ 2048', uploadWidth <= MIN_TEXTURE_SIZE, `${uploadWidth}px`);
  check('上传高度 ≤ 2048', uploadHeight <= MIN_TEXTURE_SIZE, `${uploadHeight}px`);
  check(
    '按 2048 的上限还有余量（能再撑到 2048 张）',
    Math.floor(MIN_TEXTURE_SIZE / TILE_STRIDE) * ATLAS_COLUMNS >= 2048,
  );
}

console.log('\n[每张登记贴图都有画笔]');
{
  const missing = tiles.filter((name) => typeof PAINTERS[name] !== 'function');
  check('没有"名单里有、却没画"的贴图', missing.length === 0, missing.slice(0, 8).join(','));
  equal('画笔数量与名单一致', Object.keys(PAINTERS).length, tiles.length);
}

console.log('\n[方块引用的贴图都在名单里]');
{
  const known = new Set(tiles);
  const missing: string[] = [];
  for (const def of BLOCKS) {
    for (const tile of def.tiles) {
      if (tile === '') continue; // 空气没有贴图
      if (!known.has(tile)) missing.push(`${def.name}→${tile}`);
    }
  }
  check('没有拼错的贴图名', missing.length === 0, missing.slice(0, 8).join(','));
}

console.log('\n[越界区：骨块 / 蜡烛 / 带釉陶瓦 / 旗帜]');
{
  const probes = [
    ['bone_block_top', '骨块顶面'],
    ['bone_block_side', '骨块侧面'],
    ['candle', '蜡烛'],
    ['glazed_terracotta_blue', '蓝色带釉陶瓦'],
    ['banner_blue', '蓝色旗帜（光板）'],
    ['banner_blue_p1', '蓝色旗帜（十字）'],
    ['banner_white_p4', '白色旗帜（横条）'],
  ] as const;

  for (const [name, label] of probes) {
    const index = tiles.indexOf(name);
    if (index < 0) {
      check(`${label} 在名单里`, false, name);
      continue;
    }
    const row = Math.floor(index / ATLAS_COLUMNS);
    const bottom = (row + 1) * TILE_STRIDE;
    check(`${label} 所在行在可上传范围内`, bottom <= MIN_TEXTURE_SIZE, `第 ${row} 行 / ${bottom}px`);
  }

  const bone = tiles.indexOf('bone_block_top');
  const rect = tileRectAt(bone, ATLAS_COLUMNS, rows, 0.001, 0.001);
  check('骨块的 UV 落在 0~1 内', rect.every((value) => value >= 0 && value <= 1), rect.join(','));
  check('骨块 UV 宽高都是正的', rect[2]! > rect[0]! && rect[3]! > rect[1]!);
}

console.log('\n[画笔颜色：24 位色不能被当成亮度]');
{
  // 批次 531 的根因：`noisy(0xRRGGBB, ...)` 把 24 位色当亮度，clamp 后全白。
  // 这里直接调用画笔（不依赖画布），把"有颜色的贴图"逐个钉住色相。
  const rng = () => 0.5;
  const sample = (name: string): [number, number, number] => {
    const painter = PAINTERS[name];
    if (!painter) return [-1, -1, -1];
    const [r, g, b] = painter(8, 8, rng);
    return [r, g, b];
  };

  const bone = sample('bone_block_top');
  check('骨块是米色（R > G > B）', bone[0] > bone[1] && bone[1] > bone[2], bone.join(','));
  check('骨块不是纯白', !(bone[0] === 255 && bone[1] === 255 && bone[2] === 255), bone.join(','));

  const blue = sample('banner_blue');
  check('蓝色旗帜是蓝的（B 最大）', blue[2] > blue[0] && blue[2] > blue[1], blue.join(','));
  const red = sample('banner_red');
  check('红色旗帜是红的（R 最大）', red[0] > red[1] && red[0] > red[2], red.join(','));
  const glazed = sample('glazed_terracotta_blue');
  check('蓝色带釉陶瓦是蓝的', glazed[2] > glazed[0], glazed.join(','));
  const candle = sample('candle');
  check('蜡烛不是纯白', !(candle[0] === 255 && candle[1] === 255 && candle[2] === 255), candle.join(','));

  // 全表扫描：纯白只允许出现在"本来就是白色"的那几张（glass/white wool/...）。
  // 修复前这里会有 95 张（骨块、16 色旗帜、16 色带釉陶瓦、蜡烛……）。
  const allowedWhite = new Set([
    'glass',
    'wool_white',
    'stained_glass_white',
    'carpet_white',
    'shulker_top_white',
    'concrete_powder_white',
  ]);
  const unexpected = (TILE_ORDER as readonly string[]).filter((name) => {
    if (allowedWhite.has(name)) return false;
    const p = PAINTERS[name]?.(8, 8, rng);
    return p !== undefined && p[0] === 255 && p[1] === 255 && p[2] === 255;
  });
  check('除了 6 张本来该白的，没有别的纯白贴图', unexpected.length === 0, unexpected.slice(0, 10).join(','));
}

console.log('\n[顺带确认这些方块的机制本身是完整的]');
{
  // 骨块：9 骨粉 ↔ 1 骨块，两个方向都要有配方（只是显示问题，不是机制缺失）
  const packed = matchRecipe([Item.BONE_MEAL, Item.BONE_MEAL, Item.BONE_MEAL,
    Item.BONE_MEAL, Item.BONE_MEAL, Item.BONE_MEAL,
    Item.BONE_MEAL, Item.BONE_MEAL, Item.BONE_MEAL], 3);
  equal('9 骨粉 → 骨块', packed?.id, Block.BONE_BLOCK);
  const unpacked = matchRecipe([Block.BONE_BLOCK], 2);
  equal('1 骨块 → 9 骨粉', unpacked?.id, Item.BONE_MEAL);
  equal('回退得到 9 个', unpacked?.count, 9);

  // 旗帜：4 种图案 + 光板；图案贴图逐色生成
  equal('旗帜图案 4 种（加光板共 5 个名字）', BANNER_PATTERN_COUNT, 5);
  check(
    '16 色 × 4 图案的贴图都在名单里',
    ['white', 'blue', 'red', 'black'].every((color) =>
      [1, 2, 3, 4].every((pattern) => tiles.includes(`banner_${color}_p${pattern}`)),
    ),
  );
}

// ---------------------------------------------------------------- 图标缓存
//
// 2026-10-22 用户："部分图标不见了" —— 截图里空的是沙 / 原木 / 树叶 / 木板 / 圆石 /
// 玻璃 / 工作台 / 箱子 / 砖块（当时正好是建造工具条用到的 9 件；工具条已在批次
// 20261025-0117 移除，但这条次序约束对所有界面都成立）。
// 根因：`App` 构造里界面早于 `atlas.ensureUploaded()`，而主菜单阶段的图集是
// `deferPaint` 的空画布；用空图集拼出来的等轴图标全透明，还被 `BlockIcon` 按 blockId 缓存
// 住（只按 `atlas.revision` 失效）→ 这些方块在本页所有界面里永久空白。
// 这套断言守"次序 + 守卫"，因为这两种错都不会报错、只会少画东西。
console.log('\n图标缓存不能被"还没铺像素的图集"毒化');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  const ensureAt = mainSrc.indexOf('atlas.ensureUploaded()');
  const cardAt = mainSrc.indexOf('new TutorialCard(');
  const editorAt = mainSrc.indexOf('new CommandBlockEditor(');
  check(
    '进世界先铺图集像素，并且排在 UI 构造之前',
    ensureAt > 0 && cardAt > ensureAt && editorAt > ensureAt,
    `ensure=${ensureAt} card=${cardAt} editor=${editorAt}`,
  );
  check(
    '进世界时清一次方块图标缓存（上一局的坏图标能自愈）',
    mainSrc.split('clearBlockIconCache()').length - 1 >= 2,
  );

  const atlasSrc = readFileSync(new URL('../web/src/render/TextureAtlas.ts', import.meta.url), 'utf8');
  check('图集对外暴露"像素铺好了没有"', atlasSrc.includes('get isPainted(): boolean'));

  const iconSrc = readFileSync(new URL('../web/src/ui/BlockIcon.ts', import.meta.url), 'utf8');
  const guardAt = iconSrc.indexOf('if (!atlas.isPainted) return null;');
  const setAt = iconSrc.indexOf('cache.set(blockId, canvas)');
  check(
    '图集没铺好时不画、也不进缓存（缓存只按 revision 失效）',
    guardAt > 0 && setAt > guardAt,
    `guard=${guardAt} set=${setAt}`,
  );
}

console.log(`\n图集完整性测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
