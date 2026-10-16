/**
 * 造生物的**唯一入口**（J11，批次 88）
 *
 * 在村民之前，"生成一只生物"就是 `new Mob(type, x, y, z)`，所以各处（自然生成、
 * 繁殖、调试生成、命令）都各自写着那一句。村民破了这个假设：它需要 `Villager`
 * 这个子类（多一份职业与交易状态），于是"各处各写一句 `new Mob`"会静默造出
 * **一批不会做生意的村民**——它们的贴图、名字、碰撞盒全对，只是点开没有交易界面，
 * 而且繁殖出来的小村民也一样是"白丁"。
 *
 * 所以收成一个函数：**谁要生成生物，都问它**。
 *
 * 为什么单独一个文件而不是写成 `Mob.create()` 之类的静态方法：`Mob.ts` 不能引
 * `Villager.ts`（后者要 `import { Mob }`），那会绕成一个环（本项目在药水那批踩过：
 * 环形 import 的表现是运行时某个常量变成 undefined，而不是编译错误）。
 */

import { Blaze } from './Blaze.ts';
import { Mob, type MobType } from './Mob.ts';
import { Villager } from './Villager.ts';
import { BLAZE_TYPE, VILLAGER_TYPE } from './mobs.ts';

export function createMob(type: MobType, x: number, y: number, z: number): Mob {
  if (type.id === VILLAGER_TYPE.id) return new Villager(x, y, z);
  // 烈焰人（批次 92）：它有自己的招数（吐火球），所以也是一个子类——
  // 与村民同一个理由：`new Mob(BLAZE_TYPE, …)` 会造出一只"只会撞人"的烈焰人，
  // 而且看起来一切正常（贴图、名字、掉落都对），只有打起来才发现它不吐火
  if (type.id === BLAZE_TYPE.id) return new Blaze(x, y, z);
  return new Mob(type, x, y, z);
}
