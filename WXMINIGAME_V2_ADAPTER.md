# wxminigame-v2 Adapter 兼容清单

> 目标：main 的 `src/core`、`src/render`、`src/world`、`src/data` **尽量零改动**；平台差异全部落在 `src/platform`、`vendor` 和 v2 boot。
>
> `src/main.ts` 是 Web 的浏览器启动层，**不直接搬进小游戏**；小游戏用自己的 boot 组装同一套 core/render。

## 1. 已确认的 main 依赖

统计范围：

```
src/core src/render src/core/world src/data src/worker
```

| 能力 | main 使用点 | 当前 wx adapter | 决策 |
|---|---|---|---|
| DOM Canvas 创建 | `TextureAtlas`、`Sky`、`SignRenderer`、`EntityRenderer`、`MobHealthBar`、`webglSupport` | `vendor/minigame-adapter/Document.js` + `Canvas.js` 已有 `createElement('canvas')` | 复制并做 2D 能力冒烟 |
| Canvas 2D / ImageData | 同上 + `ResourcePack` | Canvas.js 有 2D；`ImageData` 在 window.js 里是空构造 | 补 `ImageData`/`putImageData`/`getImageData` 验证 |
| localStorage | `WorldRegistry`、`PerfPolicy` | `vendor/.../localStorage.js` 已有 | 复制，映射到 wx storage |
| navigator | `World` 默认 workerCount、I18n | navigator.js 缺 `hardwareConcurrency`、`language` 只有固定值 | 补两个字段 |
| Worker | `World`、`MeshWorkerPool` 直接 `new Worker` | Worker.js 包装 `wx.createWorker`；mesh 含 ArrayBuffer 的历史问题 | **先统一 main-thread Worker 垫片**，不直接用 wx worker |
| WebAudio | `AudioEngine`、`DiscMelody` | `Audio.js` 的 `AudioContext` 使用 `wx.createWebAudioContext()` | 复制后做 oscillator/gain 冒烟；失败则静音降级 |
| IndexedDB | `SaveGame` | **无** | 最大硬点：用 v2 的 SaveGame adapter / 文件存档承接，或补 IDB 垫片 |
| Blob/FileReader/URL | ResourcePack | adapter 已有 Blob/FileReader/URL | 复制 |
| fetch/WebSocket | core 内暂无 | 不需要优先 | 后续按功能加 |
| Fullscreen/PointerLock | `main.ts` / Web 输入层 | 小游戏无对应 | 不用移植；由 v2 input 替代 |

## 2. 关键结论

### 2.1 core/render 可做到“零改动”启动

Canvas、localStorage、navigator、AudioContext 都能在 adapter 层补，不需要改 core/render。

### 2.2 Worker 不能照搬 wx worker

main 直接：

```ts
new Worker(new URL('../worker/chunk.worker.ts', import.meta.url), { type: 'module' })
```

微信 worker 对含 ArrayBuffer 的嵌套消息不可靠，之前 mesh 就因此丢 `chunks`。

v2 第一版策略：

- 全局 `Worker` 垫片 → **main-thread worker**
- 只保留 `postMessage` / `onmessage` / `addEventListener('message')` / `terminate`
- 地形生成和网格化都在主线程按预算切片
- 等核心跑通、性能有底后，再做扁平 ArrayBuffer 的 worker 协议

这是 shim，不是改 core。

### 2.3 IndexedDB 是唯一的存档硬点

main 的 `SaveGame` 用 IndexedDB 存 chunk edits。

v2 有两个选择：

| 方案 | 成本 | 风险 |
|---|---|---|
| A. 写 IDB 垫片，底层用 wx 文件 | 中 | API 面较大，事务语义要补 |
| B. v2 boot 用平台 SaveGame，build alias 替换 `SaveGame` | 中低 | 需要保持 SaveGame 公共 API 一致 |

推荐先 B：把“存档实现”作为平台 seam，不把 IndexedDB 仿真写进 core。

### 2.4 `main.ts` 不迁

`main.ts` 里有：

- DOM UI 创建
- 浏览器输入/全屏/PointerLock
- 浏览器音频/存档初始化
- HUD/菜单/背包 DOM

这些都属于 Web 启动层。v2 迁的是它调用的 core/render/world，不是 `main.ts` 本身。

## 3. 第一版 v2 启动切片

先不接 UI Kit，只验证“世界能画出来”：

```
wx bootstrap
→ vendor adapter (Canvas/Document/localStorage/navigator/Audio/Worker shim)
→ World(seed, type, 1, mainThreadWorkerFactory)
→ TextureAtlas
→ ChunkRenderer
→ Scene/Camera/Renderer
→ 生成一个区块并渲染
```

验收：

- 无 `document is not defined`
- 无 `indexedDB is not defined`
- 无 `Worker is not defined`
- TextureAtlas 图集能上传
- 一个区块能画出来
- 不依赖 main.ts / src/ui

## 4. 第二阶段

- PlayerPhysics / 输入
- 触摸控制（后续用 UI Kit）
- SaveGame seam
- 天空/雾/光照
- 性能预算

## 5. 第三阶段

- UI Kit
- Settings / Inventory 按 Web 结构重做
- 再迁主菜单、暂停、箱子、熔炉、聊天

## 6. 每次 adapter 变更的验收

- `npm run sync:audit -- --run`
- `npm run typecheck`
- `npm run build:minigame:world`
- `npm run test:minigame:flow`
- Web `npm run check`
- 包体 <4MB

## 7. 当前不做的事

- 不为了“先跑”改 `src/core` / `src/render`
- 不用 main 的 `src/ui` / `index.html`
- 不把完整 DOM 引擎塞进小游戏
- 不在 v2 第一版恢复 wx worker
