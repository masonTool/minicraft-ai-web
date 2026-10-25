//! 协议常量与清洗函数
//!
//! **单一事实来源是 `server/protocol.mjs` 与 `docs/NET-PROTOCOL.md`**：这里逐条对齐，
//! 任何一处不一致都会让 Rust 版与 JS 版行为不同（最典型的是"名字截断把 emoji 切成半个"
//! 或"房间名回落规则不同 → 两个人进了两个房"）。
//!
//! 对齐的验收方式不是人眼比对，而是 `tools/net-test.mjs`（裸 WebSocket 客户端，
//! 1871 行黑盒断言）——它跑通，就说明行为一致。

// 第一阶段的关闭码里有一部分属于"第二阶段才用"（宽限重连 / 口令 / 来源白名单），
// 先留着常量，等对应功能落地时直接用。
#![allow(dead_code)]

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

// 关闭码（4000~4999 是应用段）；客户端判的是 `error.code`，关闭码只给日志/抓包看。
pub const CLOSE_VERSION: u16 = 4001;
pub const CLOSE_CLIENT_ID: u16 = 4002;
pub const CLOSE_DUPLICATE: u16 = 4003;
pub const CLOSE_ORIGIN: u16 = 4004;
pub const CLOSE_PASSWORD: u16 = 4005;
pub const CLOSE_HOST_TAKEN: u16 = 4006;
pub const CLOSE_HOST_LEFT: u16 = 4007;
pub const CLOSE_DUPLICATE_NAME: u16 = 4008;

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
/// 用他自己的坐标去量必然判"太远"，表现就是"从属端改了方块，其他人看不到"。
pub const MAX_EDIT_DISTANCE: f64 = 64.0;

/// `move` 的最小间隔（毫秒）：比这更频繁的移动消息直接丢弃。
pub const MOVE_INTERVAL_MS: u64 = 50;

const DIMENSIONS: [&str; 3] = ["overworld", "nether", "end"];

/// 维度名收口：非法/缺失一律回主世界（它是数据表的 key 之一，拼错就永远对不上）。
pub fn sanitize_dimension(value: Option<&str>) -> &'static str {
    match value {
        Some(v) if DIMENSIONS.contains(&v) => match v {
            "nether" => "nether",
            "end" => "end",
            _ => "overworld",
        },
        _ => "overworld",
    }
}

/// 数字收口：NaN / 非数字 / 缺失都回落到默认值。
pub fn finite_number(value: Option<&serde_json::Value>, fallback: f64) -> f64 {
    value.and_then(|v| v.as_f64()).filter(|n| n.is_finite()).unwrap_or(fallback)
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
    if !is_host {
        let dx = f64::from(x) - player_xz.0;
        let dz = f64::from(z) - player_xz.1;
        if !(dx.is_finite() && dz.is_finite()) || dx.hypot(dz) > MAX_EDIT_DISTANCE {
            return Some("distance");
        }
    }
    None
}

/// 拼一个数据表的 key：`房名|维度|x,y,z`（与服务端 JS 版的 `scopedKey` 同形）。
pub fn scoped_key(room: &str, dimension: &str, x: i32, y: i32, z: i32) -> String {
    format!("{room}|{dimension}|{x},{y},{z}")
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
        assert_eq!(
            block_edit_rejection((0.0, 0.0), false, 500, 70, 500, 1, 0),
            Some("distance")
        );
    }

    #[test]
    fn scoped_key_shape_matches_js() {
        assert_eq!(scoped_key("red", "overworld", 1, 2, 3), "red|overworld|1,2,3");
    }
}
