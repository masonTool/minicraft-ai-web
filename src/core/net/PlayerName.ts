/**
 * 玩家昵称的清洗规则（L9 本批从 `ui/MultiplayerScreen.ts` 搬出来）。
 *
 * 为什么搬到 core：加入面板与开房对话框共用同一套规则，而 `ui` 层之间不该互相 import
 * （`RoomForm` 既被 `MultiplayerScreen` 用，也被 `WorldScreen` 用）。
 *
 * `cleanPlayerName` 与 `sanitizeMultiplayerName` 的区别是**空值怎么办**：
 *  - `cleanPlayerName` 只清洗，空串就是"玩家没填"——UI 层据此当场拦下（昵称必填）；
 *  - `sanitizeMultiplayerName` 兜底成「玩家」——服务端与老存档路径仍可能传空，
 *    那里不该因为一个空串就把连接整条断掉。
 */

/** 昵称上限与服务端 `sanitizeName` 对齐（按字符算，不按字节） */
export const MULTIPLAYER_NAME_MAX = 16;

/** 空昵称的兜底值（与服务端同口径） */
export const DEFAULT_PLAYER_NAME = '玩家';

/** 只清洗不兜底：去控制字符与尖括号、trim、按字符截到 16；空输入返回空串 */
export function cleanPlayerName(input: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  return [...cleaned].slice(0, MULTIPLAYER_NAME_MAX).join('');
}

/** 清洗 + 兜底成「玩家」（服务端/老存档路径用；UI 层请先判 `cleanPlayerName` 是否为空） */
export function sanitizeMultiplayerName(input: string): string {
  return cleanPlayerName(input) || DEFAULT_PLAYER_NAME;
}
