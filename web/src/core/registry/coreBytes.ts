/**
 * 主线程解出来的**原始方块表字节**（`core.bin` / 保险柜返回的那一份）。
 *
 * 为什么需要它：app 形态（`SPECS_STUB=1`）下方块表是运行时注入的，而 Worker 是
 * 独立模块实例——模块求值那一刻注册表还是空的，`items.ts` 顶层的注册循环会直接抛
 * `Cannot read properties of undefined (reading 'id')`，世界永远生成不出来。
 *
 * 所以 Worker 要在自己那边**装同一份表**，而装表需要的正是这份字节。
 * 单独放一个模块是为了避开循环依赖：`hostCore` 负责写入，`World` / `MeshWorkerPool`
 * 负责读出来发给 Worker，双方都不需要互相 import。
 */

let bytes: ArrayBuffer | null = null;

/** 主线程装表后调用；Web 形态（表在包里）不会被调用，读取方据此保持 `null`。 */
export function setCoreBytes(buffer: ArrayBuffer | null): void {
  bytes = buffer;
}

/**
 * 取原始字节。**不要转移所有权**：同一个 buffer 要发给多个 Worker，
 * `postMessage` 不带 transfer 时是结构化克隆，每个 Worker 各拿一份副本。
 */
export function coreBytes(): ArrayBuffer | null {
  return bytes;
}
