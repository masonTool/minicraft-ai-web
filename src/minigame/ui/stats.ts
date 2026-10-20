import * as THREE from 'three';
import { drawPanel, drawText } from './widgets.ts';

export interface PlayerStats {
  health: number;
  food: number;
  air: number;
  armor: number;
  xp: number;
}

export interface StatsOverlay {
  setStats(stats: PlayerStats): void;
  setMining(progress: number | null): void;
  setError(message: string | null): void;
  hasError(): boolean;
  setBoss(name: string | null, health: number, max: number): void;
  setTarget(name: string | null): void;
  setCrosshairVisible(visible: boolean): void;
  setDamageFlash(value: number): void;
  showDeath(cause: string): void;
  hideDeath(): void;
  isDead(): boolean;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 准星 + 生命/饥饿/氧气/护甲/经验条（WX-026 第一版） */
export function createStats(
  screenWidth: number,
  screenHeight: number,
  safeArea?: { top: number; right: number; bottom: number; left: number },
): StatsOverlay {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * screenHeight) / Math.max(1, screenWidth)));
  const safeBottom = Math.max(0, screenHeight - (safeArea?.bottom ?? screenHeight));
  const safeBottomDesign = (safeBottom * 1024) / Math.max(1, screenWidth);
  const context = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(
      2,
      2 * (canvas.height / canvas.width) * (screenWidth / Math.max(1, screenHeight)),
    ),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  scene.add(mesh);

  let stats: PlayerStats = { health: 20, food: 20, air: 300, armor: 0, xp: 0 };
  let mining: number | null = null;
  let error: string | null = null;
  let boss: { name: string; health: number; max: number } | null = null;
  let targetName: string | null = null;
  let crosshairVisible = true;
  let damageFlash = 0;
  let deathCause: string | null = null;

  const foodIcon = (x: number, y: number, size: number, filled: boolean): void => {
    if (!context) return;
    // 8×6 像素鸡腿：上方肉块 + 右下骨头
    const pattern = [
      '00111000',
      '01111100',
      '11111110',
      '01111110',
      '00011100',
      '00001000',
    ];
    const px = size / 8;
    for (let row = 0; row < pattern.length; row++) {
      for (let col = 0; col < 8; col++) {
        if (pattern[row]![col] !== '1') continue;
        const isBone = row >= 4 && col >= 4;
        context.fillStyle = filled
          ? isBone
            ? '#efe2c2'
            : '#c98a3a'
          : 'rgba(30, 30, 34, 0.75)';
        context.fillRect(x + col * px, y + row * px, px + 0.5, px + 0.5);
      }
    }
  };

  const heart = (x: number, y: number, size: number, filled: boolean): void => {
    if (!context) return;
    // 8×6 像素心形
    const pattern = [
      '01100110',
      '11111111',
      '11111111',
      '01111110',
      '00111100',
      '00011000',
    ];
    const px = size / 8;
    context.fillStyle = filled ? '#e5484d' : 'rgba(30, 30, 34, 0.75)';
    for (let row = 0; row < pattern.length; row++) {
      for (let col = 0; col < 8; col++) {
        if (pattern[row]![col] !== '1') continue;
        context.fillRect(x + col * px, y + row * px, px + 0.5, px + 0.5);
      }
    }
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (deathCause) {
      context.fillStyle = 'rgba(10, 0, 0, 0.82)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const width = Math.min(460, canvas.width - 80);
      const x = (canvas.width - width) / 2;
      const y = canvas.height * 0.3;
      drawPanel(context, { x, y, w: width, h: 170 });
      drawText(context, '你死了！', canvas.width / 2, y + 24, 34, '#ff8a8a', 'center');
      drawText(
        context,
        deathCause,
        canvas.width / 2,
        y + 78,
        16,
        'rgba(255, 235, 235, 0.86)',
        'center',
        width - 40,
      );
      drawText(
        context,
        '点击屏幕重生',
        canvas.width / 2,
        y + 122,
        18,
        '#ffffff',
        'center',
      );
      texture.needsUpdate = true;
      return;
    }

    if (damageFlash > 0) {
      context.fillStyle = `rgba(190, 20, 20, ${0.42 * damageFlash})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (error) {
      context.fillStyle = 'rgba(0, 0, 0, 0.82)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const width = Math.min(760, canvas.width - 80);
      const x = (canvas.width - width) / 2;
      const y = canvas.height * 0.3;
      drawPanel(context, { x, y, w: width, h: 190 });
      drawText(context, 'FATAL ERROR', x + 24, y + 20, 28, '#ff8a8a');
      const lines = error.match(/.{1,52}/g) ?? [error];
      lines.slice(0, 3).forEach((line, index) => {
        drawText(context, line, x + 24, y + 68 + index * 26, 16, '#ffffff');
      });
      drawText(
        context,
        'RESTART THE MINI GAME TO RECOVER',
        x + 24,
        y + 154,
        14,
        'rgba(255, 255, 255, 0.55)',
      );
      texture.needsUpdate = true;
      return;
    }

    if (boss) {
      const barWidth = Math.min(560, canvas.width - 100);
      const x = (canvas.width - barWidth) / 2;
      const y = canvas.height * 0.9 - safeBottomDesign;
      drawText(context, boss.name, canvas.width / 2, y + 2, 14, '#ffffff', 'center', barWidth);
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(x, y, barWidth, 18);
      context.fillStyle = '#b34acb';
      context.fillRect(x, y, barWidth * Math.max(0, Math.min(1, boss.health / Math.max(1, boss.max))), 18);
      context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      context.lineWidth = 2;
      context.strokeRect(x + 1, y + 1, barWidth - 2, 16);
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    if (crosshairVisible) {
      // 准星：白色细十字 + 深色描边
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.fillRect(cx - 12, cy - 2, 24, 4);
    context.fillRect(cx - 2, cy - 12, 4, 24);
    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    context.fillRect(cx - 10, cy - 1, 20, 2);
    context.fillRect(cx - 1, cy - 10, 2, 20);

    if (targetName) {
      const width = Math.min(260, targetName.length * 13 + 22);
      context.fillStyle = 'rgba(0, 0, 0, 0.68)';
      context.fillRect(cx - width / 2, cy + 20, width, 24);
      context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      context.lineWidth = 1;
      context.strokeRect(cx - width / 2 + 0.5, cy + 20.5, width - 1, 23);
      drawText(context, targetName, cx, cy + 24, 14, '#f5f5f5', 'center', width - 12);
    }
    context.fillRect(cx - 1, cy - 11, 2, 22);
    }

    const baseY = canvas.height - 96 - safeBottomDesign;
    // 右移避开左侧摇杆；生命 320-560，饥饿 610-810
    const startX = 320;
    const heartSize = 20;
    const hearts = Math.max(0, Math.min(10, Math.ceil(stats.health / 2)));
    for (let i = 0; i < 10; i++) {
      heart(startX + i * 26, baseY, heartSize, i < hearts);
    }

    // 饥饿：像素鸡腿图标
    const foodStartX = 610;
    for (let i = 0; i < 10; i++) {
      foodIcon(foodStartX + i * 26, baseY, heartSize, i < Math.ceil(stats.food / 2));
    }

    if (stats.armor > 0) {
      drawText(context, `ARMOR ${stats.armor}`, startX + 500, baseY - 24, 15, '#b9d7ff');
    }
    if (stats.air < 300) {
      drawText(context, `AIR ${Math.ceil(stats.air)}`, startX + 500, baseY + 2, 15, '#8fd3ff');
    }

    // 经验条
    const barX = canvas.width / 2 - 220;
    const barY = canvas.height - 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.65)';
    context.fillRect(barX, barY, 440, 8);
    context.fillStyle = '#7ddc6a';
    context.fillRect(barX, barY, 440 * Math.max(0, Math.min(1, stats.xp)), 8);

    if (mining !== null) {
      const barW = 180;
      const x = cx - barW / 2;
      const y = cy + 34;
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(x, y, barW, 10);
      context.fillStyle = '#f0d36a';
      context.fillRect(x, y, barW * Math.max(0, Math.min(1, mining)), 10);
      context.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, barW - 1, 9);
    }

    texture.needsUpdate = true;
  };

  redraw();

  return {
    setStats(next: PlayerStats): void {
      stats = { ...next };
      redraw();
    },
    setMining(progress: number | null): void {
      if (mining === progress) return;
      mining = progress;
      redraw();
    },
    setError(message: string | null): void {
      error = message;
      redraw();
    },
    hasError(): boolean {
      return error !== null;
    },
    setBoss(name: string | null, health: number, max: number): void {
      boss = name ? { name, health, max } : null;
      redraw();
    },
    setTarget(name: string | null): void {
      const next = name && name !== '-' ? name : null;
      if (targetName === next) return;
      targetName = next;
      redraw();
    },
    setCrosshairVisible(visible: boolean): void {
      if (crosshairVisible === visible) return;
      crosshairVisible = visible;
      redraw();
    },
    setDamageFlash(value: number): void {
      const next = Math.max(0, Math.min(1, value));
      if (Math.abs(next - damageFlash) < 0.01) return;
      damageFlash = next;
      redraw();
    },
    showDeath(cause: string): void {
      deathCause = cause;
      redraw();
    },
    hideDeath(): void {
      if (deathCause === null) return;
      deathCause = null;
      redraw();
    },
    isDead(): boolean {
      return deathCause !== null;
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
