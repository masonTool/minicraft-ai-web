/**
 * 月相（批次 84，I15）
 *
 * 原版有 8 种月相，**每天推进一格**（8 天一个循环，从满月开始）。月相在玩法上只有两处影响：
 *  1. **史莱姆的生成**（满月最多、新月最少）；
 *  2. **天空里月亮的样子**（这一批真正做的那件事）。
 *
 * ⚠️ 与原版的差异：本项目**还没有史莱姆**，所以第 1 条只是把数值表放在这里
 * （`MOON_BRIGHTNESS` + `slimeSpawnFactor`），等史莱姆做出来时直接取用——
 * **不假装它有影响**，也不为了"看着有用"而拿别的机制顶上。
 *
 * 这个模块是纯函数/纯数据（不碰 THREE、不碰 DOM），因为月亮长什么样是**几何**：
 * 哪半边是亮的、明暗分界的椭圆有多宽，都能离线断言（见 `tools/moon-test.ts`）。
 */
import { t } from '../i18n/I18n.ts';

/** 8 天一个循环（原版） */
export const MOON_PHASE_COUNT = 8;

/**
 * 月相表（顺序就是原版的顺序：满月 → 亏凸月 → 下弦月 → 残月 → 新月 → 娥眉月 → 上弦月 → 盈凸月）。
 *
 * `lit` 是"亮面占整个圆盘的比例"（原版那 8 张图就是这个比例）：
 * 满月 1.0、凸月 0.75、弦月 0.5、残月 0.25、新月 0。
 */
export interface MoonPhase {
  /** 0~7 */
  readonly phase: number;
  /** 中文名（调试与 `/time` 用） */
  readonly cn: string;
  /** 亮面比例（0~1） */
  readonly lit: number;
  /**
   * 亮的是哪半边：**亏（正在变小）时在西边（左）**、盈时在东边（右）。
   * 这是北半球的观感，也是原版贴图的画法。
   */
  readonly litHalf: 'left' | 'right';
}

export const MOON_PHASES: readonly MoonPhase[] = [
  { phase: 0, cn: '满月', lit: 1, litHalf: 'right' },
  { phase: 1, cn: '亏凸月', lit: 0.75, litHalf: 'left' },
  { phase: 2, cn: '下弦月', lit: 0.5, litHalf: 'left' },
  { phase: 3, cn: '残月', lit: 0.25, litHalf: 'left' },
  { phase: 4, cn: '新月', lit: 0, litHalf: 'left' },
  { phase: 5, cn: '娥眉月', lit: 0.25, litHalf: 'right' },
  { phase: 6, cn: '上弦月', lit: 0.5, litHalf: 'right' },
  { phase: 7, cn: '盈凸月', lit: 0.75, litHalf: 'right' },
];

/**
 * 原版的"月亮亮度"（`getMoonBrightness`）：满月 1.0、新月 0.0，中间线性。
 *
 * 它**只用来算史莱姆的生成概率**（见 `slimeSpawnFactor`）。注意月相**不影响月光强度**——
 * 夜里地表的天光等级恒为 4，这几乎是最容易被想当然的一条。
 */
export const MOON_BRIGHTNESS: readonly number[] = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];

/** 第 N 天（世界开服算起）的月相；负数与超过 8 的都能算（原版也是取模） */
export function moonPhaseFor(day: number): number {
  if (!Number.isFinite(day)) return 0;
  return ((Math.floor(day) % MOON_PHASE_COUNT) + MOON_PHASE_COUNT) % MOON_PHASE_COUNT;
}

/** 月相的定义；非法输入回退满月 */
export function moonPhaseInfo(phase: number): MoonPhase {
  return MOON_PHASES[moonPhaseFor(phase)]!;
}

/** 中文名（调试面板、`/time` 用） */
/**
 * 月相的中文名（批次 20261024-0136 起按语言取）。
 *
 * ⚠️ 表里仍保留 `cn` 字段：它是**数据**（调试面板以外还有人拿它当"稳定标识"），
 * 而显示名改成查 `hud.moonPhase.<phase>` —— 否则德语界面的调试面板会显示「满月」。
 */
export function moonPhaseName(phase: number): string {
  return t(`hud.moonPhase.${moonPhaseFor(phase)}`);
}

/**
 * 月亮"该被画成什么样"——渲染层照着这三个数画（**几何只有这一处**）。
 *
 * 画法（`Sky.ts` 里就是这么用的）：先铺一层暗色圆盘，再画**亮的那半边**，
 * 最后按 `ellipseMode` 用一个横半径 `ellipseRx` 的椭圆**加或减**一块——
 *  - `add`：亮面超过一半（凸月），椭圆补上另一半的一部分；
 *  - `subtract`：亮面不足一半（残月），从半边里再挖掉一块。
 *
 * 边界自检：满月 `ellipseRx = 1` + `add` → 整个圆都亮；新月 `ellipseRx = 1` + `subtract` → 全暗；
 * 两个弦月 `ellipseRx = 0` → 正好一半。
 */
export interface MoonShape {
  /** 椭圆横半径占月盘半径的比例（0~1） */
  readonly ellipseRx: number;
  readonly ellipseMode: 'add' | 'subtract';
  readonly litHalf: 'left' | 'right';
  /** 亮面比例（0~1，给渲染层调亮度用） */
  readonly lit: number;
}

export function moonShape(phase: number): MoonShape {
  const info = moonPhaseInfo(phase);
  return {
    ellipseRx: Math.abs(2 * info.lit - 1),
    ellipseMode: info.lit > 0.5 ? 'add' : 'subtract',
    litHalf: info.litHalf,
    lit: info.lit,
  };
}

/**
 * 月光强度**不随月相变化**（原版如此）：夜里地表天光恒为 4。
 *
 * 写成函数而不是常量，是为了把这条"反直觉的事实"放进代码里——它总被当成常数 4 顺手写死，
 * 然后某天有人"顺手优化"成"满月更亮一点"，就会静默改变夜间刷怪。断言里专门钉了 8 个相都等于 4。
 */
export function moonlightLevel(): number {
  return 4;
}

/**
 * 史莱姆的生成概率系数（原版 `Slime#checkSlimeSpawnRules` 用的就是月亮亮度）。
 *
 * ⚠️ **本项目还没有史莱姆**，所以现在没有任何地方消费它——留着是因为
 * "月相 → 史莱姆"这条关系是月相在玩法上的**唯一**影响，写在数据里比写在注释里更不容易忘
 * （TASKS I15 与 J 档的"史莱姆"条目互相指向）。
 */
export function slimeSpawnFactor(phase: number): number {
  return MOON_BRIGHTNESS[moonPhaseFor(phase)]!;
}
