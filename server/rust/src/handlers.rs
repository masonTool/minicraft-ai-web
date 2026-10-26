//! 消息分发：一条客户端消息 → 查表 → 广播。
//!
//! 行为契约是 `tools/net-test.mjs`。这里刻意**不发明规则**：每一条校验都能在
//! `server/node/index.mjs` 找到对应的一段，注释里标出它的用途（以及漏掉会怎样）。

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use crate::protocol::*;
use crate::ratelimit::{Buckets, Window};
use crate::state::{
    item_key, Aoi, Container, Edit, Frame, Item, Player, Sign, State, Traffic, Tx,
};
use crate::store;

/// 协议里认识的消息类型（用于区分"还没 join 的已知消息"与"真的不认识"）。
const KNOWN_KINDS: [&str; 21] = [
    "join",
    "ping",
    "move",
    "block",
    "blocks",
    "entity-snap",
    "entity-remove",
    "edit-request",
    "room-config",
    "sign",
    "frame",
    "container",
    "tnt",
    "arrow",
    "mob-hit",
    "player-hit",
    "item-spawn",
    "item-remove",
    "item-take",
    "chat",
    "sleep",
];

/// 服务端全局状态 + 配置（进程内只有一份）。
pub struct Hub {
    pub state: Mutex<State>,
    pub traffic: Arc<Traffic>,
    pub started: Instant,
    pub seed: i64,
    pub grace_ms: u64,
    pub password: String,
    pub allowed_origins: Vec<String>,
    pub data_file: std::path::PathBuf,
    /// 局域网发现用的实例 id（用来过滤自己的广播回声）
    pub instance: String,
    /// 是否在广播（`/healthz` 里给客户端看）
    pub beacon_on: bool,
    /// 听到的其它实例（UDP 发现）
    pub peers: Mutex<crate::beacon::PeerBook>,
    /// 一个房间的容量（只用于 `/rooms` 显示 `在线/容量`，**不是准入限制**）
    pub max_players: u32,
    /// 允许进没有房主的房间（只给测试，见 `Config::allow_hostless_rooms`）
    pub allow_hostless_rooms: bool,
    /// 发现层用的 UDP 端口（`/healthz` 里给客户端看，与 Node 版 `beaconPort` 同名）
    pub beacon_port: u16,
}

impl Hub {
    pub fn log(&self, message: &str) {
        println!("[server] {message}");
    }
}

/// 一个连接的会话状态（限频计数、在谁名下）。
pub struct Conn {
    pub id: Option<u64>,
    pub tx: Tx,
    pub last_move_ms: u64,
    pub item_window: Window,
    pub hit_window: Window,
    pub take_window: Window,
    pub effect_window: Window,
    pub buckets: Buckets,
    pub base: Instant,
}

impl Conn {
    pub fn new(tx: Tx, base: Instant) -> Self {
        Self {
            id: None,
            tx,
            last_move_ms: 0,
            item_window: Window::default(),
            hit_window: Window::default(),
            take_window: Window::default(),
            effect_window: Window::default(),
            buckets: Buckets::new(),
            base,
        }
    }

    pub fn now_ms(&self) -> u64 {
        self.base.elapsed().as_millis() as u64
    }

    pub fn send(&self, traffic: &Traffic, value: &Value) {
        let text = value.to_string();
        if self.tx.send(Message::Text(text.clone().into())).is_ok() {
            traffic.count_out(text.len());
        }
    }

    pub fn send_error(&self, traffic: &Traffic, code: &str, message: &str) {
        self.send(traffic, &json!({"t": "error", "code": code, "message": message}));
    }

    pub fn send_ping(&self) {
        let _ = self.tx.send(Message::Ping(Vec::new().into()));
    }

    /// 拒绝一条连接：先回 `error`（带 code，客户端按它决定要不要重连），再关。
    pub fn reject(&self, traffic: &Traffic, code: &str, message: &str, close_code: u16) {
        self.send_error(traffic, code, message);
        let _ = self.tx.send(Message::Close(Some(CloseFrame {
            code: CloseCode::Library(close_code),
            reason: code.into(),
        })));
    }
}

fn text_message(value: &Value) -> Message {
    Message::Text(value.to_string().into())
}

// ---------------------------------------------------------------- 入口

/// 处理一条客户端消息；返回 false = 该关闭连接（拒绝帧已经排进写队列）。
pub async fn on_text(hub: &Arc<Hub>, conn: &mut Conn, text: &str) -> bool {
    let value: Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => {
            conn.send_error(&hub.traffic, "bad-json", "消息不是合法 JSON");
            return true;
        }
    };
    let Some(message) = value.as_object() else { return true };
    let kind = message.get("t").and_then(Value::as_str).unwrap_or("");
    let Some(id) = conn.id else {
        /*
         * 还没 join：只有 `join` / `ping` / `sleep` 有明确语义。
         *
         * 其余**已知**消息一律静默丢（与 JS 版的 `if (!player) return;` 一致）——给一个
         * 还没进房的人回"未知消息类型 move"是误导，他明明发的是认识的消息。
         * 真正不认识的类型才回 `unknown`。
         */
        return match kind {
            "join" => match join(hub, conn, message).await {
                Some(new_id) => {
                    conn.id = Some(new_id);
                    true
                }
                None => false,
            },
            "ping" => {
                conn.send(&hub.traffic, &json!({"t": "pong"}));
                true
            }
            "sleep" => {
                conn.send_error(&hub.traffic, "joined", "先 join 再睡");
                true
            }
            "" => true,
            other if KNOWN_KINDS.contains(&other) => true,
            other => {
                conn.send_error(&hub.traffic, "unknown", &format!("未知消息类型 {other}"));
                true
            }
        };
    };

    if kind == "join" {
        conn.send_error(&hub.traffic, "joined", "已经加入过了");
        return true;
    }

    match kind {
        "move" => on_move(hub, conn, id, message).await,
        "block" => on_block(hub, conn, id, message).await,
        "blocks" => on_blocks(hub, conn, id, message).await,
        "entity-snap" => on_entity_snap(hub, id, message).await,
        "entity-remove" => on_entity_remove(hub, id, message).await,
        "edit-request" => on_edit_request(hub, conn, id, message).await,
        "room-config" => on_room_config(hub, conn, id, message).await,
        "sign" => on_sign(hub, conn, id, message).await,
        "frame" => on_frame(hub, conn, id, message).await,
        "container" => on_container(hub, conn, id, message).await,
        "tnt" => on_tnt(hub, conn, id, message).await,
        "arrow" => on_arrow(hub, conn, id, message).await,
        "mob-hit" => on_mob_hit(hub, conn, id, message).await,
        "player-hit" => on_player_hit(hub, conn, id, message).await,
        "item-spawn" => on_item_spawn(hub, conn, id, message).await,
        "item-remove" => on_item_remove(hub, conn, id, message).await,
        "item-take" => on_item_take(hub, conn, id, message).await,
        "chat" => on_chat(hub, conn, id, message).await,
        "sleep" => on_sleep(hub, id).await,
        "ping" => {
            conn.send(&hub.traffic, &json!({"t": "pong"}));
        }
        "" => {}
        other => {
            conn.send_error(&hub.traffic, "unknown", &format!("未知消息类型 {other}"));
        }
    }
    true
}

// ---------------------------------------------------------------- join

async fn join(hub: &Arc<Hub>, conn: &mut Conn, message: &Map<String, Value>) -> Option<u64> {
    let version = message.get("v").and_then(number_of).unwrap_or(f64::NAN);
    if version != f64::from(PROTOCOL_VERSION) {
        let shown = match message.get("v") {
            Some(value) if !value.is_null() => text_of(Some(value)),
            _ => "未提供".to_string(),
        };
        conn.reject(
            &hub.traffic,
            "version",
            &format!("协议版本不匹配：服务端 {PROTOCOL_VERSION}，客户端 {shown}"),
            CLOSE_VERSION,
        );
        return None;
    }

    let client_id = message.get("clientId").and_then(Value::as_str).unwrap_or("");
    if !is_valid_client_id(client_id) {
        conn.reject(
            &hub.traffic,
            "clientId",
            "缺少合法的 clientId（8~64 位字母/数字/-/_）",
            CLOSE_CLIENT_ID,
        );
        return None;
    }

    let mut st = hub.state.lock().await;

    // 同一个 clientId 已经在线 → 拒绝（不等同"顶号"：没鉴权时那等于谁抄到 id 谁就能踢人）
    if st.players.values().any(|player| player.client_id == client_id) {
        drop(st);
        conn.reject(
            &hub.traffic,
            "duplicate",
            "这个 clientId 已经在线（同一个浏览器开了两个标签页？）",
            CLOSE_DUPLICATE,
        );
        return None;
    }

    // 断线重连：宽限期里的 clientId 认回原来的 id（队友眼里你不会"消失又出现"）
    let grace_id = st.graces.get(client_id).map(|grace| grace.id);

    let room = sanitize_room(message.get("room").and_then(Value::as_str));
    if !hub.password.is_empty() && message.get("password").and_then(Value::as_str).unwrap_or("") != hub.password {
        drop(st);
        conn.reject(&hub.traffic, "password", "房间密码不对", CLOSE_PASSWORD);
        return None;
    }

    // 一房一名房主：第二个带 host 的 join 直接拒（宽限期内重连的房主还是他本人）
    let wants_host = message.get("host").and_then(Value::as_bool) == Some(true);
    if wants_host {
        if let Some(&host_id) = st.hosts.get(&room) {
            if Some(host_id) != grace_id {
                drop(st);
                conn.reject(&hub.traffic, "host-taken", "这个房间已经有房主了", CLOSE_HOST_TAKEN);
                return None;
            }
        }
    }

    /*
     * 没有房主的房间不许进（用户 2026-10-27，与 Node 版同一口径）。
     *
     * 房间 = "房主开着世界"这一局：`hosts` 里没登记就是这一局不存在，进去只会看到一个
     * **不推进的世界**（方块能放、怪不动、红石不亮），而界面一切正常。
     * 房主在宽限期内断线同理——`hosts` 有登记，但人不在 `players` 里。
     */
    if !wants_host && !hub.allow_hostless_rooms {
        match st.hosts.get(&room).copied() {
            None => {
                drop(st);
                conn.reject(
                    &hub.traffic,
                    "no-host",
                    "这个房间还没有房主，先让房主开房再进",
                    CLOSE_NO_HOST,
                );
                return None;
            }
            Some(host_id) if !st.players.contains_key(&host_id) => {
                drop(st);
                conn.reject(
                    &hub.traffic,
                    "host-offline",
                    "房主暂时不在房间，等他回来再来",
                    CLOSE_HOST_OFFLINE,
                );
                return None;
            }
            Some(_) => {}
        }
    }

    let name = sanitize_name(message.get("name").and_then(Value::as_str));
    // 昵称唯一：房间进出提示、聊天、队伍、友伤全按昵称对号，两个"小明"会让它们全部含糊
    if st.players.values().any(|player| player.room == room && player.name == name) {
        drop(st);
        conn.reject(
            &hub.traffic,
            "duplicate-name",
            &format!("房间内已有同名玩家「{name}」，请改名后再加入"),
            CLOSE_DUPLICATE_NAME,
        );
        return None;
    }

    let id = match grace_id {
        Some(id) => {
            st.graces.remove(client_id);
            hub.log(&format!("{name}#{id} 宽限期内重连，复用 id"));
            id
        }
        None => st.alloc_id(),
    };

    let player = Player {
        id,
        name: name.clone(),
        client_id: client_id.to_string(),
        x: finite_number(message.get("x"), 0.0),
        y: finite_number(message.get("y"), 80.0),
        z: finite_number(message.get("z"), 0.0),
        yaw: 0.0,
        pitch: 0.0,
        dimension: sanitize_dimension(message.get("dimension").and_then(Value::as_str)).to_string(),
        room: room.clone(),
        is_host: wants_host,
        team: String::new(),
        appearance: Map::new(),
        tx: conn.tx.clone(),
    };
    let join_broadcast = player.base_wire();
    st.players.insert(id, player);

    if wants_host {
        st.hosts.insert(room.clone(), id);
        // 世界只由房主定：从属端带来的 `world` 一律不看；脏数据保留房间原有那份
        if let Some(meta) = sanitize_world_meta(message.get("world")) {
            hub.log(&format!(
                "房间 {room} 的世界：{} · 种子 {}",
                if meta.name.is_empty() { "(未命名)" } else { meta.name.as_str() },
                meta.seed
            ));
            st.worlds.insert(room.clone(), meta);
        }
    }

    let mut welcome = st.snapshot_for(id).unwrap_or_else(|| json!({}));
    if let Some(map) = welcome.as_object_mut() {
        map.insert("t".to_string(), Value::from("welcome"));
        map.insert("v".to_string(), Value::from(PROTOCOL_VERSION));
        map.insert("id".to_string(), Value::from(id));
        map.insert("name".to_string(), Value::from(name.clone()));
    }
    st.send_to(id, &welcome, &hub.traffic);

    let mut broadcast = join_broadcast;
    broadcast.insert("t".to_string(), Value::from("player"));
    /*
     * `isHost` 必须跟着 `player` 广播走（与 Node 版一致）：队友靠它把这一行标成
     * 「房主」，也是"谁是这一局跑模拟的人"在 UI 上的唯一来源——只在 `welcome` 里给
     * 进房的那个人是不够的。
     */
    broadcast.insert("isHost".to_string(), Value::Bool(wants_host));
    st.broadcast(&room, Some(id), &Value::Object(broadcast), None, &hub.traffic);

    let online = st.players.len();
    drop(st);
    hub.log(&format!(
        "{name}#{id} 加入房间 {room}{}，当前 {online} 人",
        if wants_host { "（房主）" } else { "" }
    ));
    // 入服立刻探一次活：不用等下一个 5s 心跳窗口，半开连接能早 5s 被发现
    conn.send_ping();
    Some(id)
}

// ---------------------------------------------------------------- move

async fn on_move(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let now = conn.now_ms();
    if now.saturating_sub(conn.last_move_ms) < MOVE_INTERVAL_MS {
        return;
    }
    conn.last_move_ms = now;
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get_mut(&id) else { return };
    player.x = finite_number(message.get("x"), player.x);
    player.y = finite_number(message.get("y"), player.y);
    player.z = finite_number(message.get("z"), player.z);
    player.yaw = finite_number(message.get("yaw"), player.yaw);
    player.pitch = finite_number(message.get("pitch"), player.pitch);
    player.dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player.dimension.as_str())),
    )
    .to_string();
    player.team = message.get("team").map(|value| text_of(Some(value))).unwrap_or_default();
    player.team = player.team.chars().take(32).collect();
    player.appearance = read_appearance(message);
    let wire = player.to_wire();
    let room = player.room.clone();
    let aoi = Aoi::new(player.x, player.z, player.dimension.as_str());
    // 房主标识要随**每条** `player` 广播走（用户 2026-10-25）：客户端只靠 `welcome.hostId`
    // 的话，房主中途换人后名字牌永远停在旧值。
    let is_host = player.is_host;
    let mut wire = wire;
    if let Some(map) = wire.as_object_mut() {
        map.insert("t".to_string(), Value::from("player"));
        map.insert("isHost".to_string(), Value::Bool(is_host));
    }
    st.broadcast(&room, Some(id), &wire, Some(&aoi), &hub.traffic);
}

// ---------------------------------------------------------------- 方块

/// 有房主的房里，从属端的坐标类消息一律丢（改动只能走 `edit-request`）。
fn follower_blocked(st: &State, id: u64) -> bool {
    match st.players.get(&id) {
        Some(player) => st.hosts.contains_key(&player.room) && !player.is_host,
        None => true,
    }
}

async fn on_block(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    if !conn.buckets.block.take(store::now_ms() as i64, 1) {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, is_host, player_xz, player_dimension) =
        (player.room.clone(), player.is_host, (player.x, player.z), player.dimension.clone());
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let (Some(x), Some(y), Some(z), Some(block_id)) = (
        message.get("x").and_then(int_of),
        message.get("y").and_then(int_of),
        message.get("z").and_then(int_of),
        message.get("id").and_then(int_of),
    ) else {
        return;
    };
    let state = message.get("state").and_then(int_of).unwrap_or(0);
    if block_edit_rejection(
        player_xz,
        is_host,
        x as i32,
        y as i32,
        z as i32,
        block_id as i32,
        state as i32,
    )
    .is_some()
    {
        return;
    }
    let edit = Edit { x, y, z, id: block_id, state, dimension: dimension.clone() };
    let key = scoped_key(&room, &dimension, x, y, z);
    st.edits.remember(key, edit, MAX_EDITS);
    let message = json!({
        "t": "block",
        "x": x, "y": y, "z": z, "id": block_id, "state": state,
        "dimension": dimension, "by": id,
        // 权威标记由服务端按 isHost 重标，不信客户端传上来的那个值
        "authority": is_host,
    });
    let aoi = Aoi::new(x as f64, z as f64, &dimension);
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_blocks(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    let list: Vec<Value> = message
        .get("blocks")
        .and_then(Value::as_array)
        .map(|list| list.iter().take(MAX_BLOCKS_PER_MESSAGE).cloned().collect())
        .unwrap_or_default();
    // 按**条数**计费：红石连锁一次几十格是正常的，持续每帧几百格不是
    if !conn.buckets.block.take(store::now_ms() as i64, list.len()) {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, is_host, player_xz, player_dimension) =
        (player.room.clone(), player.is_host, (player.x, player.z), player.dimension.clone());
    let mut accepted: Vec<Value> = Vec::new();
    for raw in &list {
        let Some(item) = raw.as_array() else { continue };
        if item.len() < 3 {
            continue;
        }
        let (Some(x), Some(y), Some(z), Some(block_id)) = (
            int_of(&item[0]),
            item.get(1).and_then(int_of),
            item.get(2).and_then(int_of),
            item.get(3).and_then(int_of),
        ) else {
            continue;
        };
        let state = item.get(4).and_then(int_of).unwrap_or(0);
        let dimension = sanitize_dimension(
            item.get(5).and_then(Value::as_str).or(Some(player_dimension.as_str())),
        );
        if block_edit_rejection(
            player_xz,
            is_host,
            x as i32,
            y as i32,
            z as i32,
            block_id as i32,
            state as i32,
        )
        .is_some()
        {
            continue;
        }
        let edit = Edit { x, y, z, id: block_id, state, dimension: dimension.to_string() };
        let key = scoped_key(&room, dimension, x, y, z);
        st.edits.remember(key, edit, MAX_EDITS);
        accepted.push(json!([x, y, z, block_id, state, dimension]));
    }
    if accepted.is_empty() {
        return;
    }
    let message = json!({"t": "blocks", "blocks": accepted, "by": id, "authority": is_host});
    st.broadcast(&room, Some(id), &message, None, &hub.traffic);
}

// ---------------------------------------------------------------- 实体

async fn on_entity_snap(hub: &Arc<Hub>, id: u64, message: &Map<String, Value>) {
    let st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    let Some(entities) = sanitize_entity_snap(message.get("entities")) else { return };
    if entities.is_empty() {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, aoi) = (player.room.clone(), Aoi::new(player.x, player.z, player.dimension.as_str()));
    let message = json!({"t": "entity-snap", "by": id, "entities": entities});
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_entity_remove(hub: &Arc<Hub>, id: u64, message: &Map<String, Value>) {
    let st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    let Some(keys) = sanitize_entity_keys(message.get("keys")) else { return };
    let Some(player) = st.players.get(&id) else { return };
    let room = player.room.clone();
    let message = json!({"t": "entity-remove", "keys": keys, "by": id});
    st.broadcast(&room, Some(id), &message, None, &hub.traffic);
}

// ---------------------------------------------------------------- 改动请求

async fn on_edit_request(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    // 借用方块令牌桶：一条请求一格，防止有人把房主刷爆
    if !conn.buckets.block.take(store::now_ms() as i64, 1) {
        return;
    }
    let st = hub.state.lock().await;
    let (room, _) = match st.players.get(&id) {
        Some(player) => (player.room.clone(), ()),
        None => return,
    };
    let host_id = match st.hosts.get(&room).copied() {
        Some(host_id) if st.players.contains_key(&host_id) => host_id,
        // 房里没房主（或房主刚掉线）：明确回执，别让从属端以为发出去了
        _ => {
            drop(st);
            conn.send(&hub.traffic, &json!({"t": "edit-request", "ok": false, "reason": "no-host"}));
            return;
        }
    };
    let Some(payload) = sanitize_edit_payload(message.get("payload")) else { return };
    st.send_to(host_id, &json!({"t": "edit-request", "from": id, "payload": payload}), &hub.traffic);
}

// ---------------------------------------------------------------- 房间配置

async fn on_room_config(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    if !player.is_host {
        drop(st);
        conn.send_error(&hub.traffic, "not-host", "只有房主能修改房间设置");
        return;
    }
    let room = player.room.clone();
    if let Some(time_of_day) = message.get("timeOfDay").and_then(number_of) {
        if time_of_day.is_finite() {
            st.start_time_of_day = ((time_of_day % 1.0) + 1.0) % 1.0;
            st.day_start_ms = store::now_ms() as f64;
            let value = st.current_time_of_day();
            st.broadcast(&room, None, &json!({"t": "time", "timeOfDay": value, "snap": true}), None, &hub.traffic);
        }
    }
    if let Some(kind) = message.get("weather").and_then(Value::as_str) {
        if is_weather_kind(kind) {
            st.weather = crate::state::Weather { kind: kind.to_string(), left: crate::state::next_weather_seconds(kind) };
            st.broadcast(&room, None, &json!({"t": "weather", "kind": kind}), None, &hub.traffic);
            hub.log(&format!("房主把天气改成 {kind}（房间 {room}）"));
        }
    }
}

// ---------------------------------------------------------------- 牌子 / 展示框 / 容器 / TNT

async fn on_sign(hub: &Arc<Hub>, _conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, player_dimension) = (player.room.clone(), player.dimension.clone());
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let (Some(x), Some(y), Some(z)) = (
        message.get("x").and_then(int_of),
        message.get("y").and_then(int_of),
        message.get("z").and_then(int_of),
    ) else {
        return;
    };
    // 牌子最多 4 行、每行截到 64 个字符（多一行，客户端渲染与存档都会多出一行）
    let lines: Vec<String> = message
        .get("lines")
        .and_then(Value::as_array)
        .map(|lines| {
            lines
                .iter()
                .take(4)
                .map(|line| text_of(Some(line)).chars().take(64).collect())
                .collect()
        })
        .unwrap_or_default();
    let sign = Sign { x, y, z, dimension: dimension.clone(), lines: lines.clone() };
    let key = scoped_key(&room, &dimension, x, y, z);
    if st.signs.len() < MAX_SIGNS {
        st.signs.insert(key, sign);
    }
    let message = json!({
        "t": "sign", "x": x, "y": y, "z": z, "dimension": dimension,
        "lines": lines, "by": id,
    });
    let aoi = Aoi::new(x as f64, z as f64, &dimension);
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_frame(hub: &Arc<Hub>, _conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, player_dimension) = (player.room.clone(), player.dimension.clone());
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let (Some(x), Some(y), Some(z)) = (
        message.get("x").and_then(int_of),
        message.get("y").and_then(int_of),
        message.get("z").and_then(int_of),
    ) else {
        return;
    };
    // `item = null` 是"空框"，不是少一个字段
    let item = match message.get("item") {
        Some(Value::Object(obj)) => {
            let (Some(item_id), Some(count)) = (
                obj.get("id").and_then(int_of),
                obj.get("count").and_then(int_of),
            ) else {
                return;
            };
            json!({"id": item_id, "count": count})
        }
        _ => Value::Null,
    };
    let rotation = message.get("rotation").and_then(int_of).unwrap_or(0);
    let frame = Frame {
        x,
        y,
        z,
        dimension: dimension.clone(),
        item: item.clone(),
        rotation,
    };
    let key = scoped_key(&room, &dimension, x, y, z);
    if st.frames.len() < MAX_FRAMES {
        st.frames.insert(key, frame);
    }
    let message = json!({
        "t": "frame", "x": x, "y": y, "z": z, "dimension": dimension,
        "item": item, "rotation": rotation, "by": id,
    });
    let aoi = Aoi::new(x as f64, z as f64, &dimension);
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_container(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    if !conn.buckets.container.take(store::now_ms() as i64, 1) {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, is_host, player_xz, player_dimension) =
        (player.room.clone(), player.is_host, (player.x, player.z), player.dimension.clone());
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let (Some(x), Some(y), Some(z)) = (
        message.get("x").and_then(int_of),
        message.get("y").and_then(int_of),
        message.get("z").and_then(int_of),
    ) else {
        return;
    };
    let Some(slots) = message.get("slots").and_then(Value::as_array) else { return };
    if slots.len() > 27 {
        return;
    }
    if serde_json::to_string(&Value::Array(slots.clone())).map(|text| text.len()).unwrap_or(usize::MAX) > 8192 {
        return;
    }
    // 容器也要卡 y 范围与距离（只卡形状的话，隔空改主城的箱子照样收）
    if y < i64::from(WORLD_MIN_Y) || y >= i64::from(WORLD_MAX_Y) {
        return;
    }
    if !within_edit_reach(player_xz, x as i32, z as i32) {
        return;
    }
    // 进度只有房主的是真的（别人推进不了计时），越界夹到 [0,1]
    let progress = if is_host {
        message.get("progress").and_then(number_of).filter(|n| n.is_finite()).map(|n| n.clamp(0.0, 1.0))
    } else {
        None
    };
    let container = Container {
        x,
        y,
        z,
        dimension: dimension.clone(),
        slots: Value::Array(slots.clone()),
    };
    let key = scoped_key(&room, &dimension, x, y, z);
    if st.containers.len() < MAX_CONTAINERS {
        st.containers.insert(key, container);
    }
    let mut outgoing = json!({
        "t": "container", "dimension": dimension, "x": x, "y": y, "z": z,
        "slots": slots, "by": id,
    });
    if let (Some(progress), Some(map)) = (progress, outgoing.as_object_mut()) {
        map.insert("progress".to_string(), Value::from(progress));
    }
    let aoi = Aoi::new(x as f64, z as f64, &dimension);
    st.broadcast(&room, Some(id), &outgoing, Some(&aoi), &hub.traffic);
}

async fn on_tnt(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let st = hub.state.lock().await;
    if follower_blocked(&st, id) {
        return;
    }
    if !conn.effect_window.allow(store::now_ms() as i64, 30) {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, player_dimension) = (player.room.clone(), player.dimension.clone());
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let (Some(x), Some(y), Some(z)) = (
        message.get("x").and_then(int_of),
        message.get("y").and_then(int_of),
        message.get("z").and_then(int_of),
    ) else {
        return;
    };
    let message = json!({"t": "tnt", "x": x, "y": y, "z": z, "dimension": dimension, "by": id});
    let aoi = Aoi::new(x as f64, z as f64, &dimension);
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_arrow(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    if !conn.effect_window.allow(store::now_ms() as i64, 30) {
        return;
    }
    let st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    let (room, player_dimension) = (player.room.clone(), player.dimension.clone());
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let (Some(x), Some(y), Some(z), Some(vx), Some(vy), Some(vz)) = (
        message.get("x").and_then(number_of),
        message.get("y").and_then(number_of),
        message.get("z").and_then(number_of),
        message.get("vx").and_then(number_of),
        message.get("vy").and_then(number_of),
        message.get("vz").and_then(number_of),
    ) else {
        return;
    };
    if ![x, y, z, vx, vy, vz].iter().all(|value| value.is_finite()) {
        return;
    }
    // 一支箭不该每秒飞几百格：速度与伤害都夹住
    if vx.hypot(vy).hypot(vz) > 200.0 {
        return;
    }
    let damage = message.get("damage").and_then(number_of).unwrap_or(0.0).clamp(0.0, 50.0);
    let message = json!({
        "t": "arrow", "x": x, "y": y, "z": z, "vx": vx, "vy": vy, "vz": vz,
        "damage": damage, "by": id,
    });
    let aoi = Aoi::new(x, z, &dimension);
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

// ---------------------------------------------------------------- 命中

async fn on_mob_hit(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    if !conn.hit_window.allow(store::now_ms() as i64, 30) {
        return;
    }
    let st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    let (room, player_dimension) = (player.room.clone(), player.dimension.clone());
    let type_id: String = message
        .get("typeId")
        .map(|value| text_of(Some(value)))
        .unwrap_or_default()
        .chars()
        .take(32)
        .collect();
    if type_id.is_empty() {
        return;
    }
    let (Some(x), Some(y), Some(z)) = (
        message.get("x").and_then(number_of),
        message.get("y").and_then(number_of),
        message.get("z").and_then(number_of),
    ) else {
        return;
    };
    // 伤害与着火时长夹到合理区间：一个人不该能一发打死 100 血的怪
    let damage = message.get("damage").and_then(number_of).unwrap_or(0.0).clamp(0.0, 50.0);
    let fire = message.get("fire").and_then(number_of).unwrap_or(0.0).clamp(0.0, 16.0);
    if ![x, y, z, damage, fire].iter().all(|value| value.is_finite()) {
        return;
    }
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    // 全局键：只做长度收口；不带就**不塞空 key**（老客户端兼容）
    let key: Option<String> = message
        .get("key")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .map(|key| key.chars().take(32).collect());
    let mut outgoing = json!({
        "t": "mob-hit", "typeId": type_id, "dimension": dimension,
        "x": x, "y": y, "z": z, "damage": damage, "fire": fire, "by": id,
    });
    if let (Some(key), Some(map)) = (key, outgoing.as_object_mut()) {
        map.insert("key".to_string(), Value::from(key));
    }
    let aoi = Aoi::new(x, z, &dimension);
    st.broadcast(&room, Some(id), &outgoing, Some(&aoi), &hub.traffic);
}

async fn on_player_hit(hub: &Arc<Hub>, _conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let st = hub.state.lock().await;
    let Some(target_id) = message.get("targetId").and_then(int_of) else { return };
    if target_id <= 0 || target_id as u64 == id {
        return;
    }
    let damage = message.get("damage").and_then(number_of).unwrap_or(0.0).clamp(0.0, 50.0);
    if !damage.is_finite() || damage <= 0.0 {
        return;
    }
    let Some(attacker) = st.players.get(&id) else { return };
    let (name, room) = (attacker.name.clone(), attacker.room.clone());
    let Some(target) = st.players.get(&(target_id as u64)) else { return };
    if target.room != room {
        return;
    }
    let team: String = message
        .get("team")
        .map(|value| text_of(Some(value)))
        .unwrap_or_default()
        .chars()
        .take(32)
        .collect();
    st.send_to(
        target_id as u64,
        &json!({
            "t": "player-hit", "fromId": id, "fromName": name,
            "fromTeam": team, "damage": damage,
        }),
        &hub.traffic,
    );
}

// ---------------------------------------------------------------- 掉落物

async fn on_item_spawn(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    if !conn.item_window.allow(store::now_ms() as i64, 30) {
        return;
    }
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    let (room, player_dimension) = (player.room.clone(), player.dimension.clone());
    let (Some(local_id), Some(item_id), Some(count)) = (
        message.get("localId").and_then(int_of),
        message.get("itemId").and_then(int_of),
        message.get("count").and_then(int_of),
    ) else {
        return;
    };
    let (Some(x), Some(y), Some(z)) = (
        message.get("x").and_then(number_of),
        message.get("y").and_then(number_of),
        message.get("z").and_then(number_of),
    ) else {
        return;
    };
    // 一条脏数据就能让所有人的镜像里多出一堆不存在的货：数量与坐标都要卡
    if local_id <= 0 || item_id <= 0 || count <= 0 || count > 64 {
        return;
    }
    if x.abs() > 3e7 || z.abs() > 3e7 || !(-2000.0..=2000.0).contains(&y) {
        return;
    }
    let dimension = sanitize_dimension(
        message.get("dimension").and_then(Value::as_str).or(Some(player_dimension.as_str())),
    )
    .to_string();
    let key = item_key(id, local_id);
    if st.items.len() >= MAX_ITEMS && !st.items.contains_key(&key) {
        return;
    }
    st.items.insert(
        key,
        Item { owner: id, local_id, item_id, count, x, y, z, dimension: dimension.clone() },
    );
    let message = json!({
        "t": "item-spawn", "owner": id, "localId": local_id, "itemId": item_id,
        "count": count, "x": x, "y": y, "z": z, "dimension": dimension,
    });
    let aoi = Aoi::new(x, z, &dimension);
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_item_remove(hub: &Arc<Hub>, _conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    let Some(local_id) = message.get("localId").and_then(int_of) else { return };
    if local_id <= 0 {
        return;
    }
    // owner 由服务端填：删别人的掉落物在协议层就不成立
    let key = item_key(id, local_id);
    if st.items.remove(&key).is_none() {
        return;
    }
    let Some(player) = st.players.get(&id) else { return };
    let (room, aoi) = (player.room.clone(), Aoi::new(player.x, player.z, player.dimension.as_str()));
    let message = json!({"t": "item-remove", "owner": id, "localId": local_id});
    st.broadcast(&room, Some(id), &message, Some(&aoi), &hub.traffic);
}

async fn on_item_take(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    if !conn.take_window.allow(store::now_ms() as i64, 20) {
        return;
    }
    let mut st = hub.state.lock().await;
    let (Some(owner), Some(local_id)) = (
        message.get("owner").and_then(int_of),
        message.get("localId").and_then(int_of),
    ) else {
        return;
    };
    if owner <= 0 || local_id <= 0 {
        return;
    }
    let owner_id = owner as u64;
    let Some(player) = st.players.get(&id) else { return };
    let room = player.room.clone();
    // 跨房不给偷：owner 必须和我在同一个房间
    let owner_in_room = st.players.get(&owner_id).is_some_and(|other| other.room == room);
    let key = item_key(owner_id, local_id);
    let item = if owner_in_room { st.items.get(&key).cloned() } else { None };
    let Some(item) = item else {
        drop(st);
        conn.send(
            &hub.traffic,
            &json!({"t": "item-take", "ok": false, "owner": owner, "localId": local_id, "reason": "gone"}),
        );
        return;
    };
    // 查还在 → 删 → 回 ok 是原子的（tokio 单锁，天然满足）
    st.items.remove(&key);
    let reply = json!({
        "t": "item-take", "ok": true, "owner": owner, "localId": local_id,
        "itemId": item.item_id, "count": item.count,
    });
    st.send_to(id, &reply, &hub.traffic);
    // 所有人（含请求者）都删镜像
    st.broadcast(
        &room,
        None,
        &json!({"t": "item-remove", "owner": owner, "localId": local_id}),
        None,
        &hub.traffic,
    );
}

// ---------------------------------------------------------------- 聊天 / 睡眠

async fn on_chat(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    // 每人每秒 5 条；超了静默丢（回一条错误反而会被刷屏者利用）
    if !conn.buckets.chat.take(store::now_ms() as i64, 1) {
        return;
    }
    let text: String = text_of(message.get("text")).chars().take(200).collect();
    if text.is_empty() {
        return;
    }
    let st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    let (room, name) = (player.room.clone(), player.name.clone());
    // 不回给发送者：客户端已经本地回显过一次，再回传就是同一条消息出现两次
    let message = json!({"t": "chat", "id": id, "name": name, "text": text});
    st.broadcast(&room, Some(id), &message, None, &hub.traffic);
    drop(st);
    hub.log(&format!("<{name}> {text}"));
}

/// 睡满跳夜：本项口径是"任一玩家睡满即跳夜"（基岩版要全员睡，差异记在差异台账）。
async fn on_sleep(hub: &Arc<Hub>, id: u64) {
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    let name = player.name.clone();
    let rooms: Vec<String> = {
        let mut rooms = st.rooms_in_use();
        rooms.dedup();
        rooms
    };
    st.start_time_of_day = DAWN_TIME_OF_DAY;
    st.day_start_ms = store::now_ms() as f64;
    let time = st.current_time_of_day();
    for room in rooms {
        st.broadcast(&room, None, &json!({"t": "time", "timeOfDay": time, "snap": true}), None, &hub.traffic);
    }
    drop(st);
    hub.log(&format!("{name}#{id} 睡满，时间跳到黎明"));
}

// ---------------------------------------------------------------- 连接关闭

/// 连接断开：移出玩家表 → 房主提示 → 起宽限计时（到期才广播 leave / 清掉落物 / 让出房主位）。
pub async fn on_close(hub: &Arc<Hub>, conn: &mut Conn) {
    let Some(id) = conn.id.take() else { return };
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.remove(&id) else { return };
    let (client_id, room, name) = (player.client_id.clone(), player.room.clone(), player.name.clone());

    // 房主掉线：立刻告诉同房其他人，别让他们对着一个没人模拟的世界发呆（重连回来还是同一局）
    if st.hosts.get(&room).copied() == Some(id) {
        st.broadcast(
            &room,
            Some(id),
            &json!({"t": "room-closed", "reason": "host-left", "graceMs": hub.grace_ms}),
            None,
            &hub.traffic,
        );
        hub.log(&format!("房主 {name}#{id} 掉线，已通知房间 {room}"));
    }
    let seq = st.next_grace_seq;
    st.next_grace_seq += 1;
    st.graces.insert(client_id.clone(), crate::state::Grace { id, seq });
    drop(st);
    hub.log(&format!(
        "{name}#{id} 断线（{}ms 内重连可复用 id）",
        hub.grace_ms
    ));

    let hub = hub.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(hub.grace_ms)).await;
        let mut st = hub.state.lock().await;
        // 宽限期内重连过（或又断了一次、换了代次）：什么都不做
        let expected = crate::state::Grace { id, seq };
        if st.graces.get(&client_id).copied() != Some(expected) {
            return;
        }
        st.graces.remove(&client_id);
        st.broadcast(&room, None, &json!({"t": "leave", "id": id}), None, &hub.traffic);
        // 他名下的掉落物再没人有权删了，一并清掉
        let victims: Vec<String> = st
            .items
            .iter()
            .filter(|(_, item)| item.owner == id)
            .map(|(key, _)| key.clone())
            .collect();
        for key in victims {
            if let Some(item) = st.items.remove(&key) {
                st.broadcast(
                    &room,
                    None,
                    &json!({"t": "item-remove", "owner": item.owner, "localId": item.local_id}),
                    None,
                    &hub.traffic,
                );
            }
        }
        // 房主位宽限到期 = 这一局没人模拟了：让出房主位并关房（不关房会留下"看起来还能玩"的坏状态）
        if st.hosts.get(&room).copied() == Some(id) {
            st.hosts.remove(&room);
            let others: Vec<Tx> = st
                .players
                .values()
                .filter(|player| player.room == room)
                .map(|player| player.tx.clone())
                .collect();
            for tx in others {
                let _ = tx.send(text_message(&json!({
                    "t": "error", "code": "host-left", "message": "房主已退出，房间已关闭",
                })));
                let _ = tx.send(Message::Close(Some(CloseFrame {
                    code: CloseCode::Library(CLOSE_HOST_LEFT),
                    reason: "host-left".into(),
                })));
            }
            hub.log(&format!("房间 {room} 已关闭（房主 {name}#{id} 宽限期结束未回来）"));
        }
        hub.log(&format!("{name}#{id} 宽限期结束，已移出房间"));
    });
}
