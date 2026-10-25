//! 桌面 / 服务器入口（薄壳）
//!
//! 只做三件事：读环境变量 → `minicraft_server::start()` → 等退出信号时补存一次。
//! 真正的启动逻辑在 `lib.rs`——Android 的 JNI 入口要调同一份。

use minicraft_server::{start, Config};

#[tokio::main]
async fn main() {
    let config = Config::from_env();
    let server = match start(config).await {
        Ok(server) => server,
        Err(error) => {
            eprintln!("[server] 启动失败：{error}");
            std::process::exit(1);
        }
    };

    wait_for_signal().await;
    println!("[server] 收到退出信号，保存快照并关闭服务端");
    if server.save().await {
        println!("[server] 快照已保存（{}）", server.hub.data_file.display());
    } else {
        eprintln!("[server] 快照保存失败（{}）", server.hub.data_file.display());
    }
    // 定时任务与连接都还在跑：直接退出，与 JS 版的 `process.exit(0)` 同义
    std::process::exit(0);
}

/// SIGINT / SIGTERM。Ctrl+C 与容器的 `docker stop` 都走这条路。
async fn wait_for_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(stream) => stream,
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = terminate.recv() => {},
            _ = tokio::signal::ctrl_c() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
