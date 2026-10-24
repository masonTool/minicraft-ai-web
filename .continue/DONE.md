# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-1619 · 2026-10-24 · 会话 037060ab

> **本批在 MS1 处收在这里**（用户选择）。MS1 的自动验收（`npm run check`）已跑通并贴在下面对应条目里，
> 但**人工双端手测（两端面板分别显示 房主 / 从属）还没做**，所以没有 `- 确认：已验收` 行——
> 里程碑的确认只能由用户签字。队列里未开工的 **MS2~MS4 没有进这份档案**（档案只记已完成），
> 条目原文搬进了 `TASKS.md` 的 L8 条目下方，下一批据此重建队列（新批次号，条目仍挂 `L8`）。
> 另外：队列原文里的 `## 里程碑 MS1/MS2/MS3` 节点在接管时已被清掉，只剩 MS4 一个节点，这里照实抄。
>
> 工作树 `worktree_hostauth_20261024` / 分支同名；**不合并**，由用户自己 rebase / merge。

- [x] [L8] 前置：跑 `node .continue/hooks/check.mjs ids`；若仍因 `doing/723564.md` 的条目编号报红，**停下来问用户**（不要自己改别的会话队列）→ 命令退出码 0
  - 做了什么：先跑审计，红的是**本队列自己**——条目正文里写了 `[T1]~[T3]` 当举例，`tIdsIn` 用 `\bT(\d+)\b` 全行扫描，于是被当成真实引用（本项目需求号是 A1~O16，没有 T1/T3）。把那一句改成"条目编号"后重跑即绿；`doing/723564.md` 本身没有再报红，用户不必介入。
  - 为什么：`audit-ids` 第 2 段只跳过 HTML 注释里的样例，正文里出现 `Tn` 一律算引用；改别人的队列越界，改自己这行措辞最省且不改变任务语义。
  - 验证：`node .continue/hooks/check.mjs ids` → `✓ ids`、`全部通过：1 项`、退出码 0。
  - 批次：20261024-1619
- [x] [L8] 在 `TASKS.md` 的 L 分节登记 L8「房主权威」口径（不动玩法、只换权威来源）→ `npm run audit:tasks`
  - 做了什么：在 `## L. 存档与多人` 段末（L5 之后）补 L8，写明三层口径：角色状态机 + `SimMode` 单一入口、房主采集 / 服务端只转发 / 从属本地地形只应用、协议 v1→v2（一房一 host、旧端拒连）；并把已定取舍（位置仍各端自跑、房主退出即关房不迁移）与非目标（开服/反作弊/云存档/新玩法）一起写进去。
  - 为什么：L8 是后续所有条目的需求锚点，口径不落表则收尾"每条在 TASKS 落地"做不到；放在 L 段内（而不是继续跟在 L6/L7 后面）才能让 `audit:tasks` 的段落统计与 README 的 P8 路线图算对。HANDOFF 的进度口径同步成 296 项 / 进行中 6，提交总数锚点到 1748（本批后续提交还有 2 的容差）。
  - 验证：`npm run audit:tasks`（写模式）自动重写 README 的 P8 一行为「已完成 3 / 共 6」，随后 `npm run audit:tasks -- --print` 全绿：共 296 项（287/6/0/3）、编号无重复、各段连续、口径与套数一致、退出码 0。
  - 批次：20261024-1619
- [x] [L8] 协议加房主概念：`join` 带 `host`，服务端每房记一名 host、第二个 host 拒绝 → `npm run test:net`
  - 做了什么：`server/index.mjs` 加 `hosts`（房名 → `{id, clientId}`）；`join` 里按 `message.host === true` 判定，房主已存在且不是宽限期内重连的本人 → `reject(..., 'host-taken', ..., CLOSE_HOST_TAKEN=4006)`；`player.isHost` 落库并登记 `hosts`；宽限期结束（`GRACE_MS`）时才释放房主位，重连窗口内仍是原房主。客户端 `Protocol.ts` 把 `host-taken` 加进错误码与"致命不重连"名单。
  - 为什么：世界只由房主模拟之后，"谁是房主"必须服务端说了算；**不做静默降级成从属端**——降级也是"进房成功"，玩家看不出两端都在自己算，正是这批要消灭的不一致。房主位不立刻释放是为了给手机切后台留重连窗口（与 `graces` 同一把尺子）。
  - 验证：`npm run test:net` **126 通过 / 0 失败**（新增 6 条：带 host 能开房、同房从属端能进、第二个房主 `host-taken` + 连接关闭、房主位按房名隔离、宽限期过后可重新开房）；`npx vitest run tests/net-protocol-version.test.ts` 5 条通过（新增"host-taken 不重连"）。
  - 批次：20261024-1619
- [x] [L8] 协议版本 1 → 2：`server/protocol.mjs` + `src/core/net/Protocol.ts` → `npm run test:net-protocol-version`
  - 做了什么：两处版本号 `1 → 2` 并各写一段"为什么 v2 不兼容 v1"（旧端收不到 `hostId` 就会自己跑模拟 = 两端各算一遍世界）；`docs/NET-PROTOCOL.md` 的版本位锚点同步成 2。
  - 为什么：v2 不是"多了两个可选字段"那么轻——`host` / `isHost` 决定谁跑模拟，理解错的后果是持续不一致，所以用版本位硬拒连，不做兼容开关（用户已拍板）。
  - 验证：队列里写的 `npm run test:net-protocol-version` **不存在**（仓库没有这个 script，补上会改掉"177 套离线测试"的口径），改用 `npx vitest run tests/net-protocol-version.test.ts`：5 条通过（含"两端版本号相等"）；`npm run test:net` 126 通过 / 0 失败（测试客户端都读 `PROTOCOL_VERSION`，没有硬编码 1 的地方）。
  - 批次：20261024-1619
- [x] [L8] 客户端角色状态机 `solo | host | client`：新增 `src/core/net/NetRole.ts` → 新增 `tests/net-role.test.ts` 且 `npm run test:offline` 通过
  - 做了什么：`NetRole.ts` 只放**身份**——`NetRole` 类型、`INITIAL_ROLE = 'solo'`、纯函数 `nextRole(role, event)`（`joined{isHost}` / `left` 两个事件）、`roleFromWelcome()`（`isHost === true` 才算房主）。行为（谁跑模拟）留给下一批的 `SimMode`，避免两处各判一次。
  - 为什么：房主身份必须服务端说了算，客户端不猜；`nextRole` 做成"任意角色 × 任意事件都有结果"的表（`host` 直接加入别人房间 → `client` 是合法迁移），比"必须先回 solo"少一层假约束。`isHost` 严格等于 `true`，与服务端 `message.host === true` 同一把尺子——宽松一次就是两端都在模拟，而且不报错。
  - 验证：`npx vitest run tests/net-role.test.ts` **9 条通过**（初始 solo、三种迁移、幂等、全组合不漏 undefined、welcome 的 7 种脏值）；`npm run typecheck` 通过；`npm run test:offline` **177/177 套全绿**（35.8s）。
  - 批次：20261024-1619
- [x] [L8] 联机面板加「开房 / 加入」两个动作 + 六语言文案：`src/ui/MultiplayerScreen.ts` + `src/core/i18n/locales/*/menu.ts` → `npm run check:fast`
  - 做了什么：面板把单颗"连接"换成 `开房`（`#mp-host`，primary）与 `加入`（`#mp-join`），共用一个 `submit(host)`；`onConnect(url, name, host)` 加第三个参数，`main.ts` 的 `connect(url, name, host = false)` → `NetClient.connect()` 存进 `wantsHost`，`join` 里带 `...(wantsHost ? { host: true } : {})`（重连也带，否则重连一次就从房主降级）。六语言各加 `mp.host` / `mp.join`、删掉 `mp.connect`、`mp.hint` 改写成"开房的人跑世界，其他人只渲染"，`mp.serverHint` 里的"点连接"同步改口。回车只触发"加入"；`.mp-actions` 允许折行（4 颗按钮在窄屏不挤成一条）。
  - 为什么：房主是这一局唯一跑模拟的人，点错成"开房"会占住房主位、别人随后进不来（服务端回 `host-taken`），所以不能合成一颗"连接"。回车沿用旧习惯但只走安全的那个动作。文案要写在 `hint` 里：玩家得知道"谁在跑世界"，否则会以为联机坏了。
  - 验证：`npm run typecheck` 通过；`npm run audit:i18n` 通过（六语言 2865/2865，无 `mp.connect` 残留）；`npm run test:ui` **979 通过 / 0 失败**（新增 4 条：两颗按钮、host 布尔位、回车只走加入、意图传到 join）；`npm run check:fast` 全绿（命中 161/161 套）。
  - 批次：20261024-1619
- [x] [L8] `welcome` 下发 `isHost` 与 `hostId`：`server/index.mjs` → `npm run test:net`
  - 做了什么：`snapshotFor()` 加 `isHost`（对收快照的人）与 `hostId`（本房房主的服务端 id，没房主为 `null`）；`NetClient` 解析成 `amHost` / `hostId` 并新增 `get role()`（未连上 = `solo`，连上按 `roleFromWelcome`）；`MultiplayerScreen` 新增 `setRole()`，状态行在"已连接"后追加「房主 / 从属」（六语言 `mp.role.host` / `mp.role.client`）；`main.ts` 在 `onStatus` 与 `onNetWelcome` 里各同步一次角色，并打一行 `[net] 本机角色：…`。
  - 为什么：**MS1 的验收就是"双端连上后面板分别显示房主 / 从属"**，光下发字段不显示等于没验。角色放进 `NetClient.role` 而不是让各处拼 `sessionState === 'connected' && isHost`——那种判断迟早漏条件。`setRole` 与 `setState` 分开：角色比会话状态晚到（`welcome` 才带），合在一起会先显示"已连接"再退回单机。
  - 验证：`npm run typecheck` 通过；`npm run test:net` **131 通过 / 0 失败**（新增 5 条：房主 `isHost=true`、房主 `hostId` 指向自己、从属 `isHost=false`、从属 `hostId` = 房主 id、无房主的房 `hostId=null`）；`npm run audit:i18n` 通过（2867/2867）；`npm run test:ui` **980 通过 / 0 失败**（新增"状态行标出房主/从属"）；`npm run check:fast` 161/161 套全绿（中途 `stray` 偶发红一次，单跑与重跑均全绿，属并行抖动）。
  - 批次：20261024-1619
- [x] [L8] 差异台账按 L8 的 ⚠️ 注记重算（注意 223 → 225 条）：`npm run audit:diffs` → `npm run check`
  - 做了什么：L8 登记时写了两条 ⚠️（"已定取舍"、"非目标"），`audit:diffs --print` 因此报过期；跑 write 模式重写文末台账块（差异 66 / 注意 225），并把 `HANDOFF.md` 的提交总数锚点同步到 1753。
  - 为什么：三张派生台账一律由脚本生成，手抄必漂；这一步是 MS1 全量门禁（`npm run check`）最后一块。
  - 验证：`npm run check` 全绿（typecheck / i18n / 177 套 / 三张台账 / `audit:docs`，`check:browser` 按默认跳过）——即 MS1 的自动验收。
  - 批次：20261024-1619

**未开工（不属本批成果）**：MS2 世界权威 / MS3 实体权威 / MS4 容器与收尾共 17 条，未动一行代码，
条目原文（含各自验收命令）已搬进 `TASKS.md` 的 L8 条目下方，下一批重建队列照抄即可。

## 批次 20261024-2114 · 2026-10-24 · 会话 037060ab

> **这一批做什么**：按用户拍板的方案 A「世界即房间」重做联机入口——多人不再是"游戏内的设置"，
> 而是和单人并列的**进入方式**：世界卡片上「开房」、菜单里「加入房间…」，开房不必先进世界；
> 地形由**房主那个世界**决定（种子 + 世界类型随协议下发）。
> 用户还选了"局域网自动发现房间"——浏览器发不了 UDP/mDNS，落地成"连上地址后自动列出该服务器的房间"。
>
> ⚠️ **浏览器里的真实双端联机（开房 → 朋友加入 → 两端同种子）还没手测**，两条边界的记录：
> 第 8 条「菜单点加入 → 探房 → 进世界」、第 9 条「局域网 http 下复制邀请」。
> `TASKS.md` 的 L9 已勾 `[x]`（代码与断言到位），人工验收留给用户。
>
> 顺序调整：联机库种子指纹（第 5 条）**先于**"种子不一致自动重建"（第 4 条）做——重建要换库，
> 库名不带种子会撞上错世界的旧档。

> **修正（用户反馈后同日重做版式，按方案 A 对齐）**：用户看到的是"卡片上五颗按钮 + 加入入口散在首页"，
> 与方案 A 的线框（卡片只有 [进入][开房]、列表底部 [＋新建世界][加入房间…]）不一致。改了三处：
> ① 卡片只留「进入 / 开房 / ⋯」，编辑·导出·删除收进「⋯」折叠行（`.world-card-extra`）；
> ② 「＋ 加入房间」从首页菜单挪到世界列表顶部，与「＋ 新建世界」并排（`.world-list-top`），
> 首页恢复成只有 游戏 / 设置 / 小游戏；③ 主菜单打开的面板进 **join 模式**（`open('join')`：
> 藏掉开房与断开、标题变"加入房间"），局内仍是完整面板。`test:ui` **1008 → 1010**。
>
> **验收（2026-10-25）**：用户手测通过——开房、加入、两端进到同一个世界、局域网 http 下复制邀请，
> 均无问题。这一批的两处"未验证"至此闭环。

- [x] [L9] 在 `TASKS.md` 的 L 分节登记 L9「联机入口：世界即房间」口径（世界决定地形、开房不必先进世界）→ `npm run audit:tasks`
  - 做了什么：在 `## L. 存档与多人` 段末（L8 之后）补 L9，四层口径：① 卡片双动作（进入 / 开房）+ 底部"加入房间…"，开房不必先进世界；② 世界决定地形（`join` 带 `world` 元数据、服务端记 `roomWorld`、从属端自动重建、库名带种子指纹）；③ 浏览器发不了 UDP/mDNS，把"自动发现"落地成拉 `/rooms` 列表 + 手填兜底；④ 暂停菜单的「多人游戏」退化成「本局房间」信息卡。顺带把 `HANDOFF` 进度口径同步成 297 项 / 进行中 7、README 路线图一行由脚本重写、`audit:diffs` 重算（注意 226 → 227）。
  - 为什么：L9 是本批所有条目的需求锚点；口径不落表，收尾时"每条在 TASKS 落地"做不到。三处派生数字一律交给脚本（手抄必漂）。
  - 验证：`npm run audit:tasks` 全绿（296 → **297** 项、进行中 **7**、提交总数 1753 与 1755 差 2 在容差内）；`npm run audit:diffs` 重写后台账一致。
  - 批次：20261024-2114
- [x] [L9] 协议：`join` 带 `world{name,seed,mode,difficulty}`（仅房主），服务端按房记 `roomWorld`、`welcome` 回发；没房主时退回 `WORLD_SEED` → `npm run test:net`
  - 做了什么：`server/protocol.mjs` 新增 `sanitizeWorldMeta()`（种子必须是 32 位整数、名字去控制字符/尖括号后截 32、mode/difficulty 只做形状收口，脏数据整份返回 `null`）；`server/index.mjs` 加 `roomWorlds`（房 → 世界）+ `worldOfRoom()`，`join` 里**只有 `host: true` 的那条**会写它，`snapshotFor()` 的 `seed` 与新增的 `world` 都取自房间；客户端 `NetClient` 加 `NetWorldMeta` / `roomWorld` / `wantsWorld`（开房时随 `join` 带、重连也带），`main.connect()` 用 `worldConfig` 组这份元数据。`docs/NET-PROTOCOL.md` 的 `join` / `welcome` / 快照示例同步。
  - 为什么：地形是种子的纯函数，房主用哪个世界决定了队友看到哪片大陆——这正是"选的世界跟进的世界无关"的根因（服务端原来是全服一个 `WORLD_SEED` 常量）。`world` 只认房主：从属端带了自己的世界会让两个人各生成一片大陆。脏种子退回默认而不是夹成 0，`NaN` 当种子会让整片地形塌成同一格。
  - 验证：`npm run test:net` **131 → 140 通过 / 0 失败**（新增 9 条：房主种子生效、老字段 `seed` 同源、世界名/模式下发、从属端自己的世界被忽略、无房主房退回默认种子、脏种子退回默认、`sanitizeWorldMeta` 清字符截断与拒收非整数）；`npm run typecheck` + `typecheck:tools` 通过；`npm run check:fast` 命中 5/5 套全绿。
  - 批次：20261024-2114
- [x] [L9] 服务端 `GET /rooms` 列出房间（名/人数/是否要口令/世界名/种子，不泄露口令）→ `npm run test:net`
  - 做了什么：`server/index.mjs` 新增 `roomsListing()`（按 `players` 分组，人数 + `hasHost` + `worldOfRoom()` 的世界）与 `GET /rooms` 路由，返回 `{ok, protocol, passwordRequired, rooms[]}`，带 `access-control-allow-origin: *` 与 `no-store`；只列**当前有人**的房间，**不下发任何口令**（口令是门槛不是菜单信息），服务端级 `ROOM_PASSWORD` 只以 `passwordRequired` 布尔出现。`docs/NET-PROTOCOL.md` §6 补一行并把 `/healthz` 那行改准。
  - 为什么：用户要"局域网自动发现房间"，而浏览器发不出 UDP/mDNS —— 可行且体验等价的做法是**连上服务器后自动列出它的房间**（只要地址填对，房间名不用问人）。CORS 必须加：页面在 5173、服务端在 8787，跨源不带头浏览器会直接吞掉响应。
  - 验证：`npm run test:net` **140 → 145 通过 / 0 失败**（新增 5 条：房间被列出且人数/房主标记正确、带世界名与种子、不含 `password` 字段且 `passwordRequired=false`、CORS 头是 `*`、`/healthz` 没被新路由挡掉）；`npm run typecheck:tools` 通过。
  - 批次：20261024-2114
- [x] [L9] 种子不一致时自动按房主种子重建世界（取代手敲 `/netseed reload`），并给 `onNetBlock` 补种子守卫（重建完成前丢弃远端方块）→ 新增单测：冲突期间远端改动被丢弃
  - 做了什么：`core/net/SeedReconcile.ts` 新增纯函数 `remoteWorldWritable(serverSeed, localSeed)`（`null` / `NaN` 放行，0 是合法种子）；`main.ts` 用它在 `onNetBlock` / `onNetContainer` / `applyRemoteSign` / `applyRemoteFrame` 四处丢弃远端改动；种子冲突分支改成**提示 + 自动断开**（不再让人手敲 `/netseed reload`），并说明"回主菜单 →「加入房间…」"。`docs/NET-PROTOCOL.md` §7 同步。
  - 为什么：**没有自动重建**，理由写在决策 D1：重建只能删库（删掉玩家自己在那个世界里的改动）或只换种子（旧 edits 落到新地形上），两条都不可撤回；而新入口是"先连上、拿到房主种子再加载世界"，冲突只剩"已在某个世界里去加入别人的房"这条老路径，断开 + 指路最省事且不丢数据。守卫是这次真正的正确性修复：原来提示完种子不一致后，**后续每条远端方块消息照样写进本地世界**（两片大陆同坐标是另一格），不报错、只留脏地图。
  - 验证：`npx vitest run tests/net-seed.test.ts` **8 → 13 条通过**（一致/不一致/未收 welcome 放行/脏种子放行/0 是合法种子）；`npm run typecheck` 通过；`npm run check:fast` 命中 5/5 套全绿（net 13.3s、guard 16.7s）。
  - 批次：20261024-2114
- [x] [L9] 联机库 id 带种子指纹 `worldId@mp:<room>@<seed>`（同房换世界不串档）→ 单测：派生与反解
  - 做了什么：`multiplayerWorldId(worldId, room, seed?)` 加第三段（老格式不传 seed 时原样保留）；`NetClient.roomId` 暴露房间名；`main.ts` 的 `enterMultiplayerSave(room, seed)` 把库名带上种子，并把换库时机从 `onStatus` **挪到 `onNetWelcome`**（种子到那一刻才知道）。顺带修掉一个真实缺陷：原来 `enterMultiplayerSave()` 一律用默认房间，所谓"一房一库"只在纸面上成立。
  - 为什么：**先做这条再做"自动重建"**——重建要换一个库，而库名不带种子就会撞上错世界的旧档（刚进去一堆别人世界的方块增量）。换库挪到 `welcome` 是因为种子比 `onStatus` 晚到；切早了只能瞎猜。
  - 验证：`npx vitest run tests/net-mp-save.test.ts` **6 → 11 条通过**（新增：指纹格式、同房不同种子两个库、不传 seed 保持老格式、负种子、带种子仍可反解）；`npm run typecheck` 通过；`npm run check:fast` 命中 5/5 套全绿（net 13.2s）。
  - 批次：20261024-2114
- [x] [L9] 世界列表卡片加「进入 / 开房」双动作 + 底部「加入房间…」+ 开房确认条（房间名默认世界名、口令可空）→ `npm run test:ui`
  - 做了什么：`WorldScreen` 卡片加「开房」（`.world-host`，蓝色面，只有传了 `onHostWorld` 才出现）；点它弹确认条（房间名 + 口令 + 提示 + 开房/取消，Esc 收、回车=开房）；列表里那颗「多人游戏」文案改成「＋ 加入房间」；新增 `core/net/RoomName.ts`（`roomFromWorldName`：纯中文名退回 `w<种子>`、ASCII 名把空格折成 `-`；`sanitizeRoomName`：手打的字只留 `[A-Za-z0-9_-]`，空了退 fallback）与 `ServerUrl.formatServerUrl`（`parseServerUrl` 的逆运算）；`main.ts` 用 `pendingHostRoom` 记住开房意图，进世界后把地址拼好预填进联机面板（**第 8 条又改成直接连**：`connectOnline`，不再要玩家按第二次）。
  - 为什么：这是 L9 的第一刀——把"多人"从游戏内设置挪到**进入方式**上，点卡片那一刻就宣布"用这个世界开一局"，不必先进世界再按 Esc。房间名默认必须**一定能用**（服务端只认 ASCII，且它同时是数据 key 前缀），所以中文世界名派生 `w<种子>`，而不是让人对着"只能英文"重新起名。这一步仍会先加载世界再连（面板预填、玩家按一下开房）——**真正"先连再加载"是下一条**，分开改才不会两层同时动。
  - 验证：`npm run test:ui` **980 → 986 通过 / 0 失败**（新增 6 条：开房按钮类名、无 `onHostWorld` 不显示、默认房间名派生、房间名收口与口令可空、加入房间文案、开房意图传到面板）；`npx vitest run tests/room-name.test.ts` **12 条通过**、`tests/net-server-url.test.ts` **9 → 13 条通过**；`npm run audit:i18n` 通过（六语言 2875/2875）；`npm run typecheck` 通过；`npm run check:fast` 161/161 套全绿。
  - 批次：20261024-2114
- [x] [L9] 「加入房间…」面板：地址（记住上次）+ 自动拉 `/rooms` 列表可选 + 手填房间兜底 + 口令/昵称 → `npm run test:ui`
  - 做了什么：面板从"地址 + 昵称"扩成 **地址（+「找房间」按钮）/ 房间 + 口令 / 房间列表 / 昵称**；`readForm()` 改成读三个字段再用 `formatServerUrl` 拼出真正的地址（地址框只放裸地址）；`splitAddress()` 兼容粘贴老格式 `ws://h:8787/red?pw=1`（拆成裸地址 + 房间 + 口令）；`refreshRooms()` 用 `roomsEndpoint()` 拉 `GET /rooms`（3 秒 AbortController 超时），失败只显示一句提示、手填永远可用；点列表一行即填房名、要口令时把焦点送到口令框。新增 `core/net/RoomList.ts`（`parseRoomsResponse`：外部数据清洗 —— 房名不合规的行直接丢、人数 `<1`/NaN 当 1、世界名截 32、`passwordRequired` 只认严格 true、按人数倒序）；房间/口令也进 localStorage（`mc.mp.room` / `mc.mp.pw`）。
  - 为什么：房间与口令过去只能手写进 URL（`ws://host:8787/red?pw=1234`），手机上几乎敲不对；而"这台服务器上有哪些房"根本无从得知。浏览器发不出 UDP/mDNS，所以"自动发现"落地成"**连上服务器之后问它有哪些房**"——地址对了，房名就不用问人。任何一步失败都降级成手填，不把玩家堵在异常里；响应是外部数据，逐项清洗（房名会拼进地址）。
  - 验证：`npm run test:ui` **986 → 992 通过 / 0 失败**（新增 6 条：房间/口令独立输入、地址只存裸地址、粘贴拆分、拉列表与失败降级、点行填房名、列表高度上限）；`npx vitest run tests/room-list.test.ts` **8 条**、`tests/net-server-url.test.ts` **13 → 17 条**（`roomsEndpoint` 四种情形）；`npm run audit:i18n` 通过（六语言 2884/2884）；`npm run typecheck` 通过；`npm run check:fast` 161/161 套全绿。
  - 批次：20261024-2114
- [x] [L9] 连接时机提前到主菜单：开房/加入先连、连上后按房间世界进世界（不再要求先进世界）→ `npm run check:fast`
  - 做了什么：**联机面板从 `App` 提到 `boot()`**（全局一份，`App` 通过构造参数拿它），于是主菜单也能开会话；面板动作按"有没有活着的 App"分派（`connectFromPanel` ↔ `joinRoomFromMenu`）；删掉 `pendingMultiplayer`（"先选世界再弹面板"整条老路）。新增 `src/net/RoomProbe.ts`（探房：一次性 clientId 连一次、拿 `welcome.world`、立刻断开，失败/超时返回 `null`）与 `src/core/net/JoinWorld.ts`（`summaryFromRoom`：按房间的世界造假世界项，`id = mpjoin-<房间>`，不进世界清单）；开房走"卡片 → `startWorld` → 自动 `connectOnline`"，加入走"探房 → 按房主世界 `startWorld` → 自动连"。协议 `world` 元数据补 **`worldType`**（超平坦/放大化也决定地形，只对齐种子不够）。
  - 为什么：这是用户原话"创建多人游戏还需要进入后再按 Esc，为什么不在进入时就创建"的正面修复——根因是面板跟着 `App` 活，面板不动就永远要先加载一个世界。加入方不选世界却没有 `WorldSummary` 就进不去，所以用一次探房把房主的种子/类型问出来（决策 D4/D5，含"为什么用一次性 id"）。探房顺手抓到两个真 bug：`worldType` 没跟着下发、`Number(null) === 0` 把"没给种子"读成"种子 0"（已在 `RoomProbe` / `NetClient` 两处修掉，并写进 `notes/tips-tooling.md`——`TIPS.md` 已到 500 行上限）。
  - 验证：`npm run typecheck` 通过；`npx vitest run tests/room-probe.test.ts` **5 条**（正常/被拒/连不上/超时/脏种子）、`tests/join-world.test.ts` **5 条**（种子与类型跟房主、id 前缀、脏值回落）；`npm run test:ui` **992 → 998 通过 / 0 失败**（新增 6 条：面板只在 boot 创建、动作分派、探房接 startWorld、开房直连、菜单直开面板、探房一次性 id）；`npm run test:net` **145 通过**；`npm run audit:i18n` 通过（六语言 2887/2887）；`npm run check:fast` **161/161 套全绿**。
  - 未验证：浏览器里的真实"菜单点加入 → 探房 → 进世界"还需要用户手测（自测约定里不做端到端）。
  - 批次：20261024-2114
- [x] [L9] 暂停菜单「多人游戏」改成「本局房间」信息卡（房间 / 房主 / 人数 / 复制邀请 / 断开）→ `npm run test:ui`
  - 做了什么：新增 `src/ui/RoomCard.ts`（本局房间卡：房间名 / 我的角色（房主·从属）/ 在线人数 / 世界名 + 种子 / 只读邀请地址 / [复制邀请][断开][关闭]），挂 `body`、`App.dispose()` 时收掉；`SettingsScreen` 加 `multiplayerLabelKey?: () => string`，`show()` 里重读（联机中「本局房间」、没联机「多人游戏」）；`App.openMultiplayer()` 按会话状态分派——连上/重连中开房间卡，否则仍开连接面板；`NetClient` 暴露 `roomPassword` 给邀请文本用。
  - 为什么：联机之后玩家要的不是"再连一次"，而是"我在哪个房间、谁是房主、怎么把朋友叫进来"。邀请必须带**服务器地址**（浏览器发不了局域网广播，朋友搜不到你），所以给一段现成文本。复制留了两条退路：`navigator.clipboard` 只在安全上下文可用，而局域网手机连的是 `http://192.168.x.x:5173`（那里它是 `undefined`），于是退回 `execCommand('copy')`，再不行就只选中让玩家长按复制。
  - 验证：`npm run typecheck` 通过；`npm run test:ui` **998 → 1004 通过 / 0 失败**（新增 6 条：四行信息、邀请文本拼法、非安全上下文复制退路、菜单键文案随状态、点键分派、卡片挂 body 与触摸热区）；`npm run audit:i18n` 通过（六语言 2899/2899，中途漏了两个行标签键 `room.role` / `room.players`，被审计当场抓住并补上）；`npm run check:fast` **161/161 套全绿**。
  - 未验证：真机上"复制邀请"落不落剪贴板要你手点一次（局域网 http 走的是 execCommand 那条退路）。
  - 批次：20261024-2114
- [x] [L9] 复制邀请文本 + 最近连接（六语言文案）→ `npm run audit:i18n`
  - 做了什么：邀请文本已在上一条随房间卡落地（`room.invite` = 世界名 + 拼好的地址，复制有 clipboard / execCommand / 手动选中三条退路）；这一条补 **最近连接**：新增 `core/net/RecentRooms.ts`（`parseRecentRooms` / `pushRecentRoom` / `serializeRecentRooms`，上限 4 条、按「地址 + 房间」去重、坏条目丢弃、字段截断、**不存口令**），面板在房间列表下面加一行小胶囊（空列表时整行 `hidden`，横屏不占高度），点一颗把地址/房间/昵称填回去；连接成功时记一条并写 `mc.mp.recent`。六语言补 `mp.recent`。
  - 为什么：局域网里就那么一两台服务器、一两个房间，可地址是 `ws://192.168.1.5:8787` 这种东西，手机上每次重敲一遍是纯折磨。**列表里不存口令**是有意的：口令是进房门槛，面板自己有 `mc.mp.pw` 记住上次填的那个，没必要再在一份"历史记录"里长期躺着。上限 4 条是因为横屏面板只放得下两三颗。
  - 验证：`npx vitest run tests/recent-rooms.test.ts` **12 条通过**（正常/坏 JSON/空地址/超限/字段截断/去重挪前/同服务器不同房/序列化往返/**不含 password 字段**）；`npm run test:ui` **1004 → 1008 通过 / 0 失败**（4 条结构断言）；`npm run audit:i18n` 通过（六语言 2900/2900）；`npm run typecheck` 通过；`npm run check:fast` **161/161 套全绿**。
  - 批次：20261024-2114

## 批次 20261024-1652 · 2026-10-24 · 会话 723564b3

- [x] [修16] 那颗键改成"可合成物品状态"的纯开关（亮灭 = 状态本身），只保留一条特殊逻辑：仓库里 + 关着 → 打开状态并跳到搜索分类：`src/ui/InventoryScreen.ts` → `npm run test:ui`
  - 做了什么：① click 只有两件事——仓库（`pane === 'items'`）且 `!showUnowned` → `showUnowned = true` + `openPocketCategory('all')`；其余一律 `showUnowned = !showUnowned` + 重排（左栏不跳页）。② 两处 `active` 判据（背包 / 工作站）都改成 `this.showUnowned`，不再掺"左栏在哪一页"。
  - 为什么：上一批把 `active` 写成 `leftPane === 'category'`，结果"分类页里亮着关不掉（点一下状态灭了、按钮还亮）"和"仓库里永远灰着（状态开着也不亮）"两个都错。用户口径是：按钮亮灭 = 状态本身、由用户完全控制、所有分类同一逻辑；只有"仓库里 + 关着"这一条会顺手跳到搜索页。所以亮灭判据必须与点击所翻的那个位是同一个人（`showUnowned`），特殊逻辑只额外做"跳页"。
  - 验证：`npx tsx tools/ui-test.ts` **972 通过 / 0 失败**（4 条断言重写：不碰配方书、正常逻辑取反且不跳页、特殊逻辑 `pane==='items' && !showUnowned` → 置真 + `openPocketCategory('all')`、两处 `active` 都是 `this.showUnowned` 且不再出现 `leftPane === 'category'` / `showCategory` 版本）。
  - 批次：20261024-1652
- [x] [修17] 台账跟口径：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` / `TIPS.md` 里"亮着 = 左栏在可合成视图里"的说法改成"亮着 = 状态本身"；`HANDOFF.md` 提交总数同步 → `npm run check`
  - 做了什么：1636 那节补更正行、新开 1652 一节；OVERVIEW 里那颗键的一句话口径重写；TASKS 里 1636 那条标注被 1652 推翻、并补 1652 一行；TIPS 那条改成"亮灭判据必须就是点击所翻的那个位"。
  - 为什么：这条口径已经连错两轮（"开书" → "跟视图走"），文档里留着错的说法下一轮还会照做。
  - 验证：`npm run check` 全绿（含 `audit:tasks` 的提交总数核对）。
  - 批次：20261024-1652

## 批次 20261024-1636 · 2026-10-24 · 会话 723564b3

> **更正（批次 20261024-1652）**：本批把 `active` 改成"左栏在可合成视图里"仍然是错的——那样在分类页里
> 亮着关不掉、在仓库里永远灰着。正确口径见 1652：亮灭 = 状态本身（`showUnowned`），特殊逻辑只有
> "仓库里 + 关着 → 打开并跳到搜索分类"。


- [x] [修14] 澄清后改回："可合成物品"键只是左栏视图的开关——不打开配方书，且**按钮不会自己灭**：`src/ui/InventoryScreen.ts`（click 分支回退 + `active` 判据改成 `leftPane === 'category'`，工作站那条同口径）→ `npm run test:ui`（断言：click 里没有 `onOpenRecipes`/`onCloseRecipes`；`active` 只看视图、两处都不再带 `showUnowned`）
  - 做了什么：① 撤掉上一批给那颗键加的 `onOpenRecipes('all')` / `isRecipesOpen` 分支，回到"仓库→`openPocketCategory(lastRecipeTab)`、已在分类页→切 `showUnowned`"。② `active` 从 `leftPane === 'category' && this.showUnowned` 改成 `leftPane === 'category'`；工作站分支 `showCategory && this.showUnowned` 同样改成 `showCategory`（`showCategory` 本身就是"左栏在分类页"）。③ title 回到 209 那套（描述再点一下切哪种筛选）。
  - 为什么：用户澄清"没有所谓的配方书页面，配方相关的东西全走可合成物品这颗键"——上一批把"会自动关闭"读成了"配方书被关"，实现方向错了。"按钮自己灭"的真实原因是 `active` 绑在**红底筛选**上：从仓库点进来的第一次 `showUnowned` 还是 false，于是视图开了、按钮是灭的，看起来像自动关掉、得再点一下（那一下才把 `showUnowned` 打开）。
  - 验证：`npx tsx tools/ui-test.ts` **971 通过 / 0 失败**（把上一批那 3 条"那颗键开书"的断言换回"只切视图、不碰配方书"，`active` 那条改成只看视图且覆盖工作站分支）。
  - 批次：20261024-1636
- [x] [修15] 台账改口径：`DONE.md` / `notes/batches.md` / `OVERVIEW.md` / `TASKS.md` 里"那颗键打开配方书"的说法全部改成"可合成物品视图开关 + 亮着跟着视图" → `npm run check`
  - 做了什么：1609 那批的 DONE 条目补一行"更正"，本批次另开一节；OVERVIEW「物品栏与合成」、TASKS 队列落地、批次索引都改成正确口径（滚动条那部分不动）。
  - 为什么：文档里留一句错的因果，下一轮还会把同一个误解再实现一遍。
  - 验证：`npm run check` 全绿（编号 / 覆盖度 / 差异 / 文档体量四条台账 + 全部离线套件）。
  - 批次：20261024-1636

## 批次 20261024-1609 · 2026-10-24 · 会话 723564b3

> **更正（批次 20261024-1636）**：本批 `[修11]` 的"那颗键打开配方书"是**误解**——用户澄清没有"配方书页面"，
> 那颗键是可合成物品视图的开关；已在 1636 改回。`applyInventoryChrome` 里不关配方书那条仍然保留
> （它修的是"R 键在容器/工作站界面里开的书被重排关掉"，与本条无关）。滚动条那两条（修12/修13）不受影响。


- [x] [修11] 标题栏"配方书"键真的能打开配方书，且**不再自动关闭**：`src/ui/InventoryScreen.ts`（按钮 click 分支 + 把 `applyInventoryChrome` 里两处 `onCloseRecipes()` 挪到 `openWith` 的换面板处）→ `npm run test:ui`（断言：仓库里点它＝左栏切"全部/搜索"并调 `onOpenRecipes('all')`；重排函数里不再有 `onCloseRecipes`；换成别的面板时才关书）
  - 做了什么：① 那颗键改三分支——书开着→关；左栏已在分类页→切"列出未拥有（红底）"（保留 1531 口径）；左栏在仓库→`openPocketCategory('all')` + `onOpenRecipes('all')`（容器/工作站两类不弹书，没有可摆的合成格）。② `applyInventoryChrome()` 里容器分支与工作站分支那两行 `onCloseRecipes()` 删除，"换面板就收书"并进 `openWith()` 的 `mode/容器变了` 块与 `openTrade()`；`openWith` 末尾那条只在 inventory/crafting 生效的窄条件一并去掉。③ 那颗键"亮着"的判据加上 `bookOpen`，title 改成"点下去会发生什么"。
  - 为什么：根因是 `openRecipeBook()` 先 `show()` 再 `syncRecipePane()`，而 sync 走的就是 `applyInventoryChrome`，容器/工作站两条分支无条件 `onCloseRecipes()` → 书刚打开就被自己关掉（用户报的"配方书会自动关闭"）。关书是玩家意图（✕/R/换界面），不该是布局副作用。另外 1531 的 B 口径让手机彻底没有配方书入口（当时记成已知缺口），本轮反馈说明要的是书本身。
  - 验证：`npx tsx tools/ui-test.ts` **971 通过 / 0 失败**（本批新增 8 条、改 3 条旧断言：开书 2 条、重排不关书 / 收书位置 2 条、滚动条槽位与黑色滑块 4 条；旧断言里"只切分类、不碰 `onOpenRecipes`"两条与"`active` 只看 `showUnowned`"一条按新口径重写）。
  - 批次：20261024-1609
- [x] [修12] 左栏滚动条与物品留出间距、滑块改成黑色：`index.html`（分类/创造网格 `padding-right` 预留槽位、列宽可缩、滑块 `#1c1c1c`）+ `src/ui/InventoryScreen.ts`（`scrollbarContentLeft` 的 clamp 不再把轨道推到物品上）→ `npm run test:ui`
  - 做了什么：分类网格 `repeat(7, 40px)` → `repeat(7, minmax(0, 40px))`、`padding-right: 5px` → `15px`（= 8px 间距 + 7px 轨道），`.inv-category .inv-slot` 改 `width:100% / aspect-ratio:1 / max 40px`；双栏创造栏同样处理（`padding-right: 14px` = 8 + 6）；滑块 `#c2c2c2 → #1c1c1c`（按下 `#3a3a3a`）；`scrollbarContentLeft()` 的夹紧上限从 `容器宽 - 轨道 - 1` 收到 `容器宽 - 轨道`。PC 那套 48px 规则同步（`minmax(0,48px)` + `padding-right: 15px`）。
  - 为什么：5px 的预留装不下"8px 间距 + 7px 轨道"，JS 的 `Math.min(…)` 就把轨道按回容器右缘、直接压在最后一列上——用户说的"应该与物品有一定间距"；浅灰滑块和浅灰面板同色，所以要求黑色。窄屏左栏只有 ~257px 而 7×40 要 286px，列宽不给收缩余地时最后一列本来就会被裁掉，滚动条更没地方站。
  - 验证：`npx tsx tools/ui-test.ts` 971 通过（新增 4 条：分类预留 15px = 8+7、双栏创造预留 14px = 8+6、夹紧上限不再 `- 1`、滑块为 `#1c1c1c` 且不再出现 `#c2c2c2`）。
  - 批次：20261024-1609
- [x] [修13] 断言与台账：`tools/ui-test.ts` 改掉旧断言 → `npm run check`
  - 做了什么：删/改 3 条旧断言（"那颗键只切物品分类（不碰 onOpenRecipes）"、"标题栏那颗键只切物品分类"、"`toggle('active', leftPane === 'category' && this.showUnowned)`"），补 8 条新断言；决策写进 `doing/723564-decision.md`（D1 恢复开书、D2 重排不关书、D3 间距靠 CSS 预留槽位）。
  - 为什么：这几条断言钉的正是本轮推翻的口径，留着会红（也会把回归锁死成旧行为）。
  - 验证：`npm run check` 全绿（typecheck + 全部离线套件 + 三张台账 + 文档体量），`ui-test` 971 通过 / 0 失败。
  - 批次：20261024-1609

