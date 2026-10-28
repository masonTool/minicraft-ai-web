/**
 * 远端玩家的外观（按昵称稳定派生）
 *
 * 为什么按昵称派生，而不是把真实皮肤同步过去：
 *  - `move` 消息里已经带了手持/副手/盔甲/潜行/挥手这些"装备与动作"，但**没有外观字段**；
 *  - 加字段就要升协议版本，老客户端还得兼容；
 *  - 而"每个人长得不一样"这件事，只要**两端用同一个纯函数算出同一套配色**就够了，
 *    一个字节都不用传。
 *
 * 所以这里用昵称的哈希取各档位下标：同一个名字在任何一端、任何设备上得到同一套
 * 肤色/上衣/裤子/头发/发型/胡须/眼睛/体型。将来真要同步玩家自定义的外观时，
 * 只需把这里的入参换成对端发来的下标——返回类型（`AppearancePalette`）不用动。
 *
 * 纯函数、不碰渲染与网络，`tests/remote-skin.test.ts` 直接断言"两端算出来一样"。
 */

import {
  BEARD_STYLES,
  BODY_BUILDS,
  BODY_FRAMES,
  EYE_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  paletteOf,
  type AppearancePalette,
} from '../../game/appearance.ts';
// 常量定义在协议字段的拥有者那边（`RemoteAppearance` 零依赖，反向引入会成环）
import { REMOTE_LOOK_LENGTH } from './RemoteAppearance.ts';

/**
 * FNV-1a 32 位。
 *
 * 为什么不用 `Math.random` / 时间戳：那个每次打开都不一样，队友在你屏幕上是"另一个人"。
 * 为什么不用 `crypto.subtle`：异步、且非安全上下文（局域网 http）里没有，而这里要的是
 * 一个同步纯函数。
 */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 从一个哈希里取第 `salt` 个档位。
 *
 * 每个字段用不同的盐再混一次，避免"肤色和上衣总是同步变化"——
 * 直接用 `hash % n` 会让两个 6 档字段高度相关（同一个人永远是同一对组合）。
 */
function pick(hash: number, salt: number, length: number): number {
  const mixed = Math.imul(hash ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return mixed % length;
}

/**
 * 昵称 → 一套固定的外观。
 *
 * 空名字（老服务端/异常）统一落到默认外观：给它随机反而不稳定。
 *
 * ⚠️ 现在只作为**兜底**：真正的皮肤走 `move.look`（玩家自己捏的那套）。
 * 只有在"对端没带 look"（老客户端/协议降级）时才用它，好处是至少每个人不一样。
 */
export function remotePaletteFromName(name: string): AppearancePalette {
  const clean = name.trim();
  if (clean.length === 0) return paletteOf(null);
  const hash = hashName(clean);
  return paletteOf({
    skinTone: pick(hash, 0, SKIN_TONES.length),
    shirtColor: pick(hash, 1, SHIRT_COLORS.length),
    pantsColor: pick(hash, 2, PANTS_COLORS.length),
    hairColor: pick(hash, 3, HAIR_COLORS.length),
    hairStyle: pick(hash, 4, HAIR_STYLES.length),
    beard: pick(hash, 5, BEARD_STYLES.length),
    eyes: pick(hash, 6, EYE_STYLES.length),
    eyeColor: pick(hash, 7, EYE_COLORS.length),
    build: pick(hash, 8, BODY_BUILDS.length),
    frame: pick(hash, 9, BODY_FRAMES.length),
  });
}

/**
 * `move.look` 的字段顺序见 `RemoteAppearance.REMOTE_LOOK_LENGTH` 的注释。
 *
 * 存的是**设置里的下标**而不是颜色值：与存档同一套编码（`core/appearance` 的
 * `AppearanceSettings`），所以"我改了什么"和"队友看到什么"用的是同一份东西；
 * 颜色表以后扩充也不会让老客户端解析出错误颜色（下标越界由 `paletteOf` 回退默认）。
 */

/**
 * `move.look` → 外观。长度不够/不是数组返回 `null`（调用方回退到昵称派生）。
 *
 * 每个下标都 `Math.trunc` 并在 `paletteOf` 里夹到合法范围——服务端只做形状收口，
 * 真正的越界回退在这里，老客户端发什么都不会让渲染层拿到 `undefined`。
 */
export function remotePaletteFromLook(look: unknown): AppearancePalette | null {
  if (!Array.isArray(look) || look.length < REMOTE_LOOK_LENGTH) return null;
  const at = (index: number): number => {
    const value = Math.trunc(Number(look[index]));
    return Number.isFinite(value) ? value : 0;
  };
  return paletteOf({
    skinTone: at(0),
    shirtColor: at(1),
    pantsColor: at(2),
    hairColor: at(3),
    hairStyle: at(4),
    beard: at(5),
    eyes: at(6),
    eyeColor: at(7),
    build: at(8),
    frame: at(9),
  });
}
