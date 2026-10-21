# wxminigame-v2 迁移状态

分支：`wxminigame-v2`  
起点：`main`（当前 `c1edde2`）  
原则：main 是源码源；core/render/world 尽量零改动；平台差异在 adapter；UI 用 UI Kit。

## 已完成

- [x] 独立 worktree / 分支，不污染 `main`
- [x] `WXMINIGAME_SYNC.md` 同步流程
- [x] `tools/minigame/sync-audit.mjs` 审计脚本
- [x] `vendor/minigame-adapter` 从现有小程序版本迁入
- [x] `src/platform` 平台层迁入
- [x] `src/core/worker/WorkerLike.ts`（additive 平台 seam）
- [x] `npm run typecheck` 通过
- [x] 主线程 Worker 垫片（复用 main `chunk.worker` 的生成/网格化）
- [x] v2 core 冒烟：main World 生成 9 个区块（`npm run test:v2-core`）

## 尚未完成

- [x] SaveGame / IndexedDB seam（FileSaveGame 内存冒烟通过）
- [x] v2 最小世界渲染启动（main World + TextureAtlas + ChunkRenderer，截图已验证）
- [x] v2 出包：`minigame-v2/game.js` 约 2.2MB
- [x] 触摸输入
- [x] PlayerPhysics + 基础触摸（左半屏移动 / 右半屏视角）
- [x] 方块交互：轻点放置、长按破坏、快捷栏扣减
- [x] HUD 按 Web 重做：可见摇杆、右下跳跃、快捷栏右侧背包、顶部聊天/暂停/视角矢量图标
- [x] 摇杆拖动/双击潜行自动验收；摇杆头跟随拖动（UI Kit refresh）
- [x] 疾跑平滑 FOV；生物攻击 300ms 冷却
- [x] 手指落点白圈（按下/拖动跟随，抬手消失）
- [x] HUD 快捷栏上方显示选中物品名称
- [x] 生存：摔落/饥饿/溺水/岩浆/火焰/仙人掌/虚空/进食/自然回血/死亡/重生/红闪/死因/死亡掉落，生命饥饿与氧气接入存档
- [x] 生物受击 120ms 红闪
- [x] HUD 氧气气泡图标（水下显示）
- [x] 性能 smoke：`npm run test:minigame:v2-perf`，报告 FPS/画质/区块/后端；严格模式 `PERF_STRICT=1`
- [x] 难度：和平不生成僵尸，简单/普通/困难僵尸伤害 1/2/3
- [x] 创造模式免伤害/免饥饿/放置不消耗
- [x] HUD 生命/饥饿为快捷栏两端 10 图标行，实时反映 health/food
- [x] 创建世界后 400ms 快捷栏输入锁，避免误选 slot 8
- [x] 破坏方块获得经验 + HUD 经验条/等级，经验写入存档
- [x] 15s 自动保存 + 页面隐藏保存
- [x] 聊天命令：/help /seed /pos /heal /gamemode /tp
- [x] 顶部三图标缩到 36 设计像素并居中，贴近 Web 手机版
- [x] 创造模式双击跳跃起飞/落地，飞行时显示升/降按住键
- [x] 摇杆推到底自动疾跑（input.sprint），疾跑加快饥饿
- [x] 双击摇杆潜行；方块选中框；合成格拖入不再吞物品
- [x] v2 标题页/开始游戏门控（标题页不生成世界）
- [x] UI Kit：Box/Text/Button/Toggle/Slider、命中、Canvas 叠加、HUD/暂停
- [x] v2 设置页：四页；亮度/视距/灵敏度/FOV/反转Y/自动跳跃/左右手/视角/声音与分组音量
- [x] 声音：WebAudio 垫片 + 放置/破坏音效（无音频上下文时自动降级）
- [x] 外观基础编辑（颜色/发型/胡须/眼睛/披风/眼型/年龄/身架）
- [x] 3D 玩家模型 + 第一/第三人称切换（使用肤色/上衣/裤子）
- [x] 外观：发型/发色/胡须/眼睛颜色/披风 + 3D 模型同步
- [x] 眼型/年龄/身架 + 3D 模型同步
- [x] 声音与全部分组音量（主/方块/UI/生物/玩家/环境/音乐）
- [x] Inventory：物品/创造/配方左侧分类、27 主背包 + 9 快捷栏、图标、数量、选中、创造取方块、显式关闭
- [x] Inventory 拖拽交换 + HUD 快捷栏选中
- [x] 物品页 27 主背包 + 独立 9 格快捷栏（Web 结构），主背包点击不改 selectedSlot
- [x] 昼夜天空（Sky + 日月星云 + 随时间方块亮度），时间写入存档
- [x] 性能：60FPS 上限、分级画质（自动/高/性能）、UI 33ms 节流、world.update 按区块
- [x] 真实 Worker 网格化（微信 worker.onMessage 入口 + 2.5s 无响应回退主线程）
- [x] 调试 HUD/状态显示画质档与 meshBackend（worker/main）
- [x] 天气（雨/雪粒子/闪电/存档）+ /weather clear|rain|thunder
- [x] 2x2/3x3 合成切换、产物、材料拖入/关闭返还（CraftingGrid）
- [x] 配方书：2x2/3x3 过滤、搜索、6 条分页、产物图标/一键填格
- [x] 创造栏搜索/整理；世界卡片累计游玩时间
- [x] 创造栏 Web 五分类（全部/建筑/装备/物品/自然）+ 搜索/整理/分页
- [x] 调试信息开关（FPS/区块/目标/坐标）
- [ ] Inventory 完整态：拖拽细节
- [ ] Settings / Inventory 按 Web 结构重做
- [x] 小游戏构建脚本与包体（`build:minigame:v2`，game.js 约 2.76MB + worker 约 540KB）

## 下一步顺序

1. 真机验证 Worker/60FPS/存档/声音/容器/生物
2. 完整生物/怪物 AI
3. 门/按钮等方块交互
4. 按 `WXMINIGAME_V2_ARCHITECTURE.md` 拆分组合根
5. Settings / Inventory 继续按 Web 结构拆分

架构与债务见：`WXMINIGAME_V2_ARCHITECTURE.md`

## 验收

```bash
npm run sync:audit -- --run
npm run typecheck
```

当前 `sync:audit` 在 v2 起点无差异；typecheck 通过。
