/**
 * 密度函数组合树（D2，批次 607）
 *
 * 1.18 的地形密度在数据包里是一棵 JSON 树：constant / noise / spline /
 * add / mul / min / max / clamp / interpolated。现有生成器为了性能走的是
 * 手写快路径（`OverworldGenerator.densityAt`），这棵树是**可序列化的通用框架**：
 *  - 工具/实验可以按 JSON 组合密度，不必改生成器；
 *  - 以后把快路径替换成树求值时，有统一的节点定义与校验。
 *
 * 求值只依赖注入的 `noise` 回调，因此离线可测、也不绑定具体种子。
 */

import { Spline, type SplinePoint } from './noise/Spline.ts';

export type DensityNode =
  | { type: 'constant'; value: number }
  | { type: 'noise'; name: string; xzScale?: number; yScale?: number }
  | { type: 'spline'; input: DensityNode; points: SplinePoint[] }
  | { type: 'add' | 'mul' | 'min' | 'max'; left: DensityNode; right: DensityNode }
  | { type: 'clamp'; input: DensityNode; min: number; max: number }
  /**
   * 三线性插值：children 按 `[x0y0z0, x1y0z0, x0y1z0, x1y1z0, x0y0z1, x1y0z1, x0y1z1, x1y1z1]`
   * 排列；在 `floor(x/y/z)` 的八个角上分别求值，再按小数部分插值。
   */
  | { type: 'interpolated'; children: DensityNode[] };

export interface DensityContext {
  x: number;
  y: number;
  z: number;
  /** 按名字取噪声值；没接噪声的节点会得到 0 */
  noise?: (name: string, x: number, y: number, z: number) => number;
}

const splineCache = new WeakMap<object, Spline>();

export function evaluateDensity(node: DensityNode, ctx: DensityContext): number {
  switch (node.type) {
    case 'constant':
      return node.value;
    case 'noise': {
      const value = ctx.noise?.(node.name, ctx.x * (node.xzScale ?? 1), ctx.y * (node.yScale ?? 1), ctx.z * (node.xzScale ?? 1));
      return value ?? 0;
    }
    case 'spline': {
      let spline = splineCache.get(node);
      if (!spline) {
        spline = new Spline(node.points);
        splineCache.set(node, spline);
      }
      return spline.apply(evaluateDensity(node.input, ctx));
    }
    case 'add':
      return evaluateDensity(node.left, ctx) + evaluateDensity(node.right, ctx);
    case 'mul':
      return evaluateDensity(node.left, ctx) * evaluateDensity(node.right, ctx);
    case 'min':
      return Math.min(evaluateDensity(node.left, ctx), evaluateDensity(node.right, ctx));
    case 'max':
      return Math.max(evaluateDensity(node.left, ctx), evaluateDensity(node.right, ctx));
    case 'clamp':
      return Math.max(node.min, Math.min(node.max, evaluateDensity(node.input, ctx)));
    case 'interpolated':
      return evaluateInterpolated(node.children, ctx);
  }
}

function evaluateInterpolated(children: readonly DensityNode[], ctx: DensityContext): number {
  const x0 = Math.floor(ctx.x);
  const y0 = Math.floor(ctx.y);
  const z0 = Math.floor(ctx.z);
  const tx = ctx.x - x0;
  const ty = ctx.y - y0;
  const tz = ctx.z - z0;

  const at = (index: number, x: number, y: number, z: number): number =>
    evaluateDensity(children[index]!, { ...ctx, x, y, z });

  const c000 = at(0, x0, y0, z0);
  const c100 = at(1, x0 + 1, y0, z0);
  const c010 = at(2, x0, y0 + 1, z0);
  const c110 = at(3, x0 + 1, y0 + 1, z0);
  const c001 = at(4, x0, y0, z0 + 1);
  const c101 = at(5, x0 + 1, y0, z0 + 1);
  const c011 = at(6, x0, y0 + 1, z0 + 1);
  const c111 = at(7, x0 + 1, y0 + 1, z0 + 1);

  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0v = x00 + (x10 - x00) * ty;
  const y1v = x01 + (x11 - x01) * ty;
  return y0v + (y1v - y0v) * tz;
}

/** 深拷贝成纯 JSON；节点本身就是纯对象，这里拒绝函数/undefined 混进来 */
export function densityToJson(node: DensityNode): unknown {
  return JSON.parse(JSON.stringify(node)) as unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 校验并还原一棵密度树。
 *
 * 非法节点直接抛错（而不是返回 null）：密度树是“配置”，读错时安静退化会让
 * 地形悄悄变样；调用方应当看到失败。
 */
export function densityFromJson(raw: unknown): DensityNode {
  if (!raw || typeof raw !== 'object') throw new Error('密度节点必须是对象');
  const node = raw as Record<string, unknown>;
  switch (node.type) {
    case 'constant':
      if (!isFiniteNumber(node.value)) throw new Error('constant 需要有限 value');
      return { type: 'constant', value: node.value };
    case 'noise':
      if (typeof node.name !== 'string') throw new Error('noise 需要 name');
      if (node.xzScale !== undefined && !isFiniteNumber(node.xzScale)) throw new Error('noise.xzScale 非法');
      if (node.yScale !== undefined && !isFiniteNumber(node.yScale)) throw new Error('noise.yScale 非法');
      return {
        type: 'noise',
        name: node.name,
        ...(node.xzScale !== undefined ? { xzScale: node.xzScale } : {}),
        ...(node.yScale !== undefined ? { yScale: node.yScale } : {}),
      };
    case 'spline': {
      if (!Array.isArray(node.points) || node.points.length < 2) throw new Error('spline 至少 2 个点');
      const points: SplinePoint[] = node.points.map((entry) => {
        if (!entry || typeof entry !== 'object') throw new Error('spline 控制点非法');
        const point = entry as Record<string, unknown>;
        if (!isFiniteNumber(point.location) || !isFiniteNumber(point.value)) {
          throw new Error('spline 控制点需要有限 location/value');
        }
        if (point.derivative !== undefined && !isFiniteNumber(point.derivative)) {
          throw new Error('spline.derivative 非法');
        }
        return {
          location: point.location,
          value: point.value,
          ...(point.derivative !== undefined ? { derivative: point.derivative } : {}),
        };
      });
      return { type: 'spline', input: densityFromJson(node.input), points };
    }
    case 'add':
    case 'mul':
    case 'min':
    case 'max':
      return {
        type: node.type,
        left: densityFromJson(node.left),
        right: densityFromJson(node.right),
      };
    case 'clamp':
      if (!isFiniteNumber(node.min) || !isFiniteNumber(node.max) || node.min > node.max) {
        throw new Error('clamp 的 min/max 非法');
      }
      return { type: 'clamp', input: densityFromJson(node.input), min: node.min, max: node.max };
    case 'interpolated': {
      if (!Array.isArray(node.children) || node.children.length !== 8) {
        throw new Error('interpolated 需要 8 个角点');
      }
      return { type: 'interpolated', children: node.children.map((child) => densityFromJson(child)) };
    }
    default:
      throw new Error(`未知密度节点类型：${String(node.type)}`);
  }
}
