/**
 * 村民（J11，批次 88）
 *
 * 它是本项目的**第一种"会做生意的生物"**：一个 `Mob` 子类，多出来的状态只有四样
 * （职业 / 交易经验 / 交易清单 / 认领的工作站），交易表在 `registry/villagerTrades.ts`。
 *
 * 四处与原版的差异（都记在 TASKS J11，写在这里是因为它们就长在这儿）：
 *  1. **不走路去上班**：原版白天会聚到工作站旁、晚上回床上，本项目只保留"附近有工作站就认领"
 *     （走位交给 `Mob` 那套游荡 AI，它已经会避崖了）；
 *  2. **不躲僵尸**：原版的恐慌与铁傀儡生成留到 J22；
 *  3. **繁殖退化成与牛羊同一条链**：原版要"意愿"（够多的食物 + 够多的床），
 *     本项目喂一份食物就进入求爱（`Mob` 那套），所以村民会像牛羊一样自己凑对生娃；
 *  4. **交易与职业不进存档**：生物本身就不存档（J2），所以退出重进世界会"换一批村民"。
 *
 * 认领工作站的扫描是**有上限的**（见 `WORKSTATION_SCAN_RANGE`）：每只无业村民每 2~4 秒
 * 扫一次 17×7×17 的盒子。这个数字是"体感（8 格内看得见）"与"每帧开销"的折中，
 * 换成"每帧扫全场"会在村里放十几个村民时变成明显的卡顿。
 */

import type { EntityContext } from './Entity.ts';
import { Mob } from './Mob.ts';
import {
  PROFESSIONS,
  findWorkstationNear,
  levelForTradeXp,
  offersUnlockedAt,
  professionById,
  professionForWorkstation,
  type TradeOffer,
  type VillagerProfession,
  type VillagerProfessionId,
} from '../registry/villagerTrades.ts';
import { VILLAGER_TYPE } from './mobs.ts';

/** 无业村民隔多久再找一次工作站（秒，带随机抖动，免得一村人同时扫） */
const CLAIM_RETRY_MIN = 2;
const CLAIM_RETRY_MAX = 4;
/** 村民的"嗯…"隔多久来一次（秒，原版更密，这里压低一点免得吵） */
const AMBIENT_MIN = 8;
const AMBIENT_MAX = 16;

export interface WorkstationPos {
  x: number;
  y: number;
  z: number;
}

export class Villager extends Mob {
  /** 职业（null = 无业：还没认领工作站） */
  professionId: VillagerProfessionId | null = null;
  /** 交易经验（等级由它算出来，见 `levelForTradeXp`） */
  tradeXp = 0;
  /** 交易清单（认领职业时建 1 级那一批，升级时追加新等级那一批） */
  offers: TradeOffer[] = [];
  /** 认领的工作站坐标（原版靠它决定白天去哪；本项目只用来显示与调试） */
  workstation: WorkstationPos | null = null;

  private claimTimer = CLAIM_RETRY_MIN + Math.random() * (CLAIM_RETRY_MAX - CLAIM_RETRY_MIN);
  private ambientTimer = AMBIENT_MIN + Math.random() * (AMBIENT_MAX - AMBIENT_MIN);

  constructor(x: number, y: number, z: number) {
    super(VILLAGER_TYPE, x, y, z);
  }

  get profession(): VillagerProfession | null {
    return this.professionId === null ? null : (professionById(this.professionId) ?? null);
  }

  /** 当前等级（1~5；无业也算 1 级——界面要显示点东西） */
  get level(): number {
    return levelForTradeXp(this.tradeXp);
  }

  /** 升级到下一级还差多少经验（界面上的进度条用） */
  get tradeXpProgress(): { current: number; next: number } {
    const thresholds = [0, 10, 70, 150, 250];
    const level = this.level;
    const current = this.tradeXp - (thresholds[level - 1] ?? 0);
    const next = level >= thresholds.length ? 0 : (thresholds[level] ?? 0) - (thresholds[level - 1] ?? 0);
    return { current, next };
  }

  /**
   * 渲染层用的"外观版本"：职业一变就得重建模型（长袍颜色换了）。
   * 与羊的"剪没剪"是同一条机制（见 `MobRenderer`）。
   */
  get appearanceKey(): string {
    return this.professionId ?? 'idle';
  }

  /**
   * 认领工作站 → 得到职业（只对**无业**村民生效）。
   *
   * @returns 是否真的认领了（已经有职业、或者这一格不是工作站都是 false）
   */
  assignProfession(professionId: VillagerProfessionId, workstation: WorkstationPos | null = null): boolean {
    if (this.professionId !== null || this.baby) return false;
    const profession = professionById(professionId);
    if (!profession) return false;
    this.professionId = professionId;
    this.workstation = workstation;
    // 1 级那一批就是"入门交易"（原版认领职业那一刻给的也是这些）
    this.offers = offersUnlockedAt(profession, 1);
    return true;
  }

  /**
   * 成交一次之后给村民经验。
   *
   * @returns **升了几级**（0 = 没升；界面据此播升级提示、解锁新交易）
   */
  addTradeXp(amount: number): number {
    if (amount <= 0 || !this.profession) return 0;
    const before = this.level;
    this.tradeXp += amount;
    const after = this.level;
    if (after <= before) return 0;

    // 升级：把中间跳过的每一级都补上（一次给一大笔经验时可能连升两级）
    let added = 0;
    for (let level = before + 1; level <= after; level++) {
      const unlocked = offersUnlockedAt(this.profession, level);
      if (unlocked.length === 0) continue;
      this.offers.push(...unlocked);
      added += unlocked.length;
    }
    void added;
    return after - before;
  }

  override tick(ctx: EntityContext, dt: number): void {
    super.tick(ctx, dt);
    if (this.dead) return;

    // "嗯…"：只给在场感，不带任何机制（原版村民也一直在哼哼）
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = AMBIENT_MIN + Math.random() * (AMBIENT_MAX - AMBIENT_MIN);
      ctx.playSound?.('mob_villager', this.x, this.y, this.z);
    }

    if (this.baby || this.professionId !== null) return;
    this.claimTimer -= dt;
    if (this.claimTimer > 0) return;
    this.claimTimer = CLAIM_RETRY_MIN + Math.random() * (CLAIM_RETRY_MAX - CLAIM_RETRY_MIN);

    const found = findWorkstationNear(ctx.getBlock, this.x, this.y, this.z);
    if (!found) return;
    const profession = professionForWorkstation(found.block);
    if (!profession) return;
    // 认领成功：冒一串绿色粒子（原版是绿星），再"嗯"一声
    this.assignProfession(profession.id, { x: found.x, y: found.y, z: found.z });
    ctx.spawnHearts?.(this.x, this.y + this.type.height, this.z, 0.6);
    ctx.playSound?.('mob_villager', this.x, this.y, this.z);
  }

  /** 调试与断言用：这一只现在能做什么（不返回 offer 对象本体，免得被顺手改掉） */
  get tradeSummary(): {
    profession: string | null;
    level: number;
    xp: number;
    offers: Array<{ result: number; count: number; uses: number; maxUses: number }>;
  } {
    return {
      profession: this.professionId,
      level: this.level,
      xp: this.tradeXp,
      offers: this.offers.map((offer) => ({
        result: offer.result.id,
        count: offer.result.count,
        uses: offer.uses,
        maxUses: offer.maxUses,
      })),
    };
  }
}

/** 本批一共支持几个职业（主程序与测试都用它问"表长"） */
export const VILLAGER_PROFESSION_COUNT = PROFESSIONS.length;
