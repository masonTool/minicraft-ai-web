# Rust 版联机服务端（Android / iOS 共用）

> 目标：**一套代码编两端**（Android `cargo-ndk` → `.so`；iOS `staticlib` → `.xcframework`），
> 让手机能自己当房主。语言选择与取舍见 `docs/` 与 `.continue/DONE.md` 的批次 20261025-1106。

## 当前状态（第一阶段）

已实现并跑通（`bash run-smoke.sh` **20/0**、`cargo test` **9/0**）：

- `join`：版本 / clientId 形状 / 同 clientId 在线 / 同房重名 / 一房一房主 / 房间名清洗
- `welcome`：种子、`isHost`、`hostId`、`timeOfDay`、`weather`、同房玩家、本房方块增量
- `move` + `player` 广播（50ms 限频、外观白名单、队伍）
- `block` / `blocks`（房主权威闸、y 范围 / id / state / 距离校验、`authority` 重标）
- `edit-request` → 只转给房主（没房主回 `no-host`）
- `chat`（截 200 字、不回给发送者）
- `room-config`（只收房主 → 广播 `time{snap}` / `weather`）
- 断线 `leave` 广播 + 释放房主位
- 每 2 秒 `time` 广播

## 还没做（按优先级）

1. **与 `tools/net-test.mjs` 全量对齐**：21 类消息里的实体快照、容器、牌子、展示框、
   掉落物、箭、TNT、命中；`/rooms` 与 `/healthz`（同端口 HTTP，需要在 upgrade 前分流）
2. **断线宽限重连**（30s 复用原 id + 房主位宽限）与 `duplicate-name` 之后的清理
3. **AOI 裁剪**（8 区块 + 同维度）、令牌桶限频、载荷上限
4. **存档落盘**（原子写 + 30s + 退出补存）与时间/天气状态机
5. **平台集成**：Android（`cargo-ndk` + JNI + `ForegroundService` + `MulticastLock`）、
   iOS（`staticlib` + `NSNetService` Bonjour，且只有前台能当房主）
6. **局域网发现**：Android UDP beacon（组播锁）；iOS 走 Bonjour

## 怎么跑

```bash
# 单测（协议清洗与校验，纯函数）
export PATH="$HOME/.cargo/bin:$PATH"
cargo test

# 端到端冒烟：起临时服务端（25199）→ 跑 20 条断言 → 关掉
bash run-smoke.sh

# 手动跑（默认端口 25187，与服务端 JS 版一致）
cargo run
```

冒烟脚本用 Node 23 内置的 `WebSocket`，所以**不需要** `npm ci`。

## 与 JS 版的关系

- **不是替换，是并行实现**：`server/*.mjs` 仍是 Web 端的服务端，行为契约在
  `docs/NET-PROTOCOL.md`
- Rust 版的对齐判据是 `tools/net-test.mjs`（裸 WebSocket 客户端，1871 行）——
  它跑通，才算"行为一致"；冒烟脚本只覆盖核心链路
- 两边的常量（协议版本 2、端口 25187、房间名规则、名字清洗、距离闸）必须逐条相等；
  Rust 侧已用 `protocol.rs` 的单测钉住

## 已知坑（写在这里免得下一个人再踩）

- **tokio Mutex 不可重入**：在持 `players` 锁时调 `player_broadcast_of`（它内部再锁一次）
  会**永久死锁**，不是报错。锁边界必须收在函数内部的 `{}` 块里。
- **拒绝加入的拒绝帧会被丢掉**：读循环 break 后立刻 `abort` 写任务，客户端就收不到
  `error` + `close`（表现是"点加入没反应"）。必须先 `drop(tx)` 让写队列排空再收尾。
- **名字清洗按字符截断**：按字节切会把 emoji 切成半个；`<` `>` 换空格但 `/` 保留
  （与 JS 的 `replace(/[<>]/g,' ')` 一致）。
