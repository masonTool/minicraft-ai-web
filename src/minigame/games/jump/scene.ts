/**
 * 跳一跳的**画面占位**（J0，批次 20261022-2220）
 *
 * ⚠️ 这一版只验证"能进、能渲染、能退出"：一块草方块 + 玩家方块人 + 一句提示。
 * 真正的柱子排列 / 相机跟随 / 蓄力动画在 J1、J2 里替换本文件。
 *
 * 之所以先放占位而不是等 J1 一次写完：J0 的门槛是"菜单能进能退"，
 * 这一步同时验证了后面一定会用到的三件事——
 *  1. 主菜单路径自建的 renderer 能渲染 `BlockScene`（图集 UV 映射正常）；
 *  2. `PlayerRenderer` 能脱离主世界单独放在小游戏场景里（含亮度采样）；
 *  3. `unmount` 把两者都释放干净（验收比对 `renderer.info.memory`）。
 */

import { t } from '../../../core/i18n/I18n.ts';
import { Block } from '../../../core/registry/blocks.ts';
import { PlayerRenderer } from '../../../render/PlayerRenderer.ts';
import { BlockScene } from '../../BlockScene.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../../types.ts';

/** 方块顶面高度（人物脚底站这里） */
const STAND_Y = 1;
/** 相机在 +X+Z 方向：让小人正脸朝相机 */
const FACING_YAW = -Math.PI * 0.75;

export class JumpGame implements MiniGame {
  readonly id = 'jump' as const;
  readonly titleKey = 'minigame.jump.title';

  status: MiniGameStatus = 'playing';

  private context: MiniGameContext | null = null;
  private blocks: BlockScene | null = null;
  private player: PlayerRenderer | null = null;
  private hud: HTMLDivElement | null = null;

  mount(context: MiniGameContext): void {
    this.context = context;

    const blocks = new BlockScene({
      atlas: context.atlas,
      center: { x: 0, y: 0, z: 0 },
      size: 3,
    });
    blocks.setBlocks([{ x: 0, y: 0, z: 0, blockId: Block.GRASS_BLOCK }]);
    blocks.setViewport(window.innerWidth, window.innerHeight);
    this.blocks = blocks;

    // 第二个参数是"天光亮度"（与 `PlayerPreview3D` 同一用法）：固定 1 = 全亮，
    // 小游戏里不走世界光照；逐帧的光照采样在 `update(pose, sampleLight)` 里另给。
    const player = new PlayerRenderer(blocks.scene, () => 1);
    player.setVisible(true);
    this.player = player;

    const hud = document.createElement('div');
    hud.className = 'jump-hud';
    const hint = document.createElement('div');
    hint.className = 'jump-hint';
    hint.textContent = t('minigame.jump.placeholder');
    hud.appendChild(hint);
    context.layer.appendChild(hud);
    this.hud = hud;
  }

  unmount(): void {
    this.player?.dispose();
    this.player = null;
    this.blocks?.dispose();
    this.blocks = null;
    this.hud?.remove();
    this.hud = null;
    this.context = null;
  }

  update(_dt: number): void {
    const blocks = this.blocks;
    const player = this.player;
    const context = this.context;
    if (!blocks || !player || !context) return;

    player.update(
      {
        x: 0,
        y: STAND_Y,
        z: 0,
        yaw: FACING_YAW,
        pitch: 0,
        walkPhase: 0,
        walkAmount: 0,
        swing: 0,
        flying: false,
      },
      () => null,
    );
    blocks.render(context.renderer);
  }

  onPointer(_pointer: MiniGamePointer): void {
    // J2 才接蓄力与起跳
  }
}
