//! Android 的 JNI 胶水（Kotlin 侧对应 `com.minicraft.server.NativeServer`）。
//!
//! 只暴露三个函数：`startServer(dataDir, port, seed)` / `stopServer()` / `serverPort()`。
//! "常驻通知"（`ForegroundService`）与 `MulticastLock` 留在 Kotlin 里——那些是平台 API；
//! 服务端本身（tokio、广播、存档）在这里，两端不用各写一遍。
//!
//! 为什么起一个**独立线程 + 自己的 runtime**：Android 的主线程不能跑 tokio 的
//! block_on（会 ANR），而服务的生命周期比任何 Activity 都长（`ForegroundService`
//! 里跑）。线程活着 = 服务活着；`stopServer` 置标志、等线程收尾（会先补存一次快照）。
//!
//! ⚠️ 函数名必须与 Kotlin 的包名/类名逐字对应（`Java_<包>_<类>_<方法>`），
//! 改名时两边一起改，否则表现为 `UnsatisfiedLinkError`。

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use jni::objects::{JClass, JString};
use jni::sys::{jint, jlong};
use jni::JNIEnv;

use crate::{start, Config};

struct Running {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

/// 进程内只允许一个服务实例（Android 上就是"这台手机当一台服务器"）。
static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
/// 实际监听端口（`0` = 没在跑）。Kotlin 侧拿它去拼 `ws://127.0.0.1:<port>`。
static PORT: AtomicI32 = AtomicI32::new(0);

fn current_port() -> jint {
    PORT.load(Ordering::SeqCst)
}

/// 起服务；返回**实际监听端口**（`PORT=0` 时由系统挑），失败返回 `-1`。
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_minicraft_server_NativeServer_startServer<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    data_dir: JString<'local>,
    port: jint,
    seed: jlong,
) -> jint {
    // 已经在跑：直接回原来的端口（ForegroundService 被系统重启时会再调一次）
    if let Some(existing) = current_port().checked_abs() {
        if existing > 0 && RUNNING.lock().map(|slot| slot.is_some()).unwrap_or(false) {
            return existing;
        }
    }

    let Ok(dir) = env.get_string(&data_dir) else { return -1 };
    let mut config = Config::from_env();
    config.data_dir = std::path::PathBuf::from(String::from(dir));
    if port > 0 {
        config.port = port as u16;
    }
    if seed != 0 {
        config.seed = seed;
    }
    // 手机当房主时"别人找得到我"是主线功能（N4/N6），默认打开
    config.beacon = true;

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread = std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("[jni] tokio runtime 构建失败：{error}");
                return;
            }
        };
        runtime.block_on(async move {
            match start(config).await {
                Ok(server) => {
                    PORT.store(jint::from(server.port), Ordering::SeqCst);
                    while !thread_stop.load(Ordering::Relaxed) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                    // 停之前补存一次：Android 会随时把进程干掉，定时器可能还没轮到
                    let saved = server.save().await;
                    println!("[jni] 服务端停止，快照保存：{saved}");
                }
                Err(error) => eprintln!("[jni] 启动失败：{error}"),
            }
        });
    });

    // 等端口出现（最多 3 秒）：`start()` 里已经绑好端口才会打印，这里只是把它读回来
    for _ in 0..100 {
        let port = current_port();
        if port > 0 {
            if let Ok(mut slot) = RUNNING.lock() {
                *slot = Some(Running { stop, thread });
            }
            return port;
        }
        std::thread::sleep(Duration::from_millis(30));
        if thread.is_finished() {
            break;
        }
    }
    stop.store(true, Ordering::Relaxed);
    let _ = thread.join();
    -1
}

/// 停服务（会先补存一次快照）。
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_minicraft_server_NativeServer_stopServer(
    _env: JNIEnv,
    _class: JClass,
) {
    let running = RUNNING.lock().ok().and_then(|mut slot| slot.take());
    if let Some(running) = running {
        running.stop.store(true, Ordering::Relaxed);
        let _ = running.thread.join();
    }
    PORT.store(0, Ordering::SeqCst);
}

/// 当前端口（`0` = 没在跑）。
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_minicraft_server_NativeServer_serverPort(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    current_port()
}
