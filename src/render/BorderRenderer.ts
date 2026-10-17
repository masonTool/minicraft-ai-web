/**
 * 世界边界的蓝墙（K12，批次 175）
 *
 * 四道半透明的蓝色竖直面，围成一个正方形——玩家走到边上时"看得见那堵墙"。
 *
 * 三处取舍（都与信标光柱同一个套路）：
 *  1. **不贴图、不引图集**：纯色 + 半透明就够了（省一张贴图与 UV 换算）；
 *  2. **每帧按玩家位置重摆**，而不是一次性摆在 3 千万格之外：
 *     边界的坐标可以很大（默认 ±1500 万），直接摆出去会撞上浮点精度，
 *     还会被视锥剔除掉。所以只画**玩家附近那一段**——四道面各取 2 倍视距的长度，
 *     贴在边界线上，跟着玩家平移。看上去就是"一道望不到头的墙"。
 *  3. `depthWrite = false`：墙是"叠在世界上的一层色"，写深度会把后面的地形切出硬边。
 */

import * as THREE from 'three';
import { borderCorners, type WorldBorder } from '../core/world/WorldBorder.ts';

/** 墙的高度（格）：原版是"从世界底部到顶部"，这里取一段够用的即可 */
const WALL_HEIGHT = 160;
/** 墙的长度（格）：等于视距的两倍多一点，玩家转头时不会看到"墙断了" */
const WALL_LENGTH = 256;
/** 蓝色（原版的边界就是这种偏青的蓝） */
const WALL_COLOR = 0x2f6dff;
/** 不透明度：太浓会挡视线，太淡又看不见 */
const WALL_OPACITY = 0.35;

export class BorderRenderer {
  readonly group = new THREE.Group();

  private readonly material: THREE.MeshBasicMaterial;
  /** 四道墙：北 / 南 / 东 / 西 */
  private readonly walls: THREE.Mesh[] = [];

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: WALL_COLOR,
      transparent: true,
      opacity: WALL_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.group.visible = false;
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
      this.walls.push(mesh);
      this.group.add(mesh);
    }
  }

  /**
   * 每帧摆一次。
   *
   * @param border 边界
   * @param player 玩家位置（墙只画在他附近那一段）
   * @param viewDistance 视距（格）：墙长按它放大，免得在远处看到"墙头断了"
   */
  sync(border: WorldBorder, player: { x: number; y: number; z: number }, viewDistance: number): void {
    const corners = borderCorners(border);
    const length = Math.max(WALL_LENGTH, viewDistance * 2 + 48);
    const centerY = player.y + WALL_HEIGHT / 2 - 24;

    // 四道墙：北（z=minZ）、南（z=maxZ）沿 X 展开；东（x=maxX）、西（x=minX）沿 Z 展开
    const specs: Array<{ x: number; z: number; rotationY: number }> = [
      { x: player.x, z: corners.minZ, rotationY: 0 },
      { x: player.x, z: corners.maxZ, rotationY: 0 },
      { x: corners.maxX, z: player.z, rotationY: Math.PI / 2 },
      { x: corners.minX, z: player.z, rotationY: Math.PI / 2 },
    ];

    for (const [index, mesh] of this.walls.entries()) {
      const spec = specs[index]!;
      mesh.position.set(spec.x, centerY, spec.z);
      mesh.rotation.set(0, spec.rotationY, 0);
      mesh.scale.set(length, WALL_HEIGHT, 1);
    }

    // 边界大到"根本走不到"时就不画（默认 3 千万格，画了也只是浪费一个 draw call）
    this.group.visible = border.size < 100_000;
  }

  dispose(): void {
    for (const mesh of this.walls) mesh.geometry.dispose();
    this.walls.length = 0;
    this.material.dispose();
    this.group.removeFromParent();
  }
}
