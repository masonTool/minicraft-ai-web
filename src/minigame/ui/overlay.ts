import * as THREE from 'three';
import { drawPanel, drawProgressBar, drawText } from './widgets.ts';

export interface Overlay {
  showToast(message: string): void;
  setLoading(progress: number | null, text?: string): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/** Toast + 世界生成进度（WX-023/025） */
export function createOverlay(screenWidth: number, screenHeight: number): Overlay {
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

  let toast: string | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let loading: { progress: number; text: string } | null = null;

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (loading) {
      const width = 500;
      const height = 108;
      const x = (canvas.width - width) / 2;
      const y = canvas.height * 0.42;
      drawPanel(context, { x, y, w: width, h: height });
      drawText(context, loading.text, x + 24, y + 18, 20, '#ffffff');
      drawProgressBar(
        context,
        { x: x + 24, y: y + 60, w: width - 48, h: 18 },
        loading.progress,
      );
      drawText(
        context,
        `${Math.round(loading.progress * 100)}%`,
        x + width - 24,
        y + 18,
        18,
        'rgba(255, 255, 255, 0.7)',
        'right',
      );
    }

    if (toast) {
      const width = Math.min(canvas.width - 80, 140 + toast.length * 14);
      const x = (canvas.width - width) / 2;
      const y = canvas.height - 164;
      drawPanel(context, { x, y, w: width, h: 52 });
      drawText(context, toast, x + width / 2, y + 14, 20, '#ffffff', 'center', width - 32);
    }

    texture.needsUpdate = true;
  };

  return {
    showToast(message: string): void {
      toast = message;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast = null;
        toastTimer = null;
        redraw();
      }, 1600);
      redraw();
    },
    setLoading(progress: number | null, text = 'GENERATING WORLD'): void {
      if (progress === null) {
        if (!loading) return;
        loading = null;
        redraw();
        return;
      }
      const next = Math.max(0, Math.min(1, progress));
      // 百分比不变就不重画，避免每帧刷新 2D canvas
      if (loading && Math.round(loading.progress * 100) === Math.round(next * 100) && loading.text === text) {
        return;
      }
      loading = { progress: next, text };
      redraw();
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!toast && !loading) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
