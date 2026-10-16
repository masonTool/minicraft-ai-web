/**
 * WebGL2 可用性判定（A10，批次 85）
 *
 * 在此之前主程序直接 `new THREE.WebGLRenderer(...)`：**拿不到上下文就抛一个
 * "Error creating WebGL context"，然后整页白屏、控制台里一行红字**——
 * 玩家（尤其手机上关了硬件加速、或者浏览器太老的）看到的是一个坏掉的页面，
 * 完全不知道"该怎么办"。
 *
 * 这个模块只做**判定**（纯逻辑、离线可断言），文案与界面在 `ui/UnsupportedScreen.ts`：
 * 与项目里其它"规则 / 界面"分层同一条口径。
 *
 * 判定的价值在于**区分三种情况**——它们的处理建议完全不同：
 *  1. 有 WebGL2：正常；
 *  2. 只有 WebGL1：多半是浏览器太老（提示升级浏览器，而不是"换台电脑"）；
 *  3. 两个都没有：硬件加速被关了、或显卡驱动在浏览器黑名单里
 *     （提示"开硬件加速 / 更新驱动"，这在 Windows 上是最常见的一种）。
 */

export interface GlSupportOk {
  readonly ok: true;
}

export interface GlSupportFail {
  readonly ok: false;
  /** 一句话原因（给玩家看） */
  readonly reason: string;
  /** 具体怎么办（给玩家看，2~3 条） */
  readonly advice: readonly string[];
  /** 归类：给日志与断言用 */
  readonly kind: 'no-webgl1' | 'no-webgl2' | 'context-lost' | 'unknown';
}

export type GlSupport = GlSupportOk | GlSupportFail;

/** 探测接口：由调用方提供（浏览器里是真的 canvas，离线测试里给假的） */
export interface GlProbe {
  /** 试着创建 webgl2 上下文；失败返回 null */
  webgl2(): unknown | null;
  /** 试着创建 webgl1 上下文；失败返回 null */
  webgl1(): unknown | null;
  /** 上下文刚拿到就丢了（`isContextLost()`；拿不到就算了） */
  lost?(): boolean;
}

/** 三种情况的文案（**一处定义**：界面只负责显示） */
export const GL_FAIL_TEXT = {
  'no-webgl2': {
    reason: '这台设备的浏览器只支持 WebGL1，而这个游戏需要 WebGL2。',
    advice: [
      '升级到较新的浏览器（Chrome / Edge / Safari 15+ / Firefox 都行）',
      '如果是 Safari：iOS 15 与 macOS 12 以上才支持 WebGL2',
    ],
  },
  'no-webgl1': {
    reason: '浏览器拿不到任何 3D 绘图上下文（WebGL 被完全禁用了）。',
    advice: [
      '打开浏览器的"硬件加速"（Chrome：设置 → 系统 → 使用硬件加速）',
      '更新显卡驱动；如果是远程桌面/虚拟机，试试在真机上打开',
      '有些浏览器扩展会禁用 WebGL，可以先用无痕窗口试一次',
    ],
  },
  'context-lost': {
    reason: '3D 绘图上下文刚创建就丢失了（通常是显卡内存不足）。',
    advice: ['关掉一些其它标签页再刷新', '把浏览器的硬件加速重开一次'],
  },
  unknown: {
    reason: '无法创建 WebGL2 绘图上下文。',
    advice: ['刷新页面重试', '换一个浏览器试试'],
  },
} as const;

/**
 * 根据探测结果给出结论。
 *
 * ⚠️ 顺序要紧：**先问 webgl2**——只有 WebGL1 的浏览器（老 Safari）如果先问 webgl1，
 * 会被判成"完全不可用"，而那条建议是"去开硬件加速"，对老 Safari 毫无用处。
 */
export function classifyGlSupport(probe: GlProbe): GlSupport {
  const gl2 = probe.webgl2();
  if (gl2) {
    if (probe.lost?.() === true) return { ok: false, kind: 'context-lost', ...GL_FAIL_TEXT['context-lost'] };
    return { ok: true };
  }
  const gl1 = probe.webgl1();
  if (gl1) return { ok: false, kind: 'no-webgl2', ...GL_FAIL_TEXT['no-webgl2'] };
  return { ok: false, kind: 'no-webgl1', ...GL_FAIL_TEXT['no-webgl1'] };
}

/** 浏览器里的真实探测（不碰 THREE，只碰 canvas） */
export function probeBrowserGl(): GlSupport {
  const probe: GlProbe = {
    webgl2: () => {
      try {
        return document.createElement('canvas').getContext('webgl2');
      } catch {
        return null;
      }
    },
    webgl1: () => {
      try {
        const canvas = document.createElement('canvas');
        return canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      } catch {
        return null;
      }
    },
  };
  return classifyGlSupport(probe);
}

/**
 * 把一句话交给"这台设备上到底行不行"的判断——**给 `new WebGLRenderer()` 兜底用**。
 *
 * 明明探测到了 WebGL2、却在真正创建渲染器时抛错（显存不足、上下文数量上限…
 * 手机上真实发生过），这时不该白屏：把它归成"上下文创建失败"并给出同一条建议。
 */
export function rendererFailure(message: string): GlSupportFail {
  const lower = message.toLowerCase();
  const kind = lower.includes('lost') ? 'context-lost' : 'unknown';
  return { ok: false, kind, ...GL_FAIL_TEXT[kind] };
}
