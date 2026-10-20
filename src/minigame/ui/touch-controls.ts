import * as THREE from 'three';
import { drawText } from './widgets.ts';

export interface TouchControls {
  setFlying(active: boolean): void;
  setSneaking(active: boolean): void;
  setLayout(leftHanded: boolean, scale: number, stickMode: 'fixed' | 'dynamic'): void;
  setStickOrigin(x: number, y: number, active: boolean): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * Web 手机版同款触控层：
 * - 左下透明摇杆（无 MOVE 文字）
 * - 右下只有跳跃键（向上箭头）
 * - 顶部居中暂停方键
 * - 快捷栏右侧背包方键
 * - 快捷栏上方一行操作提示
 *
 * 放置/挖掘仍由 world-boot 的右半屏手势分区处理，不再画 PLACE/MINE/ATK 大按钮。
 */
export function createTouchControls(
  screenWidth: number,
  screenHeight: number,
  safeArea?: { top: number; right: number; bottom: number; left: number },
): TouchControls {
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
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  scene.add(mesh);

  const designScale = 1024 / Math.max(1, screenWidth);
  const safeTop = (safeArea?.top ?? 0) * designScale;
  const safeLeft = (safeArea?.left ?? 0) * designScale;
  const safeRight = (safeArea?.right ?? screenWidth) * designScale;
  const safeBottom = Math.max(0, screenHeight - (safeArea?.bottom ?? screenHeight)) * designScale;

  let flying = false;
  let sneaking = false;
  let leftHanded = false;
  let touchScale = 1;
  let stickMode: 'fixed' | 'dynamic' = 'fixed';
  let dynamicX = 0;
  let dynamicY = 0;
  let dynamicActive = false;

  const circle = (x: number, y: number, radius: number, fill: string, stroke: string): void => {
    if (!context) return;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 3;
    context.stroke();
  };

  const squareButton = (x: number, y: number, size: number, drawIcon: () => void): void => {
    if (!context) return;
    context.fillStyle = 'rgba(0, 0, 0, 0.34)';
    context.fillRect(x, y, size, size);
    context.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    context.lineWidth = 3;
    context.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
    drawIcon();
  };

  const drawPauseIcon = (cx: number, cy: number): void => {
    if (!context) return;
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(cx - 10, cy - 13, 7, 26);
    context.fillRect(cx + 3, cy - 13, 7, 26);
  };

  const drawBagIcon = (cx: number, cy: number): void => {
    if (!context) return;
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    context.lineWidth = 4;
    context.strokeRect(cx - 13, cy - 7, 26, 22);
    context.beginPath();
    context.arc(cx, cy - 8, 8, Math.PI, Math.PI * 2);
    context.stroke();
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    // 摇杆：Web 132px / 屏宽 844 ≈ 160 设计单位；左手模式镜像到右侧
    const scale = touchScale;
    const stickRadius = 80 * scale;
    const fixedX = leftHanded
      ? safeRight - 26 - stickRadius
      : safeLeft + 26 + stickRadius;
    const fixedY = canvas.height - safeBottom - 116 - stickRadius;
    const stickX = stickMode === 'dynamic' ? dynamicX : fixedX;
    const stickY = stickMode === 'dynamic' ? dynamicY : fixedY;
    if (stickMode === 'fixed' || dynamicActive) {
      circle(stickX, stickY, stickRadius, 'rgba(255, 255, 255, 0.13)', 'rgba(255, 255, 255, 0.3)');
      circle(stickX, stickY, 34 * scale, 'rgba(255, 255, 255, 0.55)', 'rgba(255, 255, 255, 0.8)');
      if (sneaking) {
        drawText(context, '潜行', stickX, stickY - stickRadius - 22, 15, 'rgba(255, 255, 255, 0.85)', 'center');
      }
    }

    // 顶部居中暂停
    const pauseSize = 50;
    const pauseX = canvas.width / 2 - pauseSize / 2;
    const pauseY = safeTop + 8;
    squareButton(pauseX, pauseY, pauseSize, () =>
      drawPauseIcon(pauseX + pauseSize / 2, pauseY + pauseSize / 2),
    );

    // 快捷栏右侧背包（设计宽 1024，快捷栏右缘 832）
    const bagSize = 50;
    const bagX = 840;
    const bagY = canvas.height - safeBottom - 84;
    squareButton(bagX, bagY, bagSize, () => drawBagIcon(bagX + bagSize / 2, bagY + bagSize / 2));

    // 右下跳跃：Web 76px / 844 ≈ 92 设计单位；左手模式镜像到左侧
    const jumpRadius = 46 * scale;
    const jumpX = leftHanded
      ? safeLeft + 24 + jumpRadius
      : safeRight - 24 - jumpRadius;
    const jumpY = canvas.height - safeBottom - 116 - jumpRadius;
    circle(jumpX, jumpY, jumpRadius, 'rgba(255, 255, 255, 0.16)', 'rgba(255, 255, 255, 0.34)');
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.beginPath();
    context.moveTo(jumpX, jumpY - 20);
    context.lineTo(jumpX - 16, jumpY + 2);
    context.lineTo(jumpX - 5, jumpY + 2);
    context.lineTo(jumpX - 5, jumpY + 20);
    context.lineTo(jumpX + 5, jumpY + 20);
    context.lineTo(jumpX + 5, jumpY + 2);
    context.lineTo(jumpX + 16, jumpY + 2);
    context.closePath();
    context.fill();

    if (flying) {
      drawText(context, '飞行', jumpX, jumpY - jumpRadius - 18, 14, 'rgba(190, 245, 210, 0.9)', 'center');
    }

    // 操作提示（Web 同款圆角深色底，放在快捷栏上方、目标名之上）
    const hint = '摇杆走 · 双击摇杆潜行 · 拖动看 · 轻点放 · 按住挖 · 双击跳起飞';
    const hintY = canvas.height - safeBottom - 260;
    const hintWidth = Math.min(canvas.width - 100, hint.length * 15 + 28);
    const hintX = (canvas.width - hintWidth) / 2;
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    const r = 15;
    context.beginPath();
    context.moveTo(hintX + r, hintY - 9);
    context.arcTo(hintX + hintWidth, hintY - 9, hintX + hintWidth, hintY + 21, r);
    context.arcTo(hintX + hintWidth, hintY + 21, hintX, hintY + 21, r);
    context.arcTo(hintX, hintY + 21, hintX, hintY - 9, r);
    context.arcTo(hintX, hintY - 9, hintX + hintWidth, hintY - 9, r);
    context.closePath();
    context.fill();
    drawText(
      context,
      hint,
      canvas.width / 2,
      hintY,
      15,
      'rgba(255, 255, 255, 0.86)',
      'center',
      hintWidth - 16,
    );

    texture.needsUpdate = true;
  };

  redraw();

  return {
    setFlying(active: boolean): void {
      if (flying === active) return;
      flying = active;
      redraw();
    },
    setSneaking(active: boolean): void {
      if (sneaking === active) return;
      sneaking = active;
      redraw();
    },
    setLayout(nextLeftHanded: boolean, nextScale: number, nextStickMode: 'fixed' | 'dynamic'): void {
      const scale = Math.max(0.75, Math.min(1.5, nextScale));
      if (
        leftHanded === nextLeftHanded &&
        touchScale === scale &&
        stickMode === nextStickMode
      ) {
        return;
      }
      leftHanded = nextLeftHanded;
      touchScale = scale;
      stickMode = nextStickMode;
      if (stickMode === 'fixed') dynamicActive = false;
      redraw();
    },
    setStickOrigin(x: number, y: number, active: boolean): void {
      if (dynamicX === x && dynamicY === y && dynamicActive === active) return;
      dynamicX = x;
      dynamicY = y;
      dynamicActive = active;
      redraw();
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
