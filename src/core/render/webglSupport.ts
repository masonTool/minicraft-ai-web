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

import { t } from '../i18n/I18n.ts';

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
  readonly kind: GlFailKind;
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

/** 四种失败归类（界面只负责显示，文案在 `notice.webgl.*`） */
export type GlFailKind = 'no-webgl1' | 'no-webgl2' | 'context-lost' | 'unknown';

/**
 * 四种情况的文案（多语言 P6-5b：原来是一张中文常量表，德语/俄语界面上会露中文）。
 *
 * ⚠️ 必须是**函数**而不是常量对象：常量在模块加载时求值，记的是"那一刻的语言"，
 * 切语言后不会变（同 `DESCRIPTIONS` 那个坑）。这里**取用这一刻**才查表。
 *
 * ⚠️ 每条 `t()` 都写成模板字面量/字面量，`audit:i18n` 才认得出这 13 条键被引用了。
 */
export function glFailText(kind: GlFailKind): { reason: string; advice: readonly string[] } {
  switch (kind) {
    case 'no-webgl2':
      return {
        reason: t('notice.webgl.noWebgl2.reason'),
        advice: [t('notice.webgl.noWebgl2.advice1'), t('notice.webgl.noWebgl2.advice2')],
      };
    case 'no-webgl1':
      return {
        reason: t('notice.webgl.noWebgl1.reason'),
        advice: [
          t('notice.webgl.noWebgl1.advice1'),
          t('notice.webgl.noWebgl1.advice2'),
          t('notice.webgl.noWebgl1.advice3'),
        ],
      };
    case 'context-lost':
      return {
        reason: t('notice.webgl.contextLost.reason'),
        advice: [t('notice.webgl.contextLost.advice1'), t('notice.webgl.contextLost.advice2')],
      };
    default:
      return {
        reason: t('notice.webgl.unknown.reason'),
        advice: [t('notice.webgl.unknown.advice1'), t('notice.webgl.unknown.advice2')],
      };
  }
}

/**
 * 根据探测结果给出结论。
 *
 * ⚠️ 顺序要紧：**先问 webgl2**——只有 WebGL1 的浏览器（老 Safari）如果先问 webgl1，
 * 会被判成"完全不可用"，而那条建议是"去开硬件加速"，对老 Safari 毫无用处。
 */
export function classifyGlSupport(probe: GlProbe): GlSupport {
  const gl2 = probe.webgl2();
  if (gl2) {
    if (probe.lost?.() === true) return { ok: false, kind: 'context-lost', ...glFailText('context-lost') };
    return { ok: true };
  }
  const gl1 = probe.webgl1();
  if (gl1) return { ok: false, kind: 'no-webgl2', ...glFailText('no-webgl2') };
  return { ok: false, kind: 'no-webgl1', ...glFailText('no-webgl1') };
}

/** 浏览器里的真实探测（不碰 THREE，只碰 canvas） */
export function probeBrowserGl(): GlSupport {
  const probe: GlProbe = {
    webgl2: () => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        // 探测用的上下文用完立刻释放：否则这个离屏 WebGL 上下文会一直占着 GPU，
        // 主菜单停留时笔记本也会保持唤醒/发热。
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return gl;
      } catch {
        return null;
      }
    },
    webgl1: () => {
      try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl') ??
          canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return gl;
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
  return { ok: false, kind, ...glFailText(kind) };
}
