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
 *  - **碰撞开关**：需要实体碰撞层的过滤条件；
 *  - **名字颜色 / 前后缀**：需要实体名字的渲染（本项目还没有名字牌）。
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
}

/** 存读档用的扁平快照 */
export interface TeamsSnapshot {
  teams: Array<{
    name: string;
    displayName: string;
    color: string;
    friendlyFire: boolean;
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
