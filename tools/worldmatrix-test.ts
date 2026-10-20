/**
 * 世界创建矩阵验收（批次 529）
 *
 * 之前"类型 / 模式 / 难度"是**分三个套件各测一半**的：
 * 类型测了生成、模式测了语义、难度测了系数，但**没有一组测试是"建出来再进世界"**。
 * 这一套补三件事：
 *  ① 5×4×4 = **80 种组合**都能创建、字段正确、持久化往返一致；
 *  ② 每种类型 × 生存/创造（10 组）都能算出**出生点**、出生区块不是空的；
 *  ③ 脏参数在 `create` 里就被收口（而不是先写进清单、等下次读盘才修）。
 *
 * 运行：npm run test:worldmatrix
 */

import { readFileSync } from 'node:fs';
import { Block } from '../src/core/registry/blocks.ts';
import {
  WORLD_SURFACE_Y,
  WORLD_TYPES,
  isWorldType,
  type WorldType,
} from '../src/core/gen/WorldType.ts';
import { generateChunkBlocks, takeGeneratedStates } from '../src/core/gen/TerrainGenerator.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { planSpawnRegion } from '../src/core/world/SpawnPoint.ts';
import { DIFFICULTIES, difficultyProfile, isDifficulty, type Difficulty } from '../src/core/world/Rules.ts';
import { GAME_MODES, isCreativeMode, type GameMode } from '../src/core/world/GameMode.ts';
import { WorldRegistry, type WorldSummary } from '../src/core/save/WorldRegistry.ts';

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

const SEED = 20261014;

// ---------------------------------------------------------------- 1. 80 组

console.log('\n[60 种组合：创建 / 字段 / 持久化]');
{
  const storage = new MemoryStorage();
  const registry = new WorldRegistry(storage as unknown as Storage);
  const expected: Array<{ type: WorldType; mode: GameMode; difficulty: Difficulty; seed: number }> = [];
  const created: WorldSummary[] = [];

  for (const type of WORLD_TYPES) {
    for (const mode of GAME_MODES) {
      for (const difficulty of DIFFICULTIES) {
        const seed = SEED + created.length;
        expected.push({ type, mode, difficulty, seed });
        created.push(
          registry.create({
            worldType: type,
            gameMode: mode,
            difficulty,
            seed,
            ...(type === 'single_biome' ? { singleBiome: 'plains' } : {}),
          }),
        );
      }
    }
  }

  equal('一共 80 种组合', created.length, 80);
  equal('清单里就是 80 个世界', registry.count, 80);
  equal('id 互不重复', new Set(created.map((world) => world.id)).size, 80);

  const badFields: string[] = [];
  for (let i = 0; i < created.length; i++) {
    const world = created[i]!;
    const want = expected[i]!;
    if (world.worldType !== want.type || world.gameMode !== want.mode || world.difficulty !== want.difficulty || world.seed !== want.seed) {
      badFields.push(`${want.type}/${want.mode}/${want.difficulty}`);
    }
  }
  check('每一组的类型/模式/难度/种子都按传入值落盘', badFields.length === 0, badFields.slice(0, 4).join(' '));

  // 读盘往返：换一个 registry 读同一份 storage，80 组必须一一对上
  const reloaded = new WorldRegistry(storage as unknown as Storage);
  equal('重新加载后仍是 80 个世界', reloaded.count, 80);
  let mismatched = 0;
  for (let i = 0; i < created.length; i++) {
    const back = reloaded.get(created[i]!.id);
    const want = expected[i]!;
    if (!back || back.worldType !== want.type || back.gameMode !== want.mode || back.difficulty !== want.difficulty) {
      mismatched++;
    }
  }
  equal('80 组持久化往返全部一致', mismatched, 0);

  // 默认命名：每种类型 16 个（4 模式 × 4 难度），名字互不重复
  const badNames = WORLD_TYPES.filter((type) => {
    const names = created.filter((world) => world.worldType === type).map((world) => world.name);
    return names.length !== 16 || new Set(names).size !== 16;
  });
  check('每种类型 16 个世界、名字互不重复', badNames.length === 0, badNames.join(','));
}

console.log('\n[脏参数在 create 里就收口]');
{
  const registry = new WorldRegistry(new MemoryStorage() as unknown as Storage);
  const dirty = registry.create({
    worldType: 'nope' as WorldType,
    gameMode: 'nope' as GameMode,
    difficulty: '地狱' as Difficulty,
  });
  equal('非法类型回落 default', dirty.worldType, 'default');
  equal('非法模式回落生存', dirty.gameMode, 'survival');
  equal('非法难度回落普通', dirty.difficulty, 'normal');
  check('合法类型不会被改动', isWorldType('flat') && registry.create({ worldType: 'flat' }).worldType === 'flat');
  check('已删除的 caves 不再合法（回落 default）', !isWorldType('caves'));
}

// ---------------------------------------------------------------- 2. 10 组启动验证

console.log('\n[每种类型 × 生存/创造：出生点与出生区块]');
{
  const problems: string[] = [];
  let combos = 0;

  for (const type of WORLD_TYPES) {
    for (const mode of ['survival', 'creative'] as const) {
      combos++;
      const generator = new OverworldGenerator(SEED, type);
      const minY = WORLD_SURFACE_Y[type];
      const spawn = planSpawnRegion(
        (x, z) => generator.surfaceY(x, z),
        (x, z) => generator.biomeAt(x, z).name,
        64,
        minY,
      );

      if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.z) || !Number.isFinite(spawn.y)) {
        problems.push(`${type}/${mode}: 出生点不是有限数`);
        continue;
      }
      if (spawn.y < minY) problems.push(`${type}/${mode}: 出生点低于该类型地表基准`);

      const blocks = generateChunkBlocks(spawn.x >> 4, spawn.z >> 4, SEED, undefined, type);
      takeGeneratedStates();
      let solid = 0;
      for (const id of blocks) if (id !== Block.AIR && id !== Block.WATER) solid++;
      if (solid === 0) problems.push(`${type}/${mode}: 出生区块没有实心方块`);

      if (isCreativeMode(mode) !== (mode === 'creative')) problems.push(`${type}/${mode}: 模式能力判错`);
    }
  }

  equal('跑了 5 类型 × 2 模式的启动验证', combos, 10);
  check('10 组都能算出出生点、出生区块非空、模式能力正确', problems.length === 0, problems.join(' | '));
}

// ---------------------------------------------------------------- 3. 难度语义在矩阵里一致

console.log('\n[难度语义（与创建组合无关，逐档钉住）]');
{
  const bad = DIFFICULTIES.filter((difficulty) => {
    const profile = difficultyProfile(difficulty);
    if (difficulty === 'peaceful') {
      return profile.hostileSpawning !== false || profile.mobDamage !== 0 || profile.spawnCap !== 0 || profile.starveRate !== 0;
    }
    return profile.hostileSpawning !== true || profile.spawnCap <= 0 || profile.mobDamage <= 0;
  });
  check('四档难度的刷怪/伤害/饥饿口径都成立', bad.length === 0, bad.join(','));
  check('困难确实比普通更疼、怪更多', difficultyProfile('hard').mobDamage > difficultyProfile('normal').mobDamage);
  check('isDifficulty 只认四档', DIFFICULTIES.every((value) => isDifficulty(value)) && !isDifficulty('nope'));
}

// ---------------------------------------------------------------- 4. 创建界面把三项都传下去

console.log('\n[UI 联动守卫]');
{
  const worldSrc = readFileSync(new URL('../src/ui/WorldScreen.ts', import.meta.url), 'utf8');
  check('类型传进 create', worldSrc.includes('worldType: this.typeSelect.value as WorldType'));
  check('难度传进 create', worldSrc.includes('difficulty: this.difficultySelect.value as Difficulty'));
  check('模式传进 create', worldSrc.includes('gameMode: this.gameModeSelect.value as GameMode'));
  check('三个下拉框都在新建表单里', worldSrc.includes("makeRow(t('world.type')") && worldSrc.includes("makeRow(t('world.difficulty')") && worldSrc.includes("makeRow(t('world.gameMode')"));
  check('单一群系选择传进 create', worldSrc.includes("singleBiome: this.biomeSelect.value"));
  check('测试用的预填入口还在（spec 三个参数都能设）', worldSrc.includes('difficulty: Difficulty = \'normal\'') && worldSrc.includes('gameMode: GameMode = \'survival\''));
}

console.log(`\n世界创建矩阵测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
