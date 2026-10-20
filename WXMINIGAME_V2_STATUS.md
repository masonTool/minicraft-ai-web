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

## 尚未完成

- [ ] SaveGame / IndexedDB seam
- [ ] v2 最小世界渲染启动
- [ ] 触摸输入
- [ ] UI Kit
- [ ] Settings / Inventory 按 Web 结构重做
- [ ] 小游戏构建脚本与包体

## 下一步顺序

1. 用平台 SaveGame 承接 IndexedDB。
3. 写 v2 最小启动：World + TextureAtlas + ChunkRenderer 画出一个区块。
4. 再接 PlayerPhysics / 输入。
5. 最后做 UI Kit。

## 验收

```bash
npm run sync:audit -- --run
npm run typecheck
```

当前 `sync:audit` 在 v2 起点无差异；typecheck 通过。
