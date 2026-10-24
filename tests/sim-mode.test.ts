/**
 * 模拟开关（L8 · MS2）
 *
 * 这张表就是"谁跑世界"的全部规则，所以逐格钉住：
 *  · 单机全跑（回归基线——加了这一批之后单机行为不许变）；
 *  · 从属一样都不跑（跑一样就等于两端各算一遍）；
 *  · 房主跑方块/生物/容器，但**不碰时钟**（时间由服务端权威）。
 */

import { describe, expect, it } from 'vitest';
import { SIM_DOMAINS, describeSimMode, shouldSimulate, type SimDomain } from '../src/core/net/SimMode.ts';
import type { NetRole } from '../src/core/net/NetRole.ts';

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
