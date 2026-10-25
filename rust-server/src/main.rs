//! Rust 版联机服务端（第一阶段：核心消息）
//!
//! 目标形态：**一套代码编 Android / iOS**（`cargo-ndk` → `.so`，`staticlib` → `.xcframework`），
//! 所以这里刻意不碰任何平台 API：不做 UDP 广播、不做 Bonjour、不碰 Android 的
//! `MulticastLock`——那些留在平台壳（Kotlin / Swift）里，各几十行。
//!
//! **行为契约**是 `docs/NET-PROTOCOL.md` 与 `tools/net-test.mjs`（1871 行黑盒断言）。
//! 这个文件的目标不是"看起来像"，而是"跑得过那套断言"。
//!
//! 本阶段已实现：join / welcome / move+player / block+blocks / edit-request / chat /
//! ping-pong / room-config / time 广播 / 断线 leave。
//! 待实现（见文件末尾 TODO）：AOI 裁剪、令牌桶限频、断线宽限重连、实体快照、
//! 容器/牌子/展示框、掉落物、箭与 TNT、`/rooms` 与 `/healthz` HTTP 端点、存档落盘。

mod protocol;
mod state;

use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use protocol::{
    block_edit_rejection, finite_number, is_valid_client_id, sanitize_dimension, sanitize_name,
    sanitize_room, scoped_key, CLOSE_CLIENT_ID, CLOSE_DUPLICATE, CLOSE_DUPLICATE_NAME,
    CLOSE_HOST_TAKEN, CLOSE_VERSION, MOVE_INTERVAL_MS, PROTOCOL_VERSION,
};
use state::{Edit, Hub, Player};

const DEFAULT_PORT: u16 = 25187;
/// 世界种子（全服一个；L9 的"房间世界"第二阶段再接 `join.world`）。
const WORLD_SEED: i64 = 20261014;
/// 方块改动上限（满了先停止接收；JS 版的"淘汰最旧 + 告警"第二阶段补）。
const MAX_EDITS: usize = 20_000;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT);
    let hub = Arc::new(Hub::new());

    // 时间广播：服务端 2 秒一条，客户端按 4 倍速往它靠
    {
        let hub = hub.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(2));
            loop {
                ticker.tick().await;
                let rooms: Vec<String> = {
                    let players = hub.players.lock().await;
                    let mut rooms: Vec<String> = players.values().map(|p| p.room.clone()).collect();
                    rooms.sort();
                    rooms.dedup();
                    rooms
                };
                let time = hub.time_of_day().await;
                for room in rooms {
                    hub.broadcast(&room, None, &json!({"t": "time", "timeOfDay": time})).await;
                }
            }
        });
    }

    let bind = format!("0.0.0.0:{port}");
    let listener = match TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("[server] 绑定 {bind} 失败：{error}");
            std::process::exit(1);
        }
    };
    println!("[server] 已启动，端口 {port}，种子 {WORLD_SEED}（Rust 版）");

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let hub = hub.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_connection(stream, hub).await {
                        eprintln!("[server] {addr} 连接出错：{error}");
                    }
                });
            }
            Err(error) => eprintln!("[server] accept 失败：{error}"),
        }
    }
}

type Tx = mpsc::UnboundedSender<Message>;

async fn handle_connection(stream: TcpStream, hub: Arc<Hub>) -> anyhow_lite::Result<()> {
    let ws = accept_async(stream).await?;
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    let mut me: Option<u64> = None;
    while let Some(frame) = source.next().await {
        let frame = frame?;
        match frame {
            Message::Text(text) => {
                if !on_message(&hub, &mut me, &tx, text.as_str()).await {
                    break;
                }
            }
            Message::Close(_) => break,
            // Ping 由 tungstenite 自动回 Pong；这里不额外处理
            _ => {}
        }
    }

    if let Some(id) = me {
        leave(&hub, id).await;
    }
    /*
     * 先把写队列关掉、等它把最后几条消息冲出去，再收尾。
     *
     * 直接 `writer.abort()` 会**丢掉"拒绝加入"那一帧**（error + close）：那时 `me` 还是
     * None、读循环一 break 就 abort，客户端的 `wait('error')` 只能等到超时——
     * 表现是"点了加入没反应"，最难查的一类失败。
     */
    drop(tx);
    if tokio::time::timeout(std::time::Duration::from_millis(500), writer).await.is_err() {
        // 对端不收（半开连接）：不再等，直接收尾
        println!("[server] 写队列 500ms 未排空，强制关闭");
    }
    Ok(())
}

/// 处理一条客户端消息；返回 false = 该关闭连接（调用方负责清理）。
async fn on_message(hub: &Arc<Hub>, me: &mut Option<u64>, tx: &Tx, text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        // 坏 JSON 只回一条错误，不断开（与 JS 版 `bad-json` 一致）
        let _ = tx.send(text_of(&json!({"t": "error", "code": "bad-json", "message": "消息不是合法 JSON"})));
        return true;
    };
    let kind = value.get("t").and_then(Value::as_str).unwrap_or("");

    match kind {
        "join" => {
            if me.is_some() {
                send_error(tx, "joined", "已经加入过了");
                return true;
            }
            match join(hub, tx, &value).await {
                Some(id) => {
                    *me = Some(id);
                    true
                }
                None => false,
            }
        }
        "move" => {
            if let Some(id) = *me {
                on_move(hub, id, &value).await;
            }
            true
        }
        "block" => {
            if let Some(id) = *me {
                on_blocks(hub, id, &value, true).await;
            }
            true
        }
        "blocks" => {
            if let Some(id) = *me {
                on_blocks(hub, id, &value, false).await;
            }
            true
        }
        "edit-request" => {
            if let Some(id) = *me {
                on_edit_request(hub, id, &value).await;
            }
            true
        }
        "chat" => {
            if let Some(id) = *me {
                on_chat(hub, id, &value).await;
            }
            true
        }
        "room-config" => {
            if let Some(id) = *me {
                on_room_config(hub, tx, id, &value).await;
            }
            true
        }
        "ping" => {
            let _ = tx.send(text_of(&json!({"t": "pong"})));
            true
        }
        "" => true,
        _ => {
            // 未知消息只提示，不断开（老客户端/新客户端混用时不至于直接踢人）
            let _ = tx.send(text_of(&json!({"t": "error", "code": "unknown", "message": format!("未知消息 {kind}")})));
            true
        }
    }
}

/// 加入：校验 → 建 Player → 回 welcome → 广播 player。
async fn join(hub: &Arc<Hub>, tx: &Tx, value: &Value) -> Option<u64> {
    let version = value.get("v").and_then(Value::as_u64).unwrap_or(0);
    if version != u64::from(PROTOCOL_VERSION) {
        send_error(tx, "version", &format!("协议版本不匹配：服务端 {PROTOCOL_VERSION}，客户端 {version}"));
        close_with(tx, CLOSE_VERSION);
        return None;
    }

    let client_id = value.get("clientId").and_then(Value::as_str).unwrap_or("");
    if !is_valid_client_id(client_id) {
        send_error(tx, "clientId", "缺少合法的 clientId（8~64 位字母/数字/-/_）");
        close_with(tx, CLOSE_CLIENT_ID);
        return None;
    }

    let name = sanitize_name(value.get("name").and_then(Value::as_str));
    let room = sanitize_room(value.get("room").and_then(Value::as_str));
    let wants_host = value.get("host").and_then(Value::as_bool) == Some(true);

    // 同一个 clientId 已经在线 → 拒绝（不做"新连接顶掉旧连接"：没有鉴权时那等于谁抄到 id 谁就能踢人）
    let duplicate_client = {
        let players = hub.players.lock().await;
        players.values().any(|p| p.client_id == client_id)
    };
    if duplicate_client {
        send_error(tx, "duplicate", "这个 clientId 已经在线（同一个浏览器开了两个标签页？）");
        close_with(tx, CLOSE_DUPLICATE);
        return None;
    }

    // 同房重名 → 拒绝（id 不重名是这一局所有"按名字对号"的地方的前提：队伍、友伤、名字牌）
    let duplicate_name = {
        let players = hub.players.lock().await;
        players.values().any(|p| p.room == room && p.name == name)
    };
    if duplicate_name {
        send_error(tx, "duplicate-name", "房间内已有同名玩家，请改名后再加入");
        close_with(tx, CLOSE_DUPLICATE_NAME);
        return None;
    }

    let id = hub.alloc_id();

    // 房主位：一房一名
    if wants_host {
        let mut hosts = hub.hosts.lock().await;
        if hosts.contains_key(&room) {
            send_error(tx, "host-taken", "这个房间已经有房主了");
            close_with(tx, CLOSE_HOST_TAKEN);
            return None;
        }
        hosts.insert(room.clone(), id);
    }

    let display_name = name.clone();
    let player = Player {
        id,
        name,
        client_id: client_id.to_string(),
        x: finite_number(value.get("x"), 0.0),
        y: finite_number(value.get("y"), 80.0),
        z: finite_number(value.get("z"), 0.0),
        yaw: 0.0,
        pitch: 0.0,
        dimension: sanitize_dimension(value.get("dimension").and_then(Value::as_str)).to_string(),
        room: room.clone(),
        is_host: wants_host,
        team: String::new(),
        last_move_ms: 0,
        appearance: Map::new(),
    };

    {
        let mut players = hub.players.lock().await;
        players.insert(id, player);
    }
    hub.senders.lock().await.insert(id, tx.clone());

    let host_id = { hub.hosts.lock().await.get(&room).copied() };
    let time_of_day = hub.time_of_day().await;
    let weather = hub.weather().await;
    let welcome = json!({
        "t": "welcome",
        "v": PROTOCOL_VERSION,
        "id": id,
        "seed": WORLD_SEED,
        "isHost": wants_host,
        "hostId": host_id,
        "timeOfDay": time_of_day,
        "weather": weather,
        "players": hub.room_players(&room).await,
        "edits": hub.room_edits(&room).await,
        "items": [],
        "containers": [],
        "signs": [],
        "frames": [],
    });
    let _ = tx.send(text_of(&welcome));

    // 同房其他人收到 `player`（客户端据此建远端玩家）
    if let Some(broadcast) = hub.player_broadcast_of(id).await {
        hub.broadcast(&room, Some(id), &broadcast).await;
    }
    println!("[server] {display_name}#{id} 进入房间 {room}{}", if wants_host { "（房主）" } else { "" });
    Some(id)
}

async fn on_move(hub: &Arc<Hub>, id: u64, value: &Value) {
    let now = hub.started_at.elapsed().as_millis() as u64;
    // ⚠️ 锁的边界必须收干净：`player_broadcast_of` 内部还会锁 players，
    // 在持锁时调它就是 tokio::sync::Mutex 的**自死锁**（不是拒绝，是永远等）。
    let room = {
        let mut players = hub.players.lock().await;
        let Some(player) = players.get_mut(&id) else { return };
        if now.saturating_sub(player.last_move_ms) < MOVE_INTERVAL_MS {
            return;
        }
        player.last_move_ms = now;
        player.x = finite_number(value.get("x"), player.x);
        player.y = finite_number(value.get("y"), player.y);
        player.z = finite_number(value.get("z"), player.z);
        player.yaw = finite_number(value.get("yaw"), player.yaw);
        player.pitch = finite_number(value.get("pitch"), player.pitch);
        player.dimension =
            sanitize_dimension(value.get("dimension").and_then(Value::as_str)).to_string();
        if let Some(team) = value.get("team").and_then(Value::as_str) {
            player.team = team.chars().take(32).collect();
        }
        // 外观白名单（与 `readAppearance` 同字段）：held / offhand / armor / sneak / swing /
        // hurt / fire / ride / sleep / look
        for key in ["held", "offhand", "armor", "sneak", "swing", "hurt", "fire", "ride", "sleep", "look"] {
            if let Some(item) = value.get(key) {
                player.appearance.insert(key.to_string(), item.clone());
            }
        }
        player.room.clone()
    };
    let Some(broadcast) = hub.player_broadcast_of(id).await else { return };
    hub.broadcast(&room, Some(id), &broadcast).await;
}

/// `block`（单条）与 `blocks`（批量）共用；`single` 区分载荷形状。
async fn on_blocks(hub: &Arc<Hub>, id: u64, value: &Value, single: bool) {
    let (is_host, room, player_xz) = {
        let players = hub.players.lock().await;
        let Some(p) = players.get(&id) else { return };
        (p.is_host, p.room.clone(), (p.x, p.z))
    };
    // 有房主的房里，从属端不该走这条老路（它走 edit-request，由房主落地后重发）
    let has_host = { hub.hosts.lock().await.contains_key(&room) };
    if has_host && !is_host {
        hub.send_to(id, &json!({"t": "error", "code": "not-host", "message": "有房主的房间里只有房主能直接改方块"})).await;
        return;
    }

    let raw_list: Vec<&Value> = if single {
        value.get("edit").into_iter().collect()
    } else {
        value.get("blocks").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
    };
    let mut accepted: Vec<Value> = Vec::new();
    {
        let mut edits = hub.edits.lock().await;
        for raw in raw_list {
            let Some(item) = raw.as_array() else { continue };
            if item.len() < 6 {
                continue;
            }
            let (Some(x), Some(y), Some(z), Some(block_id), Some(state)) = (
                item[0].as_i64(),
                item[1].as_i64(),
                item[2].as_i64(),
                item[3].as_i64(),
                item[4].as_i64(),
            ) else {
                continue;
            };
            let (x, y, z, block_id, state) = (x as i32, y as i32, z as i32, block_id as i32, state as i32);
            let dimension = sanitize_dimension(item[5].as_str());
            if block_edit_rejection(player_xz, is_host, x, y, z, block_id, state).is_some() {
                continue;
            }
            if edits.len() < MAX_EDITS {
                let key = scoped_key(&room, dimension, x, y, z);
                edits.insert(
                    key,
                    Edit { x, y, z, id: block_id, state, dimension: dimension.to_string() },
                );
            }
            accepted.push(json!([x, y, z, block_id, state, dimension]));
        }
    }
    if accepted.is_empty() {
        return;
    }
    let message = if single {
        let first = &accepted[0];
        json!({
            "t": "block",
            "x": first[0], "y": first[1], "z": first[2], "id": first[3], "state": first[4],
            "dimension": first[5], "by": id, "authority": is_host,
        })
    } else {
        json!({"t": "blocks", "blocks": accepted, "by": id, "authority": is_host})
    };
    hub.broadcast(&room, Some(id), &message).await;
}

/// 从属端的改动请求：只转给本房房主；没房主就明确回执（别让玩家以为发出去了）。
async fn on_edit_request(hub: &Arc<Hub>, id: u64, value: &Value) {
    let room = {
        let players = hub.players.lock().await;
        let Some(p) = players.get(&id) else { return };
        p.room.clone()
    };
    let host_id = { hub.hosts.lock().await.get(&room).copied() };
    let Some(host_id) = host_id else {
        hub.send_to(id, &json!({"t": "edit-request", "ok": false, "reason": "no-host"})).await;
        return;
    };
    let payload = value.get("payload").cloned().unwrap_or(Value::Null);
    let is_known = payload.get("t").and_then(Value::as_str).is_some_and(|t| t == "blocks" || t == "block");
    if !is_known {
        return;
    }
    hub.send_to(host_id, &json!({"t": "edit-request", "from": id, "payload": payload})).await;
}

async fn on_chat(hub: &Arc<Hub>, id: u64, value: &Value) {
    let text: String = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(200)
        .collect();
    if text.trim().is_empty() {
        return;
    }
    let (name, room) = {
        let players = hub.players.lock().await;
        let Some(p) = players.get(&id) else { return };
        (p.name.clone(), p.room.clone())
    };
    println!("[server] <{name}> {text}");
    hub.broadcast(&room, Some(id), &json!({"t": "chat", "id": id, "name": name, "text": text})).await;
}

/// 房主改时间 / 天气：应用后立刻按房广播，两端当场对齐。
async fn on_room_config(hub: &Arc<Hub>, tx: &Tx, id: u64, value: &Value) {
    let (is_host, room) = {
        let players = hub.players.lock().await;
        let Some(p) = players.get(&id) else { return };
        (p.is_host, p.room.clone())
    };
    if !is_host {
        send_error(tx, "not-host", "只有房主能修改房间设置");
        return;
    }
    if let Some(time) = value.get("timeOfDay").and_then(Value::as_f64) {
        if time.is_finite() {
            let normalized = ((time % 1.0) + 1.0) % 1.0;
            hub.set_time_override(normalized).await;
            hub.broadcast(&room, None, &json!({"t": "time", "timeOfDay": normalized, "snap": true})).await;
        }
    }
    if let Some(weather) = value.get("weather").and_then(Value::as_str) {
        if matches!(weather, "clear" | "rain" | "thunder") {
            hub.set_weather(weather).await;
            hub.broadcast(&room, None, &json!({"t": "weather", "kind": weather})).await;
        }
    }
}

/// 断线清理（第一阶段：立即释放房主位；JS 版的 30 秒宽限期第二阶段补）。
async fn leave(hub: &Arc<Hub>, id: u64) {
    let player = { hub.players.lock().await.remove(&id) };
    hub.senders.lock().await.remove(&id);
    let Some(player) = player else { return };

    let mut hosts = hub.hosts.lock().await;
    if hosts.get(&player.room).copied() == Some(id) {
        hosts.remove(&player.room);
    }
    drop(hosts);

    hub.broadcast(&player.room, None, &json!({"t": "leave", "id": id})).await;
    println!("[server] {}#{id} 离开房间 {}（当前在线 {}）", player.name, player.room, hub.players.lock().await.len());
}

fn send_error(tx: &Tx, code: &str, message: &str) {
    let _ = tx.send(text_of(&json!({"t": "error", "code": code, "message": message})));
}

fn close_with(tx: &Tx, code: u16) {
    let _ = tx.send(Message::Close(Some(CloseFrame {
        code: CloseCode::Library(code),
        reason: "".into(),
    })));
}

fn text_of(value: &Value) -> Message {
    Message::Text(value.to_string().into())
}

/// 极简错误类型：避免为了一个 `?` 引入 anyhow。
mod anyhow_lite {
    pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
}

// TODO（与 JS 版对齐，按优先级）：
// 1. 断线宽限重连（30s 复用原 id）+ 房主位宽限；
// 2. AOI 裁剪（8 区块 + 同维度）与令牌桶限频；
// 3. 实体快照 / 容器 / 牌子 / 展示框 / 掉落物 / 箭 / TNT / 命中；
// 4. `/rooms` + `/healthz`（同端口 HTTP，需在 upgrade 前分流）；
// 5. 存档落盘（原子写 + 30s + 退出补存）与时间/天气状态机；
// 6. `join.world`（房主上报世界）与按房种子。
