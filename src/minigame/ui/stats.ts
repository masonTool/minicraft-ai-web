import * as THREE from 'three';
import { drawText } from './widgets.ts';

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
  render(renderer: THREE.WebGLRenderer): void;
}

/** 准星 + 生命/饥饿/氧气/护甲/经验条（WX-026 第一版） */
export function createStats(screenWidth: number, screenHeight: number): StatsOverlay {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * screenHeight) / Math.max(1, screenWidth)));
  const context = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, (2 * canvas.height) / canvas.width),
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

    // 准星
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(cx - 13, cy - 2, 26, 4);
    context.fillRect(cx - 2, cy - 13, 4, 26);
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(cx - 11, cy - 1, 22, 2);
    context.fillRect(cx - 1, cy - 11, 2, 22);

    const baseY = canvas.height - 96;
    // 右移避开左侧摇杆；生命 320-560，饥饿 610-810
    const startX = 320;
    const heartSize = 20;
    const hearts = Math.max(0, Math.min(10, Math.ceil(stats.health / 2)));
    for (let i = 0; i < 10; i++) {
      heart(startX + i * 26, baseY, heartSize, i < hearts);
    }

    // 饥饿：用 10 个小方块表示
    for (let i = 0; i < 10; i++) {
      const filled = i < Math.ceil(stats.food / 2);
      context.fillStyle = filled ? '#c98a3a' : 'rgba(30, 30, 34, 0.75)';
      context.fillRect(startX + 290 + i * 20, baseY + 3, 16, 16);
    }

    drawText(context, `HP ${Math.ceil(stats.health)}/20`, startX, baseY - 24, 15, '#ffffff');
    drawText(context, `FOOD ${Math.ceil(stats.food)}/20`, startX + 290, baseY - 24, 15, '#ffffff');

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
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
