/**
 * 进入世界时"引导该怎么起步"的**纯决策**（引导3，批次 20261022-1954）
 *
 * 为什么单独抽出来：这段判断原来写在 `App.loadSaveState()` 里，三个分支
 * （新世界 / 老存档没有引导数据 / 有引导数据）**没法离线断言**——
 * 而"老玩家一进世界被当成新手弹卡片"正是最需要盯住的回归。
 * 抽成纯函数之后，三个分支都能用一句断言钉住，`App` 只负责照着计划执行。
 *
 * 三条口径：
 *
 *  1. **新世界一定有引导**（路径按创建世界时选的模式走）；
 *  2. **老存档没有这份数据 = 已经会玩**，不是"数据坏了"——不弹、不重置；
 *  3. **有数据就完全听存档的**（包括玩家点过的「不再提示」与当时的路径）。
 */

import type { SerializedTutorial } from './TutorialTracker.ts';
import type { TutorialTrack } from './steps.ts';

/** 主程序能拿到的三样东西 */
export interface TutorialBootInput {
  /** 这个存档是不是已经存在（新世界为 false） */
  readonly hasSave: boolean;
  /** 存档里的引导数据；老存档为 null */
  readonly saved: { readonly state: SerializedTutorial; readonly dismissed: boolean } | null;
  /** 创建世界时选的模式（创造走建造小目标，其余走生存 8 步） */
  readonly mode: 'survival' | 'creative' | 'adventure' | 'spectator';
}

export interface TutorialBootPlan {
  /** 要恢复的状态；null 表示"从第一条开始" */
  readonly restore: SerializedTutorial | null;
  /** 从哪条路径开始（`restore` 非空时以存档里的为准） */
  readonly track: TutorialTrack;
  /** 是否不再显示 */
  readonly dismissed: boolean;
}

/** 模式 → 引导路径：只有创造走"建造小目标"，其余（含冒险/旁观）走生存 */
export function tutorialTrackFor(mode: TutorialBootInput['mode']): TutorialTrack {
  return mode === 'creative' ? 'creative' : 'survival';
}

/** 纯决策：三个分支各一条断言（见 `tools/tutorial-test.ts`） */
export function planTutorialBoot(input: TutorialBootInput): TutorialBootPlan {
  if (input.saved) {
    return {
      restore: input.saved.state,
      track: input.saved.state.track,
      dismissed: input.saved.dismissed === true,
    };
  }
  if (input.hasSave) {
    // 老存档：这份仓是空的（升级前就存在），按"已经会玩"处理
    return { restore: null, track: tutorialTrackFor(input.mode), dismissed: true };
  }
  return { restore: null, track: tutorialTrackFor(input.mode), dismissed: false };
}
