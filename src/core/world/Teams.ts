/**
 * 队伍（M23 的最后一块，批次 468）
 *
 * 原版 `/team` 提供四样东西：**队友免伤**、**碰撞开关**、**名字颜色**、**前缀后缀**。
 * 这一批只做能离线验证的数据层与命令层：
 *
 *  - 队伍本身（名字 / 显示名 / 颜色 / 友好伤害开关）；
 *  - 成员归属（**一个成员只能在一个队伍里**，加入新队会自动退出旧队）；
 *  - `/team add|remove|list|join|leave|modify`；
 *  - 整份进存档（第 9 个对象仓）。
 *
 * ⚠️ 尚未接线（差异记在 TASKS M23）：
 *  - **队友免伤**：需要"伤害来源"——本项目的 `hurt()` 目前不认识"这一下是谁打的"，
 *    没有来源就没法判断"打人的是不是队友"；
 *  - **碰撞开关**：需要实体碰撞层的过滤条件。
 *
 * 已接线（有名字牌之后）：**名字颜色**（批次 616，走 `NameTagColor#colorForMob`）
 * 与**前缀后缀**（批次 1359，走 `NameTag#composeNameTag` + `NameTagColor#nameTagStyleFor`）。
 *
 * 也就是说：这一批做的是"队伍本身"，不是"队伍的全部玩法"——命令能建队、能拉人、
 * 能查归属，但还影响不到战斗。这一点**写在这里，也写在 TASKS 里**，
 * 免得以后有人看到 `/team` 能用就以为免伤也做了。
 */

/** 队伍颜色：与 `DYE_COLORS` 同名的 16 种（只用于显示，渲染层还没接） */
export const TEAM_COLORS: readonly string[] = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
];

export interface Team {
  name: string;
  displayName: string;
  color: string;
  /** 队友之间是否会互相伤害（原版 `friendlyFire`，默认关） */
  friendlyFire: boolean;
  /**
   * 名字牌上的前缀 / 后缀（批次 1359，`/team modify <队> prefix|suffix`）。
   * 空串 = 没设（原版用 `""` 清除，这里也用空串表达"清除"）。
   */
  prefix: string;
  suffix: string;
}

/**
 * 前后缀的长度上限（**按字符**，与 `NameTag#MAX_NAME_LENGTH` 同一口径）。
 *
 * 原版是 16 个字节（中文 3 字节 → 5 个字）；这里按字符 16，理由与名字牌那边一致：
 * 这是中文为主的客户端，按字节卡会让"三个中文的前缀"就超。
 * 渲染宽度另有 `composeNameTag` 的总长上限与 `nameTagWidthFor` 的世界宽度上限兜住。
 */
export const MAX_AFFIX_LENGTH = 16;

/**
 * 清洗一个前后缀。与 `sanitizeName` 的差别只有一处：**空串是合法值**。
 *
 * 名字空 = "不能命名"，所以那边返回 `null`；前后缀空 = "清除"，所以这里返回 `''`。
 * 其余规则相同（控制字符压成空格、连续空白压一个、首尾去空白、按字符截断）——
 * 牌子是单行画的，一个换行就会让后半截静默消失。
 */
export function sanitizeAffix(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const flattened = raw.replace(/[\r\n\t\v\f\u0000-\u001f]+/g, ' ');
  const collapsed = flattened.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, MAX_AFFIX_LENGTH).join('');
}

/** 存读档用的扁平快照 */
export interface TeamsSnapshot {
  teams: Array<{
    name: string;
    displayName: string;
    color: string;
    friendlyFire: boolean;
    /** 老快照可能没有这两个字段（批次 1359 之前），缺失按空串处理 */
    prefix?: string;
    suffix?: string;
    members: string[];
  }>;
}

export class Teams {
  private readonly teams = new Map<string, Team>();
  /** 成员（小写）→ 队伍名 */
  private readonly members = new Map<string, string>();
  /** 成员第一次写下的写法（显示用，与记分板的 `holderCase` 同一个理由） */
  private readonly memberCase = new Map<string, string>();

  /** 建队；重名返回 false（原版也是"已存在"） */
  add(name: string, displayName?: string, color = 'white'): boolean {
    if (this.teams.has(name)) return false;
    this.teams.set(name, {
      name,
      displayName: displayName && displayName.length > 0 ? displayName : name,
      color: TEAM_COLORS.includes(color) ? color : 'white',
      friendlyFire: false,
      prefix: '',
      suffix: '',
    });
    return true;
  }

  /** 删队：成员一并解绑（原版也这样，不会留下"指向不存在的队"的成员） */
  remove(name: string): boolean {
    if (!this.teams.delete(name)) return false;
    for (const [member, team] of [...this.members]) {
      if (team === name) {
        this.members.delete(member);
        this.memberCase.delete(member);
      }
    }
    return true;
  }

  get(name: string): Team | null {
    return this.teams.get(name) ?? null;
  }

  list(): Team[] {
    return [...this.teams.values()];
  }

  get count(): number {
    return this.teams.size;
  }

  /** 改颜色；队不存在或颜色不认识返回 false */
  setColor(name: string, color: string): boolean {
    const team = this.teams.get(name);
    if (!team || !TEAM_COLORS.includes(color)) return false;
    team.color = color;
    return true;
  }

  /** 改友好伤害（原版默认关）；队不存在返回 false */
  setFriendlyFire(name: string, on: boolean): boolean {
    const team = this.teams.get(name);
    if (!team) return false;
    team.friendlyFire = on;
    return true;
  }

  /**
   * 改前缀 / 后缀；队不存在返回 false。
   *
   * 文本一律先过 `sanitizeAffix`：**空串同样接受**（= 清除，原版用 `prefix ""`）。
   * 不做"不合法就拒绝"——前后缀是自由文本，唯一的硬约束是长度与单行。
   */
  setPrefix(name: string, raw: string | null | undefined): boolean {
    const team = this.teams.get(name);
    if (!team) return false;
    team.prefix = sanitizeAffix(raw);
    return true;
  }

  setSuffix(name: string, raw: string | null | undefined): boolean {
    const team = this.teams.get(name);
    if (!team) return false;
    team.suffix = sanitizeAffix(raw);
    return true;
  }

  /**
   * 成员入队；**一个成员只能在一个队伍里**（自动退出旧队）。
   * 队不存在或名字非法返回 false。
   */
  join(teamName: string, member: string): boolean {
    if (!this.teams.has(teamName)) return false;
    if (member.length === 0 || member.length > 16) return false;
    const key = member.toLowerCase();
    this.members.set(key, teamName);
    if (!this.memberCase.has(key)) this.memberCase.set(key, member);
    return true;
  }

  /** 退出当前队伍；本来就没队返回 false */
  leave(member: string): boolean {
    const key = member.toLowerCase();
    if (!this.members.delete(key)) return false;
    this.memberCase.delete(key);
    return true;
  }

  /** 某个成员所在的队；没队返回 null */
  teamOf(member: string): Team | null {
    const teamName = this.members.get(member.toLowerCase());
    return teamName === undefined ? null : (this.teams.get(teamName) ?? null);
  }

  /** 某个队伍的全部成员（按第一次写下的写法；排序稳定，便于断言与显示） */
  membersOf(teamName: string): string[] {
    const result: string[] = [];
    for (const [member, team] of this.members) {
      if (team === teamName) result.push(this.memberCase.get(member) ?? member);
    }
    return result.sort((a, b) => a.localeCompare(b));
  }

  /**
   * 两个人是不是队友（`friendlyFire` 那条判定的入口）。
   *
   * 注意：**现在还没有任何地方调用它**——`hurt()` 不认识伤害来源。
   * 放在这里是为了"定义"清楚，等伤害来源接上之后直接接进战斗结算。
   */
  sameTeam(a: string, b: string): boolean {
    const teamA = this.members.get(a.toLowerCase());
    return teamA !== undefined && teamA === this.members.get(b.toLowerCase());
  }

  snapshot(): TeamsSnapshot {
    return {
      teams: [...this.teams.values()].map((team) => ({
        name: team.name,
        displayName: team.displayName,
        color: team.color,
        friendlyFire: team.friendlyFire,
        prefix: team.prefix,
        suffix: team.suffix,
        members: this.membersOf(team.name),
      })),
    };
  }

  /**
   * 从快照恢复。与记分板同一条口径：**坏的跳过、好的收下**，返回跳过的条数
   * （读档是最容易把坏数据带进运行时的地方）。
   */
  restore(snapshot: TeamsSnapshot | null | undefined): number {
    this.reset();
    if (!snapshot) return 0;
    let skipped = 0;
    for (const entry of snapshot.teams ?? []) {
      if (typeof entry.name !== 'string' || entry.name.length === 0) {
        skipped++;
        continue;
      }
      this.add(entry.name, entry.displayName, entry.color);
      // friendlyFire 缺失（老快照）→ 保持默认关，不算坏数据
      if (typeof entry.friendlyFire === 'boolean') this.setFriendlyFire(entry.name, entry.friendlyFire);
      // 前后缀同理：批次 1359 之前的快照没有这两个字段，缺失按空串（不算坏数据）。
      // 走 setPrefix/setSuffix 而不是直接赋值：**老存档里若存进了换行/超长，
      // 读档这一刻就清洗掉**，否则脏文本会一路画到名字牌上。
      if (entry.prefix !== undefined) this.setPrefix(entry.name, entry.prefix);
      if (entry.suffix !== undefined) this.setSuffix(entry.name, entry.suffix);
      for (const member of entry.members ?? []) {
        if (!this.join(entry.name, member)) skipped++;
      }
    }
    return skipped;
  }

  reset(): void {
    this.teams.clear();
    this.members.clear();
    this.memberCase.clear();
  }
}
