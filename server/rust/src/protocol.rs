//! 协议常量与清洗函数
//!
//! **单一事实来源是 `server/node/protocol.mjs` 与 `docs/NET-PROTOCOL.md`**：这里逐条对齐，
//! 任何一处不一致都会让 Rust 版与 JS 版行为不同（最典型的是"名字截断把 emoji 切成半个"
//! 或"房间名回落规则不同 → 两个人进了两个房"）。
//!
//! 对齐的验收方式不是人眼比对，而是 `tools/net-test.mjs`（裸 WebSocket 客户端，
//! 1871 行黑盒断言）——它跑通，就说明行为一致。

#![allow(dead_code)]

use serde_json::{Map, Value};

/// 协议版本：改字段语义就 +1；两端不一致时服务端拒连，而不是静默错乱。
///
/// v2（L8）：`join` 多了 `host`，`welcome` 多了 `isHost` / `hostId`。
pub const PROTOCOL_VERSION: u8 = 2;

/// 名字最长多少个**字符**（不是字节）：按字节卡会让三个中文名就超。
pub const MAX_NAME_LENGTH: usize = 16;

/// 没有指定房间时的默认房间名。
pub const DEFAULT_ROOM: &str = "default";

/// 房间名最长多少个字符。
pub const MAX_ROOM_LENGTH: usize = 24;

/// 联机服务端默认端口（与 `server/node/protocol.mjs` 的 `DEFAULT_PORT` 相等）。
pub const DEFAULT_PORT: u16 = 8887;

/// 服务端默认世界种子（没房主的房间退回它，"单机直连服务器"的老行为）。
pub const WORLD_SEED_DEFAULT: i64 = 20261014;

// 关闭码（4000~4999 是应用段）；客户端判的是 `error.code`，关闭码只给日志/抓包看。
pub const CLOSE_VERSION: u16 = 4001;
pub const CLOSE_CLIENT_ID: u16 = 4002;
pub const CLOSE_DUPLICATE: u16 = 4003;
pub const CLOSE_ORIGIN: u16 = 4004;
pub const CLOSE_PASSWORD: u16 = 4005;
pub const CLOSE_HOST_TAKEN: u16 = 4006;
pub const CLOSE_HOST_LEFT: u16 = 4007;
pub const CLOSE_DUPLICATE_NAME: u16 = 4008;
/// 房主暂时不在房间（宽限期内断线）：与 Node 版 `CLOSE_HOST_OFFLINE` 同值
pub const CLOSE_HOST_OFFLINE: u16 = 4009;
/// 这个房名从来没有房主（用户 2026-10-27）：空房间不许进
pub const CLOSE_NO_HOST: u16 = 4010;

/// 世界高度范围（与客户端 `core/world/Chunk.ts` 一致）。
pub const WORLD_MIN_Y: i32 = -64;
pub const WORLD_MAX_Y: i32 = 320;

/// 方块 id 上界。**不是精确白名单**：精确白名单要同步客户端注册表，而它每个版本都在长。
pub const MAX_BLOCK_ID: i32 = 2000;
/// block state 位宽（8 位，与 `ChunkEdits.packEdit` 一致）。
pub const MAX_BLOCK_STATE: i32 = 255;
/// 一次改动允许离玩家多远（水平格）。
///
/// 房主不受这条限制：他重发的是**从属端请求**的落地结果，坐标是请求方的位置。
pub const MAX_EDIT_DISTANCE: f64 = 64.0;

/// `move` 的最小间隔（毫秒）：比这更频繁的移动消息直接丢弃。
pub const MOVE_INTERVAL_MS: u64 = 50;

/// 一条 `blocks` 消息最多认多少条（客户端合帧上限 256，这里留余量）。
pub const MAX_BLOCKS_PER_MESSAGE: usize = 4096;
/// 方块增量上限（满了淘汰最旧的一条）。
pub const MAX_EDITS: usize = 200_000;
pub const MAX_CONTAINERS: usize = 5000;
pub const MAX_SIGNS: usize = 5000;
pub const MAX_FRAMES: usize = 5000;
/// 掉落物镜像上限。
pub const MAX_ITEMS: usize = 2000;
/// 一包 `entity-snap` 最多带多少实体。
pub const MAX_SNAPSHOT_ENTITIES: usize = 256;
/// 一包 `entity-remove` 最多带多少个键。
pub const MAX_ENTITY_REMOVE_KEYS: usize = 64;

/// 单条消息的体积上限（与 JS 版 `ws` 的 `maxPayload: 64 * 1024` 一致）：
/// 超了回 close 1009，而不是让服务端先分配几十 MB 再解析。
pub const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

/// 断线宽限期默认 30 秒（测试用 `GRACE_MS` 压到几百毫秒）。
pub const GRACE_MS_DEFAULT: u64 = 30_000;

/// 一天多长（毫秒）：20 分钟，与客户端 `dayLengthSeconds` 默认值一致。
pub const DAY_LENGTH_MS: f64 = 20.0 * 60.0 * 1000.0;
/// 清晨 0.12（开局与"睡满跳夜"都回到这里）。
pub const DAWN_TIME_OF_DAY: f64 = 0.12;

/// 广播关注半径（区块）。与 `welcome` 的裁剪半径同一个数：看得见才需要更新。
pub const AOI_RADIUS_CHUNKS: i32 = 8;
/// 快照里带的改动半径（区块）。
pub const SNAPSHOT_RADIUS_CHUNKS: i32 = 8;

const DIMENSIONS: [&str; 3] = ["overworld", "nether", "end"];

// ---------------------------------------------------------------- 数值/文本收口

/// `Number(value)` 的等价物：数字 / 布尔 / null / 数字字符串，其余 `None`（= NaN）。
pub fn number_of(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::Null => Some(0.0),
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse::<f64>().ok().filter(|n| !n.is_nan())
            }
        }
        _ => None,
    }
}

/// `Math.trunc(Number(value))`；非数字 / NaN / 无穷一律 `None`。
pub fn int_of(value: &Value) -> Option<i64> {
    let n = number_of(value)?;
    if !n.is_finite() {
        return None;
    }
    Some(n.trunc() as i64)
}

/// 数字收口：NaN / 非数字 / 缺失都回落到默认值。
pub fn finite_number(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(number_of).filter(|n| n.is_finite()).unwrap_or(fallback)
}

/// JS 的 `truthy`：用于外观开关（`sneak: 1` 要算 true）。
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|v| v != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JS 的 `String(value)`（牌子每行可能是数字，不该被整行丢掉）。
pub fn text_of(value: Option<&Value>) -> String {
    match value {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".to_string(),
        Some(other) => other.to_string(),
    }
}

/// 正整数的 id（`held` / `offhand` 这类物品 id：非正数等于"空手"，不该下发）。
pub fn positive_int(value: Option<&Value>) -> Option<i64> {
    let id = int_of(value?)?;
    if id > 0 { Some(id) } else { None }
}

// ---------------------------------------------------------------- 清洗

/// 维度名收口：非法/缺失一律回主世界（它是数据表的 key 之一，拼错就永远对不上）。
pub fn sanitize_dimension(value: Option<&str>) -> &'static str {
    match value {
        Some("nether") => "nether",
        Some("end") => "end",
        Some(v) if DIMENSIONS.contains(&v) => "overworld",
        _ => "overworld",
    }
}

/// clientId 的合法形状：8~64 位字母/数字/下划线/连字符（浏览器生成的是 16 位 hex）。
pub fn is_valid_client_id(value: &str) -> bool {
    let len = value.chars().count();
    (8..=64).contains(&len) && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 把客户端给的名字洗成能安全显示的名字。
///
/// 三件事：去控制字符与尖括号（聊天用 `<名字>` 包，名字带 `>` 就能伪造系统发言）、
/// 按**字符**截断（按字节切会把 emoji 切成半个）、空的退回"玩家"。
pub fn sanitize_name(value: Option<&str>) -> String {
    let raw = value.unwrap_or("");
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || c == '<' || c == '>' { ' ' } else { c })
        .collect();
    let squeezed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: String = squeezed.chars().take(MAX_NAME_LENGTH).collect();
    if chars.is_empty() { "玩家".to_string() } else { chars }
}

/// 房间名收口：1~24 位字母/数字/`-`/`_`，其余一律回落默认房间。
///
/// 为什么宁可回落也不透传：房名是数据表的 key 前缀（`房名|维度|x,y,z`），
/// 一个带分隔符的名字会让两个房间的数据在 key 上撞车。
pub fn sanitize_room(value: Option<&str>) -> String {
    let raw = value.unwrap_or("");
    let valid = (1..=MAX_ROOM_LENGTH).contains(&raw.chars().count())
        && raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if valid { raw.to_string() } else { DEFAULT_ROOM.to_string() }
}

/// 去掉控制字符与尖括号后按字符截断（世界名/模式这类纯展示标签用；**不**换成空格）。
fn strip_and_clip(raw: &str, max: usize) -> String {
    raw.chars()
        .filter(|c| !c.is_control() && *c != '<' && *c != '>')
        .collect::<String>()
        .trim()
        .chars()
        .take(max)
        .collect()
}

// ---------------------------------------------------------------- 房间的世界（L9）

/// 世界名上限。
pub const MAX_WORLD_NAME: usize = 32;
/// 种子绝对值上限：本项目种子是 32 位整数，超了就是脏数据。
pub const MAX_SEED: i64 = 2_147_483_647;

/// 房主上报的世界元数据：**这一局的地形由它决定**。
#[derive(Debug, Clone, PartialEq)]
pub struct WorldMeta {
    pub name: String,
    pub seed: i64,
    pub mode: String,
    pub difficulty: String,
    pub world_type: String,
}

impl WorldMeta {
    /// 没有房主的房间退回的那一份（服务端默认种子）。
    pub fn default_with(seed: i64) -> Self {
        Self {
            name: String::new(),
            seed,
            mode: String::new(),
            difficulty: String::new(),
            world_type: String::new(),
        }
    }

    pub fn to_wire(&self) -> Value {
        serde_json::json!({
            "name": self.name,
            "seed": self.seed,
            "mode": self.mode,
            "difficulty": self.difficulty,
            "worldType": self.world_type,
        })
    }
}

/// 房主上报的世界的形状收口；`None` = 脏数据（调用方保留原来的那份/退回默认种子）。
pub fn sanitize_world_meta(value: Option<&Value>) -> Option<WorldMeta> {
    let map = value?.as_object()?;
    let seed_value = map.get("seed")?;
    let seed_number = number_of(seed_value)?;
    if !seed_number.is_finite() || seed_number.fract() != 0.0 {
        return None;
    }
    let seed = seed_number as i64;
    if seed.abs() > MAX_SEED {
        return None;
    }
    let label = |key: &str| {
        map.get(key)
            .and_then(Value::as_str)
            .map(|raw| strip_and_clip(raw, 16))
            .unwrap_or_default()
    };
    Some(WorldMeta {
        name: map
            .get("name")
            .and_then(Value::as_str)
            .map(|raw| strip_and_clip(raw, MAX_WORLD_NAME))
            .unwrap_or_default(),
        seed,
        mode: label("mode"),
        difficulty: label("difficulty"),
        world_type: label("worldType"),
    })
}

// ---------------------------------------------------------------- 距离 / key

/// `(x, z)` 离玩家多远（水平距离；垂直方向不参与——上下挖矿是常事）。
pub fn within_edit_reach(player_xz: (f64, f64), x: i32, z: i32) -> bool {
    let dx = f64::from(x) - player_xz.0;
    let dz = f64::from(z) - player_xz.1;
    if !(dx.is_finite() && dz.is_finite()) {
        return false;
    }
    dx.hypot(dz) <= MAX_EDIT_DISTANCE
}

/// 一条方块改动是否可信；`None` = 通过。
///
/// `is_host` 为真时跳过距离闸（见 `MAX_EDIT_DISTANCE` 的注释）。
pub fn block_edit_rejection(
    player_xz: (f64, f64),
    is_host: bool,
    x: i32,
    y: i32,
    z: i32,
    id: i32,
    state: i32,
) -> Option<&'static str> {
    if y < WORLD_MIN_Y || y >= WORLD_MAX_Y {
        return Some("y-range");
    }
    if id < 0 || id > MAX_BLOCK_ID {
        return Some("id-range");
    }
    if state < 0 || state > MAX_BLOCK_STATE {
        return Some("state-range");
    }
    if !is_host && !within_edit_reach(player_xz, x, z) {
        return Some("distance");
    }
    None
}

/// 拼一个数据表的 key：`房名|维度|x,y,z`（与 JS 版同形）。
pub fn scoped_key(room: &str, dimension: &str, x: i64, y: i64, z: i64) -> String {
    format!("{room}|{dimension}|{x},{y},{z}")
}

/// 从 key 里取回房间名（`房名|...`；老格式只有两段，归默认房间）。
pub fn room_of_key(key: &str) -> String {
    // 旧格式是 `维度|x,y,z`（正好两段），那时第一段是维度名，不能当房名用
    let parts: Vec<&str> = key.split('|').collect();
    if parts.len() >= 3 { parts[0].to_string() } else { DEFAULT_ROOM.to_string() }
}

// ---------------------------------------------------------------- 改动请求（L8·MS2）

/// 一条 `edit-request` 里最多带多少格。
pub const MAX_REQUEST_BLOCKS: usize = 4096;

/// 从属端发来的"改动请求"载荷收口：只保证形状，内容由房主落地时再校验。
pub fn sanitize_edit_payload(payload: Option<&Value>) -> Option<Value> {
    let map = payload?.as_object()?;
    let kind = map.get("t").and_then(Value::as_str)?;
    match kind {
        "block" => {
            let edit = map
                .get("edit")
                .and_then(Value::as_array)
                .map(|list| Value::Array(list.iter().take(6).cloned().collect()))
                .unwrap_or(Value::Null);
            Some(serde_json::json!({"t": "block", "edit": edit}))
        }
        "blocks" => {
            let blocks = map.get("blocks")?.as_array()?;
            let clipped: Vec<Value> = blocks.iter().take(MAX_REQUEST_BLOCKS).cloned().collect();
            Some(serde_json::json!({"t": "blocks", "blocks": clipped}))
        }
        "container" | "sign" | "frame" | "tnt" => {
            let (x, y, z) = coords_of(map)?;
            let dimension = sanitize_dimension(map.get("dimension").and_then(Value::as_str));
            match kind {
                "container" => {
                    let slots = map.get("slots")?.as_array()?;
                    if slots.len() > 27 {
                        return None;
                    }
                    if serde_json::to_string(&Value::Array(slots.clone())).ok()?.len() > 8192 {
                        return None;
                    }
                    Some(serde_json::json!({
                        "t": "container", "x": x, "y": y, "z": z,
                        "dimension": dimension, "slots": slots,
                    }))
                }
                "sign" => {
                    let lines = map.get("lines")?.as_array()?;
                    let lines: Vec<String> = lines
                        .iter()
                        .take(4)
                        .map(|line| match line {
                            Value::String(text) => text.chars().take(64).collect(),
                            _ => String::new(),
                        })
                        .collect();
                    Some(serde_json::json!({
                        "t": "sign", "x": x, "y": y, "z": z,
                        "dimension": dimension, "lines": lines,
                    }))
                }
                "frame" => {
                    let item = map.get("item");
                    let cleaned = match item {
                        Some(Value::Object(obj))
                            if obj.get("id").and_then(int_of).is_some()
                                && obj.get("count").and_then(int_of).is_some() =>
                        {
                            serde_json::json!({
                                "id": obj.get("id").and_then(int_of).unwrap_or(0),
                                "count": obj.get("count").and_then(int_of).unwrap_or(0),
                            })
                        }
                        _ => Value::Null,
                    };
                    let rotation = map.get("rotation").and_then(int_of).unwrap_or(0);
                    Some(serde_json::json!({
                        "t": "frame", "x": x, "y": y, "z": z, "dimension": dimension,
                        "item": cleaned, "rotation": rotation,
                    }))
                }
                _ => Some(serde_json::json!({
                    "t": "tnt", "x": x, "y": y, "z": z, "dimension": dimension,
                })),
            }
        }
        _ => None,
    }
}

fn coords_of(map: &Map<String, Value>) -> Option<(i64, i64, i64)> {
    let x = map.get("x").and_then(int_of)?;
    let y = map.get("y").and_then(int_of)?;
    let z = map.get("z").and_then(int_of)?;
    Some((x, y, z))
}

// ---------------------------------------------------------------- 实体快照（L8·MS3）

/// 实体快照的形状收口：**只保证它是个不超过上限的数组**（内容不校验）。
pub fn sanitize_entity_snap(raw: Option<&Value>) -> Option<Vec<Value>> {
    let list = raw?.as_array()?;
    Some(list.iter().take(MAX_SNAPSHOT_ENTITIES).cloned().collect())
}

/// 实体消失/死亡的键列表收口：只留 1~32 字符的字符串、最多 64 个。
pub fn sanitize_entity_keys(raw: Option<&Value>) -> Option<Vec<Value>> {
    let list = raw?.as_array()?;
    let keys: Vec<Value> = list
        .iter()
        .filter(|key| key.as_str().is_some_and(|text| !text.is_empty() && text.chars().count() <= 32))
        .take(MAX_ENTITY_REMOVE_KEYS)
        .cloned()
        .collect();
    if keys.is_empty() { None } else { Some(keys) }
}

// ---------------------------------------------------------------- 外观（联机17）

/// 外观字段收口：只认白名单，值一律规整成数字/布尔。
///
/// 不让客户端把任意结构塞进广播——否则一个客户端就能决定别人收到的报文长什么样。
pub fn read_appearance(message: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    /*
     * 0 是有效值（空手 / 空槽）：**带的键一定收下**，负数/脏数据规整成 0。
     * 不能像以前那样"非正就丢掉字段"——那样"把手里的东西收起来"永远同步不过去
     * （对端一直看着你举着上一件东西）。
     */
    let non_negative =
        |value: Option<&Value>| -> Option<i64> { Some(int_of(value?).unwrap_or(0).max(0)) };
    if let Some(held) = non_negative(message.get("held")) {
        out.insert("held".to_string(), Value::from(held));
    }
    if let Some(offhand) = non_negative(message.get("offhand")) {
        out.insert("offhand".to_string(), Value::from(offhand));
    }
    if let Some(armor) = message.get("armor").and_then(Value::as_array) {
        let ids: Vec<i64> =
            armor.iter().take(4).map(|id| non_negative(Some(id)).unwrap_or(0)).collect();
        out.insert("armor".to_string(), Value::from(ids));
    }
    /*
     * 外观下标（皮肤）：**定长 10，多一个都不要**（协议契约，见
     * `src/core/net/RemoteAppearance.ts` 的 `REMOTE_LOOK_LENGTH`）。
     * 只做形状收口（整数、长度），"第几档合法"是各端颜色表的事，服务端没有那张表。
     */
    if let Some(look) = message.get("look").and_then(Value::as_array) {
        if look.len() == 10 {
            let slots: Vec<i64> =
                look.iter().map(|value| non_negative(Some(value)).unwrap_or(0)).collect();
            out.insert("look".to_string(), Value::from(slots));
        }
    }
    /*
     * 布尔字段：**键在就收**（用户 2026-10-26）。以前只在真值时插入，于是"松手不再潜行"
     * 永远传不出去——下一次整份覆盖才会纠正，表现为队友那边一直潜着走。
     */
    for flag in ["sneak", "swing", "hurt", "fire", "ride", "sleep", "dead"] {
        if message.contains_key(flag) {
            out.insert(flag.to_string(), Value::Bool(truthy(message.get(flag))));
        }
    }
    // 生命 / 饥饿的点数收口：0~20 的整数（非有限数按 0），脏数据不会把 UI 画成穿出屏幕的条。
    for stat in ["hp", "food"] {
        if let Some(value) = message.get(stat) {
            let points = int_of(value).unwrap_or(0).clamp(0, 20);
            out.insert(stat.to_string(), Value::from(points));
        }
    }
    out
}

// ---------------------------------------------------------------- 时间 / 天气

/// 合法的游戏模式（与 Node 版 `GAME_MODE_VALUES` 一致）。
///
/// 只做白名单校验：`room-config` 里带别的字符串一律忽略，晚进来的人从
/// `welcome.gameMode` 拿到的是这里允许过的值。
pub const GAME_MODES: [&str; 4] = ["survival", "creative", "adventure", "spectator"];

/// 天气三档（与 `server/weather.mjs` 一致）。
pub fn is_weather_kind(value: &str) -> bool {
    matches!(value, "clear" | "rain" | "thunder")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn name_is_cleaned_and_truncated_by_chars() {
        assert_eq!(sanitize_name(Some("  小明  ")), "小明");
        // `<` `>` 换空格、斜杠保留（与 JS 的 `replace(/[<>]/g, ' ')` 完全一致）
        assert_eq!(sanitize_name(Some("<b>坏</b>")), "b 坏 /b");
        assert_eq!(sanitize_name(Some("abcdefghijklmnopqr")), "abcdefghijklmnop");
        // 16 个中文字符：按字符截，不会切出半个字
        assert_eq!(sanitize_name(Some("一二三四五六七八九十一二三四五六七")), "一二三四五六七八九十一二三四五六");
        assert_eq!(sanitize_name(Some("")), "玩家");
        assert_eq!(sanitize_name(None), "玩家");
        // 控制字符变空格后被压缩
        assert_eq!(sanitize_name(Some("a\u{0}b")), "a b");
    }

    #[test]
    fn emoji_is_not_split() {
        let name = sanitize_name(Some("🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂"));
        assert_eq!(name.chars().count(), 16);
    }

    #[test]
    fn room_falls_back_to_default() {
        assert_eq!(sanitize_room(Some("red")), "red");
        assert_eq!(sanitize_room(Some("a-b_c1")), "a-b_c1");
        assert_eq!(sanitize_room(Some("不合法 房名")), DEFAULT_ROOM);
        assert_eq!(sanitize_room(Some("")), DEFAULT_ROOM);
        assert_eq!(sanitize_room(None), DEFAULT_ROOM);
        assert_eq!(sanitize_room(Some(&"a".repeat(25))), DEFAULT_ROOM);
    }

    #[test]
    fn client_id_shape() {
        assert!(is_valid_client_id("abcdef01"));
        assert!(is_valid_client_id(&"a".repeat(64)));
        assert!(!is_valid_client_id("short"));
        assert!(!is_valid_client_id(&"a".repeat(65)));
        assert!(!is_valid_client_id("ab cd ef"));
    }

    #[test]
    fn dimension_only_three_values() {
        assert_eq!(sanitize_dimension(Some("nether")), "nether");
        assert_eq!(sanitize_dimension(Some("end")), "end");
        assert_eq!(sanitize_dimension(Some("moon")), "overworld");
        assert_eq!(sanitize_dimension(None), "overworld");
    }

    #[test]
    fn finite_number_falls_back() {
        assert_eq!(finite_number(Some(&json!(3.5)), 1.0), 3.5);
        assert_eq!(finite_number(Some(&json!("abc")), 1.0), 1.0);
        assert_eq!(finite_number(None, 2.0), 2.0);
        // JS 的 Number("3") === 3：数字字符串要认（move 里客户端偶尔带字符串）
        assert_eq!(finite_number(Some(&json!("3")), 0.0), 3.0);
    }

    #[test]
    fn int_of_truncates_and_rejects_nan() {
        assert_eq!(int_of(&json!(3.9)), Some(3));
        assert_eq!(int_of(&json!(-3.9)), Some(-3));
        assert_eq!(int_of(&json!("abc")), None);
        assert_eq!(int_of(&json!(null)), Some(0));
    }

    #[test]
    fn block_edit_range_checks() {
        let at_origin = (0.0, 0.0);
        assert_eq!(block_edit_rejection(at_origin, false, 0, -64, 0, 1, 0), None);
        assert_eq!(block_edit_rejection(at_origin, false, 0, 320, 0, 1, 0), Some("y-range"));
        assert_eq!(block_edit_rejection(at_origin, false, 0, 0, 0, -1, 0), Some("id-range"));
        assert_eq!(block_edit_rejection(at_origin, false, 0, 0, 0, 2001, 0), Some("id-range"));
        assert_eq!(block_edit_rejection(at_origin, false, 0, 0, 0, 1, 256), Some("state-range"));
        assert_eq!(block_edit_rejection(at_origin, false, 100, 0, 0, 1, 0), Some("distance"));
    }

    #[test]
    fn host_is_exempt_from_distance_gate() {
        // 房主在原点，代发 (500,500) 的改动：从属端请求的落地结果，必须放行
        assert_eq!(block_edit_rejection((0.0, 0.0), true, 500, 70, 500, 1, 0), None);
        // 闸本身还在：非房主同样坐标照样被挡
        assert_eq!(block_edit_rejection((0.0, 0.0), false, 500, 70, 500, 1, 0), Some("distance"));
    }

    #[test]
    fn scoped_key_shape_matches_js() {
        assert_eq!(scoped_key("red", "overworld", 1, 2, 3), "red|overworld|1,2,3");
        assert_eq!(room_of_key("red|overworld|1,2,3"), "red");
        // 旧格式（没有房名前缀）归默认房间
        assert_eq!(room_of_key("overworld|1,2,3"), DEFAULT_ROOM);
    }

    #[test]
    fn world_meta_is_sanitized() {
        let meta = sanitize_world_meta(Some(&json!({
            "name": "<草原>\u{7}".to_string() + &"长".repeat(40),
            "seed": 7,
            "mode": "creative",
        })))
        .expect("应当通过");
        assert_eq!(meta.name, format!("草原{}", "长".repeat(30)));
        assert_eq!(meta.seed, 7);
        assert_eq!(meta.mode, "creative");
        // 非整数种子 / 非对象 → 整份丢弃
        assert!(sanitize_world_meta(Some(&json!({"seed": 1.5}))).is_none());
        assert!(sanitize_world_meta(Some(&json!(null))).is_none());
        assert!(sanitize_world_meta(Some(&json!({"seed": "abc"}))).is_none());
        assert!(sanitize_world_meta(None).is_none());
    }

    #[test]
    fn appearance_only_whitelists_known_fields() {
        let message = json!({
            "held": 5,
            "armor": [1, 2, 0, 0],
            "sneak": 1,
            "swing": 1,
            "look": [1, 2, 3, 4, 5, 2, 1, 3, 1, 2],
            "evil": {"x": 1},
            "offhand": -3,
        });
        let map = message.as_object().unwrap();
        let appearance = read_appearance(map);
        assert_eq!(appearance.get("held"), Some(&json!(5)));
        assert_eq!(appearance.get("armor"), Some(&json!([1, 2, 0, 0])));
        assert_eq!(appearance.get("sneak"), Some(&json!(true)));
        assert_eq!(appearance.get("look"), Some(&json!([1, 2, 3, 4, 5, 2, 1, 3, 1, 2])));
        assert!(appearance.get("evil").is_none());
        /*
         * 非正 id **规整成 0 并仍然下发**（用户 2026-10-26）：0 是有效值（空手）。
         * 以前"非正就丢掉字段"，于是"把手里的东西收起来"永远同步不过去——
         * 对端一直看着你举着上一件东西。
         */
        assert_eq!(appearance.get("offhand"), Some(&json!(0)));

        // 长度不足 10 的 look 不下发（协议契约：定长 10，客户端据此回退昵称派生）
        let short = json!({"look": [1, 2, 3]});
        assert!(read_appearance(short.as_object().unwrap()).get("look").is_none());
        // 非正 id 的 held 规整成 0，仍然下发
        let negative = json!({"held": -3});
        assert_eq!(read_appearance(negative.as_object().unwrap()).get("held"), Some(&json!(0)));

        // 布尔键**在就收**：显式 false 也要能表达（松手不再潜行）
        let released = json!({"sneak": false, "ride": 0});
        let map = read_appearance(released.as_object().unwrap());
        assert_eq!(map.get("sneak"), Some(&json!(false)));
        assert_eq!(map.get("ride"), Some(&json!(false)));

        // 生命/饥饿夹到 0~20（脏数据不会把 UI 画成穿出屏幕的条）
        let stats = json!({"hp": 999, "food": -5});
        let map = read_appearance(stats.as_object().unwrap());
        assert_eq!(map.get("hp"), Some(&json!(20)));
        assert_eq!(map.get("food"), Some(&json!(0)));
    }

    #[test]
    fn entity_keys_are_filtered() {
        assert_eq!(sanitize_entity_keys(Some(&json!(["1:7", "1:8"]))).unwrap().len(), 2);
        assert!(sanitize_entity_keys(Some(&json!([]))).is_none());
        assert!(sanitize_entity_keys(Some(&json!("nope"))).is_none());
        assert!(sanitize_entity_keys(Some(&json!([1, "", "ok"]))).unwrap().len() == 1);
    }

    #[test]
    fn entity_snap_is_truncated() {
        let many: Vec<String> = (0..400).map(|index| format!("1:{index}")).collect();
        let value = json!(many);
        assert_eq!(sanitize_entity_snap(Some(&value)).unwrap().len(), MAX_SNAPSHOT_ENTITIES);
        assert!(sanitize_entity_snap(Some(&json!("nope"))).is_none());
    }

    #[test]
    fn edit_payload_shapes() {
        assert!(sanitize_edit_payload(Some(&json!({"t": "nonsense"}))).is_none());
        let blocks = sanitize_edit_payload(Some(&json!({
            "t": "blocks",
            "blocks": [[50, 70, 50, 1, 0, "overworld"]],
        })))
        .unwrap();
        assert_eq!(blocks["blocks"][0], json!([50, 70, 50, 1, 0, "overworld"]));
        // 容器：格子数超 27 整条丢
        assert!(sanitize_edit_payload(Some(&json!({
            "t": "container", "x": 1, "y": 2, "z": 3, "dimension": "overworld",
            "slots": vec![Value::Null; 28],
        })))
        .is_none());
        assert!(sanitize_edit_payload(Some(&json!({
            "t": "tnt", "x": 1, "y": 2, "z": 3, "dimension": "nether",
        })))
        .is_some());
    }
}
