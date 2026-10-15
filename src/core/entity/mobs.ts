/**
 * 生物种类表
 *
 * 数值按原版（基岩版/Java 版 1.18）取值：
 *  - 僵尸 / 骷髅 / 苦力怕：20 点生命，移动速度约 2.3 格/秒，追击范围 24~35 格
 *  - 牛 / 猪 / 羊 / 鸡：8~10 点生命，游荡速度约 1.1~1.3 格/秒
 *  - 掉落物按原版的种类与数量区间，概率项用于"0~2 个"这类随机掉落
 *
 * 颜色字段给渲染器用（程序化模型按主色 + 点缀色拼出身体与四肢）。
 */

import { woolId } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
import type { MobType } from './Mob.ts';

export const MOB_TYPES: readonly MobType[] = [
  {
    id: 'zombie',
    name: '僵尸',
    health: 20,
    width: 0.6,
    height: 1.95,
    speed: 2.35,
    hostile: true,
    attackDamage: 3,
    followRange: 24,
    drops: [{ itemId: Item.ROTTEN_FLESH, min: 0, max: 2, chance: 0.8 }],
    bodyColor: 0x2f6b45,
    accentColor: 0x1f4a30,
    eyeHeight: 1.74,
  },
  {
    id: 'skeleton',
    name: '骷髅',
    health: 20,
    width: 0.6,
    height: 1.95,
    speed: 2.4,
    hostile: true,
    attackDamage: 2,
    followRange: 24,
    drops: [{ itemId: Item.BONE, min: 0, max: 2, chance: 0.85 }],
    bodyColor: 0xd9d9d1,
    accentColor: 0xb4b4ac,
    eyeHeight: 1.74,
  },
  {
    id: 'creeper',
    name: '苦力怕',
    health: 20,
    width: 0.6,
    height: 1.7,
    speed: 2.2,
    hostile: true,
    // 原版的爆炸伤害最高约 49（贴脸），这里按"近身自爆"取 24
    attackDamage: 24,
    followRange: 20,
    drops: [{ itemId: Item.GUNPOWDER, min: 0, max: 2, chance: 0.75 }],
    bodyColor: 0x57a84b,
    accentColor: 0x3c7a34,
    eyeHeight: 1.4,
  },
  {
    id: 'cow',
    name: '牛',
    health: 10,
    width: 0.9,
    height: 1.4,
    speed: 1.25,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [
      { itemId: Item.BEEF, min: 1, max: 3 },
      { itemId: Item.LEATHER, min: 0, max: 2 },
    ],
    bodyColor: 0x4a3325,
    accentColor: 0xe8e4d8,
    eyeHeight: 1.15,
  },
  {
    id: 'pig',
    name: '猪',
    health: 10,
    width: 0.9,
    height: 0.9,
    speed: 1.25,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [{ itemId: Item.PORKCHOP, min: 1, max: 3 }],
    bodyColor: 0xe39a9a,
    accentColor: 0xc47878,
    eyeHeight: 0.75,
  },
  {
    id: 'sheep',
    name: '羊',
    health: 8,
    width: 0.9,
    height: 1.3,
    speed: 1.2,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [
      { itemId: Item.MUTTON, min: 1, max: 2 },
      { itemId: woolId(0), min: 1, max: 1 },
    ],
    bodyColor: 0xe8e8e8,
    accentColor: 0xd0c8bc,
    eyeHeight: 1.05,
  },
  {
    id: 'chicken',
    name: '鸡',
    health: 4,
    width: 0.4,
    height: 0.7,
    speed: 1.1,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [
      { itemId: Item.CHICKEN, min: 1, max: 1 },
      { itemId: Item.FEATHER, min: 0, max: 2 },
    ],
    bodyColor: 0xf2f2ee,
    accentColor: 0xd94f2b,
    eyeHeight: 0.6,
  },
];

const BY_ID = new Map<string, MobType>(MOB_TYPES.map((type) => [type.id, type]));

export function mobTypeById(id: string): MobType | undefined {
  return BY_ID.get(id);
}

/**
 * 联机时其它玩家的外观（K2）。
 *
 * 故意**不放进 `MOB_TYPES`**：那样会被 `PASSIVE_MOBS` 收录、进而被自然刷出来。
 * 远程玩家只是"借渲染器的模型用一下"，位置完全由网络消息驱动，不参与 AI 与物理。
 */
export const REMOTE_PLAYER_TYPE: MobType = {
  id: 'remote_player',
  name: '玩家',
  health: 20,
  width: 0.6,
  height: 1.8,
  speed: 0,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  bodyColor: 0x3f7ad6,
  accentColor: 0xe2b48c,
  eyeHeight: 1.62,
};

/** 敌对生物（生成与战斗判定用） */
export const HOSTILE_MOBS: readonly MobType[] = MOB_TYPES.filter((type) => type.hostile);
/** 被动生物 */
export const PASSIVE_MOBS: readonly MobType[] = MOB_TYPES.filter((type) => !type.hostile);
