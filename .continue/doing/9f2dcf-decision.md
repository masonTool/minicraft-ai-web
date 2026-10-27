# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1739 · 背包立栏上 canvas（镜像根上移一层）

## D37 · 镜像根选"这一屏的外壳"，不是"看着最大的那个盒子"
- 决定：背包镜像根从 `.inv-panel` 上移到 `.inv-shell`（`?? .inv-panel` 兜底）。
- 为什么：DOM 是 `#inventory-screen > .inv-shell > [.inv-rail-left | .inv-panel | .inv-rail-right]` —— 立栏在 panel **外面**。只镜像 panel 的后果不是"报错"，而是"中间是 canvas、两侧还是 DOM"：一屏两种渲染，而且漏掉的那部分**看起来完全正常**（它毕竟是 DOM），只有开 `?ui2dtint=1` 才看得出来。
- 影响：镜像范围变大后，立栏的选中态、抽屉展开、页签高亮都自动跟着 DOM class 走，不需要额外逻辑。⚠️ 以后接任何"整页"之前，先看这一屏的根是哪个节点（`position: fixed` 的那层 vs 里面那个 panel），差一层就漏一整块。
