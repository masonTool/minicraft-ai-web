/**
 * 木桶（批次 61）：与箱子**同一个容器**（27 格），所以这里是空子类。
 *
 * 它存在的理由与发射器那个空子类一样——**身份**：
 *  1. 存档里的 `kind` 跟着方块走（`barrel` / `chest`）；
 *  2. 界面标题与提示语要靠它分辨（"木桶" vs "箱子"）；
 *  3. "**上面压着方块就打不开**"这条规则挂在方块上（见 main 的右键判定），
 *     以后要是木桶自己长出别的差别，这里就是落点。
 *
 * ⚠️ 一切按 `Chest` 判定的地方（`Transfer.containerSlotCount`、`BlockEntityStore.getChest`、
 * `hasContent` 里"被战利品表填过的空箱子也要写"）都用 `instanceof Chest`，**子类自动被覆盖**；
 * 反过来凡是要**区分**两者的地方必须先判子类（见 `ContainerSave.kindOf` 的注释）。
 * 另外 `Chest.looted`（战利品标记）是继承来的，木桶永远用不到——它不会出现在结构里。
 */

import { Chest } from './Chest.ts';

export const BARREL_SIZE = 27;

export class Barrel extends Chest {}
