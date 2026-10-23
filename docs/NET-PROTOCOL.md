# 联机协议（WebSocket · JSON 文本帧）

> 服务端：`server/index.mjs`（端口默认 8787，`PORT` / `SEED` 可覆盖）
> 客户端：`src/net/NetClient.ts`
> 协议验收：`npm run test:net`（真服务端 + 真 WebSocket 客户端）
> 端到端：`tools/net-check.sh`（浏览器 + node 机器人，需要 dev server）

这份文档只描述**当前实现**。哪些地方是刻意的取舍、哪些是待补的缺口，分别写在最后一节
和 `.continue/TASKS.md` 的 L4 / L7 里；两者不一致时以代码为准，并回来改这里。

## 1. 传输与分帧

- 一条 WebSocket 连接 = 一个玩家的会话。
- 每帧一条 JSON 对象，字段 `t` 是消息类型；没有二进制帧、没有压缩、没有分片协议。
- 服务端不校验 Origin、不鉴权、不设 `maxPayload`（用的是 `ws` 默认 100MB）。
- 没有心跳：连接是否还活着完全依赖 TCP 层的 FIN/RST。半开连接会一直留在在线列表里，
  直到客户端重连把旧 socket 顶掉（`联机7` 补 ping/pong 与 20 秒超时）。
- 有协议版本位（`v`，当前 **1**）与稳定客户端标识（`clientId`）：版本不一致直接拒绝连接，
  不进入“字段慢慢对不上”的状态（见 §5.1）。
- `clientId` **不是鉴权**：没有密码/签名，只用来挡住同一个浏览器的两个标签页并发连接，
  以及将来重连时认回原玩家。它存在 localStorage（`core/net/ClientId.ts`）。

## 2. 世界模型：种子 + 增量

地形生成器是纯函数（同种子 + 同算法 = 同地形），所以服务端**不同步区块**，只同步两样：

1. `seed`：新玩家进来时由服务端告知；
2. `edits`：所有被改过的方块，key 是 `维度|x,y,z`，值是绝对 `id + state`。

客户端拿这两样就能重放出同一个世界，区块数据一个字节都不用传。代价是：

- **种子必须一致**。现在客户端只打一行 `console.warn`，不会切换世界（`联机5`）。
- 服务端只保存“最终值”，不保存操作历史；两个人同时改同一格时后到的覆盖先到的。
- 服务端不跑 tick，红石/流体/作物/生物都在各客户端自己算（`联机12` 只统一方块写入）。

## 3. 连接生命周期

```
客户端                                  服务端
  |-- TCP/WS 连接 ---------------------->|
  |-- join（v / name / clientId）------>|  校验版本与身份；建 players 记录（id 自增）
  |<------------- welcome（快照）--------|  给自己
  |                                      |-- player（广播）--> 其他人
  |-- move（100ms 一条）---------------->|  50ms 限频，转发给其他人
  |-- block / container / item / chat -->|  转发 / 记账
  |<------------- player/block/... ------|
  |-- close ---------------------------->|  删除玩家 + 广播 leave + 清理他的掉落物
```

断线后客户端每 **3 秒**重连一次（`NetClient.RECONNECT_DELAY_MS`），主动 `disconnect()` 除外。
重连会拿到**新的玩家 id**，掉落物也会换新的 `localId`（`联机8` 补 30 秒 grace 复用 id）。

## 4. 客户端 → 服务端

| `t` | 字段 | 服务端校验 | 备注 |
| --- | --- | --- | --- |
| `join` | `v, name, clientId, x, y, z, dimension` | ① `v` 必须等于服务端版本，否则 `error.code='version'` + 关闭 4001；② `clientId` 必须是 8~64 位字母/数字/`-`/`_`，否则 `clientId` + 4002；③ 同一 clientId 已在线 → `duplicate` + 4003；④ 名字清洗（去控制字符与 `<>`、按字符截到 16、空则“玩家”）；⑤ 重复 join → `joined`；⑥ 坐标非有限数回落 `0/80/0`，维度只认 `overworld|nether|end`，其余回落主世界 | 客户端发的是**最后一次 tick 的位置**，所以入服不会先在原点闪一下；重连也用这份最新值。缺坐标时按 `(0, 80, 0)` |
| `move` | `x, y, z, yaw, pitch, dimension` | 距上一条 < 50ms 直接丢弃；缺字段保留旧值 | 客户端 100ms 发一条；**没有速度/距离校验** |
| `block` | `x, y, z, id, state, dimension` | 五个数 `Number.isFinite`；坐标与 id 截断成整数 | **不校验 id 是否合法、y 范围、与玩家距离**；`edits` 满 20 万条后静默丢弃 |
| `container` | `x, y, z, dimension, slots[]` | 坐标有限；`slots` 是数组且 ≤ 27 格；`JSON.stringify(slots)` ≤ 8192 字节 | 不校验目标方块是不是容器；内容由客户端 `restoreStacks` 再洗一遍 |
| `item-spawn` | `localId, itemId, count, x, y, z` | 全部有限；`localId>0`、`itemId>0`、`0<count≤64`、`|x|,|z|≤3e7`、`-2000≤y≤2000`；每人每秒最多 30 条 | key 由服务端拼成 `玩家id:localId`，**不信消息里的 owner** |
| `item-remove` | `localId` | 有限且 > 0 | 只能删自己名下的：服务端拼 `当前玩家id:localId` |
| `chat` | `text` | 转字符串后截断到 200 字符；空串丢弃 | 服务端日志打 `<名字> 内容`；**广播包含发送者**（见已知问题） |

未知 `t` 回 `error`；不是合法 JSON 也回 `error`，连接不关。

## 5. 服务端 → 客户端

| `t` | 字段 | 何时发 |
| --- | --- | --- |
| `welcome` | `v, id, name, seed, players[], edits[], items[]` | 只发给刚 join 的人 |
| `player` | `id, name, x, y, z, yaw, pitch, dimension` | 有人加入时、以及每次 `move` 被接受时（发给其他人） |
| `leave` | `id` | 连接关闭 |
| `block` | `x, y, z, id, state, dimension, by` | 收到 `block` 后转发给其他人 |
| `container` | `x, y, z, dimension, slots[], by` | 收到 `container` 后转发给其他人 |
| `item-spawn` | `owner, localId, itemId, count, x, y, z` | 收到 `item-spawn` 后转发给其他人 |
| `item-remove` | `owner, localId` | 收到 `item-remove`，或 owner 离线清理时 |
| `chat` | `id, name, text` | 收到 `chat` 后发给**所有人（含发送者）** |
| `error` | `code, message` | 非法 JSON / 未知类型 / 重复 join / 版本或身份不合法 |

`welcome` 的快照形状：

```json
{
  "t": "welcome",
  "v": 1,
  "id": 1,
  "name": "玩家",
  "seed": 20261014,
  "players": [{ "id": 1, "name": "玩家", "x": 0, "y": 80, "z": 0, "yaw": 0, "pitch": 0, "dimension": "overworld" }],
  "edits": [[100, 64, -50, 1, 0, "overworld"]],
  "items": [{ "owner": 1, "localId": 7, "itemId": 12, "count": 3, "x": 10.5, "y": 70, "z": 20.5 }]
}
```

`edits` 用数组而不是对象，是为了少传字段名；数组顺序即 `[x, y, z, id, state, dimension]`。

### 5.1 版本与错误码

版本号在两端各有一份（`server/protocol.mjs` 与 `src/core/net/Protocol.ts`），
相等由 `tests/net-protocol-version.test.ts` 断言。**什么时候 +1**：字段语义变了、
旧客户端会理解错；加一个可选字段不算。

| `error.code` | 含义 | 服务端关闭码 | 客户端要不要重连 |
| --- | --- | --- | --- |
| `version` | `v` 与服务端不一致 | 4001 | **不重连**（重连也不会变好） |
| `clientId` | 缺 clientId 或形状不合法 | 4002 | **不重连** |
| `duplicate` | 同一 clientId 已在线 | 4003 | **不重连**（先关掉另一个标签页） |
| `joined` | 同一条连接重复 join | 不关 | 是（消息级） |
| `bad-json` | 不是合法 JSON | 不关 | 是 |
| `unknown` | 未知 `t` | 不关 | 是 |

客户端的判据是 `code`，**不是关闭码**——两者可以独立演进。
新客户端连上老服务端时，`welcome` 里没有 `v`，客户端按 `v=0` 处理并拒绝进入世界
（否则字段差异会在之后的每条消息上零星炸开，很难归因）。

## 6. 服务端状态与上限

| 项 | 值 | 位置 |
| --- | --- | --- |
| 默认端口 | 8787（`PORT`） | `server/index.mjs` |
| 世界种子 | 20261014（`SEED`） | 同上 |
| 玩家 id | 自增、不回收 | 同上 |
| 方块增量上限 | 200000 条，满了**静默丢弃新改动** | `MAX_EDITS` |
| 掉落物上限 | 2000 条，满了丢弃新 key | `MAX_ITEMS` |
| 掉落物广播 | 每人每秒 30 条（固定 1 秒窗口） | `ITEM_RATE_LIMIT` |
| 位置限频 | 50ms | `MOVE_INTERVAL_MS` |
| 持久化 | **无**，全在内存里，重启即失忆 | `联机13` |

## 7. 客户端收到消息后做什么

| 消息 | 客户端行为 | 备注 |
| --- | --- | --- |
| `welcome` | 种子与服务端比对：**不一致就整批跳过**（不写 edits、不建远端玩家），消息栏 + HUD 提示 `/netseed reload` 或 `/netseed new`；一致则 `edits` 逐条按 `planRemoteBlock` 走、重建远端玩家与掉落物镜像 | 种子不同 = 两片大陆，同一坐标是另一格，写进去只会污染本地存档；种子冲突判定在 `core/net/SeedReconcile.ts`。远端改动**会**进本地存档（`联机6` 隔离仍未做） |
| `player` | 维护 `remotePlayers` + 平滑器；维度记进 `RemotePresence`，渲染只画同维度 | 队友走进下界时不会在主世界同坐标留一个分身 |
| `leave` | 删远端玩家与其名下镜像 | |
| `block` | 一律先 `world.edits.record`（**未加载区块的改动也不再丢**）；同维度且已加载才额外 `setBlockAndUpdate` + 补建容器，否则等区块加载时 `World.onGenerated` 的 `applyTo` 叠回去；`y` 越界整条丢弃 | 分档判定在 `core/net/RemoteBlockWrite.ts` 的 `planRemoteBlock`（同一条也用于 `welcome` 的 edits） |
| `container` | 仅当同维度、且那一格确实是箱子/木桶时，用 `restoreStacks` 清洗后写回 | 不回声（`Chest.restore` 不触发 `onMutate`） |
| `item-spawn` | 建只渲染的镜像（`ghost=true`），不跑物理、不可拾取 | `owner === selfId` 时跳过 |
| `item-remove` | 标记 ghost 死亡并删表 | |
| `chat` | 追加到消息栏并本地回显 | 发送者会收到服务端回传 → **重复一条**（`联机30`） |
| `error` | 写进状态与消息栏（`onError`）；致命码置 `fatal`，**不再自动重连** | 服务端拒绝 join 时它会紧接着关闭连接 |

平滑：`core/net/RemoteInterpolation.ts` 用指数逼近 + 最短角 yaw；位移超过 8 格（重生/传送门）
直接对齐，不拖长线。

## 8. 已知缺口（按队列编号）

| 编号 | 缺口 | 影响 |
| --- | --- | --- |
| `联机4` | 未加载区块的 `block` 改为进增量表等区块加载（`onNetBlock` / `welcome` 同一条判定） | 走动过去能看到队友的改动；但补上的若是漏斗/箱子，容器实体仍不会建（`联机33`） |
| `联机5` | 种子冲突时**跳过**这一批 edits 并给 `/netseed reload|new`（`reload` 删库重开、`new` 另建同种子世界） | 目前入口是命令，连接界面上的按钮见 `联机9` |
| `联机6` | 联机时切到按 roomId 派生的独立库（`worldId@mp:<room>`），断开后**停止写盘**、重进世界才回单机档 | 单机档不再被污染；无缝回切需要"世界原地重载"（`联机34`） |
| `联机7` | 无心跳/超时 | 半开连接永远在线 |
| `联机10`/`联机11` | 无时间/天气/睡眠消息 | 一个人白天一个人黑夜 |
| `联机12` | 只有玩家动作广播方块 | 红石/流体/作物/爆炸长期分叉 |
| `联机13` | 服务端无持久化 | 重启后新玩家看到原始地形 |
| `联机15`/`联机16` | 容器只覆盖箱子/木桶且打开时才挂；告示牌/展示框不同步 | 熔炉、酿造台、牌子上的字各看各的 |
| `联机17`~`联机23` | 玩家外观、名字牌、生物、拾取、PvP、其他实体 | 看不到手持物；打怪不同步；镜像捡不起来 |
| `联机24`~`联机27` | 无校验、无限频、无房间、无 AOI | 脏客户端能远程拆家/刷屏；人数一多广播是 O(n²) |
| `联机28` | `ws` 在 devDependencies、无 wss | 生产装不上依赖；HTTPS 页面连不上 |
| `联机30` | `chat` 广播含发送者 + 客户端本地回显 | 自己发的消息出现两次 |

## 9. 改动这份协议时的规矩

1. **先改这里，再改两端**：字段名、方向、校验规则都在这张表里，代码只是它的实现。
2. **服务端不信任消息里的身份**：`owner` 一律由连接 id 拼；新消息如果带玩家 id，同样处理。
3. **每条新消息都要有测试**：`tools/net-test.mjs` 用真连接断言“谁收到、谁收不到”。
4. **远端应用要抑制回声**：客户端把网络来的改动写进世界时，不能再触发一次广播
   （`联机12` 会给 `World.events.onBlockChanged` 加这个闸门）。
