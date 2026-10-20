/**
 * WX-006 spike：minigame-adapter + three r186
 *
 * 与 WX-001 的 shim 版对比：
 *   - WX-001 用我们自己写的 `src/minigame/spike/wx-env.ts`
 *   - 这里用参考项目 `minigame-adapter`（870d66f）的完整兼容层
 *
 * 目的：确认适配器能不能让 three r186 在微信小游戏里拿到 WebGL2 并正常渲染；
 * 同时观察适配器对 Canvas.getContext 的包装是否明显拖慢帧率。
 *
 * ⚠️ 这个入口只在本地 spike 使用，适配器从 `references/` 直接引入，不提交到仓库；
 * 正式方案（WX-007 之后）才会把必要模块选择性移植到 `src/platform/wx/**`。
 */

import './define-globals.mjs';
import '../../../references/minigame-publisher/minigame-adapter/index.js';
import * as THREE from 'three';

const doc = globalThis.document;
const view = globalThis;

function makeGroundTexture() {
  const canvas = doc.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  if (context) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const noise = (x * 7 + y * 13) % 6;
        context.fillStyle = `rgb(${62 + noise * 6}, ${132 + noise * 9}, ${58 + noise * 5})`;
        context.fillRect(x, y, 1, 1);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function boot() {
  const width = view.innerWidth;
  const height = view.innerHeight;
  const renderer = new THREE.WebGLRenderer({
    canvas: doc.canvas,
    antialias: false,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x8fc7ff, 1);

  const gl = renderer.getContext();
  console.log('[WX-006] adapter', 'inner', width, height, 'dpr', view.devicePixelRatio);
  console.log('[WX-006] navigator', view.navigator?.platform, view.navigator?.userAgent);
  console.log('[WX-006] GL_VERSION', gl.getParameter(gl.VERSION));
  console.log('[WX-006] GL_RENDERER', gl.getParameter(gl.RENDERER));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 300);
  const target = new THREE.Vector3(0, 0.5, 0);
  let yaw = Math.PI * 0.25;
  let pitch = 0.55;
  const distance = 26;

  const updateCamera = () => {
    const horizontal = Math.cos(pitch) * distance;
    camera.position.set(
      target.x + Math.cos(yaw) * horizontal,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.sin(yaw) * horizontal,
    );
    camera.lookAt(target);
  };
  updateCamera();

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(8, 18, 6);
  scene.add(sun);

  const groundCount = 16 * 16 + 4;
  const ground = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
    groundCount,
  );
  const matrix = new THREE.Matrix4();
  let index = 0;
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) {
      matrix.makeTranslation(x - 8, -0.5, z - 8);
      ground.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  for (let level = 0; level < 4; level += 1) {
    matrix.makeTranslation(-2, 0.5 + level, -2);
    ground.setMatrixAt(index, matrix);
    index += 1;
  }
  ground.instanceMatrix.needsUpdate = true;
  scene.add(ground);

  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x2dff88 }),
  );
  marker.position.set(0, 1.2, 0);
  scene.add(marker);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  wx.onTouchStart((event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    dragging = true;
    lastX = touch.clientX;
    lastY = touch.clientY;
  });
  wx.onTouchMove((event) => {
    if (!dragging) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    yaw -= (touch.clientX - lastX) * 0.01;
    pitch = Math.max(0.15, Math.min(1.35, pitch + (touch.clientY - lastY) * 0.01));
    lastX = touch.clientX;
    lastY = touch.clientY;
    updateCamera();
  });
  wx.onTouchEnd(() => {
    dragging = false;
  });

  let frames = 0;
  let lastReport = 0;
  const frame = (time) => {
    frames += 1;
    if (time - lastReport >= 1000) {
      const stats = renderer.info.render;
      console.log(`[WX-006] fps=${frames} tri=${stats.triangles} calls=${stats.calls}`);
      frames = 0;
      lastReport = time;
    }
    marker.rotation.y += 0.012;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (error) {
  console.error('[WX-006] boot failed', error);
  wx.showModal({
    title: 'WX-006 启动失败',
    content: String(error && error.stack ? error.stack : error),
    showCancel: false,
  });
}
