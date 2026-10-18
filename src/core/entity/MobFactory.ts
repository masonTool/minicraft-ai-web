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
import { Ghast } from './Ghast.ts';
import { Horse } from './Horse.ts';
import { Mob, type MobType } from './Mob.ts';
import { Phantom, PHANTOM_TYPE } from './Phantom.ts';
import { Villager } from './Villager.ts';
import { Wither, WITHER_TYPE } from './Wither.ts';
import { BLAZE_TYPE, GHAST_TYPE, VILLAGER_TYPE } from './mobs.ts';

export function createMob(type: MobType, x: number, y: number, z: number): Mob {
  if (type.id === VILLAGER_TYPE.id) return new Villager(x, y, z);
  // 烈焰人（批次 92）：它有自己的招数（吐火球），所以也是一个子类——
  // 与村民同一个理由：`new Mob(BLAZE_TYPE, …)` 会造出一只"只会撞人"的烈焰人，
  // 而且看起来一切正常（贴图、名字、掉落都对），只有打起来才发现它不吐火
  if (type.id === BLAZE_TYPE.id) return new Blaze(x, y, z);
  // 恶魂（批次 94）：同样有自己的一套（保持距离 + 大火球）
  if (type.id === GHAST_TYPE.id) return new Ghast(x, y, z);
  // 凋灵（批次 116）：boss，整体覆盖 tick（飞行 + 三阶段 + 吐骷髅头）。
  // ⚠️ 写在**这一个**工厂里而不是"召唤处自己 new"：与村民/烈焰人同一条理由——
  // 将来别的地方（命令、刷怪蛋、测试）要生成它时，不能各写一句 `new Mob(WITHER_TYPE)`
  // （那样会造出一只"只会悬停、什么都不吐"的凋灵，而它看起来一切正常）
  if (type.id === WITHER_TYPE.id) return new Wither(x, y, z);
  // 幻翼（批次 126）：它的招牌是"盘旋之后一头扎下来"，所以也是一个子类
  // （与烈焰人/恶魂同一条理由：`new Mob(PHANTOM_TYPE, …)` 会造出一只只会平移的鸟）
  if (type.id === PHANTOM_TYPE.id) return new Phantom(x, y, z);
  // 骑乘系（批次 253）：马/驴/骡/羊驼都是 `Horse`（多一个 `passenger` 与骑乘 AI）。
  // 与村民同一个理由：`new Mob(HORSE_TYPE, …)` 会造出一匹"能喂能驯、但骑不上去"的马。
  if (type.id === 'horse' || type.id === 'donkey' || type.id === 'mule' || type.id === 'llama') {
    return new Horse(type, x, y, z);
  }
  return new Mob(type, x, y, z);
}
