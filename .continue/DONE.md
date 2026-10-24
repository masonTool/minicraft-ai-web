# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261023-2351 · 2026-10-24 · 会话 974b5553

> 本批 44 条、说明很长（原队列 60KB），这里只保留每条的一行验证；**完整说明（做了什么 / 为什么 / 未验证）见 `.continue/.logs/974b55/queue.md`**。

- [x] [联机1] 补协议文档：新增 `docs/NET-PROTOCOL.md`（现有 16 条消息的方向/字段/校验），`server/index.mjs` 头注释改指它 → `npm run audit:docs` 通过
  - 验证：`npm run audit:docs` 通过；`npm run check:fast` 全绿
- [x] [联机2] 握手校验：`join` 带 `{v, name, clientId}`，服务端校验版本/名字长度/重复 clientId，不兼容回 `error{code:'version'}` 并关闭 → `npm run test:net` 新增“旧版本被拒 / 脏名字被截断”
  - 验证：`npm run test:net` **35 通过 / 0 失败**；新增 `tests/net-client-id.test.ts`（8 条）+ `tests/net-protocol-version.test.ts`（4 条），单测全量 314 → **326**；`npm run check:fast` 全绿
- [x] [联机3] 加入即上报位置与维度，远端玩家按维度过滤：`NetPlayerState` 保留 `dimension`，`main.ts` 渲染远端前比对当前维度 → `npm run test:unit` 新增 `tests/net-remote-dimension.test.ts`
  - 验证：`npm run test:net` 35 → **39 通过**；新增 `tests/net-remote-dimension.test.ts` **6 条全过**；主树单测 **163 → 169**；`npm run check:fast` 全绿
- [x] [联机4] 未加载区块的远端方块改动不再丢：`main.ts onNetBlock` 先 `world.edits.record` 进缓冲，区块加载回调再应用 → `npm run test:unit` 新增 `tests/net-block-buffer.test.ts`
  - 验证：`npx vitest run tests/net-block-buffer.test.ts` **9 条全过**；主树单测 **169 → 178**（24 文件）；`npm run typecheck` 通过
- [x] [联机5] 种子对齐：以服务端种子为准，不一致时提示并提供“用该种子新建多人世界 / 重载当前世界”；含世界重载路径（清 chunk/实体/edits/时间/玩家位置）→ `npm run test:unit` 新增 `tests/net-seed.test.ts` + `npm run test:save`
  - 验证：`npx vitest run tests/net-seed.test.ts` **8 条全过**；主树单测 **178 → 186**（25 文件）；`npm run test:commands` 435 → **440 通过**；`npm run test:save` **111 通过**；`npm run test:net` **39 通过**；`npm run audit:i18n` 六语言 2831/2831 100%、无孤儿键
- [x] [联机6] 多人存档隔离：联机世界按 roomId 派生独立库，服务器 edits/容器不写进单机档；退出联机回原单机世界 → `npm run test:save`
  - 验证：新增 `tests/net-mp-save.test.ts` **7 条全过**；主树单测 **186 → 193**（26 文件）；`npm run test:save` **111 通过**；`npm run typecheck` 通过
- [x] [联机7] 心跳、超时与会话状态机：服务端 5s ping / 20s 无 pong 断开；客户端 `connecting|connected|reconnecting|offline` 收进纯逻辑 `core/net/NetSession.ts` → `npm run test:unit` 新增 `tests/net-session.test.ts` + `npm run test:net`
  - 验证：`npx vitest run tests/net-session.test.ts` **8 条全过**；`npm run test:net` 39 → **40 通过**；主树单测 **193 → 201**；`npm run typecheck` 通过
- [x] [联机8] 断线重连会话恢复：服务端 30s grace 按 clientId 保留 id 与掉落物，重连复用 id；客户端保留 localId 不重发 → `npm run test:net` 新增“3 秒内重连复用 id”
  - 验证：`npm run test:net` 40 → **43 通过**；客户端 `localId` 由 `main.ts` 分配、重连时不重置，因此重新冒出的掉落物不会与旧的撞键；`npm run typecheck` 通过；`check:fast` 全绿
- [x] [联机9] 最小连接入口（不是大厅）：地址/昵称/连接/断开/状态，主菜单与暂停菜单各一个入口，横屏可点；新增 `src/ui/MultiplayerScreen.ts` + 六语言文案 → `npm run test:ui` + `npm run test:i18n` + `npm run shot`
  - 验证：`npm run test:ui` **934 通过 / 0 失败**；`npm run test:i18n` **547 通过**（六语言新键齐全、分组文件同构）；`npm run typecheck` 通过；`npm run check:fast` 全绿
- [x] [联机10] 时间与天气权威：服务端维护 `timeOfDay`/`weather`，join 下发 + 每 2s 校正广播，客户端按 dt 推算只做插值 → `npm run test:net` + `npm run test:weather`
  - 验证：新增 `tests/net-time.test.ts` **12 条全过**；`npm run test:net` 43 → **45 通过**；主树单测 **201 → 213**；`npm run typecheck` 通过
- [x] [联机11] 睡眠与跳夜广播：任一玩家睡满即跳夜（先按本项目口径），服务端广播时间跳变并清天气，差异记台账 → `npm run test:net` + `npm run test:bed`
  - 验证：`npm run test:net` 45 → **48 通过**；`npm run test:bed` **117 通过 / 0 失败**（单机睡眠逻辑没动）；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 191 注意），新注记已进 `TASKS.md` 第 5686 行
- [x] [联机12] 方块写入统一出口：在 `World.events.onBlockChanged` 上挂广播（覆盖红石/流体/火焰/作物/漏斗/爆炸），远端应用时抑制回声，100ms 合帧批量发 → `npm run test:unit` 新增 `tests/net-block-funnel.test.ts` + `npm run test:net`
  - 验证：新增 `tests/net-block-funnel.test.ts` **9 条全过**；`npm run test:net` 48 → **50 通过**；主树单测 **213 → 222**；`redstone`/`hopper`/`furnace`/`net` 四套离线全绿；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 192 注意）
- [x] [联机13] 服务端持久化：新增 `server/store.mjs`，edits/容器/时间/天气落盘，启动加载、定时 + 退出保存、损坏文件回退备份 → `npm run test:net` 新增“重启后快照仍在”
  - 验证：`npm run test:net` 50 → **58 通过**（新增 8 条：重启前的客户端能加入 / 重启后服务端能再起来 / 重启后拿到 welcome / **重启后方块改动还在** / **重启后容器内容还在** / 坏快照下服务端仍能起来 / 坏快照被备份/ 坏快照之后从空世界开始）；测试用 `mkdtempSync` 的临时 `DATA_DIR`，不碰开发者自己的 `server/.data/`；`npm run typecheck` 通过；`npm…
- [x] [联机14] 快照裁剪与容量策略：welcome 只发玩家附近 edits，`MAX_EDITS` 满时淘汰最旧并告警（不再静默丢）→ `npm run test:net` 新增大快照裁剪断言
  - 验证：新增 `tests/net-snapshot-policy.test.ts` **10 条全过**；`npm run test:net` 58 → **60 通过**；主树单测 **222 → 232**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 194 注意）
- [x] [联机15] 容器同步扩展到全部工作站：箱子/木桶/熔炉/高炉/烟熏炉/酿造台/发射器/投掷器/漏斗，统一“变更出口”而非打开时才挂 → `npm run test:net` + `npm run test:furnace` + `npm run test:hopper`
  - 验证：新增 `tests/net-container-sync.test.ts` **9 条全过**；`npm run test:net` 60 → **63 通过**；主树单测 **232 → 241**；`npm run check:fast` 全绿，命中 **40 套**离线
- [x] [联机16] 告示牌文字与展示框内容同步（B12/B14 现在写着“联机不广播”），更新差异台账 → `npm run test:net` + `npm run test:sign` + `npm run test:frame`
  - 验证：`npm run test:net` 63 → **67 通过**；`sign` / `frame` / `net` 三套离线全绿；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 196 注意）
- [x] [联机17] 玩家外观状态：手持物/副手/盔甲/潜行/挥手/受伤/着火/骑乘/睡觉，扩展 `NetPlayerState` 并接到渲染 → `npm run test:unit` 新增 `tests/net-player-state.test.ts`
  - 验证：新增 `tests/net-player-state.test.ts` **12 条全过**；`npm run test:net` 67 → **69 通过**；主树单测 **241 → 253**；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 197 注意）
- [x] [联机18] 队友名字牌：`main.ts` 现在明确跳过远程玩家，改成显示昵称 + 距离衰减 → `npm run test:nametag`
  - 验证：`npm run test:nametag` 143 → **149 通过 / 0 失败**；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 198 注意）
- [x] [联机19] 生物同步：位置/血量/状态广播 + 远端插值/降频，AI 仍各端跑（差异记台账）→ `npm run test:unit` 新增 `tests/net-mob-sync.test.ts` + `npm run test:net`
  - 验证：新增 `tests/net-mob-sync.test.ts` **7 条全过**；`npm run test:net` 69 → **73 通过**；主树单测 **253 → 260**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 199 注意）
- [x] [联机20] 远端实体 AOI 与分级降频：16 格每 100ms、32 格每 250ms、更远不发 → 单测分级函数 + `npm run test:perf`
  - 验证：新增 `tests/net-aoi.test.ts` **11 条全过**；`npm run test:perf` 40 → **44 通过**；主树单测 **260 → 271**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 200 注意）
- [x] [联机21] 掉落物拾取仲裁：服务端 first-come 锁 + 扣减广播，镜像可捡；解决 L7“远端堆拿不到” → `npm run test:net` 新增“双客户端抢同一堆只有一边拿到”
  - 验证：`npm run test:net` 73 → **78 通过**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 201 注意）
- [x] [联机22] PvP 与队伍免伤：伤害来源接 `Teams.sameTeam()`，`/team friendlyfire` 真正生效（M23 卡住的两项）→ `npm run test:commands` + `npm run test:net`
  - 验证：`npm run test:commands` 440 → **444 通过**；`npm run test:net` 78 → **82 通过**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 203 注意）
- [x] [联机23] 其余实体同步：箭/TNT/经验球/船与矿车按优先级；不做的写进差异台账 → `npm run test:net` + `npm run test:entity`
  - 验证：`npm run test:net` 82 → **86 通过**；`npm run test:entity` **199 通过 / 0 失败**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 204 注意）
- [x] [联机24] 消息校验：方块 id 白名单、y 范围、state 位宽、与玩家距离上限（block/container 都校验）→ `npm run test:net` 新增脏消息用例
  - 验证：新增 `tests/net-block-validation.test.ts` **9 条全过**；`npm run test:net` 86 → **92 通过**；主树单测 **271 → 280**；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 206 注意）
- [x] [联机25] 限频与体积：全局令牌桶（block/container/chat）、`maxPayload` 64KB、名字字符清洗 → `npm run test:net` 新增“刷屏被限”
  - 验证：新增 `tests/net-ratelimit.test.ts` **8 条全过**；`npm run test:net` 92 → **95 通过**；主树单测 **280 → 288**；`npm run audit:diffs` 重建台账（66 差异 / 208 注意）
- [x] [联机26] 房间码、可选密码、Origin/Token 校验：一房一世界，拒绝跨站连接 → `npm run test:net` 新增“错 origin 被拒 / 两个房间互不串”
  - 验证：新增 `tests/net-server-url.test.ts` **6 条全过**；`npm run test:net` 95 → **105 通过**；主树单测 **288 → 294**；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 210 注意）
- [x] [联机27] 广播 AOI：玩家/方块/实体按 8 区块 + 维度过滤，O(n²) → O(n·k) → 单测过滤函数 + `npm run test:net`（不该收到的收不到）
  - 验证：新增 `tests/net-aoi-broadcast.test.ts` **5 条全过**（半径内外边界 / 对角 128,128 收到而 144,144 不收（切比雪夫语意）/ 维度不同不收 / 负坐标按区块取整 / 非法坐标与缺玩家）；`npm run test:net` 105 → **110 通过**；主树单测 **294 → 299**；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / …
- [x] [联机28] wss 与部署：`ws` 从 devDependencies 移到 dependencies、`defaultServerUrl` 支持同源 `/ws` 与 `wss://`、补 Dockerfile/反代/健康检查、更新 README 与 `notes/ops.md` → `npm run build` + 生产依赖下 `node server/index.mjs` 能起
  - 验证：`tests/net-server-url.test.ts` **6 → 9 通过**；`npm run test:net` 110 → **113 通过**；`npm run build:fast` 出包成功；`npm run typecheck` 通过；`npm run check:fast` **172 套全量绿**（改了配置文件 → 走全量）；`npm run audit:diffs` 重建台账（66 差异 / 212 注意）
- [x] [联机29] 观测与诊断：服务端人数/带宽/TPS 日志与 `/healthz`，客户端 F3 面板加 ping/丢包/上下行 → `npm run check` 全绿
  - 验证：新增 `tests/net-stats.test.ts` **11 条全过**；`npm run test:net` 113 → **115 通过**；`npm run typecheck:tools` **0 错误**；**`npm run check` EXIT=0 全绿**
- [x] [联机30] 修聊天重复回显（写协议文档时发现）：服务端 `chat` 广播包含发送者，客户端又本地回显一次；改成服务端不再回传给发送者 → `npm run test:net` 新增“发送者只收到一份”
  - 验证：`npm run test:net` 115 → **117 通过**；`npm run audit:diffs` 台账与条目一致（66 差异 / 213 注意）
- [x] [联机31] 远端掉落物镜像补维度（做联机3 时发现）：`NetItemState` 与 `item` / `item-remove` 广播都不带 `dimension`，队友在下界掉的东西会画在主世界同坐标；加字段并在 `main.ts` 建镜像与渲染时按维度过滤 → `npm run test:net` 新增“跨维度掉落物不通告”
  - 验证：`npm run test:net` 117 → **119 通过**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 214 注意）
- [x] [联机32] 单测别把工作树副本跑进去（做联机3 时发现）：`vitest run tests` 会把 `.continue/doing/.worktree/*/tests/` 一起收集，45 文件 / 332 条里一半是副本，计数虚高一倍且工作树的红会污染主树门禁 → 在 `vite.config.ts` 加 `test.exclude` 排除 `.continue/**`，之后主树应回到 23 文件 / 169 条 → `npx vitest run` 输出 23 个文件 + `npm run check:fast` 全绿
  - 验证：`npx vitest run` 与 `npm run test:unit` 都变成 **24 文件 / 178 条**；`npm run typecheck` 通过；`npm run check:fast` 全绿
- [x] [联机33] 区块加载后才补上的远端容器要建实体（做联机4 时发现）：`ensureBlockEntityAt` 只在 `block`/`welcome` 的「已加载」分支调，经增量表补上的漏斗/箱子/发射器只有方块、没有容器表项（打开是空的、漏斗不搬东西）；在 `World.events.onChunkLoaded` 里按增量表里该区块的容器类方块补建 → `npm run test:unit` 新增“补上的漏斗能打开”
  - 验证：新增 `tests/net-container-spawn.test.ts` **5 条全过**；主树单测 **313 → 318**（40 个文件）；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 215 注意）
- [x] [联机34] 世界原地重载（做联机5/6 时拆出来的硬骨头）：`resetWorld(seed)` 重建 `World` 与渲染侧缓存、清实体/掉落物/TNT/漏斗定时器/时间/位置/维度，再从指定存档库把 edits/容器/牌子/展示框/进度叠回去
  - 验证：`tests/world-reset.test.ts` **7 条全过**；`npm run typecheck` 通过；`npm run check:fast` 全绿（6 套命中，含 `render`）；主树单测 **318 → 325**
- [x] [联机35] 天气权威（做联机10 时拆出来的另一半）：服务端维护 `weather`（晴/雨/雷），join 下发 + 切换时广播，客户端联机时**不再自己掷骰子**（`WeatherState.ts` 的自动切换要让位），只负责渲染降水 → `npm run test:weather` + `npm run test:net` 新增「天气广播与客户端接管」
  - 验证：`tests/net-weather.test.ts` **4 条全过**（下一段种类 / 持续时长 / 推进（未到点与到点）/ 雨与雷暴一律转晴）——**它当场抓到一处抄错**：`STORM_SECONDS_*` 我写成 180~420，客户端实际是 120~300；`npm run test:weather` **58 通过 / 0 失败**（客户端规则没动）；`npm run test:net` 119 → **120 通过**；主树单测 **325 → 32…
- [x] [发现] `net` 套件并发下偶发超时红：`tools/run-tests.mjs --changed` 里 `net` 与 `guard` 同时跑时，`net` 偶发跑满 10.5s 被判失败（本轮撞见两次：联机11、联机12 提交前守卫各拦下一次，重跑即过；单跑稳定 4.8s）→ 怀疑是固定端口 8787 加 5s 心跳等待叠加，改成随机空闲端口（或让 `run-tests` 把它标成独占），连续 10 次 `--changed` 不再出现 10s 红
  - 验证：`npm run test:net` **69 通过 / 0 失败**；`node tools/run-tests.mjs --changed` **连跑 5 次全绿**
- [x] [联机37] 外观剩下的三件事（做联机17 时拆出来）：① 远端模型的**下蹲/骑乘/睡觉姿势**（要动 `MobRenderer` 骨架）；② 玩家**盔甲**数据源（现在只有 `armorColors` 简化模型，没有逐槽物品）；③ **副手槽**（同上，且要进存档与背包界面）→ 批次按用户裁决**只做 ①**，②③ 拆成 `联机40` / `联机41`
  - 验证：`tests/mob-pose.test.ts` **5 条全过**；主树单测 **329 → 334**；`npm run typecheck` 通过；`npm run check:fast` 命中 **30 套全绿**
- [x] [联机38] 生物**位置**同步的前置（联机19 只做了命中事件）：① 定"谁权威"——最省的是"离这只生物最近的玩家上报"，其余端只收；② 定全局实体 id（服务端按 `ownerId:localId` 记，与 `items` 同一套）；③ 定**影子抑制**规则（收到远端生物时本地 AI 不能再生成一份同名同类型的怪，否则玩家看到双份）→ 产出：`core/net/MobAuthority.ts` 纯函数（谁该上报 / id 是否新鲜）+ 单测；做完后可以给联机19 补上位置与插值
  - 验证：`tests/mob-authority.test.ts` **12 条** + `tests/mob-shadows.test.ts` **9 条**，全过；主树单测 **334 → 355**；`npm run typecheck` 通过
- [x] [发现] `net` 套件已跑满 14s，并发下偶发红：`check:fast` 里它与 `guard` 并发时本轮又红了一次（单独跑 95 通过、连跑 `--changed` 三次全绿；证据：`tools/run-tests.mjs --changed` 的 `最慢：net 14.08s`）→ 把套件里重复的 join/固定 `sleep` 抽成公共夹具、限频用例改小规模或挪到独立的慢速套件，让 `net` 回到 6~8s，并连跑 5 次 `--changed` 不再出现并发红
  - 验证：`npm run test:net` **120 通过 / 0 失败**、耗时 **18.53s → 12.61s**（-32%）；`node tools/run-tests.mjs --only net --only guard` **连跑 5 次全绿**（改前并发下两次红）；全量 `check:fast` **172/172 套全绿**，`最慢：structure 17.07s · net 13.52s · guard 11.10s`
- [x] [联机39] 让世界可换（做联机34 时卡住的前置）：`main.ts` 的 `world` 去掉 readonly、`ChunkRenderer`（以及之后任何 `private readonly world` 的渲染器）改成 `setWorld(world)` 或可重建；配套一个 `npm run shot` 的验收步骤（换世界后画面正常、旧区块不残留）→ 先只有这一层，接通过之后再回 `联机34` 写执行路径
  - 验证：结论由 `联机34` 的实现反向验证——`World.reset()` + `reloadWorld()` 在 `3451c264` 落地，`tests/world-reset.test.ts` **7 条全过**、`npm run check:fast` 全绿；本条自己没有代码产出（当初判断"必须换实例"是错的，`readonly world` 与 `ChunkRenderer` 的绑定一直没动）
- [x] [联机40] 玩家盔甲改成逐槽数据源（做联机17/37 时拆出来）：现在只有 `armorColors` 简化模型（渲染用颜色，不知道是什么甲），要改成"头盔/胸甲/护腿/靴子"四槽的真实物品 id，跟随存档（`联机13` 的玩家快照）与 `move` 外观一起传 → **要改存档格式（旧档迁移）**，等用户拍；做完后 `联机37` 的 `armor[]` 字段才有真实含义
  - 验证：`tests/net-remote-armor.test.ts` **8 条全过**；主树单测 **355 → 363**；`npm run typecheck` 通过；`npm run check:fast` 全绿（5 套）
- [x] [联机41] 副手槽（做联机17/37 时拆出来）：背包多一个副手槽（盾牌/火把/食物），要进存档、背包界面、`F` 键交换、以及 `move` 的 `offhand` 字段真正生效 → **同样要改存档格式**，与 `联机40` 一起拍板
  - 验证：`tests/offhand.test.ts` **6 条全过**；主树单测 **363 → 369**；`npm run typecheck` 通过；`npm run check:fast` 全绿（5 套）
- [x] [发现] 远端看不到副手的物品：`core/entity/MobEquipment.ts` 的接口只有 `mainHand/head/chest/legs/feet`，`MobRenderer` 也只按 `equipment.mainHand` 画手持物 —— 于是联机41 传上去的 `offhand` 目前只存不用 → 给 `MobEquipment` 加 `offHand` 并在 `MobRenderer` 画第二个手持部件（左手位置），做完后队友举盾你能看见
  - 验证：`tests/net-remote-armor.test.ts` **8 → 11 条全过**；`npm run typecheck` 通过；`npm run check:fast` 命中 **45 / 172 套全绿**（含 `equipment` / `mob` / `render`，说明改装备槽没打破既有断言）
- [x] [自审] 全批收口自审：三层目标逐层给结论与证据，勾成 `[x]` 时下方必须有 `- L1：` / `- L2：` / `- L3：` 三行 → 收尾时补齐
  - 验证：见 L1——369 条单测 / 47 文件、`test:net` 120 通过、守卫 6 项全绿都是本轮实际跑过的（`check:fast` 45/172 与全量 172/172 各跑过一次）；L2/L3 的证据是各功能条目自己的测试与文档，不是推断

## 批次 20261024-0257 · 2026-10-24 · 会话 4024a9d4

- [x] [E1] 界面文案收口：`WORLD_TYPE_HINTS`（5 条世界类型说明）→ `world.typeHint.*`；`main.ts` 的 **25 处 HUD toast**（名字/驯服/装鞍/牵绳/猪灵交易/袭击/图腾…）→ `misc.toast.*`；`WorldScreen` 的种子提示与生存警告 → `world.seedHint` / `world.survivalWarn`；告示牌编辑器标题 → `misc.signEditorHint`；外观预设 4 条 → `label.appearance.preset.*`
  - 做了什么：新增 **34 条键 × 6 语言 = 204 条**（27 条 `misc.toast.*` + 2 条 `world.*` + 5 条 `world.typeHint.*` + 4 条 `label.appearance.preset.*` + 1 条 `misc.signEditorHint`），表 2786 → **2825**
  - 做法：`WORLD_TYPE_HINTS` 常量表改成 `worldTypeHint(type)` 函数（模板字面量让审计认键）；`main.ts` 25 处 toast 全部改成 `t()` / `tp()`，其中 12 处带 `{kind}`（生物名）、1 处带 `{item}`/`{count}`、1 处带 `{mode}`
  - ⚠️ 这是**上一轮我判断错的地方**：我说 `CHARACTER_PRESETS[].label` "没有 UI 读它"，其实 `SettingsScreen.ts:1598` 就是 `button.textContent = preset.label` —— 外观设置的四个预设按钮直接显示它。这次是按 `textContent =` 这个出口反查才发现的
  - ⚠️ 又一条同类：`WORLD_TYPE_HINTS`（世界类型下面的说明文字，玩家创建世界时看）也是中文常量表，且它和 `worldTypeLabel()`（已 i18n）**不是同一张表**，之前几轮一直没被发现
  - 改了 3 条既有 `ui` 断言（判据锚点从中文字面量改成键/函数）：世界类型说明、四个角色预设、拴绳提示；另改 `tests/appearance.test.ts` 一条（`preset.label` → `preset.id`）
  - 新增 5 条断言：de/ru/fr/pt 各一条「界面文案不含中文、不露键名」（取样 10 条：预设 2 / 世界类型 2 / 种子提示 / toast 3 / 告示牌）+ 中文下仍是原说法
  - 验证：浏览器实测 `?lang=de` → 创建世界界面显示 `Volle Welt: Biome, Bäume, Erze, Dörfer, Festungen… für Überleben empfohlen`（世界类型说明已是德语）；`test:i18n` **547 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2825 条、0 缺口 / 0 孤儿
  - 批次：20261024-0257

- [x] [E2] 清理两处**没人读的**中文 label 字段 + 复查全仓
  - 做了什么：`Rules.ts` 的 `DifficultyProfile.label`（和平/简单/普通/困难）与接口字段**删除** —— 使用点全是 `.mobDamage` / `.starveRate` / `.spawnCap`，没有一处读 `.label`；`Difficulty` 的显示名仍由 `difficultyLabel()` 走 `cmd.label.difficulty.*`
  - 复查结论（`textContent=` / `.show(` / `label:` / `placeholder:` / `aria-label` 反查）：全仓**只剩 `GenerationSources.ts` 的 19 条**中文 label，其读者只有 `tools/genregistry-test.ts`，**玩家不可见** → 保留（与 `diagPerf.ts` 同类，属开发者数据）
  - 顺带确认**深链已经好了**：`?lang=de` → `html lang=de` + 正文德语、`?lang=pt` → `pt-BR`、`fr` / `ru` 同样正确（之前 P4-5 记的"深链不生效"是旧状态，P5-2 已修，本批实测通过）
  - 验证：`grep` 确认 `DIFFICULTY_PROFILES` 无 `.label` 读者；`test:offline` 172 / 172 套全绿；`test:i18n` 547 / 0
  - 批次：20261024-0257

---

## 批次 20261024-0245 · 2026-10-24 · 会话 4024a9d4

- [x] [D1] 第 ⑤ 类真遗漏：`BeaconScreen` 的 6 个效果按钮（`power.label` = 速度/急迫/抗性提升/跳跃提升/力量/生命恢复）复用 `effectLabel()`；`WorldScreen` 的 `aria-label='关闭'` 与 `error.textContent='保存失败，请重试'` 入表
  - 做了什么：`BeaconScreen` 的 **6 个效果按钮**（速度/急迫/抗性提升/跳跃提升/力量/生命恢复）不再读 `power.label`，改用 **`effectLabel(power.effect)`** —— 复用状态效果已有的 `label.effect.*`（30 条），**零新键**；`WorldScreen` 的 `aria-label='关闭'` 与 `error.textContent='保存失败，请重试'` → `misc.close` / `world.saveFailed`（**2 条新键** × 6 语言）
  - 顺手删掉了 `BeaconPower.label` 字段（5 处 UI + `beacon-test` 的 1 条断言改用 `effectLabel()`），`Beacon.ts` 里再无中文；`BEACON_POWERS` 的顺序注释与存档语义**没动**（顺序即下标，只删了 label）
  - ⚠️ 侦察结论修正了我上一轮的估计：说"约 20 条"，实际只有 **8 处**。两处被排除的是：① `game/appearance.ts` 的 `CHARACTER_PRESETS[].label`（成年男性等 4 条）—— `grep` 全仓**没有任何 UI 读它**，是纯数据字段；② `Rules.ts` 的 `DIFFICULTIES[].label`（和平/简单/普通/困难）—— `WorldScreen` 用的是 `difficultyLabel()`（已走 i18n），那个 label 没人读
  - 验证：`test:i18n` **542 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2786 条、0 缺口 / 0 孤儿；`beacon-test` 通过（断言改成"每个 power 都有效果 id 且 `effectLabel()` 能解析出名字"）
  - 批次：20261024-0245
- [x] [D2] 兜底语义改成英文：确认 `t()` 的回落链是「本语言 → 英文 → 键名」，并加**可复现断言**（人为删一条 de 键 → 必须显示英文、不得显示中文原文）；同时说明 `advancementTitle` / `itemDescription` 里的中文原文兜底现在是否还必要
  - 结论先说：`t()` 的回落链本来就是「**本语言表 → 英文表 → 键名**」，所以"某语言缺翻时显示英文"**已经成立**，不需要改实现。本轮把它变成**可复现的断言**
  - 新增 3 条断言：① 造一个假语言 `yy`，只装 `pause.title` 一条键 → 查 `pause.resume` 必须等于**英文**且**不等于中文**（这正是"新增文案只加了 zh/en 就上线"的真实场景）；② `yy` 里有的那条照常取本语言；③ `advancementTitle()` 在德语下取德语（不缺翻时不落到中文原文）
  - `advancementTitle` / `itemDescription` 里那层"中文原文兜底"**只在连英文都没有时才触发** —— 也就是**键漏了**（`satisfies Messages` 会在编译期先报）。保留它当最后一道保险；真要删，得连着回落链一起改，收益不抵风险
  - 数据层现状（本轮复测）：四语言 2786 键 **0 缺键 / 0 含中文 / 0 空值** —— 也就是说中文原文兜底在六语言上**一次都不会触发**
  - 验证：`test:i18n` **542 / 0**（含新增 3 条）；`test:offline` **172 / 172 套全绿**
  - 批次：20261024-0245

---

## 批次 20261024-0223 · 2026-10-24 · 会话 4024a9d4

- [x] [C1] 品牌收尾：六语言 `advancement.story_root.title`（现在是「Minecraft」，zh 是「我的世界」）→ `Minicraft`；`package.json` 的 `name`（`bedrock-118-web`）→ `minicraft`；注释里残留的 `MINECRAFT` / `Bedrock 1.18 Web` 一并改；**副标题 `1.18 · WEB EDITION` 删掉**（`BRAND_EDITION` 连同首页 `edition` 元素）
  - 做了什么：① 六语言 `advancement.story_root.title` —— en/de/ru/fr/pt 原来是 `Minecraft`、zh 是「我的世界」，全部改成 **`Minicraft`**；② `package.json` 的 `name`：`bedrock-118-web` → **`minicraft`**；③ 注释里残留的 `MINECRAFT`（`WorldScreen` 与 `index.html` 的布局说明）改成"品牌名的字母"，`index.html` 那条历史注释里的 `Bedrock 1.18 Web` 改成 `Minicraft`；④ **副标题删除**：`WorldScreen` 不再创建 `world-edition` 元素，`BRAND_EDITION` 置空并写明原因
  - 实测（浏览器，起 vite 5207 + 本机 Chrome）：`document.title = Minicraft`、`.world-logo = Minicraft`、`.world-edition` **已删除**，首页正文变成 `Minicraft WebGL2! 原生生存、创造与多世界存档 …` —— 只剩品牌名一行
  - ⚠️ 改了 4 条既有断言的判据（都是"用户要求变了"的直接后果）：① `i18n`「中文模式下标题与说明原样不动」→ 排除 `minecraft:story/root`（它现在**故意**等于品牌名）；② 「首页品牌块从 BRAND / BRAND_EDITION 取值」→ 改成「首页只显示品牌名（副标题已删）」；③ 「副标题是版本身份」→ 改成「副标题已删除（`BRAND_EDITION === ''`）」；④ 「中文成就标题与原文逐条一致」→ 排除 story_root；⑤ `ui`「首页品牌块取唯一真值」→ 改成验 `logo.textContent = BRAND` 且**不含** `world-edition`
  - 验证：`test:i18n` **523 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`grep` 旧品牌名在 `src` / `public` / `index.html` / `docs` / `README.md` / `package.json` 里**只剩 `brand.ts` 的注释**（说明为什么删副标，属历史陈述）
  - 批次：20261024-0223
- [x] [C2] 全局语言遗漏复查：数据层面（2701 键 × 4 语言）已确认 0 缺键 / 0 含中文 / 0 空值；**源码层面 906 处硬编码中文**需要分类甄别（命令错误信息 28 处是玩家可见的、成就与物品说明 297 处是**回退原文**设计如此、diagPerf 32 处开发者面板）——调研结论写进说明，是否继续做由用户拍板
  - 做了什么：两条口径各扫一遍 —— ① **数据层**：2701 个键 × de/ru/fr/pt，查缺键 / 含中文 / 空值 / 占位符 / 与英文同形；② **源码层**：扫 `src` 下所有 `.ts` 的非注释字符串字面量里的中文，按文件计数并抽样看上下文
  - ✅ 数据层结论：**缺键 0 · 含中文 0 · 空值 0**（四语言全绿）；占位符不一致只有 5 处且全是**少用**（俄/法/葡的 `woodLog`/`woodPlanks`/`stemStage` 不提第二个 `{wood}`/`{crop}`、`armor` 不提 `{material}`），语义无损；与英文同形 de 78 / ru 9 / fr 102 / pt 55，**无整组可疑**（最大的 `label` 也只有 4/226）
  - ⚠️ 源码层结论：**906 处**硬编码中文，但绝大多数**不是遗漏** —— `advancements.ts`（205 条）与 `itemNames.ts`（92 条）是**中文原文回退值**（`advancementTitle()` / `itemDescription()` 先查表、缺键才回落，设计如此）；`diagPerf.ts`（32 条）是 `?debug=1` 的开发者面板
  - 🔴 **真遗漏（玩家可见，已立条目）**：① `Rules.ts` 的 `GAME_RULE_LABELS`（35 条规则描述，注释写明"**命令帮助的下拉用**"—— 与 P6-1 修的难度/模式同一类毛病）；② `Commands.ts` 里仍写死的中文回执（`/clone` 的「已复制 N / M 格到 …」、`（masked：跳过 N 格非空气）`、`(空)`）与 `Selectors.ts` 的 14 条选择器错误信息；③ `loot.ts` 的 30 条结构名（`村庄小屋` / `废弃矿井` …）可见性待确认
  - 验证：巡查脚本实测四语言「缺键 0 / 含中文 0 / 空值 0」；源码扫描 906 处、73 个文件，按文件排序前几位为 `advancements.ts 205 / main.ts 154 / itemNames.ts 92 / Rules.ts 35 / diagPerf.ts 32 / loot.ts 30`；`test:i18n` 523 / 0、`test:offline` 172 / 172 套全绿
  - 批次：20261024-0223


- [x] [C3] `GAME_RULE_LABELS`（35 条规则描述）多语言 —— 命令帮助里的 gamerule 下拉直接显示它，与 P6-1 的难度/模式同一类；改 `gameRuleLabel(rule)` 走 `cmd.label.gamerule.*`
  - 做了什么：`GAME_RULE_LABELS`（31 条中文规则名）→ **`gameRuleLabel(rule)`** 走 `cmd.label.gamerule.*`（31 × 6 = **186 条**），表 2701 → **2732**；使用点 `CommandHelp.ts` 的 gamerule 下拉改为 `${gameRuleLabel(rule)}（${rule}）`
  - 为什么是真遗漏：那张表的注释写着"命令帮助的下拉用" —— 玩家在 `/help gamerule` 的候选列表里直接看到它，与 P6-1 修的 `DIFFICULTY_LABELS` / `GAME_MODE_LABELS` 完全同类（中文常量给界面用，绕过了语言表）
  - 术语照原版：`Inventar behalten` / `Kreaturen spawnen` / `Kreaturen zerstören Blöcke`、`Сохранять инвентарь` / `Разрушение блоков мобами`、`Conserver l’inventaire` / `Créatures qui cassent des blocs`、`Manter inventário` / `Criaturas quebrando blocos`；`doInsomnia` 用 `Schlaflosigkeit` / `Бессонница` / `Insomnie` / `Insônia`（幻翼失眠）
  - ⚠️ 改了 2 条既有断言（都是"标签搬走"的直接后果）：① `ui`「`/gamerule` 的帮助里列出了新规则」原来还检查 `Rules.ts` 里存在 `doImmediateRespawn: '立即重生'` 这个中文字面量 —— 改成只验默认值还在、且**不再**有那个字面量（标签是否翻好交给 `test:i18n`）；② `command-test`「每条规则都有中文名」改成「每条都有显示名且不是键名本身」
  - 新增 6 条断言：规则标签覆盖 31 条 + de/ru/fr/pt 各一条「不含中文、不露英文 id」+ 中文下仍是原说法（`死亡后保留物品` / `昼夜循环`）
  - 验证：五语言渲染 `keepInventory` → de `Inventar behalten` / ru `Сохранять инвентарь` / fr `Conserver l’inventaire` / pt `Manter inventário`；`test:i18n` **529 / 0**；`command-test` **435 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2732 条、0 缺口 / 0 孤儿
  - 批次：20261024-0223
- [x] [C4] 命令域剩余硬编码：`Commands.ts` 的 `/clone` `/fill` 回执与 `(空)`、`Selectors.ts` 的 14 条错误信息 → `cmdMessages.*`（约 28 条）
  - 做了什么：`Selectors.ts` 的 **14 条**选择器错误 + `Commands.ts` 的 **13 处**回执（`/clone` 的「已复制 N / M 格」「（masked：跳过 N 格）」、`(空)` 两处、授予/收回、execute 三条、scoreboard/队伍摘要四条）全部走 `cmd.error.selector.*` / `cmd.reply.*` —— 共 **30 条键 × 6 语言 = 180 条**，表 2732 → **2762**；两个文件里**再无硬编码中文**（只剩一行行尾注释）
  - ⚠️ 坑 1（会静默覆盖）：`cmd.reply.team.prefix` / `suffix` 这两个键**已经存在**（P4 法语批时加的，值是「前缀」/「后缀」两个字，用在 `msg(key, …)` 里）。我新写的是「，前缀「{prefix}」」（带前导逗号、给队伍摘要拼串用）→ `TS1117: duplicate property` 当场拦下。改成 `prefixAffix` / `suffixAffix` 两个新键，旧键保持不动
  - ⚠️ 坑 2（变量遮蔽）：`/time` 那段有 `const t = parseTime(args[1])`，把 i18n 的 `t` **遮蔽**了 → `t('cmd.reply.emptyValue')` 变成"调用 parseTime 的返回值"（可能为 null），`TS2721: Cannot invoke an object which is possibly null` 抓到。改用同文件里的本地辅助 `msg('cmd.reply.emptyValue')`（它本来就是"键 + 参数"的简写），语义更贴合
  - 新增 5 条断言：四语言各一条「命令错误与回执不含中文」（取样 6 条：选择器未知 / limit / 过滤参数缺等号 / clone 回执 / 队伍摘要 / execute 未知子命令）+ 中文下仍是原说法（`type 后面没有种类`）
  - 验证：`test:i18n` **534 / 0**；`command-test` **435 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2762 条、0 缺口 / 0 孤儿；`node .tmp/list-c4.mjs` 复查两个文件的中文只剩注释
  - 批次：20261024-0223
- [x] [C5] `loot.ts` 的 30 条结构名（`村庄小屋` 等）多语言 —— 先确认它在界面上是否可见，再决定键化还是保留
  - 侦察结论（先确认可见性）：`LOOT_TABLES[].name` **确实上界面** —— `CommandHelp.ts:426` 的 `/loot` 帮助下拉写的是 `${table.name}（${table.key}）`，与 C3 的 gamerule 下拉完全同一个模式；所以判为**真遗漏、要键化**，不是保留
  - 做了什么：22 条战利品表名（村庄小屋 / 废弃矿井 / 地牢 / 要塞图书馆与三个要塞点 / 两处沉船 / 林地府邸 / 末地城 / 两处堡垒遗迹 / 沙漠神殿 / 丛林神庙 / 女巫小屋 / 掠夺者前哨 / 雪屋 / 废弃传送门 / 埋藏的宝藏 / 下界要塞 / 海底废墟）→ `cmd.label.lootTable.*`（22 × 6 = **132 条**），表 2762 → **2784**；`CommandHelp` 的下拉改用 `t(...)`
  - ⚠️ 条目写的"30 条"实际是 **22 条**（`LOOT_TABLES` 就 22 张表）；另 8 条差额是我当初按 `loot.ts` 里中文字面量数量估的，含注释与函数名
  - 一个刻意的取舍：`loot.ts` 的 `name` 字段**保留**（数据字段，调试与 `tools/*-test.ts` 在用），只在注释里写明"界面走 `cmd.label.lootTable.*`"。把字段删掉会动 `LootTable` 接口与 22 条数据表，收益不抵风险；玩家可见处已经全部走语言表
  - 顺带核对了 `/structure` 那一支（担心同类问题）：它**已经在走** `cmd.label.structure.*`（多语言 P1-7 时改的），不是遗漏
  - 新增 5 条断言：de/ru/fr/pt 各一条「战利品表名不含中文、也不露键名」（22 条全量扫）+ 中文下仍是原说法（`村庄小屋`）
  - 验证：`test:i18n` **539 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2784 条、0 缺口 / 0 孤儿；`check.mjs --fast` 5 项全绿
  - 批次：20261024-0223

---

