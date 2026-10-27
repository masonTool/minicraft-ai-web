/**
 * canvas 界面的文字（`src/ui2d/` 阶段 0）
 *
 * **为什么不做字形图集（SDF/MSDF）**：界面有 6 种语言，中日韩按码点就有几千个，
 * 做图集等于把"字体"搬进构建期；而 `fillText` 直接用系统字体，中英文的字宽、
 * 基线、连字都是浏览器算好的。代价是每次绘制要过一遍浏览器的字形缓存，所以这里
 * 只做两件自保：**测量结果缓存**（同一句话每帧量一次是纯浪费）与**只在排版决策时测量**
 * （正常绘制一次 `fillText` 就够）。
 *
 * ⚠️ 断行按**码点**分词而不是按空格分：CJK 没有空格，按空格分会整段不换行；
 * 拉丁词则粘成 token，避免把 `diamond_sword` 拆成两截。
 *
 * 这个文件在 `import` 期不碰任何 DOM（`CanvasRenderingContext2D` 只当类型用），
 * 所以离线测试可以直接引它 —— 纯排版函数都用 `Measure` 回调注入测量。
 */

/** 与 `index.html` 的 `body { font-family: … }` 同一串（等宽打底 + 中文回退黑体） */
export const UI_FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'PingFang SC', 'Microsoft YaHei', monospace";

/** 拼一份字体描述（字号一律 **CSS px**：绘制时 ctx 已经按 DPR 缩放过） */
export function uiFont(size: number, weight: 400 | 600 | 700 = 400): string {
  return `${weight} ${size}px ${UI_FONT_STACK}`;
}

/** 测量回调：`(文本, 字体) → 宽度`。测试里塞一个"每字 7px"的假实现即可 */
export type Measure = (text: string, font: string) => number;

export const ELLIPSIS = '…';

/**
 * 测量缓存的上限。
 *
 * 界面上的字符串是**有界**的（物品名、设置项、标题），但也有 `1/64`、坐标这类
 * 每帧都在变的数字。不清的话这张表会随游玩时长无限长 —— 满了整表清空即可，
 * 重建成本只是一次 measureText。
 */
export const MEASURE_CACHE_LIMIT = 512;
const measureCache = new Map<string, number>();

/** 带缓存的测量（key 用 `\u0000` 分隔：字体串里不会有这个字符） */
export function cachedMeasure(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  const previous = ctx.font;
  ctx.font = font;
  const width = ctx.measureText(text).width;
  ctx.font = previous;
  if (measureCache.size >= MEASURE_CACHE_LIMIT) measureCache.clear();
  measureCache.set(key, width);
  return width;
}

/** 只给测试用：清掉测量缓存 */
export function clearMeasureCache(): void {
  measureCache.clear();
}

/** 这个码点算不算"可以在任意位置断行"的 CJK / 全角字符 */
export function isCjkCodePoint(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x2eff) || // 部首补充
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0x3040 && code <= 0x30ff) || // 假名
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // 基本区
    (code >= 0xac00 && code <= 0xd7af) || // 谚文
    (code >= 0xf900 && code <= 0xfaff) || // 兼容表意
    (code >= 0xfe30 && code <= 0xfe4f) || // 兼容形式
    (code >= 0xff00 && code <= 0xffef) // 全角
  );
}

/**
 * 切成断行 token。
 *
 * - CJK 一个码点一个 token；
 * - 拉丁字母/数字/下划线粘成一个 token，**尾随空格留在 token 里**（换行时再 trim）；
 * - 空格跟在谁后面就归谁，这样 `你好 world` 拼回去仍是原样。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (const ch of text) {
    if (isCjkCodePoint(ch)) {
      if (word.length > 0) {
        tokens.push(word);
        word = '';
      }
      tokens.push(ch);
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (word.length > 0) {
        tokens.push(`${word} `);
        word = '';
      } else if (tokens.length > 0) {
        tokens[tokens.length - 1] += ' ';
      } else {
        word = ' ';
      }
      continue;
    }
    word += ch;
  }
  if (word.length > 0) tokens.push(word);
  return tokens;
}

/**
 * 截断到指定宽度（超了就在末尾补 `…`）。
 *
 * 从尾部逐个码点删：界面上的字符串都很短（<40 字），O(n) 次缓存测量完全够用，
 * 而二分法在"删掉一个全角字符就跨过阈值"这种情形下要额外处理边界。
 */
export function truncateToWidth(measure: Measure, text: string, font: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (measure(text, font) <= maxWidth) return text;
  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep > 0; keep--) {
    const candidate = `${chars.slice(0, keep).join('')}${ELLIPSIS}`;
    if (measure(candidate, font) <= maxWidth) return candidate;
  }
  return measure(ELLIPSIS, font) <= maxWidth ? ELLIPSIS : '';
}

/**
 * 按宽度折行。
 *
 * @param maxLines 最多几行；超出的部分**不再显示**，最后一行用 `…` 收尾
 *   （不返回"多余的行"是刻意的：canvas 里多一行就会盖住下面的东西，
 *   而调用方基本都只想"最多显示 2~3 行"）。
 */
export function wrapToWidth(
  measure: Measure,
  text: string,
  font: string,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  if (!(maxWidth > 0) || maxLines <= 0) return [];
  const lines: string[] = [];
  for (const hardLine of String(text).split('\n')) {
    let line = '';
    for (const token of tokenize(hardLine)) {
      if (line.length === 0) {
        line = token.trimStart();
      } else if (measure(line + token, font) <= maxWidth) {
        line += token;
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
      }
      // 单个 token 自身就超过一行：按码点硬切（长 URL / 超长单词）
      while (measure(line, font) > maxWidth) {
        const chars = Array.from(line);
        let cut = chars.length - 1;
        while (cut > 1 && measure(chars.slice(0, cut).join(''), font) > maxWidth) cut--;
        lines.push(chars.slice(0, cut).join(''));
        line = chars.slice(cut).join('');
      }
    }
    lines.push(line.trimEnd());
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[kept.length - 1] ?? '';
  const room = maxWidth - measure(ELLIPSIS, font);
  kept[kept.length - 1] = `${truncateToWidth(measure, last, font, room)}${ELLIPSIS}`;
  return kept;
}

/** 原版文字阴影：1px 右下、黑色 70% */
export const TEXT_SHADOW_COLOR = 'rgba(0, 0, 0, .7)';

export interface DrawTextOptions {
  readonly font: string;
  readonly color: string;
  readonly align?: CanvasTextAlign;
  readonly baseline?: CanvasTextBaseline;
  /** 原版那层 1px 阴影（浅底上的深色字可以关掉） */
  readonly shadow?: boolean;
  /** 给了就按这个宽度截断（末尾补 `…`） */
  readonly maxWidth?: number;
  readonly alpha?: number;
}

/** 画一行文字（不折行；折行请先用 `wrapToWidth` 切好再逐行调用） */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: DrawTextOptions,
): void {
  if (text.length === 0) return;
  const { font, color, align = 'left', baseline = 'alphabetic', shadow = true, maxWidth, alpha = 1 } = options;
  const shown =
    maxWidth === undefined
      ? text
      : truncateToWidth((value, family) => cachedMeasure(ctx, value, family), text, font, maxWidth);
  if (shown.length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (shadow) {
    ctx.fillStyle = TEXT_SHADOW_COLOR;
    ctx.fillText(shown, x + 1, y + 1);
  }
  ctx.fillStyle = color;
  ctx.fillText(shown, x, y);
  ctx.restore();
}
