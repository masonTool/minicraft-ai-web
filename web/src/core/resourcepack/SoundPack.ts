/**
 * 资源包音效替换（M10 的第二半，批次 614）
 *
 * 目标：资源包里 `sounds/**\/*.ogg` 能替换掉本项目**合成**出来的音效。
 *
 * 为什么需要一张显式映射表，而不是"按名字自动配"：
 *  - 原版的音效名与本项目的 `SoundKind` 不是一一对应（`dig.stone` 与 `step.stone`
 *    在资源包里是同一个声音文件，而本项目把它们当两种——持续摩擦 vs 落地一声）；
 *  - 一个 `SoundKind` 往往对应资源包里的**好几个变体**（`break1.ogg`…`break4.ogg`），
 *    原版靠随机挑一个来避免"同一句话听十遍"；
 *  - 反过来，资源包里绝大多数文件本项目根本不会播（音乐、唱片、UI 长音），
 *    自动照单全收只会白占内存。
 *
 * 所以这里只声明"我们真的要替换哪些"，其余一律忽略。
 *
 * ⚠️ 与贴图替换的一个关键差别：贴图是**同步**画进图集画布，音效要
 * `decodeAudioData`（异步、且必须有 AudioContext）。因此本模块只负责
 * "文件名 → SoundKind" 的**纯映射**与"挑哪个变体"的纯决策，
 * 解码与接线在 `ResourcePack.ts` / `AudioEngine` 里做——纯逻辑才能在 Node 里断言。
 */

import type { SoundKind } from '../audio/AudioEngine.ts';

/** 一个 `SoundKind` 允许被哪几个资源包文件名替换（按优先顺序，`{n}` 展开成 1..count） */
interface SoundMapping {
  /** 资源包里的相对路径（不含 `sounds/` 前缀与扩展名时也认，见 `soundNameOf`） */
  readonly paths: readonly string[];
  /**
   * 该音效在原版里有多少个变体。
   * 资源包只提供一部分时（例如只有 `break1.ogg`）也接受——**缺的变体回落到已有的那几个**，
   * 不因为"少了 3 个"就整条不替换。
   */
  readonly variants: number;
}

/**
 * `SoundKind` → 资源包路径。
 *
 * 只列**方块与玩家交互**这一类（本项目音效表的主体，也是玩家最听得出差别的部分）。
 * 生物叫声不走这张表：它们按"种类 → 三条档案"组织（见 `MobVoices.ts`），
 * 名字形如 `mob.cow.say`，与这里的 `SoundKind` 不在一个命名空间里。
 *
 * `{n}` 会被 `soundPathsFor` 展开成 1..variants。
 */
export const SOUND_PACK_FILES: Partial<Record<SoundKind, SoundMapping>> = {
  // ---------------------------------------------------------------- 破坏方块
  // 原版 `dig.*`：石头/木头/草/沙/玻璃/羊毛各一族
  break_stone: { paths: ['dig/stone{n}'], variants: 4 },
  break_wood: { paths: ['dig/wood{n}'], variants: 4 },
  break_grass: { paths: ['dig/grass{n}'], variants: 4 },
  break_sand: { paths: ['dig/sand{n}'], variants: 4 },
  break_glass: { paths: ['dig/glass{n}'], variants: 3 },
  break_wool: { paths: ['dig/cloth{n}'], variants: 4 },

  // ---------------------------------------------------------------- 放置方块
  // 原版放置音与破坏音是**同一批文件**，只是音量/音高不同——这里也指向同一批，
  // 让"放石头"与"敲石头"听感一致（这正是原版的行为）。
  place_stone: { paths: ['dig/stone{n}'], variants: 4 },
  place_wood: { paths: ['dig/wood{n}'], variants: 4 },
  place_grass: { paths: ['dig/grass{n}'], variants: 4 },
  place_sand: { paths: ['dig/sand{n}'], variants: 4 },
  place_glass: { paths: ['dig/glass{n}'], variants: 3 },
  place_wool: { paths: ['dig/cloth{n}'], variants: 4 },

  // ---------------------------------------------------------------- 脚步声
  step_grass: { paths: ['step/grass{n}'], variants: 6 },
  step_stone: { paths: ['step/stone{n}'], variants: 6 },
  step_wood: { paths: ['step/wood{n}'], variants: 6 },
  step_sand: { paths: ['step/sand{n}'], variants: 6 },
  step_gravel: { paths: ['step/gravel{n}'], variants: 6 },
  step_snow: { paths: ['step/snow{n}'], variants: 4 },
  step_wool: { paths: ['step/cloth{n}'], variants: 4 },

  // ---------------------------------------------------------------- 挖掘摩擦
  dig_stone: { paths: ['dig/stone{n}'], variants: 4 },
  dig_wood: { paths: ['dig/wood{n}'], variants: 4 },
  dig_soft: { paths: ['dig/grass{n}'], variants: 4 },
  dig_glass: { paths: ['dig/glass{n}'], variants: 3 },

  // ---------------------------------------------------------------- 受伤 / 落地
  hurt: { paths: ['damage/hurt{n}'], variants: 3 },
  hit_flesh: { paths: ['damage/hit{n}'], variants: 3 },
  fall: { paths: ['damage/fallbig{n}'], variants: 2 },
  land_hard: { paths: ['damage/fallsmall{n}'], variants: 2 },

  // ---------------------------------------------------------------- 开关与交互
  // ⚠️ 这几条原版**只有一个**采样，文件名不带序号（`door_open.ogg` 不是 `door_open1.ogg`）。
  // 因此这里不写 `{n}`，而是把"带数字 / 不带数字"两种写法都列上——
  // 不同资源包对同一件东西的命名并不统一，两种都认才不会整族失效。
  door: { paths: ['doors/door_open', 'doors/door_open1'], variants: 1 },
  door_close: { paths: ['doors/door_close', 'doors/door_close1'], variants: 1 },
  trapdoor: { paths: ['doors/trapdoor_open', 'doors/trapdoor_open1'], variants: 1 },
  fence_gate: { paths: ['doors/fence_gate_open', 'doors/fence_gate_open1'], variants: 1 },

  // ---------------------------------------------------------------- 其它
  explode: { paths: ['random/explode{n}'], variants: 4 },
  splash: { paths: ['random/splash', 'random/splash1'], variants: 1 },
  click: { paths: ['random/click', 'random/click1'], variants: 1 },
  eat: { paths: ['random/eat{n}'], variants: 3 },
  drink: { paths: ['random/drink', 'random/drink1'], variants: 1 },
  pickup: { paths: ['random/pop', 'random/pop1'], variants: 1 },
  bow_shoot: { paths: ['random/bow', 'random/bow1'], variants: 1 },
  arrow_hit: { paths: ['random/bowhit{n}'], variants: 3 },
  thunder: { paths: ['ambient/weather/thunder{n}'], variants: 3 },
  fuse: { paths: ['random/fuse', 'random/fuse1'], variants: 1 },
  portal: { paths: ['portal/portal', 'portal/portal1'], variants: 1 },
  xp: { paths: ['random/orb', 'random/orb1'], variants: 1 },
  achievement: { paths: ['random/levelup'], variants: 1 },
};

/**
 * 从 zip 条目名里取出"音效名"：`sounds/dig/stone1.ogg` → `dig/stone1`。
 *
 * 只认 `sounds/` 下、扩展名为 `ogg` / `wav` 的条目。
 * 返回的字符串**不带扩展名**，这样 `{n}` 展开后可以直接比对
 * （资源包偶尔会把 `.ogg` 换成 `.wav`，不该因此整族失效）。
 */
export function soundNameOf(entryName: string): string | null {
  const match = /(?:^|\/)sounds\/(.+?)\.(ogg|wav)$/i.exec(entryName);
  return match ? match[1]!.toLowerCase() : null;
}

/** 把 `{n}` 展开成 1..variants（没有 `{n}` 就原样返回一个） */
export function soundPathsFor(kind: SoundKind): string[] {
  const mapping = SOUND_PACK_FILES[kind];
  if (!mapping) return [];
  const out: string[] = [];
  for (const path of mapping.paths) {
    if (path.includes('{n}')) {
      for (let i = 1; i <= mapping.variants; i++) out.push(path.replace('{n}', String(i)));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * 给一组"资源包里实际存在的音效名"算出 `SoundKind → 命中文件` 的对应表。
 *
 * 纯函数，也是本模块的**唯一入口**（`ResourcePack.ts` 与测试都走它）：
 * 所以"哪个名字归哪个音效"这件事只有一处实现，不会出现
 * "贴图那份代码认 `dig/stone1`、音效这份认 `stone`"这种两套口径。
 *
 * 一个 `SoundKind` 命中多个变体时全部保留——原版就是随机挑一个，
 * 只留第一个会让"石头敲四下"听起来像复读机。
 */
export function mapPackSounds(names: readonly string[]): Map<SoundKind, string[]> {
  const present = new Set(names.map((name) => name.toLowerCase()));
  const result = new Map<SoundKind, string[]>();

  for (const kind of Object.keys(SOUND_PACK_FILES) as SoundKind[]) {
    const hits = soundPathsFor(kind).filter((path) => present.has(path));
    if (hits.length > 0) result.set(kind, hits);
  }
  return result;
}

/** 资源包里**认得出却不会用**的文件数（音乐/唱片/生物叫声等）——只用于汇报，不影响行为 */
export function countUnmappedSounds(names: readonly string[]): number {
  const mapped = new Set<string>();
  for (const kind of Object.keys(SOUND_PACK_FILES) as SoundKind[]) {
    for (const path of soundPathsFor(kind)) mapped.add(path);
  }
  return names.filter((name) => !mapped.has(name.toLowerCase())).length;
}
