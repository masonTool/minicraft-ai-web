/**
 * 真正的入口（批次 20261025-1032 · 宿主9 收尾）
 *
 * **为什么要有这一层**：生产构建把方块表数据换成了空桩（`blockSpecs.ts` → `[]`），
 * 表只能由 `hostCore` 从 `core.bin` 装。而 `main.ts` 的模块图里有一批模块在**模块初始化期**
 * 就会读方块表——只要 `main.ts` 被静态引入，那些模块会在门禁之前求值，空表下当场
 * `TypeError: Cannot read properties of undefined (reading 'id')`（实测过，页面停在"加载中…"）。
 *
 * 所以顺序必须是：**先取核心数据、装好表，再 `import('./main.ts')`**。
 * 动态 import 保证主包的模块体在装表之后才执行，不依赖任何"某个模块恰好没在顶层读表"的假设。
 *
 * ⚠️ 上一批试过两段式又回退了：那时方块表还在主包里，入口 chunk 与 main chunk **各打一份**，
 * 主包从 1.2 MB 涨到 2.0 MB。现在数据被桩掉、两份都是空的，重复打包的前提已不存在。
 */

import { ensureHostCore } from './core/hostCore.ts';

void (async () => {
  // 拿不到核心数据时 `ensureHostCore()` 已经画好了整屏提示（"去应用里玩" / "请更新应用"），
  // 这里直接放弃即可：没有方块表的世界不报错，只会是一片空白。
  if (!(await ensureHostCore())) return;
  await import('./main.ts');
})().catch((error: unknown) => {
  // 启动期抛错：别让"加载中…"永远转下去（也别说谎说还在加载）。
  // 这里只给玩家一句人话，错误本身照旧 rethrow，交给 `unhandledrejection` 记账。
  // `ui/LoadingOverlay.ts` 是轻模块（只碰 DOM + i18n），可以安全地动态取它
  void import('./ui/LoadingOverlay.ts')
    .then(({ failBootLoading }) => failBootLoading())
    .catch(() => undefined)
    .finally(() => {
      throw error;
    });
});
