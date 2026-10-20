import * as THREE from 'three';
import { drawText } from './widgets.ts';

export interface TouchControls {
  setFlying(active: boolean): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * 可见触摸控件（WX-027 第一版）
 *
 * 只负责画提示，触摸判定仍在 world-boot 的分区里：
 *   - 左下摇杆 = 左半屏拖动
 *   - PLACE = 右半屏上部轻点
 *   - MINE = 右半屏中部按住
 *   - JUMP = 右半屏底部轻点
 */
export function createTouchControls(screenWidth: number, screenHeight: number): TouchControls {
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

  const circle = (
    x: number,
    y: number,
    radius: number,
    fill: string,
    stroke: string,
  ): void => {
    if (!context) return;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 3;
    context.stroke();
  };

  let flying = false;

  const button = (x: number, y: number, radius: number, label: string, active = false): void => {
    circle(
      x,
      y,
      radius,
      active ? 'rgba(70, 140, 90, 0.65)' : 'rgba(20, 24, 28, 0.5)',
      active ? 'rgba(180, 255, 200, 0.95)' : 'rgba(255, 255, 255, 0.55)',
    );
    drawText(context!, label, x, y - 9, 16, 'rgba(255, 255, 255, 0.9)', 'center');
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    // 左下摇杆提示
    const jx = canvas.width * 0.16;
    const jy = canvas.height * 0.58;
    circle(jx, jy, 58, 'rgba(20, 24, 28, 0.35)', 'rgba(255, 255, 255, 0.35)');
    circle(jx, jy, 26, 'rgba(255, 255, 255, 0.25)', 'rgba(255, 255, 255, 0.55)');
    drawText(context, 'MOVE', jx, jy - 76, 14, 'rgba(255, 255, 255, 0.55)', 'center');

    // 飞行开关：左侧中部，避开摇杆
    button(jx, canvas.height * 0.38, 34, 'FLY', flying);

    // 右侧按钮：与 world-boot 的 y 分区对应
    const bx = canvas.width * 0.88;
    button(bx, canvas.height * 0.3, 44, 'PLACE');
    button(bx, canvas.height * 0.58, 48, 'MINE');
    button(bx, canvas.height * 0.84, 46, 'JUMP');

    texture.needsUpdate = true;
  };

  redraw();

  return {
    setFlying(active: boolean): void {
      if (flying === active) return;
      flying = active;
      redraw();
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
