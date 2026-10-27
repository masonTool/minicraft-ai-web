//! Rust 版联机服务端（库入口）
//!
//! `main.rs` 只是"读环境变量 → `start()` → 等信号"的薄壳；真正的启动逻辑在这里，
//! 因为 Android 的 JNI（`src/jni.rs`）与将来 iOS 的入口要调**同一份**——
//! 两份启动逻辑必然漂（最典型的是端口与存档目录各写一遍，然后有一端忘了补存）。
//!
//! 目标形态：**一套代码编两端**（`cargo-ndk` → `.so`；`staticlib` → `.xcframework`），
//! 所以这里不碰任何平台 API：UDP 广播是纯 Rust（`beacon.rs`），平台壳只差一个
//! `MulticastLock`（Android）/ `NSNetService`（iOS）。
//!
//! **行为契约**是 `docs/NET-PROTOCOL.md` 与 `tools/net-test.mjs`（195 条黑盒断言）。

pub mod aoi;
pub mod beacon;
pub mod capi;
pub mod handlers;
pub mod instance;
pub mod jni;
pub mod protocol;
pub mod ratelimit;
pub mod state;
pub mod store;

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{accept_async_with_config, WebSocketStream};

use handlers::{Conn, Hub};
use protocol::{
    DEFAULT_PORT, GRACE_MS_DEFAULT, MAX_PAYLOAD_BYTES, PROTOCOL_VERSION, WORLD_SEED_DEFAULT,
};
use state::{State, Traffic};

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
pub const HEARTBEAT_TIMEOUT_MS: u64 = 20_000;
pub const CLOCK_INTERVAL: Duration = Duration::from_secs(2);
pub const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------- 配置

/// 启动参数。桌面/服务器从环境变量来，Android/iOS 由平台壳直接构造。
#[derive(Debug, Clone)]
pub struct Config {
    /// 监听端口；`0` = 让系统挑（测试用，避免两棵并行工作树撞车）
    pub port: u16,
    pub seed: i64,
    /// 断线宽限期（毫秒）
    pub grace_ms: u64,
    /// 空 = 不校验
    pub password: String,
    /// 空 = 不校验来源
    pub allowed_origins: Vec<String>,
    /// 存档目录（里面是 `world.json`）
    pub data_dir: PathBuf,
    /// 是否发 UDP 广播（默认关：命令行/CI 不需要，手机端打开）
    pub beacon: bool,
    pub beacon_port: u16,
    /// 发现用哪块网卡（`0.0.0.0` = 系统默认；同机验收时显式指 `127.0.0.1`）
    pub beacon_if: std::net::Ipv4Addr,
    /// 一个房间的容量（只用于 `/rooms` 显示 `在线/容量`，**不是准入限制**）
    pub max_players: u32,
    /// 允许进"没有房主"的房间（`ALLOW_HOSTLESS_ROOMS=1`，**只给测试**）
    ///
    /// 与 Node 版同名开关同一口径：联机套件里绝大多数用例是"单人连上去测同步"，
    /// 并不建立房主，不放开的话它们会全被 `no-host` 拒掉。
    pub allow_hostless_rooms: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let port = std::env::var("PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(DEFAULT_PORT);
        let seed = std::env::var("SEED").ok().and_then(|value| value.parse().ok()).unwrap_or(WORLD_SEED_DEFAULT);
        let grace_ms = std::env::var("GRACE_MS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(GRACE_MS_DEFAULT);
        let password = std::env::var("ROOM_PASSWORD").unwrap_or_default();
        let allowed_origins: Vec<String> = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| ".data".to_string());
        let beacon = matches!(std::env::var("BEACON").ok().as_deref(), Some("1") | Some("true") | Some("yes"));
        let beacon_port = std::env::var("BEACON_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(beacon::BEACON_PORT);
        let beacon_if = std::env::var("BEACON_IF")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(std::net::Ipv4Addr::UNSPECIFIED);
        // 房间容量（默认 10，与 Node 版 `MAX_PLAYERS` 同口径）；脏值/0 退回默认
        let max_players = std::env::var("MAX_PLAYERS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(10);
        let allow_hostless_rooms = std::env::var("ALLOW_HOSTLESS_ROOMS").ok().as_deref() == Some("1");
        Self {
            port,
            seed,
            grace_ms,
            password,
            allowed_origins,
            data_dir: PathBuf::from(data_dir),
            beacon,
            beacon_port,
            beacon_if,
            max_players,
            allow_hostless_rooms,
        }
    }
}

// ---------------------------------------------------------------- 服务实例

/// 一个跑起来的服务端。`drop` 不会自动停（任务会被 abort），要收尾请先 `save()`。
pub struct Server {
    /// 实际监听的端口（`config.port = 0` 时由系统挑）
    pub port: u16,
    pub hub: Arc<Hub>,
    stop: Arc<AtomicBool>,
    tasks: Vec<JoinHandle<()>>,
}

impl Server {
    /// 请求停止（`wait_stop` 会返回）。不在这里保存快照：调用方决定收尾顺序。
    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    /// 等到 `request_stop` 被调用。
    pub async fn wait_stop(&self) {
        while !self.stop.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// 立刻落盘一次（正常退出 / Android 服务被停时调）。
    pub async fn save(&self) -> bool {
        let snapshot = {
            let st = self.hub.state.lock().await;
            st.world_snapshot()
        };
        store::write_snapshot(&self.hub.data_file, &snapshot)
    }

    /// 停掉后台任务（时钟 / 天气 / 定时存档 / 发现 / accept 循环）。
    pub fn abort_tasks(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
        self.tasks.clear();
    }
}

/// 起一个服务端：绑端口 → 读档 → 起定时任务 → 开始 accept。
///
/// 只在**已经在一个 tokio runtime 里**时调用（`main` / `jni` / 单测都各自提供）。
pub async fn start(config: Config) -> io::Result<Server> {
    let log = |message: &str| println!("[server] {message}");
    let data_file = config.data_dir.join("world.json");

    let mut state = State::new(config.seed);
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
        seed: config.seed,
        grace_ms: config.grace_ms,
        password: config.password.clone(),
        allowed_origins: config.allowed_origins.clone(),
        data_file: data_file.clone(),
        instance: beacon::new_instance_id(),
        beacon_on: config.beacon,
        peers: Mutex::new(beacon::PeerBook::new()),
        max_players: config.max_players,
        allow_hostless_rooms: config.allow_hostless_rooms,
        beacon_port: config.beacon_port,
    });

    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    // 打**实际绑定**的端口：`PORT=0` 时由系统挑
    let port = listener.local_addr().map(|addr| addr.port())?;

    let stop = Arc::new(AtomicBool::new(false));
    let mut tasks = vec![
        spawn_clock(hub.clone()),
        spawn_weather(hub.clone()),
        spawn_autosave(hub.clone()),
    ];
    if config.beacon {
        tasks.push(spawn_beacon(hub.clone(), port, config.beacon_port, config.beacon_if));
    }
    tasks.push(spawn_accept(listener, hub.clone()));

    println!("[server] 已启动，端口 {port}，种子 {}（Rust 版）", config.seed);
    if !hub.allowed_origins.is_empty() {
        println!("[server] 来源白名单：{}", hub.allowed_origins.join(", "));
    }
    if !hub.password.is_empty() {
        println!("[server] 已启用房间口令（ROOM_PASSWORD）");
    }
    if config.beacon {
        println!("[server] 已开启局域网发现（UDP {}）", config.beacon_port);
    }

    Ok(Server { port, hub, stop, tasks })
}

fn spawn_accept(listener: TcpListener, hub: Arc<Hub>) -> JoinHandle<()> {
    tokio::spawn(async move {
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
    })
}

// ---------------------------------------------------------------- 定时任务

fn spawn_clock(hub: Arc<Hub>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(CLOCK_INTERVAL);
        loop {
            ticker.tick().await;
            let st = hub.state.lock().await;
            if st.players.is_empty() {
                continue;
            }
            // **按房各发一份**（用户 2026-10-26：每房一套时钟）——以前是全服一个时间戳，
            // 甲房在半夜、乙房在正午也只能发同一个值。
            let rooms = st.rooms_in_use();
            for room in rooms {
                let (time, day) = {
                    let clock = st.clock_of(&room);
                    (clock.time_of_day(), clock.day())
                };
                st.broadcast(
                    &room,
                    None,
                    &json!({"t": "time", "timeOfDay": time, "day": day}),
                    None,
                    &hub.traffic,
                );
            }
        }
    })
}

/// 天气权威：晴天 8~16 分钟、雨天/雷暴 2~5 分钟，切换时按房广播。
fn spawn_weather(hub: Arc<Hub>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(CLOCK_INTERVAL);
        loop {
            ticker.tick().await;
            let mut st = hub.state.lock().await;
            if st.players.is_empty() {
                continue;
            }
            // **每个房间各跑各的天气**（每房一套时钟）：甲房下着雨，乙房可以是晴天
            let rooms = st.rooms_in_use();
            for room in rooms {
                let changed = {
                    let clock = st.clock_mut(&room);
                    clock.weather.left -= CLOCK_INTERVAL.as_secs_f64();
                    if clock.weather.left <= 0.0 {
                        let next = state::next_weather_kind(&clock.weather.kind);
                        clock.weather = state::Weather {
                            kind: next.to_string(),
                            left: state::next_weather_seconds(next),
                        };
                        Some(clock.weather.kind.clone())
                    } else {
                        None
                    }
                };
                if let Some(kind) = changed {
                    st.broadcast(
                        &room,
                        None,
                        &json!({"t": "weather", "kind": kind}),
                        None,
                        &hub.traffic,
                    );
                }
            }
        }
    })
}

fn spawn_autosave(hub: Arc<Hub>) -> JoinHandle<()> {
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
    })
}

/// 局域网发现：每 3 秒发一帧 + 收别人的帧进 `peers`。
///
/// 同一帧发三处：**组播组**（主通道，所有加入组的实例都收得到）、**广播地址**
/// （组播被网络挡住时的兜底）、**回环**（同机双开时最省事的一条路）。
fn spawn_beacon(
    hub: Arc<Hub>,
    port: u16,
    beacon_port: u16,
    interface: std::net::Ipv4Addr,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let listener = match beacon::bind_listener(beacon_port, interface) {
            Ok(socket) => socket,
            Err(error) => {
                eprintln!("[server] 发现端口 {beacon_port} 绑定失败（{error}），局域网发现关闭");
                return;
            }
        };
        let sender = match beacon::bind_sender(interface) {
            Ok(socket) => socket,
            Err(error) => {
                eprintln!("[server] 发现发送 socket 创建失败（{error}），局域网发现关闭");
                return;
            }
        };
        let listener = match tokio::net::UdpSocket::from_std(listener) {
            Ok(socket) => socket,
            Err(error) => {
                eprintln!("[server] 发现端口转 tokio 失败（{error}），局域网发现关闭");
                return;
            }
        };
        let sender = match tokio::net::UdpSocket::from_std(sender) {
            Ok(socket) => socket,
            Err(error) => {
                eprintln!("[server] 发现发送 socket 转 tokio 失败（{error}），局域网发现关闭");
                return;
            }
        };
        let mut ticker = tokio::time::interval(Duration::from_millis(beacon::DEFAULT_INTERVAL_MS));
        let mut buffer = [0u8; 2048];
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    let mut announce = {
                        let st = hub.state.lock().await;
                        beacon::announce_of(&st, &hub.instance, !hub.password.is_empty())
                    };
                    announce.port = port;
                    let payload = beacon::encode(&announce);
                    let _ = sender.send_to(&payload, beacon::multicast_addr(beacon_port)).await;
                    let _ = sender.send_to(&payload, beacon::broadcast_addr(beacon_port)).await;
                }
                received = listener.recv_from(&mut buffer) => {
                    let Ok((len, addr)) = received else { continue };
                    let Some(announce) = beacon::decode(&buffer[..len]) else { continue };
                    let now = store::now_ms();
                    let mut peers = hub.peers.lock().await;
                    if peers.observe(&hub.instance, announce.clone(), addr, now) {
                        println!(
                            "[server] 发现房间「{}」（{}:{}/{} 人）",
                            announce.name, addr.ip(), announce.port, announce.players
                        );
                    }
                    peers.prune(now);
                }
            }
        }
    })
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
    if path == "/ping" {
        /*
         * 局域网扫描的无状态探针（`core/net/ServerDiscovery.ts` 探它）。
         *
         * **必须有**：客户端"扫网段"只认能回 `/ping` 的机器；Rust 版以前没有这个路由，
         * 于是手机上跑的服务端在「选择服务器」里永远扫不到（只有组播 beacon 能让
         * 别的服务端看见它）。不建玩家、不占房主位，也不能被缓存。
         */
        let body = json!({"ok": true, "t": store::now_ms(), "v": PROTOCOL_VERSION}).to_string();
        write_http(
            stream,
            200,
            "application/json; charset=utf-8",
            &body,
            // CORS 必须有：浏览器从页面跨源探 `/ping` 做局域网扫描（同 `/rooms`）
            &[
                ("access-control-allow-origin", "*"),
                ("cache-control", "no-store, no-cache, must-revalidate"),
            ],
        )
        .await;
        return;
    }
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
            // 房间容量（只给界面显示 `在线/容量`；不拒绝第 N+1 个人，见 Node 版同名字段）
            "maxPlayers": hub.max_players,
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
        let peers: Vec<serde_json::Value> = hub.peers.lock().await.list().iter().map(|peer| peer.to_wire()).collect();
        let body = json!({
            "ok": true,
            "players": st.players.len(),
            "rooms": st.rooms_in_use().len(),
            "uptime": hub.started.elapsed().as_secs(),
            "seed": hub.seed,
            "protocol": PROTOCOL_VERSION,
            // 局域网发现（N4）：`beacon` 说明本进程有没有在广播，`peers` 是听到的其它实例
            "beacon": hub.beacon_on,
            // 与 Node 版同名字段（客户端只读 peers，但两端字段对齐才好排查）
            "beaconPort": hub.beacon_port,
            "peers": peers,
            "traffic": hub.traffic.rates(),
            "totals": {
                "inBytes": hub.traffic.in_bytes.load(Ordering::Relaxed),
                "outBytes": hub.traffic.out_bytes.load(Ordering::Relaxed),
            },
        })
        .to_string();
        // 面板要从游戏页面跨源读它（`peers` 就在这里），所以和 `/rooms` 一样带 CORS
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

    let last_pong = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let mut conn = Conn::new(tx.clone(), hub.started);
    let heartbeat = {
        let tx = tx.clone();
        let last_pong = last_pong.clone();
        let base = hub.started;
        tokio::spawn(async move {
            use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
            use tokio_tungstenite::tungstenite::protocol::CloseFrame;
            use tokio_tungstenite::tungstenite::Message;
            let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
            ticker.tick().await; // 第一次立即到点：join 时已经单独探过一次
            loop {
                ticker.tick().await;
                let now = base.elapsed().as_millis() as u64;
                if now.saturating_sub(last_pong.load(Ordering::Relaxed)) > HEARTBEAT_TIMEOUT_MS {
                    let _ = tx.send(Message::Close(Some(CloseFrame {
                        code: CloseCode::Away,
                        reason: "心跳超时".into(),
                    })));
                    break;
                }
                let _ = tx.send(Message::Ping(Vec::new().into()));
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
                    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
                    use tokio_tungstenite::tungstenite::protocol::CloseFrame;
                    use tokio_tungstenite::tungstenite::Message;
                    // 与 JS 版 `ws` 的 maxPayload 一致：超了就是 1009，而不是无声断连
                    let _ = tx.send(Message::Close(Some(CloseFrame {
                        code: CloseCode::Size,
                        reason: "payload too large".into(),
                    })));
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
