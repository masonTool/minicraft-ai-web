/**
 * 新手引导的离线测试（引导1）
 *
 * 运行：npm run test:tutorial
 *
 * 只测纯逻辑：步骤表是否自洽、事实如何推进、越级/重复如何表现、
 * 存档序列化能不能来回，以及脏数据会不会把进度推乱。
 * 界面（卡片）与接线（主程序事件点）不在这里。
 */

import { readFileSync } from 'node:fs';
import { BED_IDS, Block, woolId } from '../web/src/core/registry/blocks.ts';
import { toolItemId } from '../web/src/core/registry/tools.ts';
import { TUTORIAL_STEPS, familyOfItem, stepsOf } from '../web/src/tutorial/steps.ts';
import { MAX_TRACKED_KINDS, TutorialTracker } from '../web/src/tutorial/TutorialTracker.ts';
// 文案那一侧走 `t()` / `allKeys()` 查表，不读文案文件源码（多语言 P0-2 起中文表按界面拆分）
import { allKeys, t } from '../web/src/core/i18n/I18n.ts';
import { planTutorialBoot, shouldVoidTutorialOnModeChange, tutorialTrackFor } from '../web/src/tutorial/boot.ts';
import {
  TUTORIAL_CARD_MAX_WIDTH,
  isShortViewport,
  overlapsHotbar,
  overlapsTouchPauseBar,
  touchPauseBarRight,
  tutorialCardBox,
} from '../web/src/ui/tutorialLayout.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

// ------------------------------------------------------------------ 步骤表

console.log('\n步骤表');
{
  equal('共 8 步', TUTORIAL_STEPS.length, 8);
  equal('生存 4 步', stepsOf('survival').length, 4);
  equal('创造 4 步', stepsOf('creative').length, 4);

  const ids = new Set(TUTORIAL_STEPS.map((step) => step.id));
  equal('id 不重复', ids.size, TUTORIAL_STEPS.length);
  check(
    '每条都有标题与说明的文案键',
    TUTORIAL_STEPS.every((step) => step.titleKey.includes('.') && step.descKey.includes('.')),
  );
  check(
    '每条都有图标物品',
    TUTORIAL_STEPS.every((step) => Number.isInteger(step.icon) && step.icon > 0),
  );
  check(
    'id 前缀与路径一致（生存 survival/、创造 creative/）',
    TUTORIAL_STEPS.every((step) => step.id.startsWith(`${step.track}/`)),
  );
}

// ------------------------------------------------------------------ 家族判定

console.log('\n家族判定（不手抄 id 表）');
{
  equal('橡木原木算原木', familyOfItem(Block.OAK_LOG), 'log');
  equal('剥皮原木也算原木', familyOfItem(Block.STRIPPED_OAK_LOG), 'log');
  equal('石头不是原木', familyOfItem(Block.STONE), null);
  // 床那一族随"床"这一步一起删了（2026-10-22 用户：做到石镐就够）
  equal('床不再属于任何家族', familyOfItem(BED_IDS[0]!), null);
  equal('橡木门算门', familyOfItem(Block.OAK_DOOR), 'door');
  equal('活板门也算门', familyOfItem(Block.OAK_TRAPDOOR), 'door');
  equal('铁镐什么家族都不算', familyOfItem(toolItemId('pickaxe', 'iron')), null);
}

// ------------------------------------------------------------------ 生存路径

console.log('\n生存 4 步按顺序推进（终点是石镐）');
{
  const tracker = new TutorialTracker('survival');
  equal('第一步是撸木头', tracker.current?.id, 'survival/log');

  // 放方块不会让"获得原木"成立，但会记进放置计数
  equal('放方块不会推进第 1 步', tracker.handle({ kind: 'place', block: Block.DIRT, y: 64 }).length, 0);
  equal('第 1 步还在', tracker.current?.id, 'survival/log');

  const first = tracker.handle({ kind: 'obtain', item: Block.OAK_LOG });
  equal('拿到原木推进 1 步', first.length, 1);
  equal('下一步是工作台', tracker.current?.id, 'survival/table');

  tracker.handle({ kind: 'obtain', item: Block.CRAFTING_TABLE });
  equal('工作台之后是木镐', tracker.current?.id, 'survival/wood_pickaxe');
  tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'wooden') });
  equal('木镐之后是石镐（最后一步）', tracker.current?.id, 'survival/stone_pickaxe');

  const last = tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'stone') });
  equal('石镐完成最后一步', last.length, 1);
  equal('拿到石镐就整条走完（不再要求熔炉/铁镐/床/小屋）', tracker.finished, true);
  equal('走完后没有当前步骤', tracker.current, null);
  equal('放置计数照常保留', tracker.serialize().counters.placed, 1);

  // 反过来钉住"这四步不该再回到表里"：以后有人想把 8 步加回来，
  // 先得删掉这条断言（而不是无声地把新手又推去挖铁）
  const ids = new Set(TUTORIAL_STEPS.map((step) => step.id));
  check(
    '熔炉 / 铁镐 / 床 / 小屋都不在表里',
    ['survival/furnace', 'survival/iron_pickaxe', 'survival/bed', 'survival/house'].every((id) => !ids.has(id)),
  );
}

// ------------------------------------------------------------------ 幂等与越级

console.log('\n重复上报与越级');
{
  const tracker = new TutorialTracker('survival');
  tracker.handle({ kind: 'obtain', item: Block.OAK_LOG });
  const again = tracker.handle({ kind: 'obtain', item: Block.OAK_LOG });
  equal('同一件物品再报一次不推进', again.length, 0);
  equal('仍停在工作台这一步', tracker.current?.id, 'survival/table');

  // 严格顺序：已经有铁镐也不会跳掉前面的教学步
  const jumped = new TutorialTracker('survival');
  const result = jumped.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'iron') });
  equal('越级物品不会跳过第 1 步', result.length, 0);
  equal('仍然要求先撸木头', jumped.current?.id, 'survival/log');
}

// ------------------------------------------------------------------ 创造路径

console.log('\n创造 4 步（放 10 → 搭高 → 换颜色 → 盖门）');
{
  const tracker = new TutorialTracker('creative');
  equal('第一步是放 10 块', tracker.current?.id, 'creative/place10');

  for (let i = 0; i < 9; i++) tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 64 });
  equal('9 块还不够', tracker.current?.id, 'creative/place10');

  const tenth = tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 64 });
  equal('第 10 块只推进到搭高（都在同一层）', tenth.length, 1);
  equal('下一步是搭起来', tracker.current?.id, 'creative/layers');

  tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 65 });
  const span = tracker.handle({ kind: 'place', block: Block.GRASS_BLOCK, y: 66 });
  equal('3 个高度层推进到换颜色', span.length, 1);
  equal('下一步是换颜色', tracker.current?.id, 'creative/colors');

  tracker.handle({ kind: 'place', block: Block.STONE, y: 64 });
  const colors = tracker.handle({ kind: 'place', block: woolId(14), y: 64 });
  equal('第 3 种方块推进到盖门', colors.length, 1);
  equal('下一步是盖门', tracker.current?.id, 'creative/door');

  const door = tracker.handle({ kind: 'place', block: Block.OAK_DOOR, y: 64 });
  equal('放一扇门完成', door.length, 1);
  equal('创造走完', tracker.finished, true);
}

console.log('\n搭高的判定边界');
{
  const noY = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) noY.handle({ kind: 'place', block: Block.STONE });
  equal('事件不带 y 时不算搭起来', noY.current?.id, 'creative/layers');

  const gaps = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) gaps.handle({ kind: 'place', block: Block.STONE, y: 64 });
  gaps.handle({ kind: 'place', block: Block.STONE, y: 66 });
  equal('y 跨度到 3 层即算（不要求连续堆叠）', gaps.current?.id, 'creative/colors');
}

// ------------------------------------------------------------------ 存档

console.log('\n序列化与恢复');
{
  const mid = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) mid.handle({ kind: 'place', block: Block.STONE, y: 64 });
  const save = mid.serialize();
  equal('存档记下已完成 1 步', save.completed.length, 1);
  equal('计数也存了', save.counters.placed, 10);

  const back = new TutorialTracker('survival');
  const restored = back.restore(save);
  equal('恢复 1 步', restored, 1);
  equal('路径恢复成创造', back.trackId, 'creative');
  equal('停在搭高这一步', back.current?.id, 'creative/layers');
  equal('计数接着数（不是从 0 开始）', back.serialize().counters.placed, 10);
}

console.log('\n脏数据逐项跳过');
{
  equal('restore(null) 当没存档', new TutorialTracker('creative').restore(null), 0);
  equal(
    '版本不对当没存档',
    new TutorialTracker('creative').restore({ version: 2, track: 'creative', completed: ['creative/place10'] }),
    0,
  );

  const tracker = new TutorialTracker();
  const accepted = tracker.restore({
    version: 1,
    track: 'creative',
    // 未知 id / 非字符串 / 合法项混在一起：只认连续前缀里的合法项
    completed: ['creative/place10', '不存在', 42, 'creative/layers'],
    counters: {
      placed: Number.NaN,
      kinds: [-1, 3.5, 'x', 70000, 5, 5],
      minY: 70,
      maxY: 64,
    },
  });
  equal('连续前缀认了 2 步', accepted, 2);
  equal('随时停在第 3 步', tracker.current?.id, 'creative/colors');
  equal('NaN 计数被丢掉', tracker.serialize().counters.placed, 0);
  equal('非法方块 id 被过滤（只剩一个 5）', tracker.serialize().counters.kinds.length, 1);
  equal('minY > maxY 时高度当没放过', tracker.serialize().counters.minY, null);
  equal('高度上限也一并回落', tracker.serialize().counters.maxY, null);

  // 不连续的完成记录不能把人推到第 3 步
  const gap = new TutorialTracker();
  const gapAccepted = gap.restore({
    version: 1,
    track: 'survival',
    completed: ['survival/log', 'survival/stone_pickaxe'],
    counters: { placed: 0, kinds: [], minY: null, maxY: null },
  });
  equal('跳步的完成记录只认前缀 1 步', gapAccepted, 1);
  equal('停在第二步（工作台）', gap.current?.id, 'survival/table');

  // 升级兼容：老存档（生存 8 步那一版）走到铁镐之后读进来。
  // 多出来的 id 现在谁也不认识 → 只认前 4 个连续前缀 → 直接算"引导已走完"，
  // 不会把人塞回"去做工作台"。（这条是删步骤时最容易漏掉的一条。）
  const legacy = new TutorialTracker('survival');
  const kept = legacy.restore({
    version: 1,
    track: 'survival',
    completed: [
      'survival/log',
      'survival/table',
      'survival/wood_pickaxe',
      'survival/stone_pickaxe',
      'survival/furnace',
      'survival/iron_pickaxe',
      'survival/bed',
      'survival/house',
    ],
    counters: { placed: 12, kinds: [1], minY: 60, maxY: 62 },
  });
  equal('老存档的 8 步被截成 4 步', kept, 4);
  equal('老存档直接判定引导完成（不倒退）', legacy.finished, true);
  equal('老存档不会再有当前步骤（不会再弹卡）', legacy.current, null);
}

console.log('\n计数上限');
{
  const many = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) many.handle({ kind: 'place', block: Block.STONE, y: 64 });
  for (let i = 0; i < MAX_TRACKED_KINDS + 40; i++) many.handle({ kind: 'place', block: i + 1, y: 64 });
  check(
    '放过的方块种类不超过上限（脏事件撑不爆）',
    many.serialize().counters.kinds.length <= MAX_TRACKED_KINDS,
    `实际 ${many.serialize().counters.kinds.length}`,
  );
}

// ------------------------------------------------------------------ 卡片几何

console.log('\n引导卡几何（横屏不遮挡）');
{
  const cases: Array<[string, number, number]> = [
    ['844×390 主力横屏', 844, 390],
    ['640×360 小横屏', 640, 360],
    ['932×430 横屏', 932, 430],
    ['430×932 竖屏', 430, 932],
    ['1440×900 桌面', 1440, 900],
  ];

  for (const [label, width, height] of cases) {
    const box = tutorialCardBox(width, height);
    check(
      `${label}：不压顶部暂停三键`,
      !overlapsTouchPauseBar(box, width),
      `卡片左边 ${box.left} / 暂停键右边 ${touchPauseBarRight(width)}`,
    );
    check(`${label}：不压底部快捷栏`, !overlapsHotbar(box, height));
    check(
      `${label}：宽度有值且不超上限`,
      box.maxWidth > 0 && box.maxWidth <= TUTORIAL_CARD_MAX_WIDTH,
      `实际 ${box.maxWidth}`,
    );
  }

  // 主力机型的具体数字：布局口径一改，这两条会直接红
  const main = tutorialCardBox(844, 390);
  equal('844×390 卡片宽 320', main.maxWidth, 320);
  equal('844×390 左边界落在 516', main.left, 516);
  check('844×390 与暂停键之间至少留 8px', main.left - touchPauseBarRight(844) >= 8);

  // 窄竖屏靠"可用宽度"那一道兜住（38vw 在这里还不够）
  const narrow = tutorialCardBox(430, 932);
  check('430 竖屏仍与暂停键留出 8px', narrow.left - touchPauseBarRight(430) >= 8, `实际 ${narrow.left - touchPauseBarRight(430)}`);

  check('390 高算矮横屏（说明收成两行）', isShortViewport(390));
  check('932 高不算矮屏', !isShortViewport(932));

  const zero = tutorialCardBox(0, 0);
  equal('0×0 视口宽度不为负', zero.maxWidth, 0);
  equal('0×0 视口左边界不为负', zero.left, 0);
}

// ------------------------------------------------------------------ 启动决策

console.log('\n启动决策（新世界 / 老存档 / 有数据）');
{
  const mid = new TutorialTracker('creative');
  for (let i = 0; i < 10; i++) mid.handle({ kind: 'place', block: Block.STONE, y: 64 });
  const saved = mid.serialize();

  const fresh = planTutorialBoot({ hasSave: false, saved: null, mode: 'survival' });
  equal('新世界：走生存 4 步', fresh.track, 'survival');
  equal('新世界：要显示', fresh.dismissed, false);
  equal('新世界：不恢复任何状态', fresh.restore, null);

  equal('新世界（创造）：走建造小目标', planTutorialBoot({ hasSave: false, saved: null, mode: 'creative' }).track, 'creative');
  equal('冒险模式走生存路径', tutorialTrackFor('adventure'), 'survival');
  equal('旁观模式走生存路径', tutorialTrackFor('spectator'), 'survival');

  const old = planTutorialBoot({ hasSave: true, saved: null, mode: 'survival' });
  equal('老存档没有引导数据：不弹（不是数据坏了）', old.dismissed, true);
  equal('老存档没有引导数据：也不恢复', old.restore, null);

  const restored = planTutorialBoot({ hasSave: true, saved: { state: saved, dismissed: false }, mode: 'survival' });
  equal('有数据：路径听存档的（创造）', restored.track, 'creative');
  equal('有数据：恢复的就是存档那一份', restored.restore, saved);
  equal('有数据：不被当前模式覆盖', restored.dismissed, false);

  const dismissedSave = planTutorialBoot({ hasSave: true, saved: { state: saved, dismissed: true }, mode: 'survival' });
  equal('点过「不再提示」：照样不弹', dismissedSave.dismissed, true);
}

// ------------------------------------------------------------------ 切模式即作废
//
// 批次 20261024-1152（用户）："引导没完成就切了模式（创造↔生存），引导就要直接废掉，
// 因为它都已经乱掉了"。
console.log('\n引导进行中切模式 → 作废（批次 20261024-1152）');
{
  equal(
    '引导没走完 + 玩家切模式 → 作废',
    shouldVoidTutorialOnModeChange({ dismissed: false, finished: false, restoringSave: false }),
    true,
  );
  equal(
    '读档恢复模式不算玩家切换（老存档不能被清掉）',
    shouldVoidTutorialOnModeChange({ dismissed: false, finished: false, restoringSave: true }),
    false,
  );
  equal(
    '已经作废过 → 不重复处理',
    shouldVoidTutorialOnModeChange({ dismissed: true, finished: false, restoringSave: false }),
    false,
  );
  equal(
    '引导已经走完 → 没有卡片可收',
    shouldVoidTutorialOnModeChange({ dismissed: false, finished: true, restoringSave: false }),
    false,
  );

  // 接线：判定必须真挂在 setGameMode 上，而且作废时要落盘。
  // （只测纯函数的话，"函数写好了但没人调用"这种静默失败测不出来。）
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  // 2026-10-28：`setGameMode` 多了一个 `internal` 参数（极限守卫要放行"死亡转旁观/读档"），
  // 所以这里的锚点跟着改；断言的内容不变——作废判定仍然挂在切模式这一跳上。
  const setGameModeBody = /setGameMode\(mode: GameMode, internal = false\): boolean \{[\s\S]*?\n  \}/.exec(mainSrc)?.[0] ?? '';
  check('setGameMode 里调用了作废判定', setGameModeBody.includes('shouldVoidTutorialOnModeChange({'));
  check('作废时同时把模式传给判定（restoringSave）', setGameModeBody.includes('restoringSave: this.waitingForSaveRestore'));
  check('作废后收起卡片', setGameModeBody.includes('this.tutorialCard.hide()'));
  check('作废后立刻写存档', setGameModeBody.includes('void this.saveTutorialNow()'));
}

// ------------------------------------------------------------------ 存档与接线（静态）

console.log('\n存档仓与主程序接线（静态断言）');
{
  // 这几条守的是"改了版本却忘了建仓"这类**静默失败**：
  // IndexedDB 的 onupgradeneeded 少一行不会报错，只会让 loadTutorial 永远拿到 null。
  const saveSrc = readFileSync(new URL('../web/src/core/save/SaveGame.ts', import.meta.url), 'utf8');
  check('引导仓有常量', saveSrc.includes("const STORE_TUTORIAL = 'tutorial';"));
  check('建库时会补建（老库自动升级）', saveSrc.includes('createObjectStore(STORE_TUTORIAL)'));
  check('DB_VERSION 已升到 11', /const DB_VERSION = 11;/.test(saveSrc));
  check('有 loadTutorial 读取入口', saveSrc.includes('async loadTutorial('));
  check('有 saveTutorial 写入入口', saveSrc.includes('async saveTutorial('));

  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('读档时会恢复引导进度', mainSrc.includes('loadTutorial()'));
  check('读档用纯决策函数判"新世界 / 老存档 / 有数据"', mainSrc.includes('planTutorialBoot('));
  check('「不再提示」立刻写存档', mainSrc.includes('void this.saveTutorialNow()'));
  check(
    '获得物品经 reportProgress 桥接给引导',
    mainSrc.includes("if (event.kind === 'obtain') this.reportTutorial("),
  );
  check(
    '普通放置带 y 上报给引导',
    mainSrc.includes("this.reportTutorial({ kind: 'place', block: blockId, y })"),
  );
  check('进世界对账后显示卡片', mainSrc.includes('this.refreshTutorialCard();'));
  // 小游戏6 收尾：面板打开时让位（背包/配方书的遮罩是半透明的，透出卡片很乱）
  check(
    '面板打开时引导卡让位',
    mainSrc.includes('this.tutorialCard.setSuppressed(this.uiOpen || this.settingsScreen.isOpen)'),
  );
  const htmlSrc = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  check('让位有对应样式', htmlSrc.includes('.tutorial-root.suppressed'));

  // 2026-10-22 用户反馈：收起键与「不再提示」都点不动。
  // 根因是触摸端的 `#touch-look` 铺满全屏、在 DOM 里排在 `#hud-right` 之后，
  // 卡片不抬层的话点击全被它吃掉（与 `#hotbar` 当年同一个坑）。
  check(
    '引导卡抬了层（否则全屏视角面会吃掉点击）',
    /\.tutorial-root\s*\{[^}]*position:\s*relative[^}]*z-index:\s*[1-9]/.test(htmlSrc),
  );

  // 最后一步（石镐）要说清"石头在哪"：2026-10-22 起生存只教到石镐，
  // 新手最容易卡在"地表只见草和土、不知道往下挖"
  check(
    '石镐一步说了石头在哪（往下挖几格）',
    t('tutorial.survival.stonePickaxe.desc', 'zh') === '用木镐挖圆石，再合一把石镐（往下挖几格就是石头）',
    t('tutorial.survival.stonePickaxe.desc', 'zh'),
  );
  check(
    '被删掉的四步不再留有文案（不留死数据）',
    (() => {
      const keys = allKeys();
      return ['furnace', 'ironPickaxe', 'bed', 'house'].every(
        (step) => !keys.some((key) => key.startsWith(`tutorial.survival.${step}.`)),
      );
    })(),
  );
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
