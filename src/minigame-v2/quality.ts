import type * as THREE from 'three';

export type QualityTier = 0 | 1 | 2;

export interface QualitySettings {
  quality: 'auto' | 'high' | 'low';
  viewDistance: number;
}

export interface QualityDeps {
  renderer: THREE.WebGLRenderer;
  weatherObject: { visible: boolean };
  platform: { system: { dpr: number; width: number; height: number } };
  getSettings(): QualitySettings;
  canToast(): boolean;
  toast(message: string): void;
  onViewDistanceChanged(): void;
}

/**
 * 画质与帧率自适应。
 * - 2：DPR 1.5
 * - 1：DPR 1.25
 * - 0：DPR 1.0 + 关闭天气
 * 自动档只在开局稳定 8 秒后评估，避免加载期误降。
 */
export class QualityManager {
  tier: QualityTier = 2;
  private lastChange = 0;
  private poorSeconds = 0;
  private goodSeconds = 0;

  constructor(private readonly deps: QualityDeps) {}

  get viewDistance(): number {
    return this.tier === 0 ? Math.min(this.deps.getSettings().viewDistance, 1) : this.deps.getSettings().viewDistance;
  }

  apply(): void {
    const dpr = this.tier === 2 ? 1.5 : this.tier === 1 ? 1.25 : 1;
    this.deps.renderer.setPixelRatio(Math.min(this.deps.platform.system.dpr, dpr));
    this.deps.renderer.setSize(this.deps.platform.system.width, this.deps.platform.system.height, false);
    this.deps.weatherObject.visible = this.tier > 0;
    this.deps.onViewDistanceChanged();
    if (this.deps.canToast()) {
      this.deps.toast(this.tier === 2 ? '画质：高' : this.tier === 1 ? '画质：中' : '画质：性能');
    }
  }

  syncMode(): void {
    const mode = this.deps.getSettings().quality;
    if (mode === 'high') this.tier = 2;
    if (mode === 'low') this.tier = 0;
    this.apply();
  }

  update(fps: number, dt: number, now: number, playerReady: boolean, readyAt: number): void {
    if (this.deps.getSettings().quality !== 'auto') return;
    if (!playerReady || readyAt <= 0 || now - readyAt <= 8000 || fps <= 0) return;
    if (fps < 55) {
      this.poorSeconds += dt;
      this.goodSeconds = 0;
    } else if (fps >= 58) {
      this.goodSeconds += dt;
      this.poorSeconds = 0;
    }
    if (this.poorSeconds > 3 && this.tier > 0 && now - this.lastChange > 8000) {
      this.tier = (this.tier - 1) as QualityTier;
      this.lastChange = now;
      this.poorSeconds = 0;
      this.apply();
    } else if (this.goodSeconds > 10 && this.tier < 2 && now - this.lastChange > 10000) {
      this.tier = (this.tier + 1) as QualityTier;
      this.lastChange = now;
      this.goodSeconds = 0;
      this.apply();
    }
  }
}
