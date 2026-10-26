# Rust 版联机服务端（Android / iOS 共用）

> 目标：**一套代码编两端**（Android `cargo-ndk` → `.so`；iOS `staticlib` → `.xcframework`），
> 让手机能自己当房主。语言选择与取舍见 `docs/` 与 `.continue/DONE.md`。

## 当前状态

**与 JS 版 (`server/node/index.mjs`) 行为一致**：`tools/net-test.mjs` 的
**195 条断言 0 失败**（`bash run-net-test.sh`，连跑 3 次稳定）。

| 判据 | 命令 | 结果 |
| --- | --- | --- |
| 协议清洗/校验单测 | `cargo test` | 26 / 0 |
| 端到端冒烟（自起自停） | `bash run-smoke.sh` | 20 / 0 |
| **全量黑盒断言**（与 JS 版共用） | `bash run-net-test.sh` | **195 / 0** |
| 局域网发现（两个真进程互相发现） | `bash run-beacon-smoke.sh` | 12 / 0 |
| Android 产物 | `bash build-android.sh` | `arm64-v8a` + `x86_64` 各一个 `.so` |

已覆盖：`join`（版本 / clientId / 同 clientId 在线 / 同房重名 / 一房一房主 / 房间名 / 口令 /
来源白名单 / `world` 按房种子）、`welcome`（种子 + `world` + `isHost`/`hostId` + 时间 + 天气 +
同房玩家 + 附近方块 + 掉落物 + 容器/牌子/展示框）、`move`+`player`（50ms 限频、外观白名单、
`look` 形状、队伍）、`block`/`blocks`（房主权威闸、y/id/state/距离校验、`authority` 重标、
AOI、令牌桶）、`edit-request`（只转房主，没房主回 `no-host`）、`chat`（5/s、不回给自己）、
`room-config`（只收房主）、`sign`/`frame`/`container`(+`progress`)/`tnt`/`arrow`/`mob-hit`/
`player-hit`/`entity-snap`/`entity-remove`、`item-spawn`/`item-remove`/`item-take`（first-come
仲裁）、`sleep` 跳夜、每 2s `time` 广播、天气状态机、断线宽限重连（复用 id / 房主位宽限 /
到期 `room-closed` + `host-left` + 清掉落物）、心跳 ping、`/healthz` 与 `/rooms`（同端口 HTTP，
带 CORS）、存档落盘（原子写 + 30s + SIGTERM 补存 + 损坏备份）。

## 模块分工

| 文件 | 管什么 |
| --- | --- |
| `src/lib.rs` | **库入口**：`Config` / `Server` / `start()`、HTTP-WS 同端口分流、定时任务（时间/天气/存档/发现）、心跳 |
| `src/main.rs` | 桌面/服务器薄壳：读环境变量 → `start()` → 等信号 → 补存一次 |
| `src/jni.rs` | Android 的 JNI 胶水（`startServer` / `stopServer` / `serverPort`） |
| `src/beacon.rs` | 局域网发现：报文编解码、peer 表（含自回声过滤/TTL）、组播 socket |
| `src/protocol.rs` | 常量 + 清洗/校验（名字、房间、维度、世界元数据、外观、实体键、改动载荷）+ 单测 |
| `src/state.rs` | 全部运行时状态（一把 `tokio::Mutex`）、快照生成与读档、天气状态机 |
| `src/handlers.rs` | 消息分发（一条消息 → 查表 → 广播）与连接关闭/宽限期 |
| `src/aoi.rs` | 关注范围（8 区块 + 同维度，切比雪夫） |
| `src/ratelimit.rs` | 令牌桶与"1 秒窗口计数" |
| `src/store.rs` | 快照原子写 / 损坏备份 / 读档 |

**为什么有 lib + bin 两个产物**：Android 的 `ForegroundService` 要通过 JNI 起这个服务，
iOS 要把它编成 `.xcframework`；启动逻辑只写一份（`lib.rs` 的 `start()`），
`main.rs` / `jni.rs` 都只是"怎么调它"的薄壳。

## 怎么跑

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo test               # 纯逻辑单测（协议 / 限频 / AOI / 发现）
bash run-smoke.sh        # 自起临时服务端（25199）→ 20 条断言 → 关掉
bash run-net-test.sh     # 用 tools/net-test.mjs 的 195 条断言验收（build 后直接跑 Rust 二进制）
bash run-beacon-smoke.sh # 起两个真进程验"互相发现"（组播 + 自回声过滤）
bash build-android.sh    # 交叉编译 Android 的 .so（arm64-v8a / x86_64）
cargo run                # 手动跑（默认 8887，与 JS 版一致）
```

环境变量：`PORT`（`0` = 让系统挑，日志里打实际端口）、`SEED`、`GRACE_MS`（断线宽限，默认 30000）、
`DATA_DIR`（存档目录，默认 `./.data`）、`ROOM_PASSWORD`、`ALLOWED_ORIGINS`（逗号分隔，空 = 不校验）、
`BEACON=1`（开局域网发现）、`BEACON_PORT`（默认 25188）、`BEACON_IF`（发现用哪块网卡，
默认系统默认；同机跑两个实例做验收时指 `127.0.0.1`）。

冒烟/验收脚本都用 Node 23 内置的 `WebSocket`（`net-test` 走仓库自带的 `ws`），**不需要**额外装东西。

## 与 JS 版的关系

- **不是替换，是并行实现**：`server/node/*.mjs` 仍是 Web 端的服务端，行为契约在 `docs/NET-PROTOCOL.md`
- 对齐判据就是 `tools/net-test.mjs`（1871 行黑盒断言）。它多了一个 `NET_SERVER_BIN`
  环境变量用来"换被验收的服务端进程"（默认仍是 `node server/node/index.mjs`），
  **断言一条没改**——验的是协议，不是某种语言
- 两边的常量（协议版本 2、端口 8887、房间名规则、名字清洗、距离闸、限频数值）必须逐条相等

## 局域网发现（N4 的 Rust 半边）

- 报文：`{"mc":"minicraft","v":2,"id":"<8位hex>","port":8887,"name":"世界名","seed":…,"players":…,"host":true,"pw":false}`
- 通道：**组播** `239.255.42.99:25188`（主）+ 广播 `255.255.255.255:25188`（兜底）
- 自己的回声按 `id` 过滤（不然房间列表里会看到自己两遍）；peer 12 秒没再听到就下线
- `/healthz` 里多了 `beacon` 与 `peers`（名字/端口/种子/人数/有无房主/有无口令/来源 IP）；
  客户端"加入房间"面板就是读它（N6）
- 平台侧还差：Android 的 `MulticastLock`（组播在锁屏/休眠时会被系统掐掉）、
  iOS 的 `NSNetService`（N5）

## 已知坑（写在这里免得下一个人再踩）

- **单锁，不要拆回去**：第一阶段给每张表一把锁，踩到"持 `players` 锁时调一个内部再锁
  `players` 的函数"——tokio 的 Mutex **不可重入**，那不是报错而是**永久死锁**。
  现在所有状态在一把锁里，出站走无界 channel（`send` 是同步的），锁边界天然收得干净。
- **拒绝帧要先排空再收尾**：读循环 break 后立刻 `abort` 写任务，客户端就收不到
  `error` + `close`（表现是"点加入没反应"）。必须先 `drop(conn)`（它持有 tx 克隆）
  再等写任务把队列冲完。
- **64KB 上限自己判**：tungstenite 在 `max_message_size` 超限时直接拆连接（客户端看到
  1006），不会替我们发 1009。要回 1009 就得在读循环里自己比长度、自己发 `Close(Size)`。
- **来源白名单要在握手之后拒**：在握手回调里拒（`ErrorResponse`）客户端只看到 HTTP 错误，
  拿不到 `error.code`。所以先自己读请求头、升级后回 `error{code:'origin'}` + close 4004。
- **宽限期要带代次**：同一个人"断 → 连 → 再断"会留下两个计时任务，只比 id 的话前一个会
  在旧截止点把刚连回来的人广播成 `leave`，还会清掉他名下的掉落物。
- **名字清洗按字符截断**：按字节切会把 emoji 切成半个；`<` `>` 换空格但 `/` 保留
  （与 JS 的 `replace(/[<>]/g,' ')` 一致）。
- **发现层：`SO_REUSEPORT` 在 macOS 上是"哈希挑一个 socket"**，两个实例只有一个收得到
  广播（症状：A 看见 B，B 看不见 A）。所以改走**组播 + 按平台绑不同地址**：macOS 绑组播
  组地址、只用 `SO_REUSEADDR`；Linux/Android 绑 `0.0.0.0` + `REUSEPORT`。
- **发现层：发和收必须用两个 socket**。macOS 上监听 socket 绑的是组播地址，从它
  `send_to` 会 `EADDRNOTAVAIL`（源地址不是本机地址）。
- **开发机的默认可组播网卡可能没有**（实测：默认走组播连自己都收不到，`IP_MULTICAST_IF`
  指到 `127.0.0.1` 就通了）。所以留了 `BEACON_IF`，验收脚本显式用回环。

## 还没做

1. **平台集成**：Android（`cargo-ndk` + JNI + `ForegroundService` + `MulticastLock`）、
   iOS（`staticlib` + `NSNetService` Bonjour，且只有前台能当房主）
2. **局域网发现**：Android UDP beacon（组播锁）；iOS 走 Bonjour
