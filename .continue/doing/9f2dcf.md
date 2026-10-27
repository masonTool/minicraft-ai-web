# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1739

> 用户 2026-10-27：「背包左右两边的按钮（左：分类、仓库；右：人物、成就、配方）也还是 DOM」。
> 根因：镜像根取的是 `.inv-panel`，而立栏挂在 `.inv-shell` 上、在 panel **外面**。

- [x] [V1] `src/main.ts`：背包镜像根 `.inv-panel` → `.inv-shell`（带 `.inv-panel` 兜底）→ `npm run check:fast`
  - 做了什么：`syncInventory2d()` 里先找 `#inventory-screen .inv-shell`、找不到再退回 `.inv-panel`。
  - 为什么：`#inventory-screen > .inv-shell > [ 左立栏 | .inv-panel | 右立栏 ]` —— 只镜像 panel 就会"中间 canvas、两侧还是 DOM"，一屏两种渲染。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿；截图里左右立栏（分类/仓库 · 人物/成就/配方）都由 canvas 画出。
  - 批次：20261027-1739

- [x] [V2] 预览页补左右立栏 + 2 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`inventory-mirror.html` 外面套 `.inv-shell`，左右各放立栏按钮，镜像根同步改成 `.inv-shell`；`shoot-all` 累计 51 张。
  - 为什么：立栏的选中态与抽屉展开全靠 DOM class 变化，镜像自动跟上——但这一点必须有图证明，不能只写在注释里。
  - 验证：截图 `27-inventory-rails.png` / `27b-…-tinted.png`：面板 + 两侧立栏都在 canvas 上，遮罩版整片黄。
  - 批次：20261027-1739

- [x] [V3] 文档：`notes/canvas-ui.md` §5.25（"接手整页前先看清根是哪个节点"）、`TASKS.md` 的 M32 标完成 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.25 记下 DOM 层级与"差一层就漏一整块"的教训；M32 从待办移到已完成，进度口径与差异台账同步。
  - 为什么：这个错很隐蔽 —— 漏掉的部分**看着正常**（因为它还是 DOM），只有开遮罩才看得出来。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1739
