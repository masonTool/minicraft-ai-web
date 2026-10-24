/**
 * 模拟开关：**"这一端要不要推进世界"的唯一入口**（L8 · MS2）
 *
 * 背景：房主权威之后世界只由一个人跑。判断"我该不该跑"必须**只有一处**——
 * 散成十几个 `if (net.role === 'client')` 的话，总有一处会漏，而漏掉的表现是
 * "某一端某样东西还在自己动"：红石两边亮灭不同、怪的血量对不上、熔炉进度条差几秒。
 * 这类 bug 不报错，只能靠两个人对着屏幕看半天才发现，所以宁可在这一层多写几行。
 *
 * 三个角色（见 `core/net/NetRole.ts`）：
 *   · `solo`   —— 单机：**全部**自己跑，行为必须与加这一批之前完全一致（回归基线）；
 *   · `host`   —— 联机房主：跑方块 / 生物 / 容器；
 *   · `client` —— 联机从属：**一样都不跑**，只应用房主广播过来的结果。
 *
 * 时钟与天气不在角色手里：它们仍由服务端权威（`time` / `weather` 消息），
 * 所以除了单机，任何角色都不该自己推进——这条也写在表里，免得以后有人"顺手补一个"。
 *
 * 纯函数、不引世界与 DOM，单测直接断言三列。
 */

import type { NetRole } from './NetRole.ts';

/**
 * 一个"要不要推进"的域。
 *
 * 每个域对应一类真实的计时/模拟：漏掉一个就是一类不一致，所以这里**只增不减**，
 * 新增模拟路径时先在这里登记，再去 `shouldSimulate` 里给三种角色各写一个答案。
 */
export type SimDomain =
  /** 方块：红石 / 流体 / 火焰 / 作物 / 随机刻（`World.tickBlocks` 那一路） */
  | 'blocks'
  /** 生物：AI、生成、死亡（`updateMobs` / `MobSpawner`） */
  | 'mobs'
  /** 容器计时：熔炉燃烧、酿造、漏斗冷却（只同步内容时各端会差几秒） */
  | 'containers'
  /** 世界时钟：昼夜推进（联机时由服务端 `time` 权威，谁都别自己走） */
  | 'clock';

export const SIM_DOMAINS: readonly SimDomain[] = ['blocks', 'mobs', 'containers', 'clock'];

/**
 * 这一端该不该推进 `domain`。
 *
 * 表就是全部规则，没有隐藏分支：
 *
 * | 角色     | blocks | mobs | containers | clock |
 * | -------- | ------ | ---- | ---------- | ----- |
 * | `solo`   | ✔      | ✔    | ✔          | ✔     |
 * | `host`   | ✔      | ✔    | ✔          | ✘     |
 * | `client` | ✘      | ✘    | ✘          | ✘     |
 *
 * `clock` 只有单机为真：联机时时间由服务端推算、客户端按 4 倍速向它靠
 * （`core/net/NetTime.ts`），任何一端再自己推进都会变成两个时钟。
 */
export function shouldSimulate(role: NetRole, domain: SimDomain): boolean {
  if (role === 'solo') return true;
  if (role === 'client') return false;
  // host：除了时钟（服务端权威）之外都自己跑
  return domain !== 'clock';
}

/**
 * 一句话概括这一端在跑什么（调试面板 / 日志用）。
 *
 * 存在的理由：出问题时第一个要回答的问题就是"这一端到底在跑什么"，
 * 让人去翻 `shouldSimulate` 的表不如直接打印出来。
 */
export function describeSimMode(role: NetRole): string {
  const running = SIM_DOMAINS.filter((domain) => shouldSimulate(role, domain));
  if (running.length === 0) return `${role}: 不推进世界（只应用房主的结果）`;
  return `${role}: 推进 ${running.join(' / ')}`;
}
