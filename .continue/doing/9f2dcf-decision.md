# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261028-0812 · Swift 门禁与创造栏过滤

## D59 · Swift 也要有一条不依赖 cargo 的门禁；分页必须夹页号
- 决定：新增 `npm run check:swift`（`swiftc -parse`，无 SDK、无 cargo，缺 `swiftc` 时跳过），并接进 `npm run check` 与 `server/ios/check.sh` 的 ⓪ 步；创造栏的搜索/分页抽成 `ui2d/creativeModel.ts` 纯函数，页号越界一律夹住。
- 为什么：① `check.sh` 的第一步是 `cargo` 编 xcframework，本机常没有 cargo → **Swift 那半边从来没被任何门禁碰过**，少一个括号要等上机才发现；② 分页不夹页号，搜索词一变页数就变，玩家停在"第 5 页"时搜一个只有 3 个结果的词会看到**一屏空白**（这类 bug 只会被用户撞到）。
- 影响：`-parse` 只挡语法，类型与平台 API 仍要 `check.sh` 的 `-typecheck` 或真机；创造栏的剩余工作只有"接进 `?ui2dinv=1`"（把 `itemName` / `creativeTabFor` 喂给宿主）。
