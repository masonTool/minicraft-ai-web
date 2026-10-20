import * as THREE from 'three';
import { drawButton, drawPanel, drawText } from './widgets.ts';

export interface Hud {
  update(lines: readonly string[]): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 顶部文本 HUD：诊断指标与操作提示 */
export function createHud(): Hud {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 0.5),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, 0.72, 0);
  scene.add(mesh);

  return {
    update(lines: readonly string[]): void {
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const panelWidth = Math.min(720, canvas.width - 280);
      const panelHeight = lines.length * 30 + 20;
      drawPanel(context, { x: 12, y: 8, w: panelWidth, h: panelHeight });
      lines.forEach((line, index) => {
        drawText(
          context,
          line,
          24,
          18 + index * 30,
          18,
          index === 0 ? 'rgba(165, 225, 250, 1)' : 'rgba(255, 255, 255, 0.92)',
          'left',
          panelWidth - 24,
        );
      });
      // 右上角 MENU/BAG：与 world-boot 的触摸区对应
      drawButton(context, { x: canvas.width - 236, y: 8, w: 96, h: 40 }, 'MENU', 'normal', 18);
      drawButton(context, { x: canvas.width - 132, y: 8, w: 118, h: 40 }, 'BAG', 'normal', 20);
      texture.needsUpdate = true;
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
