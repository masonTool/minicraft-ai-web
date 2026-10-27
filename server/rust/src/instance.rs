//! 进程内唯一的服务实例（Android 的 JNI 与 iOS 的 C ABI 共用这一份）。
//!
//! 为什么不各写一份：两端的生命周期其实一模一样——"起一个独立线程 + 自己的 runtime →
//! 起服务 → 等停止标志 → 补存快照 → 退出"。写在两处的话，最容易分叉的是**停止时补存**
//! （一端有、一端忘），而那个 bug 的表现是"手机上玩了一下午，回来存档还是早上的"。
//!
//! 为什么要独立线程而不是复用宿主线程：Android 主线程不能 `block_on`（会 ANR），
//! iOS 主线程同理；而服务的生命周期比任何 Activity / ViewController 都长。

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::{start, Config};

struct Running {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
/// 运行中实例的 hub：iOS 的 Bonjour 浏览器要把找到的邻居塞进它的 peer 表。
///
/// 单独存一份而不是塞进 `Running`：`Running` 是"怎么停"的句柄（stop 标志 + 线程），
/// 而 hub 是"往里塞数据"的口子，两者的生命周期一样但用途不同，混在一起会让
/// `stop_instance` 的语义变得含糊。
static HUB: Mutex<Option<Arc<crate::handlers::Hub>>> = Mutex::new(None);
static PORT: AtomicI32 = AtomicI32::new(0);

/// 当前端口（`0` = 没在跑）。
pub fn port() -> i32 {
    PORT.load(Ordering::SeqCst)
}

/// 起服务，返回**实际监听端口**（`port = 0` 时由系统挑）；失败返回 `-1`。
///
/// 阻塞到端口绑好（最多 3 秒）——调用方应当在自己的工作线程上调（见上）。
pub fn start_instance(data_dir: &str, want_port: u16, seed: i64, beacon: bool) -> i32 {
    {
        // 已经在跑：直接把端口回给宿主（系统重启前台服务时会再调一次）
        let existing = port();
        if existing > 0 {
            if let Ok(slot) = RUNNING.lock() {
                if slot.is_some() {
                    return existing;
                }
            }
        }
    }

    let mut config = Config::from_env();
    config.data_dir = std::path::PathBuf::from(data_dir);
    /*
     * 宿主没指定端口时**不要**把它设成 0（用户 2026-10-27 实测发现）：
     * `TcpListener::bind(("0.0.0.0", 0))` 会由系统随机分配，而客户端默认连 8887、
     * 发现层广播的也是 8887——别人照着广播过来的端口连过去才连得上，但界面里手填
     * 的默认地址就永远是错的（表现为"手机开了房，别人怎么填都连不上"）。
     * 安卓的 Intent、iOS 的默认参数都是 0，所以这条是默认路径。
     */
    if want_port > 0 {
        config.port = want_port;
    }
    if seed != 0 {
        config.seed = seed;
    }
    config.beacon = beacon;

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread = std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("[embedded] tokio runtime 构建失败：{error}");
                return;
            }
        };
        runtime.block_on(async move {
            match start(config).await {
                Ok(server) => {
                    PORT.store(i32::from(server.port), Ordering::SeqCst);
                    if let Ok(mut slot) = HUB.lock() {
                        *slot = Some(server.hub.clone());
                    }
                    while !thread_stop.load(Ordering::Relaxed) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                    // 停之前补存一次：手机端进程随时会被系统干掉，30 秒定时器不一定轮得到
                    let saved = server.save().await;
                    println!("[embedded] 服务端停止，快照保存：{saved}");
                }
                Err(error) => eprintln!("[embedded] 启动失败：{error}"),
            }
        });
    });

    for _ in 0..100 {
        let started = PORT.load(Ordering::SeqCst);
        if started > 0 {
            if let Ok(mut slot) = RUNNING.lock() {
                *slot = Some(Running { stop, thread });
            }
            return started;
        }
        std::thread::sleep(Duration::from_millis(30));
        if thread.is_finished() {
            break;
        }
    }
    // 起不来：把线程收掉，别留下一个半死不活的 runtime
    stop.store(true, Ordering::Relaxed);
    let _ = thread.join();
    -1
}

/// 停服务（会先补存一次快照）。
pub fn stop_instance() {
    let running = RUNNING.lock().ok().and_then(|mut slot| slot.take());
    if let Some(running) = running {
        running.stop.store(true, Ordering::Relaxed);
        let _ = running.thread.join();
    }
    PORT.store(0, Ordering::SeqCst);
    if let Ok(mut slot) = HUB.lock() {
        *slot = None;
    }
}

/// 在服务运行时借用 hub（没在跑返回 `None`）。
///
/// 给平台壳的 C 入口用：它们在**宿主的线程**上调（不在 tokio runtime 里），
/// 所以可以安全地 `blocking_lock`（见 `capi::minicraft_add_bonjour_peer`）。
pub fn with_hub<T>(f: impl FnOnce(&Arc<crate::handlers::Hub>) -> T) -> Option<T> {
    let slot = HUB.lock().ok()?;
    let hub = slot.as_ref()?;
    Some(f(hub))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Instant;

    /// 真起一次：绑端口 → HTTP 有响应 → 停掉归零。
    ///
    /// 这一条覆盖的是**手机端唯二入口**（JNI / C ABI）共用的那段代码，所以它能过，
    /// Swift / Kotlin 那边调的就是一条已经验过的路。
    #[test]
    fn start_serves_http_and_stops() {
        let dir = std::env::temp_dir().join(format!("minicraft-instance-{}", crate::store::now_ms()));
        let port = start_instance(dir.to_str().unwrap(), 0, 20261014, false);
        assert!(port > 0, "应当绑定到一个真实端口，实际={port}");
        assert_eq!(port, self::port());

        // /healthz 起来了吗（服务端在自己的线程里跑，要等它 accept）
        let deadline = Instant::now() + std::time::Duration::from_secs(10);
        let mut body = String::new();
        while Instant::now() < deadline {
            if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port as u16)) {
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
                let _ = stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
                let mut text = String::new();
                if stream.read_to_string(&mut text).is_ok() && text.contains("200 OK") {
                    body = text;
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(body.contains("\"ok\":true"), "健康检查要有响应：{body}");
        assert!(body.contains("\"protocol\":2"), "协议版本要对：{body}");

        stop_instance();
        assert_eq!(0, self::port(), "停掉之后端口归零");
    }
}
