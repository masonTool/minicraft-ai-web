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
- 服务端不校验 Origin、不鉴权；**`maxPayload` 设为 64KB**（`联机25`）——`ws` 默认 100MB，一条手工构造的消息就能让服务端先分配 100MB 再解析。超限时 `ws` 以 1009 关连接。
- **有心跳**（`联机7`）：服务端每 5 秒发一次 WebSocket `ping` 帧，`20` 秒没收到 `pong`
  就 `terminate()` 掉这个 socket（离开广播与掉落物清理走正常的 close 路径）。浏览器
  不能主动发 `ping`，但**会自动回 `pong`**，所以这是唯一不用改应用层协议的探活手段。
  客户端侧不另做超时：它只认 socket 的 close，断开后按 `RECONNECT_DELAY_MS` 重连，
  状态机在 `core/net/NetSession.ts`（`idle|connecting|connected|reconnecting|offline`）。
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

**入口**（`联机9`）：主菜单的「多人游戏」（先选一个世界——联机是在某个世界里连的，没有独立
大厅；进世界后自动弹出面板）与暂停菜单里的同名按钮。面板只管「地址 / 昵称 / 连接 / 断开 /
状态」（`src/ui/MultiplayerScreen.ts`），地址会自动补 `ws://`、`http(s)://` 自动映射成
`ws(s)://`。控制台仍然可以直接 `mc.connect(url, name)`。

```
客户端                                  服务端
  |-- TCP/WS 连接 ---------------------->|
  |-- join（v / name / clientId）------>|  校验版本与身份；建 players 记录（id 自增）
  |<------------- welcome（快照）--------|  给自己
  |                                      |-- player（广播）--> 其他人
  |-- move（100ms 一条）---------------->|  50ms 限频，转发给其他人
  |-- block / container / item / chat -->|  转发 / 记账
  |<------------- player/block/... ------|
  |-- close ---------------------------->|  移出 players，进 30 秒 grace（不广播 leave、不清掉落物）
  |-- join（同一 clientId）------------>|  命中 grace → 复用原 id；到期才广播 leave + 清理
```

断线后客户端每 **3 秒**重连一次（`NetClient.RECONNECT_DELAY_MS`），主动 `disconnect()` 除外；
要不要重连由 `core/net/NetSession.ts` 的状态机决定（致命错误与主动断开不重连）。

**断线重连复用 id**（`联机8`）：服务端给断开的玩家留 30 秒宽限期（`GRACE_MS` 可覆盖，
测试里压到 400ms），期间他不在 `players` 里（不占在线人数、位置不再广播、别人看到的是
停在原地），但 id 与名下掉落物都留着。带同一个 `clientId` 在宽限期内回来就认回原 id——
队友眼里的你不会"消失又出现"，你自己生成的掉落物也还能删（`items` 的 owner 就是 id）。
宽限期过完才广播 `leave` 并清掉落物。客户端的 `localId` 计数不重置，所以重新冒出来的
掉落物不会和旧的撞键。

## 4. 客户端 → 服务端

| `t` | 字段 | 服务端校验 | 备注 |
| --- | --- | --- | --- |
| `join` | `v, name, clientId, x, y, z, dimension, room?, password?` | ① `v` 必须等于服务端版本，否则 `error.code='version'` + 关闭 4001；② `clientId` 必须是 8~64 位字母/数字/`-`/`_`，否则 `clientId` + 4002；③ 同一 clientId 已在线 → `duplicate` + 4003；④ 名字清洗（去控制字符与 `<>`、按字符截到 16、空则“玩家”）；⑤ 重复 join → `joined`；⑥ 坐标非有限数回落 `0/80/0`，维度只认 `overworld|nether|end`，其余回落主世界；⑦ `room` 只认 1~24 位字母/数字/`-`/`_`，其余回落默认房间；⑧ 服务端设了 `ROOM_PASSWORD` 时口令必须一致，否则 `error.code='password'` + 关闭 4005 | 客户端发的是**最后一次 tick 的位置**，所以入服不会先在原点闪一下；重连也用这份最新值。缺坐标时按 `(0, 80, 0)` |
| `move` | `x, y, z, yaw, pitch, dimension` + 外观 `held / offhand / armor[] / sneak / swing / hurt / fire / ride / sleep`（都可缺省）+ `team`（队伍名，可缺省） | 距上一条 < 50ms 直接丢弃；缺字段保留旧值；外观只认这 9 个白名单字段（未知字段丢掉，非正 id 不收）；`team` 截到 32 字符 | 客户端 100ms 发一条；**没有速度/距离校验**；外观（`联机17`）与队伍（`联机22`）都跟 `move` 走 |
| `block` | `x, y, z, id, state, dimension` | 五个数有限；`y ∈ [-64, 320)`；`id ∈ [0, 2000]`；`state ∈ [0, 255]`；水平距玩家 ≤ 64 格（`联机24`） | 单条版本，客户端现在走 `blocks`；id 上界**不是精确白名单**（见 §6）；拒收日志限频到 5 秒一条 |
| `blocks` | `blocks: [[x, y, z, id, state, dimension], …]`（≤ 4096 条，超出截断） | 逐条与 `block` 同口径（含 y / id / state / 距离）；非法条目单独丢，不整包拒绝 | 合帧版本（`联机12`）：客户端 100ms 一批、同格只留最后一稿 |
| `container` | `x, y, z, dimension, slots[]` | 坐标有限；`y ∈ [-64, 320)`；水平距玩家 ≤ 64 格（`联机24`）；`slots` 是数组且 ≤ 27 格；`JSON.stringify(slots)` ≤ 8192 字节 | **不校验目标方块是不是容器**（服务端没有方块表）；内容由客户端 `restoreStacks` 再洗一遍 |
| `item-spawn` | `localId, itemId, count, x, y, z` | 全部有限；`localId>0`、`itemId>0`、`0<count≤64`、`|x|,|z|≤3e7`、`-2000≤y≤2000`；每人每秒最多 30 条 | key 由服务端拼成 `玩家id:localId`，**不信消息里的 owner** |
| `item-remove` | `localId` | 有限且 > 0 | 只能删自己名下的：服务端拼 `当前玩家id:localId` |
| `item-take` | `owner, localId` | 两个正整数；每人每秒 20 次 | 捡**别人**那堆（`联机21`）：first-come 仲裁，先到的拿到，另一条回 `gone` |
| `chat` | `text` | 转字符串后截断到 200 字符；空串丢弃；每人每秒 5 条（令牌桶） | 服务端日志打 `<名字> 内容`；**不回传给发送者**（客户端已本地回显，`联机30`） |
| `sleep` | 无 | 必须已 join，否则 `error.code='joined'` | 睡眠跳夜（`联机11`）：**任一玩家睡满即跳**（本项目口径，不要求全员躺下）；服务端把开局时刻重置成现在（等于拨回清晨）并广播 `time{snap:true}` |
| `sign` | `x, y, z, dimension, lines[]` | 坐标有限；`lines` 最多 4 行、每行截到 64 字符 | 牌子文字（`联机16`）：全空 = 擦除 |
| `frame` | `x, y, z, dimension, item, rotation` | 坐标有限；`item` 要么 `null`（空框）要么 `{id, count}` | 展示框内容（`联机16`）：放/取/转格子都会发 |
| `ping` | 无 | 必须已 join（先连接） | 应用层延迟探测（`联机29`）：客户端每 2 秒一条，服务端只回 `pong` |
| `mob-hit` | `typeId, dimension, x, y, z, damage, fire` | 必须已 join；`typeId` 非空；伤害夹到 0~50、着火 0~16 秒；每人每秒 30 条 | 生物命中（`联机19`）：**不带实体 id**——两端生物各自生成，接收方按"类型 + 3 格内最近"认 |
| `player-hit` | `targetId, damage, team` | 必须已 join；`targetId` 必须在线且不是自己；伤害夹到 0~50 | 打人（`联机22`）：服务端**只转发给被击者**，不做友伤判定（队伍表在客户端） |
| `arrow` | `x, y, z, vx, vy, vz, damage` | 六个数有限；速度模长 ≤ 200；伤害夹 0~50；每人每秒 30 条 | 玩家射箭（`联机23`）：**不带 id**，各端自己生成一支跑物理 |
| `tnt` | `x, y, z, dimension` | 坐标有限；维度走 `sanitizeDimension`；每人每秒 30 条 | TNT 被点燃（`联机23`）：坐标即 key，接收端 `prime` 幂等 |

未知 `t` 回 `error`；不是合法 JSON 也回 `error`，连接不关。

## 5. 服务端 → 客户端

| `t` | 字段 | 何时发 |
| --- | --- | --- |
| `welcome` | `v, id, name, seed, timeOfDay, players[], edits[], items[], containers[], signs[], frames[]` | 只发给刚 join 的人；`containers`（`联机13`）与 `signs`/`frames`（`联机16`）是落盘带回来的 |
| `time` | `timeOfDay`（0..1 的一天）、`snap?` | 每 2 秒广播给所有人；没人在线时不发。`snap: true` = 有人睡满跳夜，客户端要**立刻**对齐 |
| `player` | `id, name, x, y, z, yaw, pitch, dimension` + 外观字段（同 `move`） | 有人加入时、以及每次 `move` 被接受时（发给其他人） |
| `leave` | `id` | 连接关闭 |
| `block` | `x, y, z, id, state, dimension, by` | 收到 `block` 后转发给其他人 |
| `blocks` | `blocks[]（形状同上）, by` | 收到 `blocks` 后**整包**转发给其他人（不合并不拆分，保持记录顺序） |
| `sign` | `x, y, z, dimension, lines[], by` | 收到 `sign` 后转发给其他人（同时留一份给快照） |
| `frame` | `x, y, z, dimension, item, rotation, by` | 收到 `frame` 后转发给其他人（同时留一份给快照） |
| `mob-hit` | `typeId, dimension, x, y, z, damage, fire, by` | 收到 `mob-hit` 后转发给其他人（不落盘：伤害是瞬时事件） |
| `pong` | 无 | 回给发 `ping` 的那个人（`联机29`） |
| `player-hit` | `fromId, fromName, fromTeam, damage` | **只发给被击者**；被击者用 `fromTeam` + 自己的队伍表再判一次友伤 |
| `arrow` | 同上行 + `by` | 收到 `arrow` 后转发给其他人 |
| `tnt` | 同上行 + `by` | 收到 `tnt` 后转发给其他人 |
| `container` | `x, y, z, dimension, slots[], by` | 收到 `container` 后转发给其他人 |
| `item-spawn` | `owner, localId, itemId, count, x, y, z, dimension` | 收到 `item-spawn` 后转发给其他人（`dimension` 由服务端记下来、随快照下发，`联机31`） |
| `item-remove` | `owner, localId` | 收到 `item-remove`，或 owner 离线清理时 |
| `item-take` | `ok, owner, localId, itemId?, count?, reason?` | 只回给申请者；成功时**另**广播一条 `item-remove` 给所有人 |
| `chat` | `id, name, text` | 收到 `chat` 后发给**同一个房间里的其他人**（不含发送者） |
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
| 方块增量上限 | 200000 条，满了**淘汰最旧的一条并告警**（每 100 条报一次） | `MAX_EDITS` / `server/snapshot.mjs` |
| `welcome` 裁剪半径 | 8 区块（128 格，切比雪夫；只带同维度） | `SNAPSHOT_RADIUS_CHUNKS` |
| 掉落物上限 | 2000 条，满了丢弃新 key | `MAX_ITEMS` |
| 掉落物广播 | 每人每秒 30 条（固定 1 秒窗口） | `ITEM_RATE_LIMIT` |
| 位置限频 | 50ms | `MOVE_INTERVAL_MS` |
| 方块限频 | 令牌桶：每秒 200 格、可攒 400（按**条数**计费，红石连锁一次几十格是正常的） | `server/ratelimit.mjs` |
| 容器限频 | 令牌桶：每秒 20 次 | 同上 |
| 聊天限频 | 令牌桶：每秒 5 条 | 同上 |
| 单帧上限 | 64KB（`maxPayload`） | `server/index.mjs` |
| 房间 | `room` 字段（1~24 位字母/数字/`-`/`_`），默认 `default`；数据表 key 前缀就是房名 | `server/protocol.mjs` / 同上 |
| 房间口令 | `ROOM_PASSWORD` 环境变量，空 = 不校验（**明文传输，不是鉴权**） | 同上 |
| 来源白名单 | `ALLOWED_ORIGINS`（逗号分隔），空 = 不校验；**无 Origin 的连接放行**（node 机器人/原生客户端不带） | 同上 |
| 广播关注范围 | 8 区块 + 同维度（`AOI_RADIUS_CHUNKS`）；只作用于**坐标类**消息（方块/容器/牌子/展示框/TNT/掉落物/生物命中/箭），聊天与时间不过滤 | `server/aoi.mjs` |
| 健康检查 | `GET /healthz`（与 WebSocket **同一个端口**），返回 `{ok, players, rooms, uptime, seed, protocol}`；其它路径 404 | `server/index.mjs` |
| 客户端默认地址 | https 页面 → `wss://<同源>/ws`；http 页面 → `ws://<hostname>:8787`；`?server=` 显式覆盖 | `core/net/ServerUrl.ts` |
| 容器快照上限 | 5000 个，满了丢弃新 key | `MAX_CONTAINERS` |
| 方块 id 上界 | 2000（`MAX_BLOCK_ID`，**不是精确白名单**；`tests/net-block-validation.test.ts` 断言真实注册表最大 id 小于它） | `server/protocol.mjs` |
| 方块 state 位宽 | 255（8 位，与 `ChunkEdits.packEdit` 一致） | 同上 |
| 改动距离上限 | 64 格（水平；`MAX_EDIT_DISTANCE`） | 同上 |
| 快照文件 | `server/.data/world.json`（`DATA_DIR` 可覆盖） | `server/store.mjs` |
| 保存时机 | 每 30 秒一次 + SIGINT/SIGTERM 退出前补存一次 | 同上 |
| 快照内容 | `version / savedAt / seed / timeOfDay / edits[] / containers[] / signs[] / frames[]` | 同上 |
| 损坏处理 | 读不出来就改名成 `world.json.broken-<时间戳>` 再按空世界启动（**不静默删**） | 同上 |

快照是**原子写**（先写 `world.json.tmp` 再 rename）：写到一半断电不会留下半个 JSON，
也就不会出现"下次启动读不出来、而好数据已经被覆盖"的最坏情况。

时间落盘的是"存档那一刻的时间"，重启后从那一刻继续（服务端停机期间世界停着）——
不是按真实时间补算，否则关一晚上再开就是白天了。

## 7. 客户端收到消息后做什么

| 消息 | 客户端行为 | 备注 |
| --- | --- | --- |
| `welcome` | 种子与服务端比对：**不一致就整批跳过**（不写 edits、不建远端玩家），消息栏 + HUD 提示 `/netseed reload` 或 `/netseed new`；一致则 `edits` 逐条按 `planRemoteBlock` 走、重建远端玩家与掉落物镜像 | 种子不同 = 两片大陆，同一坐标是另一格，写进去只会污染本地存档；种子冲突判定在 `core/net/SeedReconcile.ts`。远端改动**会**进本地存档（`联机6` 隔离仍未做） |
| `player` | 维护 `remotePlayers` + 平滑器；维度记进 `RemotePresence`，渲染只画同维度；外观进 `RemoteAppearance`（挥手/受伤**边沿触发 + 本地计时**，因为网络 100ms 一条而动作只有 0.25s） | 队友走进下界时不会在主世界同坐标留一个分身；手持物/挥手/着火直接接到模型上 |
| `leave` | 删远端玩家与其名下镜像 | |
| `pong` | `NetStats.ackPing()`——与**最早**那条未回的 ping 配对算 RTT（几条同时在飞时配错会让 RTT 虚低） | 丢包 = 3 秒没回的那几条；F3 面板显示延迟/丢包/上下行 |
| `time` | 只记目标值，主循环里按 `dt * 4` 向它靠（`core/net/NetTime.ts` 的 `stepTimeOfDayToward`）；`snap: true` 时**立刻对齐**并顺手放晴 | 直接赋值太阳会"跳"；睡满跳夜那种大跳必须换成立即对齐，否则夜里要追 70 秒 |
| `sign` | 写回 `signText`，当前维度立刻 `syncSigns`（渲染器下一趟 sync 画出） | 全空 = 擦除；非当前维度也存下来，切过去还在 |
| `frame` | 写回 `itemFrames`（`item: null` = 删条目），当前维度 `syncFrames` | 与容器同理：本地放/取/转格子时也发（`联机16`） |
| `mob-hit` | 按"同类型 + 3 格内最近"找自己世界里的那只（`core/net/MobMatch.ts`），扣血 + 点火 | **找不到就忽略**：两端生物各自生成，不能凭空造一只（否则双份怪物）；击退不同步（位置由各端 AI 自己算） |
| `player-hit` | `Teams.canHurt(fromName, 自己)` 判一次友伤，通过才 `damagePlayer`（来源 `generic`） | 攻击者那边也判过一次（本地拦截省往返）；队伍表各端各存一份，不同步 |
| `arrow` | 在本地也生成一支箭跑物理（`fromPlayer: true, pickable: false`） | 落点会差几厘米；不给捡（别人的箭捡了就是复制） |
| `tnt` | 同维度才处理，直接 `primedTnt.prime(...)` | 坐标即 key，`prime` 幂等，不会重复点火 |
| `block` / `blocks` | 一律先 `world.edits.record`（**未加载区块的改动也不再丢**）；同维度且已加载才额外 `setBlockAndUpdate` + 补建容器，否则等区块加载时 `World.onGenerated` 的 `applyTo` 叠回去；`y` 越界整条丢弃 | 分档判定在 `core/net/RemoteBlockWrite.ts` 的 `planRemoteBlock`（同一条也用于 `welcome` 的 edits）；应用期间 `applyingRemoteBlock > 0`，**不回发**（回声抑制） |
| `container` | 同维度且那一格确实是**容器方块**时，按方块取容器（箱子 / 木桶 / 熔炉 / 高炉 / 烟熏炉 / 酿造台 / 发射器 / 投掷器 / 漏斗），用 `restoreStacks` 按格数清洗后逐格写回 | 写回期间 `applyingRemoteBlock` 抑制回声；本地任一类容器内容变化都会发（`containerOfBlockAt` 建出来就挂，不再只在打开界面时挂） |
| `item-spawn` | 建镜像（`ghost=true`）：不跑物理、不参与本地拾取，但**走近会向服务端申请**（`联机21`）；**维度不匹配直接跳过**（`联机31`） | `owner === selfId` 时跳过 |
| `item-take` | 仲裁结果：`ok` 才把 `itemId/count` 加进背包（背包满就掉脚下），无论成败都删镜像 | 成功后服务端还会广播 `item-remove`，各端镜像一起消失 |
| `item-remove` | 标记 ghost 死亡并删表 | |
| `chat` | 追加到消息栏（`onChat`） | 发送方自己**本地回显**一次、服务端不再回传——两侧各管一半，所以只出现一次 |
| `error` | 写进状态与消息栏（`onError`）；致命码置 `fatal`，**不再自动重连** | 服务端拒绝 join 时它会紧接着关闭连接 |

平滑：`core/net/RemoteInterpolation.ts` 用指数逼近 + 最短角 yaw；位移超过 8 格（重生/传送门）
直接对齐，不拖长线。

## 8. 已知缺口（按队列编号）

| 编号 | 缺口 | 影响 |
| --- | --- | --- |
| `联机4` | 未加载区块的 `block` 改为进增量表等区块加载（`onNetBlock` / `welcome` 同一条判定） | 走动过去能看到队友的改动；但补上的若是漏斗/箱子，容器实体仍不会建（`联机33`） |
| `联机5` | 种子冲突时**跳过**这一批 edits 并给 `/netseed reload|new`（`reload` 删库重开、`new` 另建同种子世界） | 目前入口是命令，连接界面上的按钮见 `联机9` |
| `联机6` | 联机时切到按 roomId 派生的独立库（`worldId@mp:<room>`），断开后**停止写盘**、重进世界才回单机档 | 单机档不再被污染；无缝回切需要"世界原地重载"（`联机34`） |
| `联机7` | 心跳已做（5s ping / 20s 无 pong 断开），状态机在 `core/net/NetSession.ts` | 客户端侧没有"服务端静默"超时：只认 socket close |
| `联机10` | 时间已做（服务端推算 + 2s 校正，客户端按 4 倍速收敛）；**天气还没同步** | 时间一致了，但一个人下雨一个人晴天（天气拆到 `联机35`） |
| `联机11` | 睡眠跳夜已做（`sleep` 上行 + `time{snap}` 下行，任一玩家睡满即跳） | 口径与基岩版不同：**不要求全员躺下**；天气放晴只在客户端跟着跳夜事件做（`联机35`） |
| `联机12` | 方块写入已统一出口（`World.events.onBlockChanged` + 40 处散点 → `BlockFunnel`，100ms 合帧、同格只留最后一稿） | 红石/流体/火焰/作物/漏斗/爆炸现在都会同步；但两端各自跑模拟，同一事件在两边得出的结果仍可能不同（如流体更新顺序） |
| `联机13` | 已有持久化（`edits` / 容器 / 时间落盘，30s + 退出保存，损坏备份） | **天气还没落盘**（天气权威未做，`联机35`）；玩家背包/进度仍是各客户端自己的 |
| `联机14` | `welcome` 已按 8 区块裁剪；增量满了淘汰最旧并告警 | 半径外的旧改动新玩家收不到，要等"按视野补发"（`联机27`）；容器与掉落物仍全量下发 |
| `联机15` | 容器已覆盖 9 种工作站（箱子/木桶/熔炉/高炉/烟熏炉/酿造台/发射器/投掷器/漏斗），且建出来就挂、不用打开界面 | 只同步**内容**：熔炉燃烧进度、酿造进度、漏斗冷却这些计时器各端自己跑 |
| `联机16` | 已同步（`sign` / `frame` 两条消息 + 快照下发） | 只同步文字与物品：牌子上的**染料颜色/发光**、框的**多件拼贴**这些本项目本来就没做 |
| `联机17` | 外观已通（手持物/挥手/着火接到模型；潜行/骑乘/睡觉只存状态） | **副手与玩家盔甲没有数据源**（项目没有独立副手槽、盔甲是简化模型），远端模型也没有下蹲/骑乘姿势（`联机37`） |
| `联机18` | 队友昵称牌已做（复用 `Mob.customName` + 名字牌池，范围 64 格、32 格起渐隐） | 名字牌池 16 个是上限：视野里"有名字的生物 + 队友"超过 16 个时，最远的会被挤掉 |
| `联机19` | 生物**命中**已同步（伤害 + 着火，按类型 + 邻域认） | **生物位置不同步**：两端 AI 各自跑、随机生成，同步位置会让两只怪互相拉扯并出现双份（前置见 `联机38`） |
| `联机20` | 远端玩家的位置已按距离分级（16 格 100ms / 32 格 250ms / 更远不更新插值目标） | 只在**接收侧**省成本；真正的"更远不发"要服务端按距离决定发给谁（`联机27`） |
| `联机21` | 拾取已仲裁（`item-take` first-come：先到的拿到，另一条 `gone`） | 只仲裁"谁拿到"：物品数量与附属数据（附魔/耐久）仍以生成方上报的为准，不校验 |
| `联机22` | PvP 已通（近战可打远端玩家，友伤按 `Teams.canHurt` 两端各判一次） | 只做近战；箭/投掷物打人不转发；伤害来源仍是 `generic`（没有 `pvp` 死因） |
| `联机23` | 箭与 TNT 已同步（玩家射的箭、任何来源点燃的 TNT） | **经验球 / 船 / 矿车不同步**：前两者与生物同属"各自生成、没有 id 空间"（`联机38`）；载具还有骑乘与摆放归属问题 |
| `联机24` | 方块/容器消息已校验（y 范围、id 上界、state 位宽、距玩家 ≤64 格，拒收日志限频） | id 上界不是精确白名单；容器**不校验目标方块是不是容器**（服务端没有方块表） |
| `联机25` | 限频与体积已做（block/container/chat 三个令牌桶 + `maxPayload` 64KB + 名字清洗） | 只限这三类：掉落物/生物命中/拾取/特效用的是各自手写的 1 秒窗口（四条老链路，没迁到桶上）；没有 Origin 校验（`联机26`） |
| `联机26` | 房间码 / 可选口令 / 来源白名单已做（数据表按 `房名|` 前缀隔离，跨房拾取也被挡） | 种子仍是**全服同一个**（各房地形一样，只是数据不串）；口令明文走 `join`，不是鉴权；房间没有生命周期（一直存在到服务端重启） |
| `联机27` | 广播已按 8 区块 + 维度过滤（坐标类消息）；O(n²) → O(n·k) | `player` 位置消息**不过滤**（否则远处队友直接消失，且它已被 move 限频）；`chat`/`time` 不过滤 |
| `联机28` | wss/部署已就绪（`ws` 进生产依赖、`/healthz`、Dockerfile、nginx 反代、`notes/multiplayer-ops.md`） | 没有内置 TLS：https 站点必须挂反代；镜像不含前端静态产物（分开部署） |
| `联机29` | 观测已做（`/healthz` 带吞吐、服务端每 10 秒一行统计日志、F3 面板显示延迟/丢包/上下行） | 服务端不跑 tick，所以没有真正的 TPS——统计的是**消息速率**与吞吐；客户端丢包是**应用层 ping 超时**估的，不是网络层真值 |
| `联机24`~`联机27` | 无校验、无限频、无房间、无 AOI | 脏客户端能远程拆家/刷屏；人数一多广播是 O(n²) |
| `联机28` | `ws` 在 devDependencies、无 wss | 生产装不上依赖；HTTPS 页面连不上 |
| `联机30` | 已修：`chat` 不再回传给发送者（与方块/容器同一口径） | 客户端在发送时本地回显，服务端只发给其他人 |
| `联机31` | 掉落物带维度（`item-spawn` 与 `welcome.items`，客户端维度不匹配不建镜像） | `item-remove` 仍只带 `owner/localId`（不需要维度：全局键唯一） |

## 9. 改动这份协议时的规矩

1. **先改这里，再改两端**：字段名、方向、校验规则都在这张表里，代码只是它的实现。
2. **服务端不信任消息里的身份**：`owner` 一律由连接 id 拼；新消息如果带玩家 id，同样处理。
3. **每条新消息都要有测试**：`tools/net-test.mjs` 用真连接断言“谁收到、谁收不到”。
4. **远端应用要抑制回声**：客户端把网络来的改动写进世界时，不能再触发一次广播
   （`联机12` 会给 `World.events.onBlockChanged` 加这个闸门）。
