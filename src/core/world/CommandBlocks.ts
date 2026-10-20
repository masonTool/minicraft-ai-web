/**
 * 命令方块的内容（批次 477）
 *
 * 与告示牌（`world/SignText.ts`）同一套分工：**命令文字不在方块状态里**，
 * 而是按坐标存一张表，跟着存档走。理由是状态位只有 8 位，塞不下一格命令。
 *
 * 与告示牌的差别：
 *  - 只有**一行**（本项目不做多行命令），上限 128 字符；
 *  - 开头的 `/` 会被去掉（玩家习惯带斜杠，`executeCommand` 不认）；
 *  - 空字符串是合法值 = "这一格没有命令"（等价于删除）。
 *
 * ⚠️ 只做**脉冲**命令方块（红石上升沿执行一次）。原版的循环/连锁方块、
 * "条件/保持开启"这些开关需要额外的状态位与 UI，不在这一批。
 */

/** 一格命令最多多少字符（原版 32500，这里按"一行能看清"取 128） */
export const COMMAND_MAX_LENGTH = 128;

/** 表的键：与区块增量、方块实体同一套 `维度|x,y,z` */
export function commandKey(dimension: string, x: number, y: number, z: number): string {
  return `${dimension}|${x},${y},${z}`;
}

/**
 * 把玩家输入规整成能执行的一行。
 *
 * @returns `null` = 这份数据不可用（不是字符串）；`''` = 清空这一格的命令
 */
export function normalizeCommand(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // 去掉换行（单行输入框理论上敲不出来，但存档可能是手改的）
  let text = raw.replace(/[\r\n]+/g, ' ').trim();
  // 开头的斜杠：玩家习惯写 `/give`，命令表里存的是不带斜杠的
  while (text.startsWith('/')) text = text.slice(1).trim();
  if (text.length > COMMAND_MAX_LENGTH) text = text.slice(0, COMMAND_MAX_LENGTH);
  return text;
}

/** 存档里的一条（扁平结构，好进 JSON） */
export interface SerializedCommandBlock {
  dimension: string;
  x: number;
  y: number;
  z: number;
  command: string;
}

export class CommandBlockStore {
  private readonly entries = new Map<string, string>();

  get(dimension: string, x: number, y: number, z: number): string | undefined {
    return this.entries.get(commandKey(dimension, x, y, z));
  }

  /** 写一格命令；空字符串 = 删除 */
  set(dimension: string, x: number, y: number, z: number, command: string): void {
    const normalized = normalizeCommand(command);
    if (normalized === null || normalized === '') {
      this.entries.delete(commandKey(dimension, x, y, z));
      return;
    }
    this.entries.set(commandKey(dimension, x, y, z), normalized);
  }

  remove(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.delete(commandKey(dimension, x, y, z));
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  serialize(): SerializedCommandBlock[] {
    const out: SerializedCommandBlock[] = [];
    for (const [key, command] of this.entries) {
      const [dimension, coords] = key.split('|');
      const [x, y, z] = coords!.split(',').map(Number) as [number, number, number];
      out.push({ dimension: dimension!, x, y, z, command });
    }
    return out;
  }

  /**
   * 从存档恢复：**坏的跳过、好的收下**，返回跳过的条数。
   * 与告示牌/记分板同一条口径（读档是最容易把坏数据带进运行时的地方）。
   */
  restore(raw: unknown): number {
    this.entries.clear();
    if (!Array.isArray(raw)) return 0;
    let skipped = 0;
    for (const entry of raw as SerializedCommandBlock[]) {
      const command = normalizeCommand(entry?.command);
      if (
        command === null ||
        command === '' ||
        typeof entry.dimension !== 'string' ||
        !Number.isFinite(entry.x) ||
        !Number.isFinite(entry.y) ||
        !Number.isFinite(entry.z)
      ) {
        skipped++;
        continue;
      }
      this.entries.set(commandKey(entry.dimension, Math.floor(entry.x), Math.floor(entry.y), Math.floor(entry.z)), command);
    }
    return skipped;
  }
}
