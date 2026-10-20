import * as THREE from 'three';
import { drawPanel, drawText } from './widgets.ts';

/**
 * 启动失败页：boot 初始化抛错时，用已经建好的渲染器画一张全屏错误卡。
 * 渲染器都没建起来时由 world-boot 回退到原生 showModal。
 */
export function showBootError(renderer: THREE.WebGLRenderer, message: string): void {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * 390) / 844));
  const context = canvas.getContext('2d');
  if (!context) return;

  context.fillStyle = 'rgba(4, 8, 12, 0.92)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const width = Math.min(760, canvas.width - 80);
  const x = (canvas.width - width) / 2;
  const y = canvas.height * 0.24;
  drawPanel(context, { x, y, w: width, h: 250 });
  context.fillStyle = 'rgba(255, 120, 120, 0.95)';
  context.fillRect(x + 24, y + 22, 8, 32);
  drawText(context, '启动失败', x + 46, y + 22, 30, '#ffb0b0');

  const lines = message.match(/.{1,54}/g) ?? [message];
  lines.slice(0, 4).forEach((line, index) => {
    drawText(
      context,
      line,
      x + 28,
      y + 82 + index * 24,
      14,
      'rgba(255, 255, 255, 0.82)',
      'left',
      width - 56,
    );
  });

  drawText(
    context,
    '请退出小游戏后重新进入；如果仍然失败，请检查设备 WebGL 支持。',
    x + 28,
    y + 200,
    13,
    'rgba(190, 215, 235, 0.72)',
    'left',
    width - 56,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false }),
  );
  scene.add(mesh);

  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
}
