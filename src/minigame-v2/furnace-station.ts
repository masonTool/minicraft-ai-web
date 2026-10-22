/**
 * 工作站（熔炉）的"点目标框才开工"规则 —— **纯逻辑，可离线断言**。
 *
 * 为什么要有这一层：
 *
 *  - 原版熔炉是"摆上料就烧"。但外部端（Web 版）改成了**先选配方、再点目标框才开工**：
 *    打开界面时先把炉子冻住（`paused = true`），玩家从左栏挑一条配方，点目标框才开始烧。
 *  - 这条规则有三处必须判对，写错了会出真事故：
 *
 * | 场景 | 错误行为 | 后果 |
 * |---|---|---|
 * | 打开一个**正在烧**的炉子 | 一律冻结 | "关着在烧、一打开进度停住" |
 * | 离开界面 / 换容器 | 不解除冻结 | 炉子被永久冻住，再也不烧 |
 * | 点了一个没有原料的配方 | 照旧开工 | 白烧一份燃料 |
 *
 * 所以这里把三条全写成**纯函数**：输入是"炉子现状 + 玩家意图"，
 * 输出是"冻结 / 开工 / 拒绝 + 一句人话"，界面只负责照着画。
 */

/** 判定需要的炉子现状（不直接吃 `Furnace`，便于断言） */
export interface FurnaceSnapshot {
  /** 原料槽里有没有东西 */
  hasInput: boolean;
  /** 燃料槽里有没有东西 */
  hasFuel: boolean;
  /** 还剩多少秒燃烧时间 */
  burnTimeLeft: number;
  /** 当前这一轮的烧炼进度（秒） */
  cookProgress: number;
  /** 这一轮总共要烧多久（秒） */
  cookTimeTotal: number;
  /** 冻结着没有 */
  paused: boolean;
  /** 是否已经点过目标框开工 */
  started: boolean;
}

/** 打开界面时该不该冻结 */
export interface OpenVerdict {
  paused: boolean;
  /** 一句话说明为什么（调试/提示用） */
  reason: string;
}

/**
 * **打开界面时**：这一炉该冻还是该继续烧。
 *
 * 规则（对齐外部端 `pauseStationContainer`）：
 *  - 正在烧（`burnTimeLeft > 0` 或 `cookProgress > 0`）→ **不冻结**，
 *    否则玩家会看到"我在外面它烧得好好的，一打开进度就停住"；
 *  - 本来就没在烧 → 冻住，等玩家点目标框。
 */
export function verdictOnOpen(snapshot: FurnaceSnapshot): OpenVerdict {
  const running = snapshot.burnTimeLeft > 0 || snapshot.cookProgress > 0;
  if (running) return { paused: false, reason: '正在烧炼，保持运行' };
  return { paused: true, reason: '等待选择配方' };
}

/**
 * **离开界面时**：冻结状态怎么收尾。
 *
 * 规则（对齐外部端 `releaseStationPause`）：
 *  - 点过目标框开工的（`started`）→ 解除冻结，让它继续烧；
 *  - 没开工的 → 保持冻结（玩家没选配方，不该自己烧）。
 *
 * ⚠️ 这一条是"炉子被永久冻住"的唯一防线：`openWith` 一换面板就会走这里。
 * 漏了它，玩家点开熔炉看一眼再关掉，那炉子就再也烧不动了。
 */
export function verdictOnLeave(snapshot: FurnaceSnapshot): OpenVerdict {
  if (snapshot.started) return { paused: false, reason: '已开工，继续烧炼' };
  return { paused: true, reason: '未开工，保持等待' };
}

/** 点目标框的结果 */
export type StartVerdict =
  | { ok: true; reason: string }
  | { ok: false; code: 'no-input' | 'no-fuel' | 'output-blocked'; reason: string };

/** 点目标框时的意图 */
export interface StartIntent {
  /** 这条配方要烧的东西现在**在不在原料槽里**（界面会先把材料填进去再判） */
  inputReady: boolean;
  /** 燃料槽里有没有能烧的东西 */
  fuelReady: boolean;
  /** 产物槽能不能装下这一件（装满了就不能开工，否则产物会消失） */
  outputFits: boolean;
}

/**
 * **点目标框**：这一下能不能开工。
 *
 * 三条拒绝都要给玩家不同的话，不能笼统说"做不了"：
 *  - 没原料 → "原料放不进去"
 *  - 没燃料 → "先放点燃料"（这是最容易踩的：背包里有煤但没进燃料槽）
 *  - 产物槽满 → "产物槽满了"
 */
export function verdictOnStart(intent: StartIntent): StartVerdict {
  if (!intent.inputReady) {
    return { ok: false, code: 'no-input', reason: '原料放不进去，先清一下熔炉格子' };
  }
  if (!intent.fuelReady) {
    return { ok: false, code: 'no-fuel', reason: '燃料槽是空的，先放点能烧的东西' };
  }
  if (!intent.outputFits) {
    return { ok: false, code: 'output-blocked', reason: '产物槽满了，先取走成品' };
  }
  return { ok: true, reason: '开始制作' };
}
