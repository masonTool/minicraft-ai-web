/**
 * canvas 面板的输入通道（`src/ui2d/menu.ts`）
 *
 * 这一层要替代的是浏览器白送的东西：焦点、上下键、回车、Esc、点按钮。
 * 每一条错了都表现为"键盘用户按了没反应"——**触摸端测不出来**，
 * 而桌面端玩家一旦遇到就会以为游戏卡了。所以全部用例都打在这里。
 *
 * 运行：`npm run test:unit`
 */
import { describe, expect, it } from 'vitest';
import {
  CanvasMenu,
  MENU_PADDING,
  MENU_ROW_GAP,
  MENU_ROW_HEIGHT,
  menuFocusAfterKey,
  menuPanelSize,
  menuRowRects,
  type MenuRow,
} from '../src/ui2d/menu.ts';

const ROWS: MenuRow[] = [
  { id: 'resume', label: '继续游戏' },
  { id: 'settings', label: '设置' },
  { id: 'quit', label: '保存并回到主菜单' },
];

describe('菜单布局', () => {
  it('行数越多面板越高（每多一行 = 行高 + 行距）', () => {
    const two = menuPanelSize(2);
    const three = menuPanelSize(3);
    expect(three.h - two.h).toBe(MENU_ROW_HEIGHT + MENU_ROW_GAP);
    expect(menuPanelSize(0).h).toBeLessThan(two.h);
  });

  it('每行水平居中、等距往下排', () => {
    const panel = { x: 100, y: 50, w: 380, h: 200 };
    const rows = menuRowRects(panel, 3);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.x).toBe(panel.x + MENU_PADDING);
      expect(row.w).toBe(panel.w - MENU_PADDING * 2);
      expect(row.h).toBe(MENU_ROW_HEIGHT);
    }
    expect(rows[1]!.y - rows[0]!.y).toBe(MENU_ROW_HEIGHT + MENU_ROW_GAP);
    expect(rows[2]!.y - rows[1]!.y).toBe(MENU_ROW_HEIGHT + MENU_ROW_GAP);
  });

  it('行数为 0 时没有矩形（不画空壳）', () => {
    expect(menuRowRects({ x: 0, y: 0, w: 100, h: 100 }, 0)).toEqual([]);
  });
});

describe('焦点移动', () => {
  it('上下循环：最后一行往下回第一行，第一行往上到最后一行', () => {
    expect(menuFocusAfterKey(2, 3, 'ArrowDown')).toBe(0);
    expect(menuFocusAfterKey(0, 3, 'ArrowUp')).toBe(2);
    expect(menuFocusAfterKey(1, 3, 'ArrowDown')).toBe(2);
  });

  it('Home / End 跳两端', () => {
    expect(menuFocusAfterKey(1, 3, 'Home')).toBe(0);
    expect(menuFocusAfterKey(1, 3, 'End')).toBe(2);
  });

  it('不认识的键不动焦点（交给调用方处理）', () => {
    expect(menuFocusAfterKey(1, 3, 'KeyW')).toBe(1);
    expect(menuFocusAfterKey(1, 3, 'Enter')).toBe(1);
  });

  it('越界的起始焦点会被夹回来（菜单项可能变少）', () => {
    expect(menuFocusAfterKey(9, 3, 'ArrowDown')).toBe(0);
    expect(menuFocusAfterKey(-3, 3, 'End')).toBe(2);
    expect(menuFocusAfterKey(0, 0, 'ArrowDown')).toBe(0);
  });
});

describe('CanvasMenu 输入通道', () => {
  const viewport = { w: 800, h: 600 };

  it('没打开时任何输入都不理（不能"看不见也能按"）', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    expect(menu.isOpen).toBe(false);
    expect(menu.handleKey('Enter')).toBeNull();
    expect(menu.handlePointer(400, 300, viewport)).toBeNull();
  });

  it('打开后默认焦点在第一行，上下键移动焦点', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    menu.open();
    expect(menu.focus).toBe(0);
    expect(menu.handleKey('ArrowDown')).toEqual({ kind: 'move', focus: 1 });
    expect(menu.focus).toBe(1);
  });

  it('Enter / 空格激活当前焦点行（返回行 id，由调用方去执行动作）', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    menu.open(1);
    expect(menu.handleKey('Enter')).toEqual({ kind: 'activate', id: 'settings' });
    expect(menu.handleKey(' ')).toEqual({ kind: 'activate', id: 'settings' });
  });

  it('Esc 关闭菜单', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    menu.open();
    expect(menu.handleKey('Escape')).toEqual({ kind: 'close' });
    expect(menu.isOpen).toBe(false);
  });

  it('点某一行 = 激活它，并把焦点移过去', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    menu.open();
    const panel = menu.panelRect(viewport);
    const rows = menuRowRects(panel, ROWS.length);
    const target = rows[2]!;
    const input = menu.handlePointer(target.x + 5, target.y + 5, viewport);
    expect(input).toEqual({ kind: 'activate', id: 'quit' });
    expect(menu.focus).toBe(2);
  });

  it('点面板外面关闭（与 DOM 遮罩点一下关掉一致），可关掉这个行为', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    menu.open();
    expect(menu.handlePointer(2, 2, viewport)).toEqual({ kind: 'close' });
    expect(menu.isOpen).toBe(false);

    const sticky = new CanvasMenu('暂停', ROWS);
    sticky.open();
    expect(sticky.handlePointer(2, 2, viewport, false)).toBeNull();
    expect(sticky.isOpen).toBe(true);
  });

  it('命中区域与行 id 一一对应（给 Ui2DInput / hitRegionAt 用）', () => {
    const menu = new CanvasMenu('暂停', ROWS);
    menu.open();
    const regions = menu.regions(viewport);
    expect(regions.map((region) => region.id)).toEqual(['resume', 'settings', 'quit']);
    // 层号要高于普通控件（面板压在别的界面之上）
    expect(regions.every((region) => (region.layer ?? 0) > 0)).toBe(true);
  });
});
