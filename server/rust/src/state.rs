//! 运行时状态：谁在线、在哪个房间、谁是房主、世界被改成了什么样。
//!
//! **整个 State 只由一把 `tokio::sync::Mutex` 保护**——这是第二阶段刻意做的改动。
//! 第一阶段给每张表各配一把锁，结果踩到"持 `players` 锁时调一个内部再锁 `players`
//! 的函数 → tokio Mutex 不可重入 → 永久死锁"（见 README 的坑）。单锁之后
//! **不存在锁顺序问题，也不可能自死锁**；代价是所有写操作串行化，而本项目的写操作
//! 只是一次查表 + 往无界队列里 push（不发网络、不 await），串行几微秒，够用。
//!
//! 出站一律走 `Player::tx`（无界 channel）：`send` 是同步的，所以在持锁时广播不会
//! 引入 await，锁边界天然收得干净。

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Instant;

use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::aoi::{chunk_distance, within_aoi};
use crate::protocol::*;

pub type Tx = mpsc::UnboundedSender<Message>;

/// 一条广播的关注范围中心（`None` = 按房发、不按范围过滤）。
pub struct Aoi {
    pub x: f64,
    pub z: f64,
    pub dimension: String,
}

impl Aoi {
    pub fn new(x: f64, z: f64, dimension: &str) -> Self {
        Self { x, z, dimension: dimension.to_string() }
    }
}

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
    /// 这一帧上报的外观（`held/armor/look/...`），已按白名单收口
    pub appearance: Map<String, Value>,
    /// 已经发了几条 `session-sync`（用户 2026-10-26）：只有房主用得上，防脚本无限刷
    pub sync_messages: u32,
    /// 已经推过哪些区块的增量（键是 `维度|cx,cz`）：走开再回来不重复推
    pub sent_edit_chunks: std::collections::HashSet<String>,
    pub tx: Tx,
}

impl Player {
    /// `welcome.players` / `player` 广播的基础字段（与 JS 版一致，外观另加）。
    pub fn base_wire(&self) -> Map<String, Value> {
        let mut out = Map::new();
        out.insert("id".into(), Value::from(self.id));
        out.insert("name".into(), Value::from(self.name.clone()));
        out.insert("x".into(), Value::from(self.x));
        out.insert("y".into(), Value::from(self.y));
        out.insert("z".into(), Value::from(self.z));
        out.insert("yaw".into(), Value::from(self.yaw));
        out.insert("pitch".into(), Value::from(self.pitch));
        out.insert("dimension".into(), Value::from(self.dimension.clone()));
        out
    }

    /// `player` 广播（move / join）：基础字段 + 外观 + 队伍。
    pub fn to_wire(&self) -> Value {
        let mut out = self.base_wire();
        for (key, value) in &self.appearance {
            out.insert(key.clone(), value.clone());
        }
        if !self.team.is_empty() {
            out.insert("team".into(), Value::from(self.team.clone()));
        }
        Value::Object(out)
    }
}

/// 一条方块改动（同格只留最后一稿）。
#[derive(Debug, Clone)]
pub struct Edit {
    pub x: i64,
    pub y: i64,
    pub z: i64,
    pub id: i64,
    pub state: i64,
    pub dimension: String,
}

/// 容器内容（槽位原样存，语义由客户端 `restoreStacks` 洗）。
#[derive(Debug, Clone)]
pub struct Container {
    pub x: i64,
    pub y: i64,
    pub z: i64,
    pub dimension: String,
    pub slots: Value,
}

/// 牌子文字。
#[derive(Debug, Clone)]
pub struct Sign {
    pub x: i64,
    pub y: i64,
    pub z: i64,
    pub dimension: String,
    pub lines: Vec<String>,
}

/// 展示框内容（`item = null` 是空框）。
#[derive(Debug, Clone)]
pub struct Frame {
    pub x: i64,
    pub y: i64,
    pub z: i64,
    pub dimension: String,
    pub item: Value,
    pub rotation: i64,
}

/// 掉落物镜像：key = `ownerId:localId`（owner 一律由服务端填）。
#[derive(Debug, Clone)]
pub struct Item {
    pub owner: u64,
    pub local_id: i64,
    pub item_id: i64,
    pub count: i64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub dimension: String,
}

impl Item {
    pub fn to_wire(&self) -> Value {
        json!({
            "owner": self.owner,
            "localId": self.local_id,
            "itemId": self.item_id,
            "count": self.count,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "dimension": self.dimension,
        })
    }
}

pub fn item_key(owner: u64, local_id: i64) -> String {
    format!("{owner}:{local_id}")
}

/// 插入顺序即新旧顺序的表（对应 JS 的 `Map`）。
///
/// 重新 `insert` 同一个 key **不改变顺序**（JS 语义），所以"最近被改过的格子"
/// 不会被误当成最旧的淘汰掉。
#[derive(Debug)]
pub struct OrderedMap<K: Eq + Hash, V> {
    map: HashMap<K, V>,
    order: VecDeque<K>,
}

impl<K: Eq + Hash + Clone, V> Default for OrderedMap<K, V> {
    fn default() -> Self {
        Self { map: HashMap::new(), order: VecDeque::new() }
    }
}

impl<K: Eq + Hash + Clone, V> OrderedMap<K, V> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.map.iter()
    }

    pub fn insert(&mut self, key: K, value: V) {
        if !self.map.contains_key(&key) {
            self.order.push_back(key.clone());
        }
        self.map.insert(key, value);
    }

    /// 容量满了先淘汰最旧的一条。返回被淘汰的 key（有的话）。
    pub fn remember(&mut self, key: K, value: V, capacity: usize) -> Option<K> {
        let existed = self.map.contains_key(&key);
        let mut evicted = None;
        if !existed && self.map.len() >= capacity {
            while let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
                evicted = Some(oldest);
                break;
            }
        }
        self.insert(key, value);
        evicted
    }

    /// 只保留满足条件的条目（关房时按房名前缀清缓存用）。
    ///
    /// ⚠️ 必须同时清理 `order`：`remember` 淘汰逻辑是 `pop_front()` 后直接 `map.remove()`，
    /// 如果队列里残留已删掉的 key，它会把"淘汰了一条"报出去、实际容量根本没释放
    /// （下次插入仍然满，然后就一直空转）。
    pub fn retain<F: FnMut(&K) -> bool>(&mut self, mut keep: F) {
        self.map.retain(|key, _| keep(key));
        let alive = &self.map;
        self.order.retain(|key| alive.contains_key(key));
    }
}

/// 一个宽限期条目。
///
/// `seq`（代次）是必需的：同一个人"断→连→再断"会留下两个计时任务，只比 `id` 的话
/// 前一个任务会提前把这人广播成"离开"（而这时他其实刚连回来）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grace {
    pub id: u64,
    pub seq: u64,
}

/// 天气状态（服务端权威）。
#[derive(Debug, Clone)]
pub struct Weather {
    pub kind: String,
    /// 这一档还剩多少秒
    pub left: f64,
}

/// 吞吐统计（联机29）：只累计，速率由两个采样点的差算出来。
pub struct Traffic {
    pub in_bytes: AtomicU64,
    pub out_bytes: AtomicU64,
    pub in_messages: AtomicU64,
    pub out_messages: AtomicU64,
    sample: StdMutex<Sample>,
}

struct Sample {
    at: Instant,
    in_bytes: u64,
    out_bytes: u64,
    in_messages: u64,
    out_messages: u64,
}

impl Traffic {
    pub fn new() -> Self {
        Self {
            in_bytes: AtomicU64::new(0),
            out_bytes: AtomicU64::new(0),
            in_messages: AtomicU64::new(0),
            out_messages: AtomicU64::new(0),
            sample: StdMutex::new(Sample {
                at: Instant::now(),
                in_bytes: 0,
                out_bytes: 0,
                in_messages: 0,
                out_messages: 0,
            }),
        }
    }

    pub fn count_in(&self, bytes: usize) {
        self.in_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.in_messages.fetch_add(1, Ordering::Relaxed);
    }

    pub fn count_out(&self, bytes: usize) {
        self.out_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.out_messages.fetch_add(1, Ordering::Relaxed);
    }

    /// 取一段时间的平均速率（会推进采样点）。
    pub fn rates(&self) -> Value {
        let in_bytes = self.in_bytes.load(Ordering::Relaxed);
        let out_bytes = self.out_bytes.load(Ordering::Relaxed);
        let in_messages = self.in_messages.load(Ordering::Relaxed);
        let out_messages = self.out_messages.load(Ordering::Relaxed);
        let mut sample = self.sample.lock().unwrap_or_else(|poison| poison.into_inner());
        let seconds = (sample.at.elapsed().as_secs_f64()).max(0.001);
        let rates = json!({
            "seconds": (seconds * 100.0).round() / 100.0,
            "inBytesPerSecond": ((in_bytes - sample.in_bytes) as f64 / seconds).round() as u64,
            "outBytesPerSecond": ((out_bytes - sample.out_bytes) as f64 / seconds).round() as u64,
            "inMessagesPerSecond": (((in_messages - sample.in_messages) as f64 / seconds).round()) as u64,
            "outMessagesPerSecond": (((out_messages - sample.out_messages) as f64 / seconds).round()) as u64,
        });
        sample.at = Instant::now();
        sample.in_bytes = in_bytes;
        sample.out_bytes = out_bytes;
        sample.in_messages = in_messages;
        sample.out_messages = out_messages;
        rates
    }
}

/// 整个服务端的世界。
pub struct State {
    pub seed: i64,
    pub players: HashMap<u64, Player>,
    /// 房间 → 房主 id（一房一名）
    pub hosts: HashMap<String, u64>,
    /// 房间 → 这一局的世界（房主开房时上报）
    pub worlds: HashMap<String, WorldMeta>,
    /// clientId → 宽限期里还留着的原 id（带代次：连断两次时旧计时器不能把新人踢掉）
    pub graces: HashMap<String, Grace>,
    /// 宽限期代次计数器
    pub next_grace_seq: u64,
    pub edits: OrderedMap<String, Edit>,
    pub containers: OrderedMap<String, Container>,
    pub signs: OrderedMap<String, Sign>,
    pub frames: OrderedMap<String, Frame>,
    pub items: HashMap<String, Item>,
    pub next_id: u64,
    /// **每房一套时钟**（用户 2026-10-26）：房主开房时带上他的「第几天 / 时刻 / 天气」，
    /// 房间一结束就跟着 `clear_room` 一起丢。
    ///
    /// 以前是全服一套：房主 B 在乙房开房会把甲房的太阳一起拨过去。房间之间本来就是
    /// 各是各的世界，时钟没有共享的理由。
    pub clocks: HashMap<String, RoomClock>,
    /// 房间 → 当前游戏模式（用户 2026-10-26）：房主中途用 `room-config` 改过也认这里，
    /// 晚进来的人从 `welcome.gameMode` 拿到**当前**模式，而不是开房那一刻的快照。
    pub room_game_modes: HashMap<String, String>,
    /// 房主已经把哪几个区块**整块**回给我们了（键 `维度|cx,cz`）：之后谁走进来直接推缓存
    pub confirmed_chunks: HashMap<String, std::collections::HashSet<String>>,
    /// 正在向房主要的区块（挡"同一块被连点"，5 秒后忘掉，回包丢了还能重试）
    pub requested_chunks: HashMap<String, std::collections::HashSet<String>>,
    /// 没有房主的房（以及读档后的默认值）用这一套；**落盘的就是它**。
    pub default_clock: RoomClock,
}

/// 一个房间的时钟（每房一套，用户 2026-10-26）。
#[derive(Debug, Clone)]
pub struct RoomClock {
    /// 起点墙钟（毫秒）；`sleep` 会把它重置成"现在"
    pub start_ms: f64,
    /// 起点对应的"一天中的时刻"（0..1）
    pub start_time_of_day: f64,
    /// 起点是第几天（房主开房时上报；读档时来自快照）
    pub start_day: i64,
    pub weather: Weather,
}

impl RoomClock {
    pub fn new() -> Self {
        Self {
            start_ms: crate::store::now_ms() as f64,
            start_time_of_day: DAWN_TIME_OF_DAY,
            start_day: 0,
            weather: Weather { kind: "clear".to_string(), left: next_weather_seconds("clear") },
        }
    }

    /// 现在是一天的第几（0..1）
    pub fn time_of_day(&self) -> f64 {
        let value = (crate::store::now_ms() as f64 - self.start_ms) / DAY_LENGTH_MS
            + self.start_time_of_day;
        value - value.floor()
    }

    /// 现在是第几天（与 Node 的 `currentDay` 同一算法）：
    /// `start_day + floor(elapsed + start_time_of_day)`，未满一天的部分也算一天。
    pub fn day(&self) -> i64 {
        let elapsed = (crate::store::now_ms() as f64 - self.start_ms) / DAY_LENGTH_MS;
        self.start_day + (elapsed + self.start_time_of_day).max(0.0).floor() as i64
    }
}

impl Default for RoomClock {
    fn default() -> Self {
        Self::new()
    }
}

impl State {
    pub fn new(seed: i64) -> Self {
        Self {
            seed,
            players: HashMap::new(),
            hosts: HashMap::new(),
            worlds: HashMap::new(),
            graces: HashMap::new(),
            next_grace_seq: 1,
            edits: OrderedMap::new(),
            containers: OrderedMap::new(),
            signs: OrderedMap::new(),
            frames: OrderedMap::new(),
            items: HashMap::new(),
            next_id: 1,
            clocks: HashMap::new(),
            room_game_modes: HashMap::new(),
            confirmed_chunks: HashMap::new(),
            requested_chunks: HashMap::new(),
            default_clock: RoomClock::new(),
        }
    }

    /// 这一房的时钟（没有就退回兜底那份，**不创建**——读取路径不该改状态）
    pub fn clock_of(&self, room: &str) -> &RoomClock {
        self.clocks.get(room).unwrap_or(&self.default_clock)
    }

    /// 这一房的时钟（可改）：没有就按兜底那份**复制一份**出来
    pub fn clock_mut(&mut self, room: &str) -> &mut RoomClock {
        if !self.clocks.contains_key(room) {
            let base = self.default_clock.clone();
            self.clocks.insert(room.to_string(), base);
        }
        self.clocks.get_mut(room).expect("刚插入过")
    }

    /// 这一房现在是一天的第几（0..1）
    pub fn time_of_day_of(&self, room: &str) -> f64 {
        self.clock_of(room).time_of_day()
    }

    /// 这一房现在是第几天
    pub fn day_of(&self, room: &str) -> i64 {
        self.clock_of(room).day()
    }

    pub fn alloc_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// **兜底时钟**现在是一天的第几（0..1）——落盘与"没有房主的房"用它。
    pub fn current_time_of_day(&self) -> f64 {
        self.default_clock.time_of_day()
    }

    /// **兜底时钟**现在是第几天（落盘用）
    pub fn current_day(&self) -> i64 {
        self.default_clock.day()
    }

    pub fn world_of_room(&self, room: &str) -> WorldMeta {
        self.worlds.get(room).cloned().unwrap_or_else(|| WorldMeta::default_with(self.seed))
    }

    pub fn rooms_in_use(&self) -> Vec<String> {
        let mut rooms: Vec<String> = self.players.values().map(|p| p.room.clone()).collect();
        rooms.sort();
        rooms.dedup();
        rooms
    }

    /// 关掉一个房间：清掉它名下的全部缓存（与 Node 版 `clearRoom` 同一口径）。
    ///
    /// 房间 = "房主开着世界"这一局。房主走了/换人了，上一局的方块、容器、牌子、展示框、
    /// 掉落物、世界元数据都不该留给下一局——服务端只是这一局的缓存，不是世界的主人。
    /// 返回清掉的方块增量条数（日志用）。
    pub fn clear_room(&mut self, room: &str) -> usize {
        let prefix = format!("{room}|");
        let before = self.edits.len();
        self.edits.retain(|key| !key.starts_with(&prefix));
        let removed = before - self.edits.len();
        self.containers.retain(|key| !key.starts_with(&prefix));
        self.signs.retain(|key| !key.starts_with(&prefix));
        self.frames.retain(|key| !key.starts_with(&prefix));
        // 掉落物 key 是 `ownerId:localId`，没有房名前缀：按 owner 现在所在的房间判
        let victims: Vec<String> = self
            .items
            .iter()
            .filter(|(_, item)| {
                self.players.get(&item.owner).map(|player| player.room == room).unwrap_or(false)
            })
            .map(|(key, _)| key.clone())
            .collect();
        for key in victims {
            self.items.remove(&key);
        }
        self.worlds.remove(room);
        self.hosts.remove(room);
        // 每房一套的时钟与模式：房间结束就丢，下一位房主带自己的设置进来
        self.clocks.remove(room);
        self.room_game_modes.remove(room);
        self.confirmed_chunks.remove(room);
        self.requested_chunks.remove(room);
        removed
    }

    /// 给一个人发一条消息（连接已断则忽略）。
    pub fn send_to(&self, id: u64, value: &Value, traffic: &Traffic) {
        let Some(player) = self.players.get(&id) else { return };
        let text = value.to_string();
        if player.tx.send(Message::Text(text.clone().into())).is_ok() {
            traffic.count_out(text.len());
        }
    }

    /// 给一个房间的人发（`except` = 不回给发送者；`aoi` = 只发给看得见这一点的）。
    pub fn broadcast(
        &self,
        room: &str,
        except: Option<u64>,
        value: &Value,
        aoi: Option<&Aoi>,
        traffic: &Traffic,
    ) {
        let text = value.to_string();
        for player in self.players.values() {
            if player.room != room {
                continue;
            }
            if Some(player.id) == except {
                continue;
            }
            if let Some(center) = aoi {
                if !within_aoi(
                    (player.x, player.z, player.dimension.as_str()),
                    center.x,
                    center.z,
                    center.dimension.as_str(),
                    AOI_RADIUS_CHUNKS,
                ) {
                    continue;
                }
            }
            if player.tx.send(Message::Text(text.clone().into())).is_ok() {
                traffic.count_out(text.len());
            }
        }
    }

    /// 新玩家进来时的那份世界快照（`welcome` 的内容，不含 `t/v/id`）。
    pub fn snapshot_for(&self, id: u64) -> Option<Value> {
        let player = self.players.get(&id)?;
        let world = self.world_of_room(&player.room);
        let prefix = format!("{}|", player.room);
        let edits: Vec<Value> = self
            .edits
            .iter()
            .filter(|(key, edit)| {
                key.starts_with(&prefix)
                    && edit.dimension == player.dimension
                    && chunk_distance(
                        edit.x as f64,
                        edit.z as f64,
                        player.x,
                        player.z,
                    ) <= SNAPSHOT_RADIUS_CHUNKS
            })
            .map(|(_, edit)| json!([edit.x, edit.y, edit.z, edit.id, edit.state, edit.dimension]))
            .collect();
        let containers: Vec<Value> = self
            .containers
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, container)| {
                json!({
                    "x": container.x, "y": container.y, "z": container.z,
                    "dimension": container.dimension, "slots": container.slots,
                })
            })
            .collect();
        let signs: Vec<Value> = self
            .signs
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, sign)| {
                json!({
                    "x": sign.x, "y": sign.y, "z": sign.z,
                    "dimension": sign.dimension, "lines": sign.lines,
                })
            })
            .collect();
        let frames: Vec<Value> = self
            .frames
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, frame)| {
                json!({
                    "x": frame.x, "y": frame.y, "z": frame.z, "dimension": frame.dimension,
                    "item": frame.item, "rotation": frame.rotation,
                })
            })
            .collect();
        let items: Vec<Value> = self
            .items
            .values()
            .filter(|item| {
                self.players.get(&item.owner).is_some_and(|owner| owner.room == player.room)
                    && item.dimension == player.dimension
            })
            .map(Item::to_wire)
            .collect();
        let players: Vec<Value> = self
            .players
            .values()
            .filter(|other| other.room == player.room)
            .map(|other| Value::Object(other.base_wire()))
            .collect();
        /*
         * 这一局**当前**的游戏模式（用户 2026-10-26）：房主中途用 `room-config` 改过之后
         * 要以此为准，否则晚进来的人看到的是开房那一刻的快照。
         */
        let game_mode = self
            .room_game_modes
            .get(&player.room)
            .cloned()
            .unwrap_or_else(|| world.mode.clone());
        let game_mode = if game_mode.is_empty() { Value::Null } else { Value::from(game_mode) };
        Some(json!({
            "seed": world.seed,
            "world": world.to_wire(),
            "isHost": player.is_host,
            "hostId": self.hosts.get(&player.room).copied().map(Value::from).unwrap_or(Value::Null),
            "gameMode": game_mode,
            // 时间 / 天数 / 天气都取**本房**的时钟（用户 2026-10-26：每房一套）
            "timeOfDay": self.time_of_day_of(&player.room),
            "day": self.day_of(&player.room),
            "weather": self.clock_of(&player.room).weather.kind,
            "players": players,
            "edits": edits,
            "items": items,
            "containers": containers,
            "signs": signs,
            "frames": frames,
        }))
    }

    /// 落盘用的快照（v2，用户 2026-10-26）：**不再存世界数据**。
    ///
    /// 世界（方块增量 / 容器 / 牌子 / 展示框）以**房主本地存档**为唯一真相，服务端只当
    /// 这一局的缓存，房间一结束就清。落盘一份"世界的副本"会立刻变成第二份事实：重启后
    /// 它会被 `welcome` 发出去，把房主本地的世界改回上一次的样子。
    ///
    /// 留下的只有**兜底时钟**（没有房主的房用的那套），顺带保证"重启之后时间接着走"
    /// （停机期间世界停着）。
    pub fn world_snapshot(&self) -> Value {
        let time = self.current_time_of_day();
        json!({
            "version": crate::store::SNAPSHOT_VERSION,
            "savedAt": crate::store::now_ms(),
            "timeOfDay": (time * 1_000_000.0).round() / 1_000_000.0,
            // 天数（用户 2026-10-25）：重启之后接着数，否则一个晚上的存档会让世界回到第 0 天
            "day": self.current_day(),
            // 天气（联机35）：重启后接着上次的天气跑
            "weather": self.default_clock.weather.kind,
        })
    }

    /// 启动时读档：把上一次的快照灌回内存表。
    ///
    /// 时间用"存档时刻的时间"做新的起点——服务端停机的那段时间不走（原版服务器关掉的
    /// 时候世界也是停的），不会出现"重启后突然变成深夜"。
    pub fn apply_snapshot(&mut self, data: &Value) {
        /*
         * v2（用户 2026-10-26）：**房间数据一概不读**——世界以房主本地存档为准，
         * 读回来就等于服务端抢先给房主灌了一份旧世界。v1 存档里那四张表也丢掉，
         * 只沿用时间/天气（下一次保存自然写成 v2）。
         */
        // 只回填**兜底时钟**：有房主的房间用自己的那份（房主开房时上报）
        if let Some(kind) = data.get("weather").and_then(Value::as_str) {
            if is_weather_kind(kind) {
                self.default_clock.weather =
                    Weather { kind: kind.to_string(), left: next_weather_seconds(kind) };
            }
        }
        if let Some(day) = data.get("day").and_then(Value::as_i64) {
            if day >= 0 {
                self.default_clock.start_day = day;
            }
        }
        if let Some(time) = data.get("timeOfDay").and_then(Value::as_f64) {
            if time.is_finite() {
                self.default_clock.start_time_of_day = ((time % 1.0) + 1.0) % 1.0;
                self.default_clock.start_ms = crate::store::now_ms() as f64;
            }
        }
    }
}

// ---------------------------------------------------------------- 天气状态机

/// 晴天 8~16 分钟；雨天/雷暴 2~5 分钟（与 `server/weather.mjs` 同一组阈值）。
pub fn next_weather_seconds(kind: &str) -> f64 {
    let [min, max] = if kind == "clear" { [480.0, 960.0] } else { [120.0, 300.0] };
    min + random_unit() * (max - min)
}

/// 晴天结束后：45% 继续晴，剩下 55% 里 30% 是雷暴（与客户端同一套规则）。
pub fn next_weather_kind(current: &str) -> &'static str {
    if current != "clear" {
        return "clear";
    }
    if random_unit() >= 0.55 {
        return "clear";
    }
    if random_unit() < 0.3 { "thunder" } else { "rain" }
}

/// 极简随机数：xorshift64*。天气只是"看起来有变化"，不需要密码学质量。
fn random_unit() -> f64 {
    use std::cell::Cell;
    thread_local! {
        static SEED: Cell<u64> = Cell::new(0);
    }
    SEED.with(|cell| {
        let mut state = cell.get();
        if state == 0 {
            state = crate::store::now_ms() ^ 0x9E37_79B9_7F4A_7C15;
            if state == 0 {
                state = 0x2545_F491_4F6C_DD1D;
            }
        }
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        cell.set(state);
        let value = state.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (value >> 11) as f64 / (1u64 << 53) as f64
    })
}
