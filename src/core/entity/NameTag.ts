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
