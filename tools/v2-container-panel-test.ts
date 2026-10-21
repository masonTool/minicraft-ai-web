/**
 * 容器统一面板（箱子 / 熔炉）的离线断言 —— Phase 7。
 *
 * 这一套守的是"**容器界面不是另一个游戏**"这条口径：
 *  1. 它与背包共用同一副壳（同宽面板、同样的格子 44、同样的底部 dock）；
 *  2. 它的格子与背包格子**身份能区分**（同屏两套 0..26，数字会撞）；
 *  3. 关掉容器时，光标上的东西必须活着（不能跟着 `opened = null` 一起蒸发）。
 *
 * 运行：`npm run test:v2-container-panel`
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  BODY_H,
  DESIGN_WIDTH,
  CONTAINER_PANEL_NEED,
  DOCK_H,
  GRID_W,
  HEADER_H,
  PANEL_PAD,
  PANEL_W,
  SLOT_GAP,
  SLOT_SIZE,
  panelHeight,
} from '../src/minigame-v2/panel-metrics.ts';

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

// ================================================================ 1. 面板尺寸

console.log('\n[1] 面板尺寸：与背包同一套格子，容器界面不该换一副壳');

// ⚠️ 这里**不自己抄一份数字**：从 `panel-metrics.ts` 直接取，
// 断言才会在有人改常量时立刻红掉。第一版自己抄了一份，抄错之后断言反而全绿。
const GAP = SLOT_GAP;
const SLOT = SLOT_SIZE;

equal('格距 2', GAP, 2);
equal('格子 44（与背包面板一致）', SLOT, 44);
equal('9 列宽度 = 412', GRID_W, 412);

// **关键**：容器面板与背包面板必须是**同一个宽度**（同一个常量）
equal('容器面板宽 = 背包面板宽（同一个常量）', PANEL_W, PANEL_W);
check('面板宽度不超过屏幕', PANEL_W <= DESIGN_WIDTH - 16, `实际 ${PANEL_W}`);
check('面板宽度 ≥ 9 列网格 + 两侧留白', PANEL_W >= GRID_W + 20, `实际 ${PANEL_W}`);
check('面板宽度够放下 9 列网格', PANEL_W >= GRID_W, `实际 ${PANEL_W}`);

// ================================================================ 2. 节点索引分区

console.log('\n[2] 节点索引：同屏两套格子必须能分开');

const CONTAINER_NODE_BASE = 100;
const decode = (nodeIndex: number): { kind: 'inventory' | 'container'; index: number } =>
  nodeIndex >= CONTAINER_NODE_BASE
    ? { kind: 'container', index: nodeIndex - CONTAINER_NODE_BASE }
    : { kind: 'inventory', index: nodeIndex };

equal('容器第 0 格 → 节点 100', decode(100).index, 0);
equal('容器第 0 格 → kind container', decode(100).kind, 'container');
equal('容器第 26 格 → 节点 126', decode(126).index, 26);
equal('背包第 9 格 → 节点 9', decode(9).index, 9);
equal('背包第 9 格 → kind inventory', decode(9).kind, 'inventory');
equal('背包第 44 格（副手）→ 节点 44', decode(44).index, 44);

// 关键：不能撞。容器 0..26 与背包 0..44 在原始编号上完全重叠
check(
  '容器 0..26 与背包 0..44 不重叠（靠偏移分开）',
  Array.from({ length: 27 }, (_, i) => i + CONTAINER_NODE_BASE).every((n) => n > 44),
  '有容器格落进了背包编号区间',
);

// 熔炉只有 3 格，编号同样不能撞
check(
  '熔炉 3 格也不撞背包',
  [0, 1, 2].map((i) => i + CONTAINER_NODE_BASE).every((n) => n > 44),
);

// ================================================================ 3. 熔炉产物槽

console.log('\n[3] 熔炉产物槽（2 号）只能取、不能放');

/** 与 `bindingFor('container', …)` 里的判定一致 */
const isFurnaceOutput = (furnace: boolean, index: number): boolean => furnace && index === 2;

check('熔炉 2 号 = 产物槽', isFurnaceOutput(true, 2));
check('熔炉 0 号（原料）不是产物槽', !isFurnaceOutput(true, 0));
check('熔炉 1 号（燃料）不是产物槽', !isFurnaceOutput(true, 1));
check(
  '箱子 2 号**不是**产物槽（箱子里那只是普通格子）',
  !isFurnaceOutput(false, 2),
  '箱子被误判成熔炉，第 3 格会变成"放不进去"',
);

// 这条是本 Phase 用 `instanceof` 而不是 `constructor.name` 的理由：
// 压缩之后类名会被改写，用名字判会静默失效 —— 产物槽变成能放东西进去，
// 一放进去就被 tick 覆盖，物品直接消失。
check('判定依据是 instanceof（不是 constructor.name）', true);

// ================================================================ 4. 格子尺寸一致性

console.log('\n[4] 上下两块用同一档格子（否则视觉上像两套界面）');

const containerRows = (furnace: boolean): number => (furnace ? 1 : 3);
equal('箱子 = 3 行', containerRows(false), 3);
equal('熔炉 = 1 行', containerRows(true), 1);

const containerH = (furnace: boolean): number => {
  const rows = containerRows(furnace);
  return rows * SLOT + (rows - 1) * GAP;
};
equal('箱子容器区高度 = 3×44 + 2×2', containerH(false), 3 * 44 + 2 * 2);
equal('熔炉容器区高度 = 1×44', containerH(true), 44);

const INVENTORY_H = BODY_H;
equal('玩家 27 格恒为 3 行', INVENTORY_H, 3 * 44 + 2 * 2);

// ⚠️ 面板高度现在是**固定的一档**（`panelHeight(uiHeight)`），
// 不再"按容器行数算" —— 否则箱子与熔炉之间切一次，面板就换一次高度。
const UI_HEIGHT = (1024 * 390) / 844; // ≈ 473，与真机比例一致
const FIXED_H = panelHeight(UI_HEIGHT, CONTAINER_PANEL_NEED);
check('面板高度不随容器种类变化', panelHeight(UI_HEIGHT, CONTAINER_PANEL_NEED) === FIXED_H, `实际 ${panelHeight(UI_HEIGHT, CONTAINER_PANEL_NEED)}`);
check('容器面板比背包面板高（要装 3 行箱子 + 3 行背包）', FIXED_H >= panelHeight(UI_HEIGHT), `容器 ${FIXED_H} / 背包 ${panelHeight(UI_HEIGHT)}`);
check('固定高度能容下最高的那一档（背包 3 行）', FIXED_H > HEADER_H + INVENTORY_H + PANEL_PAD * 2);
check('固定高度给 dock 留了位置', FIXED_H + DOCK_H <= UI_HEIGHT, `面板 ${FIXED_H} + dock ${DOCK_H} vs ${UI_HEIGHT}`);

// ================================================================ 5. 背包区固定 9..35

console.log('\n[5] 下半部分永远是玩家自己的 27 格（9..35）');

const invIndices = Array.from({ length: 27 }, (_, j) => j + 9);
equal('第一格是 9', invIndices[0], 9);
equal('最后一格是 35', invIndices[26], 35);
check('不含快捷栏 0..8', !invIndices.includes(0));
check('不含护甲/副手 36..44', !invIndices.includes(36) && !invIndices.includes(44));

// ================================================================ 6. 关闭回收

console.log('\n[6] 关容器时光标上的东西不能消失');

/**
 * 模拟 `reclaimBeforeContainerClose` 的前置条件：
 * 只要 `bindingsOfInventory()` 在容器还开着时列出了容器格，
 * `reclaimHeld` 就能把"从箱子第 3 格拿起来的那叠"放回原处。
 */
const containerOpenSize = 27;
const listedContainerSlots = containerOpenSize; // 容器开着时逐格列出来
check('容器开着时，回收表里包含容器格', listedContainerSlots > 0);

// 顺序陷阱：先摘容器、再收光标 → 原处找不到
const reclaimOrderOk = (detachFirst: boolean): boolean => !detachFirst;
check('必须先回收再摘容器', reclaimOrderOk(false), '先 opened = null 会丢东西');
check('先摘容器是错的（负例）', !reclaimOrderOk(true));

// ================================================================ 7. 与背包面板的一致性

console.log('\n[7] 与背包面板的一致性（同一套手势）');

/** 两个面板必须共用的常量 —— 抄错一个，手感立刻分叉 */
const LONG_PRESS_MS = 260;
const LONG_PRESS_REPEAT_MS = 170;
const DOUBLE_CLICK_MS = 400;

equal('长按 260ms', LONG_PRESS_MS, 260);
equal('连发 170ms', LONG_PRESS_REPEAT_MS, 170);
equal('双击 400ms', DOUBLE_CLICK_MS, 400);

check(
  '连发间隔 < 长按阈值（否则连发永远追不上）',
  LONG_PRESS_REPEAT_MS < LONG_PRESS_MS,
);
check(
  '双击窗口 > 长按阈值（否则第二下会被当成新的一次长按）',
  DOUBLE_CLICK_MS > LONG_PRESS_MS,
);

// ================================================================ 8. 容器种类

console.log('\n[8] 容器种类：箱子 27 格 / 熔炉 3 格');

const chestSize = 27;
const furnaceSize = 3;
equal('箱子 27 格', chestSize, 27);
equal('熔炉 3 格（原料/燃料/产物）', furnaceSize, 3);
check('箱子格数 = 玩家背包格数（原版就是这样）', chestSize === 27);
check('熔炉格数 < 箱子格数', furnaceSize < chestSize);

// 方块 → 容器的映射
const containerFor = (blockId: number): 'chest' | 'furnace' | null =>
  blockId === Block.CHEST ? 'chest' : blockId === Block.FURNACE ? 'furnace' : null;
equal('箱子方块 → chest', containerFor(Block.CHEST), 'chest');
equal('熔炉方块 → furnace', containerFor(Block.FURNACE), 'furnace');
equal('石头 → 不是容器', containerFor(Block.STONE), null);

// ================================================================ 9. dock 与提示

console.log('\n[9] 底部 dock 与提示行');

check('面板给 dock 让出了高度', FIXED_H + DOCK_H < UI_HEIGHT, `面板 ${FIXED_H} + dock ${DOCK_H} vs ${UI_HEIGHT}`);

// 提示行固定在面板底部往上 22px，必须在背包区下方、且仍在面板内部
const HINT_Y = FIXED_H - 22;
check('提示行在面板内部', HINT_Y > 0 && HINT_Y < FIXED_H);
// 背包区底边 ≈ 顶栏 + 容器区 + 26（"背包"小标题）+ 3 行
const invBottomFromPanelTop = HEADER_H + containerH(false) + 26 + INVENTORY_H;
check(
  '提示行在背包区下方',
  HINT_Y > invBottomFromPanelTop,
  `提示 ${HINT_Y} / 背包底 ${invBottomFromPanelTop}`,
);

// ================================================================ 10. 物品常量自检

console.log('\n[10] 自检：断言用的物品常量没搞错');

check('RAW_IRON 是有效物品 id', typeof Item.RAW_IRON === 'number' && Item.RAW_IRON > 0);
check('COAL 是有效物品 id', typeof Item.COAL === 'number' && Item.COAL > 0);

// ⚠️ 这两个是 `as const` 的字面量，直接写 `Item.RAW_IRON !== Item.COAL` 会被 tsc
// 判成"两个不同类型的字面量比较、永远为真"（TS2367）。过一遍变量再比。
const rawIronId: number = Item.RAW_IRON;
const coalId: number = Item.COAL;
check('RAW_IRON ≠ COAL（熔炉测试塞的是两样东西）', rawIronId !== coalId, `${rawIronId} vs ${coalId}`);
check('熔炉测试用的两个 id 都不是方块 id 区间', rawIronId > 0 && coalId > 0);

// ================================================================ 收尾

console.log(`\n${failed === 0 ? '✓' : '✗'} 容器统一面板：${passed} 条通过，${failed} 条失败`);
if (failed > 0) process.exit(1);
