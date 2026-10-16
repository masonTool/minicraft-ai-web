/**
 * 发射器（批次 60）：与投掷器**同一个容器**，唯一差别在"吐之前先看是什么"。
 *
 * 所以这里是**空子类**，一个字段都不加——它存在的理由是"**身份**"：
 *  1. 存档里的 `kind` 要跟着**方块**走（`dispenser` / `dropper`）；
 *  2. 界面标题与提示语要靠它分辨（"发射器" vs "投掷器"）；
 *  3. 以后发射器要是真长出别的差别（原版有 4 游戏刻延迟、槽位限制），这里就是落点。
 *
 * ⚠️ 一切按 `Dropper` 判定的地方（`Transfer.acceptingSlots`、`containerSlotCount`、
 * `BlockEntityStore` 的 `getDropper`）都用 `instanceof Dropper`，**子类自动被覆盖**，
 * 所以加这个类不会漏掉任何一处；反过来，凡是要**区分**两者的地方必须先判子类
 * （见 `ContainerSave.kindOf` 的注释：顺序写反了会把发射器存成投掷器）。
 *
 * "吐一件"的行为表在 `registry/dispense.ts`，执行在主程序（`dispenseFrom`）——
 * 容器这一侧只负责"挑一件出来 / 取走 / 磨掉一点耐久"。
 */

import { Dropper } from './Dropper.ts';

export const DISPENSER_SIZE = 9;

export class Dispenser extends Dropper {}
