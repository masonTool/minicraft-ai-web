/**
 * 资源命名空间（批次 20261025-0117，合规 6）
 *
 * 方块 / 物品 / 进度的注册名原本沿用别人的命名空间前缀（`minicraft:`）。那是一串**内部
 * 标识符**，玩家看不到、也不参与渲染，但既然本项目是独立产品，就没必要继续借用——
 * 统一换成自己的 `minicraft:`。
 *
 * ⚠️ 为什么必须有一个**归一化入口**，而不是简单全局替换：
 *   1. **老存档**：进度是按 id 字符串存的（`earned: string[]`），里面写的是旧前缀；
 *   2. **老命令**：命令方块里的文本、玩家记住的 `/give minecraft:stone` 都带着旧前缀；
 *   3. **老资源包**：`textures/blocks/*.png` 的匹配走文件短名，但 `manifest` 里可能带前缀。
 * 这三处都不能因为"我们改了内部名字"就失效，所以**读**的时候一律先过 `normalizeId()`。
 *
 * 写（新存档、新命令、帮助面板）一律用新前缀。
 */

/** 本项目自己的命名空间 */
export const NAMESPACE = 'minicraft';

/**
 * 历史前缀，**只用于读**。
 *
 * 别把它当成"还支持旧版"的承诺：它存在的唯一理由是让改名前存下的进度、命令文本
 * 和玩家的肌肉记忆不至于突然失效。新写出去的东西一律不带它。
 */
const LEGACY_NAMESPACES: readonly string[] = ['minecraft'];

/** 是否有命名空间前缀（新旧都算） */
export function hasNamespace(raw: string): boolean {
  const at = raw.indexOf(':');
  if (at <= 0) return false;
  const head = raw.slice(0, at);
  return head === NAMESPACE || LEGACY_NAMESPACES.includes(head);
}

/**
 * 归一成 `minicraft:<短名>`。
 *
 * - `stone` → `minicraft:stone`
 * - `minicraft:stone` → `minicraft:stone`（老存档 / 老命令）
 * - `minicraft:stone` → 原样
 *
 * 空串原样返回（调用方自己判空）。
 */
export function normalizeId(raw: string): string {
  if (raw.length === 0) return raw;
  const at = raw.indexOf(':');
  if (at <= 0) return `${NAMESPACE}:${raw}`;
  const head = raw.slice(0, at);
  const rest = raw.slice(at + 1);
  if (head === NAMESPACE) return raw;
  if (LEGACY_NAMESPACES.includes(head)) return `${NAMESPACE}:${rest}`;
  // 别的命名空间（资源包里可能带自己的前缀）：保持原样，别硬掰
  return raw;
}

/**
 * 去掉命名空间，只留短名（新旧前缀都认）。
 *
 * 这是所有"按名字查表"的地方该用的那个函数——查表的键一直是短名。
 */
export function shortId(raw: string): string {
  const at = raw.indexOf(':');
  if (at <= 0) return raw;
  const head = raw.slice(0, at);
  if (head === NAMESPACE || LEGACY_NAMESPACES.includes(head)) return raw.slice(at + 1);
  return raw;
}
