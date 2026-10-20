import * as THREE from 'three';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';

export interface Hotbar {
  setSelected(index: number): void;
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
  const width = blocks.length * slotSize + (blocks.length - 1) * gap + padding * 2;
  const height = slotSize + padding * 2;

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
    context.fillStyle = 'rgba(0, 0, 0, 0.48)';
    context.fillRect(x, y, slotSize, slotSize);
    context.strokeStyle = selected ? '#ffffff' : 'rgba(255, 255, 255, 0.32)';
    context.lineWidth = selected ? 4 : 2;
    context.strokeRect(x + 1, y + 1, slotSize - 2, slotSize - 2);

    drawBlockIcon(context, atlas, blocks[index] ?? 0, x, y, slotSize);
  };

  const redraw = (selected: number): void => {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < blocks.length; i++) drawSlot(i, i === selected);
    texture.needsUpdate = true;
  };

  redraw(0);

  return {
    setSelected(index: number): void {
      redraw(Math.max(0, Math.min(blocks.length - 1, index)));
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
