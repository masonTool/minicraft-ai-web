# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

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

## 批次 20261026-0141 · 2026-10-26 · 会话 d4a25f60

> 用户 2026-10-26：低端机上「不卡但发热明显」，只要**不影响画质和体验**的优化。

# 队列 · 会话 d4a25f6059e34cce97009da8f730a3b3

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0141

目标（用户 2026-10-26）：低端机上"不卡但发热明显"。这一批只做**不降画质、不降帧率、
不降视距**的优化——把"本来就算错 / 白算 / 白传"的部分去掉，画面结果保持逐像素一致。

- [x] [性能1] 天空穹顶改"地形画完再画"：`src/render/Sky.ts` + `src/main.ts` → `npm run check:fast`
  - 做了什么：穹顶从 `depthTest:false` + `renderOrder:-1000`（先铺底）改成 `depthTest:true` + `renderOrder:+1000`；新增纯函数 `domeOcclusionSafe(视距)`（地形最远 `(视距+2)×16` 必须 ≤ 穹顶半径 180），小于则走遮挡、超过则回退成先铺底；`applySettings` 与 `setViewDistance` 两处落这条守卫
  - 为什么：原来整屏每个像素都先被天空着色一遍、再被地形盖掉，被遮挡那部分（通常半屏以上）是纯浪费；改成地形先写完深度，穹顶只画真正露出来的天空，**可见像素完全不变**。回退分支保证视距将来放开时不会出现"天空盖住远山"
  - 验证：`npm run test:render` **282 通过 / 0 失败**（新增 6 条：视距 6/8 走遮挡、10/16 回退、非法值按 0、穹顶 `depthTest/depthWrite` 结构守卫）；`npm run check:fast` 全绿
  - 未验：真机上的像素对比与洞穴/地平线观感（本机无浏览器）；若真机发现远景天色异常，把 `setDomeBehindTerrain(false)` 即可逐像素退回原状
  - 批次：20261026-0141
- [x] [性能2] 区块 mesh 冻结世界矩阵：`src/render/ChunkRenderer.ts` → `npm run check:fast`
  - 做了什么：新增 `ChunkRenderer.freezeAt(mesh, x, y, z)`——写位置 → `updateMatrix()` → 把本地矩阵抄进 `matrixWorld`（父级是 scene，单位矩阵）→ 关掉 `matrixAutoUpdate` 与 `matrixWorldAutoUpdate`；Worker 分支与本地分支共 4 处 mesh 创建都改走它
  - 为什么：区块 mesh 的 position 只在创建时写一次，之后最多改 `visible`，但 three 每帧的 `scene.updateMatrixWorld()` 仍给 169 个对象各做一次 compose 并递归——纯白算。冻结后矩阵仍是正确值，视锥剔除与绘制不变
  - 验证：`npm run test:render` **285 通过 / 0 失败**（新增 3 条：两个 autoupdate 标志为 false、冻结后改 `position` 不再影响 `matrixWorld`）；`npm run check:fast` 全绿（命中 mesh / render 两套）
  - 影响 / 回滚：以后不能再对这些 mesh 直接改 position/rotation/scale（要挪位置就重建网格，现有流程本来就是重建后替换）；回滚只需把这 4 处换回 `mesh.position.set`
  - 批次：20261026-0141
- [x] [性能3] 粒子顶点只上传活跃段、0 粒子跳过上传：`src/render/ParticleSystem.ts` → `npm run check:fast`
  - 做了什么：`writeBuffers()` 里 `count === 0` 直接归零 drawRange 并返回；否则用新辅助 `uploadActiveRange()`（`clearUpdateRanges` + `addUpdateRange(0, 活跃长度)` + `needsUpdate`）替换原来的整包 `needsUpdate = true`
  - 为什么：`needsUpdate` 会把 1024 点的整池全量重传（约 32KB/帧），而画面上只画前 `count` 个；池尾数据根本没有任何消费者。清空后（0 粒子）也不例外，等于每帧白传一次空池
  - 验证：`npm run test:render` **290 通过 / 0 失败**（新增 5 条：位置/颜色按 count×3、标量按 count 登记区间、0 粒子不标脏（version 不变）、0 粒子 drawRange 归零）；`npm run check:fast` 全绿
  - 影响 / 回滚：上传区间依赖 three 的 `updateRanges`（r159+）；回滚把这 4 行换回 `needsUpdate = true` 即可
  - 批次：20261026-0141
- [x] [性能4] 每帧 DOM 收干（调试面板节流 / display 变化才写 / 进度条缓存引用）：`src/main.ts` → `npm run check:fast`
  - 做了什么：① 新增 `syncDebugVisibility()`，把 `#debug` 的显隐收敛成唯一入口（`applySettings` 与 `updateDebug` 共用），只在值变化时写 `style.display`；② 调试文本按 `DEBUG_TEXT_REFRESH_MS = 200`（5Hz）节流，不再每帧拼十几行字符串写 `textContent`；③ 新增 `progressBarEls(id)` 懒查一次并缓存 `#break-progress` / `#eat-progress`，百分比量化到 1%，同档不重复写 `style.width`
  - 为什么：调试面板默认开着（手机上 3 行、桌面上十几行），以前每帧一次临时字符串分配 + 一次 `textContent` 写入 + 一次合成器重绘；两个进度条每帧各一次 `getElementById`（纯 DOM 树查询），挖掘/进食时还会每帧写一次 width。这些都属于"画面完全相同、只是白做"
  - 验证：`npm run test:ui` **1177 通过 / 0 失败**（新增 6 条：节流常量 ≤ 250ms、`syncDebugVisibility` 唯一入口、`updateDebug` 里不再出现 `style.display`、`progressBarEls` 存在、两个进度条不再 `getElementById`）；`npm run check:fast` 全绿
  - 未验：真机上"面板数字刷新变慢"的观感（5Hz 是标准做法，但没人肉眼盯过）；若觉得跳得难受，把常量调到 100 即可
  - 批次：20261026-0141
- [x] [性能5] draw call 合并的可行性结论留档（做/不做与理由）：本会话 decision 文件 → 文档门禁
  - 做了什么：把"约 170 次/帧的 draw call 要不要合并"评估完并留档——本会话 `d4a25f-decision.md` 的 D1（评估过程与暂不做的理由）、`notes/decisions.md` 新增「判定不做：区块 draw call 合并」一节（含代价与"什么时候该重看"）
  - 为什么：`BatchedMesh` 要预留几十到上百 MB 顶点缓冲（显存换 CPU 提交），2×2 静态合并要重写跨区块网格化与 Worker 协议、改一格还要重拼一整组；收益（170 → ~43 次提交）必须真机前后对比才能确认，风险与这一批"零画质损失小改"不匹配，所以明确不做
  - 验证：`npm run audit:docs` 通过；决策节格式与 `notes/decisions.md` 现有四节一致（做了什么 / 理由 / 代价与边界 / 什么时候该重看）
  - 批次：20261026-0141

## 批次 20261026-0130 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26 四条反馈：① 开房失败不该进世界；② 访客第一次加入提示进入了却卡在生成页；
> ③ 房主挖开水边方块后加入方的水不流；④ 改成晴天后雨声还在。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0130

目标（用户 2026-10-26 反馈四条）：① 开房失败不该进世界；② 访客第一次加入提示进入了却卡在生成页；
③ 房主挖开水边方块后，加入方的水不流；④ 房主把雨改成晴天后，声音还在。

- [x] [联机66] 开房失败要拦住（用户 ①）：`WorldScreen` 的开房对话框等预检结果、失败留在原地显示原因；新增 `src/net/HostPreflight.ts`（只连不发 join）→ 验收：`npx vitest run tests/host-preflight.test.ts`
  - 做了什么：新增 `preflightHost({baseUrl, room})`——只建立一次 WebSocket（3 秒超时，连上即关，**不发 join**），再 best-effort 拉 `/rooms` 看 `hasHost`；返回 `unreachable` / `taken` / `null`。`WorldScreen.onHostWorld` 改成可返回 `Promise<string | null>`，`go()` 等结果：失败 `showError()` 并留在对话框（按钮期间 disabled），成功才 `cleanup()`。`main.ts` 里的回调改成先 `await preflightHost(...)`，`unreachable` → `t('mp.hostUnreachable')`、`taken` → `t('say.net.hostTaken')`，只有通过才 `pendingHostRoom` + `startWorld`
  - 为什么：以前是"先建世界再后台连"，服务器没起/地址错/房名被占时人已经站在世界里了（建世界还要跑地形生成），失败只能看到一句看不懂的 `host-taken` 或静默断开。**关键约束**：预检不能发 `join`——发完就断会把房主位占进 30 秒宽限期，正式开房反而被 `host-taken` 拒掉
  - 验证：`npx vitest run tests/host-preflight.test.ts` **6/6**（连不上 / 超时 / 房名被占 / 同名无房主放行 / 拿不到列表放行 / URL 带房名且连上就关）；`npm run test:ui` **1155/0**（新增 3 条结构断言）；`npx tsc --noEmit` 干净；`npm run audit:i18n` 通过（新增 `mp.hostUnreachable` 六语言）
  - 批次：20261026-0130
- [x] [联机67] 雨→晴之后环境音停不下来（用户 ④）：`AudioEngine.setAmbience` 的起伏振荡器改挂独立增益；网络天气改走 `setWeather()` → 验收：`npm run test:ui` 断言
  - 做了什么：雨声节点链从 `… → out(音量) → master`（起伏 `gust` 直接接在 `out.gain` 上）改成 `… → swell(1±0.045) → out → master`，`gust` 只接 `swell.gain`；`main.ts` 的 `onWeather` 从 `weather.setKind(kind)` 改成 `this.setWeather(kind)`（与本地命令同一条路径，`applyEnvironment()` 一起跑）
  - 为什么：`AudioParam` 的输入是**加在基础值上**的——`setTargetAtTime(0)` 只把基础值推到 0，叠加的 ±0.045 仍在振，于是晴天里永远有 4.5% 的雨声底噪。而 `weather.setKind()` 只改状态与降水粒子、不跑 `applyEnvironment()`，远程改天气时环境音沿用上一档
  - 验证：`npm run test:ui` **1155/0**（断言 `gust.connect(gustDepth).connect(swell.gain)` 存在、旧的 `connect(out.gain)` 不存在、`onWeather` 里 `this.setWeather(kind)`）；`npx tsc --noEmit` 干净
  - 未验：真人耳听"雨停即静"（无头环境听不到声）
  - 批次：20261026-0130
- [x] [联机68] 访客第一次加入卡在生成页（用户 ②）：`refreshLoadingState` 加 8 秒"就地认可落点"自愈 → 验收：`npm run test:ui` 断言
  - 做了什么：新增 `JOIN_FORCE_SPAWN_MS = 8000` 与 `forceJoinSpawn()`——加入来的世界若"已经有区块网格、但 8 秒还没落点"，就地认可当前坐标（`spawnPoint` + `spawnResolved = true`）并补一次 `requestGroundSettle('join')`，只做一次；30 秒那条 `abortJoin` 兜底保持不变；日志统一打 `[JOIN_DBG]`
  - 为什么：30 秒兜底是"彻底放弃退回菜单"，而玩家看到的是"提示进入了却卡在生成页"。**不能**用 `prepareNewWorldSpawn()` 兜——加入方的人已经在房主身边，重新规划出生点会把人瞬移到几百格外
  - 验证：`npm run test:ui` **1155/0**（断言常量与 `forceJoinSpawn()` 存在、且自愈里**不**调用 `prepareNewWorldSpawn()`）；`npx tsc --noEmit` 干净
  - 未验：真机双端加入（没有自动化双端环境；若仍卡，控制台会打 `[JOIN_DBG] 8 秒没有落点，就地认可：…` 带 chunks/mesh/net 三个量）
  - 批次：20261026-0130
- [x] [联机69] 加入方的水不流动（用户 ③）：房主挖开水边方块后，房主端水流、加入方水不动。静态读代码已确认"任何方块写入都经 `World.events.onBlockChanged → queueBlockChange → BlockFunnel.sendBlocks`"，但没找到加入方收不到/不生效的确证点 → 需要一次带日志的复现，再加 `[FLUID_DBG]` 计数（房主每秒发出的水方块数 / 加入方每秒应用的水方块数）后定位
  - 做了什么：真服务端 + 两个真浏览器复现（房主开房、加入方走真实的「加入房间」面板），发现**加入方根本没站在那片地形上**——`loadSaveState()` 是异步的，它用**上一局**存档里的坐标 `teleport` 覆盖了 `alignSpawnToHost()` 刚放好的"房主身边"落点；人不在那片区块里，房主的流体改动只会走 `planRemoteBlock` 的 `buffer` 分支进 `world.edits` 而不落地，画面上就是"他那边水一直不动"。修：`loadSaveState` 对 `mpjoin-` 世界**跳过位置/维度/朝向恢复**（房间里的位置与维度由房主/服务端说了算），背包/进度/规则照旧恢复。另保留 `[FLUID_DBG]` 计数（房主"发出"、加入方"应用"，附 role/net/可写）作为后续自查入口
  - 为什么：这不是"水"独有的问题——同一个原因会让加入方看不到房主的红石、火焰、作物生长等一切"房主算出来的方块变化"，而画面看上去完全正常。相比"给水加一条专门同步"，把落点改对是唯一的正解；顺带也解释了之前"加入方在奇怪的位置""看不到别人"的零散反馈
  - 验证：双浏览器对比同一坐标周围 13×9×13 的水方块数——修前 guest 恒为 2、host 从 2 涨到 114（完全不跟）；修后 guest 与 host 同步跟随（1→53 逐拍对齐，滞后约 0.7 秒），`guest 距房主: 0.0 格`；`[FLUID_DBG]` 两侧数字一致（发出 7 / 应用 7）。`npm run test:ui` **1157/0**（+2 条结构断言：`joinWorld` 分支跳过位置恢复、`[FLUID_DBG]` 计数在位）；`npm run test:net` 208/0；`npx tsc --noEmit` 干净；`npm run check:fast` 全绿
  - 未验：用户当时的原始场面（若仍出现，`[FLUID_DBG]` 那行的 `可写` 与两端"发出/应用"数字能直接区分是没发、被闸挡住、还是距离太远只 buffered）
  - 批次：20261026-0130

## 批次 20261026-0110 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：加入房间与开房，地址栏只收 **IP 或域名**，前后缀自动派生——
> IP 走局域网明文 ws + 固定端口，域名走 `wss://域名/ws`。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0110

目标（用户 2026-10-26）：加入房间与开房，地址栏只收 **IP 或域名**，
前缀/后缀自动派生——IP 走局域网明文 ws + 固定端口，域名走 `wss://域名/ws`。

- [x] [地址1] 地址栏只收 IP 或域名，前后缀自动派生：`src/core/net/ServerUrl.ts` 新增 `isLanHost` / `deriveFromBare`，`normalizeServerUrl` 与 `displayServerAddress` 按地址类型收放 → 验收：`npx vitest run tests/net-server-url.test.ts`
  - 做了什么：新增 `DEFAULT_WS_PATH='/ws'`、`isLanHost()`（IPv4 / `[IPv6]` / `localhost` / `*.local`，域名不算）、`deriveFromBare()`（IP → `ws://host:25187`、域名 → `wss://host/ws`，显式端口/路径保留）；`normalizeServerUrl` 对**裸输入**走派生、对显式协议仍原样尊重；`displayServerAddress` 改成只显示 `host[:端口][/非默认路径]`（wss 不再保留协议头、默认 `/ws` 不显示）
  - 为什么：用户的两句原话是"局域网直接填 IP""是域名就自动用 wss 前后缀"。派生规则必须与 `resolveDefaultServerUrl()` 给 https 页面的那条**同一个**路径常量，否则会出现"默认能连、手填连不上"
  - 验证：`npx vitest run tests/net-server-url.test.ts` **35/35**（新增 6 组派生：IP/localhost、IP+显式端口、域名、域名+端口、域名+自定义路径、显式协议；`displayServerAddress` 与往返各 1 组）；`npx tsc --noEmit` 干净
  - 批次：20261026-0110
- [x] [地址2] 房间与口令改走 query、`/rooms` 保留反代端点前缀、占位文案改成"IP 或域名"：`formatServerUrl` / `parseServerUrl` / `roomsEndpoint` + 六语言 `mp.serverHint` → 验收：`npm run test:ui` + `npm run audit:i18n`
  - 做了什么：`formatServerUrl` 从 `/red?pw=1` 改成 `?room=red&pw=1`（path 留给 `/ws`）；`parseServerUrl` 优先读 query，老格式仍按 path 解析但**跳过 `/ws` 端点段**，且 `url` 现在保留端点路径；`roomsEndpoint` 保留 WS 的路径前缀（`wss://d/ws` → `https://d/ws/rooms`），老格式的房名段仍去掉；`mp.serverHint` 六语言改为"IP 或域名"
  - 为什么：`wss://domain/ws` 的 path 已经被反代端点占住，再往后拼房名会变成 `/ws/red`——`parseServerUrl` 会把 `ws` 当房名、反代也可能按 `handle_path /ws*` 剥错前缀。房间/口令走 query 后两条地址形态共用一套解析
  - 验证：`npm run test:ui` **1147/0**（+2 结构断言：派生规则在 core 且面板共用、提示六语言都有且中文含"域名"）；`npm run audit:i18n` 通过；`npm run check:fast` 全绿（顺带修两条跟着改口径的旧断言：`tests/room-probe.test.ts` 的地址形态、`tests/net-server-url.test.ts` 的显示与 `/rooms`）
  - 未验：连一台真实公网服务器（手头没有 `wss://…/ws` 的部署；派生结果由单测钉住）
  - 批次：20261026-0110

## 批次 20261026-0030 · 2026-10-26 · 会话 0a9f5045

> 用户 2026-10-26：PC 端有些设置项本来就无效，不该出现在设置里——「手指跟随」（摇杆跟随手指）、
> 「瞄准方式」（手指落点 / 屏幕中心）。PC 靠键鼠，没有摇杆、瞄准永远是屏幕中心。

# 队列 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

> 状态：执行中
> 创建：2026-10-26
> 批次：20261026-0030

目标（用户 2026-10-26 反馈）：PC 端有些设置项本来就无效，不该出现在设置里——
「手指跟随」（摇杆跟随手指）、「瞄准方式」（手指落点 / 屏幕中心）。PC 靠键盘鼠标，
没有摇杆、瞄准永远是屏幕中心。

- [x] [PC设置1] PC 端不再显示触摸专属的三个控制项（惯用手 / 瞄准 / 摇杆）：`src/ui/SettingsScreen.ts` 的 `controls` 块把这三行包进 `isTouchUi()` → 验收：`npm run test:ui` 断言三行都在触摸判据里 + 桌面截图设置页控制组只剩视角/反转/自动跳跃/快速进食/按钮大小与滑杆
  - 做了什么：`SettingsScreen` 控制页里「惯用手 / 瞄准 / 摇杆」三行包进 `if (isTouchUi())`（不创建，不是 disabled），并写明为什么它们对键鼠无效
  - 为什么：三项都是触摸控制器的输入（`handedness`/`touchStick` 只喂 `TouchControls` 的布局与死区，`aimMode` 的两处消费都带 `this.touch !== null`）。摆在 PC 设置里只会让人以为"设错了"
  - 验证：桌面 1280×720 打开主菜单设置 → 控制页行名 `视野/按钮大小/灵敏度/视角/反转视角/自动跳跃/快速进食`（**无**惯用手/瞄准/摇杆，20 行）；手机 792×360 仍有这三行（23 行）；截图 `.tmp/shots/settings-pc.png` 两列布局正常；`npm run test:ui` **1145/0**
  - 批次：20261026-0030
- [x] [PC设置2] 把「瞄准恒为中心点」从"只是没显示"变成"钉住"：`main.ts` 三处 `aimMode` 消费点都带 `this.touch !== null`，补断言防以后有人把它用到键鼠上 → 验收：`npm run test:ui` 通过
  - 做了什么：`tools/ui-test.ts` 补三条断言——三行确实在 `isTouchUi()` 块里、`usesCenterAim()` 与 `aim-center` body class 两处消费都带 `this.touch !== null`、键鼠分支走 `PlayerPhysics.lookDirection` 的视线射线
  - 为什么：PC 的"中心点"是既有行为（没有手指落点这回事），但代码里它表现为"`touch === null` 时落到 else 分支"，属于**隐式**保证；一旦有人给 PC 接上 `touchTapPoint`，取物就会变成跟着鼠标位置走。断言把这条隐式契约写死
  - 验证：`npm run test:ui` **1145/0**（+3 条）；`npx tsc --noEmit` 干净
  - 批次：20261026-0030

