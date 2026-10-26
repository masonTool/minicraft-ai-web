# 联机服务端部署（联机28）

> 代码：`server/node/index.mjs`（+ `protocol.mjs` / `store.mjs` / `snapshot.mjs` / `ratelimit.mjs` / `aoi.mjs`）
> 协议：`docs/NET-PROTOCOL.md`　验收：`npm run test:net`
> 运维手册（调试接口 / 打包发布）在 [`ops.md`](./ops.md)，本文只管**联机服务端怎么部署**。

## 1. 三种部署形态

| 形态 | 客户端怎么连 | 说明 |
| --- | --- | --- |
| 本地开发 | `ws://localhost:25187` | `node server/node/index.mjs` 直接起，端口 `PORT` 可改 |
| 局域网直连 | `ws://192.168.1.5:25187` | 手机在联机面板里填这条地址 |
| **https 站点** | `wss://<同源>/ws` | 必须走 **wss**：https 页面连 `ws://` 会被浏览器当混合内容拦掉 |

默认地址的规则在 `src/core/net/ServerUrl.ts` 的 `resolveDefaultServerUrl()`：
https 页面 → `wss://<host>/ws`，http 页面 → `ws://<hostname>:25187`；
页面 URL 带 `?server=wss://mc.example.com/ws` 时优先用这个（部署到子路径/别的主机时用）。

## 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `25187` | 监听端口（WebSocket 与 `/healthz` 共用） |
| `SEED` | `20261014` | 世界种子（**全服一个**：房间只隔离数据，不隔离地形） |
| `DATA_DIR` | `server/node/.data` | 世界快照目录（容器里指到卷上，否则重建容器 = 世界没了） |
| `ROOM_PASSWORD` | 空 | 房间口令；空 = 不校验。**明文传输，不是鉴权** |
| `ALLOWED_ORIGINS` | 空 | 逗号分隔的来源白名单；空 = 不校验。**无 Origin 的连接放行**（node 机器人） |
| `GRACE_MS` | `30000` | 断线宽限期（测试里压到 400ms） |

## 3. Docker

```bash
docker build -t minicraft-server .
docker run -d --name mc -p 25187:25187 -v mc-data:/data minicraft-server
curl -s http://127.0.0.1:25187/healthz   # {"ok":true,"players":0,...}
```

镜像里只装**生产依赖**（`ws`）：`three` / vite / 测试工具都是打包期的东西，不该进运行时。
前端是 `npm run build` 的静态产物，单独用任意静态托管发布，不并进这个镜像。

## 4. 反代（nginx）——https 站点的标准做法

```nginx
location /ws {
    proxy_pass http://127.0.0.1:25187;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WebSocket 升级
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;                      # 要大于服务端 20s 心跳超时
}

location = /healthz {
    proxy_pass http://127.0.0.1:25187/healthz;     # 健康检查与 ws 同一个端口
    access_log off;
}
```

⚠️ `proxy_read_timeout` 必须大于服务端的 20 秒心跳超时，否则反代会先把空闲连接掐掉
（表现：站着不动的队友每隔一分多钟"闪一下"）。

## 5. 健康检查

`GET /healthz`（与 WebSocket 共用端口）返回：

```json
{ "ok": true, "players": 2, "rooms": 1, "uptime": 3600, "seed": 20261014, "protocol": 1 }
```

容器里用 `HEALTHCHECK` 判活（见 `Dockerfile`）；反代/LB 用同一个地址。其它路径返回 404
——**不要**拿"根路径 200"当健康检查，那样任何服务都能被判成健康。

## 6. 备份

世界在 `DATA_DIR/world.json`（方块增量 / 容器 / 牌子 / 展示框 / 时间）。服务端每 30 秒写一次，
退出时再补一次，写入是**原子**的（tmp + rename）。备份直接拷这个文件即可；读到坏文件时
服务端会把它改名成 `world.json.broken-<时间戳>` 再按空世界启动（不会静默删）。
