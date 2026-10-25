//! Rust 版联机服务端（Android / iOS 共用）
//!
//! 目标形态：**一套代码编两端**（`cargo-ndk` → `.so`，`staticlib` → `.xcframework`），
//! 所以这里刻意不碰任何平台 API：不做 UDP 广播、不做 Bonjour、不碰 Android 的
//! `MulticastLock`——那些留在平台壳（Kotlin / Swift）里，各几十行。
//!
//! **行为契约**是 `docs/NET-PROTOCOL.md` 与 `tools/net-test.mjs`（1871 行黑盒断言）。
//! 这个文件的目标不是"看起来像"，而是"跑得过那套断言"。
//!
//! 同一端口既跑 WebSocket 也跑 HTTP（`/healthz`、`/rooms`）：容器/反代只需要暴露一个口，
//! 普通请求在这里就地答，升级请求交给 tungstenite。

mod aoi;
mod handlers;
mod protocol;
mod ratelimit;
mod state;
mod store;

use std::collections::HashMap;
use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{accept_async_with_config, WebSocketStream};

use handlers::{Conn, Hub};
use protocol::{
    DEFAULT_PORT, GRACE_MS_DEFAULT, MAX_PAYLOAD_BYTES, PROTOCOL_VERSION, WORLD_SEED_DEFAULT,
};
use state::{State, Traffic};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const HEARTBEAT_TIMEOUT_MS: u64 = 20_000;
const CLOCK_INTERVAL: Duration = Duration::from_secs(2);
const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(30);

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(DEFAULT_PORT);
    let seed: i64 = std::env::var("SEED").ok().and_then(|value| value.parse().ok()).unwrap_or(WORLD_SEED_DEFAULT);
    let grace_ms: u64 = std::env::var("GRACE_MS").ok().and_then(|value| value.parse().ok()).unwrap_or(GRACE_MS_DEFAULT);
    let password = std::env::var("ROOM_PASSWORD").unwrap_or_default();
    let allowed_origins: Vec<String> = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| ".data".to_string());
    let data_file = std::path::Path::new(&data_dir).join("world.json");

    let log = |message: &str| println!("[server] {message}");

    let mut state = State::new(seed);
    if let Some(saved) = store::read_snapshot(&data_file, &log) {
        state.apply_snapshot(&saved);
        log(&format!(
            "读档完成：方块 {} 条 / 容器 {} 个 / 时间 {:.2}",
            state.edits.len(),
            state.containers.len(),
            state.current_time_of_day()
        ));
    }

    let hub = Arc::new(Hub {
        state: Mutex::new(state),
        traffic: Arc::new(Traffic::new()),
        started: Instant::now(),
        seed,
        grace_ms,
        password,
        allowed_origins,
        data_file: data_file.clone(),
    });

    spawn_clock(hub.clone());
    spawn_weather(hub.clone());
    spawn_autosave(hub.clone());
    spawn_shutdown(hub.clone());

    let listener = match TcpListener::bind(("0.0.0.0", port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("[server] 绑定 0.0.0.0:{port} 失败：{error}");
            std::process::exit(1);
        }
    };
    // 打**实际绑定**的端口：`PORT=0` 时由系统挑端口（测试用，避免两棵并行工作树撞车）
    let bound = listener.local_addr().map(|addr| addr.port()).unwrap_or(port);
    println!("[server] 已启动，端口 {bound}，种子 {seed}（Rust 版）");
    if !hub.allowed_origins.is_empty() {
        println!("[server] 来源白名单：{}", hub.allowed_origins.join(", "));
    }
    if !hub.password.is_empty() {
        println!("[server] 已启用房间口令（ROOM_PASSWORD）");
    }

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let hub = hub.clone();
                tokio::spawn(async move {
                    handle_client(stream, hub, addr).await;
                });
            }
            Err(error) => eprintln!("[server] accept 失败：{error}"),
        }
    }
}

// ---------------------------------------------------------------- 定时任务

fn spawn_clock(hub: Arc<Hub>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(CLOCK_INTERVAL);
        loop {
            ticker.tick().await;
            let st = hub.state.lock().await;
            if st.players.is_empty() {
                continue;
            }
            let time = st.current_time_of_day();
            let rooms = st.rooms_in_use();
            for room in rooms {
                st.broadcast(&room, None, &json!({"t": "time", "timeOfDay": time}), None, &hub.traffic);
            }
        }
    });
}

/// 天气权威：晴天 8~16 分钟、雨天/雷暴 2~5 分钟，切换时按房广播。
fn spawn_weather(hub: Arc<Hub>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(CLOCK_INTERVAL);
        loop {
            ticker.tick().await;
            let mut st = hub.state.lock().await;
            st.weather.left -= CLOCK_INTERVAL.as_secs_f64();
            if st.weather.left > 0.0 {
                continue;
            }
            let next = state::next_weather_kind(&st.weather.kind);
            st.weather = state::Weather {
                kind: next.to_string(),
                left: state::next_weather_seconds(next),
            };
            let kind = st.weather.kind.clone();
            if st.players.is_empty() {
                continue;
            }
            let rooms = st.rooms_in_use();
            for room in rooms {
                st.broadcast(&room, None, &json!({"t": "weather", "kind": kind}), None, &hub.traffic);
            }
        }
    });
}

fn spawn_autosave(hub: Arc<Hub>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(AUTOSAVE_INTERVAL);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let snapshot = {
                let st = hub.state.lock().await;
                st.world_snapshot()
            };
            if !store::write_snapshot(&hub.data_file, &snapshot) {
                println!("[server] 定时保存失败（磁盘满或无权限？）");
            }
        }
    });
}

/// 正常退出（SIGINT / SIGTERM）时补存一次——定时器是 30 秒一轮，最后这几秒的改动不能白丢。
fn spawn_shutdown(hub: Arc<Hub>) {
    tokio::spawn(async move {
        wait_for_signal().await;
        println!("[server] 收到退出信号，保存快照并关闭服务端");
        let snapshot = {
            let st = hub.state.lock().await;
            st.world_snapshot()
        };
        if store::write_snapshot(&hub.data_file, &snapshot) {
            println!("[server] 快照已保存（{}）", hub.data_file.display());
        } else {
            eprintln!("[server] 快照保存失败（{}）", hub.data_file.display());
        }
        std::process::exit(0);
    });
}

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

// ---------------------------------------------------------------- HTTP / WebSocket 分流

/// 把已经读出来的请求头"接回"流上，交给 tungstenite 完成握手。
///
/// 为什么要先自己读一段：同一个端口既要有 `/healthz`、又要有 WebSocket 升级。
/// 先读请求头，普通 GET 就地答（不升级）；升级请求把这段字节原样喂回去。
struct Prefixed {
    head: Vec<u8>,
    pos: usize,
    inner: TcpStream,
}

impl AsyncRead for Prefixed {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.pos < this.head.len() {
            let count = buf.remaining().min(this.head.len() - this.pos);
            buf.put_slice(&this.head[this.pos..this.pos + count]);
            this.pos += count;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for Prefixed {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

/// 读请求头（最多 16KB）：返回原始字节、路径、小写键的头部表。
async fn read_head(stream: &mut TcpStream) -> Option<(Vec<u8>, String, HashMap<String, String>)> {
    let mut head: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        if head.len() > 16 * 1024 {
            return None;
        }
        let read = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut chunk))
            .await
            .ok()?
            .ok()?;
        if read == 0 {
            return None;
        }
        head.extend_from_slice(&chunk[..read]);
        if head.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8_lossy(&head).to_string();
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Some((head, path, headers))
}

async fn serve_http(stream: &mut TcpStream, hub: &Arc<Hub>, path: &str) {
    let path = path.split('?').next().unwrap_or("/");
    if path == "/rooms" {
        let st = hub.state.lock().await;
        let mut rooms: Vec<(String, u32, bool)> = Vec::new();
        for player in st.players.values() {
            match rooms.iter_mut().find(|(room, _, _)| room == &player.room) {
                Some(entry) => {
                    entry.1 += 1;
                    entry.2 |= player.is_host;
                }
                None => rooms.push((player.room.clone(), 1, player.is_host)),
            }
        }
        rooms.sort_by(|a, b| a.0.cmp(&b.0));
        let listing: Vec<serde_json::Value> = rooms
            .iter()
            .map(|(room, players, has_host)| {
                json!({
                    "room": room,
                    "players": players,
                    "hasHost": has_host,
                    "world": st.world_of_room(room).to_wire(),
                })
            })
            .collect();
        let body = json!({
            "ok": true,
            "protocol": PROTOCOL_VERSION,
            // 服务端级口令：只说"要不要"，不下发口令本身
            "passwordRequired": !hub.password.is_empty(),
            "rooms": listing,
        })
        .to_string();
        // 浏览器从 5173 跨源读它，必须带 CORS
        write_http(
            stream,
            200,
            "application/json; charset=utf-8",
            &body,
            &[("access-control-allow-origin", "*"), ("cache-control", "no-store")],
        )
        .await;
        return;
    }
    if path == "/healthz" {
        let st = hub.state.lock().await;
        let body = json!({
            "ok": true,
            "players": st.players.len(),
            "rooms": st.rooms_in_use().len(),
            "uptime": hub.started.elapsed().as_secs(),
            "seed": hub.seed,
            "protocol": PROTOCOL_VERSION,
            "traffic": hub.traffic.rates(),
            "totals": {
                "inBytes": hub.traffic.in_bytes.load(Ordering::Relaxed),
                "outBytes": hub.traffic.out_bytes.load(Ordering::Relaxed),
            },
        })
        .to_string();
        write_http(stream, 200, "application/json; charset=utf-8", &body, &[]).await;
        return;
    }
    write_http(
        stream,
        404,
        "text/plain; charset=utf-8",
        "minicraft multiplayer server（WebSocket 请连这个地址的根路径）",
        &[],
    )
    .await;
}

async fn write_http(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
    extra: &[(&str, &str)],
) {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        _ => "OK",
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n",
        body.len()
    );
    for (key, value) in extra {
        head.push_str(&format!("{key}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.flush().await;
}

async fn handle_client(stream: TcpStream, hub: Arc<Hub>, addr: std::net::SocketAddr) {
    let mut stream = stream;
    let Some((head, path, headers)) = read_head(&mut stream).await else { return };
    let upgrade = headers
        .get("upgrade")
        .map(|value| value.to_ascii_lowercase().contains("websocket"))
        .unwrap_or(false);
    if !upgrade {
        serve_http(&mut stream, &hub, &path).await;
        return;
    }

    /*
     * 载荷上限：tungstenite 的 `max_message_size` 设成 4MB（兜住"先分配再解析"），
     * **64KB 这条业务线由我们自己判**——超了要回 close 1009，而 tungstenite 在
     * 协议层报错时只会把连接拆掉（客户端看到 1006），测试断言的对不上。
     */
    let config = WebSocketConfig::default()
        .max_message_size(Some(4 * 1024 * 1024))
        .max_frame_size(Some(4 * 1024 * 1024));
    let prefixed = Prefixed { head, pos: 0, inner: stream };
    let ws = match accept_async_with_config(prefixed, Some(config)).await {
        Ok(ws) => ws,
        Err(error) => {
            println!("[server] {addr} 握手失败：{error}");
            return;
        }
    };
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let traffic = hub.traffic.clone();

    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    let last_pong = Arc::new(AtomicU64::new(0));
    let mut conn = Conn::new(tx.clone(), hub.started);
    let heartbeat = {
        let tx = tx.clone();
        let last_pong = last_pong.clone();
        let base = hub.started;
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
            ticker.tick().await; // 第一次立即到点：join 时已经单独探过一次
            loop {
                ticker.tick().await;
                let now = base.elapsed().as_millis() as u64;
                if now.saturating_sub(last_pong.load(Ordering::Relaxed)) > HEARTBEAT_TIMEOUT_MS {
                    let _ = tx.send(tokio_tungstenite::tungstenite::Message::Close(Some(
                        tokio_tungstenite::tungstenite::protocol::CloseFrame {
                            code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Away,
                            reason: "心跳超时".into(),
                        },
                    )));
                    break;
                }
                let _ = tx.send(tokio_tungstenite::tungstenite::Message::Ping(Vec::new().into()));
            }
        })
    };

    // 来源白名单：只挡**带 Origin 且不在白名单**的连接（无 Origin 的 node 机器人放行）
    if !hub.allowed_origins.is_empty() {
        if let Some(origin) = headers.get("origin") {
            if !hub.allowed_origins.iter().any(|allowed| allowed == origin) {
                conn.reject(
                    &traffic,
                    "origin",
                    &format!("来源不被允许：{origin}"),
                    protocol::CLOSE_ORIGIN,
                );
                heartbeat.abort();
                drop(conn);
                drop(tx);
                let _ = tokio::time::timeout(Duration::from_millis(500), writer).await;
                return;
            }
        }
    }

    loop {
        let Some(frame) = source.next().await else { break };
        match frame {
            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                if text.len() > MAX_PAYLOAD_BYTES {
                    // 与 JS 版 `ws` 的 maxPayload 一致：超了就是 1009，而不是无声断连
                    let _ = tx.send(tokio_tungstenite::tungstenite::Message::Close(Some(
                        tokio_tungstenite::tungstenite::protocol::CloseFrame {
                            code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Size,
                            reason: "payload too large".into(),
                        },
                    )));
                    break;
                }
                traffic.count_in(text.len());
                if !handlers::on_text(&hub, &mut conn, text.as_str()).await {
                    break;
                }
            }
            Ok(tokio_tungstenite::tungstenite::Message::Pong(_)) => {
                last_pong.store(conn.now_ms(), Ordering::Relaxed);
            }
            Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => break,
            Ok(_) => {}
            Err(error) => {
                println!("[server] {addr} 读帧出错：{error}");
                break;
            }
        }
    }

    handlers::on_close(&hub, &mut conn).await;
    heartbeat.abort();
    /*
     * 先关写队列、等它把最后几条消息冲出去，再收尾。
     *
     * 直接 `abort` 写任务会**丢掉"拒绝加入"那一帧**（error + close）：那时客户端
     * 只会等到超时——表现是"点了加入没反应"，最难查的一类失败。
     */
    drop(conn);
    drop(tx);
    if tokio::time::timeout(Duration::from_millis(500), writer).await.is_err() {
        println!("[server] 写队列 500ms 未排空，强制关闭");
    }
}

/// 让 `WebSocketStream` 的类型在签名里可读（只在内部使用）。
#[allow(dead_code)]
type Ws = WebSocketStream<Prefixed>;
