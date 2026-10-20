/**
 * WX-001 spike：最小 three r186 + WebGL2 场景
 *
 * 目标只有一个：**在微信小游戏真机上跑起来并给出可看的数字**。
 * 不接世界生成、不接存档、不接 UI —— 那些是 WX-010 之后的事。
 *
 * 画面：16×16 的程序化贴图地面（InstancedMesh）+ 一个红色标记方块。
 * 交互：单指拖动转视角（验证触摸事件）。
 * 输出：每秒在控制台打印 fps / 三角形数 / draw call。
 *
 * ⚠️ 第一行 import 必须是垫片：three 在模块初始化时就会碰 `document`。
 */

import { mainCanvas, screen, wxApi } from './wx-env.ts';
import * as THREE from 'three';

/** 用 2D canvas 现场生成一张 16×16 的“草地”贴图，顺便验证离屏 canvas + 纹理上传 */
function makeGroundTexture(): THREE.Texture {
  const canvas = wxApi.createCanvas() as unknown as HTMLCanvasElement;
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

function boot(): void {
  const renderer = new THREE.WebGLRenderer({
    canvas: mainCanvas as unknown as HTMLCanvasElement,
    antialias: false,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(screen.dpr, 2));
  renderer.setSize(screen.width, screen.height, false);
  renderer.setClearColor(0x8fc7ff, 1);

  const gl = renderer.getContext();
  console.log('[WX-001] screen', screen.width, screen.height, 'dpr', screen.dpr);
  console.log('[WX-001] GL_VERSION', gl.getParameter(gl.VERSION));
  console.log('[WX-001] GL_RENDERER', gl.getParameter(gl.RENDERER));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, screen.width / screen.height, 0.1, 300);
  const target = new THREE.Vector3(0, 0.5, 0);
  let yaw = Math.PI * 0.25;
  let pitch = 0.55;
  let distance = 26;

  const updateCamera = (): void => {
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

  // 16×16 的方块地面 + 一根 4 格高的柱子（InstancedMesh 同时验证实例化路径）
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
    new THREE.MeshBasicMaterial({ color: 0xff2d55 }),
  );
  marker.position.set(0, 1.2, 0);
  scene.add(marker);

  // 触摸转视角：验证 wx.onTouch* 的坐标与多点事件
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  wxApi.onTouchStart((event) => {
    const touches = event.touches as Array<{ clientX: number; clientY: number }> | undefined;
    const touch = touches?.[0];
    if (!touch) return;
    dragging = true;
    lastX = touch.clientX;
    lastY = touch.clientY;
  });
  wxApi.onTouchMove((event) => {
    if (!dragging) return;
    const touches = event.touches as Array<{ clientX: number; clientY: number }> | undefined;
    const touch = touches?.[0];
    if (!touch) return;
    yaw -= (touch.clientX - lastX) * 0.01;
    pitch = Math.max(0.15, Math.min(1.35, pitch + (touch.clientY - lastY) * 0.01));
    lastX = touch.clientX;
    lastY = touch.clientY;
    updateCamera();
  });
  wxApi.onTouchEnd(() => {
    dragging = false;
  });

  let frames = 0;
  let lastReport = 0;
  const frame = (time: number): void => {
    frames += 1;
    if (time - lastReport >= 1000) {
      const stats = renderer.info.render;
      console.log(`[WX-001] fps=${frames} tri=${stats.triangles} calls=${stats.calls}`);
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
  console.error('[WX-001] boot failed', error);
  wxApi.showModal({
    title: 'WX-001 启动失败',
    content: String(error),
    showCancel: false,
  });
}
