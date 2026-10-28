/**
 * 生物开门（J3 尾巴，批次 516）
 *
 * 关着的门在方块表里是实心的，A* 会把它当墙——所以"会开门"要同时做两件事：
 *  ① 寻路时把它当**可走格**（`PathOptions.isDoor`）；
 *  ② 走到门前真的推开（`EntityContext.openDoor`）。
 *
 * 这里断言纯逻辑那一半（谁开门、寻路是否放行），再加三条源码守卫。
 *
 * 运行：npm run test:doors
 */

import { readFileSync } from 'node:fs';
import { Block } from '../web/src/core/registry/blocks.ts';
import { Pathfinder } from '../web/src/core/entity/Pathfinder.ts';
import { opensDoors } from '../web/src/core/entity/DoorRules.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

console.log('\n[谁会开门]');
{
  const openers = ['villager', 'pillager', 'vindicator', 'evoker', 'illusioner', 'witch'];
  const others = ['zombie', 'husk', 'skeleton', 'creeper', 'piglin', 'sheep', 'cow', 'iron_golem', 'snow_golem', 'wolf'];
  check('村民与灾厄村民会开门', openers.every((id) => opensDoors(id)), openers.filter((id) => !opensDoors(id)).join(','));
  check('僵尸/骷髅/苦力怕/猪灵/动物/傀儡都不会', others.every((id) => !opensDoors(id)), others.filter((id) => opensDoors(id)).join(','));
}

console.log('\n[寻路：关着的门算可走]');
{
  const FLOOR = 64;
  // 一条 13×9 的走廊，x=4 处横着一堵墙，只有 z=0 是一扇关着的门
  const world = {
    getBlock(x: number, y: number, z: number): number {
      if (x < 0 || x > 12 || z < -4 || z > 4) return Block.STONE;
      if (y <= FLOOR) return Block.STONE;
      if (y === 65 || y === 66) {
        if (x !== 4) return Block.AIR;
        return z === 0 ? Block.OAK_DOOR : Block.STONE;
      }
      return Block.AIR;
    },
  };
  const isDoor = (x: number, y: number, z: number): boolean =>
    x === 4 && z === 0 && (y === 65 || y === 66);

  const pf = new Pathfinder(world);
  const blocked = pf.find(0.5, FLOOR + 1, 0.5, 8.5, FLOOR + 1, 0.5, { heightBlocks: 2 });
  check('不传 isDoor：门当墙，走不过去', blocked === null);

  const through = pf.find(0.5, FLOOR + 1, 0.5, 8.5, FLOOR + 1, 0.5, {
    heightBlocks: 2,
    isDoor,
  });
  check('传了 isDoor：能从门里穿过去', through !== null && through.length > 0);
  check(
    '路径确实经过那扇门',
    through !== null && through.some((point) => point.x === 4 && point.z === 0),
  );

  const wallAtZ1 = (x: number, y: number, z: number): boolean => isDoor(x, y, z) && z === 0;
  check('isDoor 只对那一格生效（其它墙体仍然挡路）', wallAtZ1(4, 65, 1) === false);
}

console.log('\n[站立判定把门当可通行]');
{
  const FLOOR = 64;
  const world = {
    getBlock(x: number, y: number, z: number): number {
      if (y <= FLOOR) return Block.STONE;
      if (x === 4 && (y === 65 || y === 66) && z === 0) return Block.OAK_DOOR;
      return Block.AIR;
    },
  };
  const pf = new Pathfinder(world);
  check('门那一格：不传 isDoor 站不进去', !pf.canStandAt(4, 65, 0, 2));
  check('门那一格：传了 isDoor 可以站', pf.canStandAt(4, 65, 0, 2, (x, y, z) => x === 4 && z === 0 && y >= 65));
}

console.log('\n[接线守卫]');
{
  const mobSrc = readFileSync(new URL('../web/src/core/entity/Mob.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  const ctxSrc = readFileSync(new URL('../web/src/core/entity/Entity.ts', import.meta.url), 'utf8');

  check('寻路时按"会不会开门"决定传不传 isDoor', mobSrc.includes('isDoor: opensDoors(this.type.id) ? ctx.isClosedDoor : undefined'));
  check('贴合时真的去开门', mobSrc.includes('this.openDoorsAhead(ctx)') && mobSrc.includes('ctx.isClosedDoor?.(node.x, node.y, node.z)'));
  check('实体上下文有门判定与开门回调', ctxSrc.includes('isClosedDoor?:') && ctxSrc.includes('openDoor?:'));
  check('主程序把回调接上了', mainSrc.includes('isClosedDoor: (x, y, z) => this.isClosedDoorAt(x, y, z)'));
  check('开门复用 toggleDoor（上下半与音效一处处理）', mainSrc.includes('if (this.isClosedDoorAt(x, y, z)) this.toggleDoor(x, y, z);'));
}

console.log(`\n生物开门测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
