/**
 * 框架自检游戏（小游戏1，批次 20261022-1954）
 *
 * 一个旋转的方块：只用来验证"进入 → 每帧渲染 → 点一下 → 退出 → 无残留"这条链路。
 * **不是给玩家玩的内容**——真正的游戏在 `sokoban/` 与 `breakout/`（后续条目）。
 *
 * 刻意做得极简：一个 geometry、一个 material、一个 DOM 提示。
 * 验收会比对进入前后的 `renderer.info.memory`，多一个不释放的东西就会被抓出来。
 */

import * as THREE from 'three';
import { t } from '../../core/i18n/I18n.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../types.ts';

export class SmokeGame implements MiniGame {
  readonly id = 'smoke' as const;
  readonly titleKey = 'minigame.smoke.title';

  status: MiniGameStatus = 'playing';

  private context: MiniGameContext | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private cube: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  private hint: HTMLDivElement | null = null;

  mount(context: MiniGameContext): void {
    this.context = context;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1620);

    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
    camera.position.set(0, 0, 4);

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x63b3ed }),
    );
    scene.add(cube);

    this.scene = scene;
    this.camera = camera;
    this.cube = cube;

    const hint = document.createElement('div');
    hint.className = 'minigame-hint';
    hint.textContent = t('minigame.smoke.hint');
    context.layer.appendChild(hint);
    this.hint = hint;
  }

  unmount(): void {
    this.hint?.remove();
    this.hint = null;

    if (this.cube) {
      this.scene?.remove(this.cube);
      this.cube.geometry.dispose();
      this.cube.material.dispose();
    }
    this.scene?.clear();
    this.cube = null;
    this.scene = null;
    this.camera = null;
    this.context = null;
  }

  update(dt: number): void {
    if (!this.cube || !this.scene || !this.camera || !this.context) return;
    this.cube.rotation.y += dt;
    this.cube.rotation.x += dt * 0.4;
    this.context.renderer.render(this.scene, this.camera);
  }

  onPointer(pointer: MiniGamePointer): void {
    if (pointer.type !== 'down') return;
    this.status = this.status === 'won' ? 'playing' : 'won';
    this.context?.toast(t(this.status === 'won' ? 'minigame.smoke.won' : 'minigame.smoke.playing'));
  }
}
