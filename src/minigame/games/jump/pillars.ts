/**
 * 柱子的**纯逻辑分组**（J1，批次 20261022-2220）
 *
 * `InstancedMesh` 的每个实例共享同一份几何体与材质，所以"不同面用不同贴图"
 * 只能靠**按 tile 组合分组**：一组 = 一个 `InstancedMesh`（几何体的 UV 固定死）。
 * 一局里正常只有 1~2 组（主题柱 + 特殊方块），draw call 也就 1~2 个。
 *
 * 单独一个文件、不 import three：分组这一步可以在 node 里直接断言
 * （"草方块和音符盒必须分成两组"这种规则，用截图验太贵了）。
 */

import type { JumpBlockKind } from './logic.ts';
import type { JumpTheme } from './themes.ts';

/** 一根柱子：中心坐标 + 边长 + 种类 */
export interface PillarSpec {
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly kind: JumpBlockKind;
  /** 是不是"当前站着的"那根（蓄力时它会被压扁） */
  readonly current: boolean;
}

/** 一个方块三个部位用哪张图集贴图 */
export interface PillarTiles {
  readonly top: string;
  readonly side: string;
  readonly bottom: string;
}

export interface PillarGroup extends PillarTiles {
  readonly specs: readonly PillarSpec[];
}

/** 特殊方块用的贴图（都在主世界图集里，不新增素材） */
export const SPECIAL_TILES: Readonly<Record<Exclude<JumpBlockKind, 'normal'>, string>> = {
  music: 'note_block',
  cube: 'wool_light_blue',
};

/** 这一根柱子用哪三张贴图（普通方块跟主题走） */
export function tilesOfPillar(kind: JumpBlockKind, theme: JumpTheme): PillarTiles {
  if (kind === 'normal') {
    return { top: theme.top, side: theme.side, bottom: theme.bottom };
  }
  const tile = SPECIAL_TILES[kind];
  return { top: tile, side: tile, bottom: tile };
}

/**
 * 按"三张贴图的组合"分组，顺序按**首次出现**（便于断言与稳定渲染）。
 *
 * ⚠️ 坐标不做去重：同一格放两次是调用方的问题，照单全收。
 */
export function groupPillars(pillars: readonly PillarSpec[], theme: JumpTheme): PillarGroup[] {
  const byKey = new Map<string, { top: string; side: string; bottom: string; specs: PillarSpec[] }>();

  for (const pillar of pillars) {
    const tiles = tilesOfPillar(pillar.kind, theme);
    const key = `${tiles.top}|${tiles.side}|${tiles.bottom}`;
    let group = byKey.get(key);
    if (!group) {
      group = { ...tiles, specs: [] };
      byKey.set(key, group);
    }
    group.specs.push(pillar);
  }

  return [...byKey.values()];
}

/** 分组后的实例总数（应等于输入数量） */
export function pillarInstanceCount(groups: readonly PillarGroup[]): number {
  return groups.reduce((sum, group) => sum + group.specs.length, 0);
}
