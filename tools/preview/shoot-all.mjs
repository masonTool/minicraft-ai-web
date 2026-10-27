#!/usr/bin/env node
/**
 * 把**已迁到 canvas 的界面**逐个截图，落到 `.tmp/canvas-version/`。
 *
 * 为什么单独一个脚本：截图清单本身就是"实现到哪一步"的凭证 ——
 * 口头说"搬了快捷栏"没有意义，能一张张摆出来的才算数。加一块新界面时，
 * 往下面的 `SHOTS` 里加一行，跑一遍，目录里就多一张图。
 *
 * 用法（先起 dev server）：
 *   npm run dev &
 *   node tools/preview/shoot-all.mjs                     # 默认 http://localhost:5173
 *   node tools/preview/shoot-all.mjs --base http://localhost:5199
 *
 * 说明：
 *  · 底层复用 `tools/screenshot.mjs`（找不到浏览器时它 exit 0，这里也照旧不报错，
 *    只是把 `[skip]` 原样打出来 —— 环境缺东西不该让"实现进度"变成红灯）；
 *  · 产物在 `.tmp/` 下，**不进 git**；要长期留就看 `tools/preview/*.html` 的复现命令。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(projectRoot, '.tmp', 'canvas-version');

/** 参数：只认 `--base <url>` */
function baseUrl(argv) {
  const index = argv.indexOf('--base');
  return (index >= 0 ? argv[index + 1] : undefined) ?? 'http://localhost:5173';
}

/**
 * 截图清单（**按实现进度排**）。
 *
 * `page` 是预览页的相对路径 + 查询串；`size` 是视口（hud 页固定 864×410，
 * 因为它的"假世界"是 844×390 的手机横屏）。
 */
const SHOTS = [
  {
    file: '01-hotbar-canvas.png',
    page: 'tools/preview/hotbar.html?only=canvas',
    size: [520, 180],
    what: '快捷栏（canvas 版）：9 格 + 图标 + 数量 + 序号 + 耐久三档 + 选中格',
    status: '已迁 · 阶段 1.5',
  },
  {
    file: '01b-hotbar-dom-vs-canvas.png',
    page: 'tools/preview/hotbar.html',
    size: [520, 320],
    what: '快捷栏：上面 DOM 版、下面 canvas 版（同一份数据，用来肉眼对差异）',
    status: '已迁 · 阶段 1.5',
  },
  {
    file: '02-damage-flash.png',
    page: 'tools/preview/hud.html?only=flash',
    size: [864, 410],
    what: '受伤红闪（强度 0.55）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '03-boss-dragon.png',
    page: 'tools/preview/hud.html?only=boss',
    size: [864, 410],
    what: 'Boss 血条（末影龙配色）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '04-boss-wither.png',
    page: 'tools/preview/hud.html?only=boss&variant=wither',
    size: [864, 410],
    what: 'Boss 血条（凋灵配色）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '05-progress.png',
    page: 'tools/preview/hud.html?only=progress',
    size: [864, 410],
    what: '破坏进度条（白，42%）与进食进度条（黄，68%）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '00-hud-overview.png',
    page: 'tools/preview/hud.html',
    size: [864, 410],
    what: '阶段 0 三样同时在屏上的样子（红闪 + Boss 条 + 两条进度）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '09-vitals.png',
    page: 'tools/preview/vitals.html',
    size: [864, 410],
    what: '状态栏四行（生命 13 / 饥饿 17 / 护甲 5 / 氧气 180）+ 经验条与等级 12',
    status: '已迁 · 阶段 2',
  },
  {
    file: '09b-vitals-low.png',
    page: 'tools/preview/vitals.html?health=3&food=8&armor=0&air=300&level=7&xp=0.9',
    size: [864, 410],
    what: '同一块的另一种状态：残血 3 点、没穿甲（护甲行不显示）、氧气满（气泡行不显示）',
    status: '已迁 · 阶段 2',
  },
  {
    file: '10-controls.png',
    page: 'tools/preview/controls.html',
    size: [940, 620],
    what: '控件库：开关 / 滑块 / 下拉 / 页签 / 滚动列表 / 提示框 / 弹窗（可交互页）',
    status: '已迁 · 阶段 1',
  },
  {
    file: '10b-controls-dropdown.png',
    page: 'tools/preview/controls.html?state=dropdown',
    size: [940, 620],
    what: '下拉展开：菜单贴在字段下方，已选中项高亮',
    status: '已迁 · 阶段 1',
  },
  {
    file: '10c-controls-modal.png',
    page: 'tools/preview/controls.html?state=modal',
    size: [940, 620],
    what: '弹窗：不透明深色面板 + 标题栏 + ✕（底下的列表不会透上来）',
    status: '已迁 · 阶段 1',
  },
  {
    file: '10e-controls-tooltip.png',
    page: 'tools/preview/controls.html?state=tooltip',
    size: [940, 620],
    what: '提示框：贴在锚点下方，靠边会自动翻边',
    status: '已迁 · 阶段 1',
  },
  {
    file: '10d-controls-tinted.png',
    page: 'tools/preview/controls.html?tint=1',
    size: [940, 620],
    what: '控件库 + 黄色遮罩：整页黄 = 这七个控件全是 canvas 画的',
    status: '遮罩 · 阶段 1',
  },
  {
    file: '11-tips.png',
    page: 'tools/preview/tips.html',
    size: [864, 410],
    what: '提示条三样：目标名（准星下）、攻击蓄力条 60%、物品名浮标（已显示 400ms）',
    status: '已迁 · 阶段 2',
  },
  {
    file: '11b-tips-fade.png',
    page: 'tools/preview/tips.html?age=2175&charge=100',
    size: [864, 410],
    what: '同一屏的另一态：蓄力满了（条消失）+ 物品名淡出到一半',
    status: '已迁 · 阶段 2',
  },
  {
    file: '11c-tips-tinted.png',
    page: 'tools/preview/tips.html?tint=1',
    size: [864, 410],
    what: '提示条 + 黄色遮罩（三块黄 = 这三样都是 canvas 画的）',
    status: '遮罩 · 阶段 2',
  },
  {
    file: '12-tool-dial.png',
    page: 'tools/preview/dial.html',
    size: [864, 410],
    what: '指南针与时钟表盘（左时钟 210°、右指南针 45°）+ 读数',
    status: '已迁 · 阶段 2',
  },
  {
    file: '13-menu.png',
    page: 'tools/preview/menu.html',
    size: [864, 410],
    what: '暂停菜单（canvas 面板）：4 行 + 焦点 ▶ + 底部操作提示',
    status: '已迁 · 输入通道',
  },
  {
    file: '13b-menu-tinted.png',
    page: 'tools/preview/menu.html?tint=1',
    size: [864, 410],
    what: '暂停菜单 + 遮罩（面板与按钮都是 canvas 画的）',
    status: '遮罩 · 输入通道',
  },
  {
    file: '12b-dial-tinted.png',
    page: 'tools/preview/dial.html?tint=1',
    size: [864, 410],
    what: '表盘 + 遮罩（两块黄 = canvas 画的）',
    status: '遮罩 · 阶段 2',
  },
  {
    file: '14-pause-dom-driven.png',
    page: 'tools/preview/menu.html?from=dom',
    size: [864, 410],
    what: '暂停菜单（游戏里那一版）：行标签直接取自 DOM 按钮的 textContent（4 颗真实按钮）',
    status: '已接线 · 阶段 3',
  },
  {
    file: '15-settings-form.png',
    page: 'tools/preview/form.html',
    size: [864, 410],
    what: '设置表单（canvas）：页签 + 开关 / 循环按钮 / 滑杆 + 滚动条（数据来自隐藏的真实 DOM 行）',
    status: '原型 · 阶段 3',
  },
  {
    file: '15b-settings-form-tinted.png',
    page: 'tools/preview/form.html?tint=1',
    size: [864, 410],
    what: '设置表单 + 遮罩',
    status: '遮罩 · 阶段 3',
  },
  {
    file: '16-text-panels.png',
    page: 'tools/preview/textpanels.html',
    size: [864, 410],
    what: '纯文字 HUD：F3 调试信息（左上，多行等宽）+ 计分板（右上，名字左/分数右）',
    status: '已迁 · 阶段 4',
  },
  {
    file: '16b-text-panels-tinted.png',
    page: 'tools/preview/textpanels.html?tint=1',
    size: [864, 410],
    what: '纯文字 HUD + 遮罩（两块黄 = 底色与文字都是 canvas 画的）',
    status: '遮罩 · 阶段 4',
  },
  {
    file: '17-main-menu.png',
    page: 'tools/preview/menu-mirror.html',
    size: [864, 410],
    what: '主菜单首页（整页镜像）：面板 / 标题 / 四颗按钮全部由 canvas 重画',
    status: '已迁 · 阶段 3',
  },
  {
    file: '17b-world-list.png',
    page: 'tools/preview/menu-mirror.html?view=worlds',
    size: [864, 410],
    what: '世界列表（整页镜像）：3 张世界卡片 + 房间/编辑小按钮 + 新建世界',
    status: '已迁 · 阶段 3',
  },
  {
    file: '17c-main-menu-tinted.png',
    page: 'tools/preview/menu-mirror.html?tint=1',
    size: [864, 410],
    what: '主菜单 + 黄色遮罩（整块黄 = 面板与文字都是 canvas 画的）',
    status: '遮罩 · 阶段 3',
  },
  {
    file: '18-text-input.png',
    page: 'tools/preview/textinput.html',
    size: [864, 410],
    what: 'canvas 文本输入（聚焦态）：占位提示 + 光标，第二个字段是未聚焦的空框',
    status: '已迁 · 阶段 3',
  },
  {
    file: '18b-text-input-typed.png',
    page: 'tools/preview/textinput.html?value=%E6%88%91%E7%9A%84%E4%B8%96%E7%95%8C&sel=1,3',
    size: [864, 410],
    what: '同一块里填了中文并选中一段（选区是 canvas 画的）',
    status: '已迁 · 阶段 3',
  },
  {
    file: '19-create-form.png',
    page: 'tools/preview/menu-mirror.html?view=create',
    size: [864, 410],
    what: '新建世界表单（整页镜像）：输入框的值由 canvas 画、光标按 selectionStart 自己画',
    status: '已迁 · 阶段 3',
  },
  {
    file: '20-chat-entry.png',
    page: 'tools/preview/chat.html',
    size: [864, 410],
    what: '聊天输入行镜像：输入框与绿色发送键由 canvas 画，光标按 selectionStart 自己画',
    status: '已迁 · 阶段 3',
  },
  {
    file: '21-inventory.png',
    page: 'tools/preview/inventory.html',
    size: [864, 410],
    what: '背包槽位（canvas）：27 格 + 快捷栏行、图标/数量/耐久/红底格/选择白框',
    status: '已迁 · 阶段 4',
  },
  {
    file: '21b-inventory-tinted.png',
    page: 'tools/preview/inventory.html?tint=1',
    size: [864, 410],
    what: '背包槽位 + 黄色遮罩（格子全黄 = 槽位都是 canvas 画的；面板底仍是 DOM）',
    status: '遮罩 · 阶段 4',
  },
  {
    file: '22-inventory-compare.png',
    page: 'tools/preview/inventory-compare.html',
    size: [900, 460],
    what: '背包逻辑复原：左 DOM / 右 canvas，同一份数据同一套逻辑，点哪边两边都变',
    status: '已迁 · 阶段 4',
  },
  {
    file: '22b-inventory-held.png',
    page: 'tools/preview/inventory-compare.html',
    size: [900, 470],
    what: '在 canvas 面板上点起一格：两侧同步清空，手上那叠由 canvas 画并跟随指针',
    status: '已迁 · 阶段 4',
  },
  {
    file: '23-inventory-mirror.png',
    page: 'tools/preview/inventory-mirror.html',
    size: [864, 410],
    what: '背包**整页镜像**：面板底/槽位斜面/物品图标/数量/耐久条全由 canvas 重画',
    status: '已迁 · 阶段 4',
  },
  {
    file: '23b-inventory-mirror-tinted.png',
    page: 'tools/preview/inventory-mirror.html?tint=1',
    size: [864, 410],
    what: '背包整页镜像 + 遮罩（整块黄 = 面板里每一像素都是 canvas 画的）',
    status: '遮罩 · 阶段 4',
  },
  {
    file: '24-multiplayer.png',
    page: 'tools/preview/multiplayer-mirror.html',
    size: [864, 410],
    what: '多人面板整页镜像：标题/输入框的值/状态行/按钮全由 canvas 画（光标按 selectionStart）',
    status: '已迁 · 阶段 3',
  },
  {
    file: '24b-multiplayer-tinted.png',
    page: 'tools/preview/multiplayer-mirror.html?tint=1',
    size: [864, 410],
    what: '多人面板 + 遮罩（整块面板黄 = 全是 canvas）',
    status: '遮罩 · 阶段 3',
  },
  {
    file: '25-inventory-scroll.png',
    page: 'tools/preview/inventory-mirror.html?creative=1&scroll=80',
    size: [864, 410],
    what: '创造物品栏（96 项、滚动 80px）：canvas 只画滚动区里看得见的几行，超出的被裁掉',
    status: '已迁 · 阶段 4',
  },
  {
    file: '26-world-mirror.png',
    page: 'tools/preview/world-real.html',
    size: [480, 760],
    what: '**真 WorldScreen 首页**的镜像（三颗按钮 游戏/设置/小游戏）：位置与 DOM 基准一致',
    status: '已迁 · 阶段 3',
  },
  {
    file: '26b-world-dom.png',
    page: 'tools/preview/world-real.html?plain=1',
    size: [480, 760],
    what: '同一页的 DOM 基准（不镜像）：用来比对位置',
    status: '基准 · 阶段 3',
  },
  {
    file: '27-inventory-rails.png',
    page: 'tools/preview/inventory-mirror.html',
    size: [864, 410],
    what: '背包 + **左右立栏**（左：分类/仓库；右：人物/成就/配方）——镜像根改成 `.inv-shell` 后一起上 canvas',
    status: '已迁 · 阶段 4',
  },
  {
    file: '27b-inventory-rails-tinted.png',
    page: 'tools/preview/inventory-mirror.html?tint=1',
    size: [864, 410],
    what: '背包 + 立栏 + 遮罩（面板与立栏全黄）',
    status: '遮罩 · 阶段 4',
  },
  {
    file: '28-inventory-scrollbar.png',
    page: 'tools/preview/inventory-mirror.html?creative=1&scroll=48',
    size: [864, 410],
    what: '滚动条：镜像自己画的细拇指（滚 48px 时的位置与长度都对）',
    status: '已迁 · 阶段 4',
  },
  {
    file: '29-touch-stick.png',
    page: 'tools/preview/touch.html?state=active&dx=24&dy=-16',
    size: [864, 410],
    what: '触控摇杆（按下态、芯子偏右上）：底座玻璃 + 高光 + 芯子渐变',
    status: '已迁 · 阶段 6',
  },
  {
    file: '29b-touch-stick-sneak.png',
    page: 'tools/preview/touch.html?state=sneak&dx=-18&dy=12',
    size: [864, 410],
    what: '潜行态：绿芯 + 绿边 + 上方「潜行」小牌（文字从 DOM 读，跟着 i18n）',
    status: '已迁 · 阶段 6',
  },
  {
    file: '29c-touch-stick-tinted.png',
    page: 'tools/preview/touch.html?state=active&tint=1',
    size: [864, 410],
    what: '摇杆 + 遮罩（两块黄 = canvas 画的）',
    status: '遮罩 · 阶段 6',
  },
  {
    file: '30-touch-buttons.png',
    page: 'tools/preview/touch.html?state=active&fly=1',
    size: [864, 410],
    what: '**触控按钮簇**：顶部三颗（聊天/暂停/视角）+ 右下跳跃与飞行升降，图标与 DOM 同一份数据',
    status: '已迁 · 阶段 6',
  },
  {
    file: '30b-touch-buttons-tinted.png',
    page: 'tools/preview/touch.html?state=active&fly=1&tint=1',
    size: [864, 410],
    what: '摇杆 + 六颗按钮 + 遮罩（整片按钮黄 = 全是 canvas 画的）',
    status: '遮罩 · 阶段 6',
  },
  {
    file: '31-inventory-hover.png',
    page: 'tools/preview/inventory-mirror.html?hover=13',
    size: [864, 410],
    what: '背包悬停高亮：第 13 格一圈白框 + 薄白底（`opacity: 0` 的子树里 CSS `:hover` 画不出来）',
    status: '已迁 · 阶段 4',
  },
  // ---- 黄色遮罩版（`?tint=1`）：一眼看出"这块像素是 canvas 画的" ------------------
  {
    file: '06-hotbar-tinted.png',
    page: 'tools/preview/hotbar.html?only=canvas&tint=1',
    size: [520, 180],
    what: '快捷栏 + 黄色遮罩：整条面板都是 canvas 的',
    status: '遮罩 · 阶段 1.5',
  },
  {
    file: '06b-hotbar-tinted-dom-vs-canvas.png',
    page: 'tools/preview/hotbar.html?tint=1',
    size: [520, 320],
    what: '同一份数据：上排 DOM（不染色）/ 下排 canvas（染黄）',
    status: '遮罩 · 阶段 1.5',
  },
  {
    file: '07-boss-tinted.png',
    page: 'tools/preview/hud.html?only=boss&tint=1',
    size: [864, 410],
    what: 'Boss 条 + 黄色遮罩（只有那条血条被染）',
    status: '遮罩 · 阶段 0',
  },
  {
    file: '09c-vitals-tinted.png',
    page: 'tools/preview/vitals.html?tint=1',
    size: [864, 410],
    what: '状态栏 + 经验条 + 黄色遮罩（底部整块黄 = 全是 canvas 画的）',
    status: '遮罩 · 阶段 2',
  },
  {
    file: '08-all-tinted.png',
    page: 'tools/preview/hud.html?tint=1',
    size: [864, 410],
    what: '三样一起 + 黄色遮罩：红闪本身是全屏的，所以整屏偏黄是对的',
    status: '遮罩 · 阶段 0',
  },
];

const base = baseUrl(process.argv.slice(2));
mkdirSync(OUT_DIR, { recursive: true });

let skipped = false;
for (const shot of SHOTS) {
  const [width, height] = shot.size;
  try {
    const out = execFileSync(
      process.execPath,
      [
        join(projectRoot, 'tools', 'screenshot.mjs'),
        '--url',
        `${base}/${shot.page}`,
        '--out',
        join(OUT_DIR, shot.file),
        '--wait',
        '1800',
        '--width',
        String(width),
        '--height',
        String(height),
      ],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (/\[skip\]/.test(out)) {
      skipped = true;
      console.log(`  [skip] ${shot.file}（没有浏览器）`);
    } else {
      console.log(`  ✓ ${shot.file}  ← ${shot.what}`);
    }
  } catch (error) {
    // 页面报错/截不到图才算失败：环境问题在 screenshot.mjs 里已经 exit 0
    console.log(`  ✗ ${shot.file}  ${String(error.stderr ?? error.message).slice(0, 160)}`);
    process.exitCode = 1;
  }
}

console.log(`\n产物目录：${OUT_DIR}`);
if (skipped) console.log('（部分截图被跳过：装 Chrome 或设 CHROME_PATH 再来）');
