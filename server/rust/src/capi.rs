//! C ABI（iOS / 其它非 JVM 宿主）。
//!
//! Android 走 JNI（`src/jni.rs`），iOS 走这层 C 接口——Swift 直接 `import MinicraftServer`
//! 就能调（`server/ios/include/minicraft_server.h` 是同一份声明）。
//!
//! 与 JNI 共用 `instance` 里的生命周期：起/停/查端口，停之前补存一次快照。
//!
//! ⚠️ 只暴露最小面：这三个函数之外的任何东西都别从这里透出去——C ABI 一旦发布就
//! 很难改，而内部结构（tokio、serde）会一直变。

use std::ffi::{c_char, CStr};

use crate::instance;

/// 起服务，返回实际监听端口；失败返回 `-1`。
///
/// - `data_dir`：存档目录（UTF-8，`world.json` 落在它下面）；传 `NULL` 则用 `./.data`
/// - `port`：0 = 让系统挑
/// - `seed`：0 = 服务端默认种子
/// - `beacon`：非 0 = 开局域网发现（手机当房主时的主线功能）
///
/// # Safety
/// `data_dir` 必须是合法的 NUL 结尾 C 字符串（或 `NULL`）。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn minicraft_start_server(
    data_dir: *const c_char,
    port: i32,
    seed: i64,
    beacon: i32,
) -> i32 {
    let dir = if data_dir.is_null() {
        ".data".to_string()
    } else {
        // SAFETY: 调用方保证是 NUL 结尾的合法字符串（见上方 Safety）
        match unsafe { CStr::from_ptr(data_dir) }.to_str() {
            Ok(text) => text.to_string(),
            Err(_) => return -1,
        }
    };
    let port = u16::try_from(port).unwrap_or(0);
    instance::start_instance(&dir, port, seed, beacon != 0)
}

/// 停服务（会先补存一次快照）。
#[unsafe(no_mangle)]
pub extern "C" fn minicraft_stop_server() {
    instance::stop_instance();
}

/// 当前端口（`0` = 没在跑）。
#[unsafe(no_mangle)]
pub extern "C" fn minicraft_server_port() -> i32 {
    instance::port()
}
