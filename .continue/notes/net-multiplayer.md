# 多人联机细则（L4 / L8 / L9）

> `OVERVIEW.md` 的「存档与多人」只留一句现状与指针（那份每轮都要读、有 200 行 / 24KB 硬上限），
> 细节在这里。协议字段以 `docs/NET-PROTOCOL.md` 为准，这里只记"为什么这么做"和踩过的坑。

## 一、基础（L1~L4，批次 193/196、20261023-2351）

- 一个世界一个 IndexedDB 库；读档按版本号串链、脏数据逐项跳过；文件导出/导入。
- 进入联机时库名换成 `worldId@mp:<room>`（`core/net/MultiplayerSave.ts`）；退出联机**停写**并
  原地重载回单机地形（`World.reset()` + `worldReset` 清单）。
- 协议：握手（版本 / 名字 / clientId）、限流（令牌桶）、房间码 / 可选口令 / Origin 白名单、
  心跳 5s ping + 20s 超时、断线 30s 宽限期复用原 id。
- 远端玩家按维度过滤（`RemotePresence`）、未加载区块的方块改动先进增量表（`RemoteBlockWrite`）、
  种子冲突整批跳过（`SeedReconcile`）、天气权威（`server/weather.mjs`）、远端姿势/盔甲/副手
  （`RemoteAppearance` / `RemoteArmor`）。

## 二、房主权威（L8，批次 20261024-1619 · 只完成 MS1）

- 协议 v2：`join` 带 `host`，一房只认一名房主（第二个 `host-taken` + 关闭 4006），宽限期过后
  才释放房主位；`welcome` 下发 `isHost` / `hostId`。
- 角色 `solo | host | client` 收在 `core/net/NetRole.ts`，唯一出口 `NetClient.role`；
  **"什么角色跑什么"要收敛到 `core/net/SimMode.ts`**（MS2 的第一条，还没做）。
- 面板「开房 / 加入」两颗按钮，状态行标「房主 / 从属」；回车只走"加入"。
- 更细的取舍见 `notes/net-host-authority.md`；MS2~MS4 的 17 条在 `TASKS.md` 的 L8 条目里。

## 三、世界即房间（L9，批次 20261024-2114）

**目标**：多人不再是"游戏内的设置"，而是和单人并列的**进入方式**；世界由开房的人决定。

- **开房**：世界列表卡片上的「开房」（`#world-host`，蓝色面）→ 确认条（房间名默认由世界名派生、
  口令可空）→ 用这个世界的种子 `startWorld` → 进世界后自动连上（`App.connectOnline`）。
  房间名派生见 `core/net/RoomName.ts`：ASCII 名把空格折成 `-`，纯中文名退回 `w<种子>`。
- **加入**：主菜单「加入房间…」直接开面板（不必先选世界）→ 填地址 / 房间 / 口令 →
  `src/net/RoomProbe.ts` **先探房**（一次性 clientId 连一次、拿 `welcome.world`、立刻断开）→
  `core/net/JoinWorld.ts` 按房主的世界造一个临时世界项（`id = mpjoin-<房间>`，不进世界清单）→
  `startWorld` → 自动连上。
- **面板**：地址（+「找房间」拉 `GET /rooms`）/ 房间 + 口令 / 房间列表 / 最近连接 / 昵称。
  房间与口令是独立字段，`readForm()` 里才用 `formatServerUrl` 拼出真正的地址；粘贴老格式
  `ws://h:8787/red?pw=1` 会自动拆开（`splitAddress`）。
- **本局房间卡**（`ui/RoomCard.ts`）：联机中暂停菜单那颗键变成它——房间 / 角色 / 在线 / 世界 + 种子
  + 只读邀请地址 + 复制邀请 / 断开 / 关闭。复制有 clipboard → `execCommand` → 手动选中三条退路。
- **库名带种子指纹**：`worldId@mp:<room>@<seed>`（同房换世界 = 另一片大陆 = 另一个库）；
  换库时机在 `onNetWelcome`（种子那时才知道）。旧的 `@mp:<room>` 库从此不再被读。
- **协议 `world` 元数据**：`{name, seed, mode, difficulty, worldType}`，**只有房主能定**；
  从属端带了自己的也不生效。`worldType` 必须一起下发——超平坦与默认世界同种子仍是两片大陆。
- **最近连接**（`core/net/RecentRooms.ts`）：最多 4 条、按「地址 + 房间」去重、**不存口令**。

## 四、坑（这几条都真的咬过人）

- **入口挂在 `App` 上 = 必须先加载世界**。面板原来是 `App` 里 `new` 的，于是"联机"只能在游戏内发起，
  用户的原话是"创建多人游戏还需要进入后再按 Esc"。修法：面板提到 `boot()`（全局一份），
  `App` 通过构造参数拿它，面板动作按"有没有活着的 App"分派。
- **探房必须用一次性 clientId**。复用本机那份 `browserClientId()` 会被服务端判 `duplicate`
  直接拒连（旧 socket 的关闭还没走完），表现为"点加入没反应"。
- **`Number(null) === 0`**：`welcome.world.seed` 缺失时用 `??` + `Number()` 会读成 **种子 0**
  （合法整数），于是两边地形完全不同而不报错。只认 `typeof === 'number'` 的整数。
- **剪贴板只在安全上下文可用**：局域网手机连 `http://192.168.x.x:5173` 时 `navigator.clipboard`
  是 `undefined`，必须退回 `execCommand('copy')`，再不行就选中让玩家手动复制。
- **`/rooms` 是跨源请求**：页面在 5173、服务端在 8787，响应不带 `access-control-allow-origin`
  浏览器会直接吞掉（表现为"列不出房间"）。房名会拼进地址，所以清洗时不合规的行直接丢。

## 五、MS2 世界权威（批次 20261025-0122）

**目标**：让"世界只由房主推进"真正生效，同时**不没收从属端的建造**。

- **`core/net/SimMode.ts`**：`shouldSimulate(role, domain)` 是"要不要推进"的**唯一入口**，
  四个域 `blocks / mobs / containers / clock`（只增不减）。表：单机全跑；房主跑前三项、
  不碰时钟（时间仍服务端权威）；从属一样都不跑。`describeSimMode(role)` 用来打印"这一端在跑什么"。
- **tick 闸门**：`main.ts` 的 20Hz 循环里 `if (shouldSimulate(role,'blocks')) this.tickWorldBlocks(...)`，
  `tickWorldBlocks(` 在全文件只出现一次（UI 断言钉住）。连上时打一行 `[net] 模拟模式：…`。
- **权威标记**：房主上行带 `authority: true`（**声明**）；服务端不信它，`block` / `blocks` 的下行
  广播按 `player.isHost` **重新标注**。
- **从属端的改动走 `edit-request`**：服务端只转给本房房主（没房主回 `no-host`，客户端 3 秒提示一次）；
  房主用 `readEditRequest()` 解析 → `planRemoteBlock` → 记增量 → 写世界，**不包 `applyingRemoteBlock`**，
  于是 `onBlockChanged` 把它送进 `BlockFunnel`，以 `blocks + authority` 重发。
  请求方本地是**乐观应用**的，收到同一条再写一次（幂等）——这就是"以房主结果为准"的收敛点。
- **服务端收口**：**有房主的房里**，非房主的 `block` / `blocks` 一律丢弃（没房主的房保持老行为）。
- **落地顺序**：`applyRemoteBlock(action, edit, sink)` 把"先记增量、再写世界"收进一个函数
  （写世界抛异常时增量也已经落下）。

**坑**

- **房主落地必须"不抑制回声"**：`onNetBlock` 那层抑制是为了不回发队友的改动，但房主是**替别人落地**，
  抑制了就进不了漏斗、请求者的改动只有房主自己看得见。
- **丢弃要按房判定**：无条件丢非房主的 `block` 会把"有人直接 join、没带 host"的老用法打死
  （那种房没人推进世界，谁改都一样）。
- **从属端仍要本地先应用**：等往返才有反馈的手感在手机上像卡死。
- `container` / `sign` / `frame` / `tnt` **还没请求化**（仍直连上行，不影响玩法，但和"只有房主写世界"不完整）。
