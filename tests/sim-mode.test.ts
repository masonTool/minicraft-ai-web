/**
 * 模拟开关（L8 · MS2）
 *
 * 这张表就是"谁跑世界"的全部规则，所以逐格钉住：
 *  · 单机全跑（回归基线——加了这一批之后单机行为不许变）；
 *  · 从属一样都不跑（跑一样就等于两端各算一遍）；
 *  · 房主跑方块/生物/容器，但**不碰时钟**（时间由服务端权威）。
 */

import { describe, expect, it } from 'vitest';
import { SIM_DOMAINS, describeSimMode, shouldSimulate, type SimDomain } from '../web/src/core/net/SimMode.ts';
import type { NetRole } from '../web/src/core/net/NetRole.ts';

const ROLES: NetRole[] = ['solo', 'host', 'client'];

describe('shouldSimulate', () => {
  it('单机：全部自己跑（回归基线）', () => {
    for (const domain of SIM_DOMAINS) expect(shouldSimulate('solo', domain)).toBe(true);
  });

  it('从属端：一样都不跑', () => {
    for (const domain of SIM_DOMAINS) expect(shouldSimulate('client', domain)).toBe(false);
  });

  it('房主：跑方块 / 生物 / 容器，不碰时钟', () => {
    expect(shouldSimulate('host', 'blocks')).toBe(true);
    expect(shouldSimulate('host', 'mobs')).toBe(true);
    expect(shouldSimulate('host', 'containers')).toBe(true);
    expect(shouldSimulate('host', 'clock')).toBe(false);
  });

  it('联机时任何人都不推进时钟（服务端权威）', () => {
    expect(shouldSimulate('host', 'clock')).toBe(false);
    expect(shouldSimulate('client', 'clock')).toBe(false);
  });

  it('三种角色 × 四个域都有确定的答案（不会漏出一个 undefined）', () => {
    for (const role of ROLES) {
      for (const domain of SIM_DOMAINS) {
        expect(typeof shouldSimulate(role, domain)).toBe('boolean');
      }
    }
  });

  it('域清单是唯一的：谁加了新模拟路径就得先登记', () => {
    expect([...SIM_DOMAINS]).toEqual(['blocks', 'mobs', 'containers', 'clock']);
  });
});

describe('describeSimMode', () => {
  it('从属端明确说明"不推进世界"', () => {
    expect(describeSimMode('client')).toContain('不推进世界');
  });

  it('房主列出它在跑的域，且不含时钟', () => {
    const text = describeSimMode('host');
    expect(text).toContain('blocks');
    expect(text).toContain('mobs');
    expect(text).not.toContain('clock');
  });

  it('单机把四个域都列出来', () => {
    for (const domain of SIM_DOMAINS) expect(describeSimMode('solo')).toContain(domain);
  });
});

/**
 * 编译期检查：`SimDomain` 覆盖 `SIM_DOMAINS` 里的每一项。
 * 反向（加了 union 却忘了进数组）靠下面这条运行期断言兜住。
 */
const _domainCoverage: Record<SimDomain, true> = {
  blocks: true,
  mobs: true,
  containers: true,
  clock: true,
};

describe('域清单与类型一致', () => {
  it('SIM_DOMAINS 与 SimDomain 的键集完全相同', () => {
    expect([...SIM_DOMAINS].sort()).toEqual(Object.keys(_domainCoverage).sort());
  });
});

/**
 * 20Hz tick 里的闸门（`src/main.ts` 那一行）：从属端一次都不该推进方块。
 *
 * 这里用"跑 100 个 tick、数 `tickWorldBlocks` 被调用几次"来钉这条行为——
 * 真跑一个 App 需要 WebGL，而这条规则本身是纯的。
 */
describe('tick 闸门', () => {
  function runTicks(role: NetRole, ticks: number): number {
    let writes = 0;
    for (let index = 0; index < ticks; index += 1) {
      if (shouldSimulate(role, 'blocks')) writes += 1;
    }
    return writes;
  }

  it('从属端跑 100 个 tick，方块推进 0 次', () => {
    expect(runTicks('client', 100)).toBe(0);
  });

  it('房主与单机跑 100 个 tick，方块推进 100 次（单机行为不变）', () => {
    expect(runTicks('host', 100)).toBe(100);
    expect(runTicks('solo', 100)).toBe(100);
  });
});
