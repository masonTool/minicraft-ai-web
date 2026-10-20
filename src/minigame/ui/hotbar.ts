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
export function createHotbar(atlas: TextureAtlas, blocks: readonly number[]): Hotbar {
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
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, (2 * height) / width),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  // 贴底：plane 高度 < 1，中心放到底边上方
  mesh.position.set(0, -1 + height / width, 0);
  scene.add(mesh);

  const drawSlot = (index: number, selected: boolean): void => {
    if (!context) return;
    const x = padding + index * (slotSize + gap);
    const y = padding;
    const gradient = context.createLinearGradient(0, y, 0, y + slotSize);
    gradient.addColorStop(0, 'rgba(48, 60, 70, 0.72)');
    gradient.addColorStop(1, 'rgba(8, 12, 16, 0.78)');
    context.fillStyle = gradient;
    context.fillRect(x, y, slotSize, slotSize);
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    context.fillRect(x + 2, y + 2, slotSize - 4, 3);
    context.strokeStyle = selected ? '#9fe0ff' : 'rgba(160, 205, 230, 0.38)';
    context.lineWidth = selected ? 4 : 2;
    context.strokeRect(x + 1, y + 1, slotSize - 2, slotSize - 2);

    drawBlockIcon(context, atlas, currentBlocks[index] ?? 0, x, y, slotSize);
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, width, height);
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
