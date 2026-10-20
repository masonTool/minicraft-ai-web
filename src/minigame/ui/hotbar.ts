import * as THREE from 'three';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';

export interface Hotbar {
  setSelected(index: number): void;
  setBlocks(blocks: readonly number[]): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * 六格快捷栏（WX-021 第一个 canvas UI 组件）
 *
 * 用图集里的真实 tile 画图标，避免再维护一套物品图标资源。
 * 只在切换槽位时重画 2D canvas；每帧只渲染一张全屏四边形。
 */
export function createHotbar(
  atlas: TextureAtlas,
  blocks: readonly number[],
  screenWidth: number,
  screenHeight: number,
): Hotbar {
  const slotSize = 64;
  const gap = 8;
  const padding = 8;
  const slotCount = blocks.length;
  const width = slotCount * slotSize + (slotCount - 1) * gap + padding * 2;
  const height = slotSize + padding * 2;
  let currentBlocks = [...blocks];
  let currentSelected = 0;

  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) context.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const designWidth = 1024;
  const planeWidth = (2 * width) / designWidth;
  const planeHeight =
    (2 * (height / designWidth) * screenWidth) / Math.max(1, screenHeight);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(planeWidth, planeHeight),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  // 保持设计尺寸并贴底：宽度/高度按 1024 设计宽等比缩放
  mesh.position.set(0, -1 + planeHeight / 2, 0);
  scene.add(mesh);

  const drawSlot = (index: number, selected: boolean): void => {
    if (!context) return;
    const x = padding + index * (slotSize + gap);
    const y = padding;
    const gradient = context.createLinearGradient(0, y, 0, y + slotSize);
    gradient.addColorStop(0, selected ? 'rgba(92, 112, 128, 0.86)' : 'rgba(58, 64, 70, 0.9)');
    gradient.addColorStop(1, selected ? 'rgba(30, 42, 52, 0.9)' : 'rgba(24, 28, 32, 0.92)');
    context.fillStyle = gradient;
    context.fillRect(x, y, slotSize, slotSize);
    context.fillStyle = selected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)';
    context.fillRect(x + 2, y + 2, slotSize - 4, 3);
    context.strokeStyle = selected ? '#9fe0ff' : 'rgba(160, 205, 230, 0.38)';
    context.lineWidth = selected ? 4 : 2;
    context.strokeRect(x + 1, y + 1, slotSize - 2, slotSize - 2);

    drawBlockIcon(context, atlas, currentBlocks[index] ?? 0, x, y, slotSize);
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(24, 26, 28, 0.92)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
    context.fillRect(2, 2, width - 4, 3);
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.fillRect(2, height - 5, width - 4, 3);
    context.strokeStyle = 'rgba(205, 210, 215, 0.6)';
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, width - 3, height - 3);
    for (let i = 0; i < slotCount; i++) drawSlot(i, i === currentSelected);
    texture.needsUpdate = true;
  };

  redraw();

  return {
    setSelected(index: number): void {
      currentSelected = Math.max(0, Math.min(slotCount - 1, index));
      redraw();
    },
    setBlocks(next: readonly number[]): void {
      currentBlocks = Array.from({ length: slotCount }, (_, index) => next[index] ?? 0);
      redraw();
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
