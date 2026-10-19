/**
 * 「这次方块写入会不会改变光照」的判据（批次 282）
 *
 * ## 为什么要有它
 *
 * `World.setBlockAndUpdate` / `setStateAndUpdate` 以前**无条件**调
 * `light.onBlockChanged`：那是一趟清光 BFS（把这一格下游的光全清掉）加一轮重扩散。
 * 真机日志（792×360 / Adreno 829）里 `fluid` 每秒改 3000+ 次方块，几乎全是
 * "水的液面 1→2 / 下落位切换"——挡光与发光一个都没变，却每次都跑一趟：
 * `readded` 40 万格/5s、`spread` 55 万格/5s，折算 19.5 万格/秒，
 * 正好把手机 4000 格/帧的光照预算吃满（`pending` 2 万~28 万，还开始 `dropped`）。
 *
 * ## 判据为什么只有两个量
 *
 * 增量光照只依赖两件事：
 *  - **挡多少光**（`lightOpacity`）：决定光能不能穿过、穿过后剩几级；
 *  - **自己发不发光**（自发光等级）：决定这一格是不是光源。
 *
 * 两者都没变时，这一格的入射光、它给邻居的光、邻居给它的光**都不可能变**，
 * 所以整趟 BFS 是白跑。液面等级、朝向、红石强度这些状态位只要不影响上面两个量，
 * 就都不需要重算光照。
 *
 * ## 用法
 *
 * 必须在**写入之前**把新旧两个签名都取好（写完就只剩新值了），比较不等才调
 * `onBlockChanged`。但**重网格化照旧**：水面高度、方块外观都变了。
 *
 * 该模块是纯函数，离线测试可以直接断言（`test:world` 与 `tests/light.test.ts`）。
 */

import { blockDef } from '../registry/blocks.ts';

/**
 * 光照签名：`挡光 × 16 + 自发光`。两个量都在 0~15，所以签名不会撞车。
 *
 * ⚠️ 自发光走 `stateLight`：红石灯 / 熔炉 / 营火的"亮着"是**状态位**决定的，
 * 只看 `def.light` 会把"开灯"误判成"光照没变"（那样灯亮起来不会照亮周围）。
 */
export function lightSignature(id: number, state: number): number {
  const def = blockDef(id);
  const emit = def.stateLight ? def.stateLight(state) : def.light;
  return def.lightOpacity * 16 + emit;
}

/** 这次写入（旧 → 新）是否需要重算光照 */
export function lightNeedsUpdate(beforeId: number, beforeState: number, id: number, state: number): boolean {
  return lightSignature(beforeId, beforeState) !== lightSignature(id, state);
}
