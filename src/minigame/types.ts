/**
 * 单机小游戏的**契约**（小游戏1，批次 20261022-1954；J0 收窄到跳一跳，批次 20261022-2220）
 *
 * 三个模块共用这一份：`MiniGameHost`（宿主）只认接口，具体游戏（跳一跳 / 自检）
 * 各自实现，主程序只负责"什么时候更新、什么时候渲染"。
 *
 * 四条口径：
 *
 *  1. **小游戏不碰主世界**：它拿到的是 `renderer` / `atlas`（只读共享）与自己的一块 DOM，
 *     没有 `World`、没有存档、没有实体表。于是"小游戏出 bug"最多是它自己崩，
 *     不会把主世界的区块或存档写坏。
 *  2. **`mount` / `unmount` 必须成对**：`unmount` 要释放**所有** geometry / material /
 *     texture 并解绑事件——验收会比对 `renderer.info.memory` 的前后值。
 *  3. **`update(dt)` 自己渲染**：宿主不猜场景与相机（每个游戏视角不同），
 *     只保证每帧调一次、且 `dt` 已被夹到安全范围。
 *  4. **指针坐标归一化到 0~1**：宿主负责把 DOM 事件换算好，游戏不碰 `clientX/Y`，
 *     这样换机型、转屏、安全区都不会算错。
 */

import type * as THREE from 'three';
import type { TextureAtlas } from '../render/TextureAtlas.ts';

export type MiniGameId = 'jump' | 'smoke';

/** 一局的状态（宿主据此显示"过关/失败"覆盖层） */
export type MiniGameStatus = 'playing' | 'won' | 'lost';

export interface MiniGamePointer {
  readonly type: 'down' | 'move' | 'up';
  /** 相对游戏层的比例（0~1），y 向下 */
  readonly x: number;
  readonly y: number;
}

/** 宿主交给游戏的运行环境 */
export interface MiniGameContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas: TextureAtlas;
  /** 游戏专属 DOM 层（HUD、关卡提示都加在这里，退出时整层清空） */
  readonly layer: HTMLElement;
  /** 请求退出（回到主菜单） */
  readonly exit: () => void;
  /** 顶部一句话提示（如"过关！"） */
  readonly toast: (text: string) => void;
}

export interface MiniGame {
  readonly id: MiniGameId;
  /** 标题的 i18n 键（宿主顶栏显示） */
  readonly titleKey: string;
  /** 建场景、绑事件；`layer` 里可以加自己的 HUD */
  mount(context: MiniGameContext): void;
  /** 释放一切（geometry / material / texture / DOM / 事件） */
  unmount(): void;
  /** 每帧推进并渲染（`dt` 已夹到 ≤ 0.1 秒） */
  update(dt: number): void;
  onPointer(pointer: MiniGamePointer): void;
  readonly status: MiniGameStatus;
}
