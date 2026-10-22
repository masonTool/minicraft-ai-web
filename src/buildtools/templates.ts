/**
 * 内置**建筑模板**（创造4，批次 20261022-1954）
 *
 * 四座小建筑：小屋 / 小桥 / 大树 / 石塔。每座是一组"相对锚点的方块坐标"，
 * 加一个落位前的检查（越界 / 挡路 / 悬空）。
 *
 * 为什么模板要用代码生成而不是手敲几百行坐标：手敲的坐标**一定会**写歪一格，
 * 而歪的那一格在断言里表现为"某个模板越界"——生成器保证这一条永远为真，
 * `validateTemplate` 只需要盯着"有没有重复 / 超范围"。
 *
 * 三条口径（都有断言守着）：
 *
 *  1. **模板只放没有朝向的方块**（木板 / 原木 / 圆石 / 玻璃）。门、楼梯、栅栏的连接状态
 *     要按落点算朝向，直接写死会得到"门朝着墙里"这种结果——低龄玩家不会去修它。
 *     小屋因此**留一个门洞**，让玩家自己装门（这也是最自然的一步）。
 *  2. **支撑只查最底层**（`requiresSupport`）。桥是悬空的，所以桥关掉这一项；
 *     小屋 / 塔 / 树最底层必须踩在实体上，否则半空中凭空长出一座房子。
 *  3. **拒绝而不是裁剪**：挡路、悬空、越界都直接失败并说明原因。选区粘贴那种
 *     "手抖拉过界"才需要裁剪；建筑模板是玩家挑了一个位置，悄悄少放一半更难理解。
 */

import { Block } from '../core/registry/blocks.ts';
import { WORLD_MAX_Y, WORLD_MIN_Y } from '../core/world/Chunk.ts';
import type { PasteCell } from './Clipboard.ts';

export interface TemplateBlock {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly id: number;
}

export interface BuildTemplate {
  readonly id: string;
  /** 界面文案键（`t(nameKey)`） */
  readonly nameKey: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly blocks: readonly TemplateBlock[];
  /**
   * 最底层（`dy === 0`）下方是否必须有实体支撑。
   * 桥为 `false`（悬空是它的本意），其余为 `true`。
   */
  readonly requiresSupport: boolean;
}

/** 生成器：同一坐标只留最后一次 `put`（方便"先铺整层、再把门洞挖掉"） */
class TemplateBuilder {
  private readonly blocks = new Map<string, TemplateBlock>();

  constructor(
    readonly id: string,
    readonly nameKey: string,
    readonly width: number,
    readonly height: number,
    readonly depth: number,
    readonly requiresSupport: boolean,
  ) {}

  put(dx: number, dy: number, dz: number, id: number): this {
    this.blocks.set(`${dx},${dy},${dz}`, { dx, dy, dz, id });
    return this;
  }

  remove(dx: number, dy: number, dz: number): this {
    this.blocks.delete(`${dx},${dy},${dz}`);
    return this;
  }

  build(): BuildTemplate {
    return {
      id: this.id,
      nameKey: this.nameKey,
      width: this.width,
      height: this.height,
      depth: this.depth,
      blocks: [...this.blocks.values()],
      requiresSupport: this.requiresSupport,
    };
  }
}

/** 5×4×5 的小屋：地板 + 两层墙 + 平屋顶，正面留一个门洞、两侧各一扇窗 */
function buildCottage(): BuildTemplate {
  const size = 5;
  const builder = new TemplateBuilder('small_house', 'template.smallHouse', size, 4, size, true);

  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) builder.put(x, 0, z, Block.OAK_PLANKS);
  }
  for (let y = 1; y <= 2; y++) {
    for (let x = 0; x < size; x++) {
      builder.put(x, y, 0, Block.OAK_PLANKS);
      builder.put(x, y, size - 1, Block.OAK_PLANKS);
    }
    for (let z = 1; z < size - 1; z++) {
      builder.put(0, y, z, Block.OAK_PLANKS);
      builder.put(size - 1, y, z, Block.OAK_PLANKS);
    }
  }
  // 两侧窗户（正中间那一格）
  builder.put(0, 2, 2, Block.GLASS);
  builder.put(4, 2, 2, Block.GLASS);
  // 正面门洞：留空，玩家自己装门（模板不写门，理由见文件头第 1 条）
  builder.remove(2, 1, 0);
  builder.remove(2, 2, 0);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) builder.put(x, 3, z, Block.OAK_PLANKS);
  }
  return builder.build();
}

/** 7×2×3 的小桥：桥面 + 两侧原木栏杆；**不要求支撑**（本来就是架空的） */
function buildBridge(): BuildTemplate {
  const width = 7;
  const depth = 3;
  const builder = new TemplateBuilder('small_bridge', 'template.bridge', width, 2, depth, false);
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) builder.put(x, 0, z, Block.OAK_PLANKS);
  }
  for (let x = 0; x < width; x++) {
    builder.put(x, 1, 0, Block.OAK_LOG);
    builder.put(x, 1, depth - 1, Block.OAK_LOG);
  }
  return builder.build();
}

/** 5×6×5 的大树：4 格树干 + 三层树叶（下层满、上层收窄） */
function buildTree(): BuildTemplate {
  const size = 5;
  const builder = new TemplateBuilder('big_tree', 'template.tree', size, 6, size, true);
  for (let y = 0; y <= 3; y++) builder.put(2, y, 2, Block.OAK_LOG);
  for (let y = 2; y <= 3; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        // 树干已经占了中心，不要再写一次树叶（同一坐标会被后写覆盖，故意跳过更清楚）
        if (x === 2 && z === 2) continue;
        builder.put(x, y, z, Block.OAK_LEAVES);
      }
    }
  }
  for (let y = 4; y <= 5; y++) {
    const inset = y === 4 ? 1 : 2;
    for (let x = inset; x < size - inset; x++) {
      for (let z = inset; z < size - inset; z++) builder.put(x, y, z, Block.OAK_LEAVES);
    }
  }
  return builder.build();
}

/** 3×7×3 的石塔：圆石四壁 + 顶盖，内部中空 */
function buildTower(): BuildTemplate {
  const size = 3;
  const height = 7;
  const builder = new TemplateBuilder('stone_tower', 'template.tower', size, height, size, true);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) builder.put(x, 0, z, Block.COBBLESTONE);
  }
  for (let y = 1; y <= height - 2; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (x === 1 && z === 1) continue;
        builder.put(x, y, z, Block.COBBLESTONE);
      }
    }
  }
  // 正面留一个门洞（y=1、中间）
  builder.remove(1, 1, 0);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) builder.put(x, height - 1, z, Block.COBBLESTONE);
  }
  return builder.build();
}

/** 全部内置模板（界面按这个顺序列卡片） */
export const TEMPLATES: readonly BuildTemplate[] = [buildCottage(), buildBridge(), buildTree(), buildTower()];

export function templateById(id: string): BuildTemplate | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * 自检：坐标是否都在声明的尺寸内、有没有重复。
 *
 * 返回问题列表（空 = 模板合法）。测试对**每一个**内置模板都跑一遍——
 * 手写坐标最容易出的错就是"多写了一格"，而那种错在游戏里表现为"凭空多一块砖"。
 */
export function validateTemplate(template: BuildTemplate): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const block of template.blocks) {
    const where = `${block.dx},${block.dy},${block.dz}`;
    if (!Number.isInteger(block.dx) || block.dx < 0 || block.dx >= template.width) {
      problems.push(`${template.id}: dx 越界 ${where}`);
    }
    if (!Number.isInteger(block.dy) || block.dy < 0 || block.dy >= template.height) {
      problems.push(`${template.id}: dy 越界 ${where}`);
    }
    if (!Number.isInteger(block.dz) || block.dz < 0 || block.dz >= template.depth) {
      problems.push(`${template.id}: dz 越界 ${where}`);
    }
    if (seen.has(where)) problems.push(`${template.id}: 坐标重复 ${where}`);
    seen.add(where);
  }
  if (template.blocks.length === 0) problems.push(`${template.id}: 空模板`);
  return problems;
}

export type TemplateReject = 'outOfWorld' | 'blocked' | 'unsupported';

export interface TemplateCheck {
  readonly ok: boolean;
  readonly reason?: TemplateReject;
  /** 目标格已经有方块 */
  readonly blocked: number;
  /** 最底层下方没有实体 */
  readonly unsupported: number;
  /** 超出世界高度的格数 */
  readonly outOfWorld: number;
}

export interface TemplateCheckOptions {
  readonly airId?: number;
  /** 判断"下方这格算不算支撑"；默认非空气即可 */
  readonly isSolid?: (id: number) => boolean;
  readonly minY?: number;
  readonly maxY?: number;
}

/**
 * 落位检查。
 *
 * `read` 是读世界方块的探针（纯函数注入，测试用 Map 即可）。
 * 优先级：越界 > 挡路 > 悬空——越界是"根本放不进去"，另外两个是"这块地方不合适"。
 */
export function checkTemplatePlacement(
  template: BuildTemplate,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  read: (x: number, y: number, z: number) => number,
  options: TemplateCheckOptions = {},
): TemplateCheck {
  const airId = options.airId ?? 0;
  const isSolid = options.isSolid ?? ((id: number) => id !== airId);
  const minY = options.minY ?? WORLD_MIN_Y;
  const maxY = options.maxY ?? WORLD_MAX_Y - 1;
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);

  let blocked = 0;
  let unsupported = 0;
  let outOfWorld = 0;

  for (const block of template.blocks) {
    const x = ox + block.dx;
    const y = oy + block.dy;
    const z = oz + block.dz;
    if (y < minY || y > maxY) {
      outOfWorld += 1;
      continue;
    }
    if (read(x, y, z) !== airId) blocked += 1;
    if (template.requiresSupport && block.dy === 0) {
      const below = y - 1;
      if (below < minY || !isSolid(read(x, below, z))) unsupported += 1;
    }
  }

  const reason: TemplateReject | undefined =
    outOfWorld > 0 ? 'outOfWorld' : blocked > 0 ? 'blocked' : unsupported > 0 ? 'unsupported' : undefined;
  return { ok: reason === undefined, reason, blocked, unsupported, outOfWorld };
}

/** 模板 + 落点 → 粘贴格（复用 `PasteRunner` 的分批与撤销） */
export function templateCells(
  template: BuildTemplate,
  origin: { readonly x: number; readonly y: number; readonly z: number },
): PasteCell[] {
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  return template.blocks.map((block) => ({
    x: ox + block.dx,
    y: oy + block.dy,
    z: oz + block.dz,
    id: block.id,
    state: 0,
  }));
}
