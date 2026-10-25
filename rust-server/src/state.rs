//! 运行时状态：谁在线、在哪个房间、谁是房主、有哪些方块改动。
//!
//! 全部用 `tokio::sync::Mutex` 保护：临界区都很短（查表 + 拷一份快照），
//! 不要在持锁时做 await 之外的重活（广播是"收集发送端再逐个 send"，不持锁发）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// 一个在线玩家。
#[derive(Debug, Clone)]
pub struct Player {
    pub id: u64,
    pub name: String,
    pub client_id: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub dimension: String,
    pub room: String,
    pub is_host: bool,
    pub team: String,
    /// 上一条 `move` 的毫秒时间戳（限频用）
    pub last_move_ms: u64,
    /// 这一帧上报的外观（`held/offhand/armor/look/...`），原样转发
    pub appearance: serde_json::Map<String, serde_json::Value>,
}

impl Player {
    /// 转成 `welcome.players` 里的一项（字段与 JS 版一致）。
    pub fn to_wire(&self) -> serde_json::Value {
        let mut out = serde_json::json!({
            "id": self.id,
            "name": self.name,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "yaw": self.yaw,
            "pitch": self.pitch,
            "dimension": self.dimension,
        });
        if let Some(map) = out.as_object_mut() {
            for (key, value) in &self.appearance {
                map.insert(key.clone(), value.clone());
            }
            if !self.team.is_empty() {
                map.insert("team".to_string(), serde_json::Value::String(self.team.clone()));
            }
        }
        out
    }
}

/// 一条方块改动（按 `room|dimension|x,y,z` 存，同格只留最后一稿）。
#[derive(Debug, Clone)]
pub struct Edit {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub id: i32,
    pub state: i32,
    pub dimension: String,
}

/// 全局状态。
pub struct Hub {
    pub players: Mutex<HashMap<u64, Player>>,
    /// id → 该连接的出站队列（写任务从队列里取）
    pub senders: Mutex<HashMap<u64, mpsc::UnboundedSender<Message>>>,
    /// 房间 → 房主 id（一房一名）
    pub hosts: Mutex<HashMap<String, u64>>,
    /// 方块改动：key = `room|dimension|x,y,z`
    pub edits: Mutex<HashMap<String, Edit>>,
    next_id: AtomicU64,
    /// 服务端启动时刻（推 `timeOfDay` 用）
    pub started_at: Instant,
    /// 房主用 `/time` 改过的时间（`None` = 按启动时刻推算）
    time_override: Mutex<Option<f64>>,
    /// 天气（全服一个；第二阶段按房隔离）
    weather: Mutex<String>,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            players: Mutex::new(HashMap::new()),
            senders: Mutex::new(HashMap::new()),
            hosts: Mutex::new(HashMap::new()),
            edits: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            started_at: Instant::now(),
            time_override: Mutex::new(None),
            weather: Mutex::new("clear".to_string()),
        }
    }

    pub fn alloc_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// 现在是一天的第几（0..1）。20 分钟 = 一天，与服务端 JS 版同一节奏。
    pub async fn time_of_day(&self) -> f64 {
        let elapsed = self.started_at.elapsed().as_secs_f64() / (20.0 * 60.0);
        let base = self.time_override.lock().await.unwrap_or(0.0);
        (base + elapsed) % 1.0
    }

    pub async fn set_time_override(&self, value: f64) {
        *self.time_override.lock().await = Some(value);
    }

    pub async fn weather(&self) -> String {
        self.weather.lock().await.clone()
    }

    pub async fn set_weather(&self, kind: &str) {
        *self.weather.lock().await = kind.to_string();
    }

    /// 给一个人发一条消息（连接已断则忽略）。
    pub async fn send_to(&self, id: u64, value: &serde_json::Value) {
        let senders = self.senders.lock().await;
        if let Some(tx) = senders.get(&id) {
            let _ = tx.send(Message::Text(value.to_string().into()));
        }
    }

    /// 给一个房间的所有人发（`except` = 不回给发送者）。
    pub async fn broadcast(&self, room: &str, except: Option<u64>, value: &serde_json::Value) {
        let targets: Vec<mpsc::UnboundedSender<Message>> = {
            let players = self.players.lock().await;
            let senders = self.senders.lock().await;
            players
                .values()
                .filter(|p| p.room == room && Some(p.id) != except)
                .filter_map(|p| senders.get(&p.id).cloned())
                .collect()
        };
        let text = value.to_string();
        for tx in targets {
            let _ = tx.send(Message::Text(text.clone().into()));
        }
    }

    /// 同房在线玩家（含自己，与 JS 版 `welcome.players` 一致：客户端自己跳过 selfId）。
    pub async fn room_players(&self, room: &str) -> Vec<serde_json::Value> {
        let players = self.players.lock().await;
        players.values().filter(|p| p.room == room).map(Player::to_wire).collect()
    }

    /// 本房的方块改动，形状 `[x, y, z, id, state, dimension]`。
    pub async fn room_edits(&self, room: &str) -> Vec<serde_json::Value> {
        let prefix = format!("{room}|");
        let edits = self.edits.lock().await;
        edits
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, e)| serde_json::json!([e.x, e.y, e.z, e.id, e.state, e.dimension]))
            .collect()
    }

    /// 有人进来时，同房其他人收到的 `player` 广播（形状与 `move` 转发一致）。
    pub async fn player_broadcast_of(&self, id: u64) -> Option<serde_json::Value> {
        let players = self.players.lock().await;
        let p = players.get(&id)?;
        let mut value = p.to_wire();
        if let Some(map) = value.as_object_mut() {
            map.insert("t".to_string(), serde_json::Value::String("player".to_string()));
        }
        Some(value)
    }
}
