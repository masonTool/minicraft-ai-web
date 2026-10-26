//! 局域网发现（Android UDP beacon 的**纯 Rust** 那一半）。
//!
//! 为什么放在 Rust 里而不是 Kotlin / Swift 各写一份：协议、端口、报文格式必须两端一致，
//! 写两份必然漂；这里只有一个 `encode` / `decode` 与一本 peer 表，平台壳只差
//! "拿一个 `MulticastLock`（Android）"或"注册一个 `NSNetService`（iOS，N5 那一半）"。
//!
//! 报文是极简 JSON 文本（一秒钟才几条，可读性比省字节重要）：
//!
//! ```json
//! {"mc":"minicraft","v":2,"id":"3f9a1c07","port":8887,"name":"草原小屋",
//!  "seed":424242,"players":2,"host":true,"pw":false}
//! ```
//!
//! **自己的回声要过滤**：UDP 广播会回送到本机监听 socket（同机开两个实例时两边都能
//! 收到，那是想要的），但"自己发自己收"会让玩家在房间列表里看到自己那一间两次。
//! 靠 `id`（进程启动时生成的 8 位 hex）过滤。

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};

use serde_json::{json, Value};

use crate::protocol::PROTOCOL_VERSION;
use crate::state::State;

/// 发现用的 UDP 端口（与 TCP 的 8887 相邻但不冲突）。
pub const BEACON_PORT: u16 = 25188;
/// 发现用的组播组（IPv4 本地管理段 239.0.0.0/8）。
///
/// 为什么是**组播**而不是广播：同一台机器上两个实例（双开 / 测试）都要收到同一帧，
/// 而 BSD/macOS 的 `SO_REUSEPORT` 对 **广播** 是"按 4 元组哈希挑一个 socket"，
/// 结果是一个实例收得到、另一个收不到（实测：A 看得见 B，B 看不见 A）。
/// 组播按"加入组"投递，所有成员都收得到——这也是 Bonjour / mDNS 的做法，
/// Android 侧需要的那个 `MulticastLock` 就是为它准备的。
pub const MULTICAST_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 42, 99);
/// 报文里的魔数：端口上可能还有别的程序在发东西，不认的一律丢。
const MAGIC: &str = "minicraft";
/// 广播间隔。3 秒：手机切后台再回来，最多 3 秒就能重新出现在列表里。
pub const DEFAULT_INTERVAL_MS: u64 = 3_000;
/// peer 多久没再听到就当离线（3 个广播周期）。
pub const PEER_TTL_MS: u64 = 12_000;

/// 一次广播里带的信息（客户端"加入房间"面板要显示的全部内容）。
#[derive(Debug, Clone, PartialEq)]
pub struct Announce {
    /// 实例 id（8 位 hex）：只有同一台机器上的两个进程才会重复，用来过滤自己的回声
    pub instance: String,
    /// 联机服务端的 **TCP** 端口（tcp 与 udp 不是同一个口）
    pub port: u16,
    /// 房间名：面板"点一下进房"要拼 `ws://host:port/<room>`，光有端口会进错房
    pub room: String,
    /// 世界名（房主开房时上报的那个；没有就是房间名）
    pub name: String,
    pub seed: i64,
    pub players: u32,
    pub has_host: bool,
    pub password_required: bool,
}

impl Announce {
    pub fn to_wire(&self) -> Value {
        json!({
            "mc": MAGIC,
            "v": PROTOCOL_VERSION,
            "id": self.instance,
            "port": self.port,
            "room": self.room,
            "name": self.name,
            "seed": self.seed,
            "players": self.players,
            "host": self.has_host,
            "pw": self.password_required,
        })
    }
}

/// 编码成一帧 UDP 载荷。
pub fn encode(announce: &Announce) -> Vec<u8> {
    announce.to_wire().to_string().into_bytes()
}

/// 解码一帧；不是我们的报文（魔数/版本/字段形状不对）一律 `None`。
pub fn decode(raw: &[u8]) -> Option<Announce> {
    let value: Value = serde_json::from_slice(raw).ok()?;
    let map = value.as_object()?;
    if map.get("mc").and_then(Value::as_str) != Some(MAGIC) {
        return None;
    }
    if map.get("v").and_then(Value::as_u64) != Some(u64::from(PROTOCOL_VERSION)) {
        return None;
    }
    let instance = map.get("id").and_then(Value::as_str)?.to_string();
    if instance.is_empty() || instance.len() > 32 {
        return None;
    }
    let port = map.get("port").and_then(Value::as_u64)?;
    if port == 0 || port > u64::from(u16::MAX) {
        return None;
    }
    Some(Announce {
        instance,
        port: port as u16,
        // 房名会拼进地址：走与协议同一套收口（非法就回 default，绝不透传）
        room: crate::protocol::sanitize_room(map.get("room").and_then(Value::as_str)),
        name: map.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
        seed: map.get("seed").and_then(Value::as_i64).unwrap_or(0),
        players: map.get("players").and_then(Value::as_u64).unwrap_or(0) as u32,
        has_host: map.get("host").and_then(Value::as_bool).unwrap_or(false),
        password_required: map.get("pw").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// 把 Bonjour 的 TXT 记录转成与组播报文**同一个结构**（iOS ↔ Android 的互通点）。
///
/// iOS 用 `NetService` 发布（`server/ios/Sources/BonjourAdvertiser.swift`），TXT 的键
/// 与组播报文**刻意同名**（`port` / `room` / `name` / `seed` / `players` / `host` / `pw`），
/// 所以这里只是"字符串字典 → 结构体"，不存在第二套协议。
///
/// Bonjour 没有"实例 id"：用服务名当身份（`PeerBook` 按它去重），前缀 `bonjour:` 让
/// 它与组播来的 id 不会撞。
pub fn from_txt(service_name: &str, txt: &[(String, String)]) -> Option<Announce> {
    let get = |want: &str| {
        txt.iter()
            .find(|(key, _)| key == want)
            .map(|(_, value)| value.as_str())
    };
    let port: u16 = get("port")?.trim().parse().ok()?;
    if port == 0 {
        return None;
    }
    Some(Announce {
        instance: format!("bonjour:{service_name}"),
        port,
        room: crate::protocol::sanitize_room(get("room")),
        name: get("name").unwrap_or("").chars().take(32).collect(),
        seed: get("seed").and_then(|value| value.trim().parse().ok()).unwrap_or(0),
        players: get("players").and_then(|value| value.trim().parse().ok()).unwrap_or(0),
        has_host: matches!(get("host"), Some("1") | Some("true")),
        password_required: matches!(get("pw"), Some("1") | Some("true")),
    })
}

/// 从一个房间的状态生成这一帧（谁在开房、世界叫什么、几个人）。
pub fn announce_of(state: &State, instance: &str, password_required: bool) -> Announce {
    // 有房主的房间优先（那才是"别人能加进来玩"的那一间）
    let room = state
        .hosts
        .keys()
        .min()
        .cloned()
        .or_else(|| state.players.values().map(|player| player.room.clone()).min())
        .unwrap_or_else(|| crate::protocol::DEFAULT_ROOM.to_string());
    let world = state.world_of_room(&room);
    let players = state.players.values().filter(|player| player.room == room).count() as u32;
    Announce {
        instance: instance.to_string(),
        port: 0, // 调用方填（这里拿不到实际监听端口）
        name: if world.name.is_empty() { room.clone() } else { world.name.clone() },
        room,
        seed: world.seed,
        players,
        has_host: !state.hosts.is_empty(),
        password_required,
    }
}

/// 一台"听得到的别人"。
#[derive(Debug, Clone, PartialEq)]
pub struct Peer {
    pub announce: Announce,
    pub addr: SocketAddr,
    pub seen_ms: u64,
}

impl Peer {
    pub fn to_wire(&self) -> Value {
        json!({
            "name": self.announce.name,
            "port": self.announce.port,
            // 面板"点一下进房"要拼 `ws://host:port/<room>`；少了它只能进默认房间
            "room": self.announce.room,
            "seed": self.announce.seed,
            "players": self.announce.players,
            "hasHost": self.announce.has_host,
            "passwordRequired": self.announce.password_required,
            "addr": self.addr.ip().to_string(),
            "seenMs": self.seen_ms,
        })
    }
}

/// 听到的 peer 表（按实例 id 去重）。
#[derive(Debug, Default)]
pub struct PeerBook {
    peers: HashMap<String, Peer>,
}

impl PeerBook {
    pub fn new() -> Self {
        Self::default()
    }

    /// 收到一帧。返回 `true` = 新发现或内容有变（调用方据此打一行日志）。
    ///
    /// 自己的回声（`own_instance`）返回 `false`：UDP 回环会把本机发的那一帧送回自己的
    /// socket，不挡的话房间列表里会出现"自己这一间"。
    pub fn observe(
        &mut self,
        own_instance: &str,
        announce: Announce,
        addr: SocketAddr,
        now_ms: u64,
    ) -> bool {
        if announce.instance == own_instance {
            return false;
        }
        let changed = self
            .peers
            .get(&announce.instance)
            .map(|peer| peer.announce != announce)
            .unwrap_or(true);
        self.peers.insert(
            announce.instance.clone(),
            Peer { announce, addr, seen_ms: now_ms },
        );
        changed
    }

    /// 清掉超过 TTL 的 peer，返回被清掉的实例 id。
    pub fn prune(&mut self, now_ms: u64) -> Vec<String> {
        let stale: Vec<String> = self
            .peers
            .iter()
            .filter(|(_, peer)| now_ms.saturating_sub(peer.seen_ms) > PEER_TTL_MS)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &stale {
            self.peers.remove(id);
        }
        stale
    }

    pub fn list(&self) -> Vec<Peer> {
        let mut peers: Vec<Peer> = self.peers.values().cloned().collect();
        peers.sort_by(|a, b| a.announce.instance.cmp(&b.announce.instance));
        peers
    }

    pub fn len(&self) -> usize {
        self.peers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }
}

/// 生成一个实例 id（8 位 hex）。不需要全局唯一，只要"同机两个进程不撞"。
///
/// 混了三样：进程 id（跨进程区分）、毫秒时间（跨机器区分）、进程内自增（**同一个
/// 进程里连取两次也要不同**——单测会在同一毫秒内连取 64 次；只混时间的话两次启动
/// 撞在同一个毫秒里，两个实例就会把对方当成自己的回声过滤掉）。
pub fn new_instance_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let now = crate::store::now_ms();
    let pid = u64::from(std::process::id());
    let seq = u64::from(COUNTER.fetch_add(1, Ordering::Relaxed));
    let mixed = now.rotate_left(17) ^ (pid << 7) ^ seq.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    format!("{:08x}", (mixed & 0xFFFF_FFFF) as u32)
}

/// 广播目标（`255.255.255.255:port`）。组播被网络挡住时的兜底。
pub fn broadcast_addr(port: u16) -> SocketAddr {
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::BROADCAST, port))
}

/// 组播目标（`239.255.42.99:port`）——主通道。
pub fn multicast_addr(port: u16) -> SocketAddr {
    SocketAddr::V4(SocketAddrV4::new(MULTICAST_GROUP, port))
}

/// 绑发现端口：允许多个实例共享同一个端口 + 加入组播组。
///
/// **两个平台的绑法不一样**（这条踩过，症状是"一个实例看得见另一个，反过来看不见"）：
///
/// - **Linux / Android**：绑 `0.0.0.0:port` + `SO_REUSEADDR` + `SO_REUSEPORT`；
///   组播帧会投给所有成员，谁都能收到。
/// - **macOS / BSD**：`SO_REUSEPORT` 是**按 4 元组哈希挑一个 socket**（不像 Linux 是
///   "都投一份"），两个实例只有一个收得到；所以这里改绑**组播组地址**、只开
///   `SO_REUSEADDR`——BSD 上这才是"多个 socket 各收一份组播"的标准姿势。
///
/// `interface` 指定用哪块网卡收发（`0.0.0.0` = 系统默认）。同机跑两个实例做验收时，
/// 这台开发机的默认可组播网卡可能根本没配（实测：默认路由下组播连自己都收不到），
/// 所以验收脚本会显式传 `127.0.0.1`。
pub fn bind_listener(port: u16, interface: Ipv4Addr) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    socket.set_reuse_port(true)?;
    // macOS 绑组播地址（发了就往这儿投），Linux 绑通配地址
    let bind_ip = if cfg!(target_os = "macos") { MULTICAST_GROUP } else { Ipv4Addr::UNSPECIFIED };
    socket.bind(&SocketAddr::V4(SocketAddrV4::new(bind_ip, port)).into())?;
    // 加入组播组：不加入的话，发往 239.x 的帧根本不会投到这个 socket 上
    socket.join_multicast_v4(&MULTICAST_GROUP, &interface)?;
    socket.set_nonblocking(true)?;
    Ok(socket.into())
}

/// 发送用的 socket：**独立的临时口**。
///
/// 为什么不拿监听那个 socket 发：macOS 上它绑的是组播地址，从它 `send_to` 会被内核
/// 拒（`EADDRNOTAVAIL: Can't assign requested address`——源地址不是本机地址）。
/// 发和收分开之后，两端都只是普通 IPv4 行为，不用管平台差异。
pub fn bind_sender(interface: Ipv4Addr) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_broadcast(true)?;
    // 组播回环：**同一台机器**上发的帧也要能收到（否则双开互相看不见）
    socket.set_multicast_loop_v4(true)?;
    socket.set_multicast_ttl_v4(1)?;
    if !interface.is_unspecified() {
        socket.set_multicast_if_v4(&interface)?;
    }
    socket.bind(&SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).into())?;
    socket.set_nonblocking(true)?;
    Ok(socket.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(instance: &str) -> Announce {
        Announce {
            instance: instance.to_string(),
            port: 8887,
            room: "smoke".to_string(),
            name: "草原小屋".to_string(),
            seed: 424242,
            players: 2,
            has_host: true,
            password_required: false,
        }
    }

    #[test]
    fn encode_decode_round_trip() {
        let announce = sample("3f9a1c07");
        let bytes = encode(&announce);
        assert_eq!(decode(&bytes), Some(announce.clone()));
        // 字段名是协议的一部分（客户端按它读），改名字要一起改
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("\"mc\":\"minicraft\""));
        assert!(text.contains("\"port\":8887"));
    }

    #[test]
    fn decode_rejects_foreign_packets() {
        assert!(decode(b"not json").is_none());
        assert!(decode(br#"{"mc":"other","v":2,"id":"a","port":1}"#).is_none());
        // 版本不匹配：宁可当没听见，也不要解析出错误的世界
        assert!(decode(br#"{"mc":"minicraft","v":1,"id":"a","port":1}"#).is_none());
        // 端口缺失 / 为 0
        assert!(decode(br#"{"mc":"minicraft","v":2,"id":"a"}"#).is_none());
        assert!(decode(br#"{"mc":"minicraft","v":2,"id":"a","port":0}"#).is_none());
    }

    #[test]
    fn bonjour_txt_maps_to_the_same_announce() {
        let txt = vec![
            ("port".to_string(), "8887".to_string()),
            ("room".to_string(), "red".to_string()),
            ("name".to_string(), "草原小屋".to_string()),
            ("seed".to_string(), "424242".to_string()),
            ("players".to_string(), "2".to_string()),
            ("host".to_string(), "1".to_string()),
            ("pw".to_string(), "0".to_string()),
        ];
        let announce = from_txt("张三的 iPhone", &txt).expect("应当能转");
        assert_eq!(announce.port, 8887);
        assert_eq!(announce.room, "red");
        assert_eq!(announce.name, "草原小屋");
        assert_eq!(announce.seed, 424242);
        assert_eq!(announce.players, 2);
        assert!(announce.has_host);
        assert!(!announce.password_required);
        // 身份前缀与组播来的 id 区分开（否则 PeerBook 会把两边当成同一台）
        assert_eq!(announce.instance, "bonjour:张三的 iPhone");

        // 没有端口 / 端口是 0：这两条都拼不出可用地址
        assert!(from_txt("x", &[]).is_none());
        assert!(from_txt("x", &[("port".to_string(), "0".to_string())]).is_none());
        // 脏字段回落而不是整份丢弃（Bonjour 的记录是别人写的，能用的部分要用）
        let dirty = vec![
            ("port".to_string(), "8887".to_string()),
            ("room".to_string(), "不合法 房名".to_string()),
            ("seed".to_string(), "abc".to_string()),
        ];
        let announce = from_txt("x", &dirty).expect("端口合法就够");
        assert_eq!(announce.room, crate::protocol::DEFAULT_ROOM);
        assert_eq!(announce.seed, 0);
        assert!(!announce.has_host);
    }

    #[test]
    fn own_echo_is_ignored() {
        let mut book = PeerBook::new();
        assert!(!book.observe("me", sample("me"), "1.2.3.4:5".parse().unwrap(), 1_000));
        assert!(book.is_empty());
        assert!(book.observe("me", sample("other"), "1.2.3.4:5".parse().unwrap(), 1_000));
        assert_eq!(book.len(), 1);
    }

    #[test]
    fn peers_expire_after_ttl() {
        let mut book = PeerBook::new();
        book.observe("me", sample("other"), "1.2.3.4:5".parse().unwrap(), 1_000);
        assert!(book.prune(1_000 + PEER_TTL_MS).is_empty());
        assert_eq!(book.prune(1_000 + PEER_TTL_MS + 1).len(), 1);
        assert!(book.is_empty());
    }

    #[test]
    fn instance_ids_look_alike_but_do_not_collide() {
        let first = new_instance_id();
        assert_eq!(first.len(), 8);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        // 同一毫秒内连取两次也要不同（混了 pid 与自增）
        let ids: std::collections::HashSet<String> = (0..64).map(|_| new_instance_id()).collect();
        assert!(ids.len() > 1, "64 次取值不该完全相同：{ids:?}");
    }

    /// 真的走一遍 socket：监听 → 发一帧 → 收到 → 解码。
    #[tokio::test]
    async fn socket_round_trip() {
        // 用回环网卡：CI / 开发机的默认可组播网卡不一定在（见 `bind_listener` 的注释）
        let listener = bind_listener(0, Ipv4Addr::LOCALHOST).expect("绑定发现端口");
        let port = listener.local_addr().unwrap().port();
        let sender = bind_sender(Ipv4Addr::LOCALHOST).expect("发送 socket");
        let announce = sample("neighbour");
        let payload = encode(&announce);
        let target = multicast_addr(port);
        std::thread::spawn({
            move || {
                // 监听方可能还没开始 recv / 组播成员关系还没生效，多发几次
                for _ in 0..40 {
                    let _ = sender.send_to(&payload, target);
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            }
        });
        let listener = tokio::net::UdpSocket::from_std(listener).unwrap();
        let mut buf = [0u8; 2048];
        let (len, addr) = tokio::time::timeout(
            std::time::Duration::from_secs(4),
            listener.recv_from(&mut buf),
        )
        .await
        .expect("4 秒内该收到组播")
        .expect("recv 失败");
        let decoded = decode(&buf[..len]).expect("能解码");
        assert_eq!(decoded, announce);
        assert!(addr.port() != 0);
    }
}
