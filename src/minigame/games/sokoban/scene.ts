/**
 * 推箱子的**画面与输入**（小游戏4，批次 20261022-1954）
 *
 * 规则全在 `logic.ts`，这里只做三件事：把状态画出来、把触摸/键盘翻译成方向、过关庆祝。
 *
 * 四个刻意的做法：
 *
 *  1. **每次状态变化整块重建**：7×7 关卡最多 49 格，`setBlocks` 建 3~4 个 InstancedMesh，
 *     比"只改一个格子的矩阵"简单得多，也不会出现"箱子动了但地面上还留着一块"。
 *  2. **两种输入都支持**：左右/上下滑动（拖动超过 6% 视口就算一步，可以连滑连推）、
 *     轻点（点屏幕哪一侧就往哪走，低龄更好上手）；桌面另有方向键 / WASD / Z 撤销 / R 重来。
 *  3. **过关只庆祝、不自动跳关**：相机绕中心慢慢转一圈，玩家自己退出选下一关。
 *     自动跳关会让"我还没看清就没了"。
 *  4. **死锁只提示不判负**：玩家还能撤销，直接判负太凶。
 */

import * as THREE from 'three';
import { Block } from '../../../core/registry/blocks.ts';
import { t, tp } from '../../../core/i18n/I18n.ts';
import { BlockScene } from '../../BlockScene.ts';
import { parseLevel, type Level } from '../../level.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../../types.ts';
import {
  createSokobanState,
  isSokobanDeadlocked,
  moveSokoban,
  undoSokoban,
  type SokobanDirection,
  type SokobanState,
} from './logic.ts';
import { SOKOBAN_LEVEL_COUNT, sokobanLevel } from './levels.ts';

/** 拖动超过视口这个比例算一步（0.06 ≈ 手机上 25px，轻扫就够） */
const SWIPE_THRESHOLD = 0.06;

const PLAYER_BLOCK = Block.GLOWSTONE;
const BOX_BLOCK = Block.CHEST;
const BOX_ON_GOAL_BLOCK = Block.GOLD_BLOCK;

const DIRECTION_KEYS: Readonly<Record<string, SokobanDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

export interface SokobanGameOptions {
  /** 过关时回调（主程序写进度用） */
  readonly onCleared?: (steps: number) => void;
}

export class SokobanGame implements MiniGame {
  readonly id = 'sokoban' as const;
  readonly titleKey = 'minigame.sokoban.title';

  status: MiniGameStatus = 'playing';

  private readonly levelIndex: number;
  private level: Level | null = null;
  private state: SokobanState | null = null;
  private context: MiniGameContext | null = null;
  private scene: BlockScene | null = null;

  private readonly center = new THREE.Vector3();
  private cameraDistance = 1;
  private winTime = 0;

  private pointerStart: { x: number; y: number } | null = null;
  private hud: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private readonly listeners = new AbortController();

  constructor(
    levelIndex = 0,
    private readonly options: SokobanGameOptions = {},
  ) {
    this.levelIndex = Number.isFinite(levelIndex)
      ? Math.max(0, Math.min(SOKOBAN_LEVEL_COUNT - 1, Math.floor(levelIndex)))
      : 0;
  }

  mount(context: MiniGameContext): void {
    this.context = context;

    const parsed = parseLevel(sokobanLevel(this.levelIndex));
    if (!parsed.ok) {
      // 关卡数据坏了：告诉玩家并退出，而不是进入一个空白场景
      context.toast(t('minigame.sokoban.brokenLevel'));
      context.exit();
      return;
    }
    this.level = parsed.level;
    this.state = createSokobanState(parsed.level);

    const extent = Math.max(parsed.level.width, parsed.level.depth);
    this.center.set(parsed.level.width / 2 + 0.5, 0.5, parsed.level.depth / 2 + 0.5);
    this.cameraDistance = extent * 1.7;

    this.scene = new BlockScene({
      atlas: context.atlas,
      center: { x: parsed.level.width / 2, y: 0, z: parsed.level.depth / 2 },
      size: extent,
    });
    this.scene.setViewport(window.innerWidth, window.innerHeight);

    this.buildHud(context);
    this.rebuild();
    this.updateHud();

    document.addEventListener('keydown', this.onKeyDown, { signal: this.listeners.signal });
  }

  unmount(): void {
    this.listeners.abort();
    this.scene?.dispose();
    this.scene = null;
    this.hud?.remove();
    this.hud = null;
    this.statusEl = null;
    this.context = null;
    this.state = null;
    this.level = null;
  }

  update(dt: number): void {
    const scene = this.scene;
    const context = this.context;
    if (!scene || !context) return;
    if (this.status === 'won') this.celebrate(dt);
    scene.render(context.renderer);
  }

  onPointer(pointer: MiniGamePointer): void {
    if (this.status === 'won' || this.status === 'lost') return;

    if (pointer.type === 'down') {
      this.pointerStart = { x: pointer.x, y: pointer.y };
      return;
    }

    if (pointer.type === 'up') {
      const start = this.pointerStart;
      this.pointerStart = null;
      if (!start) return;
      const dx = pointer.x - start.x;
      const dy = pointer.y - start.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
        // 轻点：点哪一侧往哪走（低龄比"必须滑动"好上手）
        this.attempt(directionOf(pointer.x - 0.5, pointer.y - 0.5));
      } else {
        this.attempt(directionOf(dx, dy));
      }
      return;
    }

    // move：拖动过阈值就立刻走一步，并把起点挪到当前位置（可以一路连推）
    const start = this.pointerStart;
    if (!start) return;
    const dx = pointer.x - start.x;
    const dy = pointer.y - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
    this.pointerStart = { x: pointer.x, y: pointer.y };
    this.attempt(directionOf(dx, dy));
  }

  // ---------------------------------------------------------------- 内部

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.status === 'won' || this.status === 'lost') return;
    const direction = DIRECTION_KEYS[event.code];
    if (direction) {
      event.preventDefault();
      this.attempt(direction);
      return;
    }
    if (event.code === 'KeyZ' || event.code === 'Backspace') {
      event.preventDefault();
      this.undo();
      return;
    }
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.restart();
    }
  };

  private attempt(direction: SokobanDirection): void {
    const state = this.state;
    if (!state || this.status !== 'playing') return;

    const result = moveSokoban(state, direction);
    if (!result.ok) return;

    this.state = result.state;
    this.rebuild();
    this.updateHud();

    if (result.won) {
      this.status = 'won';
      this.context?.toast(t('minigame.sokoban.won'));
      this.options.onCleared?.(result.state.steps);
      return;
    }
    if (result.limitReached) {
      this.status = 'lost';
      this.context?.toast(t('minigame.sokoban.limit'));
      return;
    }
    // 死锁只提示：玩家还能撤销，直接判负太凶
    if (isSokobanDeadlocked(result.state)) this.context?.toast(t('minigame.sokoban.deadlock'));
  }

  private undo(): void {
    const state = this.state;
    if (!state) return;
    const next = undoSokoban(state);
    if (!next) return;
    this.state = next;
    // 撤销把"超步数判负"也一并撤回——那是这一步造成的
    if (this.status === 'lost') this.status = 'playing';
    this.rebuild();
    this.updateHud();
  }

  private restart(): void {
    if (!this.level) return;
    this.state = createSokobanState(this.level);
    this.status = 'playing';
    this.winTime = 0;
    this.rebuild();
    this.updateHud();
  }

  /** 状态 → 方块列表（墙 / 地板 / 目标 / 箱子 / 玩家） */
  private rebuild(): void {
    const state = this.state;
    const scene = this.scene;
    if (!state || !scene) return;

    const blocks: Array<{ x: number; y: number; z: number; blockId: number }> = [];
    for (let z = 0; z < state.depth; z++) {
      for (let x = 0; x < state.width; x++) {
        const key = `${x},${z}`;
        if (state.walls.has(key)) {
          blocks.push({ x, y: 0, z, blockId: Block.STONE });
        } else if (state.goals.has(key)) {
          blocks.push({ x, y: 0, z, blockId: Block.GOLD_BLOCK });
        } else {
          blocks.push({ x, y: 0, z, blockId: Block.OAK_PLANKS });
        }
      }
    }
    for (const box of state.boxes) {
      const [x, z] = box.split(',').map(Number) as [number, number];
      blocks.push({ x, y: 0, z, blockId: state.goals.has(box) ? BOX_ON_GOAL_BLOCK : BOX_BLOCK });
    }
    blocks.push({ x: state.playerX, y: 0, z: state.playerZ, blockId: PLAYER_BLOCK });

    scene.setBlocks(blocks);
  }

  private buildHud(context: MiniGameContext): void {
    const hud = document.createElement('div');
    hud.className = 'sokoban-hud';

    const status = document.createElement('div');
    status.className = 'sokoban-status';
    this.statusEl = status;

    const actions = document.createElement('div');
    actions.className = 'sokoban-actions';

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.dataset.action = 'undo';
    undo.textContent = t('minigame.sokoban.undo');
    undo.addEventListener('click', () => this.undo());

    const restart = document.createElement('button');
    restart.type = 'button';
    restart.dataset.action = 'restart';
    restart.textContent = t('minigame.sokoban.restart');
    restart.addEventListener('click', () => this.restart());

    actions.append(undo, restart);
    hud.append(status, actions);
    context.layer.appendChild(hud);
    this.hud = hud;
  }

  private updateHud(): void {
    const state = this.state;
    const el = this.statusEl;
    if (!state || !el) return;
    el.textContent = tp('minigame.sokoban.status', {
      level: this.levelIndex + 1,
      total: SOKOBAN_LEVEL_COUNT,
      steps: state.steps,
      pushes: state.pushes,
    });
  }

  /** 过关庆祝：相机绕中心慢转一圈 */
  private celebrate(dt: number): void {
    const scene = this.scene;
    if (!scene) return;
    this.winTime += dt;
    const angle = Math.PI / 4 + this.winTime * 0.8;
    scene.camera.position.set(
      this.center.x + Math.cos(angle) * this.cameraDistance,
      this.center.y + this.cameraDistance * 0.9,
      this.center.z + Math.sin(angle) * this.cameraDistance,
    );
    scene.camera.lookAt(this.center);
  }
}

/** 位移 → 主轴方向 */
function directionOf(dx: number, dy: number): SokobanDirection {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
