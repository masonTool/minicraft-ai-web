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
const KNOWN_KINDS: [&str; 25] = [
    // 房主回某个区块的整块增量（用户 2026-10-26）
    "edits-reply",
    // 房主开局把容器/牌子/展示框整份推上来（用户 2026-10-26）
    "session-sync",
    // 主动退出（用户 2026-10-26）：房主 bye = 当场关房，其他人 bye = 当场广播 leave
    "bye",
    // 房主替野怪"咬"某个队友（用户 2026-10-26）：只转给被打的那一个人
    "mob-attack",
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
        "mob-attack" => on_mob_attack(hub, conn, id, message).await,
        "session-sync" => on_session_sync(hub, id, message).await,
        "edits-reply" => on_edits_reply(hub, id, message).await,
        "player-hit" => on_player_hit(hub, conn, id, message).await,
        "item-spawn" => on_item_spawn(hub, conn, id, message).await,
        "item-remove" => on_item_remove(hub, conn, id, message).await,
        "item-take" => on_item_take(hub, conn, id, message).await,
        "chat" => on_chat(hub, conn, id, message).await,
        "sleep" => on_sleep(hub, id).await,
        "ping" => {
            conn.send(&hub.traffic, &json!({"t": "pong"}));
        }
        "bye" => {
            on_bye(hub, id).await;
            // 主动退出 = 立刻断开，不走宽限期（否则队友要等 30 秒才看到他"离开"）
            return false;
        }
        "" => {}
        other => {
            conn.send_error(&hub.traffic, "unknown", &format!("未知消息类型 {other}"));
        }
    }
    true
}

/// 主动退出（`bye`，用户 2026-10-26）：**不等宽限期**。
///
/// 与"掉线"的区别只有一个：主动退出是玩家说"我不玩了"，没有留 30 秒重连窗口的必要。
///  - 房主：这一局直接结束——清掉房间缓存、把同房的人踢掉（`host-left`），自己也不进宽限期；
///  - 其他人：广播一条 `leave` 让别人当场看到他走。
///
/// 收尾不再依赖 `on_close`：这里已经把玩家从 `players` 里移走，`on_close` 拿不到人，
/// 不会再登记宽限期、也不会再广播第二条"离开"。
async fn on_bye(hub: &Arc<Hub>, id: u64) {
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    let room = player.room.clone();
    let is_host = player.is_host;
    let name = player.name.clone();

    if is_host {
        st.clear_room(&room);
        let others: Vec<Tx> = st
            .players
            .values()
            .filter(|other| other.room == room && other.id != id)
            .map(|other| other.tx.clone())
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
        st.players.remove(&id);
        drop(st);
        hub.log(&format!("{name}#{id} 主动退出（房主），房间 {room} 已关闭"));
        return;
    }

    st.broadcast(&room, Some(id), &json!({"t": "leave", "id": id}), None, &hub.traffic);
    st.players.remove(&id);
    drop(st);
    hub.log(&format!("{name}#{id} 主动离开（不等宽限期）"));
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
    if !wants_host {
        match st.hosts.get(&room).copied() {
            // `no-host` 受测试开关保护（单人用例不建房主），`host-offline` 不受——
            // 那是产品行为，测试自己会建好房主再验
            None if !hub.allow_hostless_rooms => {
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
            // 没房主但测试开关放开（单人用例）：照旧放行
            None | Some(_) => {}
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
        sync_messages: 0,
        sent_edit_chunks: std::collections::HashSet::new(),
        tx: conn.tx.clone(),
    };
    let join_broadcast = player.base_wire();
    st.players.insert(id, player);

    if wants_host {
        /*
         * 新房主上位 = **新的一局**（用户 2026-10-26）：上一局的方块/容器/牌子/展示框/
         * 掉落物/世界元数据全部清掉，数据由房主随后用 `session-sync` 上行。
         * 唯一例外是**宽限期内重连的房主本人**（`grace_id` 就是 hosts 里那个 id）——
         * 那一局还在继续，清了等于把他自己的世界删了。
         */
        if grace_id.is_none() {
            st.clear_room(&room);
        }
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
        /*
         * 时间 / 天数 / 天气：**开房时以房主本地为准，而且只影响这一个房间**
         * （用户 2026-10-25 起，2026-10-26 扩到三者 + 每房一套）。
         *
         * 房主退出后在本地继续玩，时间和天气都在他存档里走；重开房时若服务端还按自己
         * 那套时钟，房主一进来就会被拽到"服务端此刻"——界面上一句话都没有，但那不是
         * 他的世界了。宽限期内重连的房主不覆盖（那一局还在继续）。
         */
        if grace_id.is_none() {
            let host_day = message.get("day").and_then(int_of);
            let host_time = message.get("timeOfDay").and_then(number_of);
            let host_weather = message
                .get("weather")
                .and_then(Value::as_str)
                .filter(|kind| is_weather_kind(kind))
                .map(|kind| kind.to_string());
            let (time, day, kind) = {
                let clock = st.clock_mut(&room);
                if let Some(day) = host_day {
                    if day >= 0 {
                        clock.start_day = day;
                    }
                }
                if let Some(time) = host_time {
                    if time.is_finite() {
                        clock.start_time_of_day = ((time % 1.0) + 1.0) % 1.0;
                    }
                }
                if let Some(kind) = host_weather {
                    clock.weather = crate::state::Weather {
                        kind: kind.clone(),
                        left: crate::state::next_weather_seconds(&kind),
                    };
                }
                // 顺序：先定天数与时刻，最后才重置起点——反了会凭空多算一天
                clock.start_ms = store::now_ms() as f64;
                (clock.time_of_day(), clock.day(), clock.weather.kind.clone())
            };
            st.broadcast(
                &room,
                None,
                &json!({"t": "time", "timeOfDay": time, "day": day, "snap": true}),
                None,
                &hub.traffic,
            );
            st.broadcast(&room, None, &json!({"t": "weather", "kind": kind}), None, &hub.traffic);
            hub.log(&format!("房间 {room} 采用房主的时间：第 {day} 天 {time:.2} · 天气 {kind}"));
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
    /*
     * **合并**而不是整份覆盖（用户 2026-10-26 修的闪烁 bug）：客户端只在皮肤变化 / 每 2 秒
     * 才带 `look`，其余 99% 的 `move` 不带外观字段。以前直接覆盖，于是那些 `move` 会把皮肤
     * 清空 → 对端回退成"按昵称派生" → 2 秒后又被纠正回来，表现为每隔几秒闪一次。
     */
    for (key, value) in read_appearance(message) {
        player.appearance.insert(key, value);
    }
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

    /*
     * 按视野补发（用户 2026-10-26）：走进一个还没推过的区块 →
     * 已确认的直接推缓存，没确认的向房主要（`edits-request`）。
     * 放在广播之后：补发可能一次发几百条，别让它挡在"队友看到我动了"前面。
     */
    push_chunk_for_player(&mut st, hub, id);
}

/// 同时在飞的区块请求上限：队友传送到几万格外时会跨越上千个区块，
/// 不设上限等于让房主手机一次性收几百条请求。
const MAX_INFLIGHT_REQUESTS: usize = 8;
/// 一条 `blocks` 最多带多少格（与 Node 的 `CHUNK_EDITS_BATCH` 相同）
const CHUNK_EDITS_BATCH: usize = 2048;

/// 走进新区块时补发那块的历史方块（懒上行）。
///
/// 服务端不再"自己攒"世界，缓存里的东西全部来自房主：
///  - 这一块**已确认**（房主给过整块）→ 直接推缓存；
///  - 还没确认 → 向房主要（`edits-request`），房主回 `edits-reply`，服务端再按房广播；
///  - **没有房主的房**没有权威可问，退回老行为（服务端缓存就是大家共用的那份）。
///
/// `sent_edit_chunks` 只在**真的推了**之后才记：回包丢了下一次 move 会重试
/// （`requested_chunks` 挡的是"同一块被连点"，不是"永久只问一次"）。
fn push_chunk_for_player(st: &mut State, hub: &Arc<Hub>, id: u64) {
    let Some(player) = st.players.get(&id) else { return };
    if player.is_host {
        return;
    }
    let cx = (player.x.floor() as i64) >> 4;
    let cz = (player.z.floor() as i64) >> 4;
    let dimension = player.dimension.clone();
    let room = player.room.clone();
    let key = format!("{dimension}|{cx},{cz}");
    if player.sent_edit_chunks.contains(&key) {
        return;
    }
    let host_id = st.hosts.get(&room).copied();
    let confirmed = host_id.is_none()
        || st.confirmed_chunks.get(&room).map(|set| set.contains(&key)).unwrap_or(false);

    if !confirmed {
        let Some(host_id) = host_id else { return };
        let Some(host) = st.players.get(&host_id) else { return };
        let host_tx = host.tx.clone();
        let requested = st.requested_chunks.entry(room.clone()).or_default();
        if requested.contains(&key) || requested.len() >= MAX_INFLIGHT_REQUESTS {
            return;
        }
        requested.insert(key.clone());
        let _ = host_tx.send(text_message(&json!({
            "t": "edits-request", "dimension": dimension, "cx": cx, "cz": cz,
        })));
        /*
         * 回包丢了不能永远卡在"在飞"：5 秒后忘掉这次请求，玩家下一次 move 会重试。
         * 不用"回包才算数"是因为房主可能刚好在切维度/卡顿，卡住的代价是队友永远缺一块。
         */
        let hub = hub.clone();
        let room = room.clone();
        let key = key.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5000)).await;
            let mut guard = hub.state.lock().await;
            if let Some(set) = guard.requested_chunks.get_mut(&room) {
                set.remove(&key);
            }
        });
        return;
    }

    // 已确认（或无房主）：把缓存里这一块整块推给他
    let prefix = format!("{room}|");
    let found: Vec<Value> = st
        .edits
        .iter()
        .filter(|(stored, edit)| {
            stored.starts_with(&prefix)
                && edit.dimension == dimension
                && (edit.x >> 4) == cx
                && (edit.z >> 4) == cz
        })
        .map(|(_, edit)| json!([edit.x, edit.y, edit.z, edit.id, edit.state, edit.dimension]))
        .collect();
    if let Some(player) = st.players.get_mut(&id) {
        // 只保留最近 4096 个键，防止长跑把集合撑大（走回头路会重推一次，无害）
        if player.sent_edit_chunks.len() > 4096 {
            player.sent_edit_chunks.clear();
        }
        player.sent_edit_chunks.insert(key);
    }
    for chunk in found.chunks(CHUNK_EDITS_BATCH) {
        st.send_to(
            id,
            &json!({"t": "blocks", "blocks": chunk, "authority": true}),
            &hub.traffic,
        );
    }
}

/// 房主回某个区块的整块增量（`edits-reply`，用户 2026-10-26）。
///
/// 校验三件事：**只有本房房主能回**、坐标必须落在信封声明的那个区块里（防止一次回包
/// 把远处的东西写进缓存）、每条过一遍与单格 `block` 相同的收口。收下之后记入
/// `confirmed_chunks`（后来者直接推缓存）并按房广播成普通 `blocks`。
async fn on_edits_reply(hub: &Arc<Hub>, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    if st.hosts.get(&player.room).copied() != Some(id) {
        return;
    }
    let room = player.room.clone();
    let player_xz = (player.x, player.z);
    let dimension = sanitize_dimension(message.get("dimension").and_then(Value::as_str)).to_string();
    let (Some(cx), Some(cz)) =
        (message.get("cx").and_then(int_of), message.get("cz").and_then(int_of))
    else {
        return;
    };
    let key = format!("{dimension}|{cx},{cz}");
    let list = message.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut accepted: Vec<Value> = Vec::new();

    for raw in list.iter().take(MAX_BLOCKS_PER_MESSAGE) {
        let Some(entry) = raw.as_array() else { continue };
        if entry.len() < 4 {
            continue;
        }
        let (Some(x), Some(y), Some(z), Some(block_id)) = (
            entry[0].as_i64(),
            entry[1].as_i64(),
            entry[2].as_i64(),
            entry[3].as_i64(),
        ) else {
            continue;
        };
        let block_state = entry.get(4).and_then(Value::as_i64).unwrap_or(0);
        // 维度以信封为准：一条回包只属于一个区块
        if (x >> 4) != cx || (z >> 4) != cz {
            continue;
        }
        if block_edit_rejection(
            player_xz,
            true,
            x as i32,
            y as i32,
            z as i32,
            block_id as i32,
            block_state as i32,
        )
        .is_some()
        {
            continue;
        }
        let edit = Edit {
            x,
            y,
            z,
            id: block_id,
            state: block_state,
            dimension: dimension.clone(),
        };
        st.edits.remember(scoped_key(&room, &dimension, x, y, z), edit, MAX_EDITS);
        accepted.push(json!([x, y, z, block_id, block_state, dimension]));
    }

    if let Some(set) = st.confirmed_chunks.get_mut(&room) {
        set.insert(key.clone());
    } else {
        let mut set = std::collections::HashSet::new();
        set.insert(key.clone());
        st.confirmed_chunks.insert(room.clone(), set);
    }
    if let Some(set) = st.requested_chunks.get_mut(&room) {
        set.remove(&key);
    }
    if !accepted.is_empty() {
        st.broadcast(
            &room,
            Some(id),
            &json!({"t": "blocks", "blocks": accepted, "authority": true}),
            None,
            &hub.traffic,
        );
    }
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
    let (room, name) = (player.room.clone(), player.name.clone());
    /*
     * 只改**本房**（用户 2026-10-26：每房一套时钟 / 一份模式）。
     * `applied` 累积"这次真的改了什么"，最后广播一条 `room-config` 通知给**全房**
     * （含房主自己——他也要在聊天区看到那一行），时间/天气另有 `time`/`weather` 权威消息。
     */
    let mut applied = Map::new();

    if let Some(time_of_day) = message.get("timeOfDay").and_then(number_of) {
        if time_of_day.is_finite() {
            let (time, day) = {
                let clock = st.clock_mut(&room);
                // 换起点前先把"今天"结算掉：否则改时间会被当成"这一天重新开始"，天数倒退
                clock.start_day = clock.day();
                clock.start_time_of_day = ((time_of_day % 1.0) + 1.0) % 1.0;
                clock.start_ms = store::now_ms() as f64;
                (clock.time_of_day(), clock.day())
            };
            st.broadcast(
                &room,
                None,
                &json!({"t": "time", "timeOfDay": time, "day": day, "snap": true}),
                None,
                &hub.traffic,
            );
            applied.insert("timeOfDay".to_string(), Value::from(time));
        }
    }
    if let Some(kind) = message.get("weather").and_then(Value::as_str) {
        if is_weather_kind(kind) {
            {
                let clock = st.clock_mut(&room);
                clock.weather = crate::state::Weather {
                    kind: kind.to_string(),
                    left: crate::state::next_weather_seconds(kind),
                };
            }
            st.broadcast(&room, None, &json!({"t": "weather", "kind": kind}), None, &hub.traffic);
            applied.insert("weather".to_string(), Value::from(kind));
            hub.log(&format!("房主把天气改成 {kind}（房间 {room}）"));
        }
    }
    // 游戏模式（用户 2026-10-26）：房主改完，房里所有人跟着变；晚进来的从 welcome 拿当前值
    if let Some(mode) = message.get("gameMode").and_then(Value::as_str) {
        if crate::protocol::GAME_MODES.contains(&mode) {
            st.room_game_modes.insert(room.clone(), mode.to_string());
            applied.insert("gameMode".to_string(), Value::from(mode));
        }
    }

    if !applied.is_empty() {
        applied.insert("t".to_string(), Value::from("room-config"));
        applied.insert("by".to_string(), Value::from(name));
        st.broadcast(&room, None, &Value::Object(applied), None, &hub.traffic);
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

/// 房主那边的野怪打中了某个队友（`mob-attack`，用户 2026-10-26）。
///
/// 从属端不跑生物 AI（`SimMode`），所以"被野怪咬了一口"只能由房主判定后发过来。
/// 服务端只做两件事：**只转给被打的那一个人**（伤害是私事，不广播）+ 形状收口；
/// 真正的扣血在接收方本地走 `damagePlayer`（护甲/无敌帧/难度倍率按他那边的算）。
/// 一条 `session-sync` 最多带多少条（与客户端 `SESSION_SYNC_BATCH` 对齐）
const SESSION_SYNC_BATCH: usize = 200;
/// 一条连接最多发多少条 `session-sync`：一次整份推最多几十条，这个上限只挡脚本
const SESSION_SYNC_MAX_MESSAGES: u32 = 256;

/// 房主开局把容器 / 牌子 / 展示框**整份**推上来（`session-sync`，用户 2026-10-26）。
///
/// 服务端清场之后这三张表是空的，而队友 `welcome` 里的箱子内容只能来自房主——
/// 方块可以按区块懒补，箱子不行（打开看到空的就会往里放东西，然后被覆盖）。
///
/// 与单条 `container`/`sign`/`frame` 的区别：
///  - **不走令牌桶**（一次性整份推，走限频会被砍掉大半）；
///  - **不做距离闸**（房主推的是整个世界，不能只收他脚下那几个）；
///  - 只收本房房主（别人推来的"世界散件"没有权威性）。
async fn on_session_sync(hub: &Arc<Hub>, id: u64, message: &Map<String, Value>) {
    let mut st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    if st.hosts.get(&player.room).copied() != Some(id) {
        return;
    }
    let room = player.room.clone();
    let default_dimension = player.dimension.clone();
    if let Some(player) = st.players.get_mut(&id) {
        if player.sync_messages >= SESSION_SYNC_MAX_MESSAGES {
            return;
        }
        player.sync_messages += 1;
    }

    let kind = message.get("kind").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "container" | "sign" | "frame") {
        return;
    }
    let items = message.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut out: Vec<Value> = Vec::new();

    for raw in items.iter().take(SESSION_SYNC_BATCH) {
        let Some(raw) = raw.as_object() else { continue };
        let dimension = match raw.get("dimension").and_then(Value::as_str) {
            Some(value) => sanitize_dimension(Some(value)).to_string(),
            None => default_dimension.clone(),
        };
        let (Some(x), Some(y), Some(z)) = (
            raw.get("x").and_then(int_of),
            raw.get("y").and_then(int_of),
            raw.get("z").and_then(int_of),
        ) else {
            continue;
        };
        match kind {
            "container" => {
                if y < i64::from(WORLD_MIN_Y) || y >= i64::from(WORLD_MAX_Y) {
                    continue;
                }
                let Some(slots) = raw.get("slots").and_then(Value::as_array) else { continue };
                if slots.len() > 27 {
                    continue;
                }
                let text_len = serde_json::to_string(&Value::Array(slots.clone()))
                    .map(|text| text.len())
                    .unwrap_or(usize::MAX);
                if text_len > 8192 || st.containers.len() >= MAX_CONTAINERS {
                    continue;
                }
                let key = scoped_key(&room, &dimension, x, y, z);
                st.containers.insert(
                    key,
                    Container {
                        x,
                        y,
                        z,
                        dimension: dimension.clone(),
                        slots: Value::Array(slots.clone()),
                    },
                );
                out.push(json!({
                    "t": "container", "dimension": dimension, "x": x, "y": y, "z": z,
                    "slots": slots, "by": id,
                }));
            }
            "sign" => {
                let lines: Vec<String> = raw
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
                if st.signs.len() >= MAX_SIGNS {
                    continue;
                }
                let key = scoped_key(&room, &dimension, x, y, z);
                st.signs.insert(
                    key,
                    Sign { x, y, z, dimension: dimension.clone(), lines: lines.clone() },
                );
                out.push(json!({
                    "t": "sign", "x": x, "y": y, "z": z, "dimension": dimension,
                    "lines": lines, "by": id,
                }));
            }
            _ => {
                // 展示框：`item = null` 是空框；带 item 时只认 `{id, count}`
                let item = match raw.get("item") {
                    None | Some(Value::Null) => Value::Null,
                    Some(value) => {
                        let Some(map) = value.as_object() else { continue };
                        let id_value = map.get("id").and_then(int_of).unwrap_or(0);
                        let count = map.get("count").and_then(int_of).unwrap_or(1);
                        json!({"id": id_value, "count": count})
                    }
                };
                let rotation = raw.get("rotation").and_then(int_of).unwrap_or(0);
                if st.frames.len() >= MAX_FRAMES {
                    continue;
                }
                let key = scoped_key(&room, &dimension, x, y, z);
                st.frames.insert(
                    key,
                    Frame {
                        x,
                        y,
                        z,
                        dimension: dimension.clone(),
                        item: item.clone(),
                        rotation,
                    },
                );
                out.push(json!({
                    "t": "frame", "x": x, "y": y, "z": z, "dimension": dimension,
                    "item": item, "rotation": rotation, "by": id,
                }));
            }
        }
    }

    // 收下之后按房广播：先进来的队友当场看到，后进来的从 `welcome` 拿（两边都不需要握手）
    for payload in out {
        st.broadcast(&room, Some(id), &payload, None, &hub.traffic);
    }
}

async fn on_mob_attack(hub: &Arc<Hub>, conn: &mut Conn, id: u64, message: &Map<String, Value>) {
    let st = hub.state.lock().await;
    let Some(player) = st.players.get(&id) else { return };
    // 只有本房房主能发：别人"替我打我自己"没有意义
    if st.hosts.get(&player.room).copied() != Some(id) {
        return;
    }
    let room = player.room.clone();
    if !conn.effect_window.allow(store::now_ms() as i64, 30) {
        return;
    }
    let Some(target_id) = message.get("targetId").and_then(int_of).and_then(|raw| u64::try_from(raw).ok()) else {
        return;
    };
    let Some(target) = st.players.get(&target_id) else { return };
    // 跨房不给打：目标必须和我同一间，也不能是我自己
    if target.room != room || target_id == id {
        return;
    }
    let tx = target.tx.clone();
    let damage = message.get("damage").and_then(number_of).unwrap_or(0.0).clamp(0.0, 50.0);
    if !(damage > 0.0) {
        return;
    }
    let (Some(x), Some(z)) =
        (message.get("x").and_then(number_of), message.get("z").and_then(number_of))
    else {
        return;
    };
    let source: String = message
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(32)
        .collect();
    let mut out = json!({"t": "mob-attack", "damage": damage, "x": x, "z": z, "fromId": id});
    if !source.is_empty() {
        if let Some(map) = out.as_object_mut() {
            map.insert("source".to_string(), Value::from(source));
        }
    }
    let _ = tx.send(text_message(&out));
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
    // 令牌桶而不是固定窗口（用户 2026-10-26）：30/s + 突发 400，进房重播的几百堆能一次过完
    if !conn.buckets.item.take(store::now_ms() as i64, 1) {
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
    let (name, room) = (player.name.clone(), player.room.clone());
    // 只跳**本房**的夜（每房一套时钟）：甲房的人睡满，乙房不该跟着天亮
    let (time, day) = {
        let clock = st.clock_mut(&room);
        // 睡满 = **过了一天**（用户 2026-10-25）：先把"今天"结算出来再加 1，然后才拨到黎明。
        // 顺序反了会少算一天（先用新起点算 day 再 +1 就变成跳两天）。
        clock.start_day = clock.day() + 1;
        clock.start_time_of_day = DAWN_TIME_OF_DAY;
        clock.start_ms = store::now_ms() as f64;
        (clock.time_of_day(), clock.day())
    };
    {
        st.broadcast(
            &room,
            None,
            &json!({"t": "time", "timeOfDay": time, "day": day, "snap": true}),
            None,
            &hub.traffic,
        );
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
            // 关房 = 这一局结束：连世界缓存（方块/容器/牌子/展示框/掉落物）一起清，
            // 否则下一位房主上位时会继承上一局的残骸（用户 2026-10-26）
            st.clear_room(&room);
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
