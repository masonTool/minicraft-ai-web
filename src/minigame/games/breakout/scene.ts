/**
 * 打砖块的**画面与输入**（小游戏5，批次 20261022-1954）
 *
 * 规则全在 `logic.ts`；这里把 2D 平面映射成斜俯视的方块场景：
 *   - 砖块用 `BlockScene`（方块贴图，与推箱子同一套）；
 *   - 挡板与球用两个独立的小 mesh——**位置是连续的**，不能塞进格子里
 *     （否则球会"一格一格跳"，手感立刻垮掉）。
 *
 * 四个刻意的做法：
 *
 *  1. **砖块只在变化时重建**：每帧算一个签名（数量 + 排序后的键），
 *     变了才 `setBlocks`——球每帧都在动，但砖块不会。
 *  2. **挡板两种输入共存**：触摸/鼠标直接跟随手指 x；键盘左右连续移动
 *     （`update` 里按 dt 累加，不是按帧跳格）。
 *  3. **`dt` 由 logic 自己夹**：这里只管把真实时间传进去，
 *     切后台回来一口气追帧的问题在 `advanceBreakout` 里已经处理。
 *  4. **过关/失败只提示**：不清屏、不跳关，玩家自己决定退出或重来。
 */

import * as THREE from 'three';
import { Block } from '../../../core/registry/blocks.ts';
import { t, tp } from '../../../core/i18n/I18n.ts';
import { BlockScene } from '../../BlockScene.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../../types.ts';
import {
  BALL_RADIUS,
  PADDLE_HALF_HEIGHT,
  PADDLE_HALF_WIDTH,
  PADDLE_Y,
  advanceBreakout,
  createBreakoutState,
  type BreakoutState,
} from './logic.ts';
import { BREAKOUT_LEVEL_COUNT, breakoutLevel, parseBreakoutLevel } from './levels.ts';

/** 键盘挡板速度（格/秒） */
const PADDLE_KEY_SPEED = 12;
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);

export interface BreakoutGameOptions {
  readonly onCleared?: (score: number) => void;
}

export class BreakoutGame implements MiniGame {
  readonly id = 'breakout' as const;
  readonly titleKey = 'minigame.breakout.title';

  status: MiniGameStatus = 'playing';

  private readonly levelIndex: number;
  private state: BreakoutState | null = null;
  private context: MiniGameContext | null = null;
  private scene: BlockScene | null = null;

  private paddleMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial> | null = null;
  private ballMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial> | null = null;

  private brickSignature = '';
  private hud: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private readonly keys = new Set<string>();
  private readonly listeners = new AbortController();

  constructor(
    levelIndex = 0,
    private readonly options: BreakoutGameOptions = {},
  ) {
    this.levelIndex = Number.isFinite(levelIndex)
      ? Math.max(0, Math.min(BREAKOUT_LEVEL_COUNT - 1, Math.floor(levelIndex)))
      : 0;
  }

  mount(context: MiniGameContext): void {
    this.context = context;

    const parsed = parseBreakoutLevel(breakoutLevel(this.levelIndex));
    if (!parsed.ok) {
      context.toast(t('minigame.breakout.brokenLevel'));
      context.exit();
      return;
    }
    this.state = createBreakoutState(parsed.level);

    const extent = Math.max(parsed.level.width, parsed.level.height + 4);
    this.scene = new BlockScene({
      atlas: context.atlas,
      // 砖块区在 y ≥ 0，挡板在 y = -1.2：把相机中心往下挪一点，让整块场地都在画面里
      center: { x: parsed.level.width / 2, y: 0, z: parsed.level.height / 2 - 1 },
      size: extent,
    });
    this.scene.setViewport(window.innerWidth, window.innerHeight);

    // 挡板与球：位置连续，所以用独立 mesh（不塞进格子里）
    const paddleGeometry = new THREE.BoxGeometry(PADDLE_HALF_WIDTH * 2, PADDLE_HALF_HEIGHT * 2, 0.6);
    this.paddleMesh = new THREE.Mesh(paddleGeometry, new THREE.MeshLambertMaterial({ color: 0x63b3ed }));
    this.scene.scene.add(this.paddleMesh);

    const ballGeometry = new THREE.BoxGeometry(BALL_RADIUS * 2, BALL_RADIUS * 2, BALL_RADIUS * 2);
    this.ballMesh = new THREE.Mesh(ballGeometry, new THREE.MeshLambertMaterial({ color: 0xffd75e }));
    this.scene.scene.add(this.ballMesh);

    this.buildHud(context);
    this.syncMeshes();
    this.rebuildBricks();
    this.updateHud();

    document.addEventListener('keydown', this.onKeyDown, { signal: this.listeners.signal });
    document.addEventListener('keyup', this.onKeyUp, { signal: this.listeners.signal });
  }

  unmount(): void {
    this.listeners.abort();
    this.keys.clear();

    for (const mesh of [this.paddleMesh, this.ballMesh]) {
      if (!mesh) continue;
      this.scene?.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.paddleMesh = null;
    this.ballMesh = null;

    this.scene?.dispose();
    this.scene = null;
    this.hud?.remove();
    this.hud = null;
    this.statusEl = null;
    this.context = null;
    this.state = null;
    this.brickSignature = '';
  }

  update(dt: number): void {
    const context = this.context;
    const scene = this.scene;
    const state = this.state;
    if (!context || !scene || !state) return;

    if (state.status === 'playing') {
      // 键盘：左右连续移动（按 dt 累加，不按帧跳）
      let direction = 0;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) direction -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) direction += 1;
      const paddleX = state.paddleX + direction * PADDLE_KEY_SPEED * Math.min(dt, 0.05);

      const advanced = advanceBreakout(state, dt, { paddleX });
      this.state = advanced;
      this.syncMeshes();
      this.rebuildBricks();
      this.updateHud();

      if (advanced.status === 'won' && this.status === 'playing') {
        this.status = 'won';
        context.toast(t('minigame.breakout.won'));
        this.options.onCleared?.(advanced.score);
      } else if (advanced.status === 'lost' && this.status === 'playing') {
        this.status = 'lost';
        context.toast(t('minigame.breakout.lost'));
      }
    }

    scene.render(context.renderer);
  }

  onPointer(pointer: MiniGamePointer): void {
    const state = this.state;
    if (!state || state.status !== 'playing') return;
    if (pointer.type === 'up') return;
    // 挡板中心跟随手指 x（logic 会再夹一次边界）
    this.state = advanceBreakout(state, 0, { paddleX: pointer.x * state.width });
    this.syncMeshes();
  }

  // ---------------------------------------------------------------- 内部

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!ARROW_KEYS.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  /** 球与挡板的 mesh 位置（连续坐标 → 世界坐标） */
  private syncMeshes(): void {
    const state = this.state;
    if (!state) return;
    if (this.paddleMesh) {
      this.paddleMesh.position.set(state.paddleX, 0.5, PADDLE_Y);
    }
    if (this.ballMesh) {
      this.ballMesh.position.set(state.ballX, 0.5, state.ballY);
    }
  }

  /** 砖块变了才重建（球每帧动，砖块不动） */
  private rebuildBricks(): void {
    const state = this.state;
    const scene = this.scene;
    if (!state || !scene) return;

    const keys = [...state.bricks.keys()].sort();
    const signature = `${keys.length}:${keys.join(';')}`;
    if (signature === this.brickSignature) return;
    this.brickSignature = signature;

    const blocks: Array<{ x: number; y: number; z: number; blockId: number }> = [];
    for (const key of keys) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      const hp = state.bricks.get(key) ?? 1;
      blocks.push({ x, y: 0, z, blockId: hp >= 2 ? Block.GOLD_BLOCK : Block.BRICKS });
    }
    scene.setBlocks(blocks);
  }

  private buildHud(context: MiniGameContext): void {
    const hud = document.createElement('div');
    hud.className = 'breakout-hud';

    const status = document.createElement('div');
    status.className = 'breakout-status';
    this.statusEl = status;

    hud.appendChild(status);
    context.layer.appendChild(hud);
    this.hud = hud;
  }

  private updateHud(): void {
    const state = this.state;
    const el = this.statusEl;
    if (!state || !el) return;
    el.textContent = tp('minigame.breakout.status', {
      level: this.levelIndex + 1,
      total: BREAKOUT_LEVEL_COUNT,
      lives: state.lives,
      score: state.score,
    });
  }
}
