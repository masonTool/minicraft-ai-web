/**
 * 生物名字牌的颜色（M23 队伍颜色的纯决策层，批次 616）。
 *
 * 这一层**只做三件事**，不碰 DOM、不碰 THREE、不碰世界：
 *   ① 把队伍颜色名（`white` / `red` …）映射成画布能直接用的 `#rrggbb`；
 *   ② 决定"这只生物的名字该用什么颜色"（没队伍 → `null`，表示沿用默认白）；
 *   ③ 队伍换了颜色时，判断"要不要重画"。
 *
 * 为什么单独一个模块而不是塞进渲染层：颜色表要能被断言——16 色的值对不对、
 * 大小写与拼写变体怎么归一、没队伍时是不是真的返回 `null`（而不是悄悄给白色）。
 * 这些规则一旦混进 `MobNameTag` 的画布代码里，就只能靠肉眼看了。
 *
 * ⚠️ 与 `Teams.TEAM_COLORS` 的关系：那边是**权威名单**（建队时校验用），
 * 这边是**同一个名单的取值表**。两张表必须键集一致，`test:nametag` 里有一条
 * 断言盯着这件事——只改一边会让 `/team modify <队> color <新色>` 建得出队、
 * 却画不出颜色。
 */

import { TEAM_COLORS } from '../world/Teams.ts';

/**
 * 队伍颜色名 → `#rrggbb`。
 *
 * 取的是**基岩版侧边栏/名字牌上实际用的那组值**，不是染料物品的贴图色：
 * 名字牌是画在白字上的小字，用贴图色（尤其 `light_gray` 与 `gray`）会糊成一片。
 * 比原版的聊天色略提亮，是因为这里没有背景板，纯白底上再压暗就看不见了。
 */
export const TEAM_COLOR_HEX: Readonly<Record<string, string>> = {
  white: '#ffffff',
  orange: '#f9801d',
  magenta: '#c74ebd',
  light_blue: '#3ab3da',
  yellow: '#fed83d',
  lime: '#80c71f',
  pink: '#f38baa',
  gray: '#474f52',
  light_gray: '#9d9d97',
  cyan: '#169c9c',
  purple: '#8932b8',
  blue: '#3c44aa',
  brown: '#835432',
  green: '#5e7c16',
  red: '#b02e26',
  black: '#1d1d21',
};

/** 默认颜色（没有队伍时由渲染层自己决定用白色，这里只表达"没有颜色"） */
export const DEFAULT_NAME_COLOR = '#ffffff';

/**
 * 归一化一个颜色名。
 *
 * 接受三种写法，因为这三处来源的拼写历史上就不一致：
 *   · 命令里敲的（`red`，大小写随意）；
 *   · 旧存档里可能存过的带空格写法（`light blue`）；
 *   · 直接写十六进制（`#ff0000`）——命令不给过，但存档被人手改过时会出现。
 *
 * 认不出来返回 `null`（**不回落白色**：回落会让"队伍颜色配错了"这件事
 * 表现成"它就是白的"，查起来很费劲）。
 */
export function normalizeTeamColor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // 已经是十六进制：只认 #rgb / #rrggbb，其余当非法
  if (trimmed.startsWith('#')) {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(trimmed) ? trimmed : null;
  }
  // 带空格的旧写法 → 下划线（`light blue` → `light_blue`）
  const key = trimmed.replace(/\s+/g, '_');
  return TEAM_COLORS.includes(key) ? key : null;
}

/** 队伍颜色名 → `#rrggbb`；认不出来返回 `null` */
export function teamColorToHex(raw: string | null | undefined): string | null {
  const key = normalizeTeamColor(raw);
  if (key === null) return null;
  if (key.startsWith('#')) return key;
  return TEAM_COLOR_HEX[key] ?? null;
}

/**
 * 这只生物的名字该用什么颜色。
 *
 * 判定顺序（与原版一致：**队伍颜色优先于一切**）：
 *   ① 生物有自定义名字，且这个名字是某个队伍的成员 → 用那个队伍的颜色；
 *   ② 否则返回 `null` —— 渲染层用默认白。
 *
 * 为什么用 `customName` 当成员标识：本项目的队伍成员是**名字**（玩家名或
 * `/team join <队> <选择器>` 展开出来的名字），而生物没有 UUID 之外的稳定 id。
 * 用自定义名字去认，正好对上"给这只羊起名叫 Steve、再把 Steve 拉进红队"这个
 * 真实用法；没名字的生物本来也不显示名字牌，无从着色。
 *
 * @param customName 这只生物的自定义名字（`Mob.customName`，可能是 null）
 * @param teamOf 注入的查询函数（通常就是 `Teams#teamOf`），不直接依赖 Teams 实例
 */
export function colorForMob(
  customName: string | null | undefined,
  teamOf: (member: string) => { color?: string } | null | undefined,
): string | null {
  if (typeof customName !== 'string') return null;
  const name = customName.trim();
  if (name.length === 0) return null;
  const team = teamOf(name);
  if (!team) return null;
  return teamColorToHex(team.color ?? null);
}

/**
 * 名字牌要不要重画。
 *
 * 现在的渲染层只比 `lastName`（见 `MobNameTag#show`），于是"名字没变、
 * 但队伍颜色变了"不会触发重画——玩家 `/team modify red color blue` 之后
 * 名字还是红的，直到他改一次名字或重进世界。
 *
 * 所以判据从"名字变了"扩成"名字或颜色变了"。抽成函数是为了让这条规则
 * 能被断言，而不是靠读 `show()` 里的 if。
 */
export function nameTagNeedsRedraw(
  prev: { name: string | null; color: string | null },
  next: { name: string | null; color: string | null },
): boolean {
  return prev.name !== next.name || prev.color !== next.color;
}
