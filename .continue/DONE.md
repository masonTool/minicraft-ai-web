# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261028-1006 · 2026-10-28 · 会话 9f2dcf81

> 队列：把"版面下标 ↔ 库存下标"从一行三元表达式抽成纯函数。

- [x] `ui2d/panelIndexing.ts`：`panelRegions` / `regionOfDisplayIndex` / `inventoryIndexAt` / `displayIndexForInventory`
- [x] `main.ts` 的 `SlotAccess` 改走它（规格现为 0/0，行为与之前一致；非玩家格子返回 `null`）
- [x] 8 条断言：11+5 格后的错位、越界、非整数、往返一致

验证：`test:ui2d-indexing` 8/8、`tsc` 干净、`npm run check` exit=0。



## 批次 20261028-1000 · 2026-10-28 · 会话 9f2dcf81

> 队列：把放置规则做成模型层的一道闸，并给宿主加"换版面"能力。

- [x] `MoveRules.canPlace`：五条放置路径（左键放空/合并/交换、右键放一个、Shift、拖拽均分）统一先问
- [x] 修语义坑：`canPlaceInSideSlot(slot, null)` 的 `null` = "不是装备"，盔甲格必须拒绝（旧断言把 bug 钉成了预期）
- [x] `InventoryPanelHost.retarget()`：换容器只改版面、不重造宿主（预览实测 234 → 374 → 330）
- [x] 预览 `window.__retarget` 用于验证；新增 6 条规则断言

验证：`test:ui2d-place-rules` 6/6、`test:ui2d-armor` 7/7、`tsc` 干净、`npm run check` exit=0。



## 批次 20261028-0946 · 2026-10-28 · 会话 9f2dcf81

> 队列：把"20 种工作站"的排版数据与装备列规则做成可离线验的两块。

- [x] `ui2d/stationLayouts.ts`：20 条预设（13 工作站 + 7 存储）+ `stationExtra/stationSpec/stationSlotCount`
- [x] `ui2d/armorRules.ts`：`canPlaceInSideSlot` / `sideSlotFor` / `sideSlotAt`（部位按 `sideStart` 换算）
- [x] 预览 `?station=furnace`（套预设排版）+ 截图 `45-inventory-furnace.png`
- [x] 修坑：`stationExtra()` 漏传 `flame` → 熔炉的火焰块根本不排版

验证：`test:ui2d-station` 11/11、`test:ui2d-armor` 7/7、`tsc` 干净、`npm run check` exit=0、74 张截图。



## 批次 20261028-0812 · 2026-10-28 · 会话 9f2dcf81

> 队列：清最后一条待办（R2）+ M38 的搜索与分页。

- [x] R2 收口：Bonjour 浏览代码早已落地，缺的是门禁 → 新增 `npm run check:swift`（`swiftc -parse`），接进 `npm run check`
- [x] `check.sh` 加 ⓪ 步：先语法后编译（编 Rust 要 cargo 与几分钟，语法错没必要等）
- [x] M38 剩余：`ui2d/creativeModel.ts`（搜索 / 页签过滤 / 分页 / 铺网格，13 条断言）
- [x] 面板补翻页区（`‹ 2 / 2 ›`）+ 预览改真数据（450 件 / 每页签 90 件）+ 2 张截图

验证：`test:ui2d-creative` 13/13、`test:ui2d-inventory-model` 65/65、`check:swift` 4 文件、
`tsc` 干净、`npm run check` exit=0、`build:fast` 出包、73 张截图。



## 批次 20261028-0732 · 2026-10-28 · 会话 9f2dcf81

> 队列：把待办里的三条清掉（M41 / M43 / M38 第一版）。

- [x] M41 `cursorDirty`：只有我们改过才写回外部光标，否则先拉 —— 否则 `Q` 丢掉的东西下一帧被推回去
- [x] M43 死亡界面（`#death`，z 7）与引导卡（`#tutorial`，z 8）各挂一个镜像
- [x] M38 创造物品栏第一版：`CREATIVE_LAYOUT` + `layoutCreativePanel()` + `drawCreativePanel()` + `creativePick()`（无限取用）
- [x] 预览页 `creative-selfdrawn.html` + 2 张截图；新增 9 条断言（取用 5 + 布局 4）

验证：`test:ui2d-inventory-model` 63/63、`tsc` 干净、`npm run check` exit=0、71 张截图。



## 批次 20261028-0240 · 2026-10-28 · 会话 9f2dcf81

> 队列：合并 `origin/main` + 把主分支的界面变化重新应用到 canvas。

- [x] 合并 `origin/main`（`origin/master` 已过时）：源码零冲突，6 个台账文件按"批次段落并集"重建
- [x] 主分支新增的 L14~L33 二十条需求补进 `TASKS.md`（351 项），README/HANDOFF 数字由 `audit:tasks` 重算
- [x] 逐条核对界面变化 → **唯一必须补的是世界卡片缩略图**（`background-image` 的 data URL）
- [x] 新增 `ui2d/backgroundImages.ts`（按 URL 缓存 / 异步 / cover 裁切），`TextBlock.imageUrl` + 镜像绘制
- [x] 载完图片数进镜像签名（否则永远不重画，缩略图空白）
- [x] 预览 `?view=worlds&shot=1` + 截图 `43-world-thumb.png`；文档 §5.47

验证：`tsc` 干净、`test:ui2d*` 127/127、`npm run check` exit=0、`build:fast` 出包、71 张截图。



## 批次 20261028-0600 · 2026-10-28 · 会话 12c62c

> 用户：体积基线放宽到 1.5 MB，项目小不值得费劲

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0600

- [x] [L33] 体积基线放宽到 1.5 MB：`tools/release-check.mjs` → `npm run build:web`
  - 做了什么：`TOTAL_GZIP_BASELINE` 1230 → 1536 KB，注释写明理由与"何时再动手"。
  - 为什么：用户拍板——项目本来就小（合计 1230 KB / 首屏约 1 MB），为几百字节卡发布不值。
  - 验证：`npm run build:web` ✓ 通过（余量 305.8 KB）。
  - 批次：20261028-0600

---

## 批次 20261028-0500 · 2026-10-28 · 会话 12c62c

> 用户：GitHub Pages 因体积超基线 255 字节发布不了

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0500

- [x] [L32] 体积闸门加容差：`tools/release-check.mjs` → `npm run build:web`
  - 做了什么：全部 JS 合计基线上加 0.5%（≈6 KB）容差；容差内通过并 note 播报消耗量，超容差才红。
  - 为什么：发布只因 255 字节（0.02%）被卡，是上次余量被日常提交吃光，不是代码膨胀。
  - 验证：`npm run build:web` ✓ 通过（note：已用掉容差 258/6298 字节）；check exit=0。
  - 批次：20261028-0500

---

## 批次 20261028-0400 · 2026-10-28 · 会话 12c62c

> 用户：创建/编辑世界界面在非中文下空间不够，要所有语言都正常

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0400

- [x] [L31] 世界表单标签列按语言给宽度：`index.html`、`tools/ui-test.ts` → playwright（de/ru）
  - 做了什么：`var(--label-w, 64px)` + `html[lang='de'|'ru'] 7.6em`、`fr/pt 5.6em`；标签 nowrap。
  - 为什么：固定 64px 时 de「Schwierigkeit」、ru「Название мира」被截成省略号。
  - 验证：de 106px 完整、两列对齐；ru 7 行 clipped=false；ru 编辑面板按钮正常；check exit=0。
  - 批次：20261028-0400

---

## 批次 20261028-0200 · 2026-10-28 · 会话 12c62c

> 用户：设置窗口标题没多语言，全面检查遗漏

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0200

- [x] [L29] 清掉 UI 硬编码中文：`main.ts`、`WorldScreen.ts`、`ToolHud.ts`、`WorldRegistry.ts`、六语言 → playwright
  - 做了什么：`setTitle(t('settings.title'), t('settings.back'))` + 另外 4 处（构建信息、卡片 tooltip、罗盘格数、未命名世界），新增 4 key × 6 语言。
  - 为什么：`main.ts` 的 `setTitle('设置','返回')` 写死中文，德语下页签是德语、标题却是「设置」；上一轮扫描排除了 main.ts 才漏掉。
  - 验证：德语设置标题 = Einstellungen；全项目复扫 UI 硬编码 0（剩 1 注释）；check exit=0。
  - 批次：20261028-0200

---

## 批次 20261028-0126 · 2026-10-27 · 会话 9f2dcf81

> 队列：第二轮遗漏盘点 —— 把范围从背包扩到全部界面。

- [x] 盘点：按"DOM 里还有哪些整块面板"数了一遍，发现 `#advancements` / `#statistics` / `#server-picker` **从没进过任何镜像**
- [x] 新增通用 `mountPanelMirror(selector, zIndex)`，三块面板各挂一个（z 58，在其自身 55 之上）
- [x] 新增 M42（已完成）与 M43（死亡界面/引导卡，待办）
- [x] 文档 §5.46：**盘点要按 DOM 数，不能按任务表数**

验证：`tsc` 干净、`npm run check` exit=0、`build:fast` 出包。⚠️ 三块无预览页，真机需各开一次看 z 序。

## 批次 20261028-0107 · 2026-10-27 · 会话 9f2dcf81

> 队列：M39 剩下的火焰条 + M40 的附魔行。

- [x] `extra.flame` + `groups.flame` + `drawFlameBar()`（竖条纹底 + 橙色按比例上涨）
- [x] `host.flameOf` 每帧现取；预览 `?furnace=1&progress=0.55&flame=0.7`
- [x] tooltip 加 `enchants`（`#a8a8ff`），高度计算一并算进去
- [x] 文档 §5.45 + 决策 D57；M39 / M40 收口

验证：`test:ui2d-inventory-model` 54/54、`tsc` 干净、`npm run check` exit=0、`build:fast` 出包、70 张截图。

## 批次 20261028-0100 · 2026-10-28 · 会话 12c62c

> 用户：编辑弹窗又自动弹键盘；遮罩还是挡不住下层点击

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0100

- [x] [L28] 弹窗不再自动弹键盘 + 遮罩硬拦截：`InputOverlay.ts`、`index.html`
  - 做了什么：焦点门槛加"按下元素 === 获得焦点的元素"；遮罩改 `stopImmediatePropagation` + body `.inp-open`（CSS `pointer-events:none`）。
  - 为什么：600ms 窗口把"点按钮后代码聚焦"误判成用户点击；stopPropagation 拦不住同元素上的其它监听。
  - 验证：编辑弹窗 active=BODY 无浮层；浮层开着点下层 lowerClicks=0。
  - 批次：20261028-0100

---

## 批次 20261028-0045 · 2026-10-27 · 会话 9f2dcf81

> 队列：M39 第一步 —— 工作站进度箭头。

- [x] 布局新增 `groups.progress`（结果格左侧 28px 箭头区，纯背包为 null）→ 2 条断言
- [x] `drawProgressArrow()`：空态描暗箭头，按 `ratio` 从左往右描亮；合成台 ratio=0 等价静态箭头
- [x] `host.progressOf` 每帧现取（进度不参与布局）+ 预览 `?progress=0.45` + 截图
- [x] 文档 §5.44（装饰块单独成组）+ 决策 D56

验证：`test:ui2d-inventory-model` 54/54、tsc 干净、`npm run check` exit=0、`build:fast` 出包、68 张截图。

## 批次 20261028-0033 · 2026-10-28 · 会话 45545c

> 暂停菜单联机键删除后的残留清理（死参数 + 断言）

# 队列 · 会话 45545c939bf44f9ea0cb708a4fb37884

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0033

- [x] [L30] 清掉暂停菜单联机键的残留（用户确认是有意删除）：`src/ui/SettingsScreen.ts` 的 actions 接口、`src/main.ts` 的传参、`tools/ui-test.ts` 那条断言 → `npm run check:fast` 全绿
  - 做了什么：删掉 `SettingsScreenActions` 的 `onMultiplayer` / `multiplayerLabelKey` 两个接口项（连带文档注释）、
    `main.ts` 里对应的 8 行传参，以及 `ui-test.ts` 那条"按联机状态改文案"的断言；
    断言改成反向守卫「暂停菜单不再有联机键」（否则 `settingsSrc` 会变成未使用变量，`noUnusedLocals` 直接红）。
  - 为什么：按钮在上一轮末尾（00:28）已被删掉，但接口、传参、断言还留着——`tsc` 不报错（都是可选参数），
    只有 `test:ui` 的源码断言能抓到，所以门禁一直是红的。
  - 验证：`npm run check:fast` exit=0，命中 3/3 套全绿（viewmode / settings / ui）。
  - 遗留：`openMultiplayer()`（`main.ts:3691`）现在**没有任何调用方**，`RoomCard` 因此没有界面入口；
    删卡片还是补新入口是产品决定，留给用户，未动。
  - 批次：20261028-0033

---

## 批次 20261027-3400 · 2026-10-28 · 会话 12c62c

> 用户：新建世界人物卡在方块里，应该站在地面上

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3400

- [x] [L27] 新建世界落地校正：`main.ts` → playwright
  - 做了什么：`prepareNewWorldSpawn()` 末尾补 `requestGroundSettle('spawn')`。
  - 为什么：落点按 surfaceY 估算，实际生成有树/水/洞穴；而校正只挂在读档与联机加入上，新世界漏了。
  - 验证：两个新世界都在地面上（y=66/100，脚头空气、下方实体）；手动塞进地里 2.5 秒自愈。
  - 批次：20261027-3400

---

## 批次 20261027-3300 · 2026-10-27 · 会话 12c62c

> 用户：菜单项风格对齐游戏模式那套；条目在下面时别被遮

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3300

- [x] [L26] 「⋯」菜单项风格 + 自动翻转：`WorldScreen.ts`、`index.html`
  - 做了什么：菜单项对齐 `.world-chip`（半透明底 + 1px 细边 + 12px 字，删除用 chip 的红）；菜单改 `fixed`，打开时按剩余空间上下翻转，关闭清内联坐标。
  - 为什么：列表是 `overflow-y:auto` 会裁掉 absolute 子元素；靠底卡片的下拉必然被吃。
  - 验证：bg=rgba(255,255,255,.07)、position=fixed；300px 高窗口下自动上翻（menuBottom=152 ≤ buttonTop=150）。
  - 批次：20261027-3300

---

## 批次 20261027-3200 · 2026-10-27 · 会话 12c62c

> 用户：两个弹窗标题要白，深色底上发灰

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3200

- [x] [L25] 两个弹窗标题改白：`index.html`
  - 做了什么：`.mp-full-title` / `.mp-port-title` 显式 `color:#fff`。
  - 为什么：它们挂在 `#multiplayer-screen` 下、不在 `.mp-panel` 里，拿不到面板的文字色变量。
  - 验证：computed color = rgb(255,255,255)；截图 V/W。
  - 批次：20261027-3200

---

