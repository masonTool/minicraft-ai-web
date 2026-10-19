/**
 * 告示牌上的文字（B12，批次 80）
 *
 * 这是本项目**第一次把"运行时数据"画到世界上**：牌子上写什么只有玩家知道，
 * 所以不能像方块贴图那样在启动时烘进图集，只能**运行时画一张画布**（`CanvasTexture`）。
 *
 * 做法（每块有字的牌子一份）：
 *  1. 一块 **256×64 的画布**，四行 16px；文字用系统字体画（中文也能显示），
 *     背景透明、字色深灰——就是原版的观感；
 *  2. 一张 `THREE.CanvasTexture` + 一个 1×1 的 `PlaneGeometry`（缩放成牌面大小）；
 *  3. 位置与朝向**完全由方块的几何推出来**（`signBoardBox` + `facing`），
 *     所以"牌面在哪、字就贴在哪"只有一处实现——不会出现"字浮在牌子外面"。
 *
 * 三条容易忽略但必须做的：
 *  - **区块卸载/牌子被拆/换维度时要把 mesh 与贴图一起释放**（`sync` 负责对账）；
 *  - **亮度跟着那一格的光照走**（用 `material.color` 压暗）——
 *    挂牌子最常见的地方是屋里与洞里，看不见字等于没做；
 *  - `depthWrite: false` + 外移一点点：文字平面贴在牌面上，写深度会切掉后面的半透明水面。
 */

import * as THREE from 'three';
import { signTextAnchor } from '../core/registry/blockShapes.ts';

/** 画布尺寸（2 的幂，mipmap 才生效）：四行 16px 正好 64 高 */
const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 64;
const LINE_HEIGHT = 16;
const FONT_SIZE = 14;

/** 牌面文字的宽高（格）：牌面本身是整格宽 × 8/16 高，这里各留一点边距 */
const TEXT_WIDTH = 0.92;
const TEXT_HEIGHT = 0.4;

/**
 * 字色（深灰，接近原版）。
 *
 * 亮度下限取 0.5：夜里露天只有 4 级天光（月光），照原样压会暗到看不清字——
 * 而牌子的意义就是"让人读到"。压暗只做一半，既保留"屋里比屋外暗"的感觉，
 * 又不至于让字消失在阴影里。
 */
const TEXT_COLOR = '#20201c';
const MIN_BRIGHTNESS = 0.5;

/** 一块要显示的牌子 */
export interface SignRenderItem {
  /** 唯一键（`维度|x,y,z`），用于对账 */
  key: string;
  x: number;
  y: number;
  z: number;
  /** 四行文字 */
  lines: readonly string[];
  /** 那一格的光照（0~15）：天光与方块光取较大者 */
  light: number;
  /** 方块状态（朝向 / 是不是挂墙） */
  state: number;
}

interface Entry {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** 上一次画上去的文字（用来判断要不要重画） */
  lines: string[];
  /** 上一次的亮度（用来判断要不要改材质颜色） */
  light: number;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, index) => line === b[index]);
}

/** 按光照压暗材质颜色（`MeshBasicMaterial` 不受光照影响，所以只能自己乘） */
function applyBrightness(entry: Entry, light: number): void {
  const t = Math.max(0, Math.min(15, light)) / 15;
  const value = MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * t;
  (entry.mesh.material as THREE.MeshBasicMaterial).color.setScalar(value);
  entry.light = light;
}

export class SignRenderer {
  readonly group = new THREE.Group();

  private readonly entries = new Map<string, Entry>();
  /** 复用的几何体：所有牌子共用一份（尺寸靠 mesh 的 scale） */
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  /** 复用的对账缓冲，避免每轮新建集合 */
  private readonly seen = new Set<string>();

  constructor() {
    this.group.name = 'sign-text';
  }

  /**
   * 与"当前应该显示什么"对账。
   *
   * 传入的是**这一维度、区块已加载、方块还在**的牌子——筛选放在调用方，
   * 因为"哪些区块加载了、那一格还是不是牌子"是世界的知识，渲染层不该自己去问。
   */
  sync(items: readonly SignRenderItem[]): void {
    this.seen.clear();
    for (const item of items) {
      this.seen.add(item.key);
      const entry = this.entries.get(item.key);
      if (!entry) {
        this.entries.set(item.key, this.create(item));
        continue;
      }
      if (!sameLines(entry.lines, item.lines)) this.paint(entry, item.lines);
      if (entry.light !== item.light) applyBrightness(entry, item.light);
      this.place(entry.mesh, item);
    }

    // 掉出视野的（区块卸载 / 换维度 / 牌子被拆）→ 释放
    for (const [key, entry] of [...this.entries]) {
      if (this.seen.has(key)) continue;
      this.disposeEntry(entry);
      this.entries.delete(key);
    }
  }

  /**
   * 把每块牌子的文字重画一遍（批次 295）。
   *
   * 文字画在 2D canvas 上（`CanvasTexture`），切后台回来可能被系统清空；
   * 而 `sync()` 只在"文字变了"时重画。按缓存的 `lines` 重铺一遍即可，
   * 数量就是当前可见的牌子（通常个位数）。
   */
  repaintAll(): void {
    for (const entry of this.entries.values()) this.paint(entry, entry.lines);
  }

  /** 当前显示的牌子有多少张（验收与调试用） */
  get count(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.geometry.dispose();
  }

  private create(item: SignRenderItem): Entry {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const texture = new THREE.CanvasTexture(canvas);
    // 画布上写的是 sRGB 颜色，交给 three 做一次解码（内置材质走标准色彩管线，
    // 与"图集贴图必须 NoColorSpace"那条正好相反——那条说的是自定义着色器）
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.scale.set(TEXT_WIDTH, TEXT_HEIGHT, 1);
    this.group.add(mesh);

    const entry: Entry = { mesh, texture, canvas, lines: [], light: -1 };
    this.paint(entry, item.lines);
    applyBrightness(entry, item.light);
    this.place(mesh, item);
    return entry;
  }

  /** 把文字画进画布，并标记贴图要重传 */
  private paint(entry: Entry, lines: readonly string[]): void {
    const ctx = entry.canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.font = `bold ${FONT_SIZE}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = TEXT_COLOR;
      for (let i = 0; i < lines.length && i < 4; i++) {
        const text = lines[i]!;
        if (text.length === 0) continue;
        ctx.fillText(text, 4, i * LINE_HEIGHT + 1);
      }
    }
    entry.lines = [...lines];
    entry.texture.needsUpdate = true;
  }

  /**
   * 把文字平面摆到牌面前方。
   *
   * 位置从 `signBoardBox` 推：牌面的**中心** + 沿 `facing` 正方向外移半个厚度，
   * 于是挂墙牌与落地牌不必各写一套（它们只差那个盒子）。
   */
  private place(mesh: THREE.Mesh, item: SignRenderItem): void {
    // 位置与朝向都从注册表那一层的纯函数取（`signBoardBox` + `facing` 推出来），
    // 所以渲染层不必认识"牌面多厚、朝哪边"——那套几何在离线测试里被逐面钉住
    const anchor = signTextAnchor(item.state);
    mesh.position.set(item.x + anchor.x, item.y + anchor.y, item.z + anchor.z);
    // 平面默认朝 +Z（facing 2 朝南时不用转），其余三向按法线转
    mesh.rotation.y = Math.atan2(anchor.nx, anchor.nz);
  }

  private disposeEntry(entry: Entry): void {
    this.group.remove(entry.mesh);
    entry.texture.dispose();
    // 每块牌子的材质是单独建的（贴图不同），所以要逐个释放；
    // 几何体是共用的，只在 `dispose()` 里释放一次
    (entry.mesh.material as THREE.MeshBasicMaterial).dispose();
  }
}
