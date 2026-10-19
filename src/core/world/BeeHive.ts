/**
 * 蜂巢的蜂蜜等级与挤蜜（J21，批次 407）—— 纯规则，不碰世界、不碰 DOM。
 *
 * 原版口径（对着 wiki 的蜜蜂条目）：
 *  - 蜂巢/蜂箱有 **0~5 级**蜂蜜：蜜蜂回巢时 +1，满了会"滴蜜"（粒子）；
 *  - 手里拿**玻璃瓶**点它 → 得到 1 瓶蜂蜜，**等级归 0**（不是降一级——原版就是清空）；
 *  - 用剪刀 → 掉 3 个蜜脾，等级同样归 0；
 *  - 满级用发射器也能收。
 *
 * 本项目做了三处简化（都记在 TASKS 的差异里，不藏着）：
 *  1. **没有蜜蜂回巢涨蜜**：本项目蜜蜂不认巢（见 mobs.ts 的蜜蜂注释），
 *     所以等级按时间**自动回涨**（`HONEY_REGROW_SECONDS`），否则蜂巢一辈子只有一次收成；
 *  2. 不做"滴蜜"粒子与音效（粒子系统有，但这一批不动渲染层）；
 *  3. 不收蜜脾（剪刀那条留给"蜜脾换蜡"那一批，蜜脾目前只从蜂巢方块掉落）。
 *
 * 为什么单独一个纯类：等级与冷却都是"数值规则"，能离线钉死；
 * 而"点一下蜂巢有没有出瓶子"是 main 的接线，浏览器里才看得到。
 * 两件事分开，回归时才知道是哪一边坏的。
 */

/** 蜂蜜等级上限（原版 5） */
export const HONEY_MAX_LEVEL = 5;
/** 这一版没有蜜蜂回巢，等级按时间回涨；一档 20 秒，从 0 到满 100 秒 */
export const HONEY_REGROW_SECONDS = 20;
/** 刚收过的巢要等这么久才开始回涨（原版收完是 0 级，蜜蜂再来才涨） */
export const HONEY_HARVEST_COOLDOWN = 5;

/** 一个蜂巢的运行时状态 */
interface HiveEntry {
  level: number;
  /** 距离下一次涨一级还差多少秒 */
  timer: number;
}

/**
 * 按坐标存蜂巢状态（与告示牌/展示框同一套"方块负责占位、运行时数据放表里"的做法）。
 *
 * ⚠️ 键里**必须带维度**：主世界与下界在同一个 (x,y,z) 上是两个不同的蜂巢，
 * 这条在展示框那批已经踩过一次（下界的框会读到主世界的物品）。
 */
export class BeeHives {
  private readonly hives = new Map<string, HiveEntry>();

  private key(x: number, y: number, z: number, dimension: string): string {
    return `${dimension}:${x},${y},${z}`;
  }

  /**
   * 取（或**懒建**）一条记录。
   *
   * 第一次碰到的巢按**满蜜**建：自然生成的蜂巢在原版里多半是带蜜的，
   * 而"所有人第一次去看都是 0 级、要等 100 秒"会让玩家以为挤蜜坏了。
   * 这也顺手解决了"新巢永远不会自己涨蜜"（`tick` 只能推进已经存在的记录）。
   */
  private entryAt(key: string): HiveEntry {
    let entry = this.hives.get(key);
    if (!entry) {
      entry = { level: HONEY_MAX_LEVEL, timer: HONEY_REGROW_SECONDS };
      this.hives.set(key, entry);
    }
    return entry;
  }

  /** 读等级 */
  level(x: number, y: number, z: number, dimension: string): number {
    return this.entryAt(this.key(x, y, z, dimension)).level;
  }

  /** 直接设等级（测试与 `/setblock` 类操作会用到）；超出 0~5 会被夹住 */
  setLevel(x: number, y: number, z: number, dimension: string, level: number): void {
    const clamped = Math.max(0, Math.min(HONEY_MAX_LEVEL, Math.round(level)));
    const key = this.key(x, y, z, dimension);
    const entry = this.entryAt(key);
    if (entry) {
      entry.level = clamped;
      entry.timer = HONEY_REGROW_SECONDS;
      return;
    }
    this.hives.set(key, { level: clamped, timer: HONEY_REGROW_SECONDS });
  }

  /**
   * 挤一瓶蜂蜜。
   *
   * @returns 挤出来了没有。**0 级挤不出来**（原版也挤不出），
   *          这不是"失败提示"而是"这一下不该被消费"——调用方要据此决定要不要放行放置逻辑。
   */
  harvest(x: number, y: number, z: number, dimension: string): boolean {
    const key = this.key(x, y, z, dimension);
    const entry = this.entryAt(key);
    if (entry.level <= 0) return false;
    // 原版收完是**清空**，不是降一级
    entry.level = 0;
    entry.timer = HONEY_HARVEST_COOLDOWN;
    return true;
  }

  /** 每帧推进：冷却走完之后逐级回涨到满 */
  tick(dt: number): void {
    if (dt <= 0) return;
    for (const entry of this.hives.values()) {
      if (entry.level >= HONEY_MAX_LEVEL) continue;
      entry.timer -= dt;
      while (entry.timer <= 0) {
        entry.level++;
        if (entry.level >= HONEY_MAX_LEVEL) {
          entry.level = HONEY_MAX_LEVEL;
          entry.timer = 0;
          break;
        }
        entry.timer += HONEY_REGROW_SECONDS;
      }
    }
  }

  /** 方块被拆/被换掉时清掉记录（不清的话下次同位置放一个巢会"自带蜂蜜"） */
  forget(x: number, y: number, z: number, dimension: string): void {
    this.hives.delete(this.key(x, y, z, dimension));
  }

  get size(): number {
    return this.hives.size;
  }
}

/**
 * 被蛰（原版：蜇人的蜜蜂会失去螫针并很快死亡，玩家中毒）。
 *
 * 中毒数值用"中毒 I、10 秒"——原版蜜蜂是中毒 10 秒（普通难度），
 * 这里不区分难度（难度的伤害倍率在生存系统里统一处理）。
 */
export const BEE_STING_POISON_SECONDS = 10;
export const BEE_STING_POISON_AMPLIFIER = 0;

/** 蛰完之后蜜蜂还能活多久（原版失去螫针后约 50~70 秒内死亡，这里取 60） */
export const BEE_LIFE_AFTER_STING = 60;

/** 这一下该不该"蛰"：蜜蜂且还没蛰过（蛰过的不会再蜇） */
export function shouldSting(typeId: string, alreadyStung: boolean): boolean {
  return typeId === 'bee' && !alreadyStung;
}
