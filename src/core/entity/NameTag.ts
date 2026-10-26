/**
 * 命名牌（M23 的前置，批次 615）
 *
 * 原版行为：拿命名牌右键生物 → 弹出输入框 → 起个名字 → 名字一直显示在头顶；
 * 空手点一下就能再改；名字**跟着生物走进存档**。
 *
 * 这里只做**纯决策**（能不能命名、名字怎么清洗、牌子多宽），
 * 挂渲染与读输入框都在主程序/渲染层——纯逻辑才能在 Node 里逐条断言。
 *
 * ⚠️ 名字走 `Mob.customName`，与铁砧改物品名的 `ItemStack.name` 是两套东西：
 * 前者是"这只生物叫什么"，后者是"这件物品叫什么"。
 */

import { REMOTE_PLAYER_TYPE } from './mobs.ts';

/**
 * 名字长度上限（个字符）。
 *
 * 原版是 32 个**字节**（UTF-8 中文占 3 字节，所以中文实际只能 10 个字左右）。
 * 这里按**字符**算 32 个：本项目是中文为主的客户端，按字节卡会让"三个中文名"就超，
 * 体验上莫名其妙；按字符算则中英一致。宽度另有 `nameTagWidthFor` 兜住，不会撑破屏幕。
 */
export const MAX_NAME_LENGTH = 32;

/**
 * 清洗一个名字。
 *
 * 规则（都要断言）：
 *  ① 去掉首尾空白——空格在头顶渲染成一块空白，看起来像"名字没生效"；
 *  ② 换行/制表/控制字符压成单个空格——牌子是**单行**画的，换行会被浏览器
 *     静默丢掉后半段（玩家会以为名字只写进去了前半截）；
 *  ③ 连续空白压成一个；
 *  ④ 超长截断到 `MAX_NAME_LENGTH`（**按字符**，不会把中文切半个字）；
 *  ⑤ 清完是空串就返回 null（调用方据此提示"名字不能为空"，而不是把生物改成无名）。
 */
export function sanitizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const flattened = raw.replace(/[\r\n\t\v\f\u0000-\u001f]+/g, ' ');
  const collapsed = flattened.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return Array.from(collapsed).slice(0, MAX_NAME_LENGTH).join('');
}

/**
 * 这只生物能不能被命名。
 *
 * 排除两类：
 *  - **末影龙**：原版不允许（它没有"宠物"这个概念，命名牌点它会返回失败）；
 *  - **玩家镜像**（联机里的远程玩家）：那是渲染用的影子，不是生物。
 */
export function canNameMob(typeId: string): boolean {
  if (typeId === 'ender_dragon') return false;
  // 用常量而不是字面量：远程玩家的 id 只在那一处定义，写死字符串会在改名时静默失效
  if (typeId === REMOTE_PLAYER_TYPE.id) return false;
  return true;
}

/**
 * 名字牌的世界宽度（格）。
 *
 * 原版名字牌是**固定字号、随文字变宽**的（不像生命条那样固定宽度）。
 * 这里按"每个字符一个基准宽"估，中文按 2 倍——不这么做的话中文名会被压扁；
 * 同时给一个上限，避免 32 个字的超长名字横穿屏幕。
 */
const CHAR_WIDTH = 0.16;
const WIDE_CHAR_WIDTH = 0.26;
export const NAME_TAG_MAX_WIDTH = 5.2;

/**
 * 名字牌上最多画几个字符（前缀 + 名字 + 后缀合起来）。
 *
 * 为什么需要这条上限：画布是**固定 512×64**（不能改，见 `MobNameTag` 里那个坑），
 * 字号最小缩到 12px。12px 的中文一个字约 12px 宽，512 的可用宽度约 488 →
 * 满打满算 40 个字。再长就只能靠裁掉两端，而"两端被裁"看起来像名字坏了。
 * 所以宁可在拼的时候就截断：**宁可少几个字，也不要露半截字**。
 *
 * 原版没有这条限制（名字牌随文字变宽），这是本项目固定画布带来的差异，记在 TASKS M23。
 */
export const MAX_TAG_TEXT_LENGTH = 40;

/**
 * 把「前缀 + 名字 + 后缀」拼成名字牌上真正要画的文本。
 *
 * 原版是**直接拼、不留分隔符**（`/team modify red prefix [红]` → `[红]Steve`）。
 * 三段都是空/名字本身时原样返回；超过 `MAX_TAG_TEXT_LENGTH` 按**字符**截断
 * （`Array.from` 切开，不会把中文切半个字）。
 *
 * 抽成纯函数是为了让"拼法"能被断言——渲染层只负责把结果画出来。
 */
export function composeNameTag(prefix: string | null | undefined, name: string, suffix: string | null | undefined): string {
  const raw = `${prefix ?? ''}${name}${suffix ?? ''}`;
  const chars = Array.from(raw);
  return chars.length <= MAX_TAG_TEXT_LENGTH ? raw : chars.slice(0, MAX_TAG_TEXT_LENGTH).join('');
}

export function nameTagWidthFor(name: string): number {
  let width = 0;
  for (const char of Array.from(name)) {
    // 全角（中日韩）字符占两个西文宽
    width += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\uff00-\uff60\uffe0-\uffe6]/.test(char)
      ? WIDE_CHAR_WIDTH
      : CHAR_WIDTH;
  }
  // 左右各留一点内边距，字不贴着背景边。
  // ⚠️ 下限只保证"空名字/单字"也有可见的一块底，**不能大到吃掉宽度差**
  // （第一版把下限设成 0.6，于是"牛"和"A"算出来一样宽，中文被压扁了）。
  return Math.min(NAME_TAG_MAX_WIDTH, width + 0.3);
}

/** 名字牌的高度（格）：固定，不随字数变——高度变了会挡住生物的脸 */
export const NAME_TAG_HEIGHT = 0.26;

/**
 * 名字牌画布的固定尺寸（**不能改**：运行中改 canvas 尺寸会让部分 WebGL 实现继续用旧纹理，
 * 表现为"僵尸头顶挂着猫的条"，见 `MobNameTag` 文件头）。
 *
 * 放在 core 是因为它现在是**换算比例的来源**：world = px × NAME_TAG_HEIGHT / 画布高。
 */
export const NAME_TAG_CANVAS_WIDTH = 512;
export const NAME_TAG_CANVAS_HEIGHT = 64;

/**
 * 名字牌的世界宽度：由**实际画出来的背景条像素宽**换算（用户 2026-10-25："名字被压扁"）。
 *
 * 为什么不用按字数估算的 `nameTagWidthFor`：画布里的字号是按 `measureText` **实测**缩放的，
 * 两套算法在长名字上必然分叉——字号被缩到 12px 时文字只占画布高度的 1/5，而 Sprite 仍按
 * 估算宽度横向撑开，字就被拉扁（越长的名字越扁）。这里只保留**一个**像素→世界的比例，
 * 横竖同倍，任何长度都等比缩放。
 */
export function nameTagWorldWidth(boxPx: number, height: number = NAME_TAG_HEIGHT): number {
  // 还没画过（首帧异常）时给一个"看起来正常"的兜底，绝不让 Sprite 宽度变成 0
  if (!(boxPx > 0) || !(height > 0)) return Math.max(0.1, height * 4);
  return (boxPx * height) / NAME_TAG_CANVAS_HEIGHT;
}

/**
 * 队友名字牌的范围（格）= **视距尽头**（用户 2026-10-26）。
 *
 * 以前是 64 格、32 格起渐隐，配合固定的 16 个牌子池，观感就是"名字时有时无"。
 * 用户的诉求是"像常见网游那样，视野里就一直能看到"：只要还在加载范围内就不藏，
 * 也不再随距离变淡（`remoteNameTagOpacity` 那一套因此整个删掉了）。
 *
 * 8 区块视距 = 128 格；比这更远的队友本来也不在渲染范围内。
 */
export const REMOTE_NAME_TAG_RANGE = 128;
