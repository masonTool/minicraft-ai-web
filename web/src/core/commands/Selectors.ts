/**
 * 目标选择器（`@p` / `@s` / `@a` / `@e` / `@r` + `[...]` 过滤参数）
 *
 * 为什么要单独一个模块：选择器是**纯逻辑**（字符串 → 一组实体），
 * 与"世界里到底有哪些实体"完全解耦——调用方只要给一个 `SelectorView`
 * （一个 `entities()` 方法），Node 里就能跑断言。
 * 于是 `/execute` 的每一条判定都不必等浏览器。
 *
 * ⚠️ 与基岩版/Java 版的差异（都写在这里，不留在脑子里）：
 *  - **没有 `type=zombie,skeleton` 这种多值写法**：逗号已经被"参数分隔符"占了，
 *    多值改用竖线（`type=zombie|skeleton`）。理由：手机上打逗号比打竖线容易，
 *    而"逗号既是分隔符又是多值分隔符"会让解析出现两种读法（原版靠引号解决，
 *    但触屏上打引号更难受）。
 *  - **没有 `name="多 字 名"` 的引号**：`name=` 取到下一个逗号为止，去空格后整体比对。
 *  - **没有 `x=/y=/z=/dx=/dy=/dz=` 的方框选择**（原版 `@e[x=0,dx=5,…]` 圈一块区域）：
 *    它需要三个"增量"参数成组出现、还要判"半开区间"，是另一条活的量级；
 *    本项目里 `/execute positioned` + `distance` 已经覆盖了绝大多数用法。
 *  - **没有记分板/队伍/标签（`scores=` / `team=` / `tag=`）**：它们依赖 M5 还没做的记分板。
 */

import { t, tp } from '../i18n/I18n.ts';

/** 玩家在选择器里的固定 id（与 `Entity.id` 的数字 id 错开，不会撞） */
export const PLAYER_ENTITY_ID = 'player';

/** 选择器能看见的一只实体（一个扁平快照，不持有实体对象） */
export interface CommandEntity {
  /** 实体 id：玩家固定为 `PLAYER_ENTITY_ID`，生物为 `mob:<数字>` */
  id: string;
  /** 种类 id：玩家是 `player`，生物是 `MobType.id`（`zombie` / `villager` …） */
  type: string;
  /** 展示名（玩家是昵称，生物是中文名） */
  name: string;
  x: number;
  y: number;
  z: number;
  /** 是不是玩家（`@p` / `@a` / `@r` 只挑玩家） */
  isPlayer: boolean;
}

export type SelectorKind = '@p' | '@s' | '@a' | '@e' | '@r';

/** 排序口径；`arbitrary` = 保持 `entities()` 给出的顺序（原版也是"不保证"） */
export type SelectorSort = 'nearest' | 'furthest' | 'random' | 'arbitrary';

/** 距离区间（闭区间；`max` 用 `Infinity` 表示"没有上限"） */
export interface DistanceRange {
  min: number;
  max: number;
}

export interface SelectorFilter {
  /** 允许的种类；空数组 = 不按种类过滤 */
  types: readonly string[];
  /** 允许的名字（小写比对）；空数组 = 不按名字过滤 */
  names: readonly string[];
  distance: DistanceRange | null;
  /** 最多取几个；null = 不截断 */
  limit: number | null;
  sort: SelectorSort;
}

export interface ParsedSelector {
  kind: SelectorKind;
  filter: SelectorFilter;
}

/** 选择器需要的世界视图（只有这两个能力，实现方不必交出整个世界） */
export interface SelectorView {
  entities(): readonly CommandEntity[];
  /** 玩家昵称：`@p` 在"距离一样近"时优先挑自己（原版如此） */
  playerName(): string;
  /** `@r` 的随机源（可注入，测试里给常量就得到确定结果） */
  random?(): number;
}

export interface SelectorOrigin {
  x: number;
  y: number;
  z: number;
}

const KINDS: readonly SelectorKind[] = ['@p', '@s', '@a', '@e', '@r'];
const SORTS: readonly SelectorSort[] = ['nearest', 'furthest', 'random', 'arbitrary'];

function emptyFilter(): SelectorFilter {
  return { types: [], names: [], distance: null, limit: null, sort: 'arbitrary' };
}

/** 这一串是不是选择器（以 `@` 开头） */
export function isSelector(text: string): boolean {
  return text.trim().startsWith('@');
}

/**
 * 拆一个距离区间：`..10` / `5..` / `2..8` / `5`。
 * 解析失败返回错误文案（与 `parseSelector` 同一套"成功给对象、失败给字符串"的口径）。
 */
function parseDistance(text: string): DistanceRange | string {
  const raw = text.trim();
  if (raw.length === 0) return t('cmd.error.selector.distanceNoNumber');
  const dots = raw.indexOf('..');
  const read = (part: string): number | null => {
    if (part.length === 0) return null;
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return NaN;
    return value;
  };

  if (dots < 0) {
    const value = read(raw);
    if (value === null || Number.isNaN(value)) return tp('cmd.error.selector.distanceBadNumber', { raw });
    return { min: value, max: value };
  }

  const head = raw.slice(0, dots).trim();
  const tail = raw.slice(dots + 2).trim();
  const min = head.length === 0 ? 0 : read(head);
  const max = tail.length === 0 ? Infinity : read(tail);
  if (min === null || max === null || Number.isNaN(min) || Number.isNaN(max)) {
    return tp('cmd.error.selector.distanceBadRange', { raw });
  }
  if (min > max) return tp('cmd.error.selector.distanceReversed', { raw });
  return { min, max };
}

/**
 * 解析一个选择器。
 * @returns 解析结果，或者一句错误文案（调用方直接 `out.error` 出去）
 */
export function parseSelector(text: string): ParsedSelector | string {
  const raw = text.trim();
  if (!raw.startsWith('@')) return tp('cmd.error.selector.notSelector', { text });

  const kind = raw.slice(0, 2).toLowerCase() as SelectorKind;
  if (!KINDS.includes(kind)) {
    return tp('cmd.error.selector.unknown', { raw: raw.slice(0, 2) });
  }

  const filter = emptyFilter();
  const rest = raw.slice(2);
  if (rest.length === 0) return { kind, filter };
  if (!rest.startsWith('[') || !rest.endsWith(']')) {
    return tp('cmd.error.selector.filterNeedsBrackets', { raw });
  }

  const body = rest.slice(1, -1).trim();
  if (body.length === 0) return { kind, filter };

  let types: string[] = [];
  let names: string[] = [];

  for (const part of body.split(',')) {
    const piece = part.trim();
    if (piece.length === 0) return tp('cmd.error.selector.filterEmptyItem', { raw });
    const eq = piece.indexOf('=');
    if (eq < 0) return tp('cmd.error.selector.filterNeedsEquals', { piece });
    const key = piece.slice(0, eq).trim().toLowerCase();
    const value = piece.slice(eq + 1).trim();
    if (value.length === 0) return tp('cmd.error.selector.filterMissingValue', { key });

    switch (key) {
      case 'type': {
        // 竖线分隔多个种类（见文件头的差异说明）
        types = [...types, ...value.split('|').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0)];
        if (types.length === 0) return t('cmd.error.selector.typeMissing');
        break;
      }
      case 'name': {
        names = [...names, ...value.split('|').map((entry) => entry.trim().toLowerCase())];
        break;
      }
      case 'distance':
      case 'd': {
        const range = parseDistance(value);
        if (typeof range === 'string') return range;
        filter.distance = range;
        break;
      }
      case 'limit':
      case 'c': {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit <= 0) return tp('cmd.error.selector.limitBad', { value });
        filter.limit = limit;
        break;
      }
      case 'sort': {
        const sort = value.toLowerCase() as SelectorSort;
        if (!SORTS.includes(sort)) return tp('cmd.error.selector.unknownSort', { value });
        filter.sort = sort;
        break;
      }
      default:
        return tp('cmd.error.selector.unknownFilter', { key });
    }
  }

  return { kind, filter: { ...filter, types, names } };
}

/** 错误提示里用的"人话"描述 */
export function describeSelector(selector: ParsedSelector): string {
  const parts: string[] = [];
  const filter = selector.filter;
  if (filter.types.length > 0) parts.push(`type=${filter.types.join('|')}`);
  if (filter.names.length > 0) parts.push(`name=${filter.names.join('|')}`);
  if (filter.distance) {
    const { min, max } = filter.distance;
    parts.push(`distance=${min}..${max === Infinity ? '' : max}`);
  }
  if (filter.limit !== null) parts.push(`limit=${filter.limit}`);
  if (filter.sort !== 'arbitrary') parts.push(`sort=${filter.sort}`);
  return parts.length === 0 ? selector.kind : `${selector.kind}[${parts.join(',')}]`;
}

/**
 * 各选择器的**默认**排序与数量（原版的默认值，写在一处）：
 *  - `@p`：最近的**一个**玩家
 *  - `@r`：随机的**一个**玩家
 *  - `@a` / `@e`：全部（顺序不保证）
 *  - `@s`：执行者自己
 * 玩家显式写了 `sort=` / `limit=` 时以写下的为准。
 */
function effectiveFilter(selector: ParsedSelector): SelectorFilter {
  const filter = selector.filter;
  const sort = filter.sort !== 'arbitrary' ? filter.sort : selector.kind === '@p' ? 'nearest' : selector.kind === '@r' ? 'random' : 'arbitrary';
  const limit = filter.limit ?? (selector.kind === '@p' || selector.kind === '@r' ? 1 : null);
  return { ...filter, sort, limit };
}

function distanceOf(entity: CommandEntity, origin: SelectorOrigin): number {
  return Math.hypot(entity.x - origin.x, entity.y - origin.y, entity.z - origin.z);
}

function passes(entity: CommandEntity, filter: SelectorFilter, origin: SelectorOrigin): boolean {
  if (filter.types.length > 0 && !filter.types.includes(entity.type.toLowerCase())) return false;
  if (filter.names.length > 0 && !filter.names.includes(entity.name.toLowerCase())) return false;
  if (filter.distance) {
    const distance = distanceOf(entity, origin);
    if (distance < filter.distance.min || distance > filter.distance.max) return false;
  }
  return true;
}

/**
 * 求值一个选择器 → 一组实体（已按 `sort` 排好、按 `limit` 截断）。
 *
 * @param origin 距离与排序的参考点（`/execute` 里是当前执行位置）
 * @param executorId 执行者 id（`@s` 找它）
 */
export function resolveSelector(
  selector: ParsedSelector,
  view: SelectorView,
  origin: SelectorOrigin,
  executorId: string,
): CommandEntity[] {
  const all = view.entities();
  const filter = effectiveFilter(selector);

  if (selector.kind === '@s') {
    const self = all.find((entity) => entity.id === executorId);
    if (!self) return [];
    return passes(self, filter, origin) ? [self] : [];
  }

  let pool: CommandEntity[];
  switch (selector.kind) {
    case '@p':
    case '@a':
    case '@r':
      pool = all.filter((entity) => entity.isPlayer);
      break;
    default:
      // `@e`：全部实体（原版也包含玩家）
      pool = [...all];
      break;
  }

  pool = pool.filter((entity) => passes(entity, filter, origin));

  if (filter.sort === 'nearest' || filter.sort === 'furthest') {
    const sign = filter.sort === 'nearest' ? 1 : -1;
    pool = [...pool].sort((a, b) => sign * (distanceOf(a, origin) - distanceOf(b, origin)));
  } else if (filter.sort === 'random') {
    const random = view.random ?? Math.random;
    // Fisher–Yates：`sort(() => random() - 0.5)` 不是均匀洗牌，而 `@r` 的语义就是"均匀随机一只"
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    pool = shuffled;
  }

  // `@p` 在距离并列时优先自己（原版如此）：稳定排序之后再把自己提到最前
  if (selector.kind === '@p' && filter.sort === 'nearest' && pool.length > 1) {
    const index = pool.findIndex((entity) => entity.name.toLowerCase() === view.playerName().toLowerCase());
    if (index > 0 && distanceOf(pool[0]!, origin) === distanceOf(pool[index]!, origin)) {
      const [self] = pool.splice(index, 1);
      pool.unshift(self!);
    }
  }

  if (filter.limit !== null) pool = pool.slice(0, filter.limit);
  return pool;
}
