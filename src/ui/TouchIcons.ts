// 多语言 P3-1：图标说明走 `touch.icon.*`
import { t } from '../core/i18n/I18n.ts';
/*
 * 图形数据（六个图标的路径）搬到了 `ui2d/touchArt.ts`：canvas 侧要画同一组图标，
 * 而"照着眼睛抄一份路径"是最容易悄悄画歪的做法（歪了不报错，只是看着不像那个东西）。
 * 依赖方向 `ui/ → ui2d/`，与 `ui/VitalsHud.ts` 用 `ui2d/vitalsArt.ts` 一致。
 */
import {
  TOUCH_ICON_NAMES,
  touchIconSvgMarkup,
  type TouchIconName,
} from '../ui2d/touchArt.ts';

/**
 * 触摸端的按钮图标（界面适配：手机上用图标而不是文字）
 *
 * 为什么不用文字：原来五个按钮是"跳/潜/飞/包/视"五个单字——中文单字在圆形按钮里
 * 既不好看也不好认（"视"到底是什么意思？），而英文缩写对中文玩家更没意义。
 * 图标是跨语言的，且**位置固定的肌肉记忆**（原版基岩版也是图标）。
 *
 * 为什么用内联 SVG 而不是 emoji 或字体图标：
 *  - emoji 在不同系统上字形差异极大（有的彩色有的黑白、有的还会缺字），
 *    玩游戏时"按钮图片没了"比"字丑"严重得多；
 *  - 字体图标要多加载一份字体，而我们的 PWA 是离线优先的。
 *  内联 SVG 就是几行字符串，`fill="currentColor"` 让 CSS 能统一改颜色，
 *  还能跟着 `font-size` 缩放（见 index.html 里的 `.touch-button svg`）。
 *
 * ⚠️ 只画**填充色块**（不依赖描边宽度）：描边在小尺寸下容易糊成一团。
 */

export { TOUCH_ICON_NAMES };
export type { TouchIconName };

/** 图标对应的说明（`aria-label` 与长按提示用，多语言 P3-1） */
export function touchIconLabel(name: TouchIconName): string {
  const key = `touch.icon.${name}`;
  const text = t(`touch.icon.${name}`);
  return text === key ? name : text;
}

/**
 * 一个图标的完整 `<svg>` 字符串（24×24）。
 *
 * `fill="currentColor"` 写在**根元素上**而不是只靠 CSS：`fill` 是可继承属性，
 * 这样即使哪天样式表没加载、或图标被挪到别的地方用，颜色也跟着文字走（不会是黑块）。
 */
export function touchIconSvg(name: TouchIconName): string {
  return touchIconSvgMarkup(name);
}
