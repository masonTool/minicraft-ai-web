/**
 * 书与笔 / 成书离线测试（批次 190，H16 的第一块）
 *
 * 这一套盯的是"**物品带一段文字**"这条新数据线，分四块：
 *
 *  1. **附加数据**：`pages` / `title` 进出存档、深拷、并堆判定（内容不同的书不能并）；
 *  2. **规整规则**：控制字符、超长、空页、页数上限——界面与读档**同一套**；
 *  3. **署名**：书与笔 → 成书（id 换掉、书名兜底、空白书不让署名）；
 *  4. **配方与图标**：书 + 墨囊 + 羽毛 → 书与笔；两个物品的图标都在图集里。
 *
 * 运行：npm run test:book
 */

import { Item } from '../src/core/registry/items.ts';
import { itemLabel, hasDescription, itemDescription } from '../src/core/registry/itemNames.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { recipeIngredients } from '../src/core/crafting/RecipeBook.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { CREATIVE_ITEMS, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import {
  BOOK_MAX_PAGES,
  BOOK_PAGE_CHARS,
  BOOK_TITLE_CHARS,
  UNTITLED_BOOK,
  bookPages,
  bookTitleOf,
  isBlankBook,
  isWritableBook,
  isWrittenBook,
  sanitizePage,
  sanitizePages,
  signBook,
  withPages,
} from '../src/core/items/Book.ts';
import { restoreStack, sameExtras, stackExtras, type ItemStack } from '../src/core/container/Inventory.ts';
import { tryInsertOne } from '../src/core/container/Transfer.ts';
import { Chest } from '../src/core/container/Chest.ts';
import { CHEST_SIZE } from '../src/core/container/Chest.ts';

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

const TILES = new Set<string>(TILE_ORDER);

function book(extra: Partial<ItemStack> = {}): ItemStack {
  return { id: Item.BOOK_AND_QUILL, count: 1, ...extra };
}

console.log('\n[两个物品]');
{
  equal('书与笔的中文名', itemLabel(Item.BOOK_AND_QUILL), '书与笔');
  equal('成书的中文名', itemLabel(Item.WRITTEN_BOOK), '成书');
  equal('书与笔不可堆叠（每本内容不同）', maxStackOf(Item.BOOK_AND_QUILL), 1);
  equal('成书同样不可堆叠', maxStackOf(Item.WRITTEN_BOOK), 1);
  check('两个都有图标', TILES.has(itemDef(Item.BOOK_AND_QUILL)!.tile) && TILES.has(itemDef(Item.WRITTEN_BOOK)!.tile));
  check('两个都能在创造栏里拿到', CREATIVE_ITEMS.includes(Item.BOOK_AND_QUILL) && CREATIVE_ITEMS.includes(Item.WRITTEN_BOOK));
  check('两个都有说明', hasDescription(Item.BOOK_AND_QUILL) && hasDescription(Item.WRITTEN_BOOK));
  check(
    '书与笔的说明写了"署名 / 成书"',
    itemDescription(Item.BOOK_AND_QUILL).includes('署名') && itemDescription(Item.BOOK_AND_QUILL).includes('成书'),
  );
}

console.log('\n[配方：书 + 墨囊 + 羽毛]');
{
  const recipe = RECIPES.find((entry) => entry.result.id === Item.BOOK_AND_QUILL);
  check('有这条配方', recipe !== undefined);
  equal('无序配方（原版就是无序的）', recipe?.kind, 'shapeless');
  equal('产 1 本', recipe?.result.count, 1);
  const ingredients = recipe ? recipeIngredients(recipe).map((ingredient) => ingredient.id).sort() : [];
  equal('三样原料：书 / 墨囊 / 羽毛', ingredients.join(','), [Item.BOOK, Item.INK_SAC, Item.FEATHER].sort().join(','));
}

console.log('\n[规整规则]');
{
  equal(`每页上限 ${BOOK_PAGE_CHARS} 字`, BOOK_PAGE_CHARS, 256);
  equal(`最多 ${BOOK_MAX_PAGES} 页`, BOOK_MAX_PAGES, 50);
  equal(`书名单行上限 ${BOOK_TITLE_CHARS}`, BOOK_TITLE_CHARS, 32);

  equal('\\r\\n 归一成 \\n', sanitizePage('a\r\nb'), 'a\nb');
  equal('控制字符被去掉（含 \\u0000）', sanitizePage('a\u0000b\u0007c'), 'abc');
  equal('换行保留', sanitizePage('第一行\n第二行'), '第一行\n第二行');
  equal('连续三个以上换行压成一个空行', sanitizePage('a\n\n\n\nb'), 'a\n\nb');
  equal('超长被截断', sanitizePage('字'.repeat(400)).length, BOOK_PAGE_CHARS);

  equal('末尾的空页被去掉', sanitizePages(['一', '', '']).length, 1);
  equal('中间的空页保留（那是玩家留的间隔）', sanitizePages(['一', '', '三']).length, 3);
  equal('全空时至少留一页', sanitizePages(['', ''])[0], '');
  equal('页数封顶', sanitizePages(Array.from({ length: 80 }, (_v, i) => `第${i}页`)).length, BOOK_MAX_PAGES);

  check('全空 = 空白书', isBlankBook(['', '  ']));
  check('有一页有字就不是空白书', !isBlankBook(['', '字']));
}

console.log('\n[读 / 写 / 署名]');
{
  check('书与笔可写', isWritableBook(book()));
  check('书与笔不是成书', !isWrittenBook(book()));
  check('成书可读', isWrittenBook(book({ id: Item.WRITTEN_BOOK, title: '日记', pages: ['第一天'] })));
  check('（对照）普通书既不可写也不是成书', !isWritableBook({ id: Item.BOOK, count: 1 }));

  equal('没写过 → 一张空白页', bookPages(book()).join('|'), '');
  equal('有页就原样取回', bookPages(book({ pages: ['a', 'b'] })).join('|'), 'a|b');

  // withPages：不改原对象、带着其它附加数据
  const original = book({ pages: ['旧'], name: '我的书', enchants: { unbreaking: 1 } });
  const updated = withPages(original, ['新的一页']);
  equal('页写进了新对象', updated.pages?.join('|'), '新的一页');
  equal('原对象没被改', original.pages?.join('|'), '旧');
  equal('改名跟着走', updated.name, '我的书');
  equal('附魔跟着走', updated.enchants?.unbreaking, 1);
  check('新对象里的页是新数组（不共享引用）', updated.pages !== original.pages);

  const blanked = withPages(book({ pages: ['x'] }), ['']);
  equal('把内容删空 → 不带 pages 字段', blanked.pages, undefined);

  equal('没写书名的成书显示兜底名', bookTitleOf(book({ id: Item.WRITTEN_BOOK })), UNTITLED_BOOK);
  equal('写了就用写的', bookTitleOf(book({ id: Item.WRITTEN_BOOK, title: '旅途' })), '旅途');

  const signed = signBook(book({ pages: ['第一页', '第二页'] }), ' 我的冒险 ');
  check('署名成功', signed !== null);
  equal('id 换成成书', signed?.id, Item.WRITTEN_BOOK);
  equal('书名去掉了首尾空格', signed?.title, '我的冒险');
  equal('页保留', signed?.pages?.join('|'), '第一页|第二页');
  equal('数量还是 1', signed?.count, 1);
  equal('没填书名 → 兜底名', signBook(book({ pages: ['x'] }), '   ')?.title, UNTITLED_BOOK);
  equal('空白书不让署名', signBook(book({ pages: ['', '  '] }), '空'), null);
  equal('成书不能再署名', signBook(book({ id: Item.WRITTEN_BOOK, pages: ['x'] }), '再来一次'), null);
}

console.log('\n[附加数据：存档 / 并堆 / 搬运]');
{
  const saved = book({ pages: ['第一页', '第二页'], title: '标题' });
  const restored = restoreStack(JSON.parse(JSON.stringify(saved)));
  equal('读档回来页还在', restored?.pages?.join('|'), '第一页|第二页');
  equal('读档回来书名还在', restored?.title, '标题');

  const dirty = restoreStack({ id: Item.BOOK_AND_QUILL, count: 1, pages: ['a\u0000b', 42, null], title: '  书  ' });
  equal('坏页被丢掉、好页被规整', dirty?.pages?.join('|'), 'ab');
  equal('书名去空白', dirty?.title, '书');
  const blankPages = restoreStack({ id: Item.BOOK_AND_QUILL, count: 1, pages: ['', ''] });
  equal('全空的页不写进栈（存档里不留空数组）', blankPages?.pages, undefined);

  const extras = stackExtras(book({ pages: ['a'] }));
  check('stackExtras 拷了页', Array.isArray(extras.pages) && extras.pages[0] === 'a');
  check('而且不是同一个数组', extras.pages !== book({ pages: ['a'] }).pages);

  check('页不同 → 不能并堆', !sameExtras({ pages: ['a'] }, { pages: ['b'] }));
  check('页相同 → 可以并堆', sameExtras({ pages: ['a'] }, { pages: ['a'] }));
  check('书名不同 → 不能并堆', !sameExtras({ title: '甲' }, { title: '乙' }));
  check('都没有这些字段 → 视为一致', sameExtras({}, {}));

  // 漏斗/投掷器搬一本写过的书：页与书名不能掉
  const chest = new Chest();
  const moved = tryInsertOne(chest, book({ pages: ['一页'], title: '搬过去的' }));
  check('能塞进箱子', moved);
  const slot = chest.get(0);
  equal('箱子里的那本还带着页', slot?.pages?.join('|'), '一页');
  equal('也还带着书名', slot?.title, '搬过去的');
  equal('（对照）箱子还是 27 格', CHEST_SIZE, 27);
}

console.log(`\n书测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
