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

## 批次 20261025-0257 · 2026-10-25 · 会话 037060ab

> **这一批做什么（L8 · MS4 容器与收尾）**：补上最后一段权威——容器计时只由房主推进、
> 从属端只读；房主退出时先提示再关房、且不再重连；协议文档与代码逐条对齐到 v2；
> 台账写清 L8 四段状态；最后做一次 L8 自审。
>
> **L8 四段（MS1~MS4）代码与断言至此已齐**。仍然只剩两件只有人能做的：
> ① 人工双端验收（红石两端同时亮 / 同一只怪位置一致 / 打死同时消失且掉落一份 / 熔炉进度同步 / 房主退出提示）；
> ② `container`/`sign`/`frame`/`tnt` 的请求化（从属端操作仍直连上行，玩法不受影响）。
>
> ⚠️ 队列里「单测：从属端计时不前移」实际由**结构断言 + 联机断言**覆盖；要真在 node 里跑
> `tickContainers` 得先造一个 World，成本远高于收益——这一点写在条目说明里，没有假装写了单测。

- [x] [L8] 容器进度权威：熔炉 `cookProgress` / 酿造 / 漏斗冷却由房主推进并上行，从属端只读不推进 → 单测：从属端计时不前移
  - 做了什么：`tickContainers(dt)` 收进 `shouldSimulate(role,'containers')` 闸门（全文件只此一处调用）；`container` 消息加可选 `progress`（0..1），服务端**只在 `player.isHost === true` 时保留**并夹到 `[0,1]`，其余一律丢掉（内容照转）；`NetClient.sendContainer(..., progress?)` / `NetContainerState.progress` 打通；房主新增 `pushContainerProgress()`（1 秒节流，扫 64 格内 `progress > 0` 的容器入既有 80ms 防抖队列，顺带把槽位一起对齐）；从属端 `onNetContainer` 把 `progress` 写进 `cookProgress`（不 tick，所以只是"摆上去"，下一条快照覆盖）。
  - 为什么：熔炉进度是**每 tick 都在变**的量，而容器广播只挂在 `onMutate`（内容变化）上——不给它一条自己的低频上行，从属端的进度条只在"烧出一个东西"时跳一格。进度只认房主：从属端不推进计时，若允许它带 `progress`，一个假值就能把所有人的进度条改坏。写 `cookProgress` 而不是新加显示字段，是为了让既有进度条代码原样可用。
  - 验证：`npm run test:net` **165 → 168 通过 / 0 失败**（房主进度被转发、从属端进度被丢且内容照转、越界进度夹到 1）；`npm run test:ui` **1030 → 1034 通过 / 0 失败**（闸门只一处、1 秒节流、从属端只写 cookProgress、上行只由房主带 progress）；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。⚠️ 队列写的"单测：从属端计时不前移"实际由**结构断言 + 联机断言**覆盖（`tickContainers` 只有一处且在闸门里），没有另写 vitest —— 要在 node 里跑 `tickContainers` 得先造一个 World，成本远高于收益。
  - 未验证：双端开着同一个熔炉看进度条是否同步，需要手测。
  - 批次：20261025-0257
- [x] [L8] 房主退出：房间关闭 + 从属端 3 秒内给出明确提示（`core/net/NetSession.ts` 状态迁移）→ 单测状态迁移 + `npm run test:net`
  - 做了什么：服务端房主 `close` 时**立刻** `broadcast({t:'room-closed', reason:'host-left', graceMs})` 给同房其他人（提示，不是关房——他可能只是切后台）；宽限期到期仍未回来则**关房**：对同房每个人 `reject(socket,'host-left','房主已退出，房间已关闭', CLOSE_HOST_LEFT=4007)`。客户端新增 `room-closed` 分支与 `onRoomClosing` 回调、`roomClosed` 标记；`Protocol.ts` 把 `host-left` 加进错误码与致命名单；`NetSession.CloseReason` 新增 `roomClosed`（与 `fatal` 分开表达，重连一律 `stop`）；`main` 把它变成一句带秒数的提示（`net.hostLeft`），六语言补齐。
  - 为什么：房主走了等于这一局没人推进世界——怪不动、红石不亮、熔炉不烧，而界面一切正常，这种"看起来还能玩"的坏状态最难排查。所以先提示（3 秒内），到期再关房，并且**明确不再重连**（重连只会被同一个理由踢回来，每 3 秒撞一次把日志刷满）。`roomClosed` 与 `fatal` 分开记：日志/提示要说人话，别把"房主退出"写成"协议错误"。
  - 验证：`npm run test:net` **168 → 171 通过 / 0 失败**（房主掉线即通知、通知带 `graceMs`、到期关房给 `host-left`）；`npx vitest run tests/net-session.test.ts` 新增 3 条（`roomClosed` → offline/stop、重连途中也停、之后显式 connect 仍可重开）；`npm run test:ui` **1034 → 1038 通过 / 0 失败**；`npm run audit:i18n` 通过（2906/2906）；`npm run check:fast` **161/161 套全绿**。
  - 批次：20261025-0257
- [x] [L8] 协议文档 v2 收口：`docs/NET-PROTOCOL.md` 与本批新增/改动的消息逐条对照（`world` / `edit-request` / `entity-snap` / `entity-remove` / `authority` / `progress`）
  - 做了什么：`join` 的 `world` 补 `worldType`；§4 `container` 补 `progress?` 并写明"只有房主带得动、服务端夹到 [0,1]"；§5 补 `room-closed`（`reason` + `graceMs`）；§5.1 错误码表补 `password 4005` / `host-taken 4006` / `host-left 4007` 三行（原来只有 version/clientId/duplicate/joined）；§8 缺口表改写 6 行（`联机5` 种子冲突改自动断开、`联机12` 模拟只由房主跑、`联机15` 容器计时由房主推进、`联机19` 实体位置/血量/死亡已同步、`联机38` 权威口径改成房主唯一、`联机26` 种子按房）。另加 11 条 UI 断言把"这批动过的消息必须在文档里"钉住，防下次文档漂移。
  - 为什么：文档漂移是这类项目最常见的债——消息加了、字段改了，文档还停在上一版，下次照文档实现就会踩空。不做"文档 == 代码"的完全比对（要解析源码，成本远高于收益），只钉这一批动过的那些关键串 + 缺口表的现状口径。
  - 验证：`npm run test:ui` **1038 → 1049 通过 / 0 失败**（11 条：world 元数据、worldType、edit-request、authority、entity-snap、entity-remove、progress、room-closed、host-left、4007、缺口表现状）；`node .continue/hooks/check.mjs docs` 通过（文档体量上限内）。
  - 批次：20261025-0257
- [x] [L8] 台账落地：`.continue/OVERVIEW.md` + `TASKS.md` 的 L8 条目写清 MS2~MS4 结果 → `npm run check`
  - 做了什么：`OVERVIEW.md` 的联机段由「房主权威（MS1+MS2）」改成「MS1~MS4」，并补两句现状（实体快照、容器进度随房主 1s 下行、房主退出即关房）——体量 24462 → **24516 字节**（上限 24576，仍留 60 字节）；`TASKS.md` 的 L8 追加 MS4 落地结果与测试账，并写清 L8 现在剩的两件事（人工双端验收、四条消息的请求化）；`HANDOFF` 提交总数同步 1788，`audit:diffs` 重算（注意 227 → 226）。
  - 为什么：L8 四段都落地了，台账必须能回答"现在到底哪段完成、哪段只差人验"——否则下一批会从头再查一遍。`OVERVIEW` 贴着 24KB 上限，所以只加现状、不铺细节（细节在 `notes/net-multiplayer.md`）。
  - 验证：`npm run audit:tasks` 全绿（口径与 README / HANDOFF 一致）；`node .continue/hooks/check.mjs docs` 通过（200 行 / 24516 字节）；`npm run check` 全绿。
  - 批次：20261025-0257
- [x] [L8] [自审] L8 的「L1 可测量 / L2 可对抗 / L3 可外部」各一句 + 证据（指向具体文件与测试）
  - **L1 可测量**：每一条都不是"看着像一致"，而是能被数出来的断言——`npm run test:net` **171** 条（其中房主/权威/实体/进度/关房 24 条是本批新增）、`npm run test:ui` **1049** 条（含"闸门只此一处""每帧不重复调用""文档里有这条消息"这类结构断言）、`vitest` **506** 条（`SimMode` 12 / `EntitySnapshot` 10 / `SimApply` 10 / `RemoteBlockWrite` 5 / `NetSession` 11）。人能验的也定成了可判定的阈值：红石两端同时亮（同一 tick 内）、打死同一只怪两端同时消失且掉落**恰好 1 份**、熔炉进度差 **≤1 秒**（1s 下行）。
  - **L2 可对抗**：所有"客户端说了算"的地方都加了服务端侧的同一条尺子——谎报 `authority` 无效（按 `isHost` 重标，`test:net` 有断言）、非房主的 `block`/`blocks` 直接丢、`edit-request` 形状收口 + 令牌桶限频、`entity-snap` 只收房主且截断 256、`entity-remove` 键过滤、`container.progress` 只认房主并夹 `[0,1]`、`world` 元数据脏种子整份丢弃、`remoteWorldWritable()` 挡"种子错位时写脏地图"。**没防住的也照实记**：`move` 无位移校验（改包可瞬移）、容器不校验目标方块、`mob-hit` 仍按邻近认。
  - **L3 可外部**：不依赖游戏客户端就能复现——协议在 `docs/NET-PROTOCOL.md`（消息表 / 错误码 4001~4007 / 缺口表 / 规矩），`tools/net-test.mjs` 用**裸 WebSocket 客户端**跑全套（可见地证明"外部实现也能接"），`npm run server` + `npm run dev` 双端可手验；另有 11 条断言把"这批动过的消息必须在文档里"钉死，防止文档漂移；取舍与坑在 `notes/net-multiplayer.md` §五/§六。
  - 验证：三句话里能核对的部分都指到了可跑的东西——`npm run test:net` **171** 条、`npm run test:ui` **1049** 条（含 11 条"文档里有这条消息"）、`npx vitest run tests/` **506** 条；`node .continue/hooks/check.mjs docs` 通过（OVERVIEW 200 行 / 24516 字节）；`npm run check` 全绿。**L2 里"没防住的"三条（move 无位移校验 / 容器不校验目标方块 / mob-hit 按邻近认）不是本批目标，写在这里是为了别让下一批以为已经防住了。**
  - 批次：20261025-0257

## 批次 20261025-0221 · 2026-10-25 · 会话 037060ab

> **这一批做什么（L8 · MS3 实体权威）**：让"同一只怪"在两个屏幕上真的是同一只——
> 房主每 100ms 采集视野内的实体（位置/血量/朝向/状态位）推给从属端，从属端只插值画影子、
> 不跑 AI、不刷怪、不掉战利品。验收是用户手测「双人并排看 10 秒，怪物位置 / 血量 / 死亡一致」。
>
> 顺序：全局键 → 快照格式 → 采集 → 转发 → 从属端不跑 → 影子插值 → 死亡事件。
>
> ⚠️ 两处由入口条目顺带补上的：第 3 条（`SimAuthority`）的**上行接线**落到第 7 条一起做
> （原条目只要求模块与单测）；`MobAuthority.pickAuthority` 那套"最近玩家当权威"在 MS2 之后
> **不再参与决策**，只有 `mobKey`/`assignMobKey` 还在用。
>
> ⚠️ **未手测**：第 6 条（影子真的画出来）与第 7 条（打死两端同时消失、掉落只一份）——
> 这两条只能在浏览器里双端验，断言只到"表算对了 / 接线对得上"。

- [x] [L8] `Mob` 加全局键 `ownerId:localId`（复用 `src/core/net/MobAuthority.ts`）→ 单测：键稳定且可反解
  - 做了什么：`Mob` 加 `netKey = ''`（空串 = 单机/未分配）；`MobAuthority` 加 `assignMobKey(mob, ownerId)`——**幂等**（已有键原样返回，换分配者也不改）、脏 owner/localId 不分配（返回空串）。文件头补一段说明：`pickAuthority` / `isAuthority` 那套"最近玩家当权威"在 MS2 定下"房主唯一模拟"之后**不再参与决策**，真正在用的是 `mobKey` / `parseMobKey` / `assignMobKey`。
  - 为什么：两端的 `Entity.id` 各自从 1 递增，"3 号羊"在两边是两只不同的羊。要同步位置/血量，先把身份对齐；键一旦定下就不能半路换（换身份等于换一只怪），所以分配必须幂等。留 `pickAuthority` 不删是因为它描述了一个仍可能用得上的判定（将来做分片模拟要回来找），但**不能**再让它参与这里的决策——两套权威同时存在必然打架。
  - 验证：`npm run test:unit` 里 `tests/mob-authority.test.ts` 新增 5 条（分配后可反解、幂等且换分配者不改、不同生物/房主不同键、脏 id 不分配、已有键不被覆盖）；全量 **468 → 473 条通过**；`npm run typecheck` 通过。
  - 批次：20261025-0221
- [x] [L8] 新增 `src/core/net/EntitySnapshot.ts`：实体快照序列化 / 反序列化 → 单测往返一致
  - 做了什么：定义 `EntitySnapshot`（key/type/坐标/yaw/health/flags）与线上形态 `WireEntity = [key,type,x,y,z,yaw,health,flags]`；`encodeEntities` 按 0.01 取整、丢键不合法/类型为空/数字非有限/超上限（256 条）的条目；`decodeEntities(raw, maxHealth?)` 逐条校验、坏条目单独丢、血量可选夹住；`ENTITY_FLAGS`（baby / onFire / hurt / tamed）配 `hasFlag` / `withFlag`。
  - 为什么：100ms 一条的快照，字段名不进包（数组比对象省一半以上字节），坐标也不该带毫米精度。**外部数据一律当不可信**：一条坏数据不该让整包作废（与 `blocks` 同口径）；血量在入口夹住，免得从属端画出负长度的血条。AOI 裁剪/分组/排序不放在这里——那些要世界状态，纯函数里做不了也就测不了。
  - 验证：新增 `tests/entity-snapshot.test.ts` **10 条**（往返一致、编码时丢非法键/空类型/非有限数、解码时坏条目单独丢、血量夹住/不传则原样、256 上限截断、非数组输入、状态位对称与互不冲突）；全量 **473 → 483 条通过**；`npm run typecheck` 通过。
  - 批次：20261025-0221
- [x] [L8] 房主每 100ms 采集 AOI 内实体并按房 + 维度上行：新增 `src/game/sim/SimAuthority.ts` → 单测：只采 AOI 内
  - 做了什么：`SimAuthority.ts`——`ENTITY_SNAPSHOT_INTERVAL_MS = 100`、`ENTITY_SNAPSHOT_RADIUS_CHUNKS = 8`（与服务端 AOI 同一把尺子）、`withinEntityAoi`（同维度 + 水平**切比雪夫**）、`collectEntitySnapshots`（近的排前面，超一包上限时先丢远处的）、`encodeEntitySnapshots`（筛范围 + 编码一步到位）。
  - 为什么：只由房主采——MS2 定下"世界只由房主模拟"之后，"最近玩家当权威"那套会让两只手交接时位置跳一下。范围必须同维度：从属端在下界收到主世界的怪只会画出幽灵。**近的优先**是因为村庄里可能几百只，一包上限 256 条，丢远处比丢近处合理（近处正被玩家看着）。半径用切比雪夫而不是欧氏，是为了和服务端 `withinAoi` 完全一致——两边尺子不同会出现"房主发了、服务端又丢掉"的怪现象。
  - 验证：新增 `tests/sim-authority.test.ts` **11 条**（默认半径边界 8 区块 = 128 格、y 不影响、维度不同不采、NaN 不采、半径可调、只采范围内、近的排前、状态位原样、空输入、一步编码、编解码往返）；全量 **483 → 489 条通过**；`npm run typecheck` 通过。
  - 批次：20261025-0221
- [x] [L8] 服务端转发 `entity-snap`（房间 + AOI 过滤，不做内容校验）→ `npm run test:net`
  - 做了什么：`server/protocol.mjs` 加 `MAX_SNAPSHOT_ENTITIES = 256` 与 `sanitizeEntitySnap()`（只保证是个不超过上限的数组）；`server/index.mjs` 加 `case 'entity-snap'`——**只收房主**（房里有房主时非房主直接丢），按房 + AOI（发送者位置为中心）转发；客户端补 `sendEntitySnapshot()`（非房主空操作）与 `onEntitySnap` 回调；协议文档上下行各一行。
  - 为什么：服务端没有世界也没有生物表，判不了"这只僵尸该不该在这"，所以只做形状收口 + 转发；语义把关放在两端（房主 `SimAuthority` 只采 AOI 内、从属端 `decodeEntities` 逐条洗）。只收房主是"谁模拟谁是权威"的直接推论——否则任何人都能广播一整套假实体。
  - 验证：`npm run test:net` **157 → 162 通过 / 0 失败**（房主推的快照被转发且带 `by`、从属端推的被丢弃、空数组/非数组不转发、超过 256 条被截断）；`npm run typecheck` / `typecheck:tools` 通过；`npm run check:fast` 5/5 套全绿。
  - 批次：20261025-0221
- [x] [L8] 从属端跳过 `MobSpawner.update` 与 `updateMobs` → 单测：client 角色下生成数为 0
  - 做了什么：`main` 里 `mobSpawner.update(dt, ctx)` 收进 `if (shouldSimulate(this.net.role,'mobs'))`（全文件只此一处）；`EntityManager.update(ctx, dt, shouldTick?)` 新增**逐实体过滤**，`main` 从属端传 `(entity) => !(entity instanceof Mob)`——生物不推进，**箭/掉落物/经验球照旧 tick**（联机23 的箭是各端自跑的）。
  - 为什么：从属端刷怪 + 跑 AI 会得到第二套轨迹，这正是"两人看到同一只僵尸在不同位置"的根源。但不能整个 update 都跳过：箭和掉落物没有快照来源，跳了就是"从属端射出去的箭卡在原地"。被跳过的实体也**不**从表里删（下一帧快照还要用）。
  - 验证：新增 `tests/entity-manager-filter.test.ts` **4 条**（不传过滤=老行为、按名字只跳过点名的那个、被跳过的实体留在表里）；`npm run test:ui` **1019 → 1022 通过 / 0 失败**（闸门只一处、逐实体过滤写法、`shouldTick` 签名）；全量单测 **489 → 493**；`npm run check:fast` **7/7 套全绿**。
  - 批次：20261025-0221
- [x] [L8] 从属端影子实体 + 插值：新增 `src/game/sim/SimApply.ts`（复用 `RemoteInterpolation`）→ 单测：给定快照序列位置收敛
  - 做了什么：`SimApply.ts`——影子表（`key → 内部状态`）+ `apply(raw)`（新的建、旧的更新目标、缺席累计）+ `step(dt)`（按 key 排序输出渲染状态）+ `remove(key)` / `clear()`；插值直接复用 `RemotePlayerSmoother`（> 8 格瞬移对齐、最短角转向）。主程序侧：`simApply` + `shadowMobs` 两张表，`onEntitySnap` 只在 `role === 'client'` 时收，每帧 `syncShadowMobs(dt)` 把影子摆到插值位置并同步血量/幼体/着火/受击闪，影子消失时 `dead = true` 交给 `EntityManager` 清；断开时 `clearShadowMobs()` 全撤。
  - 为什么：① 100ms 一条快照直接赋值，模型会一格一格跳；② 快照按 AOI 裁，实体走到边界会"这帧在、下帧不在"，立刻删会一闪一闪——所以留 3 次缺席宽限；③ 真死由 `entity-remove` 事件驱动（下一条），否则"走到边界"和"被打死"会混成同一种表现。房主不建影子：它自己那份就是真身。
  - 验证：新增 `tests/sim-apply.test.ts` **10 条**（新建即到位、4 格内逐帧逼近、>8 格直接对齐、缺席 3 次仍在第 4 次消失、重新出现清零计数、`remove` 立刻删、血量按类型夹住、坏快照不搅乱已有影子、输出顺序稳定、`clear`）；`npm run test:ui` **1022 → 1025 通过 / 0 失败**；全量单测 **493 → 503**；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。
  - 未验证：从属端真的画出房主的那只怪，需要浏览器双端手测（单测只能到"影子表算对了"）。
  - 批次：20261025-0221
- [x] [L8] 死亡与掉落由房主事件驱动（`entity-remove` + 已有 `item-spawn`）→ 单测：只掉一份、镜像同步消失
  - 做了什么：协议加 **`entity-remove`**（`keys[]` ≤64，**只收房主**，按房广播）；`NetClient` 补 `sendEntityRemove` / `onEntityRemove`；**顺带把第 3 条的上行接到主循环**（原条目只要求模块 + 单测）：房主每帧 `pushEntitySnapshots()` —— 先给每只怪 `assignMobKey(entity, selfId)`、收集 `SimEntity`（含幼体/着火/受击/驯服位），比对上一帧 `lastMobKeys` 把没了的立刻 `sendEntityRemove`，再按 100ms 节流 `encodeEntitySnapshots` 推快照；从属端 `onEntityRemove` 里 `simApply.remove` + 影子 `dead = true`。
  - 为什么：只靠"快照里消失"要等 3 次宽限（300ms），表现为"打死了还站着"，而且掉落出现的那一瞬对不上。**掉落只掉一份**是结构上保证的：从属端的影子根本不 tick（`shouldTick` 过滤掉 `Mob`），`Mob.die → dropLoot` 在那端永远不会跑；房主的掉落走既有 `item-spawn` 广播。
  - 验证：`npm run test:net` **162 → 165 通过 / 0 失败**（房主点名被转发、从属端点名被丢、空/非法键列表不转发）；`npm run test:ui` **1025 → 1030 通过 / 0 失败**（分配键再推、100ms 节流、死亡立刻点名、从属端撤影子、影子不 tick 故不会自掉战利品）；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。
  - 未验证：双端看"同一只怪被打死 → 两端同时消失、掉落只有一份"要手测。
  - 批次：20261025-0221

