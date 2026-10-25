//! Android 的 JNI 胶水（Kotlin/Java 侧对应 `com.minicraft.server.NativeServer`）。
//!
//! 只暴露三个函数：`startServer(dataDir, port, seed)` / `stopServer()` / `serverPort()`。
//! "常驻通知"（`ForegroundService`）与 `MulticastLock` 留在平台壳里——那些是平台 API；
//! 生命周期（独立线程 + runtime + 停前补存）在 `instance` 里，与 iOS 的 C ABI 共用。
//!
//! ⚠️ 函数名必须与包名/类名逐字对应（`Java_<包>_<类>_<方法>`），改名时两边一起改，
//! 否则表现为 `UnsatisfiedLinkError`。

use jni::objects::{JClass, JString};
use jni::sys::{jint, jlong};
use jni::JNIEnv;

use crate::instance;

/// 起服务；返回**实际监听端口**，失败返回 `-1`。
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_minicraft_server_NativeServer_startServer<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    data_dir: JString<'local>,
    port: jint,
    seed: jlong,
) -> jint {
    let Ok(dir) = env.get_string(&data_dir) else { return -1 };
    let dir: String = dir.into();
    // 手机当房主时"别人找得到我"是主线功能（发现层），默认打开
    instance::start_instance(&dir, u16::try_from(port).unwrap_or(0), seed, true)
}

/// 停服务（会先补存一次快照）。
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_minicraft_server_NativeServer_stopServer(
    _env: JNIEnv,
    _class: JClass,
) {
    instance::stop_instance();
}

/// 当前端口（`0` = 没在跑）。
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_minicraft_server_NativeServer_serverPort(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    instance::port()
}
