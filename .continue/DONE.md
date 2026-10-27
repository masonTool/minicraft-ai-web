# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

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

## 批次 20261027-3100 · 2026-10-27 · 会话 12c62c

> 用户：手机端输入框不许自动弹键盘，只有点击才出浮层

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3100

- [x] [L24] 手机端输入框不再自动弹键盘：`InputOverlay.ts` → playwright
  - 做了什么：`focusin` 里用"最近 600ms 有没有 pointerdown/touchstart"区分用户点击与代码 focus，后者直接 blur 且不弹浮层。
  - 为什么：打开面板/切换表单时代码调 focus() 会把键盘顶起来；逐个删十几处调用不现实。
  - 验证：打开面板 active=BUTTON 无浮层；程序 focus → active=BODY；真点击 → layer=true/active=inp-field。
  - 批次：20261027-3100

---

## 批次 20261027-3000 · 2026-10-27 · 会话 12c62c

> 用户：不猜网段，改从 native 拿；非完整版禁止联机

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3000

- [x] [L23] 局域网 IP 只从 native 桥拿：`core/net/LanIp.ts`（新）、`ServerListPanel.ts` → playwright
  - 做了什么：`hasNativeLanBridge()`/`getLanIp()` 只问 `Capacitor.Plugins.NativeServer.localIp()`；删掉候选网段猜测，`scanBase()` 拿不到就不扫。
  - 为什么：hostname 在 webview 里是 localhost、地址框是上次的服务器、WebRTC 被 mDNS 混淆——都不成立。
  - 验证：`?lanip=192.168.1.20` 时不弹提示、按该网段扫。
  - 批次：20261027-3000
- [x] [L23] 非完整版禁止联机：`MultiplayerScreen.ts`、`NativeServerPlugin.java`、iOS README
  - 做了什么：join/host 打开先 `ensureFullVersion()`；没桥弹「需要完整版」，关闭/前往下载都同时关掉提示与界面；安卓补 `localIp()`。
  - 验证：无桥 → 提示 + 按钮[关闭,前往下载]，点关闭后两者同关；有桥 → 正常。
  - 批次：20261027-3000

---

## 批次 20261027-2900 · 2026-10-27 · 会话 12c62c

> 用户：浮层挡不住触摸、世界页三按钮、⋯下拉、缩略图、.mc 包

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2900

- [x] [L22] 浮层遮罩真正拦截：`InputOverlay.ts` → playwright
  - 做了什么：window 捕获阶段吞掉 pointer/touch/mouse/click/wheel（输入框放行），pointerdown 收起浮层。
  - 为什么：遮罩只挡视觉，事件仍冒泡到 document；页面大量交互是 document 委托，点遮罩会被当成点下层。
  - 验证：点下层按钮位置 → lowerClicks=0、浮层收起。
  - 批次：20261027-2900
- [x] [L22] 世界页三按钮一排：`WorldScreen.ts` + CSS
  - 做了什么：去掉「世界 N」标题行；新建/加入等宽并排（317px），导入存档小一号靠右（72px）。
  - 验证：截图 + 实测宽度。
  - 批次：20261027-2900
- [x] [L22] 「⋯」下拉菜单：`WorldScreen.ts` + CSS
  - 做了什么：导出/编辑/删除竖排浮层，点别处 `pointerdown` 收起。
  - 验证：items=[导出,编辑,删除]，点别处 hidden=true。
  - 批次：20261027-2900
- [x] [L22] 世界缩略图存真实画面：`WorldRegistry.ts`、`WorldScreen.ts`、`main.ts`
  - 做了什么：`thumbnail` 存清单；`onSaved` 抓 160×90 jpeg（10 秒限频）；renderer 开 `preserveDrawingBuffer`。
  - 为什么：原来按世界类型画 CSS 渐变，所有同类世界看起来一样。
  - 验证：min=2/max=255/颜色丰富（非空白），截图能看到天空与草地。
  - 批次：20261027-2900
- [x] [L22] 导出/导入改 `.mc`（zip）：`McPack.ts`（新）、`SaveTransfer.ts`、`main.ts`、`tests/mc-pack.test.ts`
  - 做了什么：手写 store zip；包内 `world.json` + `thumbnail.jpg`；包名空格→中划线，导入优先用包内真名。
  - 验证：导出 `新的世界-1.mc`，python zipfile 解出两个条目；3 条往返单测。
  - 批次：20261027-2900

---

## 批次 20261027-2600 · 2026-10-27 · 会话 12c62c

> 用户：开房界面复用加入房间，只加「选择本机」；另外扫描坏了，先分析原因

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2600

- [x] [L21] 局域网扫描修复：`ServerListPanel.subnets()` → `npm run check`
  - 做了什么：候选网段列表按可能性排序（hostname 私网 IP → 地址框私网 IP → localhost 加回环 → 常见私网段兜底），`refresh()` 分批扫（一次 2 段、找到就停）。
  - 为什么：上一版只认 `location.hostname`，App webview 里它是 `localhost` → 兜底成回环 → 只扫本机；再上一版用地址框 IP 所以能扫到。WebRTC 也不可用（mDNS 混淆成 `xxx.local`）。
  - 验证：右栏扫到 `127.0.0.1(newplayer)` 与 `192.168.1.72(cookroom)` 两台。
  - 批次：20261027-2600
- [x] [L21] 开房复用「加入房间」界面 + 右栏「选择本机」：`MultiplayerScreen.ts`、`ServerListPanel.ts`、`WorldScreen.ts`、`main.ts` → playwright
  - 做了什么：`open('host', world)` 模式（标题/房名/按钮差异）、右栏「选择本机 127.0.0.1」、`onHostOpen` 接线、`hostWorldFlow` 抽成两入口共用。
  - 为什么：两套界面字段完全一样，各写一套只会分叉。
  - 验证：`mode=host` / 标题「开房：新的世界 1」/ 按钮「确定并进入」/ `localVisible=true` / 旧对话框 0。
  - 批次：20261027-2600
- [x] [L21] 修 `.hidden` 静默失效：`index.html`
  - 做了什么：补 `#mp-host.hidden` / `#mp-join.hidden` / `#mp-disconnect.hidden` 三条规则。
  - 为什么：项目里没有通用 `.hidden{display:none}`，`classList.add('hidden')` 对这三颗按钮一直无效——host 模式下「开房」按钮还在，玩家看到两个"开房"。
  - 验证：截图只剩「确定并进入」一颗。
  - 批次：20261027-2600

---

## 批次 20261027-2500 · 2026-10-27 · 会话 12c62c

> 用户：整理文档太花时间，做成一条命令

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2500

- [x] [L20] 台账收尾一条命令：`tools/ledger.mjs`（新）、`tools/audit-tasks.mjs`、`AGENTS.md` → `npm run check`
  - 做了什么：`ledger.mjs` 读队列文件 → 插 DONE（正则找第一条真实批次）→ archive-done → `audit-tasks --fix` 修 HANDOFF 数字 → archive-queue 归档 → 打印"还要手写什么、下一条用哪个编号"；`audit-tasks` 加 `--fix` 直接写回进度口径。
  - 为什么：上一批功能提交 20:39、台账 20:56，**整理文档 17 分钟**——猜编号、猜锚点、手改数字再重跑 check，全是机械劳动。
  - 验证：`npm run check` exit=0；自测时发现并修掉两个 bug（插入位置匹配到文档模板行、编号统计混入 D/O/P 前缀）。
  - 批次：20261027-2500

---

## 批次 20261027-2400 · 2026-10-27 · 会话 12c62cf0

> 用户 2026-10-27：回退了之前"挪原框"那版，重新按他的口径做——整层黑遮罩 + 左上角输入区，
> 无边框、只留下方一条线；PC 端不要这套逻辑。

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-2400

- [x] [L19] 手机端输入浮层按定稿重做：`src/ui/InputOverlay.ts`、`index.html` → playwright
  - 做了什么：新增 `.inp-layer`（全屏 `rgba(0,0,0,.75)`、`z-index: 9999`、`touch-action: none`）作为遮罩层，输入框 `.inp-field` 是它的子元素、绝对定位到左上角（`(12,12)`，宽 `min(62vw,340px)`）；输入区**无边框**，只有 `border-bottom: 2px` 主色线，透明底白字 17px；点原框 → 层出现 + `focus()` + `select()` 全选；`input` 事件**边打边写回**原框并派发 `input`；点遮罩（`pointerdown` on layer）→ `blur()` → 走统一的 `finish()`：落值 + 派发 `change` + 收层。
  - 为什么：用户明确"左上角那个输入框不是单独的输入框，而是整个界面加一层黑色半透明遮罩，输入框在遮罩的左上角"。这样才能同时做到"看得见输入"和"拦住下面所有触摸"。
  - 验证：触屏 → `layer.visible`、`bg rgba(0,0,0,.75)`、`z 9999`、输入区 `(12,12,340)`、`borderTop 0px` + `borderBottom 2px rgb(127,168,111)`、`focused: true`、`elementFromPoint(600,400)` 返回 `.inp-layer`；输入 `192.168.1.88` 实时写回 `#mp-url`，点遮罩后层消失、值保留。桌面（不带参数）→ `.inp-layer` 完全不创建。截图 `N-final.png`。
  - 批次：20261027-2400
- [x] [L19] PC 端完全不启用 + 桌面自检开关
  - 做了什么：`shouldLift()` 取三项并集（`maxTouchPoints` / `ontouchstart` / `pointer: coarse`），全假时再排除"有鼠标精确指针的桌面"；`?lift=1` 强制启用。
  - 为什么：只依赖 `maxTouchPoints` 会漏（部分手机浏览器报 0，这正是之前"手机上没效果"的隐患之一）；而三项全假的明确桌面才该让路。
  - 验证：桌面不带参数 → `layer: false`；加 `?lift=1` → 正常出现。
  - 批次：20261027-2400
- [x] [L19] 修 `maxLength = -1` 的静默异常
  - 做了什么：`element.maxLength >= 0` 才赋值，否则 `removeAttribute('maxlength')`。
  - 为什么：`maxLength` 在没设上限时是 **-1**，直接赋给 input 会抛 `IndexSizeError`，异常打断 `open()` 在"显示遮罩"之前——表现是"点了输入框什么都不发生"（第一版就是这个症状）。
  - 验证：修前 `layer: false`，修后 `layer: true`。
  - 批次：20261027-2400

---

