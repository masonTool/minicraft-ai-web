/**
 * 游戏模式（批次 181）离线测试
 *
 * 运行：npm run test:mode
 *
 * 为什么值得单开一套：模式从"飞行状态"里拆出来之后，**能力判断**全看它
 *（免伤、瞬间破坏、不掉耐久、创造物品栏、中键拾取）。判错一格不会报错，
 * 只会表现成"生存里能瞬间挖穿"或"创造里掉血"这种隐蔽 bug。
 */

import {
  GAME_MODES,
  gameModeLabel,
  isCreativeMode,
  isGameMode,
  nextGameMode,
  normalizeGameMode,
  startsFlying,
  canFly,
  canPickUpItems,
  canTakeDamage,
} from '../web/src/core/world/GameMode.ts';
import { WorldRegistry } from '../web/src/core/save/WorldRegistry.ts';

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

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/** 一个只存在内存里的 Storage，清单测试不必碰 localStorage */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

console.log('\n[一、模式取值]');

{
  // 批次 491：加了旁观（M22）
  equal('四种模式（生存 / 创造 / 冒险 / 旁观）', GAME_MODES.join(','), 'survival,creative,adventure,spectator');
  check('都有中文名', GAME_MODES.every((mode) => gameModeLabel(mode).length > 0));
  check('survival 合法', isGameMode('survival'));
  check('creative 合法', isGameMode('creative'));
  check('spectator 合法', isGameMode('spectator'));
  check('adventure 合法', isGameMode('adventure'));
  check('别的一律不合法', !isGameMode('nope') && !isGameMode(1) && !isGameMode(null));
  equal('非法值回落到生存', normalizeGameMode('nope'), 'survival');
  equal('非法值可以指定回落', normalizeGameMode(undefined, 'creative'), 'creative');
  equal('合法值原样保留', normalizeGameMode('creative'), 'creative');
  equal('生存点一下变创造', nextGameMode('survival'), 'creative');
  equal('创造点一下变冒险', nextGameMode('creative'), 'adventure');
  equal('冒险点一下变旁观', nextGameMode('adventure'), 'spectator');
  equal('旁观点一下回到生存（四态循环）', nextGameMode('spectator'), 'survival');
  check('创造是能力口径', isCreativeMode('creative') && !isCreativeMode('survival'));
  check('旁观进入世界时默认在飞（否则会穿地）', startsFlying('spectator'));
  check('创造进入世界时从地面开始（不默认飞）', !startsFlying('creative'));
  check('生存不默认飞', !startsFlying('survival'));
  check('旁观允许飞行', canFly('spectator'));
  check('旁观者免伤', !canTakeDamage('spectator'));
  check('旁观者不能捡东西', !canPickUpItems('spectator'));
  check('创造可以捡东西', canPickUpItems('creative'));
  check('生存可以捡东西、会受伤', canPickUpItems('survival') && canTakeDamage('survival'));
}

console.log('\n[二、世界清单]');

{
  const storage = new MemoryStorage();
  const registry = new WorldRegistry(storage as unknown as Storage);
  const world = registry.create({ name: '测试世界', seed: 42 });
  equal('新建世界默认生存', world.gameMode, 'survival');
  equal('新建世界能指定创造', registry.create({ name: '创造世界', gameMode: 'creative' }).gameMode, 'creative');
  equal('清单里有两条', registry.count, 2);

  registry.update(world.id, { gameMode: 'creative' });
  equal('改模式能回写清单', registry.get(world.id)?.gameMode, 'creative');

  // 重新读一遍：落盘之后仍然是创造
  const reloaded = new WorldRegistry(storage as unknown as Storage);
  equal('模式随清单持久化', reloaded.get(world.id)?.gameMode, 'creative');
}

{
  // 老清单没有 gameMode：读进来要回落成生存，而不是 undefined
  const storage = new MemoryStorage();
  storage.setItem(
    'bedrock-worlds',
    JSON.stringify([
      {
        id: 'old',
        name: '老世界',
        seed: 7,
        worldType: 'default',
        difficulty: 'normal',
        createdAt: 1,
        lastPlayed: 1,
        playTime: 0,
        edits: 0,
      },
    ]),
  );
  const registry = new WorldRegistry(storage as unknown as Storage);
  equal('老清单没有 gameMode → 生存', registry.get('old')?.gameMode, 'survival');
}

{
  // 脏数据不能把整个列表带崩
  const storage = new MemoryStorage();
  storage.setItem(
    'bedrock-worlds',
    JSON.stringify([
      {
        id: 'dirty',
        name: '脏世界',
        seed: 8,
        worldType: 'default',
        difficulty: 'normal',
        gameMode: 'nope',
        createdAt: 1,
        lastPlayed: 1,
        playTime: 0,
        edits: 0,
      },
    ]),
  );
  const registry = new WorldRegistry(storage as unknown as Storage);
  equal('非法模式回落成生存', registry.get('dirty')?.gameMode, 'survival');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
