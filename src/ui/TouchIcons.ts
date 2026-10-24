// 多语言 P3-1：图标说明走 `touch.icon.*`
import { t } from '../core/i18n/I18n.ts';

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

export const TOUCH_ICON_NAMES = ['jump', 'sneak', 'inventory', 'chat', 'pause', 'view'] as const;
export type TouchIconName = (typeof TOUCH_ICON_NAMES)[number];

/** 24×24 视口的图标路径（`fill="currentColor"`，颜色交给 CSS） */
const PATHS: Readonly<Record<TouchIconName, string>> = {
  // 跳跃：向上的箭头 + 脚下的地面线（"往上跳"而不是"向上"）
  jump: '<path d="M12 3l6.5 7.5H15V16H9v-5.5H5.5z"/><rect x="4" y="18" width="16" height="2.4" rx="1.2"/>',
  // 潜行：向下的箭头 + 地面线（蹲下）
  sneak: '<path d="M12 21l-6.5-7.5H9V8h6v5.5h3.5z"/><rect x="4" y="3.6" width="16" height="2.4" rx="1.2"/>',
  // 背包：包体 + 双肩带 + 前袋
  inventory:
    '<path d="M6 8h12a2.4 2.4 0 0 1 2.4 2.4v7.2A2.4 2.4 0 0 1 18 20H6a2.4 2.4 0 0 1-2.4-2.4v-7.2A2.4 2.4 0 0 1 6 8z"/><path d="M9 8V6.4a3 3 0 0 1 6 0V8h-2.2V6.6a.8.8 0 0 0-1.6 0V8z"/><rect x="8" y="13" width="8" height="2.2" rx="1.1" opacity=".6"/>',
  // 聊天/命令：对话气泡（手机上除了它没有别的入口）
  chat: '<path d="M4 5.4A2.4 2.4 0 0 1 6.4 3h11.2A2.4 2.4 0 0 1 20 5.4v7.2a2.4 2.4 0 0 1-2.4 2.4H9.6L4 20z"/>',
  // 暂停/设置：两条竖杠（基岩版手机屏幕上方正中的那颗键）
  pause: '<rect x="6" y="4.4" width="4.2" height="15.2" rx="1.4"/><rect x="13.8" y="4.4" width="4.2" height="15.2" rx="1.4"/>',
  // 视角：一只**眼睛**（批次 20261024-1152，用户："换成那种一个小眼睛的形状，保持当前风格"）。
  // 画法沿用同一套"纯填充"：杏仁形眼眶 + evenodd 挖出虹膜 + 实心瞳孔。
  // 瞳孔填 `currentColor`、虹膜是挖空（透出背景），所以小尺寸下也读得出一只眼。
  view:
    '<path fill-rule="evenodd" d="M12 4.4C6.4 4.4 2.6 8.5 1.2 12c1.4 3.5 5.2 7.6 10.8 7.6S21.4 15.5 22.8 12C21.4 8.5 17.6 4.4 12 4.4zm0 3.2a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z"/><circle cx="12" cy="12" r="2.1"/>',
};

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
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
