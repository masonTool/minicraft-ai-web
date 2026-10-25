//! 世界快照落盘（联机13）。
//!
//! 三件事（与 `server/store.mjs` 同一套口径）：
//!  1. **原子写**：先写 `<file>.tmp` 再 `rename`——直接写目标文件的话，写到一半断电会
//!     留下半个 JSON，下次启动既读不出来、也没法判断它是不是"最后一版好数据"。
//!  2. **损坏回退**：读失败时把坏文件改名成 `<file>.broken-<时间戳>` 再重新开始。
//!     **不能静静删掉**——里面可能还有人工能救的部分。
//!  3. **定时 + 退出保存**：定时器兜住长期运行；正常退出（SIGINT / SIGTERM）再补一次。

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

/// 快照格式版本：字段一旦不兼容就 +1，读到不认识的版本按"损坏"处理。
pub const SNAPSHOT_VERSION: i64 = 1;

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 原子写：tmp + rename。返回是否成功（磁盘满/只读时不该把服务端搞崩）。
pub fn write_snapshot(file: &Path, data: &Value) -> bool {
    let tmp = file.with_extension("json.tmp");
    if let Some(parent) = file.parent() {
        if fs::create_dir_all(parent).is_err() {
            return false;
        }
    }
    let Ok(text) = serde_json::to_vec(data) else { return false };
    if fs::write(&tmp, text).is_err() {
        return false;
    }
    fs::rename(&tmp, file).is_ok()
}

/// 读快照：`None` = 没有文件或已损坏（损坏的那份会被备份，不会被覆盖）。
pub fn read_snapshot(file: &Path, log: &dyn Fn(&str)) -> Option<Value> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                log(&format!("读存档失败（{error}），按空世界启动"));
            }
            return None;
        }
    };
    let parsed = serde_json::from_str::<Value>(&text).ok();
    match parsed {
        Some(value) if value.is_object() && value.get("version").and_then(Value::as_i64) == Some(SNAPSHOT_VERSION) => {
            Some(value)
        }
        other => {
            let reason = match other {
                Some(value) => format!("版本 {} 不认识", value.get("version").map(|v| v.to_string()).unwrap_or_else(|| "?".into())),
                None => "不是合法 JSON".to_string(),
            };
            let backup = file.with_extension(format!("json.broken-{}", now_ms()));
            match fs::rename(file, &backup) {
                Ok(()) => log(&format!("存档损坏（{reason}），已备份为 {}，按空世界启动", backup.display())),
                Err(error) => log(&format!("存档损坏（{reason}），备份也失败（{error}），按空世界启动")),
            }
            None
        }
    }
}
