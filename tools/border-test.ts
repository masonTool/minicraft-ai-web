/**
 * 世界边界离线测试（K12，批次 175）
 *
 * 边界这件事能离线钉住的比想象的多：夹取、越界距离、伤害曲线、读档容错都是纯函数，
 * 命令层也是纯解析。真正要靠眼睛的只有"那四道蓝墙看着对不对"。
 *
 * 运行：npm run test:border
 */

import {
  BORDER_MAX_SIZE,
  BORDER_MIN_SIZE,
  BORDER_SOFT_ZONE,
  DEFAULT_BORDER_SIZE,
  borderBlocksMovement,
  borderCorners,
  borderDamagePerSecond,
  borderHalf,
  borderOvershoot,
  clampBorderSize,
  clampToBorder,
  defaultBorder,
  describeBorder,
  normalizeBorder,
  type WorldBorder,
} from '../src/core/world/WorldBorder.ts';
import { executeCommand, type CommandContext } from '../src/core/commands/Commands.ts';
import type { CommandEntity } from '../src/core/commands/Selectors.ts';
import { DEFAULT_GAME_RULES, type GameRules } from '../src/core/world/Rules.ts';
import { BorderRenderer } from '../src/render/BorderRenderer.ts';

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

function near(label: string, actual: number, expected: number, epsilon = 1e-6): void {
  check(label, Math.abs(actual - expected) <= epsilon, `${actual} vs ${expected}`);
}

function border(size: number, centerX = 0, centerZ = 0): WorldBorder {
  return { centerX, centerZ, size };
}

// ---------------------------------------------------------------- 1. 基本形状

console.log('\n[边界：默认值 / 夹取 / 读档容错]');
{
  const base = defaultBorder();
  equal('默认边长就是原版那个 3 千万', base.size, DEFAULT_BORDER_SIZE);
  equal('默认中心在原点', base.centerX, 0);
  equal('半边长 = 边长的一半', borderHalf(base), DEFAULT_BORDER_SIZE / 2);

  equal('边长 0 → 夹到最小 1', clampBorderSize(0), BORDER_MIN_SIZE);
  equal('负数 → 夹到最小 1', clampBorderSize(-500), BORDER_MIN_SIZE);
  equal('超上限 → 夹到最大', clampBorderSize(1e12), BORDER_MAX_SIZE);
  equal('小数向下取整', clampBorderSize(100.9), 100);
  equal('NaN → 回退默认', clampBorderSize(Number.NaN), DEFAULT_BORDER_SIZE);

  const dirty = normalizeBorder({ centerX: 'abc', centerZ: 12.7, size: -3 });
  equal('脏中心回退到 0', dirty.centerX, 0);
  equal('中心取整', dirty.centerZ, 12);
  equal('脏边长夹到最小', dirty.size, BORDER_MIN_SIZE);
  const missing = normalizeBorder(null);
  equal('完全没字段 → 默认边界（老存档不迁移）', missing.size, DEFAULT_BORDER_SIZE);
}

// ---------------------------------------------------------------- 2. 越界与伤害

console.log('\n[越界距离 / 伤害曲线 / 硬墙]');
{
  const b = border(100); // 边缘 ±50
  equal('正中心不算越界', borderOvershoot(b, 0, 0), 0);
  equal('贴着边缘也不算越界', borderOvershoot(b, 50, 0), 0);
  near('出去 3 格就是 3', borderOvershoot(b, 53, 0), 3);
  near('角外侧取两个方向里更大的那个', borderOvershoot(b, 53, -58), 8);
  near('负数那一侧同样算', borderOvershoot(b, -61, 0), 11);

  equal('在边界内不掉血', borderDamagePerSecond(b, 0, 0), 0);
  equal('刚越界：1 点/秒', borderDamagePerSecond(b, 50.5, 0), 1);
  equal('越界 4 格：还是 1 点/秒', borderDamagePerSecond(b, 54, 0), 1);
  // `1 + floor(d/5)`：d 每满 5 格抬一档，所以 d=5 就已经是第 2 档了
  equal('越界 5 格：2 点/秒', borderDamagePerSecond(b, 55, 0), 2);
  equal('越界 10 格：3 点/秒', borderDamagePerSecond(b, 60, 0), 3);
  equal('越界 100 格：21 点/秒（够疼）', borderDamagePerSecond(b, 150, 0), 21);

  check('软区之内不挡路', !borderBlocksMovement(b, 54, 0));
  check('越过软区就挡（软区 = 5 格）', borderBlocksMovement(b, 50 + BORDER_SOFT_ZONE + 0.5, 0));

  const inside = clampToBorder(b, 10, 10);
  check('边界内原样不动', !inside.clamped && inside.x === 10 && inside.z === 10);
  const outside = clampToBorder(b, 80, 0);
  check('越界被拉回到软区里侧', outside.clamped && outside.x < 50 + BORDER_SOFT_ZONE + 1e-3);
  check('拉回之后仍在软区那一道线之内', outside.x <= 55);
  const corner = clampToBorder(b, 80, -80);
  check('角外侧两个方向都被夹住', corner.clamped && corner.x <= 55 && corner.z >= -55);

  const moved = border(200, 100, -100);
  const corners = borderCorners(moved);
  equal('四角跟着中心走（minX）', corners.minX, 0);
  equal('四角跟着中心走（maxZ）', corners.maxZ, 0);

  check('描述里带上边长与中心', describeBorder(b).includes('100') && describeBorder(b).includes('(0, 0)'));
}

// ---------------------------------------------------------------- 3. 命令

console.log('\n[/worldborder：get / set / center]');
{
  class FakeWorld implements CommandContext {
    border: WorldBorder = defaultBorder();
    infos: string[] = [];
    errors: string[] = [];
    playerName(): string {
      return '玩家';
    }
    position() {
      return { x: 0, y: 64, z: 0, dimension: 'overworld' };
    }
    teleport(): boolean {
      return true;
    }
    setPersonalSpawn(): void {}
    setWorldSpawn(): void {}
    enchantHeld(): boolean {
      return false;
    }
    playSound(): boolean {
      return false;
    }
    spawnParticle(): boolean {
      return false;
    }
    give(): number {
      return 0;
    }
    clearInventory(): number {
      return 0;
    }
    setFlying(): void {}
    isFlying(): boolean {
      return false;
    }
    setCreative(): void {}
    isCreative(): boolean {
      return true;
    }
    killPlayer(): void {}
    seed(): number {
      return 1;
    }
    getBlock(): number {
      return 0;
    }
    setBlock(): boolean {
      return true;
    }
    fillBlocks(): number {
      return 0;
    }
    setTimeOfDay(): void {}
    timeOfDay(): number {
      return 0;
    }
    setWeather(): void {}
    difficulty() {
      return 'normal' as const;
    }
    setDifficulty(): void {}
    gameRules(): GameRules {
      return { ...DEFAULT_GAME_RULES };
    }
    setGameRule<K extends keyof GameRules>(_key: K, _value: GameRules[K]): void {}
    worldBorder(): WorldBorder {
      return { ...this.border };
    }
    setWorldBorder(patch: Partial<WorldBorder>): WorldBorder {
      this.border = normalizeBorder({ ...this.border, ...patch });
      return { ...this.border };
    }
    summon(): boolean {
      return true;
    }
    killNearby(): number {
      return 0;
    }
    applyEffect(): boolean {
      return true;
    }
    clearEffects(): void {}
    addXp(): number {
      return 0;
    }
    setXpLevel(): void {}
    xpState() {
      return { level: 0, progress: 0, toNext: 0, total: 0 };
    }
    onlinePlayers(): string[] {
      return [];
    }
    /** 选择器快照（批次 399）：这一套只测边界，没有实体 */
    entities(): readonly CommandEntity[] {
      return [];
    }
  }

  const run = (args: string): { world: FakeWorld; info: string; error: string } => {
    const world = new FakeWorld();
    const infos: string[] = [];
    const errors: string[] = [];
    executeCommand(args, world, { info: (t) => infos.push(t), error: (t) => errors.push(t) });
    return { world, info: infos.join('\n'), error: errors.join('\n') };
  };

  const get = run('/worldborder get');
  check('get 报出边长', get.info.includes(String(DEFAULT_BORDER_SIZE)), get.info);

  const set = run('/worldborder set 128');
  equal('set 改边长', set.world.border.size, 128);
  check('set 的反馈里带上边长', set.info.includes('128'), set.info);

  const tooSmall = run('/worldborder set 0');
  check('set 0 被拒（边长至少 1）', tooSmall.error.includes('边长必须'), tooSmall.error);
  equal('被拒时状态没变', tooSmall.world.border.size, DEFAULT_BORDER_SIZE);

  const center = run('/worldborder center 120 -80');
  equal('center 改 X', center.world.border.centerX, 120);
  equal('center 改 Z', center.world.border.centerZ, -80);
  equal('center 不动边长', center.world.border.size, DEFAULT_BORDER_SIZE);

  const badCenter = run('/worldborder center abc 1');
  check('脏坐标被拒', badCenter.error.includes('用法'), badCenter.error);

  const noArgs = run('/worldborder');
  check('不给子命令 = get', noArgs.info.includes('边长'), noArgs.info);

  const badMode = run('/worldborder rainbow');
  check('未知子命令给出用法', badMode.error.includes('用法'), badMode.error);
}

// ---------------------------------------------------------------- 4. 渲染

console.log('\n[蓝墙：不画"走不到的边界"、只画玩家附近那一段]');
{
  const renderer = new BorderRenderer();
  check('初始不可见（默认边界根本走不到）', renderer.group.visible === false);

  renderer.sync(defaultBorder(), { x: 0, y: 64, z: 0 }, 8);
  check('边长 3 千万时不画（省一个 draw call）', renderer.group.visible === false);

  const small = border(200, 0, 0);
  renderer.sync(small, { x: 0, y: 64, z: 0 }, 8);
  check('边界进得去视野时才画', renderer.group.visible === true);
  equal('四道墙', renderer.group.children.length, 4);

  const meshes = renderer.group.children as Array<{ position: { x: number; z: number }; scale: { x: number } }>;
  const zs = meshes.slice(0, 2).map((mesh) => mesh.position.z).sort((a, b) => a - b);
  equal('南北两道贴在两条边上', `${zs[0]},${zs[1]}`, '-100,100');
  check('墙长按视距放大（不会看到墙头断了）', meshes[0]!.scale.x >= 256);

  renderer.sync(small, { x: 60, y: 64, z: 0 }, 8);
  const shifted = renderer.group.children as Array<{ position: { x: number; z: number } }>;
  check('东西两道跟着玩家平移（只画附近那一段）', shifted[2]!.position.z === 0);

  let safe = true;
  try {
    renderer.dispose();
  } catch {
    safe = false;
  }
  check('dispose 不抛', safe);
}

console.log(`\n世界边界测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
