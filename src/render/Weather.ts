/**
 * 天气：晴 / 雨 / 雷暴
 *
 * - 降水粒子放在一个**以相机为中心**的 32×32×24 活动盒里，落到盒底就回收到盒顶。
 *   这样不管玩家怎么跑，雨都在身边，而且粒子总数恒定（不会边跑边分配新点）。
 * - 天气按现实时间推进：晴天 8~16 分钟，雨天 2~5 分钟；雨天有约 30% 概率升级成雷暴。
 * - 雪与雨共用同一套粒子，只是速度 / 尺寸 / 颜色不同，由调用方按地表方块决定
 *   （寒冷群系的地表是雪块 / 冰 → 传 snowy=true）。
 */

import * as THREE from 'three';

export type WeatherKind = 'clear' | 'rain' | 'thunder';

const PARTICLE_COUNT = 3200;
/** 活动盒的水平半径与竖向高度（格） */
const AREA = 16;
const HEIGHT = 24;

const RAIN_SPEED = 22;
const SNOW_SPEED = 3.2;

export class Weather {
  readonly object = new THREE.Group();

  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly points: THREE.Points;

  private kind: WeatherKind = 'clear';
  /** 当前天气的剩余秒数 */
  private timer = 600;
  private snowy = false;
  private flashValue = 0;
  private flashTimer = 8;

  constructor() {
    this.positions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.positions[i * 3] = (Math.random() * 2 - 1) * AREA;
      this.positions[i * 3 + 1] = Math.random() * HEIGHT - HEIGHT / 2;
      this.positions[i * 3 + 2] = (Math.random() * 2 - 1) * AREA;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xa9c8ff,
      size: 0.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.object.add(this.points);
  }

  get current(): WeatherKind {
    return this.kind;
  }

  get raining(): boolean {
    return this.kind !== 'clear';
  }

  /** 闪电强度 0-1，供环境亮度叠加 */
  get flash(): number {
    return this.flashValue;
  }

  /** 调试 / 命令用：直接切换天气 */
  setKind(kind: WeatherKind): void {
    this.kind = kind;
    this.points.visible = kind !== 'clear';
    if (kind === 'thunder') this.flashTimer = 1 + Math.random() * 3;
    else this.flashValue = 0;
  }

  private planNext(): void {
    if (this.kind === 'clear') {
      // 晴天结束：多半转雨，其中一部分是雷暴
      if (Math.random() < 0.55) this.setKind(Math.random() < 0.3 ? 'thunder' : 'rain');
      this.timer = 480 + Math.random() * 480;
      return;
    }
    this.setKind('clear');
    this.timer = 480 + Math.random() * 480;
  }

  /**
   * @param snowy 玩家所在地表是否是寒冷群系（决定下雪还是下雨）
   */
  update(dt: number, cameraPosition: THREE.Vector3, snowy: boolean): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      const previous = this.kind;
      this.planNext();
      // 雨天本身持续 2~5 分钟，晴天 8~16 分钟
      if (previous === 'clear' && this.kind !== 'clear') this.timer = 120 + Math.random() * 180;
    }

    if (this.snowy !== snowy) {
      this.snowy = snowy;
      this.material.size = snowy ? 0.16 : 0.1;
      this.material.color.setHex(snowy ? 0xffffff : 0xa9c8ff);
      this.material.opacity = snowy ? 0.9 : 0.78;
    }

    // ---- 闪电（只在雷暴时）
    if (this.kind === 'thunder') {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashValue = 0.85 + Math.random() * 0.15;
        this.flashTimer = 4 + Math.random() * 9;
      }
    }
    if (this.flashValue > 0) this.flashValue = Math.max(0, this.flashValue - dt * 6);

    if (!this.raining) return;

    this.object.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const speed = (this.snowy ? SNOW_SPEED : RAIN_SPEED) * dt;
    const positions = this.positions;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let y = positions[i * 3 + 1]! - speed;
      if (y < -HEIGHT / 2) {
        y += HEIGHT;
        positions[i * 3] = (Math.random() * 2 - 1) * AREA;
        positions[i * 3 + 2] = (Math.random() * 2 - 1) * AREA;
      }
      positions[i * 3 + 1] = y;
    }
    this.geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
