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

## 批次 20261025-0122 · 2026-10-25 · 会话 037060ab

> **这一批做什么（L8 · MS2 世界权威）**：让"世界模拟只由房主跑"真正生效——从属端不再推进
> 红石/流体/作物/随机刻；从属端的建造走 `edit-request` 回到房主，由房主落地后以**权威结果**
> 广播。验收是用户手测「房主开关红石灯，两端同时亮」+「从属端拆/放方块，两端都看见」。
>
> 队列原第 4 条（"服务端只收房主的坐标类消息，其他人丢弃"）按字面做等于**没收从属端的建造**
> （拆、放、开箱子、写牌子全部不同步）。用户拍板选 A：给从属端加请求通道，于是这一条拆成 4 条
> （协议 / 从属端改道 / 房主落地重发 / 服务端丢旧路），见决策 D1。
>
> ⚠️ **未手测**：第 6 条（房主落地）整条链路只能在浏览器里双端验，单测只到接线。

- [x] [L8] 新增 `src/core/net/SimMode.ts`：三种角色"要不要跑模拟"的唯一入口（禁止散落 `if (role)`）→ 新增单测覆盖 solo/host/client 的取舍
  - 做了什么：`SimMode.ts` 只有两个概念：`SimDomain`（`blocks` / `mobs` / `containers` / `clock`，即"要不要推进"的四种域，**只增不减**）与 `shouldSimulate(role, domain)`；配一张表：单机全跑、房主跑方块/生物/容器但不碰时钟、从属一样都不跑。另有 `describeSimMode(role)`（打印"这一端在跑什么"，排查时第一句话就能答）与 `SIM_DOMAINS` 清单。
  - 为什么：判断"我该不该跑"必须只有一处——散成十几个 `if (role === 'client')` 总有一处漏，而漏掉的表现是"某一端某样东西还在自己动"（红石两边亮灭不同 / 怪的血量对不上 / 熔炉进度差几秒），**不报错**，只能靠两个人对着屏幕看半天。`clock` 单列出来划给单机：联机时时间由服务端 `time` 权威、客户端 4 倍速追，任何一端再自己走就是两个时钟。
  - 验证：`npx vitest run tests/sim-mode.test.ts` **10 条通过**（三列全跑/全不跑/房主四项逐格、联机谁都不推时钟、三×四组合无 undefined、域清单与类型键集一致）；`npm run typecheck` 通过；`npm run check:fast` 命中 5/5 套全绿。
  - 批次：20261025-0122
- [x] [L8] `src/main.ts` 的 20Hz tick 接上 `SimMode`：从属端跳过 `tickWorldBlocks` → 单测断言 client 角色下写入次数为 0
  - 做了什么：20Hz 循环里 `this.tickWorldBlocks(TICK_SECONDS)` 换成 `if (shouldSimulate(this.net.role, 'blocks')) …`（闸门只有这一处，`main.ts` 里 `tickWorldBlocks(` 的出现次数 = 1，由 UI 断言钉住）；`onNetWelcome` 里补一行 `console.info('[net] 模拟模式：' + describeSimMode(role))`。
  - 为什么：这是 `SimMode` 第一次真正接管行为——从属端不再推进红石/流体/作物/随机刻，否则就是两端各算一遍、靠广播收敛（极端情况短暂不一致且**不报错**）。日志那行是给排查用的：以后听到"某一端某样东西还在动"，先看这行就知道它到底在跑什么。
  - 验证：`npx vitest run tests/sim-mode.test.ts` **10 → 12 条**（新增：跑 100 个 tick 时 client 推进 0 次、host/solo 各 100 次）；`npm run test:ui` **1010 → 1013 通过 / 0 失败**（闸门在、没有第二处裸调、日志在）；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。
  - 批次：20261025-0122
- [x] [L8] 房主方块改动带 `authority: true` 上行：`src/net/NetClient.ts`（`BlockFunnel` 那一路）→ `npm run test:net`
  - 做了什么：`NetClient.sendBlocks()` 在 `this.role === 'host'` 时给消息加 `authority: true`（声明"这批是我算出来的结果，不是玩家请求"）；服务端**不照抄**这个字段，`block` / `blocks` 的下行广播按 `player.isHost === true` **重新标注** `authority`。`docs/NET-PROTOCOL.md` 的四行（上行 block/blocks、下行 block/blocks）同步。
  - 为什么：权威标记必须是**服务端**判定的——照抄客户端字段等于没有权威（谁都能自称房主）。它现在的用途是让下行能标出"这一格是房主算的"（排查/以后分流客户端请求），并给 MS4 的"只写房主的状态"留好依据。
  - 验证：`npm run test:net` **145 → 149 通过 / 0 失败**（新增 4 条：房主广播 `authority: true`、从属 `false`、**从属谎报 `authority: true` 仍被标 false**、单条 `block` 同口径；其中"从属 false"那两条在第 8 条改成"从属直接发一律被丢"——见那条的说明）；`npm run typecheck` / `typecheck:tools` 通过；`npm run check:fast` 5/5 套全绿。
  - 批次：20261025-0122
- [x] [L8] 协议加 `edit-request`：从属端的坐标类改动**转给本房房主**（无房主则丢弃并回 `no-host`）→ `npm run test:net`
  - 做了什么：`server/protocol.mjs` 加 `sanitizeEditPayload()`（只认 `block` / `blocks` 两种形状，条数截到 4096，**不校验世界语义**——y 范围/距离由房主落地时把关）；`server/index.mjs` 加 `case 'edit-request'`：借方块令牌桶限频、按房找房主、`send(房主, {t:'edit-request', from, payload})`，房里没房主回 `{ok:false, reason:'no-host'}`。`docs/NET-PROTOCOL.md` 上下行各补一行。
  - 为什么：房主权威之后世界只由房主推进，但从属端仍然要能建造（拆/放/开箱子）。直接把它的 `blocks` 丢掉等于没收建造能力，所以改动以"请求"形式回到房主——服务端在这条链上**只做路由**：不判权（房主由 `hosts` 决定）、不落地（它没有世界）、不校验内容（那是房主那端的事）。
  - 验证：`npm run test:net` **149 → 154 通过 / 0 失败**（房主收到请求且带 `from`、payload 原样转发、不认识的载荷不转、没房主时回执 `no-host`）；`npm run typecheck:tools` 通过；`npm run check:fast` 5/5 套全绿。
  - 批次：20261025-0122
- [x] [L8] 从属端：`block` / `blocks` 上行改走 `edit-request`（本地仍乐观应用，不打断手感）→ `npm run test:net`
  - 做了什么：`NetClient.sendBlocks()` 按角色分叉——`host` 发 `{t:'blocks', blocks, authority:true}`（权威结果），其余发 `{t:'edit-request', payload:{t:'blocks', blocks}}`（请求）；本地写入顺序不变（先本地应用、再上行），手感不受往返影响。新增两个回调 `onEditRequest(from, payload)` / `onEditRejected(reason)`，收包分支按 `ok === false` 区分"回执"与"转给房主的请求"；`main` 把 `no-host` 回执做成**3 秒一次**的聊天提示（改十格会连发十条，不限制就刷屏）。六语言补 `net.editNoHost` / `net.editRejected`。
  - 为什么：从属端的改动没有别的路径到房主。本地必须**乐观应用**，否则每次挖掘都要等一次往返才有反馈；代价是收敛窗口内可能和房主算出的结果不同，以房主广播为准覆盖。`no-host` 必须说出来——否则玩家在"没有房主的房"里建造，看起来成功、实际谁都没收到。
  - 验证：`npm run test:ui` **1013 → 1016 通过 / 0 失败**（三条结构断言：角色分叉、两个方向的收包分支、回执限频）；`npm run audit:i18n` 通过（六语言 2904/2904）；`npm run typecheck` 通过；`npm run check:fast` 161/161 套全绿（首次跑 `mob` 偶发红一次，单跑与重跑均绿，属并行抖动——本批第二次遇到，已记进 `notes/tips-tooling.md`）。
  - 批次：20261025-0122
- [x] [L8] 房主侧：收到 `edit-request` 后在自己的世界应用（不抑制回声），由 `BlockFunnel` 作为**权威结果**重发 → 单测：请求一次 → 广播带 `authority: true`
  - 做了什么：`main.applyEditRequest(from, payload)`——`role !== 'host'` 直接返回；走 `remoteWorldWritable()` 守卫；用 `readEditRequest()`（`RemoteBlockWrite.ts` 新增，坏条目单独丢）解析；逐条 `planRemoteBlock` → 记增量 → `setBlockAndUpdate` + `ensureBlockEntityAt`，**不包 `applyingRemoteBlock`**，于是 `onBlockChanged` 会把它送进 `BlockFunnel`，由房主以 `blocks + authority` 重发。
  - 为什么：`onNetBlock` 那种"抑制回声"是为了不把队友的改动原样发回去；但房主是**替别人落地**，它必须进漏斗广播——否则请求者的改动只有房主自己看得见。请求者本地已乐观应用，收到同一格会再写一次（幂等），这正是"以房主结果为准"的收敛点。
  - 验证：`npm run test:unit` **458 → 463 条**（新增 `readEditRequest` 5 条：整组/单条/坏条目单独丢/非数组/维度原样带出）；`npm run test:ui` **1016 → 1019 通过 / 0 失败**（三条结构断言：落地**不**抑制回声、只有房主处理、先记增量再写世界）；`npm run typecheck` 通过；`npm run check:fast` **6/6 套全绿**。
  - 未验证："从属端放一格 → 房主落地 → 大家看见"这一整条要浏览器里双端手测（单测只能断言到接线）。
  - 批次：20261025-0122
- [x] [L8] 服务端：非房主的 `block` / `blocks` 一律丢弃（此时从属端已改走请求通道）；container / sign / frame / tnt 的请求化留到后面 → `npm run test:net`
  - 做了什么：`block` / `blocks` 两条上行加前置判定——**房间里有房主时**，`player.isHost !== true` 直接 `rejectEdit(player,'not-host',…)` 丢弃；没房主的房间保持老行为（那种房里没人推进世界，谁改都一样）。协议文档的两行同步。
  - 为什么：这是 A 方案的最后一环——从属端已改走 `edit-request`，旧路留着就等于把权威又还给每个客户端（谁都能直接广播一个"我算的结果"）。**按房判定**而不是无条件丢弃，是为了不把"有人直接 join、没带 host"的老用法打死。
  - 验证：`npm run test:net` **154 → 157 通过 / 0 失败**（从属端直接发 `blocks` / `block` 都被房主那边收不到、房主自己发仍被广播）；顺带改写了第 3 条那段"从属端 authority: false"的断言——MS2 起从属端这条路已被丢弃，旧断言描述的行为不存在了；`npm run check:fast` 5/5 套全绿。
  - 批次：20261025-0122
- [x] [L8] 从属端应用顺序：`src/core/net/RemoteBlockWrite.ts` 保证"先写增量再交给渲染"，乱序到达不丢改动 → 单测
  - 做了什么：`RemoteBlockWrite.ts` 新增 `applyRemoteBlock(action, edit, sink)` 与 `RemoteBlockSink`（`record` / `apply`），把"先记增量、再写世界"的顺序收进一个函数；`main.onNetBlock` 改成走它（原来这两步直接写在方法里）。配套 `tests/net-block-buffer.test.ts` 加 5 条：apply 顺序、buffer 只记、drop 两个钩子都不碰、**写世界抛异常时增量已经记下**、同格多次到达只留最后一稿（`edits.count` = 1 且 `applyTo` 叠进去的值是最后一稿）。
  - 为什么：顺序是有语义的——反过来的话"写世界时抛异常 / 区块正好被卸载"这条路径上改动只留在内存里，读档或重进区块就没了。以前这两行顺序写在 `onNetBlock` 里，谁调个位置都不会有测试红。快照路径（`onNetWelcome` 的 edits 循环）本来就是"先记再写"，未改。
  - 验证：`npm run test:unit` **458 条通过 / 54 套**（含新增 5 条）；`npm run typecheck` 通过；`npm run check:fast` 5/5 套全绿。
  - 批次：20261025-0122

