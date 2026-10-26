# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261026-2011 · 2026-10-26 · 会话 783135b3

> 用户 2026-10-26：**联机期间创建的所有东西都写回房主本地**；房主离开后服务器把这个房间的信息清掉；
> 房主离线期间的改动也只存本地；再次开房时服务器以**房主本地**为准重建——一句话：
> **服务器上的一切变更都回到房主本地，两边始终以房主为准**。
> 两个已拍板的取舍：① 服务端**不保留**"只读救援副本"（房主设备丢 = 这一局全丢）；
> ② 方块增量走**按区块懒上行**（不是开房全量推）。

# 队列 · 会话 783135b39ab64f5599ca2897f9593157

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-2011

- [x] [L8] 房主联机不切 `@mp:` 库（改动直接落单机存档）+ 联机期保存压到 10 秒、断开前强制落盘：`src/main.ts` 的 `enterMultiplayerSave` / `tickAutoSave` / `onStatus(false)` → `npm run check:fast`
  - 做了什么：`enterMultiplayerSave()` 开头按 `this.net.role === 'host'` 早退（房主全程用 `world.id` 那个单机库），`leaveMultiplayerSave()` 因此对房主自动 no-op、也不再原地重载；新增 `hostSession`（在 `onNetWelcome` 里记一份，断开善后里用掉并清掉，因为那时 `role` 已经回 `solo`）；`tickAutoSave()` 取 `min(设置值, 10s)`；`onStatus(false)` 里房主先 `saveNow('mp-host-leave')` 再做其它善后。
  - 为什么：房间数据只存房主本地之后，"最后 30 秒"没有任何备份，而原先房主的改动写进 `@mp:` 库（只写不读）等于退出即丢。取 `min` 而不是直接赋值是为了不和玩家自己设的 5 秒打架。
  - 验证：`npm run check:fast` 全绿（typecheck + i18n 审计 + 586 条单测；离线套件不覆盖 `src/main.ts`，脚本自己提示了这一点）。
  - 待人工：双端手测"联机盖房 → 退出房间 → 单机进同一个世界，房子还在"（需要浏览器 + 两个客户端）。
- [x] [L8] 服务端清场：新增 `clearRoom()`，房主新上位与关房时各清一次 → `npm run test:net`
  - 做了什么：`clearRoom(room)` 按房名前缀清 edits/containers/signs/frames，顺手清同房玩家的掉落物、`roomWorlds`/`roomGameModes`、两张区块追踪表；三处调用——① 关房（房主宽限期结束）② `join` 里 `wantsHost` 分支（`send(welcome)` 之前）③ 由 ② 兜住"服务端崩溃重启后的残留"。
  - 为什么：房间数据以房主本地为准，残留会在下一局被 `welcome` 发出去，等于服务端把房主的世界改回去。判据用 `sameHostReturning = grace && hosts.get(room)?.id === player.id`：**宽限期内重连的房主不清**（他切后台回来还是同一局）。原先想用 `host.id !== player.id`，但那条件实际上是死代码——新 host 在 `host-taken` 那道闸就被拒了，能进来的只有"本人重连"。
  - 验证：`npm run test:net` **217 → 226 通过 / 0 失败**（新增 9 条：房主写方块+容器 → 队友能看到 → 断开 120ms 内同 clientId 重连仍是房主且缓存不清（新队友仍收到那 9 条）→ 宽限期过后进同房名 welcome 全空、新房主上位也不继承）。
- [x] [L8] 服务端不再持有世界存档：`worldSnapshot()` 只留时间/天数/天气，`SNAPSHOT_VERSION` 升 2 并兼容读 v1（旧房间数据静默丢弃）→ `npm run test:net`
  - 做了什么：`worldSnapshot()` 删掉 edits/containers/signs/frames 与 `seed`，只剩 `version/savedAt/timeOfDay/day/weather`；读档块删掉四张表的还原循环，只回填天气/时间/天数，并在版本不符时打一行说明；`roomOfDataKey()`（只为落盘拼房名）与它的 `DEFAULT_ROOM` 导入一并删掉；`store.mjs` 的 `SNAPSHOT_VERSION` 1 → 2，新增 `READABLE_VERSIONS`（v1 仍可读，不当损坏）。
  - 为什么：房间数据以房主本地为准之后，"服务端还存着一份世界"会立刻变成第二份事实——重启后被 `welcome` 发出去就是把房主的世界改回上次的样子。v1 不当损坏是因为内容完好、只是格式旧，时间/天数/天气仍然有效。
  - 验证：`npm run test:net` **226 → 236 通过 / 0 失败**（改写原"重启后方块还在/容器还在"两条为"不再复活"；新增直接读 `world.json` 断言 v2 + 四张表不存在 + 时间仍在；新增 v1 升级用例：手写 v1 文件 → 不被改名成 `.broken` → 方块/容器/牌子/展示框全丢弃、时间 0.5 与天气 rain 被沿用）。
- [x] [L8] 方块增量懒上行（服务端侧）：`edits-request` 下发给房主、`edits-reply` 收下并广播 `blocks`，`pushChunkEdits` 改成"已确认直接推、未确认向房主要" → `npm run test:net`
  - 做了什么：新增 `confirmedChunks`/`requestedChunks`（按房一份，上限 4096 / 在飞 8）+ `trackedChunks`/`rememberTracked`；`pushChunkEdits` 拆成"直接推缓存"（`sendChunkEdits`）与"向房主要"（`requestChunkFromHost`，5 秒后忘掉这次在飞，回包丢了下次 move 会重试）；新增 `edits-reply` 分支（只收本房房主、复用 `blockEditRejection`、坐标必须落在声称的那一块里、收下后按房广播 `blocks`）；`snapshotFor` 对房主不再下发 edits/容器/牌子/展示框（双保险）。
  - 为什么：`edits-reply` 不复用 `blocks` 是因为**空区块必须能回"没改过"**——`blocks` 的空列表在现有逻辑里直接 return，而 `requested` 不清就会被无限请求。**没有房主的房**（有人直接 join）没有权威可问，退回老行为"服务端缓存就是共用那份"，否则那类房间的跨区块补发会整条失效。
  - 验证：`npm run test:net` **236 → 243 通过 / 0 失败**（新增 7 条：队友跨进未确认区块 → 房主收到 `edits-request{dimension,cx,cz}` → 回包后队友收到 `blocks` → 另一块再要一次 → 空块确认后不再重复询问 → 确认过的块会进后来者的 welcome）。踩到一次 `move` 50ms 限频（第二次 move 被直接丢），用例里补了 `sleep(80)`。
- [x] [L8] 房主响应 `edits-request`：`src/net/NetClient.ts` 加收发、`src/main.ts` 从 `world.edits` 取整块回包 → `npm run check:fast && npm run test:net`
  - 做了什么：`NetClient` 加 `onEditsRequest` 回调 + `edits-request` 分支 + `sendEditsReply()`（空块也发；超过 4096 条拆包）；解包抽成纯函数 `core/net/ChunkSnapshot.ts#chunkSnapshotBlocks()`，`main.ts` 的 `replyChunkEdits()` 只负责"取快照 → 交给它 → 发出去"。
  - 为什么：解包是最容易错的一步，抽出来才能离线断言。**实际抓到两个 bug**：① `Chunk.coordsAt()` 返回的是**区块内** x/z（y 是世界坐标），原来忘了加 `cx*16 / cz*16`，所有补发的方块会堆在区块西北角——而原点附近的房间看起来完全正常；② 返回类型写成 `number[][]` 装不下末位的维度名。第一个由新增用例 `区块坐标必须加到局部坐标上` 直接钉住（含负区块坐标 `z = -33`）。
  - 验证：`npm run check:fast` 全绿（typecheck + **593** 单测，较基线 586 增 7 条：空快照/空表/坐标与状态位/区块偏移含负坐标/条目形状/相邻区块不混/位运算往返）；`npm run test:net` **243 通过 / 0 失败**（服务端那条链上一批已覆盖）。
- [x] [L8] 房主开局整份上行容器/牌子/展示框（`session-sync`）：服务端按房广播、客户端在 `welcome` 之后发 → `npm run test:net`
  - 做了什么：服务端新增 `session-sync` 分支（只收本房房主、`kind` 分 container/sign/frame、形状校验与各自的单向消息同口径但**不设距离闸**、按条数上限 `SESSION_SYNC_MAX_MESSAGES=256`，收下后按房广播）；客户端 `NetClient.sendSessionSync()`（200 条一包，空集合也发）+ `App.flushSessionSync()` 在 `welcome` 后触发，**读档没回来就先挂起**（`waitingForSaveRestore`），在 `start()` 的读档 `.then/.catch` 里补推。
  - 为什么：这三种不能像方块那样懒补——队友打开一个空箱子就会往里放东西，然后被服务端那份覆盖。挂起是因为时机：`welcome` 往往早于读档完成，那时容器表还是空的，直接推等于告诉服务端"这人没有箱子"。
  - 验证：`npm run check:fast` 全绿（typecheck + 593 单测）；`npm run test:net` **243 → 252 通过 / 0 失败**（新增 9 条：清场后 welcome 无箱子 / 房主推完后**先进来的**队友当场收到 container+sign+frame 三条广播 / **后进来的**队友从 welcome 拿到三样 / 从属端伪造 `session-sync` 被无视）。
- [x] [L8] 协议文档与台账收口：`docs/NET-PROTOCOL.md` 补两条消息与"服务端不持有存档"口径 + `TASKS.md` 落 L8 → `npm run check`
  - 做了什么：`NET-PROTOCOL.md` —— §2 补"世界以房主本地为唯一真相 + 服务端只是会话缓存"的完整口径与代价；§4 新增 `edits-reply` / `session-sync` 两行（含校验与"空块必须回"）；§5 新增 `edits-request` 行、改写 `welcome`（房主不带世界数据）；§6 改正三处过期数字（增量上限 20 万→50 万、世界种子不落盘、快照内容 v2）并补"房间清场/懒上行在飞上限/session-sync 上限"四行；§7 新增 `edits-request` 的客户端行为；§8 改写 `联机13`/`联机14`/`联机26` 三条。`TASKS.md` 的 L 段新增 L8 条目（口径 6 点 + 两条 ⚠️ 取舍/坑 + 待人工）。`OVERVIEW.md` 的联机条目与坑各补一句（压在 200 行 / 28672 字节上限内）。`HANDOFF.md` 进度口径 303/295 → 304/296。
  - 为什么：文档漂移是这项目最常见的债，数字更是一抄就漂——`audit:tasks` 当场抓住了 HANDOFF 的 295 与 README 的路线图状态列，按"数字只由脚本生成"的口径重写。
  - 验证：`npm run check` 全绿（typecheck + 181 套离线测试 + 三张台账；`audit:tasks` 报"共 304 项（296/5/0/3）、编号无重复、各段连续"）；`node .continue/hooks/check.mjs docs` 通过（OVERVIEW 恰好 200 行 / 27874 字节）。

## 批次 20261026-0620 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：https 访问局域网设备是**浏览器权限**层面的开关（Chrome 本地网络访问 / Firefox 对应开关），
> 不需要我们提前拒绝——把上一批那两处「硬拦」改成「先试、再提示」。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0620

目标（用户 2026-10-26）：https 页面能不能访问局域网设备，是**浏览器权限**层面的开关
（Chrome「本地网络访问」/ Firefox 对应开关），不该由我们提前拒绝——把上一批的两处"硬拦"改成"先试、再提示"。

- [x] [授权1] 「选择服务器」面板 https 页面不再禁用扫描：照样扫，扫不到才提示去开权限 → 验收：`npm run test:ui`
  - 做什么：`ServerPicker.open()` 不再 `disabled = true`，只在状态行放一句 `server.httpsHint`；扫描结束仍为空且页面是 https 时，把"没找到 · 去授权"合并成一行提示；`server.scanBlocked` 文案换成 `server.httpsHint`（六语言，内容改为"允许本站访问本地网络"的具体路径）
  - 为什么：Chrome 的 Local Network Access 权限开通后，https 页面可以访问 `http://` / `ws://` 局域网设备（Firefox 也有开关）。禁用按钮等于把一条其实可用的路堵死
  - 验证：`npm run test:ui` **1195/0**（断言改成"不再禁用 + 有授权提示"）；`npx tsc --noEmit` 干净；`audit:i18n` 通过
  - 批次：20261026-0620
- [x] [授权2] 开房预检先尝试、连不上才归因「https 需要授权」→ 验收：`npx vitest run tests/host-preflight.test.ts`
  - 做什么：`preflightHost` 取消提前 return，照常 `canOpen`；失败**且**（页面 https + 目标 ws://）才回 `https-blocked`；该原因的文案改成同时给两条办法（去授权 / 换 http 打开）
  - 为什么：上一批我把它写成"连尝试都不尝试"，同样是替玩家做了决定。授权过的浏览器本来就该能开房
  - 验证：`npx vitest run tests/host-preflight.test.ts` **9/9**（+2：https+ws 连不上 → https-blocked 且**确实尝试过**；https+ws **连得上 → 放行**）
  - 未验：真机在授权后开房（要 Chrome 的 LNA 权限，无头环境造不出来）
  - 批次：20261026-0620

## 批次 20261026-0600 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：服务器跑在电脑上、手机在同一局域网里开房失败（之前能成功）。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0600

目标（用户 2026-10-26）：服务器跑在电脑上、手机在同一局域网里**开房失败**（之前能成功）。

- [x] [开房1] 预检把「连不上」与「被浏览器拦（https 页面连 ws://）」分开：`HostPreflight` 新增 `https-blocked`，开房对话框给专门文案 → 验收：`npx vitest run tests/host-preflight.test.ts`
  - 做什么：`HostPreflightDeps` 加 `pageProtocol`（默认真实 `location.protocol`）；`pageProtocol === 'https:' && /^ws:\/\//` 时**不建 socket**直接返回 `https-blocked`；`main.ts` 映射成 `mp.hostHttpsBlocked`（六语言）；两条失败分支都补 `console.warn`（带目标 URL）
  - 为什么：混合内容跟网络无关——https 页面连 `ws://192.168.x.x` 会被浏览器直接拒，玩家改 IP、换端口、重启服务器全都没用。以前两种情况都回 `unreachable`，于是手机（页面在 https 上）开房失败看到的是一句"连不上服务器"，方向从一开始就错了
  - 验证：`npx vitest run tests/host-preflight.test.ts` **8/8**（+2：https+ws → https-blocked 且**不建 socket**；http+ws 正常放行）；`npx tsc --noEmit` 干净；`npm run audit:i18n` 通过
  - 批次：20261026-0600
- [x] [开房2] 服务端启动打印**局域网地址**（不再只打 localhost）→ 验收：真机启动输出
  - 做什么：`server/index.mjs` 用 `os.networkInterfaces()` 列出所有非 internal 的 IPv4，逐条打 `ws://<ip>:<port>`，并把原来那句"玩家把游戏指向 ws://localhost 即可联机"改成"本机自连（只有这台机器能用）"
  - 为什么：`localhost` 只对跑服务端那台机器成立，手机填它指的是手机自己——这正是"手机上不知道填什么/填了连不上"的常见起点
  - 验证：实测启动输出 `192.168.66.187 → ws://192.168.66.187:25190`（本机真实网卡）
  - 批次：20261026-0600
- [x] [开房3] 断言：ui-test 三条（预检分支 / 文案 / 启动打印）→ 验收：`npm run check:fast`
  - 做什么：`tools/ui-test.ts` 加三条结构断言
  - 验证：`npm run test:ui` **1195/0**（+3）；`npm run check:fast` 全绿
  - 未验：手机真机开房（无头复现不出"跨设备 + https 页面"这两个条件；已按最可能的原因把错误提示改准，并给出验证办法）
  - 批次：20261026-0600

## 批次 20261026-0500 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：「服务器地址除了手输，右侧加一个选择按钮 → 服务器选择界面（局域网扫描 / 公开服务器）」，
> 服务器要能被探测来测响应时间，选中自动回填；开房与加入两处都要。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0500

目标（用户 2026-10-26）：服务器地址除了手输，还要能「选」——地址框右侧一个按钮，点开进服务器选择界面；
界面里两个区域：**局域网扫描**（扫当前网段找可用服务器）与**公开服务器**（接口下发，先留入口）；
服务器要提供探测接口（发一个包、回一个包），用来测响应时间；选中后自动把地址填回；
**开房**与**加入房间**两处都要这个入口。

- [x] [服务器1] 服务端提供无状态探测接口 `GET /ping`（禁缓存、几十字节）→ 验收：`npm run test:net`
  - 做什么：`server/index.mjs` 在 `/healthz` 前加 `/ping`，返回 `{ok:true,t:Date.now(),v:PROTOCOL_VERSION}`，头里 `cache-control: no-store`
  - 为什么：局域网扫描要并发打 254 个地址，只能靠「谁能最快回一个字节」判断；不能复用 `/healthz`（要算吞吐与房间数），也不能用 WebSocket 握手（每条都要完整握手+关闭，浏览器同源并发还有上限）
  - 验证：`npm run test:net` **217/0**（+4：`/ping` 返回 ok、带协议版本、`no-store`、本机 RTT < 200ms）
  - 批次：20261026-0500
- [x] [服务器2] 发现逻辑收成纯模块 `core/net/ServerDiscovery.ts`（网段枚举 / 单点探测 / 并发扫描 / 可取消 / https 判定）→ 验收：`npx vitest run tests/server-discovery.test.ts`
  - 做什么：`subnetOf`（只认 10/8、192.168/16、172.16~31/12）→ `subnetHosts`（254 个）→ `probeHost`（量 RTT）→ `scanSubnet`（并发 32、边扫边回调、可取消、按 RTT 排序）；`canScanLan(protocol)` 判 https；浏览器实现 `browserReach` 用 `fetch(mode:'no-cors') + AbortController`
  - 为什么：这一段决定「能不能用」，必须能离线测（注入 `reach`/`now`，不打真网络）；`no-cors` 是因为局域网服务端不会给每个来源加 CORS 头，而我们要的只是「这地址有人在听」
  - 验证：`npx vitest run tests/server-discovery.test.ts` **15/15**（网段识别/公网拒绝、254 枚举、RTT 升序、边扫边回调、取消、https 判定 + 公开列表解析 3 条）
  - 批次：20261026-0500
- [x] [服务器3] 新增「选择服务器」面板 `ui/ServerPicker.ts`（局域网扫描区 + 公开服务器区 + 选中回填）→ 验收：`npm run test:ui` 结构断言
  - 做什么：标题行（关闭）、局域网区（网段输入默认从当前地址/页面地址推导 + 扫描按钮 + 状态行 + 逐条结果带 RTT）、公开区（`publicServersUrl()` 为空显示「接口还没提供」；有 URL 就拉 `{servers:[{name,address,region?}]}` 并列出）；点遮罩关闭；https 页面禁用扫描并说明原因
  - 为什么：做成「看一眼点一下」的浮层（挂 `<body>`、点遮罩即关），它夹在「填地址」这一步中间，做成第三个视图要多两次返回
  - 验证：`npm run test:ui` **1192/0**（+13 条结构断言）；样式 `.server-picker*` 与 `.world-pick` 落 `index.html`
  - 批次：20261026-0500
- [x] [服务器4] 两处入口接上：开房对话框地址行右侧 ▾（第三列）+ 加入面板地址行 ▾ → 验收：`npm run check:fast`
  - 做什么：`WorldScreen` 用现有 `makeRow(label, control, extra)` 第三参数放按钮，面板按对话框生命周期建/拆（`cleanup()` 里 `dispose`）；`MultiplayerScreen` 在地址行插到「找房间」左边，面板按需创建后常驻（该界面只建一次）
  - 为什么：两处填的是同一个东西，必须同一套面板；用 ▾ 而不是「选择」两个字——六语言长度差太多，`.world-row` 第三列只有 44px
  - 验证：`npx tsc --noEmit` 干净；`npm run test:ui` 1192/0；`npm run check:fast` 全绿
  - 未验：真机在局域网里扫一次（本机开发页面是 http 可以扫；部署在 GitHub Pages 的 https 页面会被浏览器拦住，面板会直接说明原因）
  - 批次：20261026-0500

## 批次 20261026-0345 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26 拍板：方块增量跑到 20 万上限后「后进房的人地形少一截」；批准做 ① 水流不该撑大增量表、
> ② 进房首包压缩，「能彻底解决的方案都可以接受」。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0345

目标（用户 2026-10-26 拍板）：方块增量跑到 20 万上限之后，「后进房的人看到的地形少一截」。
批准做 ①（水流不该把增量表撑大）+ ②（进房首包压缩），"能彻底解决的方案都可以接受"。

- [x] [快照1] 服务端**按视野补发**方块增量：玩家跨进一个新区块时，把该区块的增量推给他（走已有的 `blocks` 消息，客户端零改动）——补上"128 格外永远收不到"的盲区（`snapshot.mjs` 里记的联机27）→ 验收：`npm run test:net`（房主在远处改一格 → 加入方走过去收到）
  - 做了什么：`server/index.mjs` 新增 `pushChunkEdits(player)`——玩家跨进一个**新区块**时，把该区块的增量按 2048 条一批推给他（走已有的 `blocks` 消息，客户端零改动）；`player.sentEditChunks` 记已推过的区块（上限 4096 个键）；`snapshot.mjs` 新增纯函数 `editsInChunk()`；三条 `rememberEdit` 的 value 带上 `room` 以便按房筛选
  - 为什么：进房快照只带玩家 8 个区块（128 格）内的改动，更远的**永远收不到**（`snapshot.mjs` 里记的联机27 遗留）——这就是"地形对不上"的主因
  - 验证：`npm run test:net` **213/0**（+1：房主在 2000 格外改一格 → 新人加入时快照里没有 → 新人走进那个区块 → 收到含该格的 `blocks`）；`npx vitest run tests/net-snapshot-policy.test.ts` 13/13（+3 `editsInChunk`）
  - 批次：20261026-0345
- [x] [快照2] 上限 20 万 → 50 万（配合视野补发：首包仍按半径裁剪，不会因此变大）→ 验收：`npx vitest run tests/net-snapshot-policy.test.ts`
  - 做了什么：`DEFAULT_MAX_EDITS` 20 万 → **50 万**（`server/snapshot.mjs`，注释里写明"抬高前提是按视野补发：首包仍按半径裁剪，不会因此变大"）
  - 为什么：有了补发，"超过上限被淘汰"从"永久丢失"变成"只是不在首包里"，抬高上限才安全
  - 验证：`npx vitest run tests/net-snapshot-policy.test.ts` 13/13（含 `DEFAULT_MAX_EDITS === 500_000`）
  - 批次：20261026-0345
- [x] [快照3] 澄清并处理"水流撑大增量表"：`EditsTable` 本来就按格覆盖（同一格多写只留最后一稿），所以中间态不进表；真正会白占的是"改了又改回世界生成原样"的格子——评估后再决定做不做
  - 结论：**水流不会把增量表撑大**，不需要改代码。`ChunkEdits.record()` 是 `map.set(localIndex, pack(id,state))`——同一格反复写只留最后一稿，水流的液面中间态天然被覆盖；撑大表的只有"**被写过的格子数**"。
  - 顺带查清的浪费：真正白占的是"改了又改回世界生成原样"的格子（比如水退干净后那一格其实还是空气）。要清掉它得在写入时问一次地形生成器，代价是每次流体写都多算一遍噪声——**收益不确定、成本明确**，所以这次不动，记在这里备查。
  - 验证：`src/core/save/ChunkEdits.ts` 的 `record()` 逐行确认（key 是区块，内部 Map 的键是区块内下标）
  - 批次：20261026-0345
- [x] [快照4] 进房首包的方块增量改压缩格式（用户批准的第 ② 条）：`src/core/net/EditPack.ts`（客户端解码 + 测试用编码）与 `server/editpack.mjs`（服务端编码 + 测试用解码）两份实现，格式为"按区块分组 + 区块内下标"；服务端改发 `editsPack`、老字段 `edits` 留空；`NetClient` 解回老形状，`onWelcome` 零改动 → 验收：`tests/edit-pack.test.ts`（含两端交叉）
  - 做了什么：`EditPack.ts` 提供 `encodeEditsPack/decodeEditsPack/packIndex/unpackIndex`（下标与 `Chunk.index` 同一套算术，测试交叉校验）；`server/editpack.mjs` 是纯 JS 的同构实现（服务端不能 import TS）；`snapshotFor` 改发 `editsPack`；`NetClient` 优先解 `editsPack`、解不出来退回 `edits`；`tools/net-test.mjs` 的 `joinAndWaitWelcome` 就地解包，后面几百条断言一行没改
  - 为什么：一条从 30~40 字符降到约 10 字符。**实测**：密集改动（一面墙/一块地）降到 **0.4 倍以下**；零散改动（每条各一个区块）约 **0.67 倍**——比预想的低，因为"每块一个头"在小样本里占比高，测试里两种形态都钉了
  - 未做：二进制/base64 版本（再小约 1.2 倍，但要两端逐字节对齐、日志不可读），收益不抵风险
  - 验证：`npx vitest run tests/edit-pack.test.ts` **9/9**（含"服务端编码 → 客户端解码"交叉、坏数据整体拒收）；`npm run test:net` **213/0**；`npm run test:ui` **1179/0**（+2 结构断言）；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿
  - 批次：20261026-0345

## 批次 20261026-0815 · 2026-10-26 · 会话 d4a25f60

> 用户 2026-10-26：偶尔能看到「穿透方块、里面的透明空间 / 人卡在地皮下面的空间」，
> 要求彻底解决（之前修过一次没修完）。

# 队列 · 会话 d4a25f6059e34cce97009da8f730a3b3

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0815

目标（用户 2026-10-26）：偶尔能看到"穿透方块、里面的透明空间 / 人卡在地皮下面的空间"。
要求彻底解决（之前修过一次没修完）。不允许再靠"把近裁面调更小"这类补丁——那只是把
穿透的临界点往后挪。

- [x] [穿模1] 相机贴脸/埋在方块里的穿透兜底：`src/render/cameraNear.ts` + `src/main.ts` → `npm run test:cameranear`
  - 做了什么：① `cameraNear` 新增 `cameraClearanceInfo()`（距离 + 由面指向相机的单位方向）与 `pushCameraOutOfWalls()`（沿法线推出到 `NEAR_MARGIN`，最多 3 次迭代）；② 第三人称每帧摆好相机后调用它；③ `buriedInBlock` 的判据从 `suffocates` 改成 `opaque`（树叶这类"不窒息但面被剔除"的方块也兜住，玻璃/水仍不糊）；④ 新增 `world/cameraPush` 诊断（1 秒最多一条）
  - 为什么：第三人称相机的射线**只朝背后那一个方向**打，撞到后墙就停在 0.22 格前；但玩家背靠墙角时相机离**侧墙**可能只剩 1~2 厘米，比近裁面下限 0.02 还小 → 那一面被裁掉，而方块相邻面是背向剔除的 → "看见墙皮后面还有一个世界"（用户说的"偶尔卡视角"）。原来的色罩只认 `suffocates`，恰好漏掉"不透明但不止窒息"的那一批
  - 验证：`npm run test:cameranear` **45 通过 / 0 失败**（新增 9 条：墙角只剩 1 厘米的前提、推出方向朝 -X、推后 clearance ≥ 5 厘米、位移 ≤ 10 厘米、空场一个毫米都不推、相机在方块内返回 -1 交给色罩）；`npm run check:fast` 全绿；`npm run test:ui` **1177/0**
  - 未验：真机复现（本机无浏览器）。若再出现，`__mc.diag.exportText()` 里会有 `world/cameraPush` 事件（带推出距离、clearance、near、方块 id），能直接区分"相机贴脸"还是别的原因
  - 批次：20261026-0815
- [x] [穿模2] 排除"盒子坐标反序导致面朝内"：`tools/render-test.ts` → `npm run test:render`
  - 做了什么：遍历 `BLOCKS` 里所有实际使用的形状 × state 0~63 × 连接两种取值，断言 `meshBoxes` 产出的每个盒子都满足 `min < max`，且每个形状至少有一种状态能画出几何（十字形状走 `emitCross`，排除）
  - 为什么：盒子坐标写反会让 `emitFace` 的顶点顺序整体反转 → 面朝内 → 从外面看被背面剔除（画面是洞）、从里面看反而正常。这与用户描述的"从某个角度看穿方块"是同一类症状，而这条此前没有任何断言覆盖
  - 验证：`npm run test:render` **293 通过 / 0 失败**（新增 3 条；当前全部形状都通过，说明这一类是干净的，可以排除）
  - 批次：20261026-0815

## 批次 20261026-0320 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：加入房间后「地形方块有些不一致」，怀疑是用了之前的种子/世界/存档。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0320

目标（用户 2026-10-26）：加入房间后"地形方块有些不一致"，怀疑是用了之前的种子/世界/存档。

- [x] [联机75] 加入方不再复活本地旧方块增量（地形以房主为准）：`loadSaveState()` 对 `mpjoin-` 世界跳过 `loadAllChunkEdits()` 的恢复；顺带把"是不是加入世界"收成一个 `isJoinWorld()` 判据（位置恢复与增量恢复共用）→ 验收：`npm run test:ui` 断言
  - 做了什么：`loadSaveState()` 里增量恢复包进 `if (!joinWorld)`；新增 `isJoinWorld()`；两处 `startsWith(JOIN_WORLD_PREFIX)` 收口到它
  - 为什么：加入方的本地库名是「房间 + 种子」（`multiplayerWorldId`），**同房同种子 = 同一个库**——上一次会话看过的方块改动会在这次进房时被原样复活，再叠到房主刚发来的快照上。房主后来把某处改回去（拆掉、水退、TNT 回填）之后，旧增量把格子"顶"回旧样子，于是只有加入方看到的地形对不上。这也解释了"换个新世界就没问题"：换了世界就是另一个库
  - 验证：`npx tsc --noEmit` 干净；`npm run test:ui` **1171/0**（+1 断言：加入世界跳过增量恢复；并把旧的 `startsWith` 断言改成 `isJoinWorld()`）
  - 未验：真机双端对地形（需要"房主拆掉一处在旧会话里改过的方块"这种场面；逻辑上等价于位置恢复那条已验的路径）
  - 批次：20261026-0320

## 批次 20261026-0245 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26 三条：① 房主改游戏模式，其他人收不到；② 访客下线，房主看不到也没有消息；
> ③ 世界界面的按钮太高，新建世界/加入房间要等宽。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0245

目标（用户 2026-10-26）：房主改了**游戏模式**，房里的其他人也要跟着变（现在完全收不到）。

- [x] [联机73] 游戏模式随 `room-config` 同步给全房：房主 `setGameMode` 时上报，服务端记在房间上并广播（含房主），`welcome` 带上当前模式让晚进的人也一致 → 验收：`npm run test:net`（房主发 `room-config{gameMode}` → 全房收到；后加入者的 `welcome.gameMode` 是新值）+ `tools/ui-test.ts` 结构断言
  - 做了什么：房主 `setGameMode` 后调 `sendRoomConfig({ gameMode })`（两个守卫：`!applyingRemoteGameMode`、`!waitingForSaveRestore`）；服务端新增 `roomGameModes` 房间表，白名单校验后广播 `room-config{gameMode}` 并随 `welcome` 下发当前值；客户端 `onRoomConfig` 应用模式（带回声守卫）并打一行 `say.net.roomGameMode`；晚进的从属端在 `onWelcome` 后采用 `welcome.gameMode`
  - 为什么：世界元数据里的 `mode` 是房主 `join` 那一刻的快照，之后 `/gamemode` 改的从来不会回写；也从来没有一条"模式变更"的消息。现在模式和时间/天气同走 `room-config`，一份通道三种配置
  - 验证：`npm run test:net` **212/0**（+2：房主改模式 → 同房收到 `room-config{gameMode:'creative'}`；晚进的人 `welcome.gameMode` 也是 creative）；`npm run test:ui` **1166/0**（+4 结构断言）；`npm run audit:i18n` 通过（新增 `say.net.roomGameMode` 六语言）；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿
  - 未验：真机双端切一次模式（读档恢复/旁观飞行这些副作用没在真机上点过）
  - 批次：20261026-0245
- [x] [联机74] 访客退世界时断开联机（用户 2026-10-26）：`App.dispose()` 以前**完全不碰 `net`** → socket 挂着 → 服务端收不到 `bye` 也等不到 `close` → 房主眼里对方永远在线、也没有"离开了"的提示 → 现在 `dispose()` 先 `net.disconnect()`（内部先发 `bye` 再关 socket）
  - 做了什么：`dispose()` 开头 `this.disposed = true` 之后立刻 `this.net.disconnect()`（`disconnect()` 的首行就是 `sendBye()`）；`tests/net-client-look.test.ts` 补两条：断开时先发 `bye` 再关 socket、没连上时不抛
  - 为什么：`bye` 分支与服务端"立刻广播 leave"上一批已经做好，缺的一环是**客户端主动断开这条链**——回主菜单/换世界走的是 `dispose()`，它以前只拆渲染与界面，网络对象直接丢掉，浏览器不保证回收，服务端就永远等不到这条连接结束
  - 验证：`npx vitest run tests/net-client-look.test.ts` **7/7**（+2）；`npm run test:net` 212/0（`bye → leave` 那侧上一批已覆盖）；`npm run test:ui` 1168/0（+2 结构断言：`dispose` 里先断开、离开有系统提示）；`npx tsc --noEmit` 干净
  - 未验：真机双端（访客点「退出到主菜单」/关标签页，房主那边应当立刻少一个人 + 聊天区一行"某某离开了房间"）
  - 批次：20261026-0245
- [x] [界面1] 世界界面入口行压矮 + 两颗按钮等宽（用户 2026-10-26）：`index.html` 的 `.world-list-top` 改成两颗 `flex: 1 1 0`（以前「新建世界」铺满、「加入房间」只有文字宽），PC 上整排压到 36px；列表标题旁的「导入存档」压到 27px
  - 做了什么：`.world-list-top > .world-primary/.world-secondary` 统一 `flex: 1 1 0; width: auto; max-width: none; text-align: center`；新增 `@media (pointer: fine)` 把这一排压到 `min-height: 36px`、`.world-import` 压到 `padding: 3px 9px; font-size: 11px`；`#world-new-button` 只留"铺满"语义（宽度/高度交给共用规则）
  - 为什么：两颗按钮是同一层（都是"开始一局"），一宽一窄看着像不同层级；52px 是"手指点得到"的下限，不是 PC 上该有的高度。**判据用 `(pointer: fine)` 而不是 `body:not(.touch-mode)`**——`touch-mode` 是进世界、建触摸层时才挂的，主菜单阶段手机上也没有这个类，拿它当判据会把手机的 52px 一起压掉
  - 验证：1280×720 实测两颗 **358×36 等宽等高**、导入存档 70×27；792×360 触屏实测两颗 **350×52**（保留可点高度）、导入存档 72×33；截图 `.tmp/shots/worlds-pc.png`；`npm run test:ui` **1170/0**（+2 条 CSS 结构断言）
  - 批次：20261026-0245

