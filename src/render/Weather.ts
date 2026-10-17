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
import {
  DEFAULT_WEATHER,
  restoreWeather,
  tickWeather,
  weatherSecondsFor,
  type WeatherKind,
  type WeatherState,
} from '../core/world/WeatherState.ts';

// 天气种类的字符串联合**定义在 `core/world/WeatherState.ts`**（那里是纯逻辑、能离线断言），
// 这里只是把它转出去，让老的 `import { type WeatherKind } from './render/Weather.ts'` 继续能用
export type { WeatherKind } from '../core/world/WeatherState.ts';

const PARTICLE_COUNT = 3200;
/** 活动盒的水平半径与竖向高度（格） */
const AREA = 16;
const HEIGHT = 24;

const RAIN_SPEED = 22;
const SNOW_SPEED = 3.2;

/**
 * 天气的**状态与转换规则**在 `core/world/WeatherState.ts`（纯逻辑、可离线断言、可进存档），
 * 这里只负责"把它画出来"：粒子雨雪、雷暴的闪光、以及每帧推进那一小份状态。
 */
export class Weather {
  readonly object = new THREE.Group();

  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly points: THREE.Points;

  /** 当前天气（种类 + 剩余秒数）；进存档的就是它（L6，批次 85） */
  private state: WeatherState = { ...DEFAULT_WEATHER };
  private snowy = false;
  private flashValue = 0;
  private flashTimer = 8;
  /** 当前实际参与绘制的雨/雪点数（见 `setIntensity`） */
  private drawCount = PARTICLE_COUNT;

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
    return this.state.kind;
  }

  get raining(): boolean {
    return this.state.kind !== 'clear';
  }

  /** 当前天气还有多少秒（验收脚本与调试面板用） */
  get remaining(): number {
    return this.state.seconds;
  }

  /** 进存档的那一份（L6）：种类 + 剩余秒数 —— 就这两个数 */
  snapshot(): WeatherState {
    return { ...this.state };
  }

  /** 读档恢复（L6）：脏数据由 `restoreWeather` 兜住，**不抛错** */
  restore(raw: unknown): void {
    this.state = restoreWeather(raw);
    this.applyKind(this.state.kind);
  }

  /** 闪电强度 0-1，供环境亮度叠加 */
  get flash(): number {
    return this.flashValue;
  }

  /**
   * 雨 / 雪的**密度**（0~1）：只画前 `PARTICLE_COUNT × fraction` 个点。
   *
   * 存在的理由（批次 157）：雨点是 `transparent + depthWrite:false` 的 `Points`，
   * 密度直接等于 overdraw，在手机上"一下雨就卡"很大一部分来自它。
   * 减半之后"雨变小了"几乎看不出来——这是一笔很划算的降级。
   *
   * ⚠️ 用 `setDrawRange` 而不是重建缓冲：数组与容量都不用动，来回切档零成本。
   */
  setIntensity(fraction: number): void {
    const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0.05, fraction)) : 1;
    this.drawCount = Math.max(1, Math.round(PARTICLE_COUNT * safe));
    this.geometry.setDrawRange(0, this.drawCount);
  }

  /** 当前实际在画多少个点（调试与验收用） */
  get activeCount(): number {
    return this.drawCount;
  }

  /** 调试 / 命令用：直接切换天气（剩余时长按这一种天气的区间取） */
  setKind(kind: WeatherKind): void {
    this.state = { kind, seconds: weatherSecondsFor(Math.random, kind) };
    this.applyKind(kind);
  }

  /** 换种类时要做的视觉副作用（可见性 + 雷暴闪光） */
  private applyKind(kind: WeatherKind): void {
    this.points.visible = kind !== 'clear';
    if (kind === 'thunder') this.flashTimer = 1 + Math.random() * 3;
    else this.flashValue = 0;
  }

  /**
   * @param snowy 玩家所在地表是否是寒冷群系（决定下雪还是下雨）
   */
  update(dt: number, cameraPosition: THREE.Vector3, snowy: boolean): void {
    // 状态推进只有一行：到点了就换成下一种（规则在 `WeatherState.ts` 里）
    const next = tickWeather(this.state, dt, Math.random);
    if (next.kind !== this.state.kind) this.applyKind(next.kind);
    this.state = next;

    if (this.snowy !== snowy) {
      this.snowy = snowy;
      this.material.size = snowy ? 0.16 : 0.1;
      this.material.color.setHex(snowy ? 0xffffff : 0xa9c8ff);
      this.material.opacity = snowy ? 0.9 : 0.78;
    }

    // ---- 闪电（只在雷暴时）
    if (this.state.kind === 'thunder') {
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
    // 只推进"真的在画"的那一段（密度降到 1/4 时就别再白算剩下 2400 个点）
    for (let i = 0; i < this.drawCount; i++) {
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
