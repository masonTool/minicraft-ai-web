# 多人 · 房主权威（L8）细则

> `OVERVIEW.md` 只留一句现状与指针（那份是每轮都读的），细节写在这里。
> 需求口径见 `TASKS.md` 的 L8；本批已落地的范围见 `DONE.md` 的「批次 20261024-1619」。
> 分支：`worktree_hostauth_20261024`（工作树同名）。

## 为什么换架构

原来是「各端各自模拟 + 事件同步」：位置、方块改动、掉落物都同步，但**世界本身各算一遍**。
2~3 人局域网里立刻表现为同一只怪两个位置、红石两边不同步、熔炉进度各走各的。
想真正一致只有两条路：要么确定性锁步（要求浮点/迭代顺序/随机数全确定，改造量不比把模拟搬到
服务端小，还会一人卡全员卡），要么**只让一个人算**。选了后者：房主的浏览器是唯一模拟者。

## 已落地的三段（批次 20261024-1619 · MS1）

1. **协议 v2**（`server/protocol.mjs` / `src/core/net/Protocol.ts`）：`join` 带 `host: true` 表示开房；
   服务端 `hosts` 按房名记一名房主（`{id, clientId}`），第二个房主 → `reject('host-taken', 4006)`
   并**直接关连接**（不做静默降级成从属端——降级也是"进房成功"，玩家看不出两端都在自己算）。
   房主位在 `GRACE_MS` 宽限期过后才释放，所以手机切后台回来仍是原房主。
   版本位 `1 → 2`：旧客户端收不到 `hostId` 就会自己跑模拟，用版本位硬拒连，**不保留兼容开关**。
2. **角色**（`src/core/net/NetRole.ts`）：`solo | host | client`。只放身份不放行为——
   `INITIAL_ROLE = 'solo'`、纯函数 `nextRole(role, event)`（`joined{isHost}` / `left`）、
   `roleFromWelcome(welcome)`。唯一出口是 `NetClient.role`（未连上 = `solo`，连上按 `welcome` 的
   `isHost`）。"什么角色跑什么"要收敛到 `core/net/SimMode.ts`（MS2 第一条）。
3. **面板**（`src/ui/MultiplayerScreen.ts`）：单颗"连接"拆成「开房 `#mp-host` / 加入 `#mp-join`」，
   两者共用一份地址与昵称，唯一差别是 `onConnect(url, name, host)` 的第三个参数；
   回车只走"加入"（开房会占住唯一的房主位）。`welcome` 之后走 `setRole()`，状态行追加「房主 / 从属」。
   文案：`mp.host` / `mp.join` / `mp.role.host` / `mp.role.client`（六语言，删掉了旧的 `mp.connect`）。

## 坑

- **宽松度必须两端同一把尺子**：服务端 `message.host === true`、客户端 `message.isHost === true`。
  `'true'` / `1` / 缺字段一律当"不是房主"。写成 `Boolean(x)` 会让两端同时模拟，而且**不报错**，
  只表现为"红石两边各算一遍、谁也对不上"。
- **重连要带原意图**：`NetClient.wantsHost` 存着开房意图，`join` 每次都带。漏了这一条，
  断线一次房主就变从属，世界当场没人模拟。
- **角色比会话状态晚到**：`setState(connected)` 在 `onopen` 就发生，`isHost` 要等 `welcome`。
  面板两个入口分开推进（`setState` / `setRole`），合在一起会先显示"已连接"再退回单机。
- **回车的默认动作要选可撤回的那个**：回车 = 加入。误开房别人进不来，误加入只是多一次点击。

## 剩余分段（MS2~MS4，未开工）

清单与各自验收命令在 `DONE.md` 的「批次 20261024-1619」末尾有指针，正文在 `TASKS.md` 的 L8 条目。
顺序按依赖排：MS2 世界权威（`SimMode` → 从属端跳过 `tickWorldBlocks` → 房主上行 / 服务端只收房主）
必须先于 MS3 实体权威（快照编解码 → AOI 采集 → 影子实体插值），MS4 收容器计时与"房主退出"提示。
MS1 的人工双端验收（两端面板分别显示房主 / 从属）还没做，下一批开工前先补认。
