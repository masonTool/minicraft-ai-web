/**
 * 微信小游戏入口（WX-010 起用 vendored 适配器）
 *
 * 早期它是 WX-006 的对比 spike；现在适配器已经 vendored 到
 * `vendor/minigame-adapter/` 并打过补丁，这里改为走正式启动层
 * `src/platform/wx/bootstrap.ts`，不再依赖 `references/`。
 *
 * 当前画面仍是压力场景（WX-020 接入真实 App/UiPort 后会替换掉）。
 *
 * ⚠️ 必须最先 import bootstrap：适配器要先注入 window/document，three 才能初始化。
 */

import '../../../src/platform/wx/bootstrap.ts';
import { detectPlatformKind } from '../../../src/platform/detect.ts';
import { wxPlatform } from '../../../src/platform/wx/index.ts';
import * as THREE from 'three';

/** 构建期注入：正式版 WX-010 FORMAL，对比 spike WX-006 ADAPTER */
const HUD_LABEL = __WX_LABEL__;
const TAG = `[${HUD_LABEL}]`;

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

/** 屏上 HUD：小游戏只有一个上屏 WebGL canvas，用一张 2D canvas 当贴图叠在最上层 */
function createHud() {
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
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), material);
  mesh.position.set(0, 0.72, 0);
  scene.add(mesh);

  return {
    update(lines) {
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = 'rgba(0, 0, 0, 0.62)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '28px monospace';
      context.textBaseline = 'top';
      context.fillStyle = '#ffffff';
      lines.forEach((line, index) => {
        context.fillText(line.slice(0, 78), 18, 16 + index * 54);
      });
      texture.needsUpdate = true;
    },
    render(renderer) {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}

function boot() {
  const width = view.innerWidth;
  const height = view.innerHeight;

  // WX-011：初始化平台层（storage/files/lifecycle/input/audio/worker/socket/keyboard）
  let platformLine = 'platform: n/a';
  try {
    const platform = wxPlatform();
    platformLine = `platform ${platform.kind} sdk ${
      platform.system.sdkVersion ?? '?'
    } bench ${platform.system.benchmarkLevel ?? '?'}`;
    console.log(`${TAG} ${platformLine}`, platform.system, 'detected', detectPlatformKind());
    // Worker 里的 Random 用 BigInt；老引擎缺失时要在 WX-020 降级到主线程生成
    console.log(`${TAG} BigInt`, typeof BigInt === 'function');
  } catch (error) {
    console.error(`${TAG} platform init failed`, error);
    platformLine = `platform: FAIL ${String(error)}`;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas: doc.canvas,
    antialias: false,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x8fc7ff, 1);
  renderer.autoClear = false;

  const gl = renderer.getContext();
  const glVersion = String(gl.getParameter(gl.VERSION));
  const glRenderer = String(gl.getParameter(gl.RENDERER));
  console.log(`${TAG} adapter`, 'inner', width, height, 'dpr', view.devicePixelRatio);
  console.log(`${TAG} navigator`, view.navigator?.platform, view.navigator?.userAgent);
  console.log(`${TAG} GL_VERSION`, glVersion);
  console.log(`${TAG} GL_RENDERER`, glRenderer);

  const hud = createHud();
  hud.update([
    `${HUD_LABEL}  ${width}x${height} dpr ${view.devicePixelRatio}`,
    `GL ${glVersion}`,
    `${platformLine}`,
    'FPS ...  TRI ...  CALLS ...',
  ]);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 300);
  const target = new THREE.Vector3(0, 1, 0);
  let yaw = Math.PI * 0.25;
  let pitch = 0.55;
  // 压力场景铺到 ±16，相机要退远才能看全
  const distance = 46;

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

  // 与 WX-001 完全相同的压力场景：768 个独立 Mesh（~769 draw call）
  const stressGeometry = new THREE.BoxGeometry(1, 1, 1);
  const stressMaterial = new THREE.MeshLambertMaterial({ map: makeGroundTexture() });
  let stressCount = 0;
  for (let sx = 0; sx < 32; sx += 1) {
    for (let sz = 0; sz < 32; sz += 1) {
      const cx = sx - 16;
      const cz = sz - 16;
      if (Math.abs(cx) < 8 && Math.abs(cz) < 8) continue;
      const cube = new THREE.Mesh(stressGeometry, stressMaterial);
      cube.position.set(cx, 0.5 + ((sx * 7 + sz * 13) % 3), cz);
      scene.add(cube);
      stressCount += 1;
    }
  }
  console.log(`${TAG} stress meshes`, stressCount);
  hud.update([
    `${HUD_LABEL}  ${width}x${height} dpr ${view.devicePixelRatio}  STRESS ${stressCount}`,
    `GL ${glVersion}`,
    `${platformLine}`,
    'FPS ...  MS ...  TRI ...  CALLS ...',
  ]);

  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x2dff88 }),
  );
  marker.position.set(0, 4.5, 0);
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
  let fps = 0;
  let lastReport = 0;
  // renderer.info 每次 render() 重置：必须在主场景之后、HUD 之前抓
  let sceneTriangles = 0;
  let sceneCalls = 0;
  const frame = (time) => {
    frames += 1;
    if (time - lastReport >= 1000) {
      const ms = frames > 0 ? (time - lastReport) / frames : 0;
      fps = frames;
      console.log(
        `${TAG} fps=${fps} ms=${ms.toFixed(1)} tri=${sceneTriangles} calls=${sceneCalls}`,
      );
      hud.update([
        `${HUD_LABEL}  ${width}x${height} dpr ${view.devicePixelRatio}  STRESS ${stressCount}`,
        `GL ${glVersion}`,
        `${platformLine}`,
        `FPS ${fps}  MS ${ms.toFixed(1)}  TRI ${sceneTriangles}  CALLS ${sceneCalls}`,
      ]);
      frames = 0;
      lastReport = time;
    }
    marker.rotation.y += 0.012;
    renderer.clear();
    renderer.render(scene, camera);
    sceneTriangles = renderer.info.render.triangles;
    sceneCalls = renderer.info.render.calls;
    hud.render(renderer);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (error) {
  console.error(`${TAG} boot failed`, error);
  wx.showModal({
    title: `${HUD_LABEL} 启动失败`,
    content: String(error && error.stack ? error.stack : error),
    showCancel: false,
  });
}
