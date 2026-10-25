# 联机服务端镜像（联机28）
#
# 只装**生产依赖**：服务端只需要 `ws`，`three` / vite / 测试工具都是打包与开发期的东西。
# 前端是静态文件（`npm run build` 的产物），单独用任意静态托管发布，不并进这个镜像——
# 把两者塞在一起会让镜像多几百 MB，而它们本来就可以分开部署。

FROM node:20-alpine

WORKDIR /app

# 先只拷依赖清单：源码不变时这一层能命中缓存，重建几秒就好
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 服务端代码（`server/node/` 里的 .mjs 不需要编译）
COPY server/node ./server/node

# 世界快照落在 /data（挂卷，否则容器一删世界就没了）
ENV PORT=25187 \
    DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 25187

# 与 WebSocket 共用同一个端口的健康检查（见 server/node/index.mjs 的 /healthz）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||25187)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/node/index.mjs"]
