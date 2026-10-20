import * as THREE from 'three';
import { drawButton, drawText } from './widgets.ts';

export interface Hud {
  update(lines: readonly string[]): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 顶部文本 HUD：诊断指标与操作提示 */
export function createHud(
  screenWidth: number,
  screenHeight: number,
  safeArea?: { top: number; right: number; bottom: number; left: number },
): Hud {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * screenHeight) / Math.max(1, screenWidth)));
  const designScale = 1024 / Math.max(1, screenWidth);
  const safeTop = (safeArea?.top ?? 0) * designScale;
  const safeLeft = (safeArea?.left ?? 0) * designScale;
  const safeRight = (safeArea?.right ?? screenWidth) * designScale;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, 0, 0);
  scene.add(mesh);

  return {
    update(lines: readonly string[]): void {
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const panelWidth = Math.min(380, canvas.width - 240);
      const panelHeight = lines.length * 20 + 16;
      const top = 8 + safeTop;
      const right = safeRight - 12;
      const panelX = right - panelWidth;
      context.fillStyle = 'rgba(0, 0, 0, 0.44)';
      context.fillRect(panelX, top, panelWidth, panelHeight);
      context.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      context.lineWidth = 1;
      context.strokeRect(panelX + 0.5, top + 0.5, panelWidth - 1, panelHeight - 1);
      lines.forEach((line, index) => {
        drawText(
          context,
          line,
          panelX + 9,
          top + 9 + index * 20,
          12,
          index === 0 ? 'rgba(180, 230, 250, 1)' : 'rgba(255, 255, 255, 0.9)',
          'left',
          panelWidth - 18,
        );
      });
      // 左上角 MENU/BAG：与 world-boot 的触摸区对应
      drawButton(context, { x: 12 + safeLeft, y: top, w: 86, h: 36 }, '菜单', 'normal', 16);
      drawButton(context, { x: 106 + safeLeft, y: top, w: 96, h: 36 }, '背包', 'normal', 17);
      texture.needsUpdate = true;
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
