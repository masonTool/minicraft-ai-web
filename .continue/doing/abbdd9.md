# 队列 · 会话 abbdd9159d0b4bf084c8a8a9fdcf439b

> 状态：执行中
> 创建：2026-10-25
> 批次：20261025-1946

> **待接管**：本文件由父会话 `277487` 在 `/Users/mason/DouDou/minicraft-ai-web` 建树时写下（2026-10-25）。
> 接管两步：`git mv .continue/doing/worktree.md .continue/doing/<本会话 sid 前 6 位>.md`，
> 再把第一行的会话 ID 改成**完整**会话 ID（`audit-docs` 会核对"前 6 位 == 文件名"）。
> 不要重建队列、不要改批次号。

- [x] [N1] Rust 工程 + 协议层（常量 / 清洗 / 校验，逐条对齐 `server/protocol.mjs`）→ `cargo test` 9 条全绿
  - 做了什么：新建 `rust-server/`（tokio + tokio-tungstenite + serde）；`protocol.rs` 落协议版本 2、关闭码 4001~4008、`WORLD_MIN_Y/-MAX`、`MAX_BLOCK_ID/STATE`、`MAX_EDIT_DISTANCE`、名字清洗（去控制字符与 `<>`、压缩空白、按**字符**截 16、空则"玩家"）、房间名回落、clientId 形状、方块改动的 y/id/state/距离校验（**房主豁免距离闸**）、`scoped_key`。
  - 为什么：这些清洗规则是"两个人进了两个房""名字被切成半个 emoji""房主代发的远处改动被丢"这三类老 bug 的防线，重写时**必须逐条等价**；用单测钉住比人眼比对可靠。
  - 验证：`cargo test` 9 通过 / 0 失败（含 emoji 不被切开、`<b>坏</b>` 的斜杠保留、房主豁免距离闸、非房主仍被挡）。
  - 批次：20261025-1946
- [x] [N2] 核心消息链路跑通（join / welcome / move+player / block+blocks / edit-request / chat / room-config / leave / time 广播）→ `bash run-smoke.sh` 20 条全绿
  - 做了什么：`state.rs` 的 Hub（玩家表 / 出站队列 / 房主表 / 方块增量表 / 时间与天气）；`main.rs` 的连接任务与消息分发；冒烟脚本 `smoke.mjs` 用 Node 23 内置 `WebSocket`（不需要 `npm ci`），`run-smoke.sh` 起临时服务端（25199）跑完自动关。
  - 为什么：先用"核心 21 类里的 10 类"验证架构（读写分离 + Hub 锁边界 + 房主语义），再决定是否为剩余 11 类继续投入；这一步能暴露 Rust 侧独有的两类坑（见下）。
  - 验证：`bash run-smoke.sh` **20 通过 / 0 失败**——覆盖 welcome 字段、房主/从属身份、move 转发与队伍、方块 `authority` 重标、从属直发被拒（not-host）、edit-request 转发、同房重名被拒（duplicate-name）、房主改天气、从属改配置被拒、聊天不回给自己、断线 leave 带 id。
  - 踩到并修掉的：① **tokio Mutex 不可重入**——持 `players` 锁时调 `player_broadcast_of`（内部再锁一次）会永久死锁，锁边界收进块内；② **拒绝帧被丢**——读循环 break 后立即 abort 写任务，客户端收不到 `error`+"close"，表现是"点加入没反应"，改成先 `drop(tx)` 排空再收尾。
  - 批次：20261025-1946
- [ ] [N3] 与 `tools/net-test.mjs` 全量对齐：其余 13 类消息（实体快照 / 容器 / 牌子 / 展示框 / 掉落物 / 箭 / TNT / 命中）+ `/rooms` 与 `/healthz`（同端口 HTTP 分流）+ 断线宽限重连 + AOI 裁剪 + 令牌桶限频 + 存档落盘 → `node tools/net-test.mjs`（指向 Rust 服务端）全绿
- [ ] [N4] Android 集成：`cargo-ndk` 出 `.so` + JNI 胶水 + `ForegroundService`（常驻通知）+ `MulticastLock` + UDP beacon 发现 → 真机双开可互相发现并进房
- [ ] [N5] iOS 集成：`staticlib` → `.xcframework` + 前台会话（锁屏即断，需提示）+ `NSNetService` Bonjour 广播 → 前台当房主、Android 能被发现
- [ ] [N6] 发现层双端联调：Android UDP beacon ↔ iOS Bonjour 互通、房间里显示"世界名 / 人数 / 有无口令 / 延迟"，点一下进房；并处理"自己发自己收"的回声过滤
