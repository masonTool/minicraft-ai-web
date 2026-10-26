# 联机协议（WebSocket · JSON 文本帧）

> 服务端：`server/index.mjs`（端口默认 25187，`PORT` / `SEED` 可覆盖）
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
- 有协议版本位（`v`，当前 **2**；v2 = 房主权威，`join` 带 `host`）与稳定客户端标识（`clientId`）：版本不一致直接拒绝连接，
  不进入“字段慢慢对不上”的状态（见 §5.1）。
- `clientId` **不是鉴权**：没有密码/签名，只用来挡住同一个浏览器的两个标签页并发连接，
  以及将来重连时认回原玩家。它存在 localStorage（`core/net/ClientId.ts`）。

## 2. 世界模型：种子 + 增量（服务端只是"这一局的缓存"）

地形生成器是纯函数（同种子 + 同算法 = 同地形），所以服务端**不同步区块**，只同步两样：

1. `seed`：房主 `join.world` 上报，`welcome` 回发给所有人；
2. `edits`：所有被改过的方块，key 是 `房名|维度|x,y,z`，值是绝对 `id + state`。

客户端拿这两样就能重放出同一个世界，区块数据一个字节都不用传。代价是：

- **种子必须一致**。种子不一致的客户端会被提示并自动断开（`联机5`）。
- 服务端只保存“最终值”，不保存操作历史；两个人同时改同一格时后到的覆盖先到的。
- 服务端不跑 tick，红石/流体/作物/生物都在各客户端自己算（`联机12` 只统一方块写入）。

**世界以房主本地存档为唯一真相**（用户 2026-10-26）。这条决定了上面那张表的边界：

- 服务端的三张表（`edits` / 容器 / 牌子 / 展示框）**只当这一局的会话缓存**，不落盘，
  房间结束（房主宽限期过）与新房主开房时各清一次（`clearRoom`）；
- 房主进房时 `welcome` **不带**任何世界数据（他本地就是全的），随后由房主把
  容器/牌子/展示框整份推上来（`session-sync`）；
- 方块增量**按区块懒上行**：队友跨进一块没被确认过的区块时，服务端下发 `edits-request`，
  房主用 `edits-reply` 回那一块（空块也要回，否则会被无限追问）；
- 房主自己那半边**不切联机档**（`@mp:` 库只给从属端用），联机期间的所有改动直接写进
  他的单机存档——所以"退出房间后单机进世界，房子还在"。

代价要认：**房主设备就是这一局唯一的载体**。服务端不再留副本，房主清浏览器数据/换设备，
这一局的东西（含队友盖的）就没了。

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
| `join` | `v, name, clientId, x, y, z, dimension, room?, password?, host?, world?` | ① `v` 必须等于服务端版本，否则 `error.code='version'` + 关闭 4001；② `clientId` 必须是 8~64 位字母/数字/`-`/`_`，否则 `clientId` + 4002；③ 同一 clientId 已在线 → `duplicate` + 4003；④ 名字清洗（去控制字符与 `<>`、按字符截到 16、空则“玩家”）；⑤ 重复 join → `joined`；⑥ 坐标非有限数回落 `0/80/0`，维度只认 `overworld|nether|end`，其余回落主世界；⑦ `room` 只认 1~24 位字母/数字/`-`/`_`，其余回落默认房间；⑧ 服务端设了 `ROOM_PASSWORD` 时口令必须一致，否则 `error.code='password'` + 关闭 4005；⑨ `host: true` = 开房，一房只认一名房主（已有房主 → `host-taken` + 关闭 4006）；⑩ `world: {name, seed, mode?, difficulty?, worldType?}` **只有房主带得动**，`seed` 必须是 32 位整数、`name` 去掉控制字符与 `<>` 后截到 32 字，脏数据整份丢弃（房间沿用原世界 / 服务端默认种子） | 客户端发的是**最后一次 tick 的位置**，所以入服不会先在原点闪一下；重连也用这份最新值。缺坐标时按 `(0, 80, 0)`。`world` 决定**这一局的地形**（L9）：地形是种子的纯函数，所以房主选的哪个世界，队友看到的就是哪片大陆；从属端带了也无效 |
| `move` | `x, y, z, yaw, pitch, dimension` + 外观 `held / offhand / armor[] / look[] / sneak / swing / hurt / fire / ride / sleep`（都可缺省）+ `team`（队伍名，可缺省） | 距上一条 < 50ms 直接丢弃；缺字段保留旧值；外观只认这 10 个白名单字段（未知字段丢掉，非正 id 不收）；`look` 必须**恰好 10 个整数**（`[skinTone, shirtColor, pantsColor, hairColor, hairStyle, beard, eyes, eyeColor, build, frame]`，长度不符整条不下发）；`team` 截到 32 字符 | 客户端 100ms 发一条；**没有速度/距离校验**；外观（`联机17`）与队伍（`联机22`）都跟 `move` 走；`look` 是玩家自己捏的皮肤下标（与存档同一套编码），老客户端不带时对端回退"按昵称派生"；`sneak` / `ride` 已被客户端消费成姿势（`联机37`：下沉 0.12 / 抬高 0.42） |
| `block` | `x, y, z, id, state, dimension, authority?` | 五个数有限；`y ∈ [-64, 320)`；`id ∈ [0, 2000]`；`state ∈ [0, 255]`；水平距玩家 ≤ 64 格（`联机24`，**房主不做距离闸**：他代发的可能是别人在远处的请求的落地结果） | 单条版本，客户端现在走 `blocks`；id 上界**不是精确白名单**（见 §6）；拒收日志限频到 5 秒一条。**有房主的房里只有房主能发**（非房主改用 `edit-request`，由房主落地后重发） |
| `blocks` | `blocks: [[x, y, z, id, state, dimension], …]`（≤ 4096 条，超出截断）, `authority?` | 逐条与 `block` 同口径（含 y / id / state / 距离，房主同样豁免距离闸）；非法条目单独丢，不整包拒绝 | 合帧版本（`联机12`）：客户端 100ms 一批、同格只留最后一稿。**有房主的房里只有房主能发**。`authority` 是**声明**（L8·MS2：房主说"这批是我算的"），服务端**不据此判权**，下行会按 `isHost` 重新标注 |
| `edits-reply` | `dimension, cx, cz, blocks[]（形状同 blocks，≤ 4096 条）` | **只收本房房主**（`hosts.get(room).id === player.id`，否则静默丢弃）；`cx/cz` 必须有限；逐条与 `block` 同口径（房主豁免距离闸）；**每条坐标必须落在这块里**（`x>>4 === cx && z>>4 === cz`），否则单条丢弃 | 懒上行的回包（用户 2026-10-26）：房主回答"这一块你改过什么"。**空 `blocks` 是有效回答**，服务端据此把该块标成 confirmed、停止追问。收下后按房广播成普通 `blocks`（`authority: true`），客户端零改动 |
| `session-sync` | `kind`（`container` / `sign` / `frame`）, `items[]`（≤ 200 条/包） | **只收本房房主**；一条连接最多 256 条；坐标有限、容器 `y ∈ [-64,320)` 且 `slots ≤ 27` 格/≤ 8192 字节、牌子 4 行×64 字、展示框 `item` 为 `null` 或 `{id,count}`；**不设距离闸**（房主可能离箱子几千格）；不认识的 `kind` 直接丢（不关连接） | 房主进房时把容器/牌子/展示框整份推上来（用户 2026-10-26）：服务端清场之后是空的，队友 `welcome` 里的箱子内容只能来自这一推。收下后按房广播对应的 `container` / `sign` / `frame` |
| `container`, **有房主时只收房主** | `x, y, z, dimension, slots[], progress?` | 坐标有限；`y ∈ [-64, 320)`；水平距玩家 ≤ 64 格（`联机24`）；`slots` 是数组且 ≤ 27 格；`JSON.stringify(slots)` ≤ 8192 字节 | **不校验目标方块是不是容器**（服务端没有方块表）；内容由客户端 `restoreStacks` 再洗一遍。`progress`（0..1，L8·MS4）只有**房主**带得动：熔炉/酿造的计时只在他那边推进，服务端只转发房主的值并夹到 `[0,1]` |
| `item-spawn` | `localId, itemId, count, x, y, z` | 全部有限；`localId>0`、`itemId>0`、`0<count≤64`、`|x|,|z|≤3e7`、`-2000≤y≤2000`；每人每秒最多 30 条 | key 由服务端拼成 `玩家id:localId`，**不信消息里的 owner** |
| `item-remove` | `localId` | 有限且 > 0 | 只能删自己名下的：服务端拼 `当前玩家id:localId` |
| `item-take` | `owner, localId` | 两个正整数；每人每秒 20 次 | 捡**别人**那堆（`联机21`）：first-come 仲裁，先到的拿到，另一条回 `gone` |
| `chat` | `text` | 转字符串后截断到 200 字符；空串丢弃；每人每秒 5 条（令牌桶） | 服务端日志打 `<名字> 内容`；**不回传给发送者**（客户端已本地回显，`联机30`） |
| `sleep` | 无 | 必须已 join，否则 `error.code='joined'` | 睡眠跳夜（`联机11`）：**任一玩家睡满即跳**（本项目口径，不要求全员躺下）；服务端把开局时刻重置成现在（等于拨回清晨）并广播 `time{snap:true}` |
| `sign`, **有房主时只收房主** | `x, y, z, dimension, lines[]` | 坐标有限；`lines` 最多 4 行、每行截到 64 字符 | 牌子文字（`联机16`）：全空 = 擦除 |
| `room-config` | `timeOfDay?`（0..1）, `weather?`（`clear\|rain\|thunder`） | **只有房主**（非房主回 `error.code='not-host'`，连接不断）；`timeOfDay` 非有限数忽略、其余折到 `[0,1)`；`weather` 只认三个值 | 房主改房间设置：联机时时间/天气是服务端权威，服务端应用后立刻按房广播 `time{snap:true}` / `weather{kind}`，两端当场对齐（从属端在命令层就被提示"只有房主能改"） |
| `frame`, **有房主时只收房主** | `x, y, z, dimension, item, rotation` | 坐标有限；`item` 要么 `null`（空框）要么 `{id, count}` | 展示框内容（`联机16`）：放/取/转格子都会发 |
| `edit-request` | `payload`：`{t:'block'|'blocks'|'container'|'sign'|'frame'|'tnt', …}`（L8·MS2/MS4） | 必须已 join；借用方块令牌桶（一条一格）；**只转给本房房主**，房里没房主回 `{t:'edit-request', ok:false, reason:'no-host'}`；`payload.t` 不认识直接丢 | 从属端"我要改这几格"的请求：服务端不判权、不落地、不校验内容（世界语义由房主那端把关） |
| `entity-snap` | `entities: [[key, type, x, y, z, yaw, health, flags], …]`（L8·MS3，≤256 条） | 必须已 join；**只有房主能推**（其它人推的一律丢）；服务端只做形状收口（是不是数组、超不超过 256）与按房 + AOI 转发，**不做内容校验** | 房主每 100ms 推一次视野内实体，从属端据此画面影子实体 |
| `entity-remove` | `keys: ["ownerId:localId", …]`（L8·MS3，≤64） | 必须已 join；**只有房主能发**；空列表 / 非数组直接丢 | 房主报告"这几只死了"——从属端立刻撤影子，不等快照那 300ms 宽限 |
| `ping` | 无 | 必须已 join（先连接） | 应用层延迟探测（`联机29`）：客户端每 2 秒一条，服务端只回 `pong` |
| `mob-hit` | `typeId, dimension, x, y, z, damage, fire, key?` | 必须已 join；`typeId` 非空；伤害夹到 0~50、着火 0~16 秒；每人每秒 30 条 | 生物命中（`联机19`）：**不带实体 id**——两端生物各自生成，接收方按"类型 + 3 格内最近"认 |
| `player-hit` | `targetId, damage, team` | 必须已 join；`targetId` 必须在线且不是自己；伤害夹到 0~50 | 打人（`联机22`）：服务端**只转发给被击者**，不做友伤判定（队伍表在客户端） |
| `arrow` | `x, y, z, vx, vy, vz, damage` | 六个数有限；速度模长 ≤ 200；伤害夹 0~50；每人每秒 30 条 | 玩家射箭（`联机23`）：**不带 id**，各端自己生成一支跑物理 |
| `tnt`, **有房主时只收房主** | `x, y, z, dimension` | 坐标有限；维度走 `sanitizeDimension`；每人每秒 30 条 | TNT 被点燃（`联机23`）：坐标即 key，接收端 `prime` 幂等 |

未知 `t` 回 `error`；不是合法 JSON 也回 `error`，连接不关。

## 5. 服务端 → 客户端

| `t` | 字段 | 何时发 |
| --- | --- | --- |
| `welcome` | `v, id, name, seed, world{name,seed,mode,difficulty,worldType}, isHost, hostId, gameMode, timeOfDay, day, weather, players[], edits[], editsPack, items[], containers[], signs[], frames[]` | 只发给刚 join 的人。**房主的那份不带 `edits`/`containers`/`signs`/`frames`**（用户 2026-10-26：他本地就是全的，服务端那份只会有害）；从属端的那份来自本房缓存——容器/牌子/展示框由房主 `session-sync` 推上来，方块只带 8 区块内，其余按区块懒上行（`edits-request`）。`world.seed` 与老字段 `seed` 同一份（按房间，L9），没房主时 = 服务端默认种子 |
| `edits-request` | `dimension, cx, cz` | 只发给**本房房主**：队友跨进一块还没被确认过的区块时（用户 2026-10-26 懒上行）。房主用 `edits-reply` 回那一块；同一块在飞期间不重复请求（5 秒超时后允许重试），同时最多 8 块在飞。**没有房主的房不发**（那种房退回"服务端缓存就是共用那份"的老行为） |
| `time` | `timeOfDay`（0..1 的一天）、`snap?` | 每 2 秒广播给所有人；没人在线时不发。`snap: true` = 有人睡满跳夜，客户端要**立刻**对齐 |
| `weather` | `kind`（`clear` / `rain` / `thunder`） | 天气**切换时**广播（`联机35`）：晴天 8~16 分钟后 45% 继续晴 / 55% 转雨（30% 雷暴），雨天与雷暴一律转晴 |
| `player` | `id, name, x, y, z, yaw, pitch, dimension` + 外观字段（同 `move`） | 有人加入时、以及每次 `move` 被接受时（发给其他人） |
| `leave` | `id` | 连接关闭 |
| `block` | `x, y, z, id, state, dimension, by, authority` | 收到 `block` 后转发给其他人；`authority` 由服务端按发送者 `isHost` 重新判定 |
| `blocks` | `blocks[]（形状同上）, by, authority` | 收到 `blocks` 后**整包**转发给其他人（不合并不拆分，保持记录顺序）；`authority` 同上 |
| `sign` | `x, y, z, dimension, lines[], by` | 收到 `sign` 后转发给其他人（同时留一份给快照） |
| `frame` | `x, y, z, dimension, item, rotation, by` | 收到 `frame` 后转发给其他人（同时留一份给快照） |
| `mob-hit` | `typeId, dimension, x, y, z, damage, fire, by` | 收到 `mob-hit` 后转发给其他人（不落盘：伤害是瞬时事件） |
| `edit-request` | `from, payload` | 只发给**本房房主**（房主据此在自己的世界落地，再由 `blocks` 广播权威结果）；或回给请求者 `{ok:false, reason:'no-host'}` |
| `entity-snap` | `by, entities[]` | 收到后按房 + AOI（发送者为中心）转发给同房其他人 |
| `entity-remove` | `keys[], by` | 收到后按房广播给其他人（不做内容校验） |
| `room-closed` | `reason`（目前只有 `host-left`）, `graceMs`（L8·MS4） | 房主一掉线就发给**同房其他人**：房间还没关，`graceMs` 内他回来还是同一局；到期未回来则对同房每个人发 `error{code:'host-left'}` + 关闭 4007 |
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
  "v": 2,
  "id": 1,
  "name": "玩家",
  "seed": 20261014,
  "world": { "name": "草原小屋", "seed": 20261014, "mode": "survival", "difficulty": "normal", "worldType": "default" },
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
| `password` | 房间口令不对 | 4005 | **不重连**（先问口令） |
| `host-taken` | 这一局已经有房主 | 4006 | **不重连**（房主不走，重连也还是他） |
| `host-left` | 房主退出、房间已关闭（L8·MS4） | 4007 | **不重连**（这一局结束了） |
| `duplicate-name` | 同一房间里已经有同名玩家 | 4008 | **不重连**（不改名重连一万次也还是重名） |
| `not-host` | 从属端想改房间配置（时间/天气） | 不关 | 是（消息级，只回给发的人） |
| `unknown` | 未知 `t` | 不关 | 是 |

客户端的判据是 `code`，**不是关闭码**——两者可以独立演进。
新客户端连上老服务端时，`welcome` 里没有 `v`，客户端按 `v=0` 处理并拒绝进入世界
（否则字段差异会在之后的每条消息上零星炸开，很难归因）。

## 6. 服务端状态与上限

| 项 | 值 | 位置 |
| --- | --- | --- |
| 默认端口 | 25187（`PORT`） | `server/index.mjs` |
| 世界种子 | 每个房间由**房主**随 `join.world` 上报（L9）；没房主的房退回 20261014（`SEED`）。**不落盘**：重启后房间退回默认种子 | 同上 |
| 房间列表 | `GET /rooms`（同一端口）→ `{ok, protocol, passwordRequired, rooms[{room, players, hasHost, world{name,seed,mode,difficulty}}]}`；**不下发口令**、只列有人的房 | `server/index.mjs` |
| 玩家 id | 自增、不回收 | 同上 |
| 方块增量上限 | 500000 条，满了**淘汰最旧的一条并告警**（每 100 条报一次） | `MAX_EDITS` / `server/snapshot.mjs` |
| 房间清场 | 新房主开房（`send(welcome)` 之前）与房主宽限期结束各清一次 `clearRoom(room)`；**宽限期内重连的房主不清** | `server/index.mjs` |
| 懒上行在飞上限 | 每房最多 8 个区块同时在请求；单次请求 5 秒超时后可重试；已确认区块最多记 4096 个 | `MAX_INFLIGHT_REQUESTS` / `MAX_TRACKED_CHUNKS` |
| `session-sync` | 每包 ≤ 200 条，一条连接最多 256 条 | 同上 |
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
| 健康检查 | `GET /healthz`（与 WebSocket **同一个端口**），返回 `{ok, players, rooms, uptime, seed, protocol, traffic, totals}`；`/rooms` 带 `access-control-allow-origin: *`（浏览器从 5173 跨源读），其它路径 404 | `server/index.mjs` |
| 客户端默认地址 | https 页面 → `wss://<同源>/ws`；http 页面 → `ws://<hostname>:25187`；`?server=` 显式覆盖 | `core/net/ServerUrl.ts` |
| 容器快照上限 | 5000 个，满了丢弃新 key | `MAX_CONTAINERS` |
| 方块 id 上界 | 2000（`MAX_BLOCK_ID`，**不是精确白名单**；`tests/net-block-validation.test.ts` 断言真实注册表最大 id 小于它） | `server/protocol.mjs` |
| 方块 state 位宽 | 255（8 位，与 `ChunkEdits.packEdit` 一致） | 同上 |
| 改动距离上限 | 64 格（水平；`MAX_EDIT_DISTANCE`）。**房主不受这条限制**：他重发的是从属端请求的落地结果，坐标是请求方的位置 | 同上 |
| 快照文件 | `server/.data/world.json`（`DATA_DIR` 可覆盖） | `server/store.mjs` |
| 保存时机 | 每 30 秒一次 + SIGINT/SIGTERM 退出前补存一次 | 同上 |
| 快照内容 | `version(2) / savedAt / timeOfDay / day / weather`——**只有多房共享的全局量，没有任何世界数据**（用户 2026-10-26）。v1 存档仍能读，但里面那四张房间数据表一律丢弃 | 同上 |
| 损坏处理 | 读不出来就改名成 `world.json.broken-<时间戳>` 再按空世界启动（**不静默删**） | 同上 |

快照是**原子写**（先写 `world.json.tmp` 再 rename）：写到一半断电不会留下半个 JSON，
也就不会出现"下次启动读不出来、而好数据已经被覆盖"的最坏情况。

时间落盘的是"存档那一刻的时间"，重启后从那一刻继续（服务端停机期间世界停着）——
不是按真实时间补算，否则关一晚上再开就是白天了。

## 7. 客户端收到消息后做什么

| 消息 | 客户端行为 | 备注 |
| --- | --- | --- |
| `welcome` | 种子与本地比对（`core/net/SeedReconcile.ts`）：一致则 `edits` 逐条按 `planRemoteBlock` 走、重建远端玩家与掉落物镜像；**不一致 → 提示 + 自动断开联机**（不写 edits、不建远端玩家、不要求敲命令） | 种子不同 = 两片大陆，同一坐标是另一格，写进去只会污染本地存档。L9 起不再要求手敲 `/netseed reload`：新入口是"先连上、拿到房主种子再加载世界"，冲突只可能出现在"已在某个世界里去加入别人的房"这条老路径上，直接断开并指路最省事。冲突期间 `block` / `container` / `sign` / `frame` 四条远端写入全部丢弃（`remoteWorldWritable`） |
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
| `edits-request` | **只由房主处理**：从本地 `world.edits` 取那一块的增量（`core/net/ChunkSnapshot.ts` 的纯函数解包），用 `edits-reply` 回过去；**空块也回**（不回的话服务端会每次 `move` 都追问） | 解包要把区块坐标加回去（`Chunk.coordsAt()` 给的是**区块内** x/z，y 是世界坐标）——漏加会把方块全堆在区块西北角，且只有远处才看得出来 |
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
| `联机4` | 未加载区块的 `block` 改为进增量表等区块加载（`onNetBlock` / `welcome` 同一条判定）；补上的漏斗/投掷器/发射器在区块加载时**会**建容器实体（`联机33`） | 只补这几个「自己会动」的；箱子/木桶/熔炉仍是打开界面时懒创建（不影响使用） |
| `联机5` | 种子冲突（房主的世界 vs 本机世界）：**丢弃远端方块/容器/牌子并自动断开**，提示「回主菜单 →「加入房间…」」（`SeedReconcile.remoteWorldWritable`） | 不再手敲 `/netseed reload`；正确做法是「先连上、按房主种子加载世界」（L9 已做，只剩「已在世界里去加入别人的房」这条老路径） |
| `联机6` | 联机时切到按 roomId 派生的独立库（`worldId@mp:<room>`），断开后**停止写盘**、重进世界才回单机档 | 单机档不再被污染；无缝回切需要"世界原地重载"（`联机34`） |
| `联机7` | 心跳已做（5s ping / 20s 无 pong 断开），状态机在 `core/net/NetSession.ts` | 客户端侧没有"服务端静默"超时：只认 socket close |
| `联机10` | 时间已做（服务端推算 + 2s 校正，客户端按 4 倍速收敛）；**天气还没同步** | 时间一致了，但一个人下雨一个人晴天（天气拆到 `联机35`） |
| `联机11` | 睡眠跳夜已做（`sleep` 上行 + `time{snap}` 下行，任一玩家睡满即跳） | 口径与基岩版不同：**不要求全员躺下**；天气放晴只在客户端跟着跳夜事件做（`联机35`） |
| `联机12` | 方块写入已统一出口（`BlockFunnel`，100ms 合帧、同格只留最后一稿）；**模拟只由房主跑**（`SimMode`），从属端改动走 `edit-request` 由房主落地后以 `authority` 重发 | 红石/流体/作物只在房主那边算，两端不再各算一遍；`container`/`sign`/`frame`/`tnt` 的请求化还没做（仍直连上行） |
| `联机13` | **服务端不再持久化世界**（用户 2026-10-26）：`world.json` 只留 `timeOfDay / day / weather`，`SNAPSHOT_VERSION = 2`，v1 仍可读但四张表丢弃；时间/天气/天数照旧 30s + 退出保存、损坏备份 | 世界唯一载体是**房主本地存档**：房主设备丢/清缓存 = 这一局全丢（含队友盖的）。这是刻意的取舍，不是遗漏 |
| `联机14` | `welcome` 已按 8 区块裁剪；增量满了淘汰最旧并告警；**半径外的改动改为按区块懒上行**（`edits-request` / `edits-reply`，用户 2026-10-26） | 懒上行要求房主在线（房里没房主就没有权威可问，那种房退回旧行为）；容器/牌子/展示框仍是整份上行（房主进房 `session-sync`），不掉队但也不做增量 |
| `联机15` | 容器已覆盖 9 种工作站，且建出来就挂；**计时由房主推进**：熔炉/酿造进度每 1 秒随 `container.progress` 下行，从属端只读不 tick | 漏斗冷却、营火这类没有 `progress` 字段的计时仍只在房主那边生效（从属端不推进即视为一致）；容器内容仍是全量整份同步 |
| `联机16` | 已同步（`sign` / `frame` 两条消息 + 快照下发） | 只同步文字与物品：牌子上的**染料颜色/发光**、框的**多件拼贴**这些本项目本来就没做 |
| `联机17` | 外观已通（手持物/挥手/着火接到模型；潜行/骑乘/睡觉只存状态） | **副手与玩家盔甲没有数据源**（项目没有独立副手槽、盔甲是简化模型），远端模型也没有下蹲/骑乘姿势（`联机37`） |
| `联机18` | 队友昵称牌已做（复用 `Mob.customName` + 名字牌池，范围 64 格、32 格起渐隐） | 名字牌池 16 个是上限：视野里"有名字的生物 + 队友"超过 16 个时，最远的会被挤掉 |
| `联机19` | 生物**位置/血量/状态/死亡**已同步：房主每 100ms 推 `entity-snap`（AOI 内、全局键 `ownerId:localId`），从属端只插值画影子；死亡走 `entity-remove` | 影子只跟位置/血量/状态位（幼体/着火/受击/驯服），**走路摆动与攻击动作**不跟随；经验球/船/矿车仍不同步 |
| `联机38` | 全局键已落地（`mobKey`/`assignMobKey`）；权威口径改成**房主唯一模拟**（「最近玩家当权威」的 `pickAuthority` 在 MS2 之后**不再参与决策**，代码保留但别用） | `mob-hit` 仍按「类型 + 3 格内最近」认那只怪；全局键还没用到命中链路上 |
| `联机40` | 玩家盔甲已按**逐槽物品 id** 同步并渲染（`move.armor` → `MobEquipment`；`core/net/RemoteArmor.ts`） | 存档不用改：数据源本来就是 `inventory` 的四槽 id，`armorColors` 只是派生的渲染色 |
| `联机41` | 副手槽已上报（`move.offhand`）、按 F 交换、远端在左手画出物品（`MobEquipment.offHand`）；槽位与存档**都没改** | 副手物品只按"类武器/工具"的形状画（`weaponTint`），不是逐物品模型 |
| `联机20` | 远端玩家的位置已按距离分级（16 格 100ms / 32 格 250ms / 更远不更新插值目标） | 只在**接收侧**省成本；真正的"更远不发"要服务端按距离决定发给谁（`联机27`） |
| `联机21` | 拾取已仲裁（`item-take` first-come：先到的拿到，另一条 `gone`） | 只仲裁"谁拿到"：物品数量与附属数据（附魔/耐久）仍以生成方上报的为准，不校验 |
| `联机22` | PvP 已通（近战可打远端玩家，友伤按 `Teams.canHurt` 两端各判一次） | 只做近战；箭/投掷物打人不转发；伤害来源仍是 `generic`（没有 `pvp` 死因） |
| `联机23` | 箭与 TNT 已同步（玩家射的箭、任何来源点燃的 TNT） | **经验球 / 船 / 矿车不同步**：前两者与生物同属"各自生成、没有 id 空间"（`联机38`）；载具还有骑乘与摆放归属问题 |
| `联机24` | 方块/容器消息已校验（y 范围、id 上界、state 位宽、距玩家 ≤64 格，拒收日志限频） | id 上界不是精确白名单；容器**不校验目标方块是不是容器**（服务端没有方块表） |
| `联机25` | 限频与体积已做（block/container/chat 三个令牌桶 + `maxPayload` 64KB + 名字清洗） | 只限这三类：掉落物/生物命中/拾取/特效用的是各自手写的 1 秒窗口（四条老链路，没迁到桶上）；没有 Origin 校验（`联机26`） |
| `联机26` | 房间码 / 可选口令 / 来源白名单已做（数据表按 `房名|` 前缀隔离）；**种子按房**：房主 `join.world` 上报、`welcome` 回发（L9）；**房间有生命周期了**：新房主开房与关房各清一次（用户 2026-10-26） | 口令明文走 `join`，不是鉴权；天气仍全服共享（未做每房天气）；同一房名换世界不再继承旧数据（清场保证） |
| `联机27` | 广播已按 8 区块 + 维度过滤（坐标类消息）；O(n²) → O(n·k) | `player` 位置消息**不过滤**（否则远处队友直接消失，且它已被 move 限频）；`chat`/`time` 不过滤 |
| `联机28` | wss/部署已就绪（`ws` 进生产依赖、`/healthz`、Dockerfile、nginx 反代、`notes/multiplayer-ops.md`） | 没有内置 TLS：https 站点必须挂反代；镜像不含前端静态产物（分开部署） |
| `联机29` | 观测已做（`/healthz` 带吞吐、服务端每 10 秒一行统计日志、F3 面板显示延迟/丢包/上下行） | 服务端不跑 tick，所以没有真正的 TPS——统计的是**消息速率**与吞吐；客户端丢包是**应用层 ping 超时**估的，不是网络层真值 |
| `联机24`~`联机27` | 无校验、无限频、无房间、无 AOI | 脏客户端能远程拆家/刷屏；人数一多广播是 O(n²) |
| `联机28` | `ws` 在 devDependencies、无 wss | 生产装不上依赖；HTTPS 页面连不上 |
| `联机30` | 已修：`chat` 不再回传给发送者（与方块/容器同一口径） | 客户端在发送时本地回显，服务端只发给其他人 |
| `联机31` | 掉落物带维度（`item-spawn` 与 `welcome.items`，客户端维度不匹配不建镜像） | `item-remove` 仍只带 `owner/localId`（不需要维度：全局键唯一） |
| `联机33` | 区块加载后补建的容器实体已做（从增量表里挑，不扫整块方块） | 只覆盖「自己会动」的四类（漏斗/投掷器/发射器/潜影盒）；箱子/熔炉靠打开界面时懒创建 |
| `联机34` | 世界原地重载已做（`World.reset()` + 清单自检；退联机时切回单机库并重载） | 只在**退联机**这一条路径上接了；`/netseed reload` 仍走「回菜单重开」 |
| `联机35` | 天气权威已做（服务端每 2 秒推进一次状态机、切换时广播、`welcome` 下发、落盘） | 各房间共享**同一个**天气（不是每房一套）；切换广播没有测试覆盖（要等 8~16 分钟），靠 `tests/net-weather.test.ts` 的两端规则一致性兜底 |
| `联机37` | 远端玩家的下蹲/骑乘姿势已做（`core/render/MobPose.ts`，数值与本地玩家一致） | 盔甲逐槽数据源与副手槽**没做**（要改存档格式）→ `联机40` / `联机41` |

## 9. 改动这份协议时的规矩

1. **先改这里，再改两端**：字段名、方向、校验规则都在这张表里，代码只是它的实现。
2. **服务端不信任消息里的身份**：`owner` 一律由连接 id 拼；新消息如果带玩家 id，同样处理。
3. **每条新消息都要有测试**：`tools/net-test.mjs` 用真连接断言“谁收到、谁收不到”。
4. **远端应用要抑制回声**：客户端把网络来的改动写进世界时，不能再触发一次广播
   （`联机12` 会给 `World.events.onBlockChanged` 加这个闸门）。
